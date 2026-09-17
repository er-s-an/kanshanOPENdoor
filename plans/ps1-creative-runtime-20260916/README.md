# PS1 Creative Runtime：让 Agent 写场景，引擎提供底座

> 后续规划已扩展：用户认可本架构，并要求补齐常见游戏引擎功能。最新完整范围见[引擎能力路线图 R1](ENGINE-ROADMAP.md)和[Kimi 引擎提示词](KIMI-ENGINE-PROMPT.md)。本文件的自由创作/生命周期/身份原则继续生效；新 M0–M7 吸收原 F0–F5，不重复施工。

2026-09-16 · 规划提案，未实施、未运行产品验收。

入口：[验收与对比](ACCEPTANCE.md) · [交给 Kimi 的提示词](KIMI-PROMPT.md)。本方案修订了[上一版迭代规划](../ps1-iteration-20260916/README.md)，不把上一版全部工作包作为本轮前置。

## 1. 决策：从模板播放器转为代码优先的创作底座

用户指出的问题成立：目前的稳定性很大程度来自缩小表达范围。我们没有测得“效果比直接 Three.js 差”的量化结论，但源码确实把不同作品压进同一种空间与交互语法。

| 当前证据 | 对创作的影响 |
| --- | --- |
| [types.ts](../../packages/story-contract/src/types.ts) 的 Prefab/SceneTemplate：六种物件、两种场景；WorldObject 只有位置、yaw 等少量属性 | 无法直接表达任意尺寸墙、开洞、不同拓扑、自定义几何和动画 |
| [world-assembler.ts](../../game-ps1/src/runtime/world-assembler.ts) 的 addTemplate：固定四面墙、固定高度、灯光与配色；createPrefab 使用 switch | 数据填得不同，空间观感仍容易相同 |
| [当前 Skill](../../skills/story-to-ps1/SKILL.md) 明确要求只使用 action/prefab catalog、不得生成 callbacks | Agent 遇到独特玩法只能拒绝或降级成现有动作 |
| 旧版 [world/kit.ts](../../game-ps1/src/world/kit.ts) 已有自由尺寸 bx/cyl、Shape 几何；[end-consort/main.ts](../../game-ps1/src/stories/end-consort/main.ts) 有角色移动与手持物动画 | 自由创作已有本地基础，不必从零换引擎；但旧故事独立循环和资源管理需要整理 |

**推荐：Agent 直接编写普通 TypeScript / Three.js SceneModule，模块是一级产物；引擎负责通用运行、构建和反馈。模板只是可选起点。**

我们应标准化的是“如何装载、更新、保存、退出、构建”，不是“世界必须长什么样、玩家只能做哪六件事”。PS1 也应是可调的表现预设，不等于阴暗密室、固定第一人称或同一套纸条钥匙流程。

| 方案 | 结论 |
| --- | --- |
| 增加更多房间/prefab/动作枚举 | 能补个别缺口，但不解决创作边界；不作为主方向 |
| 把任意几何和动画都塞入巨型 JSON DSL | 看似开放，实际仍需等 DSL 支持每种新行为；不采用 |
| 每个故事完全独立重写 Three.js 游戏 | 保留作比较基线；自由度高，但输入、存档、打包等是否重复耗时需要实测 |
| 薄 SDK + 原生 Three.js 模块 + 可选 helpers | 本轮选择；若没有降低开发/修复负担，继续缩减为 starter + 工具库 + Skill |

本轮不是做 Unity 式通用编辑器，也不是建设任意第三方代码的安全托管平台。

## 2. 创作自由与稳定边界

```text
故事/创意 → Agent + Skill
              ├─ source.json：来源、事实、改编边界
              ├─ scene.ts + 本地模块：自由几何、角色、玩法、动画
              ├─ assets：本地资源及归属
              └─ experience.json：入口与兼容信息
                         ↓ 真实编译 / 检查 / 有限修复
               Creative Runtime → 私有独立游戏
                    ↑
              Studio 预览、诊断、可选参数调整
```

| 区域 | Agent 能做什么 | 宿主保留什么责任 |
| --- | --- | --- |
| 场景 | 自由 Group/Mesh/BufferGeometry/Shape，局部构造函数，任意布局、墙窗门、地形、灯光 | 装载、挂载/卸载、实例隔离、资源生命周期 |
| 美术 | 程序化材质、本地纹理/GLB、自定义 ShaderMaterial、雾和效果 | 锁定兼容的 renderer/Three 版本，资源闭包，性能诊断 |
| 动画 | AnimationMixer/Clip、骨骼动画、路径移动、自写 update、局部 tween | 一个宿主时钟、暂停/恢复/退出、异步取消与回调隔离 |
| 玩法 | 自定义调查、对话、追逐、时序或空间机制，替换控制器/镜头 | 输入焦点、版本化 checkpoint、事件收据、错误边界 |
| 剧情 | 自由设计玩法与叙事映射，可选使用现成 narrative adapter | 来源及片段边界可追溯；新增内容不得伪装成原文事实 |
| 作者工具 | 直接编辑代码；可声明少量可视化参数 | 类型/构建错误定位、修订与预览一致、准确报告 |

helpers 必须是普通函数库，允许不用或局部替换。不得要求每个 Mesh、动画和交互先在核心登记。相机、控制器、HUD 也不能成为新的固定玩法限制；默认提供现有第一人称方案，允许经宿主接口替换。

## 3. 最小技术规格（拟定，不是当前已实现 API）

### 3.1 SceneModule 与宿主

先在 `game-ps1/src/creative/` 建小接口，稳定后再决定是否抽独立 package，避免先造插件平台。

- `create(context)` 创建模块实例和根 Group；可异步加载本地资产。模块内可写任意 TS 几何和机制代码，也可 import 自己的文件。
- `activate()` / `deactivate()` 对应实例启用/离开；暂停由宿主冻结模拟时间和输入，不等于销毁。
- `update(frame)` 接收模拟 dt/time 与本帧输入；直接更新 Three 对象。固定步长模拟和渲染插值按需提供，不强迫所有动画变成时间线 JSON。
- `destroy()` 取消实例相关工作。scope 跟踪订阅、mixer、资源与 AbortSignal；迟到加载结果不能重新挂载已销毁场景。
- 提供当前 scene/camera/renderer 的受控使用入口，以及可替换 controller / camera / render hook；一个宿主循环驱动，不让每个场景再启动永久 RAF。
- 自有 geometry/material/texture 由 scope 释放；共享缓存资源使用租借/引用计数。不能遍历一棵树就 indiscriminately dispose 所有材质。第三方 tween 通过普通 adapter 接入生命周期。

下面仅说明能力边界，不是可复制运行的最终接口；F0 要冻结可编译类型和最小样例：

```ts
export function create(ctx: SceneContext): SceneInstance {
  const root = new THREE.Group();
  const wall = buildMyOwnWallWithWindow(); // 故事目录里的普通 TS，不注册全局 prefab
  const actor = buildMyOwnActor();
  root.add(wall, actor);
  // 自有/借用资源分别交给 scope；可选绑定交互、碰撞与 checkpoint。
  return {
    root,
    update(frame) {
      actor.position.copy(myCurve.getPointAt((frame.time * 0.03) % 1));
      // 也可用 AnimationMixer；玩法相关变化按 3.3 的状态协议提交。
    },
    destroy() { /* 释放模块自有资源、订阅与动作 */ },
  };
}
```

### 3.2 墙体、场景和资源

提供可选 `wallSegment`、`wallWithOpening`、`floorPolygon` 等少量 helper，返回真实 Three 对象和可选 collider 描述；参数不足就直接写 Mesh/Group/Geometry，不扩核心 enum。

异形墙可用多段 box 或 Shape/ExtrudeGeometry；不承诺一个带窗外包围盒就是正确碰撞。Three 官方提供从二维形状生成挤出几何的能力，本轮不需要引入新场景 DSL。[ExtrudeGeometry](https://threejs.org/docs/pages/ExtrudeGeometry.html)

模型与动画使用现有 Three addon 路线，GLTFLoader 能返回场景和 AnimationClip；纹理、bin、解码器如使用都必须本地打包，不默认联网找素材。[GLTFLoader](https://threejs.org/docs/pages/GLTFLoader.html)

当前锁文件的 Three 为 `0.180.0`。官方在线文档可能更新；实现按已锁定版本核对 API，不直接追最新版、切 React Three Fiber 或整体换 renderer。复用旧 kit 时剥离固定题材配色，审查全局 MAT 的共享释放职责。

### 3.3 动画、机制与存档

AnimationMixer 可以驱动 Clip，逐帧 update，并通过 timeScale 控制暂停；程序化动画同样从宿主模拟时间取值。[AnimationMixer](https://threejs.org/docs/pages/AnimationMixer.html)

状态分三类，不混为一个巨大 StoryPackage：

1. **叙事事实**：玩家获得了什么信息、做了什么决定。附来源/改编标记，通过明确事件提交。
2. **机制状态**：门当前阶段、谜题组合、跟随目标等。模块自己声明 schema、stateVersion、事件处理、序列化/恢复与测试场景。
3. **表现状态**：呼吸、摇摆、灰尘等，可从时间/seed/机制状态派生；无需把所有帧写进存档。

扩展事件采用命名空间和模块自有 payload 校验，如 `harbor.signal-aligned`；六动作只保留在 legacy adapter，不能成为所有机制的总入口。纯 reducer 是适用时的推荐工具，不强迫任意物理状态变成可穷举枚举。

每个含进度的机制至少选择一种恢复策略：

- `checkpoint`：只保证回到最近稳定节点；未提交过渡重新开始或回退到已声明稳定状态。
- `resumable`：保存恢复所需的阶段/进度/seed，模块负责视觉、碰撞与语义一致恢复。

开门等影响通路的动画不是纯装饰。规定权威机制状态驱动视觉和 collider，事件提交有 idempotency receipt。至少测试：动画中暂停、开门中刷新、存档失败、退出后的完成回调、重复完成事件。已提交事实不能因 pause 被撤销；未提交动画也不能偷偷发奖。复制存档、迁移失败不覆盖原槽位。

### 3.4 碰撞与空间诊断

Agent 可选择静态简单碰撞、可选物理 adapter 或模块自己的实现，但要通过同一 controller 查询边界集成，不能渲染一套门、移动控制器仍使用另一套过期 collider。

- 首个切片需要自由墙体与开口、旋转/移动门的可靠碰撞；简单 AABB 不足时采用组合形状/适配器，不能让可见门洞仍被整墙盒封住。
- 绑定明确 mesh/collider transform 同步责任、隐藏/移除策略，以及恢复后重建步骤；动画角色需要交互点同步。
- Rapier 可作可选原生 JS adapter：静态环境可用 trimesh，动态体优先简单/凸形组合。是否引入由 F0 的两个切片需求决定，不把完整物理引擎作为自由造景前置。[Rapier colliders](https://rapier.rs/docs/user_guides/javascript/colliders/)
- 静态网格可达检查仅对声明支持的静态范围有效；移动平台、脚本事件或连续物理不得拿一张静态网格图声称全状态通关。

### 3.5 ExperienceManifest 与旧包兼容

新格式使用独立 `format: kanshan-experience` / `formatVersion: 1`，不暗改 `StoryPackage 1.0`。

作者目录至少包括：`experience.json`、`source.json`、`src/scene.ts`、可选模块/参数/资产和 `tests/`。manifest 记录本地 entry、runtimeApiVersion、checkpointSchemaVersion、source record 引用、参数入口与资产归属；构建后生成准确 code/asset/runtime/source/build digests。**manifest 不枚举墙、物件、动画，也不内嵌可执行代码字符串。**

新 scene 可以完全使用自有机制；叙事 adapter 是可选库。source.json 的来源边界独立验证，不意味着任意代码行为都已证明忠实。现有 StoryPackage 由 legacy interpreter 装载，继续通过原验证器；旧 story HTML/TS 入口保留，不要求首轮全部迁移。

存档默认绑定稳定的 `experienceDigest + 槽位`，不是每次构建任务的随机 buildId。F0/F3 冻结 canonical 身份输入：规范化来源/改编记录、作品代码及实际依赖、参数/资产、runtime 代码和相关构建配置/锁文件；按逻辑相对路径排序，排除构建时间、机器绝对/临时路径、日志/报告及 digest 自引用。同内容在两个干净目录构建应得到相同身份并恢复旧档；同原文不同代码/参数/资产必须隔离。产物字节的 `artifactDigest` 单独用于导出完整性，buildId 只追踪任务，不能把它们混用为存档身份。

兼容迁移须显式声明并生成新槽位；热更新也要重建实例，不能把过期回调留给新版本。

### 3.6 编译、诊断与运行边界

- 本地 TS 模块经真实 bundler 构建，入口和依赖闭包来自构建图。不要扫 import 字符串猜资源，不复制整个多故事 dist，不在 Player eval JSON 或加载远程 Agent 代码 URL。
- authoring 工作区限定在项目目录；代码按可信本地开发处理，不自动导入任意外部 npm 包/构建插件、不携带作者服务凭据。依赖变更走总集成核验。
- 预览使用独立只读 origin、无 Studio token，校验作者 HTTP mutation 边界。隔离预览是减小暴露面，**不是把任意 TS 变安全的证明**；同线程 iframe 也不是 CPU/内存硬隔离。
- JSON/schema 检查只证明数据结构；TS 编译只证明类型范围；单测/场景回放只证明实际覆盖路径；有限状态分析仅用于可声明的有限子系统。不能把它们汇总成“任意 Agent 游戏必然安全/可通关”。
- 错误定位优先回到 scene.ts 的文件/行、资产或机制事件。能力缺口区分“库没有 helper 但可直接写代码”和“宿主确实不支持”；前者不该报终止性 CAPABILITY_GAP。

## 4. Skill 与 Studio 怎么改

Skill 定位改为 **故事到可玩的 Three.js/PS1 项目**，不再是只生成约束 JSON 包；项目内仍用 `skills/story-to-ps1/`，不另装全局副本。

新流程：

1. 检查实际 runtime/CLI/API 示例；识别用户想要的氛围、空间与核心动作。
2. 建立原文事实和片段边界；分别标出有来源的情节、解释性改编、游戏性新增。会员身份不自动代表改编/公开权利。
3. 先写两三个具体创作决定：空间组织、独特动作、动画承担的叙事功能。不能先选房间模板再往里面塞故事。
4. 生成 `experience.json + source.json + TS 场景/机制 + 资产/参数 + tests`；复用 helper 是节省工作，不是义务。创造性代码就保存在作品目录。
5. 调真实构建/诊断，按报错局部修改；同根因反复失败时明确报告阻塞，不以删掉独特机制、改回钥匙纸条来制造通过。
6. 交付项目、私有游戏包、版本/来源/检查结果，以及未验证范围。现场演示价值是“生成 → 工具反馈 → 修复 → 可玩产物”，不是多写一个 SKILL.md 就证明 AI 收益。

Skill 参考文档按需拆成 scene-sdk、animation-state、sources、build-debug，示例涵盖不使用 helper 的代码；禁止所有例子共享同一套布局与取钥匙逻辑。保留 legacy 数据包模式作为显式选项，不能默默降级。

Studio 首轮只做入口识别、指定 build 预览、错误定位、可选参数表单。参数由作者显式暴露并单独保存；未知代码显示“代码管理”，**不把任意 TS 反向转换成 JSON 表单再覆盖原稿**。全能可视化地图/时间线编辑器后置，不能阻塞 Agent 直接改代码。

## 5. 施工顺序：先证明自由，再扩作者工作台

本地基线：`ff5c4f1db32fe558d0a66b1bb2103a6ae76dc894`，分支 `codex/initial-upload`；本轮只读检查产品代码，只有规划目录新增。Kimi 开始时重新检查 HEAD/WIP/AGENTS/锁文件，不回退到旧 SHA。无远端最新状态证明；默认不 commit/push/部署。

```text
F0 最小契约与切片设计 → F1 自由场景垂直切片 → F2 动画/机制恢复加固
                                               ↓
                                  F3 构建/打包/CLI/legacy
                                               ↓
                                 F4 Skill + Studio 最小接入
                                               ↓
                                   F5 冻结后新作品与交付
```

这是有意先串行的小范围架构探索。F1 内两个作品可在冻结接口下并行；F3 接口稳定后 F4 的 Skill 与 web 可并行。所有 package.json/lockfile、宿主接口、构建配置、总验收 runner 由总集成单独维护，禁止跨角色抢写。架构/状态使用最强可用推理配置，示例/文档可默认配置。

### F0 · 基线与最小接口

**上下文**：当前新 Player 是固定模板解释器，旧代码有原生 Three 创作能力。读本方案、旧 CURRENT-AUDIT 和两套代码；盘点不用重写的输入、渲染、音频、保存接口。

**任务/产物**：记录基线；冻结上述最小 SceneContext/Instance、资源所有权、controller/collision seam、manifest 与 checkpoint 版本草案；只抽首两个作品共同需要的功能，写可编译 type fixture。记录相机替换和原生几何不会被禁止的断言。

**验证/退出**：现有命令和前置环境见 ACCEPTANCE；新增接口 fixture 类型检查，静态映射当前缺口。不得标跨模块验收 PASS。**回退**：只保留文档/独立 fixture，旧入口未变。

### F1 · 自由造景垂直切片（首先交付）

**上下文**：已有 kit 的 box/cylinder/shape 可复用，但不是所有场景必须使用。前置 F0。

**任务/产物**：实现薄宿主、scope、直接 Mesh/Group 编码路径和最小碰撞接口；本地构建两个原创作品：一个不规则室内空间及带真实开口的动态门；一个开放/非矩形空间及角色路径或程序化动画。第二个必须包含未依赖 helper 的自建几何和不同核心操作。素材可全部程序化，不要求外部模型服务。

**验证/退出**：新增 `test:creative` 基础项 C01–C04/C07 与两个独立入口 build；本地自动浏览器可用时额外运行，不可用写 NOT_RUN。保存能力尚未集成记 PENDING_INTEGRATION。观察到框架限制时修改 seam，不能把创意改成旧模板以通过。**回退**：creative 入口旁路，旧 Player 不受影响。

### F2 · 动画、机制和 checkpoint

**上下文**：F1 证明几何自由，尚不能把能显示当成可靠可玩。前置 F1。

**任务/产物**：实现时钟/暂停/退出、Mixer 与 procedural update 的 scope 接入、模块状态及命名空间事件、存档身份与失败恢复。以一个影响通路的动画实现 checkpoint 策略；另有小型 fixture 验证 resumable。修复本轮触及的 busy/cue、回调隔离和存档错误；不要复刻旧问题。

**验证/退出**：C05–C09，注入时钟/存储测试；门视觉、碰撞与事实一致，迟到回调无效、共享资源不误删。**回退**：新槽位命名空间，不自动迁移用户旧档。

### F3 · 项目构建、CLI、导出与旧包兼容

**上下文**：直接模块需要真实代码入口，而旧 Studio 仅处理结构化包。前置 F2；可提前设计接口但不能宣告集成通过。

**任务/产物**：扩展 CLI 对 experience format 的识别和精确 build；导出实际依赖闭包；source/build/asset digest 与报告绑定；独立只读预览 origin；旧包 adapter。错误必须指向 TS/资产/状态，invalid 不显示成功；补齐本轮用到的 create/import/build/validate/preview/export wrapper 真实命令。不要绕开现有服务并发/路径/审批缺陷去做第二套无保护服务。

**验证/退出**：C10–C13；从临时工作区实际调用 CLI，导出挂子路径检查依赖、缺资产负例，关闭 Studio 后包不依赖作者 API。浏览器未跑仍不能宣称已自然通关。**回退**：旧格式显式路径保留，导出新目录，失败不推进修订 head。

### F4 · Skill 与最小 Studio 接入

**上下文**：生成代码路径已有稳定命令；原 Skill 的禁止 callbacks 必须针对新模式改写。前置 F3。

**任务/产物**：按第 4 节改 Skill 与示例，修 wrapper；Studio 只接 format/预览/诊断/显式参数和草稿保存。修改 Skill 时按可用 skill-creator 规范，保留来源与授权边界。不建设全地图编辑器。

**验证/退出**：C14 的真实 wrapper 流程、参数更新不覆盖 TS、失败报告；F5 才给新作端到端结论。**回退**：CLI/代码编辑始终可用，legacy 模式不丢失。

### F5 · 冻结后新作品与交付

**上下文**：两个开发作品不能证明泛化；前置 F4。

**任务/产物**：冻结 runtime/helpers/Skill/CLI，再选一个未用于调架构的原创 brief，仅写作品 TS/资产/参数/测试，构建导出。要求空间组织、核心动作、关键动画至少有可解释的差异，不只换色换台词。若需改核心，记录 holdout 失败，改版后另选新 brief，不把事后适配算冻结成功。

**验证/退出**：C01–C15 最终汇总；三个真实 SceneModule 都要经公开输入/update/碰撞完成初态到目标及中途恢复的离线集成回放，不能直接改状态跳关。输出 `evidence/ps1-creative/v0.1/RESULTS.md` 和机器报告、三个独立项目及导出位置。可选做第 6 节比较。**回退**：保留失败作品和诊断；若 SDK 无明显价值，交付轻 starter/工具库，不继续扩大框架。

命令、逐项条件与分层结果定义见 ACCEPTANCE。工作包完成写 WP_DONE；跨包项 PENDING_INTEGRATION，不能抢填 PASS。无需真人、真机、外部付费模型或公开部署。

## 6. 如何判断没有再限制 Agent

必需证明的是“无需修改核心就能实现新的场景/动画/机制”，不是 prefab 数量变多。三个作品与 F5 冻结记录只能作为本地可行性证据，不能直接证明 AI 效率提升或比赛得分增长。

可选小规模比较：相同三个 brief，分别用 A 旧模板、B 原生 Three starter、C 新 SDK，形成九个产物。尽量固定模型、输入、可用资产、token/时间预算和共通功能要求；B 允许同等现成底层库，不故意让 B 从空白写全部基础设施。冻结 SDK 后再发未见 brief，随机化执行顺序并保留失败，不跨组偷用上一组成品。

记录：创意要求保留程度、空间与操作差异、构建/检查结果、修复轮数、人工改动、核心改动、耗时与代码维护负担。创意质量没有可信人工评价时写 UNREVIEWED；图像差异/三角面数不能替代游戏体验指标。九个产物只是探索性 pilot，不声称统计显著。

**停止规则**：如果 C 为了运行必须删掉独特玩法，或比 B 多出大量注册/描述样板又没有可靠性收益，就缩减抽象，不继续加 DSL。我们要的是“直接写 Three.js 的创造力 + 复用工程底座”，而非证明此前架构必须保留。

## 7. 与上一版计划的关系

- 推翻：StoryPackage 是唯一执行产物、任意代码全面禁止、两模板/六动作是新作品上限、所有世界需用统一静态网格穷举验证。
- 保留：来源边界、digest 隔离、正确输入/暂停/销毁、真实 CLI、准确失败报告、导出资产闭包、预览和公开发布边界。
- 调整：旧 K01/K02 仅按新 SDK seam 复用；K05 全编辑器后置；K07 从“只改 JSON”改为“自由写作品代码但不改核心”。旧审阅的缺陷仍是修复依据，但不要求先做完全部旧计划再尝试自由能力。
- 本次只新增/修订规划文档。上述目录、API、命令和验收报告若标为拟新增，均不是已实现能力。见[独立规划审查](REVIEW.md)，它不代表产品测试已通过。
