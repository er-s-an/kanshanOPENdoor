import * as THREE from 'three'
import { PS1Pipeline } from '../../engine/renderer'
import { buildConsortWorld } from './world'
import { getConsortPortalUrl, saveConsortShareCard, shareConsortShareCard } from './share-card'
import './style.css'

// 原作：重十八《端妃黑又壮》，本地开放文本 L1–177。
// 正史进程与新增的地块、等待及棋势示意分离；不生成后续或恋爱结局。
const portalUrl = getConsortPortalUrl()
const root = document.querySelector<HTMLDivElement>('#app')!
root.innerHTML = `
  <canvas id="scene" aria-label="景华宫三维庭院；使用 WASD 移动，拖动画面转身，E 交互"></canvas>
  <div class="hud locked" id="hud">
    <header class="topbar"><div class="brand"><span class="eyebrow">KANSHAN · A LIFE OF MY OWN</span><h1>端妃黑又壮</h1></div><nav class="header-actions"><button class="quiet" id="sound">声音 · 开</button><button class="quiet" id="restart">重新开始</button><a class="quiet portal-return" id="portal-return" href="${portalUrl}">返回任意门</a></nav></header>
    <section class="journal"><span class="meta" id="chapter">景华宫 · 初到</span><h2 id="objective" aria-live="polite">这是我的日子</h2><p id="objective-detail">先在这里安顿下来。</p><div class="progress" id="progress"></div><span class="meta" id="source">开放原文 L1–177</span><button class="quiet guide" id="guide" aria-label="朝向下一件事">朝向下一件事 ↗</button></section>
    <span class="crosshair" aria-hidden="true"></span>
    <div class="inventory"><small>手边的东西</small><span id="inventory">一只旧书箱</span></div>
    <div class="actionwrap"><span id="distance" aria-live="polite"></span><button class="interact" id="interact" disabled aria-label="按 E 与庭院里的物件互动"><kbd id="interact-key" aria-hidden="true">E</kbd><span id="interact-label">靠近庭院里的物件</span></button></div>
    <div class="controls" aria-live="polite"><span class="desktop-help">W A S D 移动 · 拖动画面转身<br>方向键 ← → 转身 · E 交互 / 继续</span><span class="touch-help"><strong>左下</strong> 按住方向盘移动<br><strong>右侧</strong> 向右拖动画面转身</span><span class="turn-touch-cue" id="turn-touch-cue" hidden>门在身后。在画面右侧向右拖动，回头看门口。</span></div>
    <div class="mobilepad" id="mobilepad" role="group" aria-label="左下移动方向盘"><button data-move="KeyW" aria-label="向前移动">↑</button><button data-move="KeyA" aria-label="向左移动">←</button><button data-move="KeyS" aria-label="向后移动">↓</button><button data-move="KeyD" aria-label="向右移动">→</button></div>
  </div>
  <div class="veil" id="cover"><section class="cover"><span class="meta">重十八 原著 · 可玩开放篇章</span><h2>景华宫的日子</h2><p class="tagline">我会种萝卜，怕啥？</p><p>院子大，也清净。先把人安顿好，再把地翻松。别人说她们的，我过我的日子。</p><p>走进一座能亲手改变的院子：安顿宫人、翻土播种，洗净手，再下一盘棋。</p><button class="primary" id="start">推门，过我的日子 →</button><p class="source-note">低清 3D 世界 · 清晰中文字幕<br>本篇依据现有开放文本 L1–177，结尾停在未完的话语。<br>地块操作与棋势图为游戏新增表达，不改写原文结果。</p></section></div>
  <section class="panel" id="dialog" hidden role="dialog" aria-modal="true" aria-labelledby="dialog-speaker"><div class="panel-top"><span class="speaker" id="dialog-speaker"></span><span class="meta" id="dialog-source"></span></div><p class="dialog-text" id="dialog-text"></p><div class="dialog-footer"><small id="dialog-position"></small><button class="primary" id="next" aria-label="按 E 或点击继续下一段">继续 · E</button></div></section>
  <section class="panel custom" id="custom" hidden role="dialog" aria-modal="true"></section>
  <div class="veil" id="ending" hidden><section class="cover"><span class="meta">开放篇章记录 · 不是小说结局</span><h2>日子，已经有了模样。</h2><ul class="endlist"><li>留下宫人，让合适的人做合适的事。</li><li>杂草清了，土翻松了，萝卜种子播下了。</li><li>听青杏把话说完，也照常安排了一顿加餐。</li><li>洗手下棋。先推棋认输，再承认已经赢了。</li></ul><p>萧寻笑过，谈起朝政时又露出倦意。</p><p>「御史参了朕一个时……」</p><p class="source-note">原文 L177 在「御史参了朕一个时」处截断。<br>没有补写后半句、皇帝感情、宫斗胜利或后续命运。</p><div class="ending-actions"><button class="primary" id="again">再过一次这样的日子</button><button class="quiet" id="save-card">保存记录卡</button><button class="quiet" id="share-card">分享记录卡</button><a class="quiet portal-return" id="ending-return" href="${portalUrl}">返回任意门</a></div><p class="share-status" id="ending-share-status" role="status" aria-live="polite"></p></section></div>`

const $ = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T
const canvas = $<HTMLCanvasElement>('scene')
const hud = $('hud')
const custom = $('custom')
const dialog = $('dialog')
const coarsePointer = window.matchMedia('(pointer: coarse)')
const usesTouchControls = () => coarsePointer.matches
let renderer: THREE.WebGLRenderer
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, powerPreference: 'high-performance' })
} catch {
  root.innerHTML = '<section class="error"><h1>这座院子暂时没能打开</h1><p>浏览器没有提供 WebGL。请使用支持 WebGL 的浏览器重新打开。</p><button onclick="location.reload()">重新打开</button></section>'
  throw new Error('End Consort requires WebGL')
}
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
renderer.setSize(innerWidth, innerHeight)
renderer.outputColorSpace = THREE.SRGBColorSpace
const scene = new THREE.Scene()
// 世界模块负责日光与普通空气透视；不叠加近视篇的失焦和惊悚系统。
const camera = new THREE.PerspectiveCamera(65, innerWidth / innerHeight, .05, 90)
camera.rotation.order = 'YXZ'
scene.add(camera)
const ps1 = new PS1Pipeline(renderer, scene)
ps1.setMyopia(0)
ps1.setSquint(0)
const world = buildConsortWorld(scene)
camera.position.copy(world.spawn)
camera.position.y = 1.65
let yaw = 0
let pitch = -.02

// 低模手部：深肤色保持不变，洗手只去除独立的土污网格。
const hands = new THREE.Group()
const skin = new THREE.MeshLambertMaterial({ color: 0x855a3c, flatShading: true })
const sleeve = new THREE.MeshLambertMaterial({ color: 0x646d45, flatShading: true })
for (const side of [-1, 1]) {
  const arm = new THREE.Mesh(new THREE.CylinderGeometry(.085, .13, .39, 5), sleeve)
  arm.position.set(side * .24, -.46, -.39)
  arm.rotation.z = side * -.33
  arm.rotation.x = -.65
  hands.add(arm)
  const hand = new THREE.Mesh(new THREE.IcosahedronGeometry(.092, 0), skin)
  hand.position.set(side * .19, -.31, -.52)
  hands.add(hand)
}
const dirt = new THREE.Group()
for (const side of [-1, 1]) {
  const patch = new THREE.Mesh(new THREE.BoxGeometry(.1, .025, .08), new THREE.MeshLambertMaterial({ color: 0x53482c }))
  patch.position.set(side * .19, -.25, -.53)
  patch.rotation.y = side * .3
  dirt.add(patch)
}
dirt.visible = false
hands.add(dirt)
const sickle = new THREE.Group()
const handle = new THREE.Mesh(new THREE.CylinderGeometry(.018, .023, .5, 5), new THREE.MeshLambertMaterial({ color: 0x765737 }))
handle.rotation.z = -.35
sickle.add(handle)
const blade = new THREE.Mesh(new THREE.TorusGeometry(.14, .016, 3, 10, Math.PI * 1.1), new THREE.MeshLambertMaterial({ color: 0xaab6a7 }))
blade.position.set(.07, .24, 0)
blade.rotation.z = -.4
sickle.add(blade)
sickle.position.set(.21, -.29, -.58)
sickle.visible = false
hands.add(sickle)
camera.add(hands)

// The world owns the one high-contrast destination marker. Keeping it with the
// courtyard prevents a second, low marker from competing with it at PS1 scale.
const leftoverWeed = new THREE.Group()
for (let i = 0; i < 4; i++) {
  const leaf = new THREE.Mesh(new THREE.ConeGeometry(.065, .4, 3), new THREE.MeshLambertMaterial({ color: 0x617642 }))
  leaf.rotation.z = (i - 1.5) * .28
  leftoverWeed.add(leaf)
}
leftoverWeed.position.copy(world.anchors.plot0)
leftoverWeed.position.y = .22
leftoverWeed.visible = false
scene.add(leftoverWeed)

type Phase = 'unpack' | 'settle' | 'fushun' | 'listen' | 'clear' | 'loosen' | 'sow' | 'defei' | 'weed' | 'comfort' | 'tool' | 'turn' | 'bow' | 'talk' | 'wash' | 'chess' | 'concede' | 'accept' | 'closing' | 'end'
const phases: Phase[] = ['unpack', 'settle', 'fushun', 'listen', 'clear', 'loosen', 'sow', 'defei', 'weed', 'comfort', 'tool', 'turn', 'bow', 'talk', 'wash', 'chess', 'concede', 'accept', 'closing', 'end']
const descriptions: Record<Phase, [string, string, string]> = {
  unpack: ['打开来时的行李', '书箱里的两本兵法和萝卜种子，唤起来时的记忆。', '原文回顾 L10–76'],
  settle: ['大，也清净', '走到门边，看看景华宫。这里可以有我的日子。', '原文 L78–90'],
  fushun: ['让福顺管账和库房', '他腿脚不便，便不让他跑远路。', '原文 L91'],
  listen: ['听青杏慢慢说完', '话说得慢，就耐心听。没有必要催。', '原文 L85、L92–93'],
  clear: ['先把杂草清出来', '三个工作面都要清理。走近金色标记，动手清草。', '原文 L89–95 · 地块操作为游戏新增'],
  loosen: ['把地翻松', '地松了，萝卜才有落脚的地方。', '原文 L94–95 · 地块操作为游戏新增'],
  sow: ['把萝卜种子播下去', '拿出从家里带来的种子。这里种下的只是种子。', '原文 L96–98'],
  defei: ['菜地边来了客人', '德妃带着人来了。先听她把话说完。', '原文 L104–115'],
  weed: ['低头，继续拔草', '她说她的。我的草还要拔。', '原文 L116–118'],
  comfort: ['听完她的安慰', '青杏眼睛红红的。等她说完，再说今晚加餐。', '原文 L119–123'],
  tool: ['今天，还要割草', '走到农具旁，挽起袖子拿起镰刀。', '原文 L125'],
  turn: ['回头看看来人', '先站在原地。拖动画面或按 ← →，等门口落进视线。', '原文 L126–134'],
  bow: ['放下镰刀，行礼', '是陛下。礼还是要行得端正。', '原文 L135–141'],
  talk: ['到石桌旁听他说', '石桌上放着残局，也放着我的兵法。', '原文 L142–154'],
  wash: ['先把手洗干净', '劳作的土还在手上。去水盆洗了，再坐下。', '原文 L152–155'],
  chess: ['慢慢落子', '坐到石桌前。看清棋势，再动手。', '原文 L156–160 · 棋势图为游戏新增'],
  concede: ['先推棋认输', '棋势已经占优。我却先说，臣妾输了。', '原文 L161–165'],
  accept: ['那臣妾赢了', '他点破了胜势。照实承认便是。', '原文 L166–172'],
  closing: ['听他把话说到这里', '他笑过，聊起朝政时，倦意又回来了。', '原文 L173–177'],
  end: ['开放篇章至此', '原文停在未完的话语，这里的日子暂时记到此处。', '开放原文 L177 · 句中截断'],
}
let phase: Phase = 'unpack'
let started = false
let busy = false
let ended = false
let muted = false
let audio: AudioContext | undefined
const plotState: (0 | 1 | 2 | 3)[] = [0, 0, 0]
const eventLog: { phase: Phase; action: string; source: string }[] = []
let handPulse = 0
let actorDestination: THREE.Vector3 | null = null
let emperorRoute: THREE.Vector3[] = []
let waitUntil = 0
let waitBegan = 0
let afterWait: (() => void) | undefined

function detailFor(current: Phase) {
  if (usesTouchControls() && current === 'turn') return '先站在原地。在画面右侧向右拖动，回头看门口。'
  return descriptions[current][1]
}
function updateInputCopy() {
  const touch = usesTouchControls()
  const selfTurn = phase === 'turn' || phase === 'bow'
  document.documentElement.classList.toggle('touch-ui', touch)
  canvas.setAttribute('aria-label', touch
    ? '景华宫三维庭院；使用左下方向盘移动，在画面右侧向右拖动视角；点按行动按钮互动'
    : '景华宫三维庭院；使用 WASD 移动，拖动画面转身，E 交互')
  $('interact-key').textContent = touch ? '行动' : 'E'
  $('next').textContent = touch ? '点按继续' : '继续 · E'
  $('next').setAttribute('aria-label', touch ? '点按继续下一段' : '按 E 或点击继续下一段')
  $('start').textContent = touch ? '点按推门，过我的日子 →' : '推门，过我的日子 →'
  $('again').textContent = touch ? '点按再过一次这样的日子' : '再过一次这样的日子'
  $('restart').setAttribute('aria-label', touch ? '点按重新开始本篇' : '重新开始本篇')
  const guide = $<HTMLButtonElement>('guide')
  guide.disabled = selfTurn
  guide.textContent = selfTurn ? '请亲自回头' : touch ? '看向下一件事 ↗' : '朝向下一件事 ↗'
  guide.setAttribute('aria-label', selfTurn ? '请亲自回头，不能由引导完成' : touch ? '点按看向下一件事' : '朝向下一件事')
  $('mobilepad').hidden = touch && phase === 'turn'
  $('turn-touch-cue').hidden = !touch || phase !== 'turn' || !started || busy || ended
}
function updateInteractAria(label: string, disabled = false) {
  const verb = usesTouchControls() ? '点按行动' : '按 E'
  $('interact').setAttribute('aria-label', disabled ? `${verb}按钮当前不可用：${label}` : `${verb}：${label}`)
}

function sound(kind: 'step' | 'soil' | 'water' | 'stone' | 'cloth' | 'ui' = 'ui') {
  if (muted || !audio) return
  if (audio.state === 'suspended') void audio.resume()
  const oscillator = audio.createOscillator()
  const gain = audio.createGain()
  const t = audio.currentTime
  const frequency = { step: 95, soil: 175, water: 940, stone: 560, cloth: 160, ui: 360 }[kind]
  oscillator.type = kind === 'water' || kind === 'ui' ? 'sine' : 'triangle'
  oscillator.frequency.setValueAtTime(frequency, t)
  oscillator.frequency.exponentialRampToValueAtTime(frequency * .55, t + .13)
  gain.gain.setValueAtTime(.0001, t)
  gain.gain.exponentialRampToValueAtTime(kind === 'step' ? .018 : .045, t + .008)
  gain.gain.exponentialRampToValueAtTime(.0001, t + .16)
  oscillator.connect(gain).connect(audio.destination)
  oscillator.start(t)
  oscillator.stop(t + .17)
}

function lock(value: boolean) {
  busy = value
  hud.classList.toggle('locked', value || !started || ended)
  keys.clear()
  if (value && document.pointerLockElement) document.exitPointerLock()
  updateInputCopy()
}
function setPhase(next: Phase) {
  phase = next
  const [title, , source] = descriptions[phase]
  $('objective').textContent = title
  $('objective-detail').textContent = detailFor(phase)
  $('source').textContent = source
  $('chapter').textContent = phases.indexOf(phase) < 7 ? '第一折 · 把日子安顿好' : phases.indexOf(phase) < 12 ? '第二折 · 她说她的' : '第三折 · 洗手落子'
  $('progress').innerHTML = phases.slice(0, -1).map((_, i) => `<i class="${i < phases.indexOf(phase) ? 'done' : ''}"></i>`).join('')
  eventLog.push({ phase, action: 'enter', source })
  updateInputCopy()
  sound()
}
function inventory(text: string) { $('inventory').textContent = text }
type Line = { speaker: string; text: string; source: string; kind?: '原文对白' | '剧情转述' | '我的心里' | '原文截断' }
const line = (speaker: string, text: string, source: string, kind: Line['kind'] = '原文对白'): Line => ({ speaker, text, source, kind })
let queue: Line[] = []
let lineIndex = 0
let afterDialogue: (() => void) | undefined
function say(lines: Line[], done: () => void) {
  custom.classList.remove('low-panel')
  custom.hidden = true
  lock(true)
  queue = lines
  lineIndex = 0
  afterDialogue = done
  dialog.hidden = false
  drawLine()
}
function drawLine() {
  const item = queue[lineIndex]
  $('dialog-speaker').textContent = item.speaker
  $('dialog-text').textContent = item.text
  $('dialog-source').textContent = `${item.kind} · ${item.source}`
  $('dialog-position').textContent = `${lineIndex + 1} / ${queue.length} · ${usesTouchControls() ? '点按继续' : '可按 E 继续'}`
  $('next').textContent = usesTouchControls() ? '点按继续' : '继续 · E'
  eventLog.push({ phase, action: `${item.speaker}: ${item.text}`, source: item.source })
}
function nextLine() {
  if (dialog.hidden) return
  sound('cloth')
  lineIndex++
  if (lineIndex < queue.length) return drawLine()
  dialog.hidden = true
  const callback = afterDialogue
  afterDialogue = undefined
  lock(false)
  callback?.()
}
function panel(html: string, placement: 'center' | 'low' = 'center') {
  dialog.hidden = true
  lock(true)
  custom.classList.toggle('low-panel', placement === 'low')
  custom.innerHTML = html
  custom.hidden = false
}
function closePanel() { custom.hidden = true; custom.classList.remove('low-panel'); lock(false) }

function unpack() {
  let books = false
  let seeds = false
  const render = () => {
    panel(`<span class="meta">来时的记忆 · 原文 L24–39</span><h2>书，和一包萝卜种子。</h2><p>祖母喜欢我这副能扛事儿的身板。跟着她下棋、读兵书、跑马，我觉得痛快。</p><div class="choices"><button class="choice ${books ? 'done' : ''}" id="pack-books"><strong>${books ? '✓ ' : ''}两本《孙子兵法》</strong><small>不是为了证明什么，只是兵书好看。</small></button><button class="choice ${seeds ? 'done' : ''}" id="pack-seeds"><strong>${seeds ? '✓ ' : ''}一大包萝卜种子</strong><small>我会种萝卜，怕啥？</small></button></div><p class="note">这段交互重现原文中的装箱回忆；眼前的庭院是如今的景华宫。</p><button class="primary" id="pack-done" ${books && seeds ? '' : 'disabled'}>收好，想起入宫那天 →</button>`)
    $('pack-books').onclick = () => { books = true; sound('cloth'); render() }
    $('pack-seeds').onclick = () => { seeds = true; sound('soil'); render() }
    $('pack-done').onclick = () => {
      if (!books || !seeds) return
      inventory('兵法两册 · 萝卜种子')
      say([
        line('童年', '我从小声音洪亮、身板结实。琴弦断过，教头夸我适合练武；祖母接纳我，我便读兵书、骑马。父亲说皇家粮食多，我带上书和种子，拍拍他的肩膀道别。', 'L10–39', '剧情转述'),
        line('选秀', '殿里站着三十余位秀女。我在最后一排，被脂粉味呛得连打三个喷嚏。行礼时姿态如松，太后正要撂牌子，萧寻却开口了。', 'L41–66', '剧情转述'),
        line('入宫', '萧寻说：“留。谢氏……端庄稳重，甚好。封端妃，居景华宫。”我谢恩起身，见他长出一口气——像放了个镇宅神兽进来辟邪。', 'L67–76', '剧情转述'),
      ], () => setPhase('settle'))
    }
  }
  render()
}

function assignFushun() {
  panel('<span class="meta">福顺 · 原文 L84、L91</span><h2>腿脚不便，就不跑远路。</h2><p>福顺左腿微跛，走路一高一低。把合适的活计放到他手边。</p><div class="choices"><button class="choice" id="give-ledger"><strong>把账本和库房交给福顺</strong><small>记账、管库房，用不着来回跑远路。</small></button><button class="choice" id="errand"><strong>看看远路差事</strong><small>先想一想，这适不适合他。</small></button></div><p class="note" id="assign-note">任务牌是游戏新增表达，安排依照原文。</p>')
  $('errand').onclick = () => { $('assign-note').textContent = '我不让他跑远路。把账本和库房交给他就好。'; sound('cloth') }
  $('give-ledger').onclick = () => {
    say([line('谢明珠', '福顺腿脚不好，我便不让他跑远路，让他帮我记账、管库房。', 'L91', '剧情转述')], () => setPhase('listen'))
  }
}

function listenToQingxing(comfort: boolean) {
  panel(`<span class="meta">青杏 · 原文 ${comfort ? 'L119–123' : 'L85、L92–93'}</span><h2>${comfort ? '等她把安慰说完。' : '慢一些，没有关系。'}</h2><p id="wait-speech">${comfort ? '「娘……娘娘，您别……」' : '青杏一紧张，话到嘴边便断断续续。'}</p><div class="wait-meter" aria-hidden="true"><i id="wait-fill"></i></div><p class="note">耐心听完，不催。等待操作为游戏新增表达。</p><button class="primary" id="wait-done" disabled>听她慢慢说完…</button>`, 'low')
  waitBegan = performance.now()
  waitUntil = waitBegan + 2600
  afterWait = () => {
    $('wait-speech').textContent = comfort ? '「娘……娘娘，您别……别难过。」' : '我安静地等着，听她把话说完。'
    const btn = $<HTMLButtonElement>('wait-done')
    btn.disabled = false
    btn.textContent = comfort ? '难过什么？今晚加餐。' : '听完了，再安排清地。'
    btn.onclick = () => {
      if (comfort) {
        say([line('谢明珠', '难过什么？今晚加餐，吃红烧肉。', 'L121'), line('我的心里', '难过？那是最没用的情绪。', 'L122–123', '我的心里')], () => setPhase('tool'))
      } else {
        say([line('我的心里', '不是施恩，只是觉得人活着不容易，没必要折腾。', 'L93', '我的心里')], () => {
          world.moveActor('qingxing', 'qingxingRest')
          setPhase('clear')
        })
      }
    }
  }
}

function workPlot(index: number) {
  const desired: 1 | 2 | 3 = phase === 'clear' ? 1 : phase === 'loosen' ? 2 : 3
  if (plotState[index] !== desired - 1) return
  plotState[index] = desired
  world.setPlot(index, desired)
  handPulse = .6
  dirt.visible = true
  sound('soil')
  eventLog.push({ phase, action: `plot${index}: ${desired}`, source: 'L94–98 · 游戏新增地块表达' })
  if (!plotState.every(value => value === desired)) return
  if (desired === 1) setPhase('loosen')
  else if (desired === 2) {
    say([line('时光过渡', '没过半个月，景华宫变了样。杂草没了，地翻松了。', 'L94–95', '剧情转述')], () => setPhase('sow'))
  } else {
    inventory('兵法两册 · 种子已经播下')
    say([
      line('谢明珠', '我把带来的萝卜种子撒了下去。看着黑黝黝的土地，心里特别踏实。', 'L96–98', '剧情转述'),
      line('我的日子', '我不去给太后请安，也不去御花园争奇斗艳。就在景华宫，日出而作，日落而息。后宫里，自然也有风言风语。', 'L99–103', '剧情转述'),
    ], () => { world.setActorVisible('defei', true); setPhase('defei') })
  }
}

const whiteStones = new Set([3 * 7 + 2, 3 * 7 + 3, 3 * 7 + 4])
const initialBlack = [2 * 7 + 3, 2 * 7 + 4, 4 * 7 + 2, 4 * 7 + 4, 3 * 7 + 1]
const chessMoves = [2 * 7 + 2, 4 * 7 + 3, 3 * 7 + 5]
let chessStep = 0
function drawChess() {
  const black = new Set([...initialBlack, ...chessMoves.slice(0, chessStep)])
  const labels = ['连接上方的棋势', '收住下方的空隙', '收束白子右侧的空间']
  const touchBoard = usesTouchControls()
  const cell = (index: number) => {
    const state = whiteStones.has(index) ? 'white' : black.has(index) ? 'black' : index === chessMoves[chessStep] ? 'target' : ''
    if (touchBoard) return `<span class="${state}" aria-hidden="true"></span>`
    const label = `${Math.floor(index / 7) + 1}行${index % 7 + 1}列${whiteStones.has(index) ? '白子' : black.has(index) ? '黑子' : index === chessMoves[chessStep] ? '可落子提示' : '空位'}`
    return `<button class="${state}" data-cell="${index}" aria-label="${label}" ${whiteStones.has(index) || black.has(index) || chessStep === 3 ? 'disabled' : ''}></button>`
  }
  const boardLabel = touchBoard
    ? `游戏新增七乘七棋势示意图；${chessStep === 3 ? '我已经占据胜势，请点按下方行动按钮推棋认输。' : '亮圈提示下一手，请点按下方行动按钮落子。'}`
    : '游戏新增七乘七棋势示意图'
  panel(`<span class="meta">石桌 · 原文 L156–160</span><h2>${chessStep < 3 ? labels[chessStep] : '白子已经四面楚歌。'}</h2><p>他落子很快，我落子慢一些。时间一点点过去，棋势也渐渐变了。</p><div class="board ${touchBoard ? 'touch-board' : ''}" id="board" role="${touchBoard ? 'img' : 'group'}" aria-label="${boardLabel}">${Array.from({ length: 49 }, (_, index) => cell(index)).join('')}</div><div class="board-progress">${chessStep} / 3 段棋势 · ${chessStep === 0 ? '一刻钟前后' : chessStep === 1 ? '一刻钟后' : chessStep === 2 ? '两刻钟后' : '三刻钟后'}</div><p class="board-caption" id="board-message">${chessStep === 3 ? '我已经占据胜势。接下来，我先推棋认输。' : touchBoard ? '点按下方行动按钮落子。' : '点击亮圈落子。也可以直接看这一手的演示。'}</p><p class="note">游戏新增：这是棋势可视化练习，并非原作棋谱或完整围棋规则。原文胜势与随后认输的顺序固定。</p><button class="primary" id="chess-assist">${chessStep === 3 ? (touchBoard ? '点按推棋：臣妾输了。' : '推棋：臣妾输了。') : touchBoard ? '点按落下这一手 →' : '看这一手如何落下 →'}</button>`)
  const place = () => {
    if (chessStep >= 3) return concede()
    chessStep++
    sound('stone')
    eventLog.push({ phase, action: `chessMove${chessStep}`, source: 'L156–160 · 游戏新增棋势图' })
    drawChess()
  }
  if (!touchBoard) custom.querySelectorAll<HTMLButtonElement>('[data-cell]').forEach(button => {
    button.onclick = () => {
      if (Number(button.dataset.cell) !== chessMoves[chessStep]) {
        $('board-message').textContent = '先看亮圈：这一手连接已经形成的棋势。可点演示帮助。'
        return
      }
      place()
    }
  })
  $('chess-assist').onclick = place
}

function concede() {
  setPhase('concede')
  say([
    line('谢明珠', '臣妾输了。', 'L161–162'),
    line('萧寻', '你没输。', 'L163'),
    line('谢明珠', '臣妾输了。陛下英明神武，棋艺超群。', 'L164'),
    line('萧寻', '……你再这样，是欺君。', 'L165'),
  ], () => {
    setPhase('accept')
    panel('<span class="meta">原文对白 · L166</span><h2>那就照实说。</h2><p>胜势本来就在我这边。既然陛下已经点破，便承认。</p><button class="primary" id="accept-win">那臣妾赢了。</button>')
    $('accept-win').onclick = () => {
      say([
        line('谢明珠', '那臣妾赢了。', 'L166'),
        line('石桌旁', '他看了我半晌，忽然笑了。不是帝王的矜持微笑，是真的被逗乐了。眉眼舒展，倦意散了几分。', 'L168–170', '剧情转述'),
        line('萧寻', '你倒是有意思。', 'L171'),
        line('谢明珠', '陛下谬赞。', 'L172'),
      ], () => setPhase('closing'))
    }
  })
}

function ending() {
  setPhase('end')
  ended = true
  lock(true)
  dialog.hidden = true
  custom.hidden = true
  $('ending').hidden = false
  world.setGoalMarker(null)
  $('again').focus()
}

type Target = { id: string; position: THREE.Vector3; label: string; radius: number }
function targets(): Target[] {
  const target = (id: string, label: string, radius = 1.75): Target => ({ id, position: world.anchors[id], label, radius })
  // 回头与随后行礼都在割草处完成，不能先走到门口、提前看见来人。
  if (phase === 'turn' || phase === 'bow') return [{ id: 'gate', position: camera.position.clone(), label: phase === 'turn' ? '原地回头，看向门口' : '放下镰刀，原地行礼', radius: .2 }]
  if (phase === 'clear' || phase === 'loosen' || phase === 'sow') {
    const expected = phase === 'clear' ? 0 : phase === 'loosen' ? 1 : 2
    const verb = phase === 'clear' ? '清掉杂草' : phase === 'loosen' ? '把土翻松' : '撒下萝卜种子'
    return plotState.flatMap((value, i) => value === expected ? [target(`plot${i}`, `${verb} · ${i + 1}号地`, 2.0)] : [])
  }
  const single: Partial<Record<Phase, [string, string, number?]>> = {
    unpack: ['trunk', '打开书箱'], settle: ['gate', '看看我的景华宫', 2.2], fushun: ['fushun', '把账库交给福顺'], listen: ['qingxing', '耐心听青杏说话'],
    defei: ['defei', '听德妃把话说完'], weed: ['plot0', '低头，继续拔草', 2.0], comfort: ['qingxing', '听青杏的安慰'], tool: ['tool', '拿起镰刀，继续割草'],
    turn: ['gate', '回头看向门口', 3.0], bow: ['gate', '放下镰刀，行礼', 3.0], talk: ['chess', '走到石桌旁', 2.2], wash: ['basin', '先洗手'], chess: ['chess', '坐下，慢慢落子', 2.2], closing: ['chess', '继续听他说', 2.2],
  }
  const item = single[phase]
  return item ? [target(item[0], item[1], item[2])] : []
}
const horizontal = (a: THREE.Vector3, b: THREE.Vector3) => Math.hypot(a.x - b.x, a.z - b.z)
function nearest(): Target | undefined {
  return targets().sort((a, b) => horizontal(a.position, camera.position) - horizontal(b.position, camera.position))[0]
}
function face(point: THREE.Vector3) {
  yaw = Math.atan2(-(point.x - camera.position.x), -(point.z - camera.position.z))
  pitch = -.05
}

// 回头这一拍不能由 E 或引导按钮替玩家完成：要让门口真的进入镜头。
const turnRevealTolerance = THREE.MathUtils.degToRad(24)
function gateHeadingError() {
  const gate = world.anchors.gate
  const desiredYaw = Math.atan2(-(gate.x - camera.position.x), -(gate.z - camera.position.z))
  return Math.abs(Math.atan2(Math.sin(desiredYaw - yaw), Math.cos(desiredYaw - yaw)))
}
function isFacingGate() { return gateHeadingError() <= turnRevealTolerance }
function revealEmperorAtGate() {
  // 门已经在背后打开；只有玩家真的回头，来人才进入镜头。
  world.setActorVisible('emperor', true)
}

function interact() {
  if (!dialog.hidden) return nextLine()
  if (!started || busy || ended) return
  if (phase === 'talk' && actorDestination) return
  const target = nearest()
  if (!target || horizontal(target.position, camera.position) > target.radius) return
  eventLog.push({ phase, action: target.id, source: descriptions[phase][2] })
  if (phase === 'unpack') return unpack()
  if (phase === 'settle') {
    // 看景华宫时回望院内，先让“大，而且清净”成为镜头里的空间，而非南门门板。
    face(new THREE.Vector3(0, camera.position.y, 1.25))
    return say([
      line('谢明珠', '景华宫在最西北角，墙皮剥落了一半，院里的草比人高。但它大，而且清净。', 'L78–82', '剧情转述'),
      line('谢明珠', '分来的宫人站在院里，瑟瑟发抖。领头的福顺左腿微跛，青杏一紧张就结巴。', 'L83–87', '剧情转述'),
      line('谢明珠', '行。那就留下吧。把这儿清理出来。我有用。', 'L88–90'),
    ], () => setPhase('fushun'))
  }
  if (phase === 'fushun') return assignFushun()
  if (phase === 'listen') return listenToQingxing(false)
  if (phase === 'clear' || phase === 'loosen' || phase === 'sow') return workPlot(Number(target.id.slice(-1)))
  if (phase === 'defei') return say([
    line('来客', '德妃带着一群人来了。我穿着布衣，蹲在地里。她用帕子捂着鼻子。', 'L104–106', '剧情转述'),
    line('德妃', '哟，端妃姐姐这是在做什么？好大一股子土腥味。', 'L105–107'),
    line('谢明珠', '种菜。', 'L108'),
    line('德妃', '姐姐真是好雅兴。听说陛下还没翻过姐姐的牌子？也是，姐姐这身板，怕是陛下消受不起。', 'L109'),
    line('谢明珠', '妹妹说得对。', 'L112–114'),
    line('来客', '我诚恳地点头。德妃一拳打在棉花上，脸都绿了。', 'L114–115', '剧情转述'),
    line('德妃', '疯子，白瞎了这江南谢氏的出身。', 'L116'),
    line('来客', '她骂了一句，转身走了。', 'L117', '剧情转述'),
  ], () => { world.setActorVisible('defei', false); leftoverWeed.visible = true; setPhase('weed') })
  if (phase === 'weed') {
    leftoverWeed.visible = false
    handPulse = .5
    sound('soil')
    // 青杏是在我继续拔草后主动凑过来的，不让玩家横穿庭院去找她。
    world.moveActor('qingxing', new THREE.Vector3(world.anchors.plot0.x + 1.35, 0, world.anchors.plot0.z + .3))
    return say([
      line('谢明珠', '我没看她的背影，低头继续拔草。', 'L118', '剧情转述'),
    ], () => setPhase('comfort'))
  }
  if (phase === 'comfort') return listenToQingxing(true)
  if (phase === 'tool') {
    sickle.visible = true
    inventory('镰刀 · 劳作后的手')
    face(new THREE.Vector3(camera.position.x * 2 - world.anchors.gate.x, 0, camera.position.z * 2 - world.anchors.gate.z))
    pitch = -.35
    // 原文先是门被推开，主角却仍背对门口把来人误认成福顺。
    world.setGateOpen(true)
    return say([
      line('景华宫', '我挽着袖子，拿着镰刀。门被推开，我以为是福顺回来了，头也没回。', 'L125–127', '剧情转述'),
      line('谢明珠', '粪挑回来了？堆墙角就行。', 'L128'),
      line('身后', '一片死寂。我直觉不对。', 'L128–129', '剧情转述'),
    ], () => {
      world.actors.emperor.position.set(world.anchors.gate.x + .45, 0, world.anchors.gate.z - .6)
      setPhase('turn')
    })
  }
  if (phase === 'turn') {
    if (!isFacingGate()) return
    revealEmperorAtGate()
    return say([
      line('谢明珠', '回头一看，萧寻站在门口，一身明黄常服，脸色黑得像锅底。我把陛下当成了挑粪的太监。', 'L129–134', '剧情转述'),
    ], () => setPhase('bow'))
  }
  if (phase === 'bow') {
    sickle.visible = false
    handPulse = .5
    sound('cloth')
    inventory('手上的泥土 · 石桌上的兵法')
    return say([
      line('谢明珠', '臣妾参见陛下。', 'L135–137'),
      line('萧寻', '爱妃这是……', 'L138–139'),
      line('谢明珠', '割草。', 'L140'),
      line('萧寻', '起来吧。', 'L141'),
    ], () => {
      // 绕东侧走廊到北侧石凳，避免直线穿过水盆或站进棋桌。
      emperorRoute = [new THREE.Vector3(7, 0, -5.8), new THREE.Vector3(4.3, 0, -5.13)]
      actorDestination = new THREE.Vector3(7, 0, 6.5)
      setPhase('talk')
    })
  }
  if (phase === 'talk') return say([
    line('萧寻', '这地方……倒是清净。', 'L142–143'),
    line('石桌边', '他坐在石桌旁。这里放着一盘残局，还有一本翻开的《孙子兵法》。', 'L144–145', '剧情转述'),
    line('萧寻', '你看得懂？', 'L146'),
    line('谢明珠', '勉强能看懂几成。', 'L147'),
    line('萧寻', '你祖母是林家的人？', 'L148'),
    line('谢明珠', '陛下知道？', 'L149'),
    line('萧寻', '林老将军威名赫赫，当年北征大捷，朕还是皇子时便听过。', 'L150'),
    line('萧寻', '陪朕下盘棋。', 'L151'),
    line('谢明珠', '臣妾手脏。', 'L152'),
    line('萧寻', '朕不嫌弃。', 'L153'),
  ], () => setPhase('wash'))
  if (phase === 'wash') {
    dirt.visible = false
    handPulse = .75
    sound('water')
    inventory('洗净的双手 · 兵法还在桌边')
    return say([line('谢明珠', '我去洗了手，坐在他对面。', 'L155', '剧情转述')], () => setPhase('chess'))
  }
  if (phase === 'chess') {
    face(world.anchors.chess)
    return drawChess()
  }
  if (phase === 'closing') return say([
    line('萧寻', '你出生江南谢氏，父亲是当朝大理寺卿，母家又是将门之后，你又这么……', 'L173'),
    line('石桌边', '他瞥我一眼，轻咳一声，跳过了些我听惯了的词句。', 'L174', '剧情转述'),
    line('萧寻', '朕到景华宫来，总不能再是宠信佞臣，不顾朝政了吧。', 'L175'),
    line('石桌边', '他自言自语。刚刚舒展的倦意，聊着聊着又重新上了眉头。', 'L176', '剧情转述'),
    line('萧寻', '「御史参了朕一个时', 'L177 · 此处原文截断', '原文截断'),
  ], ending)
}

const keys = new Set<string>()
let pointer: { x: number; y: number; id: number } | null = null
window.addEventListener('keydown', event => {
  if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'KeyE'].includes(event.code)) event.preventDefault()
  if (event.code === 'KeyE' && !event.repeat) interact()
  if (!busy && started && !ended) keys.add(event.code)
})
window.addEventListener('keyup', event => keys.delete(event.code))
window.addEventListener('blur', () => { keys.clear(); pointer = null })
document.addEventListener('visibilitychange', () => { if (document.hidden) keys.clear() })
canvas.addEventListener('pointerdown', event => {
  if (busy || !started || ended) return
  pointer = { x: event.clientX, y: event.clientY, id: event.pointerId }
  canvas.setPointerCapture(event.pointerId)
})
canvas.addEventListener('pointermove', event => {
  if (!pointer || event.pointerId !== pointer.id || busy) return
  yaw -= (event.clientX - pointer.x) * (usesTouchControls() ? .01 : .005)
  pitch = THREE.MathUtils.clamp(pitch - (event.clientY - pointer.y) * .004, -.75, .65)
  pointer.x = event.clientX
  pointer.y = event.clientY
})
canvas.addEventListener('pointerup', () => { pointer = null })
canvas.addEventListener('pointercancel', () => { pointer = null })
canvas.addEventListener('contextmenu', event => event.preventDefault())
document.querySelectorAll<HTMLButtonElement>('[data-move]').forEach(button => {
  button.onpointerdown = event => {
    event.preventDefault()
    if (busy || !started) return
    keys.add(button.dataset.move!)
    button.setPointerCapture(event.pointerId)
  }
  const release = () => keys.delete(button.dataset.move!)
  button.onpointerup = release
  button.onpointercancel = release
  button.onpointerleave = release
  button.onlostpointercapture = release
})
$('next').onclick = nextLine
$('interact').onclick = interact
$('guide').onclick = () => { if (!busy && phase !== 'turn' && phase !== 'bow') { const target = nearest(); if (target) face(target.position) } }
$('start').onclick = () => {
  started = true
  $('cover').hidden = true
  try { audio = new AudioContext(); void audio.resume() } catch { muted = true; $('sound').textContent = '声音 · 不可用' }
  lock(false)
  setPhase('unpack')
  const first = nearest(); if (first) face(first.position)
}
$('restart').onclick = () => location.reload()
$('again').onclick = () => location.reload()
$<HTMLButtonElement>('save-card').onclick = async () => {
  const button = $<HTMLButtonElement>('save-card')
  const status = $('ending-share-status')
  button.disabled = true
  try {
    await saveConsortShareCard()
    status.textContent = '记录卡已保存。'
    button.textContent = '记录卡已保存'
  } catch {
    status.textContent = '保存失败，请再试一次。'
    button.textContent = '保存失败，请重试'
  } finally {
    window.setTimeout(() => { button.disabled = false; button.textContent = '保存记录卡' }, 1_800)
  }
}
$<HTMLButtonElement>('share-card').onclick = async () => {
  const button = $<HTMLButtonElement>('share-card')
  const status = $('ending-share-status')
  button.disabled = true
  try {
    const result = await shareConsortShareCard()
    if (result === 'saved') {
      status.textContent = '此浏览器没有分享面板，记录卡已保存，可手动分享。'
      button.textContent = '图片已保存'
    } else {
      status.textContent = '分享面板已打开。'
      button.textContent = '分享面板已打开'
    }
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      status.textContent = '已取消分享。'
      button.textContent = '已取消分享'
    } else {
      status.textContent = '分享失败，请保存记录卡后手动分享。'
      button.textContent = '分享失败，请保存图片'
    }
  } finally {
    window.setTimeout(() => { button.disabled = false; button.textContent = '分享记录卡' }, 1_800)
  }
}
$('sound').onclick = () => { muted = !muted; $('sound').textContent = `声音 · ${muted ? '关' : '开'}`; if (!muted) sound() }
coarsePointer.addEventListener('change', updateInputCopy)
updateInputCopy()

function blocked(x: number, z: number): boolean {
  const radius = .24
  return world.colliders.some(box => box.max.y > .3 && box.min.y < 1.8 && x + radius > box.min.x && x - radius < box.max.x && z + radius > box.min.z && z - radius < box.max.z)
}
let previous = performance.now()
let stepTime = 0
let elapsed = 0
let displayedGoalMarker: string | null = null
function frame(now: number) {
  requestAnimationFrame(frame)
  const dt = Math.min((now - previous) / 1000, .05)
  previous = now
  elapsed += dt
  if (started && !busy && !ended) {
    if (keys.has('ArrowLeft')) yaw += dt * 1.6
    if (keys.has('ArrowRight')) yaw -= dt * 1.6
    // 听见门口死寂后只能原地回头；鼠标和左右方向键仍可转镜头。
    const canWalk = phase !== 'turn'
    const forward = canWalk ? Number(keys.has('KeyW') || keys.has('ArrowUp')) - Number(keys.has('KeyS') || keys.has('ArrowDown')) : 0
    const side = canWalk ? Number(keys.has('KeyD')) - Number(keys.has('KeyA')) : 0
    const length = Math.hypot(forward, side) || 1
    const speed = 2.65 * dt / length
    const dx = (-Math.sin(yaw) * forward + Math.cos(yaw) * side) * speed
    const dz = (-Math.cos(yaw) * forward - Math.sin(yaw) * side) * speed
    if (!blocked(camera.position.x + dx, camera.position.z)) camera.position.x += dx
    if (!blocked(camera.position.x, camera.position.z + dz)) camera.position.z += dz
    if (forward || side) { stepTime += dt; if (stepTime > .5) { sound('step'); stepTime = 0 } }
  }
  camera.rotation.set(pitch, yaw, 0)
  if (actorDestination) {
    const actor = world.actors.emperor
    const delta = actorDestination.clone().sub(actor.position)
    if (delta.length() < .07) {
      actor.position.copy(actorDestination)
      actorDestination = emperorRoute.shift() || null
      if (!actorDestination && !actor.userData.seated) {
        // 程序人偶的闭合长袍形成坐姿：上身下降，袍摆收拢，脚留在地上。
        actor.children.forEach(part => {
          if (!(part instanceof THREE.Mesh) || part.geometry.type === 'CircleGeometry') return
          if (part.position.y > .72) part.position.y -= .28
          else if (part.geometry.type === 'CylinderGeometry' && part.position.y > .3 && part.position.y < .7) { part.scale.y *= .65; part.position.y = .4 }
          else if (part.geometry.type === 'BoxGeometry' && part.position.y < .15) part.position.z += .22
        })
        actor.userData.seated = true
      }
    }
    else { actor.position.addScaledVector(delta.normalize(), dt * 1.9); actor.rotation.y = Math.atan2(delta.x, delta.z) }
  }
  const emperor = world.actors.emperor
  if (emperor.visible && !actorDestination && (phase === 'talk' || phase === 'wash' || phase === 'chess' || phase === 'closing')) emperor.rotation.y = Math.atan2(camera.position.x - emperor.position.x, camera.position.z - emperor.position.z)
  if (waitUntil > 0) {
    const fill = $('wait-fill')
    if (fill) fill.style.width = `${Math.min(100, ((now - waitBegan) / (waitUntil - waitBegan)) * 100)}%`
    if (now >= waitUntil) { waitUntil = 0; const callback = afterWait; afterWait = undefined; callback?.() }
  }
  handPulse = Math.max(0, handPulse - dt)
  hands.position.y = handPulse > 0 ? Math.sin(handPulse * 12) * .025 : 0
  hands.visible = started && !ended
  const target = nearest()
  const markerTarget = target && started && !busy && !ended && phase !== 'turn' && phase !== 'bow' ? target.id : null
  if (markerTarget !== displayedGoalMarker) {
    world.setGoalMarker(markerTarget)
    displayedGoalMarker = markerTarget
  }
  if (target) {
    const distance = horizontal(target.position, camera.position)
    const readyToReveal = phase === 'turn' && isFacingGate()
    $<HTMLButtonElement>('interact').disabled = distance > target.radius || busy || (phase === 'talk' && !!actorDestination) || (phase === 'turn' && !readyToReveal)
    const label = phase === 'turn'
      ? (readyToReveal ? '看清门口的来人' : usesTouchControls() ? '在右侧向右拖动回头' : '转身看向门口')
      : target.label
    $('interact-label').textContent = label
    $('distance').textContent = phase === 'turn'
      ? (readyToReveal
        ? (usesTouchControls() ? '门口已在视线里 · 点按行动' : '门口已在视线里 · 按 E')
        : (usesTouchControls() ? '门在身后 · 在右侧向右拖动回头' : '门在身后 · 拖动 / ← → 回头'))
      : phase === 'bow' ? '就在这里，端正行礼' : phase === 'talk' && actorDestination && distance <= target.radius ? '等陛下走到石桌旁' : distance <= target.radius ? '就在手边' : `${distance.toFixed(1)} 米 · 靠近金色标记`
    updateInteractAria(label, $<HTMLButtonElement>('interact').disabled)
  } else {
    $<HTMLButtonElement>('interact').disabled = true
    $('distance').textContent = ''
    updateInteractAria('靠近庭院里的物件', true)
  }
  if (phase === 'clear' || phase === 'loosen' || phase === 'sow') {
    const expected = phase === 'clear' ? 1 : phase === 'loosen' ? 2 : 3
    $('objective-detail').textContent = `${descriptions[phase][1]} 已完成 ${plotState.filter(value => value === expected).length} / 3。`
  }
  ps1.render(dt, camera)
}
requestAnimationFrame(frame)
window.addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight
  camera.updateProjectionMatrix()
  renderer.setSize(innerWidth, innerHeight)
})

// 开发环境只读快照，辅助真实浏览器验收。没有跳关、自动胜利或生产包测试入口。
if ((import.meta as unknown as { env: { DEV: boolean } }).env.DEV) {
  Object.defineProperty(window, '__consortSnapshot', { value: () => ({ phase, busy, started, ended, plotState: [...plotState], chessStep, handsClean: !dirt.visible, position: camera.position.toArray(), yaw, pitch, actorsVisible: { emperor: world.actors.emperor.visible, defei: world.actors.defei.visible }, target: nearest() ? { id: nearest()!.id, position: nearest()!.position.toArray(), radius: nearest()!.radius } : null, events: eventLog.map(event => ({ ...event })) }), configurable: true })
}
