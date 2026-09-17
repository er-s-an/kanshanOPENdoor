# 看山任意门 · Kanshan Hall

The product's 3D front door: a bright, slightly dreamy Zhihu-brand circular
hall (blue-white palette — near-white glossy floor with blue ring inlays,
slim white columns with blue capital bands, translucent blue crystals, and
three white door arches whose 端妃 gold / 蓝血 blue / 近视眼 teal glow is the
wayfinding accent). 刘看山 — the Zhihu mascot, built procedurally in
`src/kanshan.ts` per the official turnaround reference — peeks out of the
entry door, greets the player, then free-roams the hall on his own; when the
player lingers at a closed door he runs over, opens it for them, and sees
them off.

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
  fade clears and 看山 greets beside the door the player left by. No
  duplicate `portal.enter` commit is possible (per-door, per-session).
- Target-page mapping (`end-consort.html` / `blue-blood.html` /
  `index.html`) is the host's concern; recorded in `experience.json` params
  for reference only.

## Behavior notes

- `kanshan.state()` returns `'intro' | 'roam' | 'to-door:<id>' |
  'opening:<id>' | 'seeoff'`. He roams a waypoint ring on a deterministic
  RNG, never tracks the player (1.2m hard minimum distance), and interrupts
  the roam for door runs.
- Intro (skippable, cancelPolicy 'finish'): near-black hall → blue-white
  crack of light in the entry door → doorway opens → 看山 peeks (head +
  ears, ~0.9s) → steps out, waves → hall lighting ramps up around him.
- His dialogue renders as a DOM bubble (class `kanshan-say`) projected
  above his head, falling back to the HUD subtitle when he is off-camera or
  >9m away; `handles.headSubtitle.text()` reports the current line
  regardless of channel.
- `handles.lightingRamp()` exposes the hall light ramp 0..1 (intro).

## Files

- `src/kanshan.ts` — procedural 刘看山 (body/ears/nose/eyes/arms/legs/tail,
  sin-based idle/walk/wave/openDoor/sit/peek, `setYawToward`).
- `src/hall.ts` — environment: glossy light floor + blue ring inlays +
  pulsing center ring, column ring, translucent blue crystals (slow bob +
  spin), door assemblies (white frame, blue trim, hinged leaf, emissive
  portal plane, plaque textures, point light), entry door with intro crack
  of light, light ramp. Headless-safe texture loading.
- `src/headsay.ts` — above-head subtitle bubble with HUD fallback.
- `src/dialogue.ts` — subtitle lines keyed by beat. ⚠️ DRAFT, pending review.
- `src/scene.ts` — SceneModule: intro timeline (skippable, finish policy),
  roam/door FSM, first-person wiring, HUD + head subtitles, synth audio,
  `exposeParameters` (`kanshan-hall.door-glow`).
- `assets/` — 3 project-owned plaque images (知乎 IP 授权范围内, see source.json).

## Offline verification

```
node --test test/creative/work-kanshan-hall.test.ts
```
