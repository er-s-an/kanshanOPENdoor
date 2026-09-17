/**
 * Interaction system (interaction half of roadmap S12, gate G12 trigger):
 * proximity-based interactable selection and one-shot dispatch.
 *
 * Works register interactables (a live position + radius + optional facing
 * dot + optional occlusion raycast). Once per fixed step the system scores
 * every registered candidate from the observer position, picks the best
 * (nearest; ties by priority then id), tracks focus across steps (focus/blur
 * callbacks), and — only while a candidate is focused — dispatches the
 * 'interact' ActionState PRESS EDGE to that candidate's author handler.
 * Exactly one dispatch per press: held steps after the edge are inert.
 * Losing every candidate (walked away, turned around, occluded, blurred)
 * clears the current candidate before any dispatch is considered.
 *
 * The occlusion raycast is injected and matches PhysicsWorld.raycast; it is
 * only required when at least one registered interactable opts into
 * occlusion. This module never imports physics at runtime.
 */
import { CreativeError } from '../core/errors.ts';
import type { Vec3 } from '../core/spatial.ts';
import type { ActionState } from '../core/input-types.ts';
import type { QueryOptions, RayHit } from '../physics/world.ts';

/** Injectable raycast matching PhysicsWorld.raycast (world.ts). */
export type RaycastFn = (
  origin: Vec3,
  direction: Vec3,
  maxDistance?: number,
  opts?: QueryOptions,
) => RayHit | null;

/** The observer each step: a position plus an optional forward (-Z) vector. */
export interface InteractSource {
  position: Vec3;
  /** Normalized forward; required by candidates that set facingDot. */
  forward?: Vec3;
}

export interface InteractionEvent {
  interactableId: string;
  sourcePosition: Vec3;
}

export interface Interactable {
  id: string;
  /** Live world position (e.g. () => object.position.toArray() as Vec3). */
  getPosition(): Vec3;
  /** Candidate only while the observer is within this radius. */
  radius: number;
  /**
   * Optional facing gate: the observer forward dotted with the normalized
   * direction to the candidate must be >= this value (1 = dead ahead).
   */
  facingDot?: number;
  /** Optional self-exclusion body id for the occlusion ray. */
  bodyId?: string;
  /**
   * When true, an injected occlusion ray from observer to candidate must be
   * clear; a nearer blocker disqualifies the candidate. Requires the system
   * to have been created with a raycast.
   */
  occludable?: boolean;
  /** Tie-break beyond distance: higher priority wins. Default 0. */
  priority?: number;
  /** Static or live enable switch; disabled interactables are never candidates. */
  enabled?: boolean | (() => boolean);
  onFocus?(): void;
  onBlur?(): void;
  onInteract(event: InteractionEvent): void;
}

export interface InteractionUpdate {
  /** Best candidate this step, or null (no eligible candidate). */
  candidateId: string | null;
  /** Non-null exactly when a press edge was dispatched this step. */
  dispatched: InteractionEvent | null;
}

export interface InteractionSystemOptions {
  /** Action whose press edge dispatches. Default 'interact'. */
  action?: string;
  /** Required iff any registered interactable sets occludable: true. */
  raycast?: RaycastFn;
  /** Added to the observer position for distance/facing/occlusion. Default none. */
  eyeOffset?: Vec3;
  /** Occlusion hit tolerance: a blocker closer than distance - epsilon wins. Default 1e-3. */
  epsilon?: number;
}

export interface InteractionSystem {
  register(interactable: Interactable): () => void;
  /** Current focused candidate id (focus is per-step recomputed). */
  readonly focusedId: string | null;
  readonly size: number;
  update(dt: number, source: InteractSource, actions: ActionState): InteractionUpdate;
}

class InteractionSystemImpl implements InteractionSystem {
  private readonly interactables = new Map<string, Interactable>();
  private focused: Interactable | null = null;
  private readonly opts: InteractionSystemOptions;

  constructor(opts: InteractionSystemOptions) {
    this.opts = opts;
  }

  get focusedId(): string | null {
    return this.focused?.id ?? null;
  }

  get size(): number {
    return this.interactables.size;
  }

  register(interactable: Interactable): () => void {
    if (!interactable.id) {
      throw new CreativeError('INTERACT_INVALID', 'register: interactable id must be non-empty', { phase: 'create' });
    }
    if (this.interactables.has(interactable.id)) {
      throw new CreativeError('INTERACT_DUPLICATE', `register: duplicate interactable id "${interactable.id}"`, {
        phase: 'create',
      });
    }
    if (!Number.isFinite(interactable.radius) || interactable.radius <= 0) {
      throw new CreativeError('INTERACT_INVALID', `register: interactable "${interactable.id}" radius must be > 0`, {
        phase: 'create',
      });
    }
    if (interactable.facingDot !== undefined && (interactable.facingDot < -1 || interactable.facingDot > 1)) {
      throw new CreativeError('INTERACT_INVALID', `register: interactable "${interactable.id}" facingDot must be in [-1, 1]`, {
        phase: 'create',
      });
    }
    if (interactable.occludable && !this.opts.raycast) {
      throw new CreativeError(
        'INTERACT_NO_RAYCAST',
        `register: interactable "${interactable.id}" is occludable but the system was created without a raycast`,
        { phase: 'create' },
      );
    }
    this.interactables.set(interactable.id, interactable);
    return () => {
      const removed = this.interactables.delete(interactable.id);
      if (removed && this.focused === interactable) {
        this.focused.onBlur?.();
        this.focused = null;
      }
    };
  }

  update(_dt: number, source: InteractSource, actions: ActionState): InteractionUpdate {
    const eye = this.eye(source.position);
    const epsilon = this.opts.epsilon ?? 1e-3;

    let best: Interactable | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const candidate of this.interactables.values()) {
      if (!this.isEnabled(candidate)) continue;
      const position = candidate.getPosition();
      const d = dist(eye, position);
      if (d > candidate.radius || d < 1e-9) continue;
      if (!this.facingOk(candidate, source, eye, position, d)) continue;
      if (!this.occlusionOk(candidate, eye, position, d, epsilon)) continue;
      if (
        best === null ||
        d < bestDistance - epsilon ||
        (Math.abs(d - bestDistance) <= epsilon && this.tieBreak(candidate, best) < 0)
      ) {
        best = candidate;
        bestDistance = d;
      }
    }

    // Focus transitions happen BEFORE dispatch: focus loss clears the current
    // candidate, and a press on a focus-less step dispatches nothing.
    if (best !== this.focused) {
      this.focused?.onBlur?.();
      this.focused = best;
      best?.onFocus?.();
    }

    let dispatched: InteractionEvent | null = null;
    if (this.focused && actions.pressed(this.opts.action ?? 'interact')) {
      dispatched = { interactableId: this.focused.id, sourcePosition: [eye[0], eye[1], eye[2]] };
      this.focused.onInteract(dispatched);
    }
    return { candidateId: this.focused?.id ?? null, dispatched };
  }

  private eye(position: Vec3): Vec3 {
    const offset = this.opts.eyeOffset;
    return offset ? [position[0] + offset[0], position[1] + offset[1], position[2] + offset[2]] : position;
  }

  private isEnabled(candidate: Interactable): boolean {
    return typeof candidate.enabled === 'function' ? candidate.enabled() : (candidate.enabled ?? true);
  }

  private facingOk(
    candidate: Interactable,
    source: InteractSource,
    eye: Vec3,
    position: Vec3,
    d: number,
  ): boolean {
    if (candidate.facingDot === undefined) return true;
    const forward = source.forward;
    if (!forward) return false;
    const len = Math.hypot(forward[0], forward[1], forward[2]);
    if (len < 1e-9) return false;
    const dot =
      (forward[0] / len) * ((position[0] - eye[0]) / d) +
      (forward[1] / len) * ((position[1] - eye[1]) / d) +
      (forward[2] / len) * ((position[2] - eye[2]) / d);
    return dot >= candidate.facingDot;
  }

  private occlusionOk(candidate: Interactable, eye: Vec3, position: Vec3, d: number, epsilon: number): boolean {
    if (!candidate.occludable) return true;
    const raycast = this.opts.raycast;
    if (!raycast) return true; // registration guarantees a raycast exists
    const dir: Vec3 = [(position[0] - eye[0]) / d, (position[1] - eye[1]) / d, (position[2] - eye[2]) / d];
    const query: QueryOptions | undefined = candidate.bodyId ? { excludeBody: candidate.bodyId } : undefined;
    const hit = raycast(eye, dir, d, query);
    return !(hit && hit.distance < d - epsilon);
  }

  private tieBreak(a: Interactable, b: Interactable): number {
    const pa = a.priority ?? 0;
    const pb = b.priority ?? 0;
    if (pa !== pb) return pb - pa; // higher priority first
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  }
}

export function createInteractionSystem(opts: InteractionSystemOptions = {}): InteractionSystem {
  return new InteractionSystemImpl(opts);
}

function dist(a: Vec3, b: Vec3): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}
