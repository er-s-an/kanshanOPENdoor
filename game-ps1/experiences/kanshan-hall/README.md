# 看山任意门 · Kanshan Hall

The product's 3D front door: a dark, misty circular hall with three glowing
doors (端妃 gold / 蓝血 blue / 近视眼 teal). 刘看山 — the Zhihu mascot, built
procedurally in `src/kanshan.ts` per the official turnaround reference —
greets the player, follows them, opens doors for them, and sees them off.

## Entry

`src/scene.ts` exports `createKanshanHallModule(options?)`:
`SceneModule & { handles?: KanshanHallHandles }`. The frozen portal-host
contract (CONTRACT.md) is:

```ts
interface KanshanHallHandles {
  portalEnter: { onEnter(cb: (target: string) => void): () => void };
  reEnter(): void;
  kanshan: { state(): string };
  doors: Array<{ id: string; title: string; state(): 'closed' | 'opening' | 'open' }>;
}
```

- Door ids: `duanfei`, `blue-blood`, `myopia` (titles 端妃 / 蓝血 / 近视眼).
- `portalEnter.onEnter` fires exactly once per committed `portal.enter`
  (`{ target }`, eventId `portal:enter:<id>`); subscribing never replays.
- `reEnter()` is called by the host after returning from a world: the white
  fade clears and 看山 greets near the door the player left by. No duplicate
  `portal.enter` commit is possible (per-door, per-session).
- Target-page mapping (`end-consort.html` / `blue-blood.html` /
  `index.html`) is the host's concern; recorded in `experience.json` params
  for reference only.

## Files

- `src/kanshan.ts` — procedural 刘看山 (body/ears/nose/eyes/arms/legs/tail,
  sin-based idle/walk/wave/openDoor/sit, `setYawToward`).
- `src/hall.ts` — environment: floor disc + ring inlays, mist
  (ParticleEmitter), floating shards (InstancedMesh), door assemblies (frame,
  hinged leaf, emissive portal plane, plaque textures, point light), entry
  door with intro crack-of-light. Headless-safe texture loading.
- `src/dialogue.ts` — subtitle lines keyed by beat. ⚠️ DRAFT, pending review.
- `src/scene.ts` — SceneModule: intro timeline (skippable, finish policy),
  guide FSM (follow → opening → seeoff), first-person wiring, HUD, synth
  audio, `exposeParameters` (`kanshan-hall.mist-density`, `kanshan-hall.door-glow`).
- `assets/` — 3 project-owned plaque images (知乎 IP 授权范围内, see source.json).

## Offline verification

```
node --test test/creative/work-kanshan-hall.test.ts
```
