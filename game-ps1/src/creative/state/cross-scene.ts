/**
 * Cross-scene session state (S13).
 *
 * A scene instance is disposable — unloading it must never destroy the
 * player's persistent progress. `SessionStateBag` splits the two:
 *
 * - `persistent` state is keyed by moduleId and survives scene unload /
 *   reload cycles (inventory, objectives, world flags...). This is the part
 *   that belongs in a checkpoint.
 * - `scene` state is keyed by (instanceId, moduleId) and is dropped when
 *   the scene instance unloads (per-instance puzzle progress, ephemeral
 *   flags...).
 *
 * Values must be JSON-compatible: they are deep-cloned on write and on
 * read, so modules can never alias each other's state, and snapshots can be
 * persisted without surprises.
 */
import { CreativeError } from '../core/errors.ts';
import { jsonProblems } from './checkpoint-store.ts';

export type StateDisposition = 'persistent' | 'scene';

export class SessionStateBag {
  private readonly persistentMap = new Map<string, Map<string, unknown>>();
  private readonly sceneMap = new Map<string, Map<string, Map<string, unknown>>>();

  /**
   * Write a value. `persistent` entries are keyed by moduleId only and
   * survive `unloadSceneInstance`; `scene` entries additionally require an
   * active instance (see `beginSceneInstance`).
   */
  set(
    disposition: StateDisposition,
    moduleId: string,
    key: string,
    value: unknown,
    instanceId?: string,
  ): void {
    assertId(moduleId, 'moduleId');
    assertId(key, 'key');
    assertJsonValue(value, key);
    if (disposition === 'persistent') {
      moduleMap(this.persistentMap, moduleId).set(key, cloneJson(value));
      return;
    }
    const instance = this.requireInstance(instanceId);
    moduleMap(instance, moduleId).set(key, cloneJson(value));
  }

  /**
   * Read a value; undefined when absent. Persistent reads never need an
   * instanceId; scene reads require one.
   */
  get(
    disposition: StateDisposition,
    moduleId: string,
    key: string,
    instanceId?: string,
  ): unknown {
    assertId(moduleId, 'moduleId');
    assertId(key, 'key');
    if (disposition === 'persistent') {
      return cloneOrUndefined(this.persistentMap.get(moduleId)?.get(key));
    }
    const instance = this.requireInstance(instanceId);
    return cloneOrUndefined(instance.get(moduleId)?.get(key));
  }

  /** Remove a single entry. Returns true when an entry was removed. */
  unset(
    disposition: StateDisposition,
    moduleId: string,
    key: string,
    instanceId?: string,
  ): boolean {
    assertId(moduleId, 'moduleId');
    assertId(key, 'key');
    if (disposition === 'persistent') {
      return this.persistentMap.get(moduleId)?.delete(key) ?? false;
    }
    const instance = this.requireInstance(instanceId);
    return instance.get(moduleId)?.delete(key) ?? false;
  }

  /** True when the instance has at least one scene-state entry. */
  hasSceneState(instanceId: string): boolean {
    const instance = this.sceneMap.get(instanceId);
    if (!instance) return false;
    for (const module of instance.values()) {
      if (module.size > 0) return true;
    }
    return false;
  }

  /** True when the module has at least one persistent entry. */
  hasPersistentState(moduleId: string): boolean {
    const module = this.persistentMap.get(moduleId);
    if (!module) return false;
    return module.size > 0;
  }

  /** Activate a scene instance so modules can write scene state to it. */
  beginSceneInstance(instanceId: string): void {
    assertId(instanceId, 'instanceId');
    if (this.sceneMap.has(instanceId)) {
      throw new CreativeError('DUPLICATE_SCENE_INSTANCE', `scene instance "${instanceId}" is already active`, {
        phase: 'activate',
      });
    }
    this.sceneMap.set(instanceId, new Map());
  }

  private requireInstance(instanceId: string | undefined): Map<string, Map<string, unknown>> {
    if (instanceId === undefined) {
      throw new CreativeError(
        'UNKNOWN_SCENE_INSTANCE',
        'scene-instance state requires an active instanceId',
        { phase: 'command' },
      );
    }
    assertId(instanceId, 'instanceId');
    const instance = this.sceneMap.get(instanceId);
    if (!instance) {
      throw new CreativeError(
        'UNKNOWN_SCENE_INSTANCE',
        `scene instance "${instanceId}" is not active`,
        { phase: 'command' },
      );
    }
    return instance;
  }

  /**
   * Unload a scene instance: every scene-state entry for it is dropped.
   * Persistent module state is untouched — unloading a scene must never
   * clear progress.
   */
  unloadSceneInstance(instanceId: string): boolean {
    const removed = this.sceneMap.delete(instanceId);
    return removed;
  }

  get activeSceneInstanceIds(): string[] {
    return [...this.sceneMap.keys()];
  }

  /**
   * Export persistent state as a plain JSON tree (moduleId -> key ->
   * value), deep-cloned. This is the checkpointable slice of the bag.
   */
  snapshotPersistent(): Record<string, Record<string, unknown>> {
    const out: Record<string, Record<string, unknown>> = {};
    for (const [moduleId, module] of this.persistentMap) {
      const entries: Record<string, unknown> = {};
      for (const [key, value] of module) entries[key] = cloneJson(value);
      out[moduleId] = entries;
    }
    return out;
  }

  /**
   * Wholesale replacement of persistent state from a snapshot produced by
   * `snapshotPersistent`. Malformed snapshots are an honest error and leave
   * current state untouched; the replacement never merges stale keys.
   */
  restorePersistent(snapshot: unknown): void {
    const problems: string[] = [];
    if (snapshot === null || typeof snapshot !== 'object' || Array.isArray(snapshot)) {
      problems.push('snapshot: expected an object of moduleId -> entries');
    } else {
      for (const [moduleId, entries] of Object.entries(snapshot)) {
        if (entries === null || typeof entries !== 'object' || Array.isArray(entries)) {
          problems.push(`${moduleId}: expected an object of key -> value`);
          continue;
        }
        for (const [key, value] of Object.entries(entries)) {
          jsonProblems(value, `${moduleId}.${key}`, problems);
        }
      }
    }
    if (problems.length > 0) {
      throw new CreativeError('BAD_STATE_SNAPSHOT', problems.join('; '), { phase: 'command' });
    }
    const next = new Map<string, Map<string, unknown>>();
    for (const [moduleId, entries] of Object.entries(snapshot as Record<string, Record<string, unknown>>)) {
      const module = new Map<string, unknown>();
      for (const [key, value] of Object.entries(entries)) module.set(key, cloneJson(value));
      next.set(moduleId, module);
    }
    this.persistentMap.clear();
    for (const [moduleId, module] of next) this.persistentMap.set(moduleId, module);
  }
}

function assertId(value: string, field: string): void {
  if (typeof value !== 'string' || value.length === 0) {
    throw new CreativeError('BAD_STATE_KEY', `${field} must be a non-empty string`, { phase: 'command' });
  }
}

function assertJsonValue(value: unknown, path: string): void {
  const problems = jsonProblems(value, path, []);
  if (problems.length > 0) {
    throw new CreativeError('BAD_STATE_VALUE', problems.join('; '), { phase: 'command' });
  }
}

function moduleMap(
  root: Map<string, Map<string, unknown>>,
  moduleId: string,
): Map<string, unknown> {
  let module = root.get(moduleId);
  if (!module) {
    module = new Map();
    root.set(moduleId, module);
  }
  return module;
}

function cloneJson<T>(value: T): T {
  return structuredClone(value);
}

function cloneOrUndefined(value: unknown): unknown {
  return value === undefined ? undefined : structuredClone(value);
}
