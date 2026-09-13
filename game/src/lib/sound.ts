// 极简 Web Audio 提示音。默认全部静音（无声也能玩），由设置打开。
// 首次用户手势后惰性创建 AudioContext，避免自动播放限制。
let ctx: AudioContext | null = null;
let enabled = false;
let tickOn = false;

export function setSound(on: boolean, tick: boolean) {
  enabled = on;
  tickOn = on && tick;
}

function ac(): AudioContext | null {
  try {
    if (!ctx) {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
    }
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

export function unlockAudio() {
  ac();
}

function tone(freq: number, dur: number, gain = 0.05, type: OscillatorType = 'sine', when = 0) {
  const c = ac();
  if (!c || !enabled) return;
  try {
    const osc = c.createOscillator();
    const g = c.createGain();
    const t0 = c.currentTime + when;
    osc.type = type;
    osc.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g).connect(c.destination);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  } catch {
    /* noop */
  }
}

/** 打字机“嗒”声：静音高频短音，默认关 */
let lastTickAt = 0;
export function tick() {
  if (!tickOn) return;
  const now = performance.now();
  if (now - lastTickAt < 60) return; // 限频，避免变成噪音
  lastTickAt = now;
  tone(1850 + Math.random() * 300, 0.03, 0.012, 'sine');
}

export function sfxClick() {
  tone(760, 0.05, 0.04, 'triangle');
}
export function sfxOpen() {
  // 门开：低频“嗡” + 上扬
  tone(180, 0.5, 0.05, 'sine');
  tone(420, 0.32, 0.035, 'sine', 0.05);
  tone(900, 0.22, 0.02, 'triangle', 0.12);
}
export function sfxWhoosh() {
  tone(1200, 0.16, 0.03, 'sine');
  tone(300, 0.2, 0.03, 'sine', 0.03);
}
export function sfxChime() {
  tone(660, 0.3, 0.04, 'sine', 0);
  tone(880, 0.4, 0.035, 'sine', 0.09);
  tone(1320, 0.5, 0.025, 'sine', 0.18);
}
export function sfxRescue() {
  tone(520, 0.14, 0.04, 'triangle');
  tone(780, 0.2, 0.03, 'triangle', 0.08);
}
