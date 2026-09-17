# Architecture decisions (R1)

Living record. Each entry: decision, alternatives, consequences, status.

## AD-01 Physics adapter: @dimforge/rapier3d-compat pinned 0.20.0
- Status: DECIDED 2026-09-16 (M0).
- Verified on machine: `await RAPIER.init()` works headless in Node v25.9.0; `World`,
  `createCharacterController(offset)` with `setMaxSlopeClimbAngle`/`enableSnapToGround`,
  `castRay`, `castRayAndGetNormal`, `castShape`, `intersectionsWithRay` all present (smoke run, M0).
- License: Apache-2.0 (package.json of installed dist).
- Size: ~11 MB unpacked; single-file ESM with WASM inlined as base64 → bundles offline with Vite,
  no network fetch at runtime, no separate .wasm asset pipeline needed.
- Version choice: 0.12.0 was present extraneously in node_modules (not declared); latest is 0.20.0
  (2026-08). Pinned exact 0.20.0 via `--save-exact` for 4 years of character-controller fixes.
- Tree-shaking rule: only `creative/physics/**` may import it; works that never import physics
  must not get the WASM in their bundle (G01 check via bundle diff).
- Rejected: cannon-es (unmaintained), custom AABB-only (cannot do slopes/steps/moving platforms,
  and acceptance forbids fake colliders), Rapier non-compat `@dimforge/rapier3d` (separate .wasm
  loading complicates offline static export).

## AD-02 Single simulation clock, fixed step 1/60 default
- `SimulationClock` (creative/core/clock.ts): accumulator + maxCatchUpSteps (default 5) +
  maxFrameTime (0.25 s) + discardedTime diagnostics. Pause freezes sim time; resume(realNow)
  re-bases, so no giant catch-up dt. Manual `stepOnce` for controlled sessions only.
- Phase order per fixed step: input → intent → physics → mechanics → present (PHASE_ORDER,
  errors.ts). Module `update()` runs inside `mechanics` (after intent/physics hooks).
  `render()` hook runs interpolation with commits disabled (COMMIT_IN_RENDER).
- Not claimed: cross-browser/CPU physics determinism. Fixed step != deterministic replay.

## AD-03 Transform authority (write-access) model
- Declared, not yet enforced by systems (M2/M3 bind them): dynamic rigid body root = PhysicsWorld;
  player/NPC root = controller + physics correction (navigation gives intent only); kinematic
  mechanisms = mechanism phase + kinematic target (timeline gives target; collider and render pose
  share one source); cosmetic-only objects free; camera = active rig with control token.
- M0 implements the enforcement points: phase hooks + render-phase commit rejection.
  Physics/controller systems in M2 must route root motion through the adapter.

## AD-04 Identity: three histories, three digests
- `experienceDigest` (creative/core/identity.ts): canonical digest over {format, formatVersion,
  runtimeApiVersion, checkpointSchemaVersion, code files (relative logical paths only), params,
  asset content digests, sourceRecord}. Absolute/escaping paths rejected, never hashed. No build
  time, no machine paths, no logs/reports/self-reference — by construction (no such input fields).
- `artifactDigest`: bytes of emitted artifact (export integrity). `buildId`: task tracking only.
- Author undo, player checkpoint, revision/build are separate histories (S13/S14);
  author commands carry baseRevision + parameterSchemaVersion + commandId (protocol frozen in M5a).
- Reuses `canonicalJson`/`sha256Hex` from @kanshan/story-contract (single canonical primitive).
  The legacy studio `util.mjs` digest discrepancy (inventory finding) is a legacy-path defect to
  fix in M5 when wiring studio to the new identity, not by changing the canonical primitive.

## AD-05 RuntimeSessionHost protocol (M0 core frozen)
- In-process host (creative/core/host.ts) loads a SceneModule with an injectable THREE.Scene;
  headless sessions need no DOM/WebGL for the simulation part. Modes: `auto` (advance(realNow))
  and `controlled` (step(n) only). Manual step rejected while auto-running; advance rejected in
  controlled mode; stop() fences generation, invalidates handles, disposes scope.
- Queries are bounded (default 200, cap 1000, truncated flag) and read-only; object handles are
  session-scoped and cleared on stop.
- M5 will add: transport (CLI/JSON first), module loading from built bundles, persistence.
  Browser bridge consumes the same protocol; renderer/audio outputs are replaceable adapters,
  gameplay/colliders are not.

## AD-06 Exception isolation (G02.a)
- create/update/destroy throw → session enters `error`, scope still disposes (cleanup errors
  collected, not thrown through), diagnostics carry phase + best-effort source location
  (first non-runtime stack frame). Other sessions unaffected (each has own scope/scene/clock).

## AD-07 Node/runtime and TS test strategy
- Repo engines: node >=24. Machine default `node` is v22.0.0 (fails engines); all R1 commands run
  with /opt/homebrew/bin/node v25.9.0 on PATH. Recorded as environment deviation, not silently
  "fixed" by changing engines.
- Tests are TypeScript run via Node type-stripping (`node --test test/creative/*.test.ts`).
  Creative core is written in erasable-TS only (no enums/namespaces/parameter properties).
  tsc (5.9.3) type-checks with allowImportingTsExtensions + noEmit; Vite builds the same sources.

## AD-08 No global entity registry / no JSON DSL
- SceneModule = plain TS exporting create(ctx). Helpers are optional function libraries.
  Systems bind via small interfaces (physics body, mixer, sound, nav agent, persisted state,
  author parameter). Confirmed against ENGINE-SYSTEMS §1; no ECS layer will be added.

## AD-09 外部审计响应（2026-09-17，针对 de8c066）

独立审计（ENGINE-AUDIT-AND-ROADMAP.zh-CN.md）在 de8c066 上复现了两处导出 P0。全部核验并修复，修复后新增/更新测试均真实失败过再变绿：

- **F01** exportBundle 引用未定义 `outDir`（rapier 扫描从错误的裸变量读取 staging 路径）→ 改用 `staged`（report.outDir）。修复前：真实 CLI export 与 tools-build 的 4 项导出测试全部以 exit 5 失败（证据：修复前重跑记录）。**教训：先前一次 519/519 全绿的汇总运行与随后同字节代码的确定性失败并存，无法从代码状态解释；已把导出类断言加固为真实 CLI 全链路（补丁→导出→浏览器机制等价），不再依赖单次绿灯。**
- **F02/F03** 摘要调用方传 `{path:bytes}` 对象而 helper 期望 `Map<path,Buffer>`（TypeError），且摘要输入不含路径/字节元数据 → digestOverFiles 改为真实目录 + 规范清单 `[{path,bytes,sha256(file)}]+bytes`；新增防篡改测试（改 1 字节/改名均改变 digest）。
- **F04** 导出 HTML 写入 `__KANSHAN_BOOT__` 与 `params.overrides.json`，但 browser-player 未消费 → browser-player 现读取两者：宿主 identity 绑定导出 digest/buildId；覆盖参数经 registry 校验应用。新增 browser-config.test.ts（真实 Chromium）：同一参数补丁在 headless 与浏览器产生一致机制行为（窄门挡/宽门过），并断言宿主 identity 与 export report 一致。
- **F05** browser-player 返回 `Promise<void>` 无销毁契约；震屏/白闪用 fixedDt 推进（帧率相关）→ 返回 `{host,renderer,pipeline,camera,destroy()}`；表现时钟改用真实帧 dt，模拟仍走固定步。boot 入口暴露 `globalThis.__kanshanPlayer` 供受控测试。
- **F06** CI 分支为 main（实为 codex/initial-upload）且不跑 test:creative；tools-build 测试断言 HTML 不含 digest 与实现矛盾 → CI 覆盖两分支 + test:creative + skill 集成 + verify-ps1-engine；测试契约改为「digest/buildId 是完整性值允许公开；秘密形状(bearer/password/secret/api_key/authorization)与 sessionId 禁止」，并附种植 token 的反例测试。
- **F07** capabilities 把测试文件正则计数表述得像「测试通过」→ 拆分 implemented(源码存在) / testDiscovery(静态计数) / runRecord(读取汇总 runner 的 results.json；缺失=unknown)。GPU/FPS/截图仍 NOT_MEASURED。
- **F08** vite 不类型检查；新 experience 不在 tsconfig include → 新增 `check --experience` 命令（生成 tsconfig 对真实入口+引擎源码跑 tsc，三作品与 fixture 全绿）；wrapper 与 build-debug.md 已登记。
- **F09** b01 保持为启动 smoke（命名与文档明确其证据边界）；更强的输入→状态因果断言由 browser-config.test.ts 承担。

附带修复：RuntimeSessionHost 补 `report()`（daemon/browser-player 的 PARAM_OVERRIDE_REJECTED 路径此前会在拒绝时抛 `host.report is not a function`）；narrow-gate fixture 浏览器模式误用 HeadlessInputDevice（F04 测试实证）；author patch 必须先读 head 的用法已在测试中固化。

未做（审计路线图后续阶段，需另行排期）：PR-04 受控 preview/observe/playtest 服务化、PR-05 doctor/scaffold/recipes、PR-06 美术资产 intake、PR-07 recipes 库、PR-08 导航 clearance、PR-09 陌生故事冻结评测。
