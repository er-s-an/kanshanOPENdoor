import type { Cue, StoryBeat, StoryItem, StoryOption, StoryState } from './types'

export type CueAdvance = () => void

/** DOM-only HUD; package text always enters through textContent. */
export class RuntimeHUD {
	readonly root: HTMLElement
	private cueResolve: (() => void) | null = null
	private actionResolve: (() => void) | null = null
	private status: HTMLElement
	private objective: HTMLElement
	private cueBox: HTMLElement
	private cueSpeaker: HTMLElement
	private cueText: HTMLElement
	private cueButton: HTMLButtonElement
	private actionButton: HTMLButtonElement
	private optionsBox: HTMLElement
	private inventory: HTMLElement
	private errorBox: HTMLElement

	constructor(parent: HTMLElement = document.body) {
		this.root = document.createElement('section')
		this.root.className = 'runtime-hud'
		this.root.setAttribute('aria-label', '故事游戏界面')
		this.root.innerHTML = `
			<div class="runtime-hud__top"><span class="runtime-hud__title">PS1 STORY PLAYER</span><span class="runtime-hud__status"></span></div>
			<div class="runtime-hud__objective" aria-live="polite"></div>
			<div class="runtime-hud__inventory" aria-label="背包"></div>
			<div class="runtime-hud__action" hidden></div>
			<div class="runtime-hud__options" role="group" aria-label="选择" hidden></div>
			<div class="runtime-hud__cue" role="dialog" aria-live="polite" hidden>
				<div class="runtime-hud__speaker"></div><div class="runtime-hud__cue-text"></div>
				<button class="runtime-hud__continue" type="button">继续</button>
			</div>
			<div class="runtime-hud__error" role="alert" hidden></div>
		`
		parent.appendChild(this.root)
		this.status = this.require('.runtime-hud__status')
		this.objective = this.require('.runtime-hud__objective')
		this.cueBox = this.require('.runtime-hud__cue')
		this.cueSpeaker = this.require('.runtime-hud__speaker')
		this.cueText = this.require('.runtime-hud__cue-text')
		this.cueButton = this.require('.runtime-hud__continue') as HTMLButtonElement
		this.actionButton = document.createElement('button')
		this.actionButton.className = 'runtime-hud__action-button'
		this.actionButton.type = 'button'
		this.require('.runtime-hud__action').appendChild(this.actionButton)
		this.optionsBox = this.require('.runtime-hud__options')
		this.inventory = this.require('.runtime-hud__inventory')
		this.errorBox = this.require('.runtime-hud__error')
		this.cueButton.addEventListener('click', () => this.continueCue())
		this.actionButton.addEventListener('click', () => this.actionResolve?.())
	}

	get hasCue(): boolean { return !this.cueBox.hidden }

	setTitle(title: string): void { this.root.querySelector<HTMLElement>('.runtime-hud__title')!.textContent = title }

	setBeat(beat: StoryBeat, state: StoryState, items: StoryItem[]): void {
		this.objective.textContent = beat.objective
		this.status.textContent = state.ended ? '片段已结束' : `BEAT ${beat.id}`
		this.inventory.textContent = state.inventory.length
			? `持有：${state.inventory.map((id) => items.find((item) => item.id === id)?.label ?? id).join('、')}`
			: '持有：无'
	}

	setSaved(durable: boolean): void {
		this.status.textContent += durable ? ' · 已保存' : ' · 试玩存档'
	}

	showCue(cue: Cue, onDone: CueAdvance): void {
		this.cancelCue()
		this.cueBox.hidden = false
		this.cueSpeaker.textContent = cue.kind === 'dialogue' ? (cue.speaker ?? '未知') : '旁白'
		this.cueText.textContent = cue.text
		this.cueButton.textContent = '继续'
		this.cueResolve = onDone
	}

	async showCues(cues: Cue[], isCurrent?: () => boolean): Promise<boolean> {
		if (!cues.length) return true
		return new Promise((resolve) => {
			let index = 0
			const finish = (ok: boolean) => {
				this.cueResolve = null
				this.cueBox.hidden = true
				resolve(ok)
			}
			const next = () => {
				if (isCurrent && !isCurrent()) return finish(false)
				if (index >= cues.length) return finish(true)
				const cue = cues[index++]
				this.cueBox.hidden = false
				this.cueSpeaker.textContent = cue.kind === 'dialogue' ? (cue.speaker ?? '未知') : '旁白'
				this.cueText.textContent = cue.text
				this.cueResolve = next
			}
			this.cueResolve = next
			next()
		})
	}

	continueCue(): void {
		const next = this.cueResolve
		if (next) next()
	}

	showAction(label: string, enabled: boolean, onAction: () => void): void {
		this.hideOptions()
		const box = this.require('.runtime-hud__action')
		box.hidden = false
		this.actionButton.textContent = enabled ? `行动 · ${label}` : `暂不可行动 · ${label}`
		this.actionButton.disabled = !enabled
		this.actionResolve = enabled ? onAction : null
	}

	showChoices(options: StoryOption[], canChoose: (option: StoryOption) => boolean, onChoose: (option: StoryOption) => void): void {
		this.hideAction()
		this.optionsBox.replaceChildren()
		this.optionsBox.hidden = false
		for (const option of options) {
			const enabled = canChoose(option)
			const button = document.createElement('button')
			button.type = 'button'
			button.className = 'runtime-hud__option'
			button.textContent = enabled ? option.label : `${option.label}（条件不足）`
			button.disabled = !enabled
			button.addEventListener('click', () => onChoose(option))
			this.optionsBox.appendChild(button)
		}
	}

	showEnd(onConfirm: () => void): void {
		this.hideOptions()
		this.showAction('确认结束当前片段', true, onConfirm)
	}

	showError(message: string): void {
		this.errorBox.hidden = false
		this.errorBox.textContent = message
		window.setTimeout(() => { this.errorBox.hidden = true }, 3200)
	}

	hideAction(): void {
		this.require('.runtime-hud__action').hidden = true
		this.actionResolve = null
	}

	hideOptions(): void {
		this.optionsBox.hidden = true
		this.optionsBox.replaceChildren()
	}

	destroy(): void {
		this.cancelCue()
		this.root.remove()
	}

	private cancelCue(): void {
		this.cueResolve = null
		this.cueBox.hidden = true
	}

	private require(selector: string): HTMLElement {
		const value = this.root.querySelector<HTMLElement>(selector)
		if (!value) throw new Error(`HUD element missing: ${selector}`)
		return value
	}
}
