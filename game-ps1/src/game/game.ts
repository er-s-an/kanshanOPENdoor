import * as THREE from 'three'
import type {
  EndingDef,
  EngineAPI,
  GameAPI,
  Interactable,
  NPCController,
  SoundName,
  WorldData,
} from '../engine/contract'
import { FearMeter, findHorrorGaze, type GazeCandidate } from './fear'
import { distanceXZ, findNearestInteractable } from './interact'
import { HUD } from './hud'
import type { MobileTouchInput } from '../engine/input'

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

/**
 * 开放正文在女主起身回应来人处中断。
 *
 * 因此非失败页不再伪装成「通关后的真实结果」，而是把玩家在截断点做出的
 * 当下动作记录下来。这样既保留互动选择，也不替原文补写思思、来人或七天后
 * 的结局。
 */
const ENDINGS: Record<string, EndingDef> = {
  chapterProtect: {
    id: 'chapterProtect',
    title: '第一章记录 · 向她走去',
    tone: 'good',
    subtitle:
      '你把反对这次伤害的话说出口，并朝阳台方向迈了一步。' +
      '这是你在首章截断处选择的站位；思思的伤势、来人的反应和这家人的真实关系，原文片段没有回答。',
  },
  chapterCalm: {
    id: 'chapterCalm',
    title: '第一章记录 · 先让她停下',
    tone: 'good',
    subtitle:
      '你把声音放低，先要求确认孩子的状况。' +
      '这只记录你在首章截断处的语气，不代表屋里已经安全，也不替原文断定任何人会怎样回应。',
  },
  chapterDistance: {
    id: 'chapterDistance',
    title: '第一章记录 · 留出距离',
    tone: 'good',
    subtitle:
      '你先稳住自己，隔着沙发把声音送向阳台。' +
      '这不是对冲突的结算：思思的伤势、来人的下一步和七天能否活下来，仍是原文开放片段之外的未知。',
  },
  dead: {
    id: 'dead',
    title: '惊悚值失控',
    tone: 'bad',
    subtitle:
      '惊悚值到达 100，互动版本在此判定失败并停止本局。' +
      '这条失败规则服务于游戏玩法，不补写原作开放片段之后发生的事。',
  },
}

const FLOOR_BLOOD = new THREE.Color(0x6e1414)
const FLOOR_CLEAN = new THREE.Color(0xbdb7ac)
const FLOOR_TMP = new THREE.Color()
const OPENING_TO_TARGET = new THREE.Vector3()
const OPENING_FORWARD = new THREE.Vector3()

/** 地板拖完 3 段时的渐变档位 */
function floorColor(t: number): THREE.Color {
  return FLOOR_TMP.copy(FLOOR_BLOOD).lerp(FLOOR_CLEAN, Math.max(0, Math.min(1, t)))
}

export class Game implements GameAPI {
  engine: EngineAPI
  world: WorldData
  npcs: Record<string, NPCController>
  fear = new FearMeter()
  flags: Record<string, number | boolean | string> = { stage: -1 }
  ended = false

  private hud = new HUD()
  private interactables = new Map<string, Interactable>()
  private listeners = new Map<string, ((data?: unknown) => void)[]>()
  private started = false

  /** 日常近视模糊基准；午睡醒来加重（§3 阶段 5） */
  private myopiaBase = 0.35
  private inputLocked = false
  private interactCooldown = 0
  private gazeList: GazeCandidate[] = []
  private fadingStains: { mat: THREE.Material; obj: THREE.Object3D; speed: number }[] = []
  /** 阳台玻璃撞击后短暂飞散的程序化碎片；源玻璃碰撞体仍保留，避免玩家穿墙。 */
  private glassFragments: {
    mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshLambertMaterial>
    velocity: THREE.Vector3
    spin: THREE.Vector3
    life: number
  }[] = []
  /** 玄关门由 gameplay 驱动；玩家从走廊侧拍门，门扇向屋内开启。 */
  private doorOpening = false
  private doorOpenT = 0

  /** 将剧情中的下一步翻译成手机右下角的实际按钮。 */
  private syncMobileUI(actionLabel: string, actionEnabled: boolean, locked: boolean): void {
    const input = this.engine.input as MobileTouchInput
    input.setMobileUI?.({ actionLabel, actionEnabled, locked })
  }

  constructor(engine: EngineAPI, world: WorldData, npcs: Record<string, NPCController>) {
    this.engine = engine
    this.world = world
    this.npcs = npcs

    // 撞击只由 NPC 在真正抵达阳台玻璃的一帧 emit；这里集中接音效与震屏，
    // 避免 gameplay 提前播一次、NPC 撞击时又播一次。
    this.on('sisiThrown', () => {
      this.sfx('glass')
      this.sfx('thud')
      this.engine.ps1?.shake(1.2, 620)
      this.shatterBalconyGlass()
    })
  }

  // ==========================================================================
  // GameAPI
  // ==========================================================================
  start(): Promise<void> {
    if (this.started) return Promise.resolve()
    this.started = true
    return this.runScript().catch((err) => {
      // eslint-disable-next-line no-console
      console.error('[game] 任务脚本异常：', err)
    })
  }

  update(dt: number): void {
    this.updateFadingStains(dt)
    this.updateGlassFragments(dt)
    this.updateDoor(dt)
    if (this.ended) return

    // 引擎占位（input/audio/ps1 未接入）时静默跳过，避免联调前白屏
    const input = this.engine.input
    if (!input) return

    // ---- §4 眯眼：输入层负责边沿音效；gameplay 只驱动近视参数 ----
    const squinting = input.squint > 0.5
    this.engine.ps1?.setMyopia(squinting ? 0 : this.myopiaBase)

    // ---- §4 恐怖凝视：眯眼 + 视野中心 ±10° 内有真身目标 → +3/秒 ----
    this.buildGazeCandidates()
    const hit = findHorrorGaze(this.engine.camera, squinting, this.gazeList)
    this.hud.setPulse(hit !== null)
    if (hit) {
      this.fear.add(3 * dt, `凝视·${hit.kind}`)
    }

    // ---- 惊悚值 100：立即死亡 ----
    if (this.fear.full) {
      void this.end('dead')
      return
    }
    this.engine.audio?.setFear(this.fear.value / 100)
    this.hud.setFear(this.fear.value / 100)

    // ---- 交互检测：最近可用项 → HUD 提示 → E 触发 ----
    if (this.interactCooldown > 0) this.interactCooldown -= dt
    // 部分主线段（例如门内红影扑来）刻意冻结 WASD 但仍让镜头可转；这些
    // 字幕不一定由 runStoryAction 持锁，所以 E 必须优先跳过当前字幕，不能
    // 变成一段无法操作的等待，也不能穿透去触发附近场景交互。
    const activeLine = document.querySelector<HTMLElement>('#hud .hud-sub.on, #hud .hud-sys.on')
    if (activeLine) {
      // 手机行动键与字幕点击走同一分支：一次点按只会补全/跳过当前字幕，
      // 不会穿透到身后的世界交互。
      this.syncMobileUI('继续', true, true)
      if (input.interactPressed) {
        activeLine.click()
        this.hud.showInteract(null)
      }
      return
    }
    if (this.inputLocked || this.interactCooldown > 0) {
      // 选项、过场与冷却期间，暂停移动/镜头及世界行动；弹窗本身保留真实按钮。
      this.syncMobileUI(this.inputLocked ? '剧情进行中' : '稍候再试', false, true)
      this.hud.showInteract(null)
      return
    }
    const best = findNearestInteractable(this, this.interactables.values(), this.engine.camera.position)
    this.syncMobileUI(best ? best.prompt : '靠近后互动', !!best, false)
    this.hud.showInteract(best ? `E · ${best.prompt}` : null)
    if (best && input.interactPressed) {
      this.interactCooldown = 0.35 // 防重入：同一交互不重复触发
      best.onInteract(this)
    }
  }

  say(speaker: string, text: string, msPerChar = 40): Promise<void> {
    if (this.ended) return Promise.resolve()
    return this.hud.say(speaker, text, msPerChar)
  }

  sys(lines: string[]): Promise<void> {
    if (this.ended) return Promise.resolve()
    return this.hud.sys(lines)
  }

  prompt(options: { id: string; label: string }[], title?: string): Promise<string> {
    if (this.ended) return Promise.resolve('')
    return this.hud.prompt(options, title)
  }

  addInteractable(i: Interactable): void {
    this.interactables.set(i.id, i)
  }

  removeInteractable(id: string): void {
    this.interactables.delete(id)
  }

  on(ev: string, fn: (data?: unknown) => void): void {
    const list = this.listeners.get(ev) ?? []
    list.push(fn)
    this.listeners.set(ev, list)
  }

  emit(ev: string, data?: unknown): void {
    this.listeners.get(ev)?.forEach((fn) => fn(data))
  }

  async end(endingId: string): Promise<void> {
    if (this.ended) return
    this.ended = true
    this.flags.ended = true
    this.inputLocked = true
    this.syncMobileUI('本段结束', false, true)
    this.hud.closeTransient()
    this.hud.setPulse(false)
    this.engine.audio?.setFear(endingId === 'dead' ? 1 : 0)
    try {
      document.exitPointerLock()
    } catch {
      /* 引擎可能未锁定，忽略 */
    }
    const def = ENDINGS[endingId] ?? ENDINGS.chapterDistance
    await sleep(endingId === 'dead' ? 400 : 1000)
    this.hud.showEnding(def)
  }

  // ==========================================================================
  // 首章任务链（原文开放段落 11–113 行的互动改编）
  //
  // 这不是「七天通关」的完整结局。故事在女主起身回应来人的位置停下，
  // 之后只记录玩家在这个截断点的行动，不替原文补写后续。
  // ==========================================================================
  private async runScript(): Promise<void> {
    this.engine.audio?.startAmbience()
    await sleep(600)

    // ---- 阶段 0：楼外白光 → 问规则 → 选房 → 30 层门外观察 ----
    // 这里保持原文的空间顺序。楼前和 30 层走廊是两个实际可走的区域；
    // 不把原文之外的弹幕、楼层评级或电梯叙述塞进玩家知识。
    this.flags.stage = 0
    this.flags.openingPhase = 'arrival'
    await this.sys([
      '【欢迎进入「幸福之家」副本。】',
      '【玩家在该副本存活七天，即为通关。】',
      '【初始玩家：30 人；现存活：30 人。】',
      '【祝各位玩家游戏愉快~】',
    ])
    if (this.ended) return
    this.engine.ps1?.flashWhite(280)
    await this.hud.fadeIn(1050)
    await this.speak([
      ['我', '车祸死后，一阵白光闪过。我来到一栋大楼前，耳边响起诡异的机械音。'],
      ['我', '我高度近视，凑近才能辨认。大楼和周围的人都只剩下模糊轮廓。'],
      ['我', '左边有学生妹哭着说想回家，另一边有人暴躁地问是谁在搞鬼。相对沉稳的一男一女走出来，自称红姐和俊哥。'],
    ])
    if (this.ended) return
    this.flags.openingFreeMove = true
    this.emit('openingFreeMove')
    this.hud.toast('远处只有雾里的轮廓。凑近红姐和俊哥，先把规则问清。', 5200)
    this.addOpeningEntryInteractables()
    await this.waitEvent('openingAt30')
    if (this.ended) return

    // ---- 阶段 1：门外拍门，门内的思思才从雾里扑来。 ----
    await this.waitEvent('doorOpen')
    if (this.ended) return
    this.setNpc('sisi', 'lunge')
    this.sfx('sting')
    this.engine.ps1?.shake(1, 520)
    await sleep(620)
    this.fear.add(10, '被掐')
    await this.speak([
      ['我', '——！！'],
      ['我', '门里有个矮小的红色人影，两条辫子的轮廓晃了一下。她忽然扑到走廊里，冰凉的小手掐住我的脖子。'],
      ['我', '你、你干什么？小孩子家家的，怎么穿着湿衣服到处跑？'],
      ['我', '是不是冷了？有没有哪里受伤？先找一身干净衣服。'],
      ['我', '（裙角又凉又黏。我看不清远处，先顾眼前能碰到的东西。）'],
    ])
    if (this.ended) return
    this.setNpc('sisi', 'held')
    this.clearDoorCollider()
    this.flags.enteredHome = true
    // 红影跨门、扑到脖子的这一拍只保留视角，不让 WASD 把目标拖出门洞；
    // 抱住后立即恢复移动，玩家才能实际带她进屋。
    this.emit('openingMovement', true)

    // ---- 阶段 2：抱着她进屋，再照料小孩（白裙 → 毛巾 → 擦脸 → 午睡）。 ----
    this.flags.stage = 2
    this.hud.toast('抱紧她，进屋找一身干净衣服。', 4500)
    await this.say('我', '我一边抱着小孩走进家门，一边带她去找干净衣服。公主房和浴室里总能找到些用品。')
    this.addCareChainInteractables()
    await this.waitEvent('sisiNap')
    if (this.ended) return
    await this.speak([
      ['我', '妈妈？我吗？刚才还在找衣服，转眼就被这么叫了。'],
      ['我', '我一直想有家人，又害怕生育的痛苦。她松开手、道谢、安静睡下，都确实发生过。'],
      ['我', '门里的危险没有因此消失，但心里空着的地方，还是忽然有了一点热乎气。'],
    ])
    if (this.ended) return

    // ---- 阶段 3：30 → 20 的播报与必须贴近阅读的玩家群 ----
    await this.sys(['【初始玩家：30 人；现存活：20 人。】'])
    if (this.ended) return
    await this.speak([
      ['我', '我刚为多了一个家人高兴，楼里却已经少了十个人。'],
      ['我', '沙发上的手机在震动。数字是真的，原因得把屏幕贴近了慢慢看。'],
    ])
    this.flags.stage = 3
    this.addPhoneInteractable()
    await this.waitEvent('phoneRead')
    if (this.ended) return

    // ---- 阶段 4：家务。手机已读完，拖地与两面凝固痕迹均为必做。 ----
    this.flags.stage = 4
    await this.say('我', '群里的消息先记下。事情再奇怪，眼前的地面和墙总得有人收拾。')
    this.addChoreInteractables()
    await this.waitEvent('choresDone')
    if (this.ended) return

    // ---- 阶段 5：忙完午睡，醒来时房子变暗。 ----
    this.flags.stage = 5
    await this.speak([
      ['我', '忙完已经是下午。我累得腰酸，回到沙发边，想在小孩旁边睡一会儿。'],
      ['我', '就一小会儿。'],
    ])
    this.addInteractable({
      id: 'sofa.nap',
      position: this.anchor('sofa'),
      radius: 1.9,
      prompt: '在沙发上眯一会儿',
      available: () => this.flags.stage === 5,
      onInteract: () => this.runStoryAction(async () => {
        this.removeInteractable('sofa.nap')
        this.sfx('ui')
        await this.say('我', '我把手指松开，闭上眼。')
        this.emit('momNap')
      }),
    })
    await this.waitEvent('momNap')
    if (this.ended) return
    await this.hud.fadeOut(1800)
    await sleep(1500)
    this.emit('nap')
    this.dimHouseForWake()
    this.fear.add(10, '午睡惊醒')
    this.myopiaBase = 0.55 // 醒来后日常模糊加重
    await sleep(1200)
    await this.hud.fadeIn(2200)
    await this.speak([
      ['我', '等我再次醒来，一股冰冷的气息罩下来。房子很暗，面前站着一道模糊黑影。'],
      ['我', '脸看不清，先听声音。'],
    ])
    if (this.ended) return

    // ---- 阶段 6：来人、思思护人、撞向阳台，以及原文截断前的斥责。 ----
    this.flags.stage = 6
    this.setNpc('boss', 'arrive')
    this.emit('bossHome')
    await sleep(1000)
    await this.say('？？？', '呵，有趣，居然能在思思手里活到现在。')
    await this.say('我', '原来她叫思思。人还糊在眼前，耳朵倒先替我记住了这把嗓子。')
    if (this.ended) return
    this.setNpc('sisi', 'defend')
    await this.say('思思', '你最好别动她，这个妈妈有点意思，我要留着好好玩。')
    if (this.ended) return

    // 从这刻到撞击完成不插对白：先让动作、玻璃声和震屏把伤害落下来。
    this.setNpc('sisi', 'thrown')
    this.fear.add(20, '思思被撞飞')
    await this.waitEvent('sisiThrown')
    if (this.ended) return
    await sleep(650)
    this.setNpc('boss', 'confront')
    await this.say('？？？', '谁允许你跟我这样说话的？真把自己当我女儿了？')
    await this.speak([
      ['我', '我看不清思思到底伤成怎样，那声撞击却躲不过去。'],
      ['我', '谁允许你这样跟孩子说话的？'],
      ['我', '我一骨碌从沙发边爬起来。她说“留着好好玩”时我不是没听见；可她叫我妈妈、亲过来的那一下，我也记得。'],
    ])
    if (this.ended) return

    // ---- 阶段 7：只选择自己此刻的语气和站位，不写来人的后续反应。 ----
    this.flags.stage = 7
    const choice = await this.prompt(
      [
        { id: 'defend', label: '向思思走一步：「哪有这样对待孩子的？」' },
        { id: 'soothe', label: '压低声音：「先停一下，让我看看她。」' },
        { id: 'retreat', label: '退半步稳住自己：「思思，我听得见你。」' },
      ],
      '首章截断处，你先怎么回应？',
    )
    if (this.ended) return

    let endingId = 'chapterDistance'
    if (choice === 'defend') {
      this.fear.add(10, '对峙·维护')
      endingId = 'chapterProtect'
      await this.speak([
        ['我', '我朝阳台方向迈了一步。刚才那声“妈妈”不是一句随口的称呼。'],
        ['我', '我的位置更靠近她，态度也已经明确：我反对眼前这次伤害。'],
      ])
    } else if (choice === 'soothe') {
      this.fear.add(5, '对峙·缓和')
      endingId = 'chapterCalm'
      await this.speak([
        ['我', '我没有和他争抢那个称呼，只把声音放低，让“先看看她”这件事尽量说清楚。'],
        ['我', '缓和的是语气，不是要求；屋里也没有因此变得安全。'],
      ])
    } else {
      this.fear.add(15, '对峙·暂退')
      await this.speak([
        ['我', '我退了半步，扶住沙发，先稳住自己的位置。'],
        ['我', '我把声音送向阳台：思思，我听得见你。暂时留出距离，不等于假装她没有受伤。'],
      ])
    }
    if (this.ended) return
    if (this.fear.full) {
      await this.end('dead')
      return
    }

    // ---- 阶段 8：清楚标明这是首章记录，而不是原文后续的真相或结局。 ----
    this.flags.stage = 8
    await sleep(550)
    await this.end(endingId)
  }

  /** 顺序展示一组字幕，避免两个剧情源同时抢 HUD 的单一字幕槽。 */
  private async speak(lines: readonly (readonly [speaker: string, text: string])[]): Promise<void> {
    for (const [speaker, text] of lines) {
      if (this.ended) return
      await this.say(speaker, text)
      if (this.ended) return
      await sleep(420)
    }
  }

  /**
   * Interactable 只能返回 void，因此把异步剧情包装成一个原子段。
   * 在该段结束前不再接受其他 E 交互，杜绝手机/家务/字幕互相顶掉的竞态。
   */
  private runStoryAction(action: () => Promise<void>): void {
    if (this.ended || this.inputLocked) return
    this.inputLocked = true
    void action()
      .catch((err) => console.error('[game] 交互剧情异常：', err))
      .finally(() => {
        if (!this.ended) this.inputLocked = false
      })
  }

  /** 楼外不是开场背景图：靠近老玩家、选房与抵达 30 层都要实际按 E 推进。 */
  private addOpeningEntryInteractables(): void {
    this.addInteractable({
      id: 'entry.rules',
      position: this.anchor('entryRules'),
      radius: 2.15,
      prompt: '向红姐和俊哥问规则',
      available: () => this.flags.stage === 0 && this.flags.entryRules !== true,
      onInteract: () => this.runStoryAction(async () => {
        this.removeInteractable('entry.rules')
        this.flags.entryRules = true
        this.flags.openingPhase = 'rules'
        this.sfx('ui')
        await this.speak([
          ['红姐', '被拉进来的都是死了的人。我们听说，通关所有副本、攒够传说中的 9999 分，就能复活。'],
          ['我', '那通关一次副本能拿多少积分？'],
          ['红姐', '和通关时的惊悚值有关。99 惊悚值通关，最后只能得 1 分；到 100，就直接死。'],
          ['红姐', '惊悚值说的就是害怕程度。老玩家熟悉副本后，基本会尽量控制在 60 以内。'],
          ['我', '那要是 0 惊悚值通关，能有 100 分吗？'],
          ['我', '红姐没有接这个问题。能确定的，只有她刚刚说过的那些规则。'],
          ['红姐', '这栋楼一共 30 层，一梯一户，每层只能住一名玩家。屋里有诡异，会扮演你的亲密关系；要和它们同吃同住七天。'],
        ])
        if (this.ended) return
        this.hud.toast('人群已经往低楼层聚过去了。', 3800)
        this.addOpeningFloorInteractable()
      }),
    })
  }

  private addOpeningFloorInteractable(): void {
    this.addInteractable({
      id: 'entry.select',
      position: this.anchor('entrySelect'),
      radius: 2.15,
      prompt: '跟上选房的人群',
      available: () => this.flags.stage === 0 && this.flags.entryRules === true && this.flags.entrySelect !== true,
      onInteract: () => this.runStoryAction(async () => {
        this.removeInteractable('entry.select')
        this.flags.entrySelect = true
        this.flags.openingPhase = 'allocation'
        this.sfx('ui')
        await this.speak([
          ['我', '很快就要选房间。俊哥打断红姐，拉着她先选了一楼和二楼。'],
          ['我', '看见老玩家这么选，其他人也纷纷涌向低楼层。因为近视，我跑不过，只好等大家选完。'],
          ['我', '最后，只剩 30 层给我。至少现在，我有一个门牌号了。'],
        ])
        if (this.ended) return
        await this.hud.fadeOut(700)
        this.emit('openingRelocate', { anchor: 'hallSpawn', yaw: Math.PI })
        await sleep(420)
        await this.hud.fadeIn(950)
        this.flags.openingAt30 = true
        this.flags.openingPhase = 'hall'
        await this.speak([
          ['我', '我抵达 30 层。环顾一圈，和现实没太大区别：只是血腥味重一点，墙红一点，温度低一点，灯光暗一点。'],
          ['我', '而且，这可是大平层，还有我梦寐以求的家人。先慢慢把门外认清楚。'],
        ])
        if (this.ended) return
        this.addHallInteractables()
        this.emit('openingAt30')
      }),
    })
  }

  private addHallInteractables(): void {
    this.addInteractable({
      id: 'hall.air',
      position: this.anchor('hallAir'),
      radius: 1.75,
      prompt: '停下来感受冷空气',
      available: () => this.flags.stage === 0 && this.flags.hallAir !== true,
      onInteract: () => this.runStoryAction(async () => {
        this.removeInteractable('hall.air')
        this.flags.hallAir = true
        this.sfx('ui')
        await this.say('我', '凉意贴着皮肤，空气里的血腥味更重了。闻得到，却看不出是谁受了伤。')
        this.maybeAddDoorInteractable()
      }),
    })
    this.addInteractable({
      id: 'hall.wall',
      position: this.anchor('hallWall'),
      radius: 1.75,
      prompt: '靠近看暗红的墙和灯',
      available: () => this.flags.stage === 0 && this.flags.hallWall !== true,
      onInteract: () => this.runStoryAction(async () => {
        this.removeInteractable('hall.wall')
        this.flags.hallWall = true
        this.sfx('ui')
        await this.say('我', '走近些，墙是暗暗的红色，灯光也暗。细节还是模糊，但地方确实很宽敞。')
        this.maybeAddDoorInteractable()
      }),
    })
  }

  private maybeAddDoorInteractable(): void {
    if (this.ended || this.flags.hallAir !== true || this.flags.hallWall !== true || this.flags.doorReady === true) return
    this.flags.doorReady = true
    this.flags.openingPhase = 'doorway'
    this.hud.toast('环境认清了。走到自家门口，按回家的方式拍门。', 5000)
    this.addInteractable({
      id: 'door.knock',
      position: this.anchor('doorExterior'),
      radius: 1.45,
      prompt: '用回家的口吻拍门',
      available: () => this.flags.stage === 0 && this.flags.doorReady === true,
      onInteract: () => this.runStoryAction(async () => {
        // 红影演出依赖玩家看向门；提示可以宽松出现，按 E 时才做朝向确认，
        // 避免人在看电梯/侧墙时把整段扑击错过。
        if (!this.isFacingAnchor('doorExterior', 0.5)) {
          this.hud.toast('面对门，再用回家的口吻拍。')
          return
        }
        this.removeInteractable('door.knock')
        this.flags.stage = 1
        this.flags.openingDoorKnocked = true
        this.emit('openingMovement', false)
        await this.speak([
          ['我', '既然是角色扮演，要和家人自然相处。回自己家，哪还需要客客气气？'],
          ['我', '快开门啊，宝宝我回家啦！再不开门我要饿死了！'],
        ])
        if (this.ended) return
        this.sfx('doorCreak')
        this.doorOpening = true
        await sleep(680)
        this.engine.ps1?.shake(0.4, 320)
        this.fear.add(5, '门开')
        await this.say('我', '嚯，自带冷气，这房子血赚。')
        this.emit('doorOpen')
      }),
    })
  }

  // ==========================================================================
  // 交互物注册
  // ==========================================================================
  private addCareChainInteractables(): void {
    const sisiState = () => this.npcs.sisi?.state ?? ''
    // 浴室柜：先拿白裙，kidsBed 的换衣才出现。
    // 角色的内部 id 仍是 sisi，但首章此处的玩家尚不知道她的名字，所有可见文字都称「小孩/她」。
    this.addInteractable({
      id: 'cabinet.dress',
      position: this.anchor('bathroomCabinet'),
      radius: 1.7,
      prompt: '打开浴室柜',
      available: () => this.flags.stage === 2 && !this.flags.hasDress,
      onInteract: () => this.runStoryAction(async () => {
        this.removeInteractable('cabinet.dress')
        this.sfx('ui')
        this.flags.hasDress = true
        this.hud.toast('获得：一条叠得整整齐齐的白裙。')
        await this.speak([
          ['我', '柜子里有一条干净白裙。眼前这些东西已经能帮上忙。'],
          ['我', '药箱在哪还没人回答，先别把能做的事拖着。'],
        ])
        this.emit('gotDress')
      }),
    })
    // 公主房小床：换白裙（未拿白裙不可见）
    this.addInteractable({
      id: 'bed.dress',
      position: this.anchor('kidsBed'),
      radius: 1.9,
      prompt: '给她换上白裙',
      available: () =>
        this.flags.stage === 2 && this.flags.hasDress === true && sisiState() === 'held',
      onInteract: () => this.runStoryAction(async () => {
        this.removeInteractable('bed.dress')
        this.sfx('ui')
        this.setNpc('sisi', 'changed')
        this.flags.dressed = true
        this.hud.toast('小孩换上了干净白裙。')
        await this.speak([
          ['我', '先把湿衣服换掉，好不好？'],
          ['我', '她扯着裙边，原先掐着我脖子的那只手，不知不觉松开了。'],
        ])
        this.emit('dressed')
      }),
    })
    // 浴室柜：热毛巾（换衣后才需要）
    this.addInteractable({
      id: 'cabinet.towel',
      position: this.anchor('bathroomCabinet'),
      radius: 1.7,
      prompt: '浸湿一条热毛巾',
      available: () =>
        this.flags.stage === 2 && this.flags.dressed === true && !this.flags.hasTowel,
      onInteract: () => this.runStoryAction(async () => {
        this.removeInteractable('cabinet.towel')
        this.sfx('ui')
        this.flags.hasTowel = true
        this.hud.toast('获得：热毛巾。')
        await this.say('我', '再拿条热毛巾，给她把脸擦干净。')
        this.emit('gotTowel')
      }),
    })
    // 公主房小床：擦脸（擦净 → kiss 音效 + 「谢谢妈妈」 + 惊悚 −10）
    this.addInteractable({
      id: 'bed.clean',
      position: this.anchor('kidsBed'),
      radius: 1.9,
      prompt: '用热毛巾给她擦脸',
      available: () =>
        this.flags.stage === 2 && this.flags.hasTowel === true && sisiState() === 'changed',
      onInteract: () => this.runStoryAction(async () => {
        this.removeInteractable('bed.clean')
        this.sfx('ui')
        this.setNpc('sisi', 'clean')
        this.hud.toast('污迹被一点点擦掉了。')
        await this.speak([
          ['我', '让我用热毛巾给你擦擦脸。'],
          ['我', '我凑近一点，一点点擦掉污迹。这个距离，我终于看清是个可爱的小女孩。'],
          ['我', '家人本来就该互相帮助。要不要亲我一口，算是谢谢？'],
        ])
        this.sfx('kiss')
        this.fear.add(-10, '被亲')
        await this.speak([
          ['小孩', '谢谢妈妈。'],
          ['我', '（妈妈？我这就无痛当妈啦？）'],
        ])
        this.emit('cleaned')
      }),
    })
    // 公主房小床：哄午睡
    this.addInteractable({
      id: 'bed.nap',
      position: this.anchor('kidsBed'),
      radius: 1.9,
      prompt: '哄她午睡',
      available: () => this.flags.stage === 2 && sisiState() === 'clean',
      onInteract: () => this.runStoryAction(async () => {
        this.removeInteractable('bed.nap')
        this.sfx('ui')
        this.setNpc('sisi', 'nap')
        await this.speak([
          ['我', '先休息一会儿，我就在旁边。'],
          ['我', '我把声音放轻，等她慢慢安静下来。那声“妈妈”还留在耳边。'],
        ])
        this.emit('sisiNap')
      }),
    })
  }

  private addPhoneInteractable(): void {
    this.addInteractable({
      id: 'phone.read',
      position: this.anchor('phone'),
      radius: 2.4,
      prompt: '看手机',
      // 30 → 20 的播报之后，玩家群是首章主线信息，而非可跳过的奖励路线。
      available: () => this.flags.stage === 3 && this.flags.phoneRead !== true,
      onInteract: () => {
        // 手机必须贴近才读得到；失败不消耗交互，玩家可继续往前挪。
        if (distanceXZ(this.engine.camera.position, this.anchor('phone')) >= 0.6) {
          this.hud.toast('太模糊了，凑近点看。')
          return
        }
        this.runStoryAction(async () => {
          this.flags.phoneRead = true
          this.removeInteractable('phone.read')
          this.sfx('ui')
          await this.showPhoneChat()
          if (this.ended) return
          this.fear.add(5, '读玩家群')
          this.hud.toast('你把手机放下，记住了群里的转述。')
          this.emit('phoneRead')
        })
      },
    })
  }

  private async showPhoneChat(): Promise<void> {
    await this.speak([
      ['我', '手机几乎贴到眼前，字终于勉强可以读了。这里是玩家交换信息的群聊，不是我听不到的直播评论。'],
      ['玩家群', '三楼有人争抢房间。黄毛刚敲开门，就遇上人身狗头的诡异；门里还有白骨。'],
      ['玩家群', '十楼一名中年玩家刚走进大门，惊悚值就升到 100，直接死了。'],
      ['玩家群', '群里还在说有新人的惊悚值已经升到 50。都是别人的转述，我没有亲眼见到现场。'],
      ['我', '这些消息和刚才少掉的十个人对上了。先放下手机，屋里还有眼前的活。'],
    ])
  }

  private addChoreInteractables(): void {
    // 拖把
    this.addInteractable({
      id: 'mop.take',
      position: this.anchor('mop'),
      radius: 1.6,
      prompt: '拿起拖把',
      available: () => this.flags.stage === 4 && this.flags.hasMop !== true,
      onInteract: () => this.runStoryAction(async () => {
        this.removeInteractable('mop.take')
        this.sfx('ui')
        this.flags.hasMop = true
        this.hud.toast('获得：拖把。')
        await this.say('我', '我从浴室找到拖把。先把能收拾的地方一点点收拾好。')
        this.emit('gotMop')
      }),
    })
    // 地板：分 3 段拖，深红 → 灰白（world 的 floorMat 驱动实际视觉变化）
    this.addInteractable({
      id: 'floor.mop',
      position: this.anchor('floorArea'),
      radius: 2.4,
      prompt: '拖地',
      available: () =>
        // 首次拖地前 floorSeg 尚未写入；不能把 undefined 转成 NaN 后误判为不可用。
        this.flags.stage === 4 && this.flags.hasMop === true && Number(this.flags.floorSeg || 0) < 3,
      onInteract: () => this.runStoryAction(async () => {
        const seg = Number(this.flags.floorSeg || 0) + 1
        this.flags.floorSeg = seg
        this.sfx('ui')
        this.applyFloorColor(seg / 3)
        if (seg === 3) this.hideBloodDecals()
        if (seg === 1) this.hud.toast('第一遍……深红色淡了些。')
        else if (seg === 2) this.hud.toast('第二遍……露出一点灰白。')
        else {
          this.hud.toast('第三遍……地板露出灰白的砖。')
          await this.say('我', '拖把一遍遍擦过去，原先红色的地面露出白色地砖。原来还能拖出这样的效果。')
        }
        await this.checkChores()
      }),
    })
    // 两面凝固痕迹：每块三下，保留已有的可见淡出效果。
    for (const [id, flag, name] of [
      ['stain.1', 'stain1', 'wallStain1'],
      ['stain.2', 'stain2', 'wallStain2'],
    ] as const) {
      this.addInteractable({
        id,
        position: this.anchor(name),
        radius: 1.9,
        prompt: '铲掉这块血渍',
        available: () => this.flags.stage === 4 && this.flags[flag] !== true,
        onInteract: () => this.runStoryAction(async () => {
          const hitsKey = `${flag}Hits`
          const hits = Number(this.flags[hitsKey] ?? 0) + 1
          this.flags[hitsKey] = hits
          this.sfx('thud')
          if (hits < 3) {
            this.hud.toast(`铲了第 ${hits} 下……凝固痕迹还黏在墙上。`)
            return
          }
          this.removeInteractable(id)
          this.flags[flag] = true
          this.fadeStainMesh(name)
          this.hud.toast('第三下，凝固痕迹和墙皮一起掉了。')
          await this.say('我', '湿布擦不掉的地方，就用铲子一点点清理。手臂有点酸，但墙面总算收拾好了一些。')
          await this.checkChores()
        }),
      })
    }
  }

  // ==========================================================================
  // 工具
  // ==========================================================================
  private anchor(name: string): THREE.Vector3 {
    return this.world.anchors[name]?.position ?? this.world.spawn
  }

  private waitEvent(ev: string): Promise<unknown> {
    return new Promise((resolve) => {
      const once = (data?: unknown) => {
        const list = this.listeners.get(ev)
        if (list) {
          const index = list.indexOf(once)
          if (index >= 0) list.splice(index, 1)
          if (list.length === 0) this.listeners.delete(ev)
        }
        resolve(data)
      }
      this.on(ev, once)
    })
  }

  private setNpc(id: string, state: string): void {
    this.npcs[id]?.setState(state, this)
  }

  private sfx(name: SoundName): void {
    this.engine.audio?.play(name)
  }

  /** 0.65 秒缓入门扇动画；门外玩家拍门后，门向屋内开启。 */
  private updateDoor(dt: number): void {
    if (!this.doorOpening || this.doorOpenT >= 1) return
    this.doorOpenT = Math.min(1, this.doorOpenT + dt / 0.65)
    const mesh = this.world.anchors.door?.userData?.doorMesh as THREE.Object3D | undefined
    if (!mesh) return
    const eased = 1 - Math.pow(1 - this.doorOpenT, 3)
    mesh.rotation.y = -1.28 * eased
  }

  /** 思思被抱住后，才让玩家从已开的门穿过门槛进入屋内。 */
  private clearDoorCollider(): void {
    const collider = this.world.anchors.door?.userData?.doorCollider as THREE.Box3 | undefined
    collider?.makeEmpty()
  }

  /** 门口演出只在玩家确实看着门时起跑；其余交互仍保持无朝向门槛。 */
  private isFacingAnchor(name: string, minDot: number): boolean {
    const target = this.world.anchors[name]
    if (!target) return true
    target.getWorldPosition(OPENING_TO_TARGET).sub(this.engine.camera.position)
    OPENING_TO_TARGET.y = 0
    if (OPENING_TO_TARGET.lengthSq() < 1e-6) return true
    OPENING_TO_TARGET.normalize()
    this.engine.camera.getWorldDirection(OPENING_FORWARD)
    OPENING_FORWARD.y = 0
    if (OPENING_FORWARD.lengthSq() < 1e-6) return false
    OPENING_FORWARD.normalize()
    return OPENING_FORWARD.dot(OPENING_TO_TARGET) >= minDot
  }

  /** §4 恐怖凝视候选：boss 可见 / 思思血裙态（changed 之前）/ 凑近（<1.5m）未铲的血渍 */
  private buildGazeCandidates(): void {
    const list = this.gazeList
    list.length = 0
    const boss = this.npcs.boss
    if (boss && boss.state !== 'hidden') {
      list.push({ kind: 'boss', position: boss.group.position })
    }
    const sisi = this.npcs.sisi
    // Sisi 的 controller 预置 state 是 lunge 但开场 group 仍隐藏；不能让 30F
    // 转场前的空对象在视线中心凭空涨惊悚。门内的无五官剪影也只承担预告，
    // 真正露脸后才算可凝视目标。
    if (
      sisi &&
      sisi.group.visible &&
      (sisi.state === 'held' || (sisi.state === 'lunge' && sisi.group.userData.lungeSilhouette !== true))
    ) {
      list.push({ kind: 'sisi', position: sisi.group.position })
    }
    const cam = this.engine.camera.position
    for (const [anchorName, flag] of [
      ['wallStain1', 'stain1'],
      ['wallStain2', 'stain2'],
    ] as const) {
      if (this.flags[flag] === true) continue
      const a = this.world.anchors[anchorName]
      if (a && distanceXZ(cam, a.position) < 1.5) {
        list.push({ kind: 'stain', position: a.position })
      }
    }
  }

  private applyFloorColor(t: number): void {
    const mat = this.world.anchors.floorArea?.userData?.floorMat as
      | THREE.MeshLambertMaterial
      | undefined
    if (mat?.color) mat.color.copy(floorColor(t))
  }

  /** 第三遍拖地后收掉独立的血斑几何，避免灰白地板上还留深红斑块。 */
  private hideBloodDecals(): void {
    const decals = this.world.anchors.floorArea?.userData?.bloodDecals as THREE.Object3D[] | undefined
    decals?.forEach((decal) => { decal.visible = false })
  }

  /** 午睡黑场里压暗主灯，睁眼后保留轮廓但让空间显著变沉。 */
  private dimHouseForWake(): void {
    const houseLighting = this.world.group.userData.houseLighting as
      | { light: THREE.Light; baseIntensity: number }[]
      | undefined
    houseLighting?.forEach(({ light, baseIntensity }) => {
      light.intensity = baseIntensity * 0.35
    })
  }

  /** 血渍 mesh 透明度渐隐 → visible=false（§3：userData.mesh） */
  private fadeStainMesh(anchorName: string): void {
    const mesh = this.world.anchors[anchorName]?.userData?.mesh as THREE.Mesh | undefined
    if (!mesh) return
    const mat = mesh.material as THREE.Material | THREE.Material[]
    const single = Array.isArray(mat) ? mat[0] : mat
    if (!single) return
    single.transparent = true
    this.fadingStains.push({ mat: single, obj: mesh, speed: 1.7 })
  }

  private updateFadingStains(dt: number): void {
    for (let i = this.fadingStains.length - 1; i >= 0; i--) {
      const f = this.fadingStains[i]
      f.mat.opacity -= f.speed * dt
      if (f.mat.opacity <= 0) {
        f.mat.opacity = 0
        f.obj.visible = false
        this.fadingStains.splice(i, 1)
      }
    }
  }

  /**
   * 读取 world 暴露的阳台玻璃 panels，隐藏完整面板并生成短命碎片。
   * 不删除 world 的玻璃碰撞盒：撞击后玩家仍不能借此穿出阳台。
   */
  private shatterBalconyGlass(): void {
    if (this.flags.glassCracked === true) return
    this.flags.glassCracked = true
    const panels = this.world.anchors.balconyGlass?.userData?.panels as THREE.Mesh[] | undefined
    if (!panels?.length) return

    const worldPos = new THREE.Vector3()
    const worldQuat = new THREE.Quaternion()
    for (let panelIndex = 0; panelIndex < panels.length; panelIndex++) {
      const panel = panels[panelIndex]
      panel.userData.cracked = true
      panel.getWorldPosition(worldPos)
      panel.getWorldQuaternion(worldQuat)
      panel.visible = false

      // 每块原面板拆成少量大而易读的低多边形碎片，保持 PS1 风格而非写实粒子。
      for (let shardIndex = 0; shardIndex < 4; shardIndex++) {
        const mat = new THREE.MeshLambertMaterial({
          color: shardIndex % 2 === 0 ? 0x9cb9c9 : 0xd6e5e7,
          emissive: 0x11212a,
          transparent: true,
          opacity: 0.8,
          side: THREE.DoubleSide,
        })
        const shard = new THREE.Mesh(
          new THREE.PlaneGeometry(0.22 + shardIndex * 0.045, 0.18 + ((panelIndex + shardIndex) % 3) * 0.06),
          mat,
        )
        shard.position.copy(worldPos).add(new THREE.Vector3(
          (shardIndex - 1.5) * 0.24,
          (shardIndex % 2) * 0.28 - 0.08,
          0.035 + shardIndex * 0.012,
        ))
        shard.quaternion.copy(worldQuat)
        shard.rotateZ((shardIndex - 1.5) * 0.45)
        this.world.group.add(shard)
        this.glassFragments.push({
          mesh: shard,
          velocity: new THREE.Vector3((shardIndex - 1.5) * 0.72, 0.55 + shardIndex * 0.13, 0.35 + panelIndex * 0.08),
          spin: new THREE.Vector3(3 + shardIndex, -2.4 + panelIndex, (shardIndex - 1.5) * 2.1),
          life: 1.15 + shardIndex * 0.06,
        })
      }
    }
  }

  private updateGlassFragments(dt: number): void {
    for (let i = this.glassFragments.length - 1; i >= 0; i--) {
      const fragment = this.glassFragments[i]
      fragment.life -= dt
      fragment.velocity.y -= 4.2 * dt
      fragment.mesh.position.addScaledVector(fragment.velocity, dt)
      fragment.mesh.rotation.x += fragment.spin.x * dt
      fragment.mesh.rotation.y += fragment.spin.y * dt
      fragment.mesh.rotation.z += fragment.spin.z * dt
      fragment.mesh.material.opacity = Math.max(0, Math.min(0.8, fragment.life * 0.8))
      if (fragment.life <= 0) {
        this.world.group.remove(fragment.mesh)
        fragment.mesh.geometry.dispose()
        fragment.mesh.material.dispose()
        this.glassFragments.splice(i, 1)
      }
    }
  }

  private async checkChores(): Promise<void> {
    if (Number(this.flags.floorSeg) >= 3 && this.flags.stain1 === true && this.flags.stain2 === true) {
      if (this.flags.choresDone === true) return
      this.flags.choresDone = true
      this.removeInteractable('floor.mop')
      await this.speak([
        ['我', '地面和墙都收拾过了。已经到了下午，我该回到小孩身边歇一会儿。'],
      ])
      this.emit('choresDone')
    }
  }
}
