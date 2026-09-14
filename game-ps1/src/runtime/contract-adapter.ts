import type {
	Condition,
	RuntimeDiagnostic,
	StoryAction,
	StoryBeat,
	StoryOption,
	StoryPackage,
	StoryState,
} from './types'
import {
	conditionPasses as sharedConditionPasses,
	createInitialState as sharedCreateInitialState,
	reduceStoryState as sharedReduceStoryState,
} from '@kanshan/story-contract'
import type { StoryEvent as SharedStoryEvent, StoryPackage as SharedStoryPackage, StoryState as SharedStoryState } from '@kanshan/story-contract'

/**
 * Narrow seam for packages/story-contract.
 *
 * The player does not know how a story was authored.  It only asks this seam
 * to create a state, evaluate guards and apply one already-selected option.
 * All state semantics are delegated to the pure shared package. The cast is
 * confined to this seam because the player-facing types omit authoring fields.
 */
export interface ContractAdapter {
	createInitialState(pkg: StoryPackage): StoryState
	evaluate(condition: Condition, state: StoryState): boolean
	apply(
		pkg: StoryPackage,
		state: StoryState,
		beat: StoryBeat,
		option: StoryOption,
	): { state: StoryState; diagnostics: RuntimeDiagnostic[] }
}

/** Browser adapter around the same reducer used by Studio and static tools. */
export const localContractAdapter: ContractAdapter = {
	createInitialState(pkg) {
		return sharedCreateInitialState(pkg as unknown as SharedStoryPackage) as StoryState
	},

	evaluate(condition, state) {
		return sharedConditionPasses(condition as never, state as unknown as SharedStoryState)
	},

	apply(pkg, state, beat, option) {
		const event: SharedStoryEvent = beat.action.kind === 'end'
			? { eventId: `runtime-end-${beat.id}`, sessionId: 'runtime-preview', expectedGeneration: 0, expectedRevision: 0, beatId: beat.id, type: 'confirm-end' }
			: { eventId: `runtime-${beat.id}-${option.id}`, sessionId: 'runtime-preview', expectedGeneration: 0, expectedRevision: 0, beatId: beat.id, type: 'complete-option', optionId: option.id }
		const reduced = sharedReduceStoryState(state as unknown as SharedStoryState, event, pkg as unknown as SharedStoryPackage)
		return {
			state: reduced.state as StoryState,
			diagnostics: reduced.diagnostics.map((item) => ({ code: item.code, path: item.path, message: item.message, severity: item.severity === 'error' ? 'error' : 'warning' })),
		}
	},
}

export function guardsPass(adapter: ContractAdapter, guards: Condition[], state: StoryState): boolean {
	return guards.every((guard) => adapter.evaluate(guard, state))
}

export function getGuardFailure(adapter: ContractAdapter, guards: Condition[], state: StoryState): Condition | undefined {
	return guards.find((guard) => !adapter.evaluate(guard, state))
}
