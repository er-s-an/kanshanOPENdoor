import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createInteractionSystem } from '../../src/creative/interaction/system.ts';
import type { Interactable, InteractionEvent, RaycastFn } from '../../src/creative/interaction/system.ts';
import type { ActionState } from '../../src/creative/core/input-types.ts';
import type { Vec3 } from '../../src/creative/core/spatial.ts';
import type { QueryOptions, RayHit } from '../../src/creative/physics/world.ts';
import { CreativeError } from '../../src/creative/core/errors.ts';

function makeActions(partial: { pressed?: string[] } = {}): ActionState {
  return {
    pressed: (a) => partial.pressed?.includes(a) ?? false,
    held: () => false,
    released: () => false,
    axis: () => 0,
  };
}

interface Probe {
  item: Interactable;
  focusCount: number;
  blurCount: number;
  interactions: InteractionEvent[];
}

/** A registered interactable with focus/blur/interact counters. `position` is live by reference. */
function probe(id: string, position: Vec3 = [0, 0, 0], opts: Partial<Interactable> = {}): Probe {
  const p: Probe = { item: undefined as unknown as Interactable, focusCount: 0, blurCount: 0, interactions: [] };
  p.item = {
    id,
    getPosition: () => position,
    radius: 5,
    onFocus: () => {
      p.focusCount += 1;
    },
    onBlur: () => {
      p.blurCount += 1;
    },
    onInteract: (e: InteractionEvent) => {
      p.interactions.push(e);
    },
    ...opts,
  };
  return p;
}

interface RayCall {
  origin: Vec3;
  dir: Vec3;
  max: number;
  opts?: QueryOptions;
}

/** Scripted raycast: always reports `hit`, recording every call. */
function scriptedRaycast(hit: RayHit | null, calls: RayCall[] = []): RaycastFn {
  return (origin, dir, maxDistance, opts) => {
    calls.push({ origin: [...origin] as Vec3, dir: [...dir] as Vec3, max: maxDistance ?? -1, opts });
    return hit;
  };
}

function blocker(distance: number): RayHit {
  return { bodyId: 'blocker', colliderHandle: 9, distance, point: [distance, 0, 0], normal: [-1, 0, 0] };
}

test('interaction: the nearest in-range candidate focuses; walking out of range blurs it', () => {
  const system = createInteractionSystem();
  const near = probe('near', [1, 0, 0]);
  const far = probe('far', [2, 0, 0]);
  system.register(near.item);
  system.register(far.item);
  assert.equal(system.size, 2);

  const focused = system.update(1 / 60, { position: [0, 0, 0] }, makeActions());
  assert.equal(focused.candidateId, 'near');
  assert.equal(system.focusedId, 'near');
  assert.equal(near.focusCount, 1, 'onFocus fires on gaining focus');
  assert.equal(far.focusCount, 0, 'the loser never focuses');

  near.item.getPosition = () => [50, 0, 0];
  const blurred = system.update(1 / 60, { position: [0, 0, 0] }, makeActions());
  assert.equal(blurred.candidateId, 'far', 'the remaining candidate takes focus');
  assert.equal(near.blurCount, 1, 'onBlur fires exactly once on focus loss');
  assert.equal(far.focusCount, 1);
});

test('interaction: range is inclusive at exactly radius; beyond it there is no candidate', () => {
  const system = createInteractionSystem();
  const edge = probe('edge', [3, 0, 0]);
  edge.item.radius = 3;
  system.register(edge.item);
  const at = system.update(1 / 60, { position: [0, 0, 0] }, makeActions());
  assert.equal(at.candidateId, 'edge', 'distance == radius is still a candidate');

  edge.item.getPosition = () => [3.001, 0, 0];
  const out = system.update(1 / 60, { position: [0, 0, 0] }, makeActions());
  assert.equal(out.candidateId, null);
  assert.equal(system.focusedId, null);
  assert.equal(edge.blurCount, 1);
});

test('interaction: a candidate exactly at the eye position is degenerate and skipped', () => {
  const system = createInteractionSystem();
  const coin = probe('coin', [0, 0, 0]);
  system.register(coin.item);
  const out = system.update(1 / 60, { position: [0, 0, 0] }, makeActions());
  assert.equal(out.candidateId, null, 'zero distance has no direction; never a candidate');
});

test('interaction: facingDot gates candidates on the observer forward', () => {
  const system = createInteractionSystem();
  const sign = probe('sign', [3, 0, 0]);
  sign.item.facingDot = 0.5;
  system.register(sign.item);

  const ahead = system.update(1 / 60, { position: [0, 0, 0], forward: [1, 0, 0] }, makeActions());
  assert.equal(ahead.candidateId, 'sign', 'dead ahead passes a 0.5 gate');

  const behind = system.update(1 / 60, { position: [0, 0, 0], forward: [-1, 0, 0] }, makeActions());
  assert.equal(behind.candidateId, null, 'facing away fails the dot gate');
  assert.equal(sign.blurCount, 1);

  const noForward = system.update(1 / 60, { position: [0, 0, 0] }, makeActions());
  assert.equal(noForward.candidateId, null, 'a facing-gated candidate requires a forward vector');

  const zeroForward = system.update(1 / 60, { position: [0, 0, 0], forward: [0, 0, 0] }, makeActions());
  assert.equal(zeroForward.candidateId, null, 'a zero forward vector is not a direction');

  sign.item.facingDot = -1; // any direction passes
  const anywhere = system.update(1 / 60, { position: [0, 0, 0], forward: [0, 0, -1] }, makeActions());
  assert.equal(anywhere.candidateId, 'sign');
});

test('interaction: the press edge dispatches exactly once per press to the focused candidate', () => {
  const system = createInteractionSystem();
  const chest = probe('chest', [2, 0, 0]);
  system.register(chest.item);

  const press = system.update(1 / 60, { position: [0, 0, 0] }, makeActions({ pressed: ['interact'] }));
  assert.equal(press.candidateId, 'chest');
  assert.equal(chest.interactions.length, 1, 'first focus + same-step press dispatches immediately');
  assert.deepEqual(press.dispatched, { interactableId: 'chest', sourcePosition: [0, 0, 0] });

  const held = system.update(1 / 60, { position: [0, 0, 0] }, makeActions());
  assert.equal(held.dispatched, null);
  assert.equal(chest.interactions.length, 1, 'inert steps dispatch nothing');

  const again = system.update(1 / 60, { position: [0, 0, 0] }, makeActions({ pressed: ['interact'] }));
  assert.equal(chest.interactions.length, 2, 'a fresh press edge dispatches again');
  assert.equal(again.dispatched?.interactableId, 'chest');
});

test('interaction: a press with no focused candidate dispatches nothing', () => {
  const system = createInteractionSystem();
  const out = system.update(1 / 60, { position: [0, 0, 0] }, makeActions({ pressed: ['interact'] }));
  assert.equal(out.candidateId, null);
  assert.equal(out.dispatched, null);

  const ghost = probe('ghost', [50, 0, 0]);
  system.register(ghost.item);
  const far = system.update(1 / 60, { position: [0, 0, 0] }, makeActions({ pressed: ['interact'] }));
  assert.equal(far.dispatched, null, 'out-of-range candidates receive nothing');
  assert.equal(ghost.interactions.length, 0);
});

test('interaction: switching to a nearer candidate blurs the old focus before focusing the new', () => {
  const system = createInteractionSystem();
  const aPos: Vec3 = [1, 0, 0];
  const bPos: Vec3 = [2, 0, 0];
  const a = probe('a', aPos);
  const b = probe('b', bPos);
  system.register(a.item);
  system.register(b.item);

  system.update(1 / 60, { position: [0, 0, 0] }, makeActions());
  assert.equal(system.focusedId, 'a');

  bPos[0] = 0.5; // b becomes the nearest
  const switched = system.update(1 / 60, { position: [0, 0, 0] }, makeActions());
  assert.equal(switched.candidateId, 'b');
  assert.equal(a.blurCount, 1, 'the old candidate blurs');
  assert.equal(b.focusCount, 1, 'the new candidate focuses');
});

test('interaction: distance ties break by priority, then by id', () => {
  const byPriority = createInteractionSystem();
  const low = probe('low', [2, 0, 0]);
  const high = probe('high', [2, 0, 0]);
  low.item.priority = 0;
  high.item.priority = 10;
  byPriority.register(low.item);
  byPriority.register(high.item);
  const picked = byPriority.update(1 / 60, { position: [0, 0, 0] }, makeActions());
  assert.equal(picked.candidateId, 'high', 'higher priority wins an exact distance tie');

  const byId = createInteractionSystem();
  const zed = probe('zed', [2, 0, 0]);
  const alpha = probe('alpha', [2, 0, 0]);
  byId.register(zed.item);
  byId.register(alpha.item);
  const ordered = byId.update(1 / 60, { position: [0, 0, 0] }, makeActions());
  assert.equal(ordered.candidateId, 'alpha', 'equal priority falls back to the lower id');
});

test('interaction: a custom action name selects which press edge dispatches', () => {
  const system = createInteractionSystem({ action: 'use' });
  const lever = probe('lever', [1, 0, 0]);
  system.register(lever.item);

  system.update(1 / 60, { position: [0, 0, 0] }, makeActions({ pressed: ['interact'] }));
  assert.equal(lever.interactions.length, 0, "the default 'interact' edge is inert for action 'use'");

  system.update(1 / 60, { position: [0, 0, 0] }, makeActions({ pressed: ['use'] }));
  assert.equal(lever.interactions.length, 1, 'the configured action dispatches');
});

test('interaction: eyeOffset shifts the observation point and the reported sourcePosition', () => {
  const system = createInteractionSystem({ eyeOffset: [0, 1, 0] });
  const shelf = probe('shelf', [0, 1, 3]);
  shelf.item.radius = 3.05;
  system.register(shelf.item);

  const plain = createInteractionSystem();
  const control = probe('shelf', [0, 1, 3]);
  control.item.radius = 3.05;
  plain.register(control.item);
  const without = plain.update(1 / 60, { position: [0, 0, 0] }, makeActions());
  assert.equal(without.candidateId, null, 'without the offset the shelf is just out of radius');

  const withOffset = system.update(1 / 60, { position: [0, 0, 0] }, makeActions({ pressed: ['interact'] }));
  assert.equal(withOffset.candidateId, 'shelf', 'from the eye position the shelf is in range');
  assert.deepEqual(withOffset.dispatched?.sourcePosition, [0, 1, 0], 'the event reports the eye, not the feet');
});

test('interaction: occlusion disqualifies on a nearer blocker and honors bodyId exclusion', () => {
  const calls: RayCall[] = [];
  const system = createInteractionSystem({ raycast: scriptedRaycast(null, calls) });
  const chest = probe('chest', [3, 0, 0]);
  chest.item.occludable = true;
  chest.item.bodyId = 'chest-body';
  system.register(chest.item);

  const clear = system.update(1 / 60, { position: [0, 0, 0] }, makeActions());
  assert.equal(clear.candidateId, 'chest', 'a clear ray leaves the candidate eligible');
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].origin, [0, 0, 0]);
  assert.deepEqual(calls[0].dir, [1, 0, 0], 'ray aims observer -> candidate');
  assert.equal(calls[0].max, 3, 'ray length is the observer-candidate distance');
  assert.equal(calls[0].opts?.excludeBody, 'chest-body', 'the candidate excludes its own body');

  const blockedCalls: RayCall[] = [];
  const blocked = createInteractionSystem({ raycast: scriptedRaycast(blocker(1.5), blockedCalls) });
  blocked.register(probe('chest', [3, 0, 0], { occludable: true }).item);
  const occluded = blocked.update(1 / 60, { position: [0, 0, 0] }, makeActions());
  assert.equal(occluded.candidateId, null, 'a blocker well inside the candidate disqualifies it');

  // A hit within epsilon of the candidate's distance is its own surface: eligible.
  const grazingCalls: RayCall[] = [];
  const grazing = createInteractionSystem({ raycast: scriptedRaycast(blocker(3 - 0.0005), grazingCalls) });
  grazing.register(probe('chest', [3, 0, 0], { occludable: true }).item);
  const grazed = grazing.update(1 / 60, { position: [0, 0, 0] }, makeActions());
  assert.equal(grazed.candidateId, 'chest', 'a hit inside the epsilon tolerance does not block');
  assert.equal(grazingCalls.length, 1);
});

test('interaction: register validation (id, radius, facingDot, occludable raycast)', () => {
  const system = createInteractionSystem();
  assert.throws(
    () => system.register(probe('', [0, 0, 0]).item),
    (err: unknown) => err instanceof CreativeError && err.code === 'INTERACT_INVALID',
  );
  assert.throws(
    () => system.register(probe('bad-radius', [0, 0, 0], { radius: 0 }).item),
    (err: unknown) => err instanceof CreativeError && err.code === 'INTERACT_INVALID',
  );
  assert.throws(
    () => system.register(probe('nan-radius', [0, 0, 0], { radius: Number.NaN }).item),
    (err: unknown) => err instanceof CreativeError && err.code === 'INTERACT_INVALID',
  );
  assert.throws(
    () => system.register(probe('bad-facing', [0, 0, 0], { facingDot: 1.5 }).item),
    (err: unknown) => err instanceof CreativeError && err.code === 'INTERACT_INVALID',
  );
  const first = probe('dup', [0, 0, 0]);
  system.register(first.item);
  assert.throws(
    () => system.register(probe('dup', [1, 0, 0]).item),
    (err: unknown) => err instanceof CreativeError && err.code === 'INTERACT_DUPLICATE',
  );

  const noRay = createInteractionSystem();
  assert.throws(
    () => noRay.register(probe('occluded', [0, 0, 0], { occludable: true }).item),
    (err: unknown) => err instanceof CreativeError && err.code === 'INTERACT_NO_RAYCAST',
    'an occludable candidate requires a raycast at registration time',
  );
});

test('interaction: unregistering the focused candidate blurs it and stops dispatch', () => {
  const system = createInteractionSystem();
  const shrine = probe('shrine', [1, 0, 0]);
  const unregister = system.register(shrine.item);
  system.update(1 / 60, { position: [0, 0, 0] }, makeActions());
  assert.equal(system.focusedId, 'shrine');

  unregister();
  assert.equal(system.size, 0);
  assert.equal(system.focusedId, null);
  assert.equal(shrine.blurCount, 1, 'removal blurs a focused candidate');

  const out = system.update(1 / 60, { position: [0, 0, 0] }, makeActions({ pressed: ['interact'] }));
  assert.equal(out.candidateId, null);
  assert.equal(shrine.interactions.length, 0, 'a removed candidate can never receive dispatch');
});

test('interaction: enabled=false (value or live fn) removes the candidate and blurs on the way out', () => {
  const system = createInteractionSystem();
  let flag = true;
  const gate = probe('gate', [1, 0, 0], { enabled: () => flag });
  system.register(gate.item);
  system.update(1 / 60, { position: [0, 0, 0] }, makeActions());
  assert.equal(system.focusedId, 'gate');

  flag = false;
  const off = system.update(1 / 60, { position: [0, 0, 0] }, makeActions({ pressed: ['interact'] }));
  assert.equal(off.candidateId, null, 'a disabled interactable is never a candidate');
  assert.equal(gate.blurCount, 1, 'disabling under focus blurs it');
  assert.equal(gate.interactions.length, 0);

  flag = true;
  const on = system.update(1 / 60, { position: [0, 0, 0] }, makeActions());
  assert.equal(on.candidateId, 'gate', 're-enabling restores candidacy');

  const staticOff = createInteractionSystem();
  staticOff.register(probe('off', [1, 0, 0], { enabled: false }).item);
  assert.equal(staticOff.update(1 / 60, { position: [0, 0, 0] }, makeActions()).candidateId, null);
});
