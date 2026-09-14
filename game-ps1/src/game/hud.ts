// ============================================================================
// DOM HUD 层：惊悚值条 / 字幕（say）/ 系统横幅（sys）/ 选项弹窗（prompt）/
// 准星 / 交互提示 / 中央渐黑层 / 结局页。
// 全中文；复古衬线 + 文字阴影 + 扫描线；不加载任何外部字体文件。
// ============================================================================

import { copyMyopiaShareLink, returnToMyopiaPortal, saveMyopiaShareCard, shareMyopiaShareCard } from './share-card'

export interface EndingView {
  id: string
  title: string
  subtitle: string
  tone: 'good' | 'bad' | 'secret'
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

const STYLE = `
#hud { position: fixed; inset: 0; pointer-events: none; z-index: 20; overflow: hidden;
  font-family: "Songti SC","STSong","STZhongsong","SimSun",serif; color: #e8e0d0; }
#hud * { box-sizing: border-box; }
.hud-scan { position:absolute; inset:0; pointer-events:none; opacity:.16;
  background: repeating-linear-gradient(0deg, rgba(0,0,0,.9) 0 1px, transparent 1px 3px); }

.hud-fade { position:absolute; inset:0; background:#000; opacity:1; }

.hud-pulse { position:absolute; inset:0; pointer-events:none; opacity:0;
  box-shadow: inset 0 0 150px rgba(200,20,20,.6); }
.hud-pulse.on { animation: hudRedPulse 1s infinite; }
@keyframes hudRedPulse { 0%,100% { opacity:.45; } 50% { opacity:1; } }

.hud-fear { position:absolute; top:18px; right:20px; width:190px; }
.hud-fear .flabel { font-size:13px; letter-spacing:4px; color:#c9bfa8;
  text-shadow:1px 1px 0 #000; margin-bottom:4px; text-align:right; }
.hud-fear .fbar { height:12px; border:2px solid #8a8272; background:rgba(10,8,8,.78);
  box-shadow:2px 2px 0 rgba(0,0,0,.6); }
.hud-fear .ffill { height:100%; width:0%; background:linear-gradient(90deg,#4d1818,#a03030);
  transition: width .25s steps(6); }
.hud-fear.high .fbar { border-color:#e03a3a; animation: hudBarPulse .8s infinite; }
.hud-fear.high .flabel { color:#ff7070; }
@keyframes hudBarPulse { 0%,100% { box-shadow:2px 2px 0 rgba(0,0,0,.6); }
  50% { box-shadow:2px 2px 0 rgba(0,0,0,.6), 0 0 18px rgba(255,40,40,.9); } }

.hud-cross { position:absolute; left:50%; top:50%; width:4px; height:4px; margin:-2px 0 0 -2px;
  background:#ddd; box-shadow:0 0 0 1px #000, 0 0 6px rgba(255,255,255,.4); }

.hud-interact { position:absolute; left:50%; bottom:22%; transform:translateX(-50%);
  font-size:17px; letter-spacing:2px; color:#ffe9b0; display:none;
  text-shadow:1px 1px 0 #000, 0 0 10px rgba(0,0,0,.9); }
.hud-interact.on { display:block; }

.hud-toast { position:absolute; left:50%; bottom:32%; transform:translateX(-50%);
  font-size:15px; letter-spacing:2px; color:#ffb9a0; opacity:0; transition:opacity .2s;
  text-shadow:1px 1px 0 #000, 0 0 8px rgba(0,0,0,.9); }
.hud-toast.on { opacity:1; }

.hud-sub { position:absolute; left:50%; bottom:7%; transform:translateX(-50%);
  width:min(760px,86vw); display:none; text-align:center; cursor:pointer; pointer-events:auto; }
.hud-sub.on { display:block; }
.hud-sub .sname { display:inline-block; font-size:14px; letter-spacing:3px; color:#14100c;
  background:#d8cba8; padding:1px 12px; margin-bottom:6px; box-shadow:2px 2px 0 #000; }
.hud-sub .stext { font-size:19px; line-height:1.75; color:#f2ead6;
  text-shadow:2px 2px 0 #000, 0 0 10px rgba(0,0,0,.9);
  background:rgba(8,6,10,.66); padding:8px 16px; border:1px solid rgba(160,150,120,.35); }

.hud-sys { position:absolute; left:50%; top:24%; transform:translateX(-50%);
  width:min(840px,90vw); display:none; text-align:center; cursor:pointer; pointer-events:auto; }
.hud-sys.on { display:block; }
.hud-sys .sline { font-size:clamp(22px,3.2vw,34px); line-height:1.9; letter-spacing:6px;
  color:#dfe6df; text-shadow:2px 2px 0 #000, 0 0 18px rgba(120,200,160,.25); font-weight:700; }

.hud-pmask { position:fixed; inset:0; background:rgba(0,0,0,.55); z-index:30;
  display:flex; align-items:center; justify-content:center; pointer-events:auto; }
.hud-pbox { min-width:min(540px,88vw); background:rgba(12,10,12,.94); border:2px solid #8a8272;
  box-shadow:4px 4px 0 #000; padding:22px 26px; }
.hud-pbox .ptitle { font-size:17px; letter-spacing:4px; color:#c9bfa8;
  text-shadow:1px 1px 0 #000; margin-bottom:14px; }
.hud-pbox .opt { display:block; width:100%; text-align:left; margin:8px 0; padding:10px 14px;
  font-size:17px; letter-spacing:1px; font-family:inherit; color:#e8e0d0; cursor:pointer;
  background:rgba(40,34,34,.6); border:1px solid #6a6255; }
.hud-pbox .opt:hover { background:#d8cba8; color:#14100c; }
.hud-pbox .opt .num { color:#a08c5a; margin-right:10px; font-family:"Courier New",monospace; }
.hud-pbox .opt:hover .num { color:#5a4a20; }

.hud-ending { position:fixed; inset:0; z-index:40; display:flex; flex-direction:column;
  align-items:center; justify-content:center; text-align:center; pointer-events:auto;
  opacity:0; transition:opacity 1.6s ease; padding:24px; }
.hud-ending.on { opacity:1; }
.hud-ending.good { background:radial-gradient(ellipse at 50% 38%, #33261a 0%, #14100b 72%); color:#f3e3c0; }
.hud-ending.bad { background:radial-gradient(ellipse at 50% 38%, #3d0808 0%, #120202 72%); color:#ffc9c9; }
.hud-ending.secret { background:radial-gradient(ellipse at 50% 38%, #0e2030 0%, #05090f 72%); color:#cfe8ff; }
.hud-ending .etag { font-size:14px; letter-spacing:8px; opacity:.7; margin-bottom:18px; }
.hud-ending .etitle { font-size:clamp(36px,7vw,72px); letter-spacing:10px; font-weight:700;
  margin-bottom:26px; text-shadow:3px 3px 0 rgba(0,0,0,.85); }
.hud-ending.good .etitle { color:#ffd98a; }
.hud-ending.bad .etitle { color:#ff4d4d; }
.hud-ending.secret .etitle { color:#8fd0ff; }
.hud-ending .esub { max-width:560px; font-size:17px; line-height:2; letter-spacing:2px;
  opacity:.92; margin-bottom:44px; text-shadow:1px 1px 0 rgba(0,0,0,.8); }
.hud-ending .again { font-family:inherit; font-size:18px; letter-spacing:6px; cursor:pointer;
  padding:12px 38px; background:transparent; border:2px solid currentColor; color:inherit;
  box-shadow:3px 3px 0 rgba(0,0,0,.6); }
.hud-ending .again:hover { background:#e8e0d0; color:#14100c; }
.hud-ending .again:disabled { cursor:wait; opacity:.62; }
.hud-ending__actions { display:flex; flex-wrap:wrap; justify-content:center; gap:12px; }
.hud-ending .ending-share { font-size:14px; letter-spacing:3px; padding:10px 16px; }

/* 手机端：操控层低于剧情弹窗，但始终给玩家明确的移动、看向、行动入口。 */
html.touch-ui { --touch-safe-top:max(12px, env(safe-area-inset-top)); --touch-safe-right:max(12px, env(safe-area-inset-right)); --touch-safe-bottom:max(16px, env(safe-area-inset-bottom)); --touch-safe-left:max(12px, env(safe-area-inset-left)); }
.mobile-touch-controls { position:fixed; inset:0; z-index:25; pointer-events:none; font-family:system-ui,-apple-system,"PingFang SC","Microsoft YaHei",sans-serif; color:#f6efe2; }
.mobile-touch-controls button { font:inherit; color:inherit; }
.mobile-joystick { position:absolute; left:var(--touch-safe-left); bottom:var(--touch-safe-bottom); width:128px; height:128px; border-radius:50%; border:2px solid rgba(235,225,204,.56); background:radial-gradient(circle,rgba(103,82,89,.34),rgba(10,7,12,.44) 70%); box-shadow:inset 0 0 0 14px rgba(255,255,255,.035),0 5px 22px rgba(0,0,0,.28); pointer-events:auto; touch-action:none; user-select:none; -webkit-user-select:none; }
.mobile-joystick:before,.mobile-joystick:after { content:""; position:absolute; background:rgba(240,230,213,.22); left:50%; top:50%; transform:translate(-50%,-50%); }
.mobile-joystick:before { width:1px; height:78%; }
.mobile-joystick:after { width:78%; height:1px; }
.mobile-joystick__label { position:absolute; left:50%; top:13px; transform:translateX(-50%); font-size:11px; letter-spacing:2px; color:rgba(255,245,228,.82); pointer-events:none; }
.mobile-joystick__nub { position:absolute; left:50%; top:50%; width:54px; height:54px; border-radius:50%; border:2px solid rgba(255,246,224,.85); background:rgba(238,218,193,.29); box-shadow:0 2px 8px rgba(0,0,0,.34); transform:translate(-50%,-50%); transition:transform .08s ease; pointer-events:none; }
.mobile-joystick.is-active .mobile-joystick__nub { background:rgba(246,226,183,.55); }
.mobile-action,.mobile-squint { position:absolute; right:var(--touch-safe-right); pointer-events:auto; touch-action:manipulation; -webkit-tap-highlight-color:transparent; border:1px solid #e6d0a5; box-shadow:0 3px 0 rgba(52,24,28,.95),0 7px 20px rgba(0,0,0,.35); text-shadow:0 1px 1px rgba(0,0,0,.48); }
.mobile-action { bottom:var(--touch-safe-bottom); min-width:132px; min-height:56px; max-width:min(170px,43vw); padding:8px 13px; border-radius:8px; background:linear-gradient(180deg,#9b5f59,#63333a); font-size:14px; line-height:1.25; font-weight:700; letter-spacing:.05em; }
.mobile-action:active:not(:disabled) { transform:translateY(2px); box-shadow:0 1px 0 rgba(52,24,28,.95); }
.mobile-action:disabled { border-color:rgba(218,207,187,.32); background:rgba(47,36,43,.78); color:rgba(240,231,215,.56); box-shadow:none; }
.mobile-squint { bottom:calc(var(--touch-safe-bottom) + 70px); min-width:64px; min-height:64px; border-radius:50%; background:radial-gradient(circle at 45% 35%,#7d6c8f,#3d314a 72%); display:flex; flex-direction:column; align-items:center; justify-content:center; gap:1px; font-size:13px; font-weight:700; letter-spacing:.08em; }
.mobile-squint small { font-size:9px; font-weight:500; letter-spacing:.12em; opacity:.82; }
.mobile-squint.is-held { background:radial-gradient(circle at 45% 35%,#e6d3ad,#81663b 72%); color:#241b18; text-shadow:none; box-shadow:0 0 0 4px rgba(239,217,162,.2),0 3px 0 rgba(74,53,31,.95); }
.mobile-touch-legend { position:absolute; top:calc(var(--touch-safe-top) + 48px); left:var(--touch-safe-left); max-width:170px; padding:6px 8px; border-left:2px solid rgba(231,204,158,.72); background:rgba(8,6,10,.47); color:rgba(244,235,216,.82); font-size:10px; letter-spacing:.06em; line-height:1.45; text-shadow:0 1px 2px #000; }
.mobile-touch-coach { position:absolute; left:50%; top:calc(var(--touch-safe-top) + 96px); width:min(332px,calc(100vw - 32px)); transform:translate(-50%,-8px); display:flex; justify-content:center; flex-wrap:wrap; gap:6px; opacity:0; transition:opacity .35s ease,transform .35s ease; pointer-events:none; }
.mobile-touch-coach.is-visible { opacity:1; transform:translate(-50%,0); }
.mobile-touch-coach span { padding:7px 9px; border:1px solid rgba(241,225,193,.45); border-radius:999px; background:rgba(11,8,13,.78); color:#f0e2c8; font-size:11px; line-height:1; box-shadow:0 2px 10px rgba(0,0,0,.28); }
.mobile-touch-controls.is-locked .mobile-joystick,.mobile-touch-controls.is-locked .mobile-squint { opacity:0; pointer-events:none; }
html.touch-ui .hud-interact { display:none!important; }
html.touch-ui .hud-sub { bottom:calc(var(--touch-safe-bottom) + 148px); width:min(760px,calc(100vw - 32px)); touch-action:manipulation; }
html.touch-ui .hud-sub .stext { font-size:17px; line-height:1.6; padding:9px 12px; }
html.touch-ui .hud-sys { top:18%; width:min(620px,calc(100vw - 34px)); }
html.touch-ui .hud-sys .sline { font-size:clamp(18px,5.4vw,27px); letter-spacing:3px; line-height:1.65; }
html.touch-ui .hud-toast { bottom:36%; width:min(340px,calc(100vw - 48px)); text-align:center; font-size:13px; line-height:1.55; }
html.touch-ui .hud-pbox { min-width:0; width:min(540px,calc(100vw - 28px)); max-height:calc(100dvh - 28px); overflow:auto; padding:18px 18px; touch-action:pan-y; }
html.touch-ui .hud-pbox .opt { min-height:52px; padding:12px 14px; font-size:16px; touch-action:manipulation; }
html.touch-ui .hud-ending { padding:max(24px,env(safe-area-inset-top)) 20px max(24px,env(safe-area-inset-bottom)); overflow:auto; touch-action:pan-y; }
html.touch-ui .hud-ending .esub { font-size:15px; line-height:1.75; margin-bottom:28px; }
html.touch-ui .hud-ending .again { min-height:50px; padding:10px 18px; letter-spacing:3px; }
@media (orientation:landscape) and (max-height:520px) {
  .mobile-joystick { width:104px; height:104px; }
  .mobile-joystick__nub { width:46px; height:46px; }
  .mobile-touch-legend { display:none; }
  .mobile-touch-coach { top:var(--touch-safe-top); }
  .mobile-action { min-height:50px; }
  .mobile-squint { bottom:calc(var(--touch-safe-bottom) + 58px); min-width:54px; min-height:54px; }
  html.touch-ui .hud-sub { bottom:calc(var(--touch-safe-bottom) + 112px); }
}
@media (prefers-reduced-motion:reduce) {
  .hud-pulse.on,.hud-fear.high .fbar { animation:none; }
  .mobile-joystick__nub,.mobile-touch-coach,.hud-ending { transition:none; }
}
`

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  parent: HTMLElement,
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag)
  e.className = className
  parent.appendChild(e)
  return e
}

export class HUD {
  private root: HTMLDivElement
  private elFade: HTMLDivElement
  private elPulse: HTMLDivElement
  private elFearBox: HTMLDivElement
  private elFearLabel: HTMLDivElement
  private elFearFill: HTMLDivElement
  private elCross: HTMLDivElement
  private elInteract: HTMLDivElement
  private elToast: HTMLDivElement
  private elSub: HTMLDivElement
  private elSubName: HTMLSpanElement
  private elSubText: HTMLSpanElement
  private elSys: HTMLDivElement
  private elSysLines: HTMLDivElement

  private subToken = 0
  private subSkip: (() => void) | null = null
  private sysToken = 0
  private sysSkip: (() => void) | null = null
  private toastTimer = 0
  private promptFinish: ((id: string) => void) | null = null

  constructor() {
    const style = document.createElement('style')
    style.textContent = STYLE
    document.head.appendChild(style)

    this.root = document.createElement('div')
    this.root.id = 'hud'
    document.body.appendChild(this.root)

    el('div', 'hud-scan', this.root)
    this.elPulse = el('div', 'hud-pulse', this.root)
    this.elFade = el('div', 'hud-fade', this.root)

    this.elFearBox = el('div', 'hud-fear', this.root)
    this.elFearLabel = el('div', 'flabel', this.elFearBox)
    this.elFearLabel.textContent = '惊悚 0'
    const fbar = el('div', 'fbar', this.elFearBox)
    this.elFearFill = el('div', 'ffill', fbar)

    this.elCross = el('div', 'hud-cross', this.root)
    this.elInteract = el('div', 'hud-interact', this.root)
    this.elInteract.setAttribute('role', 'status')
    this.elInteract.setAttribute('aria-live', 'polite')
    this.elToast = el('div', 'hud-toast', this.root)
    this.elToast.setAttribute('role', 'status')
    this.elToast.setAttribute('aria-live', 'polite')

    this.elSub = el('div', 'hud-sub', this.root)
    this.elSub.setAttribute('role', 'button')
    this.elSub.setAttribute('tabindex', '0')
    this.elSub.setAttribute('aria-label', '点按继续当前文字')
    const snameWrap = el('div', '', this.elSub)
    this.elSubName = document.createElement('span')
    this.elSubName.className = 'sname'
    snameWrap.appendChild(this.elSubName)
    const stextWrap = el('div', 'stext', this.elSub)
    this.elSubText = document.createElement('span')
    stextWrap.appendChild(this.elSubText)
    this.elSub.onclick = () => this.subSkip?.()
    this.elSub.onkeydown = (event) => {
      if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); this.subSkip?.() }
    }

    this.elSys = el('div', 'hud-sys', this.root)
    this.elSys.setAttribute('role', 'button')
    this.elSys.setAttribute('tabindex', '0')
    this.elSys.setAttribute('aria-label', '点按继续系统文字')
    this.elSysLines = el('div', '', this.elSys)
    this.elSys.onclick = () => this.sysSkip?.()
    this.elSys.onkeydown = (event) => {
      if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); this.sysSkip?.() }
    }
  }

  // ------------------------------ 惊悚条 ------------------------------
  setFear(v01: number): void {
    const pct = Math.round(Math.max(0, Math.min(1, v01)) * 100)
    this.elFearFill.style.width = `${pct}%`
    this.elFearLabel.textContent = `惊悚 ${pct}`
    this.elFearBox.classList.toggle('high', pct > 70)
  }

  /** 恐怖凝视中的红脉冲（§4：眯眼看真身时提示） */
  setPulse(on: boolean): void {
    this.elPulse.classList.toggle('on', on)
  }

  // ------------------------------ 准星 / 交互提示 / 轻提示 ------------------------------
  showInteract(text: string | null): void {
    if (text) {
      this.elInteract.textContent = text
      this.elInteract.classList.add('on')
    } else {
      this.elInteract.classList.remove('on')
    }
  }

  toast(text: string, ms = 1800): void {
    this.elToast.textContent = text
    this.elToast.classList.add('on')
    window.clearTimeout(this.toastTimer)
    this.toastTimer = window.setTimeout(() => this.elToast.classList.remove('on'), ms)
  }

  // ------------------------------ 渐黑层（午睡/过场） ------------------------------
  async fadeOut(ms = 1200): Promise<void> {
    this.elFade.style.transition = `opacity ${ms}ms ease`
    this.elFade.style.opacity = '1'
    await sleep(ms + 40)
  }

  async fadeIn(ms = 1200): Promise<void> {
    this.elFade.style.transition = `opacity ${ms}ms ease`
    this.elFade.style.opacity = '0'
    await sleep(ms + 40)
  }

  // ------------------------------ 字幕（say） ------------------------------
  /** 说话人名 + 打字机；点击打满并 resolve（GameAPI.say 语义）。 */
  say(speaker: string, text: string, msPerChar = 40): Promise<void> {
    const token = ++this.subToken
    this.elSub.classList.add('on')
    this.elSubName.textContent = speaker
    this.elSubText.textContent = ''
    return new Promise<void>((resolve) => {
      let i = 0
      let done = false
      const finish = (fill: boolean) => {
        if (done) return
        done = true
        this.subSkip = null
        if (fill && token === this.subToken) this.elSubText.textContent = text
        window.setTimeout(() => {
          if (token === this.subToken) this.elSub.classList.remove('on')
        }, 2600)
        resolve()
      }
      this.subSkip = () => finish(true)
      const tick = () => {
        if (done) return
        if (token !== this.subToken) return finish(false) // 被新字幕顶替
        i += 1
        this.elSubText.textContent = text.slice(0, i)
        if (i >= text.length) finish(true)
        else window.setTimeout(tick, msPerChar)
      }
      tick()
    })
  }

  // ------------------------------ 系统横幅（sys） ------------------------------
  /** 屏幕中上大号字逐行打出；点击全部打满并 resolve。 */
  sys(lines: string[]): Promise<void> {
    const token = ++this.sysToken
    this.elSys.classList.add('on')
    this.elSysLines.textContent = ''
    return new Promise<void>((resolve) => {
      let lineIdx = 0
      let done = false
      const finish = (fill: boolean) => {
        if (done) return
        done = true
        this.sysSkip = null
        if (fill && token === this.sysToken) {
          this.elSysLines.textContent = ''
          for (const l of lines) {
            const d = document.createElement('div')
            d.className = 'sline'
            d.textContent = l
            this.elSysLines.appendChild(d)
          }
        }
        window.setTimeout(() => {
          if (token === this.sysToken) this.elSys.classList.remove('on')
        }, 2000)
        resolve()
      }
      this.sysSkip = () => finish(true)
      const typeLine = () => {
        if (done) return
        if (token !== this.sysToken) return finish(false)
        if (lineIdx >= lines.length) return finish(false)
        const line = lines[lineIdx]
        const d = document.createElement('div')
        d.className = 'sline'
        this.elSysLines.appendChild(d)
        let i = 0
        const tick = () => {
          if (done) return
          if (token !== this.sysToken) return finish(false)
          i += 1
          d.textContent = line.slice(0, i)
          if (i >= line.length) {
            lineIdx += 1
            window.setTimeout(typeLine, 460)
          } else {
            window.setTimeout(tick, 52)
          }
        }
        tick()
      }
      typeLine()
    })
  }

  // ------------------------------ 选项弹窗（prompt） ------------------------------
  /** 居中 modal；键盘 1/2/3 或点击选择；resolve 所选 option 的 id。 */
  prompt(options: { id: string; label: string }[], title = '你要怎么做？'): Promise<string> {
    this.promptFinish?.('')
    return new Promise<string>((resolve) => {
      const mask = document.createElement('div')
      mask.className = 'hud-pmask'
      const box = document.createElement('div')
      box.className = 'hud-pbox'
      const t = document.createElement('div')
      t.className = 'ptitle'
      t.textContent = title
      box.appendChild(t)
      const finish = (id: string) => {
        window.removeEventListener('keydown', keyHandler)
        this.promptFinish = null
        mask.remove()
        resolve(id)
      }
      this.promptFinish = finish
      let firstOption: HTMLButtonElement | null = null
      options.forEach((o, i) => {
        const b = document.createElement('button')
        b.className = 'opt'
        const num = document.createElement('span')
        num.className = 'num'
        num.textContent = String(i + 1)
        b.appendChild(num)
        b.appendChild(document.createTextNode(o.label))
        b.onclick = () => finish(o.id)
        if (!firstOption) firstOption = b
        box.appendChild(b)
      })
      const keyHandler = (e: KeyboardEvent) => {
        const n = Number(e.key)
        if (n >= 1 && n <= options.length) finish(options[n - 1].id)
      }
      window.addEventListener('keydown', keyHandler)
      mask.appendChild(box)
      document.body.appendChild(mask)
      requestAnimationFrame(() => firstOption?.focus())
    })
  }

  /** 立即结束所有进行中的字幕/横幅/弹窗（结局或死亡时调用，防止脚本悬挂） */
  closeTransient(): void {
    this.subSkip?.()
    this.sysSkip?.()
    this.promptFinish?.('')
  }

  // ------------------------------ 结局页 ------------------------------
  showEnding(def: EndingView): void {
    this.showInteract(null)
    this.setPulse(false)
    this.elCross.style.display = 'none'
    const e = document.createElement('div')
    e.className = `hud-ending ${def.tone}`
    const tag = document.createElement('div')
    tag.className = 'etag'
    tag.textContent = def.tone === 'secret' ? '隐藏结局' : '结局'
    const title = document.createElement('div')
    title.className = 'etitle'
    title.textContent = def.title
    const sub = document.createElement('div')
    sub.className = 'esub'
    sub.textContent = def.subtitle
    const again = document.createElement('button')
    again.className = 'again'
    again.textContent = '再玩一次'
    again.onclick = () => location.reload()
    const save = document.createElement('button')
    save.className = 'again ending-share'
    save.textContent = '保存这张记录卡'
    save.onclick = async () => {
      save.disabled = true
      try {
        await saveMyopiaShareCard(def)
        save.textContent = '记录卡已保存'
      } catch {
        save.textContent = '保存失败，请再试一次'
      } finally {
        window.setTimeout(() => { save.disabled = false; save.textContent = '保存这张记录卡' }, 1800)
      }
    }
    const share = document.createElement('button')
    share.className = 'again ending-share'
    share.textContent = '分享这张记录卡'
    share.onclick = async () => {
      share.disabled = true
      try {
        const result = await shareMyopiaShareCard(def)
        share.textContent = result === 'saved' ? '图片已保存，可手动分享' : '分享面板已打开'
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') share.textContent = '已取消分享'
        else share.textContent = '分享失败，请保存图片'
      } finally {
        window.setTimeout(() => { share.disabled = false; share.textContent = '分享这张记录卡' }, 1800)
      }
    }
    const copy = document.createElement('button')
    copy.className = 'again ending-share'
    copy.textContent = '复制近视眼入口'
    copy.onclick = async () => {
      copy.disabled = true
      try {
        await copyMyopiaShareLink()
        copy.textContent = '入口已复制'
      } catch {
        copy.textContent = '复制失败，请保存记录卡'
      } finally {
        window.setTimeout(() => { copy.disabled = false; copy.textContent = '复制近视眼入口' }, 1800)
      }
    }
    const portal = document.createElement('button')
    portal.className = 'again ending-share'
    portal.textContent = '回任意门'
    portal.onclick = () => returnToMyopiaPortal()
    const actions = document.createElement('div')
    actions.className = 'hud-ending__actions'
    actions.append(save, share, copy, portal, again)
    e.append(tag, title, sub, actions)
    document.body.appendChild(e)
    requestAnimationFrame(() => e.classList.add('on'))
  }
}
