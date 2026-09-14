import type { SaveEnvelope, StoryState } from './types'

type SaveKey = string

/**
 * Revision-fenced save store.  IndexedDB is used when available; a static
 * in-memory map keeps the demo playable in private browsing and test DOMs.
 * Memory fallback is deliberately reported to the caller rather than shown as
 * a successful durable save.
 */
export class SaveStore {
	private static readonly memory = new Map<SaveKey, SaveEnvelope>()
	private readonly key: SaveKey
	private readonly dbName = 'kanshan.story.v1'
	private readonly storeName = 'saves'
	private durable = typeof indexedDB !== 'undefined'
	private dbPromise: Promise<IDBDatabase | null> | null = null

	constructor(
		private readonly packageDigest: string,
		private readonly saveSlotId = 'default',
	) {
		this.key = `${packageDigest}:${saveSlotId}`
	}

	get isDurable(): boolean { return this.durable }

	async load(initialState: StoryState, engineMajor = 1): Promise<SaveEnvelope> {
		const existing = await this.read()
		if (!existing) {
			return {
				packageDigest: this.packageDigest,
				saveSlotId: this.saveSlotId,
				engineMajor,
				revision: 0,
				state: cloneState(initialState),
			}
		}
		if (existing.packageDigest !== this.packageDigest || existing.engineMajor !== engineMajor || !isState(existing.state)) {
			this.durable = false
			return {
				packageDigest: this.packageDigest,
				saveSlotId: this.saveSlotId,
				engineMajor,
				revision: 0,
				state: cloneState(initialState),
			}
		}
		return cloneEnvelope(existing)!
	}

	async commit(expectedRevision: number, state: StoryState, eventId: string, engineMajor = 1): Promise<{ ok: true; envelope: SaveEnvelope } | { ok: false; reason: 'conflict' | 'unavailable' }> {
		const envelope: SaveEnvelope = {
			packageDigest: this.packageDigest,
			saveSlotId: this.saveSlotId,
			engineMajor,
			revision: expectedRevision + 1,
			state: cloneState(state),
			lastCommittedEvent: eventId,
		}
		const db = await this.getDB()
		if (!db) {
			const current = cloneEnvelope(SaveStore.memory.get(this.key))
			if (current?.lastCommittedEvent === eventId) return { ok: true, envelope: current }
			if ((current?.revision ?? 0) !== expectedRevision) return { ok: false, reason: 'conflict' }
			SaveStore.memory.set(this.key, cloneEnvelope(envelope)!)
			return { ok: false, reason: 'unavailable' }
		}
		return this.commitDurable(db, expectedRevision, envelope)
	}

	private async commitDurable(db: IDBDatabase, expectedRevision: number, envelope: SaveEnvelope): Promise<{ ok: true; envelope: SaveEnvelope } | { ok: false; reason: 'conflict' | 'unavailable' }> {
		return new Promise((resolve) => {
			let outcome: { ok: true; envelope: SaveEnvelope } | { ok: false; reason: 'conflict' | 'unavailable' } | null = null
			let settled = false
			const finish = (value: typeof outcome): void => { if (!settled && value) { settled = true; resolve(value) } }
			try {
				const tx = db.transaction(this.storeName, 'readwrite')
				const objectStore = tx.objectStore(this.storeName)
				const request = objectStore.get(this.key)
				request.onerror = () => { outcome = { ok: false, reason: 'unavailable' }; try { tx.abort() } catch {} }
				request.onsuccess = () => {
					const current = request.result as SaveEnvelope | undefined
					if (current?.lastCommittedEvent === envelope.lastCommittedEvent) {
						outcome = { ok: true, envelope: cloneEnvelope(current)! }
						try { tx.abort() } catch {}
						return
					}
					if ((current?.revision ?? 0) !== expectedRevision) {
						outcome = { ok: false, reason: 'conflict' }
						try { tx.abort() } catch {}
						return
					}
					objectStore.put(envelope, this.key)
				}
				tx.oncomplete = () => { SaveStore.memory.set(this.key, cloneEnvelope(envelope)!); finish({ ok: true, envelope }) }
				tx.onabort = () => finish(outcome ?? { ok: false, reason: 'unavailable' })
				tx.onerror = () => finish(outcome ?? { ok: false, reason: 'unavailable' })
			} catch { finish({ ok: false, reason: 'unavailable' }) }
		})
	}

	private async getDB(): Promise<IDBDatabase | null> {
		if (!this.durable) return null
		if (this.dbPromise) return this.dbPromise
		this.dbPromise = new Promise<IDBDatabase | null>((resolve) => {
			try {
				const request = indexedDB.open(this.dbName, 1)
				request.onupgradeneeded = () => request.result.createObjectStore(this.storeName)
				request.onsuccess = () => resolve(request.result)
				request.onerror = () => resolve(null)
			} catch { resolve(null) }
		}).then((db) => {
			if (!db) this.durable = false
			return db
		})
		return this.dbPromise
	}

	private async read(): Promise<SaveEnvelope | undefined> {
		const db = await this.getDB()
		if (!db) return cloneEnvelope(SaveStore.memory.get(this.key))
		return new Promise((resolve) => {
			try {
				const tx = db.transaction(this.storeName, 'readonly')
				const request = tx.objectStore(this.storeName).get(this.key)
				request.onsuccess = () => {
					const value = request.result as SaveEnvelope | undefined
					if (value) SaveStore.memory.set(this.key, value)
					resolve(cloneEnvelope(value))
				}
				request.onerror = () => resolve(cloneEnvelope(SaveStore.memory.get(this.key)))
			} catch {
				this.durable = false
				resolve(cloneEnvelope(SaveStore.memory.get(this.key)))
			}
		})
	}

	private async write(envelope: SaveEnvelope): Promise<boolean> {
		const db = await this.getDB()
		if (!db) {
				SaveStore.memory.set(this.key, cloneEnvelope(envelope)!)
			return false
		}
		return new Promise((resolve) => {
			try {
				const tx = db.transaction(this.storeName, 'readwrite')
				tx.objectStore(this.storeName).put(envelope, this.key)
				tx.oncomplete = () => {
					SaveStore.memory.set(this.key, cloneEnvelope(envelope)!)
					resolve(true)
				}
				tx.onerror = () => resolve(false)
				tx.onabort = () => resolve(false)
			} catch { resolve(false) }
		})
	}
}

function cloneState(state: StoryState): StoryState {
	return {
		beatId: state.beatId,
		flags: { ...state.flags },
		inventory: [...state.inventory],
		collectedItems: [...state.collectedItems],
		knownFacts: [...state.knownFacts],
		ended: state.ended,
	}
}

function cloneEnvelope(value: SaveEnvelope | undefined): SaveEnvelope | undefined {
	return value ? { ...value, state: cloneState(value.state) } : undefined
}

function isState(value: unknown): value is StoryState {
	if (!value || typeof value !== 'object') return false
	const state = value as Partial<StoryState>
	return typeof state.beatId === 'string' && typeof state.flags === 'object' &&
		Array.isArray(state.inventory) && Array.isArray(state.collectedItems) &&
		Array.isArray(state.knownFacts) && typeof state.ended === 'boolean'
}
