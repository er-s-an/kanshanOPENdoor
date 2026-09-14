// ============================================================================
// 音频层（engine）：WebAudio 全合成，零素材。
//  环境低频嗡鸣 + 风声（startAmbience 一次）、心跳（setFear 0..1 驱动）、
//  doorCreak / step / sting / ui / squintOn / squintOff / thud / glass / kiss / bell
// ============================================================================
import type { AudioAPI, SoundName } from './contract'

export class SynthAudio implements AudioAPI {
	private ctx: AudioContext | null = null
	private master: GainNode | null = null
	private noise: AudioBuffer | null = null
	private ambienceStarted = false
	private fear = 0
	private lastBeat = -10
	private lastResume = -1e9

	/** 节流 resume：无手势时重复 resume 只会刷浏览器警告 */
	private tryResume(ctx: AudioContext): void {
		if (ctx.state !== 'suspended') return
		const now = performance.now()
		if (now - this.lastResume < 2000) return
		this.lastResume = now
		void ctx.resume()
	}

	/** 用户手势后调用：创建/恢复 AudioContext（浏览器自动播放策略） */
	unlock(): void {
		this.lastResume = -1e9
		const ctx = this.ensure()
		if (ctx) this.tryResume(ctx)
	}

	play(name: SoundName): void {
		const ctx = this.ensure()
		if (!ctx || !this.master) return
		// 上下文未激活时丢弃一次性音效（避免恢复后扎堆播放）
		if (ctx.state !== 'running') {
			this.tryResume(ctx)
			return
		}
		const t = ctx.currentTime
		switch (name) {
			case 'doorCreak': this.doorCreak(t); break
			case 'step': this.step(t); break
			case 'sting': this.sting(t); break
			case 'ui': this.ui(t); break
			case 'squintOn': this.squint(t, true); break
			case 'squintOff': this.squint(t, false); break
			case 'thud': this.thud(t); break
			case 'glass': this.glass(t); break
			case 'kiss': this.kiss(t); break
			case 'bell': this.bell(t); break
		}
	}

	setFear(fear01: number): void {
		this.fear = Math.max(0, Math.min(1, fear01))
		const ctx = this.ctx
		if (!ctx || ctx.state !== 'running' || this.fear < 0.04) return
		const interval = 1.15 - 0.73 * Math.pow(this.fear, 0.8) // 1.15s → 0.42s
		if (ctx.currentTime - this.lastBeat >= interval) {
			this.lastBeat = ctx.currentTime
			this.heartbeat(ctx.currentTime, Math.pow(this.fear, 1.4))
		}
	}

	startAmbience(): void {
		const ctx = this.ensure()
		if (!ctx || !this.master || this.ambienceStarted) return
		this.ambienceStarted = true
		this.tryResume(ctx)

		const startSources = () => {
			const t = ctx.currentTime

			// 低频嗡鸣：双正弦轻微失谐产生拍频
			const humGain = ctx.createGain()
			humGain.gain.value = 0.05
			const humLP = ctx.createBiquadFilter()
			humLP.type = 'lowpass'
			humLP.frequency.value = 180
			for (const f of [50, 50.7, 100.3]) {
				const o = ctx.createOscillator()
				o.type = 'sine'
				o.frequency.value = f
				o.connect(humLP)
				o.start(t)
			}
			humLP.connect(humGain)
			humGain.connect(this.master!)

			// 风：循环噪声 → 带通，频率与音量各由慢 LFO 摆动
			const wind = ctx.createBufferSource()
			wind.buffer = this.noise
			wind.loop = true
			const bp = ctx.createBiquadFilter()
			bp.type = 'bandpass'
			bp.frequency.value = 320
			bp.Q.value = 0.6
			const windGain = ctx.createGain()
			windGain.gain.value = 0.05
			const lfo1 = ctx.createOscillator()
			lfo1.frequency.value = 0.11
			const lfo1g = ctx.createGain()
			lfo1g.gain.value = 0.028
			lfo1.connect(lfo1g)
			lfo1g.connect(windGain.gain)
			const lfo2 = ctx.createOscillator()
			lfo2.frequency.value = 0.067
			const lfo2g = ctx.createGain()
			lfo2g.gain.value = 130
			lfo2.connect(lfo2g)
			lfo2g.connect(bp.frequency)
			wind.connect(bp)
			bp.connect(windGain)
			windGain.connect(this.master!)
			wind.start(t)
			lfo1.start(t)
			lfo2.start(t)
		}

		// 上下文未激活时延迟到首次手势后启动（避免 suspended 下 start 刷警告）
		if (ctx.state === 'running') {
			startSources()
		} else {
			const on = () => {
				if (ctx.state === 'running') {
					ctx.removeEventListener('statechange', on)
					startSources()
				}
			}
			ctx.addEventListener('statechange', on)
		}
	}

	// ------------------------------ 基础设施 -------------------------------

	private ensure(): AudioContext | null {
		if (this.ctx) return this.ctx
		try {
			this.ctx = new AudioContext()
		} catch {
			return null
		}
		const ctx = this.ctx
		this.master = ctx.createGain()
		this.master.gain.value = 0.9
		const comp = ctx.createDynamicsCompressor()
		comp.threshold.value = -18
		comp.ratio.value = 6
		this.master.connect(comp)
		comp.connect(ctx.destination)

		const len = Math.floor(ctx.sampleRate * 2)
		this.noise = ctx.createBuffer(1, len, ctx.sampleRate)
		const data = this.noise.getChannelData(0)
		for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1
		return ctx
	}

	private noiseSource(t: number, dur: number): AudioBufferSourceNode | null {
		const ctx = this.ctx
		if (!ctx || !this.noise) return null
		const src = ctx.createBufferSource()
		src.buffer = this.noise
		src.loop = true
		src.loopStart = Math.random() * 1.2
		src.start(t)
		src.stop(t + dur + 0.1)
		return src
	}

	private tone(
		type: OscillatorType, f0: number, f1: number,
		t: number, peak: number, attack: number, decay: number,
	): void {
		const ctx = this.ctx
		if (!ctx || !this.master) return
		const o = ctx.createOscillator()
		o.type = type
		o.frequency.setValueAtTime(Math.max(1, f0), t)
		if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + attack + decay)
		const g = ctx.createGain()
		g.gain.setValueAtTime(0.0001, t)
		g.gain.exponentialRampToValueAtTime(peak, t + attack)
		g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay)
		o.connect(g)
		g.connect(this.master)
		o.start(t)
		o.stop(t + attack + decay + 0.1)
	}

	// ------------------------------ 各音效 ---------------------------------

	/** 门吱呀：低频锯条慢滑 + 带通噪声"吱"声缓慢上扫 */
	private doorCreak(t: number): void {
		this.tone('sawtooth', 150, 92, t, 0.16, 0.3, 1.15)
		this.tone('sawtooth', 76, 60, t, 0.1, 0.3, 1.15)
		const ctx = this.ctx
		if (!ctx || !this.master) return
		const src = this.noiseSource(t, 1.5)
		if (!src) return
		const bp = ctx.createBiquadFilter()
		bp.type = 'bandpass'
		bp.Q.value = 14
		bp.frequency.setValueAtTime(650, t)
		bp.frequency.exponentialRampToValueAtTime(1250, t + 1.2)
		const g = ctx.createGain()
		g.gain.setValueAtTime(0.0001, t)
		g.gain.exponentialRampToValueAtTime(0.055, t + 0.35)
		g.gain.exponentialRampToValueAtTime(0.0001, t + 1.45)
		src.connect(bp)
		bp.connect(g)
		g.connect(this.master)
	}

	/** 脚步：带通噪声软落地 + 低频短促敲击 */
	private step(t: number): void {
		const f = 300 + Math.random() * 160
		this.tone('sine', 68, 55, t, 0.26, 0.004, 0.07)
		const ctx = this.ctx
		if (!ctx || !this.master) return
		const src = this.noiseSource(t, 0.12)
		if (!src) return
		const bp = ctx.createBiquadFilter()
		bp.type = 'bandpass'
		bp.frequency.value = f
		bp.Q.value = 0.8
		const g = ctx.createGain()
		g.gain.setValueAtTime(0.0001, t)
		g.gain.exponentialRampToValueAtTime(0.3, t + 0.006)
		g.gain.exponentialRampToValueAtTime(0.0001, t + 0.1)
		src.connect(bp)
		bp.connect(g)
		g.connect(this.master)
	}

	/** 惊悚 sting：噪声 riser + 不协和簇撞击 + 低频坠 */
	private sting(t: number): void {
		const ctx = this.ctx
		if (!ctx || !this.master) return
		// riser
		const src = this.noiseSource(t, 0.9)
		if (src) {
			const bp = ctx.createBiquadFilter()
			bp.type = 'bandpass'
			bp.Q.value = 2
			bp.frequency.setValueAtTime(250, t)
			bp.frequency.exponentialRampToValueAtTime(2600, t + 0.8)
			const g = ctx.createGain()
			g.gain.setValueAtTime(0.0001, t)
			g.gain.exponentialRampToValueAtTime(0.2, t + 0.78)
			g.gain.exponentialRampToValueAtTime(0.0001, t + 0.85)
			src.connect(bp); bp.connect(g); g.connect(this.master)
		}
		// 不协和 hit（♭3 小二度簇）
		const hit = t + 0.72
		for (const f of [233.08, 246.94, 311.13]) {
			this.tone('sawtooth', f, f * 0.985, hit, 0.13, 0.012, 1.9)
		}
		this.tone('sine', 55, 30, hit, 0.5, 0.01, 0.5)
	}

	/** UI 短音 */
	private ui(t: number): void {
		this.tone('square', 1320, 1320, t, 0.07, 0.003, 0.05)
		const ctx = this.ctx
		if (!ctx || !this.master) return
		const src = this.noiseSource(t, 0.03)
		if (!src) return
		const hp = ctx.createBiquadFilter()
		hp.type = 'highpass'
		hp.frequency.value = 3500
		const g = ctx.createGain()
		g.gain.setValueAtTime(0.04, t)
		g.gain.exponentialRampToValueAtTime(0.0001, t + 0.025)
		src.connect(hp); hp.connect(g); g.connect(this.master)
	}

	/** 眯眼开/关：带通噪声轻扫（上扫=眯起，下扫=松开） */
	private squint(t: number, on: boolean): void {
		const ctx = this.ctx
		if (!ctx || !this.master) return
		const src = this.noiseSource(t, 0.3)
		if (!src) return
		const bp = ctx.createBiquadFilter()
		bp.type = 'bandpass'
		bp.Q.value = 1.2
		bp.frequency.setValueAtTime(on ? 480 : 1900, t)
		bp.frequency.exponentialRampToValueAtTime(on ? 1900 : 480, t + 0.22)
		const g = ctx.createGain()
		g.gain.setValueAtTime(0.0001, t)
		g.gain.exponentialRampToValueAtTime(0.09, t + 0.05)
		g.gain.exponentialRampToValueAtTime(0.0001, t + 0.26)
		src.connect(bp); bp.connect(g); g.connect(this.master)
	}

	/** 闷响撞击：低频坠 + 噪声拍击 */
	private thud(t: number): void {
		this.tone('sine', 78, 30, t, 0.85, 0.005, 0.3)
		const ctx = this.ctx
		if (!ctx || !this.master) return
		const src = this.noiseSource(t, 0.15)
		if (!src) return
		const lp = ctx.createBiquadFilter()
		lp.type = 'lowpass'
		lp.frequency.value = 480
		const g = ctx.createGain()
		g.gain.setValueAtTime(0.4, t)
		g.gain.exponentialRampToValueAtTime(0.0001, t + 0.13)
		src.connect(lp); lp.connect(g); g.connect(this.master)
	}

	/** 玻璃碎：高通噪声碎裂 + 随机高频碎片 ping */
	private glass(t: number): void {
		const ctx = this.ctx
		if (!ctx || !this.master) return
		const src = this.noiseSource(t, 0.5)
		if (src) {
			const hp = ctx.createBiquadFilter()
			hp.type = 'highpass'
			hp.frequency.value = 2600
			const g = ctx.createGain()
			g.gain.setValueAtTime(0.5, t)
			g.gain.exponentialRampToValueAtTime(0.0001, t + 0.42)
			src.connect(hp); hp.connect(g); g.connect(this.master)
		}
		for (let i = 0; i < 8; i++) {
			const dt = Math.random() * 0.14
			const f = 2300 + Math.random() * 3000
			this.tone('sine', f, f * 0.94, t + dt, 0.08 + Math.random() * 0.08, 0.002, 0.22 + Math.random() * 0.35)
		}
		this.tone('sine', 3390, 3300, t + 0.02, 0.1, 0.002, 0.7)
	}

	/** 亲吻：软噪声啵 + 短滑音 */
	private kiss(t: number): void {
		const ctx = this.ctx
		if (!ctx || !this.master) return
		const src = this.noiseSource(t, 0.1)
		if (src) {
			const bp = ctx.createBiquadFilter()
			bp.type = 'bandpass'
			bp.frequency.value = 1400
			bp.Q.value = 1.4
			const g = ctx.createGain()
			g.gain.setValueAtTime(0.22, t)
			g.gain.exponentialRampToValueAtTime(0.0001, t + 0.06)
			src.connect(bp); bp.connect(g); g.connect(this.master)
		}
		this.tone('sine', 540, 270, t, 0.14, 0.006, 0.09)
		this.tone('sine', 700, 420, t + 0.055, 0.07, 0.005, 0.06)
	}

	/** 铃：FM 双音 + 非谐波泛音，长衰减 */
	private bell(t: number): void {
		const ctx = this.ctx
		if (!ctx || !this.master) return
		const strike = (freq: number, peak: number, decay: number) => {
			const c = ctx!.createOscillator()
			c.type = 'sine'
			c.frequency.value = freq
			const m = ctx!.createOscillator()
			m.type = 'sine'
			m.frequency.value = freq * 2.01
			const mg = ctx!.createGain()
			mg.gain.setValueAtTime(freq * 1.6, t)
			mg.gain.exponentialRampToValueAtTime(1, t + decay)
			m.connect(mg)
			mg.connect(c.frequency)
			const g = ctx!.createGain()
			g.gain.setValueAtTime(0.0001, t)
			g.gain.exponentialRampToValueAtTime(peak, t + 0.004)
			g.gain.exponentialRampToValueAtTime(0.0001, t + decay)
			c.connect(g); g.connect(this.master!)
			c.start(t); c.stop(t + decay + 0.1)
			m.start(t); m.stop(t + decay + 0.1)
		}
		strike(660, 0.3, 2.1)
		strike(1987, 0.1, 1.1)
	}

	/** 心跳：lub-dub 双搏 */
	private heartbeat(t: number, g0: number): void {
		this.tone('sine', 58, 38, t, 0.5 * g0, 0.012, 0.15)
		this.tone('sine', 52, 36, t + 0.17, 0.32 * g0, 0.01, 0.12)
	}
}
