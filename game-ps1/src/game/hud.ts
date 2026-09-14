// ============================================================================
// DOM HUD 层：惊悚值条 / 字幕（say）/ 系统横幅（sys）/ 选项弹窗（prompt）/
// 准星 / 交互提示 / 中央渐黑层 / 结局页。
// 全中文；复古衬线 + 文字阴影 + 扫描线；不加载任何外部字体文件。
// ============================================================================

import {
  copyMyopiaShareLink,
  drawMyopiaJourneyImprint,
  prepareMyopiaShareCard,
  returnToMyopiaPortal,
  savePreparedMyopiaShareCard,
  sharePreparedMyopiaShareCard,
} from './share-card'

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

.hud-ending { position:fixed; inset:0; z-index:40; pointer-events:auto; opacity:0;
  overflow-y:auto; overscroll-behavior:contain; touch-action:pan-y; transition:opacity .55s ease;
  padding:clamp(20px,5vh,58px) clamp(16px,4vw,34px); color:#f3e3c0; }
.hud-ending.on { opacity:1; }
.hud-ending.good { --ending-ink:#f7e3b4; --ending-muted:#d7c69f; --ending-accent:#e4b85f;
  --ending-panel:rgba(30,23,17,.92); --ending-border:rgba(235,193,113,.38);
  background:radial-gradient(ellipse at 50% 0%,#3a2b1c 0%,#15100b 64%,#080707 100%); }
.hud-ending.bad { --ending-ink:#ffe0d7; --ending-muted:#e4afa9; --ending-accent:#ef7880;
  --ending-panel:rgba(43,12,16,.94); --ending-border:rgba(248,126,130,.38);
  background:radial-gradient(ellipse at 50% 0%,#4d1018 0%,#190506 64%,#080303 100%); }
.hud-ending.secret { --ending-ink:#d8edff; --ending-muted:#a8c9e5; --ending-accent:#83c9ff;
  --ending-panel:rgba(8,20,33,.94); --ending-border:rgba(132,201,255,.38);
  background:radial-gradient(ellipse at 50% 0%,#102b40 0%,#050a10 64%,#020406 100%); }
.hud-ending__sheet { width:min(720px,100%); margin:0 auto; padding:clamp(18px,4vw,34px);
  border:1px solid var(--ending-border); background:linear-gradient(145deg,rgba(255,255,255,.045),transparent 36%),var(--ending-panel);
  box-shadow:0 24px 72px rgba(0,0,0,.52),inset 0 1px 0 rgba(255,255,255,.07); text-align:center; }
.hud-ending__intro { padding:8px 4px 26px; }
.hud-ending .etag { margin:0 0 13px; color:var(--ending-muted); font:700 12px/1.5 system-ui,-apple-system,"PingFang SC","Microsoft YaHei",sans-serif; letter-spacing:.22em; }
.hud-ending .etitle { margin:0; color:var(--ending-ink); font-size:clamp(32px,7vw,62px); line-height:1.18; letter-spacing:.11em; font-weight:700; text-shadow:3px 3px 0 rgba(0,0,0,.75); }
.hud-ending .esub { max-width:590px; margin:18px auto 0; color:var(--ending-ink); font-size:16px; line-height:1.9; letter-spacing:.055em; text-shadow:1px 1px 0 rgba(0,0,0,.65); }
.hud-ending__boundary { max-width:570px; margin:14px auto 0; color:var(--ending-muted); font:13px/1.7 system-ui,-apple-system,"PingFang SC","Microsoft YaHei",sans-serif; }
.hud-ending__gift { padding:clamp(20px,4vw,30px); border:1px solid var(--ending-border); background:rgba(0,0,0,.17); box-shadow:inset 0 1px 0 rgba(255,255,255,.05); }
.hud-ending__gift-kicker { margin:0; color:var(--ending-accent); font:700 13px/1.5 system-ui,-apple-system,"PingFang SC","Microsoft YaHei",sans-serif; letter-spacing:.16em; }
.hud-ending__gift-title { margin:10px 0 0; color:var(--ending-ink); font-size:clamp(27px,5.5vw,43px); line-height:1.2; letter-spacing:.09em; }
.hud-ending__gift-line { max-width:480px; margin:10px auto 0; color:var(--ending-muted); font-size:15px; line-height:1.75; }
.hud-ending__preview { display:grid; place-items:center; width:min(100%,318px); min-height:424px; margin:20px auto 12px; border:1px solid var(--ending-border); background:rgba(0,0,0,.24); box-shadow:7px 8px 0 rgba(0,0,0,.25); overflow:hidden; }
.hud-ending__preview.is-loading::after { content:"正在显影记录卡…"; color:var(--ending-muted); font:13px/1.5 system-ui,-apple-system,"PingFang SC","Microsoft YaHei",sans-serif; letter-spacing:.08em; }
.hud-ending__preview canvas { display:block; width:100%; height:auto; aspect-ratio:3 / 4; }
.hud-ending__preview-error { padding:22px; color:var(--ending-muted); font:14px/1.7 system-ui,-apple-system,"PingFang SC","Microsoft YaHei",sans-serif; }
.hud-ending__random-note { max-width:480px; margin:0 auto; color:var(--ending-muted); font:13px/1.65 system-ui,-apple-system,"PingFang SC","Microsoft YaHei",sans-serif; }
.hud-ending__actions { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:10px; margin:18px 0 0; }
.hud-ending__actions--footer { grid-template-columns:repeat(3,minmax(0,1fr)); margin-top:16px; }
.hud-ending .ending-action { min-height:48px; padding:10px 14px; border:1px solid var(--ending-border); background:rgba(255,255,255,.035); color:var(--ending-ink); font:700 14px/1.35 "Songti SC","STSong","STZhongsong","SimSun",serif; letter-spacing:.12em; cursor:pointer; touch-action:manipulation; -webkit-tap-highlight-color:transparent; }
.hud-ending .ending-action:hover { background:var(--ending-ink); color:#17110c; }
.hud-ending .ending-action--primary { border-color:var(--ending-accent); background:var(--ending-accent); color:#23170d; }
.hud-ending.bad .ending-action--primary { color:#3b0d13; }
.hud-ending .ending-action--primary:hover { filter:brightness(1.08); }
.hud-ending .ending-action:focus-visible { outline:3px solid var(--ending-accent); outline-offset:3px; }
.hud-ending .ending-action:disabled { cursor:wait; opacity:.62; }
.hud-ending__status { min-height:1.65em; margin:13px 0 0; color:var(--ending-muted); font:13px/1.65 system-ui,-apple-system,"PingFang SC","Microsoft YaHei",sans-serif; }
.hud-ending__footer-note { margin:8px 0 0; color:var(--ending-muted); font:12px/1.6 system-ui,-apple-system,"PingFang SC","Microsoft YaHei",sans-serif; }


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
html.touch-ui .hud-ending { padding:max(18px,env(safe-area-inset-top)) 14px max(18px,env(safe-area-inset-bottom)); }
html.touch-ui .hud-ending__sheet { padding:18px 14px; }
html.touch-ui .hud-ending .esub { font-size:15px; line-height:1.75; }
html.touch-ui .hud-ending__preview { width:min(100%,286px); min-height:381px; }
html.touch-ui .hud-ending .ending-action { min-height:50px; padding:11px 10px; letter-spacing:.08em; }
@media (orientation:landscape) and (max-height:520px) {
  .mobile-joystick { width:104px; height:104px; }
  .mobile-joystick__nub { width:46px; height:46px; }
  .mobile-touch-legend { display:none; }
  .mobile-touch-coach { top:var(--touch-safe-top); }
  .mobile-action { min-height:50px; }
  .mobile-squint { bottom:calc(var(--touch-safe-bottom) + 58px); min-width:54px; min-height:54px; }
  html.touch-ui .hud-sub { bottom:calc(var(--touch-safe-bottom) + 112px); }
  html.touch-ui .hud-ending { padding-top:12px; padding-bottom:12px; }
  html.touch-ui .hud-ending__preview { width:216px; min-height:288px; margin:14px auto 10px; }
  html.touch-ui .hud-ending__gift { padding:16px; }
}
@media (max-width:420px) {
  .hud-ending__actions { grid-template-columns:1fr; }
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
    // Gameplay calls this once. The guard also ensures an accidental second call
    // cannot draw a new card for an ending that is already on screen.
    if (document.querySelector('.hud-ending')) return

    this.showInteract(null)
    this.setPulse(false)
    this.elCross.style.display = 'none'

    const imprint = drawMyopiaJourneyImprint(def)
    // Start QR, Canvas, PNG, and File generation while the ending sheet is
    // appearing. The Share click below must call navigator.share immediately.
    const preparedCardPromise = prepareMyopiaShareCard(def, imprint)
    const e = document.createElement('div')
    e.className = `hud-ending ${def.tone}`
    e.setAttribute('role', 'dialog')
    e.setAttribute('aria-modal', 'true')
    e.setAttribute('aria-label', '近视眼本章记录')

    const sheet = document.createElement('section')
    sheet.className = 'hud-ending__sheet'
    sheet.tabIndex = -1

    const intro = document.createElement('header')
    intro.className = 'hud-ending__intro'
    const tag = document.createElement('p')
    tag.className = 'etag'
    tag.textContent = def.id === 'dead' ? '互动玩法失败记录 · 不是小说续写' : '开放首章记录 · 不是小说结局'
    const title = document.createElement('h1')
    title.className = 'etitle'
    title.textContent = def.title
    const sub = document.createElement('p')
    sub.className = 'esub'
    sub.textContent = def.subtitle
    const boundary = document.createElement('p')
    boundary.className = 'hud-ending__boundary'
    boundary.textContent = def.id === 'dead'
      ? '惊悚值到达阈值只会结束这一局互动，不代表原文第 113 行之后发生的事。'
      : '记录止于女主起身斥责后的原文截断处；思思、来人和这家人的后续仍是未知。'
    intro.append(tag, title, sub, boundary)

    const gift = document.createElement('section')
    gift.className = 'hud-ending__gift'
    gift.setAttribute('aria-labelledby', 'myopia-record-card-title')
    const giftKicker = document.createElement('p')
    giftKicker.className = 'hud-ending__gift-kicker'
    giftKicker.textContent = imprint.kind === 'keepsake' ? '刘看山赠送了一张本局记录卡' : '本局失焦记录'
    const giftTitle = document.createElement('h2')
    giftTitle.className = 'hud-ending__gift-title'
    giftTitle.id = 'myopia-record-card-title'
    giftTitle.textContent = imprint.kind === 'keepsake' ? `你抽到了「${imprint.title}」` : `「${imprint.title}」`
    const giftLine = document.createElement('p')
    giftLine.className = 'hud-ending__gift-line'
    giftLine.textContent = imprint.line
    const preview = document.createElement('div')
    preview.className = 'hud-ending__preview is-loading'
    preview.setAttribute('aria-label', `${imprint.title}记录卡预览`)
    const cardNote = document.createElement('p')
    cardNote.className = 'hud-ending__random-note'
    cardNote.textContent = imprint.kind === 'keepsake'
      ? '这是本局随机抽到的旅途收藏卡，不是人格判定；保存和分享会使用同一张卡。'
      : '这是惊悚值达到阈值后的固定失败记录，不把它当作奖励，也不补写原文。'

    const actionStatus = document.createElement('p')
    actionStatus.className = 'hud-ending__status'
    actionStatus.setAttribute('role', 'status')
    actionStatus.setAttribute('aria-live', 'polite')
    const announce = (message: string) => { actionStatus.textContent = message }

    const makeAction = (text: string, primary = false) => {
      const button = document.createElement('button')
      button.className = `ending-action${primary ? ' ending-action--primary' : ''}`
      button.type = 'button'
      button.textContent = text
      return button
    }
    const save = makeAction('保存这张记录卡', true)
    const share = makeAction('分享这张记录卡')
    let preparedCard: Awaited<typeof preparedCardPromise> | null = null
    save.disabled = true
    share.disabled = true
    save.textContent = '正在准备记录卡…'
    share.textContent = '正在准备记录卡…'

    save.onclick = () => {
      if (!preparedCard) return
      save.disabled = true
      try {
        savePreparedMyopiaShareCard(preparedCard)
        save.textContent = '记录卡已保存'
        announce('本局记录卡已保存。')
      } catch {
        save.textContent = '保存失败，请再试一次'
        announce('保存记录卡失败，请再试一次。')
      } finally {
        window.setTimeout(() => { save.disabled = false; save.textContent = '保存这张记录卡' }, 1_800)
      }
    }
    share.onclick = () => {
      if (!preparedCard) return
      share.disabled = true
      try {
        // This call happens before any await or Promise continuation so that
        // mobile Safari/Chrome retain the tap's transient user activation.
        const shareResult = sharePreparedMyopiaShareCard(preparedCard)
        void shareResult.then((result) => {
          share.textContent = result === 'saved' ? '图片已保存，可手动分享' : '分享面板已打开'
          announce(result === 'saved' ? '此浏览器无法分享图片，已保存同一张记录卡。' : '系统分享面板已打开。')
        }).catch((error: unknown) => {
          if (error instanceof DOMException && error.name === 'AbortError') {
            share.textContent = '已取消分享'
            announce('已取消分享。')
          } else {
            share.textContent = '分享失败，请保存图片'
            announce('分享失败，请保存图片后手动分享。')
          }
        }).finally(() => {
          window.setTimeout(() => {
            if (!preparedCard) return
            share.disabled = false
            share.textContent = '分享这张记录卡'
          }, 1_800)
        })
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') {
          share.textContent = '已取消分享'
          announce('已取消分享。')
        } else {
          share.textContent = '分享失败，请保存图片'
          announce('分享失败，请保存图片后手动分享。')
        }
        window.setTimeout(() => {
          if (!preparedCard) return
          share.disabled = false
          share.textContent = '分享这张记录卡'
        }, 1_800)
      }
    }
    const cardActions = document.createElement('div')
    cardActions.className = 'hud-ending__actions'
    cardActions.append(save, share)
    gift.append(giftKicker, giftTitle, giftLine, preview, cardNote, cardActions)

    void preparedCardPromise.then((prepared) => {
      preparedCard = prepared
      preview.classList.remove('is-loading')
      preview.replaceChildren(prepared.canvas)
      save.disabled = false
      share.disabled = false
      save.textContent = '保存这张记录卡'
      share.textContent = '分享这张记录卡'
      announce('本局记录卡已准备好，可以保存或分享。')
    }).catch(() => {
      preview.classList.remove('is-loading')
      const error = document.createElement('p')
      error.className = 'hud-ending__preview-error'
      error.textContent = '记录卡暂时没有显影，请稍后重试。'
      preview.replaceChildren(error)
      save.textContent = '记录卡未能生成'
      share.textContent = '记录卡未能生成'
      announce('本局记录卡暂时未能生成。')
    })

    const copy = makeAction('复制近视眼入口')
    copy.onclick = async () => {
      copy.disabled = true
      try {
        await copyMyopiaShareLink()
        copy.textContent = '入口已复制'
        announce('近视眼入口已复制。')
      } catch {
        copy.textContent = '复制失败，请保存记录卡'
        announce('复制入口失败，请保存记录卡后手动打开。')
      } finally {
        window.setTimeout(() => { copy.disabled = false; copy.textContent = '复制近视眼入口' }, 1_800)
      }
    }
    const portal = makeAction('回任意门')
    const again = makeAction('再玩一次')
    const footerActions = document.createElement('div')
    footerActions.className = 'hud-ending__actions hud-ending__actions--footer'
    footerActions.append(copy, portal, again)
    const footerNote = document.createElement('p')
    footerNote.className = 'hud-ending__footer-note'
    footerNote.textContent = '分享入口只会带你回到任意门，不会带走存档、恐惧值或本局记录。'

    sheet.append(intro, gift, footerActions, actionStatus, footerNote)
    e.appendChild(sheet)
    document.body.appendChild(e)

    // The game HUD has hidden but tabbable subtitle/system controls. Treat the
    // ending as a real modal rather than relying on the visual full-screen veil.
    const endingButtons = () => Array.from(e.querySelectorAll<HTMLButtonElement>('button'))
      .filter((button) => !button.disabled && !button.hidden && button.getClientRects().length > 0)
    const trapEndingFocus = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return
      const buttons = endingButtons()
      if (!buttons.length) return
      const current = document.activeElement
      const index = current instanceof HTMLButtonElement ? buttons.indexOf(current) : -1
      const next = event.shiftKey
        ? (index <= 0 ? buttons[buttons.length - 1] : null)
        : (index === -1 || index === buttons.length - 1 ? buttons[0] : null)
      if (!next) return
      event.preventDefault()
      next.focus()
    }
    const rootWasInert = this.root.hasAttribute('inert')
    let endingDisposed = false
    const disposeEnding = () => {
      if (endingDisposed) return
      endingDisposed = true
      document.removeEventListener('keydown', trapEndingFocus, true)
      window.removeEventListener('pagehide', disposeEnding)
      if (!rootWasInert) this.root.removeAttribute('inert')
    }
    if (!rootWasInert) this.root.setAttribute('inert', '')
    document.addEventListener('keydown', trapEndingFocus, true)
    window.addEventListener('pagehide', disposeEnding, { once: true })

    portal.onclick = () => {
      disposeEnding()
      returnToMyopiaPortal()
    }
    again.onclick = () => {
      disposeEnding()
      location.reload()
    }
    requestAnimationFrame(() => {
      if (endingDisposed) return
      e.classList.add('on')
      sheet.focus({ preventScroll: true })
    })
  }

}
