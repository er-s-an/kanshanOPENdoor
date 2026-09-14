// ============================================================================
// 输入层（engine）：指针锁定第一人称 + 可发现的手机触控。
//  桌面：WASD/方向键移动、鼠标视角、E=交互（边沿）、右键或 Q 按住=眯眼
//  手机：左下固定摇杆移动、右半屏拖动视角、右下行动、按住眯眼。
// ============================================================================
import type { InputAPI } from './contract'

const TOUCH = typeof window !== 'undefined' &&
	('ontouchstart' in window || navigator.maxTouchPoints > 0 || window.matchMedia?.('(any-pointer: coarse)').matches)

export type MobileTouchState = {
	actionLabel: string
	actionEnabled: boolean
	/** 剧情、选择或结局遮住世界时，停止移动和转向，只保留需要的“继续”动作。 */
	locked: boolean
}

/**
 * 给游戏层同步触控按钮状态的窄接口。它没有进入全局 Engine contract，
 * 以免其他故事被迫依赖某一种 HUD；非手机输入时是安全 no-op。
 */
export type MobileTouchInput = InputAPI & {
	setMobileUI?: (state: MobileTouchState) => void
}

export class FPSInput implements InputAPI {
	lookDX = 0
	lookDY = 0
	interactPressed = false
	/** 眯眼量 0..1（平滑后） */
	squint = 0

	private keys = new Set<string>()
	private mouseSquint = false
	private mobileSquintHeld = false

	// 固定摇杆的轴值与指针状态。
	private joyId = -1
	private joyOX = 0
	private joyOY = 0
	private joyX = 0
	private joyY = 0
	private lookId = -1
	private lookLX = 0
	private lookLY = 0
	private mobileLocked = false

	private touchRoot: HTMLDivElement | null = null
	private joyBase: HTMLDivElement | null = null
	private joyNub: HTMLDivElement | null = null
	private actionButton: HTMLButtonElement | null = null
	private squintButton: HTMLButtonElement | null = null
	private coach: HTMLDivElement | null = null
	private coachShown = false
	private coachTimer = 0

	constructor(private canvas: HTMLCanvasElement) {
		this.attachKeyboard()
		if (TOUCH) {
			document.documentElement.classList.add('touch-ui')
			this.buildTouchUI()
			this.attachTouch()
		} else {
			this.attachMouse()
		}
	}

	// ------------------------------ API -------------------------------------

	get moveX(): number {
		let v = 0
		if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) v += 1
		if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) v -= 1
		v += this.joyX
		return Math.max(-1, Math.min(1, v))
	}

	get moveZ(): number {
		let v = 0
		if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) v += 1
		if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) v -= 1
		v -= this.joyY
		return Math.max(-1, Math.min(1, v))
	}

	/** 每帧开头调用：平滑眯眼量 */
	update(dt: number): void {
		const target = this.mouseSquint || this.keys.has('KeyQ') || this.mobileSquintHeld ? 1 : 0
		const t = 1 - Math.exp(-14 * dt)
		this.squint += (target - this.squint) * t
		if (this.squint < 0.003) this.squint = 0
	}

	consume(): void {
		this.lookDX = 0
		this.lookDY = 0
		this.interactPressed = false
	}

	/**
	 * 游戏剧情只告诉输入层“这一次行动会做什么”。按钮永远是实际可点的，
	 * 所以手机玩家无需猜测 E、中央短点或双指手势。
	 */
	setMobileUI(state: MobileTouchState): void {
		if (!this.touchRoot || !this.actionButton) return
		this.mobileLocked = state.locked
		this.touchRoot.classList.toggle('is-locked', state.locked)
		this.actionButton.disabled = !state.actionEnabled
		this.actionButton.textContent = state.actionLabel
		this.actionButton.setAttribute('aria-label', state.actionEnabled
			? `行动：${state.actionLabel}`
			: `暂不可行动：${state.actionLabel}`)
		if (state.locked) this.releaseTouchPointers()
		if (!state.locked && !this.coachShown) this.showCoach()
	}

	// ------------------------------ 键盘 ------------------------------------

	private attachKeyboard(): void {
		window.addEventListener('keydown', (e) => {
			if (e.code.startsWith('Arrow') || e.code === 'Space') e.preventDefault()
			if (e.code === 'KeyE' && !e.repeat) this.interactPressed = true
			this.keys.add(e.code)
		})
		window.addEventListener('keyup', (e) => this.keys.delete(e.code))
		window.addEventListener('blur', () => {
			this.keys.clear()
			this.mouseSquint = false
			this.releaseTouchPointers()
		})
		document.addEventListener('visibilitychange', () => {
			if (document.hidden) this.releaseTouchPointers()
		})
	}

	// ------------------------------ 鼠标 ------------------------------------

	private attachMouse(): void {
		this.canvas.addEventListener('mousedown', (e) => {
			if (e.button === 0 && document.pointerLockElement !== this.canvas) {
				this.canvas.requestPointerLock()
			}
			if (e.button === 2) this.mouseSquint = true
		})
		window.addEventListener('mouseup', (e) => {
			if (e.button === 2) this.mouseSquint = false
		})
		window.addEventListener('contextmenu', (e) => e.preventDefault())
		document.addEventListener('mousemove', (e) => {
			if (document.pointerLockElement !== this.canvas) return
			this.lookDX += e.movementX
			this.lookDY += e.movementY
		})
	}

	// ------------------------------ 手机触控 --------------------------------

	private buildTouchUI(): void {
		const root = document.createElement('div')
		root.className = 'mobile-touch-controls'
		root.setAttribute('role', 'group')
		root.setAttribute('aria-label', '触控操作：左下移动，右侧拖动转向')
		root.innerHTML = `
			<div class="mobile-touch-coach" role="status" aria-live="polite">
				<span>左下按住移动</span><span>右侧拖动看向</span><span>靠近后点行动</span>
			</div>
			<div class="mobile-touch-legend" aria-hidden="true">左下移动 · 右侧拖动看向</div>
			<div class="mobile-joystick" role="presentation" aria-label="按住并拖动移动"><span class="mobile-joystick__label">移动</span><i class="mobile-joystick__nub"></i></div>
			<button class="mobile-squint" type="button" aria-label="按住眯眼，短暂看清远处" aria-pressed="false"><span>眯眼</span><small>按住</small></button>
			<button class="mobile-action" type="button" disabled aria-label="暂不可行动：靠近后互动">靠近后互动</button>
		`
		document.body.appendChild(root)
		this.touchRoot = root
		this.joyBase = root.querySelector<HTMLDivElement>('.mobile-joystick')
		this.joyNub = root.querySelector<HTMLDivElement>('.mobile-joystick__nub')
		this.actionButton = root.querySelector<HTMLButtonElement>('.mobile-action')
		this.squintButton = root.querySelector<HTMLButtonElement>('.mobile-squint')
		this.coach = root.querySelector<HTMLDivElement>('.mobile-touch-coach')

		this.joyBase?.addEventListener('pointerdown', (event) => this.startJoystick(event))
		this.joyBase?.addEventListener('pointermove', (event) => this.moveJoystick(event))
		this.joyBase?.addEventListener('pointerup', (event) => this.endJoystick(event))
		this.joyBase?.addEventListener('pointercancel', (event) => this.endJoystick(event))
		this.joyBase?.addEventListener('lostpointercapture', () => this.endJoystick())

		this.actionButton?.addEventListener('pointerdown', (event) => {
			event.preventDefault()
			event.stopPropagation()
		})
		this.actionButton?.addEventListener('click', (event) => {
			event.preventDefault()
			if (!this.actionButton?.disabled) this.interactPressed = true
		})

		const setSquint = (event: PointerEvent, held: boolean) => {
			event.preventDefault()
			event.stopPropagation()
			if (this.mobileLocked) return
			this.mobileSquintHeld = held
			this.renderSquintState(held)
			if (held) this.squintButton?.setPointerCapture(event.pointerId)
		}
		this.squintButton?.addEventListener('pointerdown', (event) => setSquint(event, true))
		this.squintButton?.addEventListener('pointerup', (event) => setSquint(event, false))
		this.squintButton?.addEventListener('pointercancel', (event) => setSquint(event, false))
		this.squintButton?.addEventListener('lostpointercapture', () => this.clearSquint())
	}

	private showCoach(): void {
		if (!this.coach || this.coachShown) return
		this.coachShown = true
		this.coach.classList.add('is-visible')
		window.clearTimeout(this.coachTimer)
		this.coachTimer = window.setTimeout(() => this.coach?.classList.remove('is-visible'), 8800)
	}

	private startJoystick(event: PointerEvent): void {
		if (this.mobileLocked || this.joyId !== -1 || event.pointerType === 'mouse') return
		event.preventDefault()
		event.stopPropagation()
		const rect = this.joyBase!.getBoundingClientRect()
		this.joyId = event.pointerId
		this.joyOX = rect.left + rect.width / 2
		this.joyOY = rect.top + rect.height / 2
		this.joyBase!.setPointerCapture(event.pointerId)
		this.joyBase!.classList.add('is-active')
		this.setJoystick(event.clientX, event.clientY)
	}

	private moveJoystick(event: PointerEvent): void {
		if (event.pointerId !== this.joyId) return
		event.preventDefault()
		this.setJoystick(event.clientX, event.clientY)
	}

	private endJoystick(event?: PointerEvent): void {
		if (event && event.pointerId !== this.joyId) return
		this.joyId = -1
		this.joyX = this.joyY = 0
		this.joyBase?.classList.remove('is-active')
		if (this.joyNub) this.joyNub.style.transform = 'translate(-50%, -50%)'
	}

	private setJoystick(x: number, y: number): void {
		const radius = 44
		const dx = x - this.joyOX
		const dy = y - this.joyOY
		const length = Math.hypot(dx, dy)
		const scale = length > radius ? radius / length : 1
		const px = dx * scale
		const py = dy * scale
		this.joyX = px / radius
		this.joyY = py / radius
		if (this.joyNub) this.joyNub.style.transform = `translate(calc(-50% + ${px}px), calc(-50% + ${py}px))`
	}

	private attachTouch(): void {
		// 右半边是稳定的“看向”区域。互动永远由行动键承担，轻触不会把转镜头
		// 误判成剧情推进。
		this.canvas.addEventListener('pointerdown', (event) => {
			if (event.pointerType === 'mouse' || this.mobileLocked || this.lookId !== -1) return
			if (event.clientX < window.innerWidth * .42) return
			event.preventDefault()
			this.lookId = event.pointerId
			this.lookLX = event.clientX
			this.lookLY = event.clientY
			this.canvas.setPointerCapture(event.pointerId)
		}, { passive: false })
		this.canvas.addEventListener('pointermove', (event) => {
			if (event.pointerId !== this.lookId) return
			event.preventDefault()
			this.lookDX += (event.clientX - this.lookLX) * 2.2
			this.lookDY += (event.clientY - this.lookLY) * 2.2
			this.lookLX = event.clientX
			this.lookLY = event.clientY
		}, { passive: false })
		const endLook = (event: PointerEvent) => {
			if (event.pointerId === this.lookId) this.lookId = -1
		}
		this.canvas.addEventListener('pointerup', endLook)
		this.canvas.addEventListener('pointercancel', endLook)
		this.canvas.addEventListener('lostpointercapture', () => { this.lookId = -1 })
	}

	private renderSquintState(held: boolean): void {
		this.squintButton?.classList.toggle('is-held', held)
		this.squintButton?.setAttribute('aria-pressed', String(held))
		if (this.squintButton) this.squintButton.innerHTML = held
			? '<span>眯眼中</span><small>松开</small>'
			: '<span>眯眼</span><small>按住</small>'
	}

	private clearSquint(): void {
		this.mobileSquintHeld = false
		this.renderSquintState(false)
	}

	private releaseTouchPointers(): void {
		this.endJoystick()
		this.lookId = -1
		this.clearSquint()
	}
}
