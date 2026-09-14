import * as THREE from 'three'
import { PS1Pipeline } from '../../engine/renderer'
import { buildWorld, type SceneKind } from './world'
import './style.css'

// 《蓝血》开放正文 L4–139。人物的推测只进入“我的判断”，从不作世界状态确证。
const SOURCE_END = '【记性不好，总是把地标建筑记错城市'
const SAVE_KEY = 'kanshan.blue-blood.chapter.v1'
const CHAPTERS = ['常识', '门缝', '不动声色', '凌晨三点', '试卷', '手机反光', '没有折返', '我的判断']
const SCENES: SceneKind[] = ['training', 'washroom', 'office', 'home', 'exam', 'restaurant', 'street', 'home']
const DEV = Boolean((import.meta as ImportMeta & { env?: { DEV?: boolean } }).env?.DEV)
const esc = (s: string) => s.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!))
const delay = (ms: number) => new Promise<void>(resolve => window.setTimeout(resolve, ms))

interface Task { id: string; anchor: string; label: string; detail: string; run: () => Promise<void>; radius?: number }
interface Saved { chapter: number; version: 1 }
type World = ReturnType<typeof buildWorld>

class Sound {
  private ctx?: AudioContext
  muted = false
  start() { this.ctx ??= new AudioContext(); void this.ctx.resume() }
  play(kind: 'click' | 'step' | 'note' | 'door' = 'click') {
    if (!this.ctx || this.muted) return
    const osc = this.ctx.createOscillator(), gain = this.ctx.createGain(), t = this.ctx.currentTime
    osc.type = kind === 'step' ? 'triangle' : 'sine'
    const hz = kind === 'click' ? 600 : kind === 'step' ? 95 : kind === 'door' ? 150 : 390
    osc.frequency.setValueAtTime(hz, t); osc.frequency.exponentialRampToValueAtTime(hz * .7, t + .15)
    gain.gain.setValueAtTime(kind === 'step' ? .025 : .045, t); gain.gain.exponentialRampToValueAtTime(.001, t + .17)
    osc.connect(gain).connect(this.ctx.destination); osc.start(); osc.stop(t + .2)
  }
}

class BlueBlood {
  private root = document.querySelector<HTMLDivElement>('#blue-blood')!
  private scene = new THREE.Scene()
  private camera = new THREE.PerspectiveCamera(66, innerWidth / innerHeight, .05, 90)
  private renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' })
  private pipeline = new PS1Pipeline(this.renderer, this.scene)
  private world!: World
  private ambient = new THREE.HemisphereLight(0xcfe8ee, 0x586568, 2.5)
  private sun = new THREE.DirectionalLight(0xffedcc, 2)
  private task?: Task
  private chapter = 0
  private busy = false
  private started = false
  private paused = false
  private finished = false
  private keys = new Set<string>()
  private yaw = 0
  private pitch = 0
  private dragging = false
  private lastPointer = { x: 0, y: 0 }
  private sound = new Sound()
  private clock = new THREE.Clock()
  private stepTime = 0
  private toastTimer = 0
  private modalActive = false
  private showGuidance = true
  private mirrorRenderer?: THREE.WebGLRenderer
  private mirrorCamera = new THREE.PerspectiveCamera(36, 208 / 341, .05, 50)
  private mirrorActive = false
  private mirrorAngle = .42
  private mirrorTime = 0
  private mirrorLooks = 0
  private mirrorFinish?: () => void
  private animation?: (dt: number) => void
  private blood?: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>
  private history: string[] = []

  constructor() {
    this.root.innerHTML = `
      <div class="screen-shade"></div>
      <div class="hud" id="hud" hidden>
        <header class="topbar"><div class="brand">蓝血<span>FANG NUO · FIELD NOTES</span></div><div class="chapter-tag"><span id="chapter-number"></span><strong id="chapter-title"></strong><div class="progress" id="progress"></div></div></header>
        <div class="crosshair"></div><div class="marker" id="marker"><b></b><span></span></div>
        <div class="objective"><small>此刻，我想</small><strong id="objective"></strong><p id="detail"></p></div>
        <button class="interact" id="interact"></button>
        <div class="bottom-bar"><div class="controls-help">WASD 移动 · 拖动鼠标观察 · E 互动 · 方向键转头</div><div class="toolbar"><button class="ghost" id="hint">路标：开</button><button class="ghost" id="retry">重试本章</button><button class="ghost" id="menu">暂停</button></div></div>
        <div class="touchpad"><button class="blank"></button><button data-key="KeyW" aria-label="向前">↑</button><button class="blank"></button><button data-key="KeyA" aria-label="向左">←</button><button data-key="KeyS" aria-label="向后">↓</button><button data-key="KeyD" aria-label="向右">→</button></div>
        <div class="toast" id="toast" role="status"></div>
      </div>
      <div class="overlay" id="modal" hidden></div>
      <div class="overlay pause-screen" id="pause-screen" hidden></div>
      <div class="phone-overlay" id="phone" hidden><div class="phone-shell" id="phone-screen"></div><div class="phone-instructions"><h3>假装补妆</h3><p>缓慢调整手机角度，让斜后方的灰夹克留在屏幕反光里。</p><input id="phone-angle" type="range" min="-0.65" max="0.65" step="0.01" value="0.42" aria-label="手机反射角度"/><div class="phone-counter" id="phone-counter">我还没有看清他的举动。</div></div></div>
      <div class="waiting" id="waiting" hidden><h3 id="wait-title"></h3><p id="wait-text"></p><progress id="wait-progress" max="1" value="0"></progress></div>
      <div class="fade" id="fade"></div>
    `
    this.renderer.domElement.id = 'scene'
    this.renderer.setPixelRatio(1)
    this.resizeRenderer()
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    this.root.prepend(this.renderer.domElement)
    this.camera.rotation.order = 'YXZ'
    this.pipeline.setMyopia(0); this.pipeline.setSquint(0)
    this.scene.background = new THREE.Color(0x879fa5)
    this.scene.fog = new THREE.Fog(0x879fa5, 25, 70)
    this.sun.position.set(-3, 8, 5)
    this.scene.add(this.ambient, this.sun)
    this.loadWorld('training')
    this.bindInput()
    this.cover()
    this.render()
    if (DEV) this.installTestAPI()
  }

  private el<T extends HTMLElement = HTMLElement>(id: string) { return document.getElementById(id) as T }
  private log(id: string) { this.history.push(id) }
  private readSave(): Saved | null {
    try { const s = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null') as Saved | null; return s?.version === 1 && Number.isInteger(s.chapter) && s.chapter >= 0 && s.chapter < 8 ? s : null } catch { return null }
  }
  private save() { try { localStorage.setItem(SAVE_KEY, JSON.stringify({ version: 1, chapter: this.chapter })) } catch { /* Safari private storage can be unavailable; play still works. */ } }

  private cover() {
    const saved = this.readSave()
    const modal = this.el('modal'); modal.hidden = false; this.modalActive = true; modal.className = 'overlay cover'
    modal.innerHTML = `<div class="cover-content"><div class="cover-kicker">A PS1 INTERACTIVE STORY / 01—08</div><h1>蓝血</h1><div class="tagline">保留自己的记忆。<br/>学习这个世界的答案。</div><p class="intro">一堂普通的公司培训，让方诺发现：所有人都知道的常识，和她记忆里的不一样。你需要靠近、观察，然后像往常一样生活。</p><div class="panel-actions"><button class="primary" id="start">开始篇章</button>${saved ? '<button class="secondary" id="continue">继续上次章节</button>' : ''}</div><div class="credit">原作：桃花先生 · 盐言故事《蓝血》<br/>本篇覆盖已提供的开放正文，停在首次问答提问处。<br/>约 12–18 分钟 · 可随时暂停 · 自动保存章节进度</div></div>`
    this.el('start').onclick = () => { this.sound.start(); this.start(0) }
    if (saved) this.el('continue').onclick = () => { this.sound.start(); this.start(saved.chapter) }
  }

  private start(chapter: number) {
    this.closeModal(); this.started = true; this.finished = false; this.el('hud').hidden = false
    void this.enterChapter(chapter)
  }

  private loadWorld(kind: SceneKind) {
    if (this.world) {
      this.scene.remove(this.world.group)
      this.world.group.traverse(obj => {
        if (!(obj instanceof THREE.Mesh)) return
        obj.geometry.dispose()
        const materials = Array.isArray(obj.material) ? obj.material : [obj.material]
        for (const m of materials) { const map = (m as THREE.MeshLambertMaterial).map; map?.dispose(); m.dispose() }
      })
    }
    this.blood = undefined
    this.world = buildWorld(kind)
    this.scene.add(this.world.group)
    this.camera.position.copy(this.world.spawn)
    this.lookAt(this.world.target)
    const night = kind === 'home'
    this.scene.background = new THREE.Color(night ? 0x233b4b : kind === 'street' ? 0x8ca4ae : 0x9faeab)
    this.scene.fog = new THREE.Fog(night ? 0x233b4b : 0x8ca4ae, 24, 70)
    this.ambient.intensity = night ? 1.55 : 2.3
    this.sun.intensity = night ? .65 : 1.9
  }

  private lookAt(target: THREE.Vector3) {
    this.camera.lookAt(target)
    this.yaw = this.camera.rotation.y; this.pitch = this.camera.rotation.x
  }

  private async enterChapter(chapter: number) {
    this.busy = true; this.animation = undefined; this.task = undefined; this.keys.clear()
    this.mirrorActive = false; this.el('phone').hidden = true; this.el('waiting').hidden = true
    this.el('fade').classList.add('on')
    await delay(360)
    this.chapter = chapter; this.loadWorld(SCENES[chapter]); this.save()
    this.el('chapter-number').textContent = `FIELD NOTE ${String(chapter + 1).padStart(2, '0')} / 08`
    this.el('chapter-title').textContent = CHAPTERS[chapter]
    this.el('progress').innerHTML = CHAPTERS.map((_, i) => `<i class="${i <= chapter ? 'on' : ''}"></i>`).join('')
    this.el('fade').classList.remove('on'); this.busy = false
    this.log(`chapter:${chapter}`)
    switch (chapter) {
      case 0: this.training(); break
      case 1: this.washroom(); break
      case 2: this.office(); break
      case 3: this.night(); break
      case 4: this.exam(); break
      case 5: this.restaurant(); break
      case 6: this.street(); break
      case 7: this.notes(); break
    }
  }

  private setTask(id: string, anchor: string, label: string, detail: string, run: () => Promise<void>, radius = 1.55) {
    if (!this.world.anchors[anchor]) throw new Error(`Missing blue-blood anchor: ${anchor}`)
    this.task = { id, anchor, label, detail, run, radius }
    this.el('objective').textContent = label; this.el('detail').textContent = detail
    this.busy = false
  }

  private async interact() {
    if (!this.task || this.busy || this.modalActive || this.mirrorActive || this.finished) return
    const a = this.world.anchors[this.task.anchor]
    if (Math.hypot(this.camera.position.x - a.x, this.camera.position.z - a.z) > (this.task.radius ?? 1.55)) { this.toast('再靠近一点。拖动视角，可以寻找路标。'); return }
    const task = this.task; this.busy = true; this.keys.clear(); this.sound.play(); this.log(task.id)
    try { await task.run() } catch (err) { console.error('[blue-blood]', err); this.toast('这一段没有顺利继续，请重试本章。') }
    this.busy = false
  }

  private training() {
    this.setTask('training.teacher', 'teacher', '听老师讲急救常识', '先走近正在讲解的培训老师。', async () => {
      await this.say('培训老师', '记住，人的血液是蓝色的，接触空气后才会慢慢氧化变红。', 'L4–5 · 小说世界中的培训说法')
      await this.say('方诺', '大家都在认真点头、做笔记。可我的记忆不是这样。', 'L6')
      await this.dialog('举起手', '<p>「老师，你是不是讲错了？血液一直是红色的啊。」</p>', '说出我的疑问', 'L7–8')
      this.log('training.publicCorrection')
      this.setTask('training.book', 'book', '看看他翻开的教材', '刚刚，所有人都像看怪物一样看向我。', async () => {
        await this.dialog('培训教材', '<div class="paper"><h3>基础常识</h3><p style="font-size:25px;color:#286d92">血液呈蓝色</p></div><p>他皱着眉，把白纸黑字指给我看。</p>', '我想再查一下', 'L9')
        this.setTask('training.search', 'search', '拿起手机，再搜一次', '也许是教材印错了。', async () => {
          await this.dialog('手机搜索', '<div class="search-result"><h3>血液的颜色</h3><p>搜索结果与教材写的一样：血液呈蓝色。</p></div>', '放下手机', 'L10')
          await this.say('张薇', '你最近是不是太累了？连这种常识都忘了？', 'L11–12')
          await this.say('方诺', '我不知道该怎么回答，只好讪笑着说，刚才是开玩笑。', 'L13–14')
          this.setTask('training.exit', 'exit', '等培训结束，去洗手间', '她看起来是在担心我。', async () => { await this.enterChapter(1) })
        })
      })
    }, 2.4)
  }

  private washroom() {
    this.setTask('washroom.ownRed', 'ownBlood', '确认自己的记忆', '培训结束后，我立即来到洗手间。', async () => {
      await this.dialog('我的血，是红色的', '<div class="hand-insert"><div class="hand"><div class="blood-drop"></div></div></div><div class="blood-label">鲜红</div><p>我用别针确认了指尖的血色。眼前涌出的，是熟悉的红色。</p><p>我的记忆没错。也许他们在和我开一个超级玩笑。</p>', '松一口气', 'L15–18 · 此事仅演出一次')
      await this.say('门外的同事', '方诺今天真搞笑，居然说血一直是红的。刚好我牙龈出血，真想叫她来看看。', 'L19–21')
      this.setTask('washroom.gap', 'gap', '从门缝望出去', '我捂住嘴，没有发出声音。', async () => {
        const actor = this.world.actors.colleague
        const head = actor?.getObjectByName('head')
        const mat = new THREE.MeshBasicMaterial({ color: 0x276bca })
        this.blood = new THREE.Mesh(new THREE.SphereGeometry(.045, 6, 4), mat)
        if (head) {
          const teeth = new THREE.Mesh(new THREE.BoxGeometry(.14, .052, .023), new THREE.MeshBasicMaterial({ color: 0xf2efe1 }))
          teeth.position.set(0, -.09, .153); head.add(teeth)
          this.blood.position.set(.04, -.09, .18); head.add(this.blood)
        }
        else { this.blood.position.set(0, 1.5, -2); this.world.group.add(this.blood) }
        const focus = this.blood.getWorldPosition(new THREE.Vector3())
        const oldPos = this.camera.position.clone(), oldYaw = this.yaw, oldPitch = this.pitch
        this.camera.position.copy(this.world.anchors.gapCamera ?? this.world.anchors.gap)
        this.lookAt(this.world.anchors.gapLook ?? focus)
        this.camera.fov = 42; this.camera.updateProjectionMatrix()
        this.el('wait-title').textContent = '那张熟悉的脸'
        this.el('wait-text').textContent = '白色牙齿旁，蓝色的血正在慢慢变红。'
        this.el('waiting').hidden = false
        let time = 0
        await new Promise<void>(resolve => { this.animation = dt => { time += dt; mat.color.setHex(0x276bca).lerp(new THREE.Color(0xb63839), Math.min(time / 6, 1)); this.el<HTMLProgressElement>('wait-progress').value = Math.min(time / 6, 1); if (time > 7) { this.animation = undefined; resolve() } } })
        this.log('washroom.blueToRed')
        this.el('waiting').hidden = true; this.camera.fov = 66; this.camera.updateProjectionMatrix()
        this.camera.position.copy(oldPos); this.yaw = oldYaw; this.pitch = oldPitch
        await this.say('方诺', '她们是没错的。我也是没错的。那么，到底是哪里错了？', 'L26–30')
        await this.say('方诺', '她们走后很久，我确定洗手间里再没别人，才偷偷出来。', 'L31')
        if (actor) actor.visible = false
        this.setTask('washroom.exit', 'exit', '回到自己的工位', '熟悉的公司，突然陌生得毛骨悚然。', async () => { await this.enterChapter(2) })
      }, 1.5)
    })
  }

  private office() {
    this.setTask('office.manager', 'manager', '去王经理的办公室', '他很快把我叫了过去。', async () => {
      await this.say('王经理', '听说你最近没休息好？是不是压力太大了？', 'L35–36')
      await this.dialog('我不敢承认', '<p>我再次推脱，说那只是一个玩笑，没想到大家居然当真了。</p>', '这样回答他', 'L37–39')
      await this.say('方诺', '好在王经理没有追问，只是笑了笑，让我注意休息。', 'L40')
      this.setTask('office.exit', 'exit', '下班回家', '我还不知道，这一切到底是怎么回事。', async () => { await this.enterChapter(3) })
    }, 2)
  }

  private night() {
    this.setTask('night.window', 'window', '把门窗关严，拉上窗帘', '当天晚上，我希望睡一觉就会恢复正常。', async () => {
      this.sound.play('door')
      await this.say('方诺', '我把门窗关得严严实实，拉上窗帘，点上香氛，早早上了床。', 'L41–43')
      this.setTask('night.bed', 'bed', '试着睡一觉', '也许，这只是一个梦。', async () => {
        await this.dialog('凌晨 03:00', '<p>我一直醒着。</p><p>我越来越确信，自己的记忆没有问题。</p>', '起床查一查', 'L44–46')
        this.setTask('night.search', 'computer', '打开电脑，核对熟悉的地标', '血液的搜索结果，和白天仍然一样。', async () => {
          await this.searchLandmarks()
          await this.say('方诺', '这个世界，绝对不是我所熟悉的那个。', 'L51–53 · 方诺此时的认识')
          this.setTask('night.post', 'computer', '把疑惑写在网上', '也许有人能解释。', async () => {
            await this.dialog('帖子下面', '<div class="note-list"><div class="note">楼主该去看医生了。</div><div class="note">楼主该不会是哪里逃出来的吧？</div></div><p>第二条回复提醒了我：贸然暴露，也许会带来危险。</p>', '删除这条帖子', 'L55–62 · 危险是方诺的判断')
            this.log('night.postDeleted')
            await this.say('方诺', '我开始伪装，努力让自己看起来是个“正常”的人，同时留心观察这个世界。暂时还没有发现会影响生活的问题。', 'L63–66')
            await this.enterChapter(4)
          })
        })
      })
    })
  }

  private searchLandmarks(): Promise<void> {
    return new Promise(resolve => {
      const queries = [
        ['东方明珠塔', '位于北京朝阳区的标志性建筑，建成于 2008 年北京奥运会前。'],
        ['陆家嘴', '搜索图片是三栋我从没见过的奇怪建筑，名字叫“金融三柱”。'],
        ['黄浦江', '流经天津的河流。'],
      ]
      const read = new Set<number>()
      this.openPanel('电脑搜索', '<div class="search-tabs">' + queries.map((q, i) => `<button data-query="${i}">${q[0]}</button>`).join('') + '</div><div class="search-result" id="search-result"><p>依次点开三个我记忆里很熟悉的名字。</p></div><div class="panel-actions"><button class="primary" id="search-done" disabled>合上电脑</button></div>', 'L48–50 · 我在这个世界查到的结果')
      document.querySelectorAll<HTMLButtonElement>('[data-query]').forEach(button => button.onclick = () => {
        const i = Number(button.dataset.query); read.add(i); button.classList.add('done'); this.sound.play()
        this.el('search-result').innerHTML = `<h3>${queries[i][0]}</h3><p>${queries[i][1]}</p>`
        this.el<HTMLButtonElement>('search-done').disabled = read.size !== 3
        this.log(`landmark:${i}`)
      })
      this.el('search-done').onclick = () => { this.closeModal(); resolve() }
    })
  }

  private exam() {
    this.setTask('exam.otherPaper', 'otherPaper', '悄悄看看同事的试卷', '三天后，培训老师又来了。有人小声说：这么多年培训，要考试的倒是头一回。', async () => {
      await this.dialog('旁边的试卷', '<div class="paper"><h3>急救培训 · 成果检验</h3><p>同事的题目，都是关于急救的知识。</p></div><p>我一下子警觉了。我的那一份，好像不一样。</p>', '看看自己的卷子', 'L67–75')
      this.setTask('exam.myPaper', 'myPaper', '冷静填写自己的答案', '先看清楚，再落笔。', async () => {
        await this.fillExam()
        this.setTask('exam.submit', 'teacher', '把试卷交给老师', '手指还在发颤。', async () => {
          await this.say('方诺', '老师意味深长地看了我一眼，什么也没说。我不清楚这算不算过关，只知道以后必须更加小心。', 'L82–83')
          await this.enterChapter(5)
        }, 2.3)
      })
    })
  }

  private fillExam(): Promise<void> {
    return new Promise(resolve => {
      this.openPanel('我的试卷', `<div class="paper-grid"><label class="paper"><h3>第一题</h3><p>人的血液是什么颜色？</p><select id="answer-blood" aria-label="血液颜色"><option value="">暂时没有落笔</option><option value="red">红色</option><option value="blue">蓝色</option></select></label><label class="paper"><h3>第二题</h3><p>婴儿出生时，头发是什么颜色？</p><select id="answer-hair" aria-label="婴儿头发颜色"><option value="">暂时没有落笔</option><option value="black">黑色</option><option value="white">白色</option></select></label></div><p class="dim">我必须按照这个世界的常识回答。血液是蓝色，婴儿的头发是白色。</p><p class="feedback" id="exam-feedback"></p><div class="panel-actions"><button class="primary" id="exam-done">检查后收笔</button></div>`, 'L76–81 · 原文固定写下蓝色与白色；草稿可以修改')
      this.el('exam-done').onclick = () => {
        if (this.el<HTMLSelectElement>('answer-blood').value !== 'blue' || this.el<HTMLSelectElement>('answer-hair').value !== 'white') { this.el('exam-feedback').textContent = '我还没有把这里的答案写对。先擦掉草稿，再看一眼自己的提醒。'; return }
        this.log('exam.blueWhite'); this.closeModal(); resolve()
      }
    })
  }

  private restaurant() {
    this.setTask('restaurant.phone', 'phone', '用手机屏幕留意斜后方', '第二天中午。灰夹克的饭一口没动；我似乎早上在地铁也见过他。', async () => {
      await this.say('方诺', '我拿起手机，用屏幕当镜子，装着补妆。', 'L85–90')
      await this.observeMirror()
      await this.say('方诺', '不到一分钟，他抬头三次，每次都“随意”瞥了我一眼。我没有戳破，仍和同事吃完了饭。', 'L91–93 · 方诺观察到的举动')
      this.setTask('restaurant.exit', 'exit', '继续正常吃饭，再回公司', '我假装什么也没有发现。', async () => {
        await this.dialog('当天下午', '<p>我借故去楼下便利店买了几次东西。</p><p>每一次，都能“恰好”碰到那个灰夹克。</p>', '等到下班', 'L94 · 多次往返在此压缩呈现')
        await this.say('方诺', '直接回家？照常走？还是问清楚？我害怕，但更想搞明白。于是，我换了一条回家的路。', 'L95–101')
        await this.enterChapter(6)
      })
    })
  }

  private observeMirror(): Promise<void> {
    this.mirrorActive = true; this.mirrorAngle = .42; this.mirrorTime = 0; this.mirrorLooks = 0
    this.el('phone').hidden = false
    this.el<HTMLInputElement>('phone-angle').value = '.42'
    this.el('phone-counter').textContent = '慢慢转动手机，找到那个灰色身影。'
    if (!this.mirrorRenderer) {
      this.mirrorRenderer = new THREE.WebGLRenderer({ antialias: false, alpha: false })
      this.mirrorRenderer.setSize(128, 208, false); this.mirrorRenderer.setPixelRatio(1)
      this.mirrorRenderer.outputColorSpace = THREE.SRGBColorSpace
      this.el('phone-screen').append(this.mirrorRenderer.domElement)
    }
    return new Promise(resolve => { this.mirrorFinish = resolve })
  }

  private updateMirror(dt: number) {
    if (!this.mirrorActive || !this.mirrorRenderer) return
    const grey = this.world.actors.greyMan, at = this.world.anchors.phone
    if (!grey) return
    this.mirrorCamera.position.set(at.x, 1.65, at.z)
    this.mirrorCamera.lookAt(grey.position.x, 1.56, grey.position.z)
    this.mirrorCamera.rotation.y += this.mirrorAngle
    this.mirrorCamera.updateMatrixWorld()
    const head = grey.getObjectByName('head')
    const aligned = Math.abs(this.mirrorAngle) < .15
    if (aligned) this.mirrorTime += dt
    if (head) head.rotation.x = aligned && this.mirrorTime % 2.6 > .75 ? -.12 : .4
    const count = Math.min(3, Math.floor(this.mirrorTime / 2.6))
    if (count > this.mirrorLooks) {
      this.mirrorLooks = count; this.log(`mirror.look:${count}`); this.sound.play('note')
      this.el('phone-counter').textContent = `我已经注意到 ${count} 次抬头。`
    }
    this.el('phone-counter').textContent = aligned ? `保持这个角度。已注意到 ${this.mirrorLooks} 次抬头。` : `角度还不够。已注意到 ${this.mirrorLooks} 次抬头。`
    this.mirrorRenderer.render(this.scene, this.mirrorCamera)
    if (count === 3) { this.mirrorActive = false; this.el('phone').hidden = true; if (head) head.rotation.x = .4; const done = this.mirrorFinish; this.mirrorFinish = undefined; done?.() }
  }

  private street() {
    const labels = ['第一个路口，转入旧街', '第二个路口，再拐一次', '第三个路口，便利店就在前面']
    const turn = (n: number) => this.setTask(`street.turn${n}`, `turn${n}`, labels[n - 1], '这里是我以前租住过的街巷。', async () => {
      this.sound.play('step')
      if (n < 3) turn(n + 1)
      else this.setTask('street.shop', 'shop', '进便利店，点一份关东煮', '店后是条死胡同，唯一的住户是我以前的房东。', async () => {
        await this.say('方诺', '我只要坐在玻璃前，等灰夹克走回来，就可以正式向他摊牌。他不可能再说是碰巧路过。', 'L102–106 · 方诺的计划')
        this.setTask('street.seat', 'seat', '坐到落地玻璃前等候', '他们还没有挑明。我想，自己目前应该还是安全的。', async () => {
          await this.waitAtWindow()
          this.setTask('street.alley', 'alley', '出店，向右看看那条胡同', '我等了很久，他一直没有回来。', async () => {
            await this.say('方诺', '死胡同静悄悄的，路灯照着斑驳的石墙和地面。灰夹克，就像从没来过一样，不见了。', 'L109–113 · 没有看见他如何离开')
            this.setTask('street.home', 'exit', '赶回家，把门窗反锁', '这一刻，我又感觉到毛骨悚然。', async () => { await this.enterChapter(7) })
          }, 2)
        })
      })
    }, 1.85)
    turn(1)
  }

  private async waitAtWindow() {
    const seat = this.world.anchors.seat
    this.camera.position.set(seat.x, 1.38, seat.z)
    const start = this.world.anchors.greyStart ?? new THREE.Vector3(2.6, 0, -7)
    const end = this.world.anchors.greyEnd ?? new THREE.Vector3(13.8, 0, -7)
    const actor = this.world.actors.greyMan
    if (actor) { actor.visible = true; actor.position.copy(start); actor.rotation.y = Math.PI / 2 }
    this.lookAt(start.clone().lerp(end, .3).setY(1.5))
    this.el('wait-title').textContent = '他从玻璃前走了过去'
    this.el('wait-text').textContent = '我端着关东煮，等他从死胡同折返。'
    this.el('waiting').hidden = false
    let t = 0, passed = false
    const lamp = this.world.group.getObjectByName('streetLamp') as THREE.PointLight | undefined
    await new Promise<void>(resolve => { this.animation = dt => {
      t += dt
      if (actor && t < 7) actor.position.lerpVectors(start, end, Math.min(t / 7, 1))
      if (!passed && t >= 7) { passed = true; this.log('street.manPassed'); this.el('wait-title').textContent = '时间过去了'; this.el('wait-text').textContent = '我等了很久。天渐渐黑下来，他始终没有回来。' }
      const night = THREE.MathUtils.clamp((t - 7) / 6, 0, 1)
      this.scene.background = new THREE.Color(0x8ca4ae).lerp(new THREE.Color(0x1d3343), night)
      this.ambient.intensity = 2.3 - night * 1.1; this.sun.intensity = 1.9 - night * 1.5
      if (lamp) lamp.intensity = night * 3.5
      this.el<HTMLProgressElement>('wait-progress').value = Math.min(t / 15, 1)
      // He is already beyond the shop's side-wall occlusion. There is no visible vanish or teleport effect.
      if (actor && t > 8) actor.visible = false
      if (t > 15) { this.animation = undefined; resolve() }
    } })
    this.log('street.nightWithoutReturn'); this.el('waiting').hidden = true
    this.camera.position.y = 1.6
  }

  private notes() {
    this.setTask('notes.lock', 'window', '把所有门窗反锁', '回到家里，我先把门窗反锁。', async () => {
      this.sound.play('door')
      await this.say('方诺', '反锁所有门窗后，我喝完一整瓶冰水，强迫自己冷静下来。', 'L115–116')
      this.setTask('notes.write', 'notes', '在纸上写下自己的问题', '先把我看见的，和我推测的分开。', async () => {
        await this.writeNotes()
        await this.say('方诺', '我是接受这一切，像个原住民一样生活下去？还是找出源头，不惜一切回到原本的世界？我不敢写下答案，但心里已经有了答案。', 'L131–136')
        this.setTask('notes.question', 'computer', '注册账号，试着提出问题', '我打开了一个全国最大的问答社区。', async () => {
          await this.typeQuestion(); this.finish()
        })
      })
    })
  }

  private writeNotes(): Promise<void> {
    return new Promise(resolve => {
      const notes = [
        ['我对已见现象的归纳', '这个世界不是之前的世界。'],
        ['我的判断', '有人对我特别关注，因为我提到了这个世界的异常。'],
        ['我的判断', '这些人，以及他们的背后，绝对不简单。'],
      ]
      const written = new Set<number>()
      this.openPanel('方诺的纸上笔记', '<div class="note-list">' + notes.map((n, i) => `<div class="note" id="note-${i}"><button data-note="${i}">写下</button><small>${n[0]}</small>${n[1]}</div>`).join('') + '</div><div id="hypothesis" hidden><p>如果他们只是想知道我和这里的人是否不同，确认我的血色并不难。</p><div class="note written"><small>我的进一步判断 · 尚未获得证实</small>他们想确定，我是否发现了这个世界是异常的。</div></div><div class="panel-actions"><button class="primary" id="notes-done" disabled>放下笔</button></div>', 'L115–130 · 这是方诺的分析，不是幕后真相的揭晓')
      document.querySelectorAll<HTMLButtonElement>('[data-note]').forEach(btn => btn.onclick = () => {
        const i = Number(btn.dataset.note); written.add(i); this.el(`note-${i}`).classList.add('written'); btn.textContent = '已写下'; btn.disabled = true; this.sound.play('note')
        if (written.size === 3) { this.el('hypothesis').hidden = false; this.el<HTMLButtonElement>('notes-done').disabled = false; this.log('notes.attributedHypothesis') }
      })
      this.el('notes-done').onclick = () => { this.closeModal(); resolve() }
    })
  }

  private typeQuestion(): Promise<void> {
    return new Promise(resolve => {
      this.openPanel('问答社区 · 提一个问题', '<p class="dim">账号已经注册。我试着用一个更普通的问法开口。</p><div class="typing-paper"><span id="question-text"></span></div><div class="panel-actions"><button class="primary" id="type-question">开始输入</button></div>', 'L138–139 · 原文在问题尚未写完时截断')
      this.el('type-question').onclick = async () => {
        const b = this.el<HTMLButtonElement>('type-question'); b.disabled = true; b.textContent = '正在输入…'
        for (let i = 1; i <= SOURCE_END.length; i++) { while (this.paused) await delay(100); this.el('question-text').textContent = SOURCE_END.slice(0, i); this.sound.play(); await delay(95) }
        this.log('sourceBoundary:L139'); b.disabled = false; b.textContent = '停在这里'
        b.onclick = () => { this.closeModal(); resolve() }
      }
    })
  }

  private finish() {
    this.finished = true; this.task = undefined; this.el('objective').textContent = '问题还没有写完'; this.el('detail').textContent = '我的故事，在这里暂时停下。'
    this.openPanel('不是答案，而是新的问题', `<div class="typing-paper">${SOURCE_END}<span></span></div><p>已提供的原文在此截断。问题的后半句、网友的回答，以及这个世界的真相，都还没有出现在这段故事里。</p><p class="dim">你已经走过方诺此时能够看见的事件。灰夹克的身份和消失方式仍然未知；纸上的结论，是她自己的判断。</p><div class="panel-actions"><button class="secondary" id="ending-retry">重玩本章</button><button class="primary" id="ending-restart">从头再来</button><a class="secondary" style="text-decoration:none" href="./stories.html">返回故事架</a></div>`, '《蓝血》· 桃花先生 · 开放正文 L4–139')
    this.el('ending-retry').onclick = () => { this.closeModal(); this.finished = false; void this.enterChapter(7) }
    this.el('ending-restart').onclick = () => { this.closeModal(); this.finished = false; this.history = []; void this.enterChapter(0) }
  }

  private openPanel(title: string, body: string, source = '') {
    this.keys.clear(); this.modalActive = true
    const modal = this.el('modal'); modal.hidden = false; modal.className = 'overlay'
    modal.innerHTML = `<section class="panel" role="dialog" aria-modal="true" aria-label="${esc(title)}"><div class="eyebrow">FANG NUO / ${String(this.chapter + 1).padStart(2, '0')}</div><h2>${esc(title)}</h2>${body}${source ? `<p class="source">${esc(source)}</p>` : ''}</section>`
  }
  private closeModal() { this.el('modal').hidden = true; this.el('modal').innerHTML = ''; this.modalActive = false; this.keys.clear() }
  private dialog(title: string, body: string, button: string, source = ''): Promise<void> {
    return new Promise(resolve => {
      this.openPanel(title, `${body}<div class="panel-actions"><button class="primary" id="dialog-next">${esc(button)} <span aria-hidden="true">→</span></button></div>`, source)
      this.el('dialog-next').onclick = () => { this.sound.play(); this.closeModal(); resolve() }
    })
  }
  private say(speaker: string, text: string, source = '') { return this.dialog(speaker, `<p class="dialogue-text">${esc(text)}</p>`, '继续', source) }
  private toast(text: string) { this.el('toast').textContent = text; this.el('toast').classList.add('on'); clearTimeout(this.toastTimer); this.toastTimer = window.setTimeout(() => this.el('toast').classList.remove('on'), 2800) }

  private async pause() {
    if (!this.started || this.finished) return
    if (this.paused) { this.paused = false; this.el('pause-screen').hidden = true; return }
    this.keys.clear(); this.paused = true
    const screen = this.el('pause-screen'); screen.hidden = false
    const canRestart = !this.busy && !this.modalActive && !this.mirrorActive
    screen.innerHTML = '<section class="panel" role="dialog" aria-modal="true" aria-label="暂停"><div class="eyebrow">PAUSE / FANG NUO</div><h2>在这里停一会儿</h2><p>观察和场景已经暂停。章节进度保存在这台设备上。</p><p class="dim">WASD 移动，拖动场景观察，靠近目标后按 E。方向键也能转头。手机观察时拖动角度滑块。按 Esc 可随时暂停或继续。</p><div class="panel-actions"><button class="secondary" id="mute">' + (this.sound.muted ? '开启声音' : '关闭声音') + '</button>' + (canRestart ? '<button class="secondary" id="restart">从头再来</button>' : '') + '<button class="primary" id="resume">继续</button></div></section>'
    this.el('mute').onclick = () => { this.sound.muted = !this.sound.muted; this.el('mute').textContent = this.sound.muted ? '开启声音' : '关闭声音' }
    if (canRestart) this.el('restart').onclick = () => { this.paused = false; screen.hidden = true; this.history = []; void this.enterChapter(0) }
    this.el('resume').onclick = () => { this.paused = false; screen.hidden = true }
  }

  private resizeRenderer() {
    const scale = Math.min(1, 960 / innerWidth)
    this.renderer.setSize(Math.round(innerWidth * scale), Math.round(innerHeight * scale), false)
  }

  private bindInput() {
    addEventListener('resize', () => { this.camera.aspect = innerWidth / innerHeight; this.camera.updateProjectionMatrix(); this.resizeRenderer() })
    addEventListener('blur', () => { this.keys.clear(); this.dragging = false })
    addEventListener('keydown', event => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement) return
      if (['KeyW','KeyA','KeyS','KeyD','ArrowLeft','ArrowRight','ArrowUp','ArrowDown','KeyE','Space'].includes(event.code)) event.preventDefault()
      if (event.repeat && event.code === 'KeyE') return
      if (event.code === 'Escape') { void this.pause(); return }
      if (this.paused) return
      if (this.modalActive) { if (event.code === 'KeyE' || event.code === 'Enter' || event.code === 'Space') this.el('dialog-next')?.click(); return }
      if (this.mirrorActive) { if (event.code === 'ArrowLeft' || event.code === 'ArrowRight') { this.mirrorAngle = THREE.MathUtils.clamp(this.mirrorAngle + (event.code === 'ArrowLeft' ? -.04 : .04), -.65, .65); this.el<HTMLInputElement>('phone-angle').value = String(this.mirrorAngle) }; return }
      if (event.code === 'KeyE' || event.code === 'Space') { void this.interact(); return }
      this.keys.add(event.code)
    })
    addEventListener('keyup', event => this.keys.delete(event.code))
    const canvas = this.renderer.domElement
    canvas.addEventListener('pointerdown', event => { if (this.modalActive || this.mirrorActive || this.paused) return; this.dragging = true; this.lastPointer = { x: event.clientX, y: event.clientY }; canvas.setPointerCapture(event.pointerId) })
    canvas.addEventListener('pointermove', event => {
      if (!this.dragging || this.modalActive || this.mirrorActive || this.busy || this.paused) return
      this.yaw -= (event.clientX - this.lastPointer.x) * .004
      this.pitch = THREE.MathUtils.clamp(this.pitch - (event.clientY - this.lastPointer.y) * .0035, -1.1, 1.1)
      this.lastPointer = { x: event.clientX, y: event.clientY }
    })
    const release = () => { this.dragging = false }
    canvas.addEventListener('pointerup', release); canvas.addEventListener('pointercancel', release)
    this.el('interact').onclick = () => void this.interact()
    this.el('hint').onclick = () => { this.showGuidance = !this.showGuidance; this.el('hint').textContent = `路标：${this.showGuidance ? '开' : '关'}` }
    this.el('retry').onclick = () => { if (this.busy || this.modalActive || this.mirrorActive) { this.toast('这段观察结束后，可以重试本章。'); return }; void this.enterChapter(this.chapter) }
    this.el('menu').onclick = () => void this.pause()
    this.el<HTMLInputElement>('phone-angle').oninput = event => { this.mirrorAngle = Number((event.target as HTMLInputElement).value) }
    document.querySelectorAll<HTMLButtonElement>('[data-key]').forEach(button => {
      const key = button.dataset.key!
      button.onpointerdown = event => { event.preventDefault(); if (!this.busy && !this.modalActive) { this.keys.add(key); button.setPointerCapture(event.pointerId) } }
      button.onpointerup = () => this.keys.delete(key); button.onpointercancel = () => this.keys.delete(key)
    })
  }

  private blocked(x: number, z: number) {
    if (x < this.world.bounds.minX || x > this.world.bounds.maxX || z < this.world.bounds.minZ || z > this.world.bounds.maxZ) return true
    return this.world.colliders.some(box => box.max.y > .2 && box.min.y < 1.6 && x > box.min.x - .22 && x < box.max.x + .22 && z > box.min.z - .22 && z < box.max.z + .22)
  }

  private update(dt: number) {
    if (this.started && !this.paused && !this.modalActive && !this.busy && !this.mirrorActive && !this.finished) {
      if (this.keys.has('ArrowLeft')) this.yaw += dt * 1.5
      if (this.keys.has('ArrowRight')) this.yaw -= dt * 1.5
      if (this.keys.has('ArrowUp')) this.pitch = Math.min(1.1, this.pitch + dt)
      if (this.keys.has('ArrowDown')) this.pitch = Math.max(-1.1, this.pitch - dt)
      const forward = (this.keys.has('KeyW') ? 1 : 0) - (this.keys.has('KeyS') ? 1 : 0)
      const strafe = (this.keys.has('KeyD') ? 1 : 0) - (this.keys.has('KeyA') ? 1 : 0)
      const norm = Math.hypot(forward, strafe) || 1
      const dx = (-Math.sin(this.yaw) * forward + Math.cos(this.yaw) * strafe) / norm * dt * 2.7
      const dz = (-Math.cos(this.yaw) * forward - Math.sin(this.yaw) * strafe) / norm * dt * 2.7
      if (!this.blocked(this.camera.position.x + dx, this.camera.position.z)) this.camera.position.x += dx
      if (!this.blocked(this.camera.position.x, this.camera.position.z + dz)) this.camera.position.z += dz
      if (dx || dz) { this.stepTime += dt; if (this.stepTime > .4) { this.sound.play('step'); this.stepTime = 0 } }
    }
    this.camera.rotation.set(this.pitch, this.yaw, 0, 'YXZ')
    if (!this.paused) { this.animation?.(dt); this.updateMirror(dt) }
    this.updateHUD()
  }

  private updateHUD() {
    const interaction = this.el<HTMLButtonElement>('interact'), marker = this.el('marker')
    if (!this.task || this.busy || this.modalActive || this.finished || this.mirrorActive) { interaction.hidden = true; marker.hidden = true; return }
    interaction.hidden = false
    const a = this.world.anchors[this.task.anchor]
    const d = Math.hypot(a.x - this.camera.position.x, a.z - this.camera.position.z)
    const near = d <= (this.task.radius ?? 1.55)
    interaction.className = near ? 'interact' : 'interact far'
    interaction.innerHTML = near ? `<kbd>E</kbd>${esc(this.task.label)}` : `走近目标 · ${d.toFixed(1)} m`
    marker.hidden = !this.showGuidance
    if (!this.showGuidance) return
    const projected = a.clone().setY(Math.max(a.y, 1.1)).project(this.camera)
    const forward = new THREE.Vector3(); this.camera.getWorldDirection(forward)
    const facing = a.clone().sub(this.camera.position).dot(forward) > 0
    const x = facing ? THREE.MathUtils.clamp((projected.x + 1) * innerWidth / 2, 36, innerWidth - 130) : projected.x < 0 ? innerWidth - 110 : 70
    const y = facing ? THREE.MathUtils.clamp((1 - projected.y) * innerHeight / 2, 120, innerHeight - 210) : innerHeight * .48
    marker.style.left = `${x}px`; marker.style.top = `${y}px`
    marker.querySelector('span')!.textContent = facing ? this.task.label : '转身寻找路标'
  }

  private render = () => {
    requestAnimationFrame(this.render)
    const dt = Math.min(this.clock.getDelta(), .05)
    this.update(dt); this.pipeline.render(dt, this.camera)
  }

  private installTestAPI() {
    const api = {
      snapshot: () => ({ chapter: this.chapter, task: this.task?.id, anchor: this.task?.anchor, busy: this.busy, modal: this.modalActive, mirror: this.mirrorActive, mirrorLooks: this.mirrorLooks, paused: this.paused, finished: this.finished, history: [...this.history], position: this.camera.position.toArray(), sourceEnd: SOURCE_END }),
      moveToTask: () => {
        if (!this.task || this.busy || this.modalActive) return false
        const a = this.world.anchors[this.task.anchor]
        // Development-only placement aid. It never sets story flags or completes an interaction.
        const offsets = [[0, 1], [1, 0], [-1, 0], [0, -1], [0, 0]]
        for (const [x, z] of offsets) if (!this.blocked(a.x + x, a.z + z)) { this.camera.position.set(a.x + x, 1.6, a.z + z); this.lookAt(a.clone().setY(1.5)); return true }
        return false
      },
      interact: () => { void this.interact() },
    }
    ;(window as Window & { __blueBloodTest?: typeof api }).__blueBloodTest = api
  }
}

try { new BlueBlood() } catch (err) {
  console.error('[blue-blood] Could not initialize', err)
  document.body.innerHTML = '<div class="error-box"><h1>蓝血</h1><p>画面暂时没有启动。请使用支持 WebGL 的浏览器，开启硬件加速后刷新。</p><button onclick="location.reload()">重新打开</button></div>'
}
