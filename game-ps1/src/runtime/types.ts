/**
 * Runtime-facing view of StoryPackage v1.
 *
 * This is intentionally a structural adapter.  The canonical schema and the
 * pure reducer belong in packages/story-contract; keeping these interfaces
 * narrow lets the player build while that package is assembled and gives the
 * future package a single, obvious replacement point.
 */
export type Vec3Tuple = [number, number, number]

export type ProvenanceKind = 'sourced' | 'adapted' | 'invented'
export type ActionKind = 'inspect' | 'collect' | 'use' | 'talk' | 'choose' | 'end'
export type CueKind = 'narration' | 'dialogue'

export interface Provenance {
	kind: ProvenanceKind
	spans: Array<{ start: number; end: number }>
	note: string
}

export interface Cue {
	kind: CueKind
	text: string
	speaker?: string
	provenance?: Provenance
}

export interface Condition {
	kind: 'flag' | 'inventory' | 'knowledge'
	id: string
	value?: boolean
	present?: boolean
}

export interface StoryFlag {
	id: string
	initial: boolean
}

export interface StoryItem {
	id: string
	label: string
}

export interface StoryFact {
	id: string
	kind: 'observed' | 'reported' | 'hypothesis' | 'unknown'
	text: string
	provenance?: Provenance
}

export type PrefabName = 'table-v1' | 'key-v1' | 'door-v1' | 'note-v1' | 'person-v1' | 'plant-v1'

export interface StoryObject {
	id: string
	prefab: PrefabName
	position: Vec3Tuple
	yaw: number
	itemId?: string
	visibleWhen?: { flagId: string; value: boolean }
}

export interface StoryAnchor {
	id: string
	targetObject: string
	position: Vec3Tuple
	radius: number
}

export interface StoryScene {
	id: string
	template: 'room-v1' | 'courtyard-v1'
	spawn: { position: Vec3Tuple; yaw: number }
	objects: StoryObject[]
	anchors: StoryAnchor[]
}

export interface StoryAction {
	kind: ActionKind
	anchorId?: string
	itemId?: string
}

export interface StoryOption {
	id: string
	label: string
	guards: Condition[]
	cues: Cue[]
	effects: Condition[]
	next?: string
}

export interface StoryBeat {
	id: string
	sceneId: string
	objective: string
	entry: Cue[]
	action: StoryAction
	options: StoryOption[]
}

export interface StorySource {
	id: string
	title: string
	author: string
	digest: string
	codepointLength: number
	extent: 'excerpt' | 'complete'
	boundary: string
	usage: 'private-prototype' | 'authorized-public'
	verifiedUrl?: string
}

export interface StoryPackage {
	schemaVersion: '1.0.0'
	id: string
	title: string
	runtime: { engineMajor: 1; templateVersion: 1 }
	source: StorySource
	flags: StoryFlag[]
	items: StoryItem[]
	facts: StoryFact[]
	scenes: StoryScene[]
	startBeat: string
	beats: StoryBeat[]
	/** Optional build manifest emitted by a future compiler. */
	packageDigest?: string
}

export interface StoryState {
	beatId: string
	flags: Record<string, boolean>
	inventory: string[]
	collectedItems: string[]
	knownFacts: string[]
	ended: boolean
}

export interface SaveEnvelope {
	packageDigest: string
	saveSlotId: string
	engineMajor: number
	revision: number
	state: StoryState
	lastCommittedEvent?: string
}

export interface RuntimeDiagnostic {
	code: string
	path: string
	message: string
	severity: 'error' | 'warning'
}

export interface RuntimeResult<T> {
	ok: boolean
	value?: T
	diagnostics?: RuntimeDiagnostic[]
}
