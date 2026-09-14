import * as THREE from 'three'
import { localContractAdapter, guardsPass, getGuardFailure, type ContractAdapter } from './contract-adapter'
import { SaveStore } from './save-store'
import { RuntimeHUD } from './hud'
import { WorldAssembler } from './world-assembler'
import { InteractionSystem } from './interaction-system'
import type { Condition, StoryBeat, StoryOption, StoryPackage, StoryState } from './types'

export interface DirectorHooks {
	getPlayerPosition(): THREE.Vector3
	getCamera(): THREE.Camera
	movePlayerToSpawn(spawn: THREE.Vector3, yaw: number): void
}

export type DirectorStatus = 'loading' | 'ready' | 'busy' | 'ended' | 'error'

/** Deterministic package interpreter; all asynchronous work is fenced. */
export class StoryDirector {
	readonly sessionId = globalThis.crypto?.randomUUID?.() ?? `session-${Date.now()}-${Math.random().toString(16).slice(2)}`
	private readonly digest: string
	private readonly save: SaveStore
	private readonly adapter: ContractAdapter
	private readonly interaction: InteractionSystem
	private state: StoryState
	private revision = 0
	private generation = 0
	private currentBeat: StoryBeat
	private busy = false
	private statusValue: DirectorStatus = 'loading'

	constructor(
		private readonly pkg: StoryPackage,
		private readonly world: WorldAssembler,
		private readonly hud: RuntimeHUD,
		private readonly hooks: DirectorHooks,
		adapter: ContractAdapter = localContractAdapter,
	) {
		this.digest = pkg.packageDigest ?? pkg.source.digest
		this.save = new SaveStore(this.digest)
		this.adapter = adapter
		this.interaction = new InteractionSystem(world)
		this.state = adapter.createInitialState(pkg)
		this.currentBeat = this.requireBeat(this.state.beatId)
	}

	get status(): DirectorStatus { return this.statusValue }
	get snapshot(): StoryState { return cloneState(this.state) }
	get beat(): StoryBeat { return this.currentBeat }
	get saveIsDurable(): boolean { return this.save.isDurable }

	async initialize(): Promise<void> {
		try {
			const envelope = await this.save.load(this.state, this.pkg.runtime.engineMajor)
			this.state = envelope.state
			this.revision = envelope.revision
			this.currentBeat = this.requireBeat(this.state.beatId)
			this.generation += 1
			this.world.load(this.pkg, this.currentBeat.sceneId, this.state)
			this.hooks.movePlayerToSpawn(this.world.world!.spawn, this.world.world!.spawnYaw)
			this.hud.setTitle(this.pkg.title)
			this.hud.setBeat(this.currentBeat, this.state, this.pkg.items)
			this.hud.setSaved(this.save.isDurable)
			this.statusValue = this.state.ended ? 'ended' : 'ready'
			void this.presentBeat(this.generation)
		} catch (error) {
			this.statusValue = 'error'
			this.hud.showError(error instanceof Error ? error.message : '故事包无法加载。')
		}
	}

	/** Called once per frame after movement. */
	interact(): void {
		if (this.statusValue === 'error' || this.busy) return
		if (this.hud.hasCue) {
			this.hud.continueCue()
			return
		}
		const action = this.currentBeat.action
		if (action.kind === 'choose') return
		if (action.kind === 'end') {
			void this.confirmEnd()
			return
		}
		const anchorId = action.anchorId
		if (!anchorId || !this.interaction.canInteract(anchorId, this.hooks.getPlayerPosition(), this.hooks.getCamera())) {
			this.hud.showError('再靠近一点，并面向目标。')
			return
		}
		const option = this.currentBeat.options[0]
		if (!option) return
		if (!guardsPass(this.adapter, option.guards, this.state)) {
			this.hud.showError(this.guardMessage(getGuardFailure(this.adapter, option.guards, this.state)))
			return
		}
		void this.executeOption(this.currentBeat, option)
	}

	private async presentBeat(expectedGeneration: number): Promise<void> {
		if (!this.isCurrent(expectedGeneration)) return
		this.hud.setBeat(this.currentBeat, this.state, this.pkg.items)
		this.hud.hideAction()
		this.hud.hideOptions()
		if (this.currentBeat.entry.length) {
			const complete = await this.hud.showCues(this.currentBeat.entry, () => this.isCurrent(expectedGeneration))
			if (!complete || !this.isCurrent(expectedGeneration)) return
		}
		if (!this.isCurrent(expectedGeneration)) return
		this.presentAction()
	}

	private presentAction(): void {
		if (this.state.ended || this.currentBeat.action.kind === 'end') {
			this.statusValue = 'ended'
			this.hud.showEnd(() => void this.confirmEnd())
			return
		}
		const action = this.currentBeat.action
		if (action.kind === 'choose') {
			this.hud.showChoices(
				this.currentBeat.options,
				(option) => guardsPass(this.adapter, option.guards, this.state),
				(option) => void this.executeOption(this.currentBeat, option),
			)
			return
		}
		const option = this.currentBeat.options[0]
		const enabled = !!option && guardsPass(this.adapter, option.guards, this.state)
		this.hud.showAction(this.actionLabel(action.kind), enabled, () => this.interact())
	}

	private async executeOption(beat: StoryBeat, option: StoryOption): Promise<void> {
		if (this.busy || !this.isCurrentBeat(beat)) return
		this.busy = true
		this.statusValue = 'busy'
		this.generation += 1
		const expectedGeneration = this.generation
		this.hud.hideAction()
		this.hud.hideOptions()
		const cuesComplete = await this.hud.showCues(option.cues, () => this.isCurrent(expectedGeneration))
		if (!cuesComplete || !this.isCurrent(expectedGeneration)) {
			this.busy = false
			this.statusValue = 'ready'
			return
		}
		const transition = this.adapter.apply(this.pkg, this.state, beat, option)
		if (transition.diagnostics.some((diagnostic) => diagnostic.severity === 'error')) {
			this.busy = false
			this.statusValue = 'ready'
			this.hud.showError(transition.diagnostics[0]?.message ?? '动作前置条件未满足。')
			this.presentAction()
			return
		}
		const eventId = `${this.sessionId}:${expectedGeneration}:${beat.id}:${option.id}:${this.revision}`
		const committed = await this.save.commit(this.revision, transition.state, eventId, this.pkg.runtime.engineMajor)
		if (!this.isCurrent(expectedGeneration)) return
		if (!committed.ok && committed.reason === 'conflict') {
			this.busy = false
			this.statusValue = 'error'
			this.hud.showError('存档在另一标签页发生变化，请重新载入或复制存档。')
			return
		}
		this.state = transition.state
		this.revision = committed.ok ? committed.envelope.revision : this.revision + 1
		this.world.update(this.state)
		this.hud.setSaved(committed.ok && this.save.isDurable)
		this.busy = false
		this.generation += 1
		if (this.state.ended) {
			this.statusValue = 'ended'
			this.hud.setBeat(this.currentBeat, this.state, this.pkg.items)
			this.presentAction()
			return
		}
		const nextBeat = this.requireBeat(this.state.beatId)
		const sceneChanged = nextBeat.sceneId !== this.currentBeat.sceneId
		this.currentBeat = nextBeat
		if (sceneChanged) {
			this.world.load(this.pkg, nextBeat.sceneId, this.state)
			this.hooks.movePlayerToSpawn(this.world.world!.spawn, this.world.world!.spawnYaw)
		}
		this.statusValue = 'ready'
		void this.presentBeat(this.generation)
	}

	private async confirmEnd(): Promise<void> {
		if (this.currentBeat.action.kind !== 'end' || this.busy || this.state.ended) return
		const option: StoryOption = { id: 'confirm-end', label: '确认结束', guards: [], cues: [], effects: [], next: this.currentBeat.id }
		void this.executeOption(this.currentBeat, option)
	}

	private actionLabel(kind: string): string {
		return ({ inspect: '观察', collect: '拾取', use: '使用', talk: '交谈' } as Record<string, string>)[kind] ?? '行动'
	}

	private guardMessage(condition?: Condition): string {
		if (!condition) return '当前行动条件不足。'
		if (condition.kind === 'inventory') return condition.present ? '需要先拿到对应物品。' : '这个物品已经被拿走。'
		if (condition.kind === 'knowledge') return condition.present ? '你还不知道这件事。' : '当前不应得出这个判断。'
		return condition.value ? '当前剧情还没有允许这个状态。' : '当前剧情状态不允许继续。'
	}

	private requireBeat(id: string): StoryBeat {
		const beat = this.pkg.beats.find((candidate) => candidate.id === id)
		if (!beat) throw new Error(`Beat not found: ${id}`)
		return beat
	}

	private isCurrent(expectedGeneration: number): boolean { return expectedGeneration === this.generation && this.statusValue !== 'error' }
	private isCurrentBeat(beat: StoryBeat): boolean { return beat.id === this.currentBeat.id && !this.state.ended }
}

function cloneState(state: StoryState): StoryState {
	return { ...state, flags: { ...state.flags }, inventory: [...state.inventory], collectedItems: [...state.collectedItems], knownFacts: [...state.knownFacts] }
}
