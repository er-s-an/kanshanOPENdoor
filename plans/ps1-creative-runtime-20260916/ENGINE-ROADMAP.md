# 面向 Agent 的 PS1 游戏创作引擎 · 完整能力路线图

2026-09-16 · PLANNING ONLY · 继承自由 SceneModule 架构，扩大通用引擎能力；未实施、未跑产品测试。

入口：[系统规格](ENGINE-SYSTEMS.md) · [验收](ENGINE-ACCEPTANCE.md) · [Kimi 执行提示词](KIMI-ENGINE-PROMPT.md) · [独立规划审查](ENGINE-REVIEW.md)。前提为[自由创作架构](README.md)：模板可选，Agent 可直接编写普通 TypeScript / Three.js。

## 1. 产品定位与结论

定位为 **以 Agent 为主要作者、兼容人类编辑的轻量 Web 3D 游戏引擎与工作台**，PS1 是默认美术预设，故事改编是首个创作场景，不是能力上限。

一般游戏引擎不仅渲染画面，还提供场景/资源、输入、物理、动画、音频、脚本、UI、调试和导出等能力；成熟引擎也把编辑器与运行时配合使用。这里参考其能力划分，不建议迁移项目到 Godot。[Godot 官方功能概览](https://docs.godotengine.org/en/stable/about/list_of_features.html)

应当补齐这些常用功能，但采用 **小内核、丰富的可选系统**，而不是所有游戏都被迫通过一套巨大固定模型。丰富是“更多可调用的工具”，不是“更多必须遵守的模板”。

目标作品：短篇探索、调查解谜、叙事体验、轻动作/追逐、简单平台或空间机关。暂不把大型开放世界、联网竞技、完整商业平台列为本轮承诺。

## 2. 能力地图：做什么、做到哪一步

下表为本项目建议范围，不是对某一外部引擎逐项承诺。**R1 是这次交给 Kimi 的完整执行范围；R2/R3 是后续候选，不随 R1 自动实施。**

| ID / 能力 | R1：本次可执行范围 | R2：后续深化 | 为什么对 Agent 有用 |
| --- | --- | --- | --- |
| S01 运行/脚本 | SceneModule、生命周期、固定模拟步/渲染插值、scope、事件和错误边界 | 后台任务/Worker adapter、复杂多场景流送 | 写普通 TS，却不反复搭主循环 |
| S02 场景/搭建 | 层级、transform、自由 mesh、墙/开口/地板 helper、用户自定义组合工厂、稳定 author ID | 路径/地形编辑、几何布尔运算、大片区分块 | 能自行决定空间，而不是选两个房间 |
| S03 资产 | GLB/glTF、纹理、音频加载/缓存/释放、依赖/归属、缺资源诊断、预加载清单 | 转码压缩流水线、LOD 自动处理、外部生成服务 adapter | 不同资源能被可靠导入和打包 |
| S04 渲染/美术 | 可调 PS1 preset，独立近视特效，材质/灯光/雾/阴影配置，原生 shader 入口，画质档 | 更丰富后处理、shader 编辑、烘焙工作流 | 同一底座支持明亮、温和、奇幻等不同画面 |
| S05 输入/角色/镜头 | action mapping、键鼠/触屏、焦点层；第一人称和俯视控制；跟随/固定/路径镜头 | 手柄、复杂第三人称、镜头碰撞深化、重映射 UI | 不用为每个作品重写操作或被锁死第一人称 |
| S06 物理/空间查询 | 静态/运动学/基础刚体、trigger、ray/shape query、重力跳跃、坡台阶、移动平台最小案例 | 布娃娃、绳索、车辆、复杂关节/破坏 | 门、楼梯、机关不仅看得见，也能按规则互动 |
| S07 动画/过场 | Mixer/Clip、混合/循环、procedural update、代码 timeline、暂停/跳过/恢复策略 | IK、动画重定向、完整可视化时间线 | 角色表演和镜头编排不必全部从零写 |
| S08 音频 | 自有音效资源、music/sfx/voice bus、空间声源、淡入淡出、静音/音量、解锁与释放 | 混响分区、音频遮挡、复杂自适应配乐 | 声音可用于空间反馈、叙事与节奏，而非固定恐怖音效 |
| S09 特效 | 可扩展粒子 emitter、闪光/震屏/淡入淡出、简单环境天气；可关闭 | GPU 粒子、体积效果、复杂 trail | 小成本增强动作反馈，不需要同一套滤镜 |
| S10 NPC/导航 | 状态机工具、waypoint/小型图 A*、感知/视线查询、跟随/巡逻例、失败/卡住诊断 | navmesh adapter、动态避障、行为树/群体 | NPC 可以有空间行为，不只是站着弹对白 |
| S11 UI/可访问性 | 中文字幕/选项、交互提示、暂停/设置、焦点、文字缩放、减弱动态效果；自定义 DOM UI | 多语言工作流、更多输入辅助、UI 主题编辑 | 能做完整游戏界面；UI 不吞输入或盖住核心操作 |
| S12 玩法工具库 | 可选对话、背包、目标、触发区域、条件与命名事件；自定义 reducer/state | 战斗/任务/经济等按作品需求增加 | 复用常见逻辑，但不把所有游戏规定成任务背包游戏 |
| S13 状态/存档 | 版本化 checkpoint/resumable、跨场景恢复、receipt、稳定身份、故障反馈 | 用户主导迁移工具、云档（另需服务） | Agent 能迭代作品而不串档、不重复奖励 |
| S14 Studio 编辑 | 场景树、只读运行态 inspector、显式参数修改、transform gizmo/吸附、undo/redo、预览/编辑区分 | 路径/时间线/地形专用编辑器、协同 | 人能微调，Agent 改代码也不被表单重写 |
| S15 调试/Agent 工具 | capability catalog、状态/对象查询、碰撞可视化数据、输入 trace/replay、固定步调试、构建诊断、性能计数 | 自动截图分析/视觉回归、复杂 profiler 集成 | Agent 不靠猜测修改，也不必模拟人逐个点按钮 |
| S16 构建/扩展 | 按需 bundle、独立私有包、资产闭包、版本报告、adapter 契约、旧包兼容 | 桌面封装/其他平台、插件分发 | 每个作品独立交付，不携带整个工作台或无关故事 |

R3 暂缓：多人同步/服务器权威、开放世界流送、软体和高精度破坏、原生主机导出、通用模型/骨骼制作软件、公开插件市场、实时 LLM 决定所有 NPC 行为。它们不是永远不做，而是成本、验证和外部依赖明显超出当前小游戏目标。

对话、背包、任务并非所有引擎都必须内置的核心；在这里定位为可选玩法库。程序化美术/声音优先支持；AI 生成模型/配音可另接资源供应方，不是引擎运行必需条件。

## 3. 当前有什么：复用而非全部重做

以下是本地静态盘点，不是运行验收。HEAD `ff5c4f1db32fe558d0a66b1bb2103a6ae76dc894`，本轮工作树仅规划目录未跟踪；执行前刷新。

| 当前基础 | 已看到的代码 | 应怎样扩展 |
| --- | --- | --- |
| PS1 渲染 | [renderer.ts](../../game-ps1/src/engine/renderer.ts)：低分辨率 render target、抖动、震屏、近视/眯眼效果 | 把近视/恐怖氛围从通用 preset 中剥离，允许直接材质与 render hook |
| 输入 | [input.ts](../../game-ps1/src/engine/input.ts)：FPSInput、键鼠/触屏 | 通用 action map、焦点/层、可替换控制器，不把 squint 当所有游戏动作 |
| 合成音频 | [audio.ts](../../game-ps1/src/engine/audio.ts)：SynthAudio 与具体音效、心跳/环境音 | 保留合成器作一个 sound source；外加资源播放、bus、空间声源和生命周期 |
| 程序化搭建 | [kit.ts](../../game-ps1/src/world/kit.ts)、旧 story 的自定义几何 | 普通可选函数库、项目自有组合工厂；不变回核心 prefab enum |
| 空间/交互 | [player.ts](../../game-ps1/src/runtime/player.ts)、[world-assembler.ts](../../game-ps1/src/runtime/world-assembler.ts)：AABB 及交互射线 | 独立 PhysicsWorld/Controller adapter 和测试；当前不是完整通用角色物理 |
| NPC 与故事 | [contract.ts](../../game-ps1/src/engine/contract.ts) 有 NPCController 接口，旧故事有自写动作 | 接口存在不等于已有通用寻路/行为系统；从作品逻辑中提取可选工具 |
| UI/状态 | [hud.ts](../../game-ps1/src/runtime/hud.ts)、[save-store.ts](../../game-ps1/src/runtime/save-store.ts)、[story-contract](../../packages/story-contract/src/index.ts) | 保留已用工具、修复现有缺陷，增模块自有状态与自由 UI |
| Studio/CLI | [studio/src](../../studio/src/index.mjs)、[web app](../../studio/src/web/app.mjs) | 当前主要导入/状态工作流；编辑器、运行态 inspect、自由模块命令仍需补 |

本轮未在上述共享实现目录发现通用 AnimationMixer 管理、空间音频 bus、navigation 或完整物理系统。旧作品可能有局部行为，不能因此断言全仓没有相似代码；M0 应继续定位可提取部分。

## 4. 架构：小内核不等于功能少

```text
作者：人（Studio） / Agent（Skill + CLI/工具 + 普通 TS）
                         ↓
               相同版本、参数和诊断协议
                         ↓
             作品代码 / 自由 SceneModule
                ↙               ↘
        原生 Three.js          按需通用系统
                  ↘           ↙
         内核：时钟、scope、输入仲裁、状态提交、身份
                         ↓
              渲染 / 物理 / 音频 adapters
```

三条硬规则：

1. **直接代码始终是一级入口。** 提供组件/工厂不意味着强制全作品 ECS；使用 Three 的场景树，不再镜像一份强制节点世界。
2. **共享协议，不共享固定审美与玩法。** 系统以 optional import/adapter 接入；不用物理的作品不应打包 WASM，不用背包就没有背包依赖。
3. **双创作界面。** 人拖动一个显式暴露的位置参数，Agent 修改同一参数或其源代码；运行态 inspection 不等于可永久编辑任意程序化对象。详细写入/撤销规则见系统规格。

Agent “像人一样创作”意味着拥有同等能力与反馈，不意味着强迫 Agent 使用鼠标模拟整个编辑器。Agent 直接调用构建、读取对象状态、提交参数补丁、重放输入通常更准确。

### 技术复用决策

- **直接沿用** Three.js 和 Web Audio 基础；AnimationMixer、PositionalAudio、TransformControls、InstancedMesh 可分别支撑动画、空间声、编辑操作和重复几何优化，项目只补契约与生命周期。实现时核验锁定 `Three 0.180.0` 的接口，不照抄最新 docs 独有功能。[空间音频](https://threejs.org/docs/pages/PositionalAudio.html) · [变换控件](https://threejs.org/docs/pages/TransformControls.html) · [实例化几何](https://threejs.org/docs/pages/InstancedMesh.html)
- **通过 adapter 采用** Rapier 原生 JS 作为 R1 物理首选候选。它提供角色障碍修正、坡台阶和移动平台相关能力，但官方也说明角色控制往往需要游戏特定调整；不能装包后就宣称移动系统完成。M0 核验依赖/许可证/体积/WASM 打包并 pin 后实施，不切到 React 包。[角色控制器](https://rapier.rs/docs/user_guides/javascript/character_controller/)
- **小规模自建** 项目特有的生命周期、状态/来源、作者修订、工具报告；第一版导航先支持可声明 waypoint 图，避免先重造 navmesh 烘焙器。
- **仅参考** Godot 等的场景树、inspector、动画/调试工作流，不迁移其整套架构，不承诺功能对齐。

## 5. R1 执行工作包

不是在旧 F0–F5 后面再串行追加全部工作；下列 M0–M7 **整合并扩展** 原计划。已实现部分由 Kimi 检查证据后复用，不重写。验收范围是所有 R1 功能的最小实用深度，不是 R2/R3。

```text
M0 核心/协议 → M1 场景/资产 ─┬→ M2 输入/物理 ──┐
                           └→ M3 动画/视听 ──┼→ M4 NPC/玩法/UI
M0 → M5a 版本/构建协议；M1–M4 → M5b 完整导出与状态整合
M0 → M6a 工具/UI骨架；M5a → M6b 工具接入；M5b → M6c 全链路
M2–M6 + Skill更新 → M7 冻结后新作品、统一验收
```

M5/M6 分子阶段交付，避免等到最后才发现接口接不上。M6 不是依赖都完成后才开始画 UI；但不得提前宣告完整链路通过。共享接口/package/lockfile/build config/runner 由总集成串行维护，其他角色提请求；各系统目录和测试范围不重叠。

### M0 · 核心、身份和系统接入协议

**上下文/前置**：先读自由架构及[旧缺陷审阅](../ps1-iteration-20260916/CURRENT-AUDIT.md)。现有 contract 带故事语义，不能简单加方法变成全局上帝对象。

**任务**：更新当前能力盘点；冻结 SceneContext、scope、单时钟/固定步、author/runtime ID、状态事务/快照、RuntimeSession 启动/连接/停止与 command/query/transport、read-only debug snapshot、参数 command 协议。先复用 F0–F2 的薄宿主切片/正确性修复；不要求此时支持所有扩展库。物理候选做版本/许可证/体积与离线打包核验，记录选型。

**文件边界**：拟 `game-ps1/src/creative/core/`、类型 fixture；共享依赖由总集成。**验证**：G01/G02/G11 的 core 子项、当前 shared test/build，不能继承历史 PASS。**退出**：可编译类型 + 无额外系统的作品能装载/更新/退出；错误与身份定义无歧义。**回退**：creative 入口旁路，旧故事/旧档保留。架构负责人使用最强可用推理配置。

### M1 · 场景、资产与渲染

**上下文/前置**：M0；现有 kit 和 PS1 renderer 可提取，类型/美术题材需要解耦。

**任务**：实现层级/transform、资产 cache/lease 与本地 GLB/纹理/声音引用；可选几何 helper、用户组合工厂、author bindings；PS1 preset 与近视效果分离，支持画质/雾/灯光/原生材质；重复几何可使用 instancing。产出不规则室内与开放室外两个不同起点，第二个有直接原生几何。

**文件边界**：拟 `creative/scene/`、`assets/`、`render/`；旧 kit/renderer 只做兼容提取。**验证**：G03/G04/G16 子项、game build、缺文件/共享资源释放负例。**退出**：原生代码与 helper 可混用，资源来源/闭包可追踪；不因导入一个系统默认加载全引擎。**回退**：原入口和原资源不删，新增系统可不 import。

### M2 · 输入、角色与物理

**上下文/前置**：M0+M1；原 Player 的平面 AABB 不足以覆盖坡、跳跃和移动平台。

**任务**：action map 与 UI/游戏焦点；第一人称及俯视控制；PhysicsWorld adapter 的静态/运动学/基础动态体、queries/triggers、角色重力跳跃/坡台阶；动态门和移动平台案例。支持调试 collider/接触/grounded；不同玩法可替换 controller，不强制同一移动感。

**文件边界**：拟 `creative/input/`、`physics/`、`controllers/`，单独 test 文件。**验证**：G05/G06，实际 adapter 的离线积分和输入路径；scope 退出释放 world/订阅。**退出**：真实门洞、坡阶和运动物体通过正反例，未适配情况有诊断，不冒充全物理模拟器。**回退**：保留简单无物理路线，不改变旧世界碰撞。

### M3 · 动画、镜头、音频和效果

**上下文/前置**：M0+M1，物理整合等 M2；不能把自由程序动画又改为封闭时间线 DSL。

**任务**：Mixer/Clip 和自写 update、基础 blending、普通 TS timeline/sequence 与扩展回调；镜头跟随/切换/路径；空间声源/bus/fade；轻粒子和屏幕效果。每类系统遵守暂停/销毁；给出过场跳过规则和 transform 写入权，避免同一物体被动画/物理同时覆盖。

**文件边界**：拟 `creative/animation/`、`camera/`、`audio/`、`effects/`，内部可拆分作者但只消费共享接口。**验证**：G07–G09，M2 完成后补动态通路整合。**退出**：同一逻辑过场播放/跳过到相同语义终态；声音等待真实用户手势，不做 autoplay 假证明。**回退**：各系统可选，老 SynthAudio 保留 adapter。

### M4 · NPC、交互、玩法工具与 UI

**上下文/前置**：M2+M3；剧情数据不是所有机制的上限，库用于减少重复实现。

**任务**：状态机/waypoint/图 A*、视线与跟随/巡逻、导航失败反馈；通用 interaction/trigger、可选背包/对话/目标；自定义事件 payload 和 state；中文 DOM HUD/字幕/菜单、键盘/触屏焦点、文字大小与减弱动态效果。组合成至少两个不同核心操作的作品，含跨场景目标或 NPC 行为。

**文件边界**：拟 `creative/ai/`、`interaction/`、`gameplay/`、`ui/` 和独立 example 项目。**验证**：G10/G12/G13，输入→物理→机制→目标的集成回放。**退出**：不使用背包/任务库的作品也能构建，自定义玩法不改核心 enum；NPC 无路可走不会假穿墙。**回退**：作品可继续自写机制，库不强制导入。

### M5 · 状态、构建、私有交付

**上下文/前置**：M0 即可开始 M5a；M1–M4 产物齐后 M5b。承接 F3，不建设第二套脱离 Studio 的状态服务。

**任务**：M5a 冻结 experience identity、revision/command、bundle 报告接口，以及本地 RuntimeSessionHost 的入口；M5b 接通跨场景 checkpoint、资产/module 闭包、能力声明、错误语义、旧包 adapter、CLI、独立只读预览与私有导出。实现可由 CLI/工具连接的无 GPU 会话，实际加载作品 SceneModule/controller/physics 并持有时钟/状态，不能从构建缓存 JSON 拼运行快照。渲染/音频输出可替换但玩法保持真实；浏览器 bridge 使用同一协议另行补证。纳入现有路径/文本/幂等/竞态问题，不把 mock 或缺 bundle 说成成功。authoring 文件/调试能力不默认进入 release bundle。

**文件边界**：Studio backend/CLI/export，`creative/state/` 与构建配置由总集成协调；暂停其他角色对 services/http 的并行写入。**验证**：G11/G16/G17、先前 C09–C14 的相关项。**退出**：关掉 Studio 后静态包仍具备所有所需本地资源；稳定重建身份与旧档恢复有测试。**回退**：新目录/新槽位，不覆写用户原件。

### M6 · Studio 与 Agent 共用创作工具

**上下文/前置**：M0 可做 M6a；M5a 后接 M6b，M5b 后完整接通 M6c。人类 UI 与 Agent 不各造一份状态。

**任务**：场景树/只读 runtime inspector、显式 author parameter 编辑、gizmo/吸附、undo/redo；能力目录、查询/日志、trace/replay、模拟 step、性能计数；任何永久修改走版本化 command。修改项目内 Skill，使其按需阅读系统说明，先发现能力/看运行反馈，再改代码或参数。MCP 只作可选传输，先有可工作的 CLI/JSON。

**文件边界**：Studio web、`creative/debug/`、项目内 Skill 与 wrapper；工具后端接口由 M5/总集成串行接入。**验证**：G14/G15/G18，编辑→重建→预览→撤销/冲突，与代码手改同时发生的负例。**退出**：非绑定程序对象只读，不被错误写回；不依赖 AI 点击 UI 或外部 provider 才能创作。**回退**：代码/CLI 始终可用，失败不丢草稿。

### M7 · 组合验收和最终交接

**上下文/前置**：M2–M6 完成，不能用系统级单测代替真实作品接通。

**任务**：两个开发样例覆盖 R1 系统的组合；冻结 core/systems/Skill/tools 后再定第三个未见 brief。第三作只改作品 TS/资产/参数/测试，不增核心特例。完成全部 required 的离线断言与三作品输入回放，汇总可用能力、局限、未跑浏览器项及生成项目/导出路径。

**验证/退出**：G01–G19；模块完成记 WP_DONE，跨系统待接记 PENDING_INTEGRATION，最终不能计 PASS。有浏览器则额外自动跑，无则 NOT_RUN；无需真人/真机/付费 provider/部署。**回退**：保留失败作品和诊断；若新增功能令纯 Three 更难使用，缩减接口，不以删创意求通过。

## 6. 交付切片与控制范围

- **切片 A（M0–M3 的交集）**：自由空间 + 动门/平台 + 动画/镜头/声音，足以证明不是静态造景。M5a/M6a 同时准备，但完整编辑器不阻塞此切片。
- **切片 B（M4–M6）**：NPC/玩法/UI + 可保存项目 + 人与 Agent 的可用工具链。
- **切片 C（M7）**：新题材复用与 R1 全部局部工程证据。

不承诺 Agent 固定运行时长或“几天完整复制成熟引擎”。若 M0 发现依赖/平台限制，记录需拆分的子项、替代方案和受影响的 required gate，不能静默把 R1 功能挪成以后再说。

此计划不要求外部账号、在线模型调用、公开发布；测试使用原创/合成内容。来源/权利边界保留，会员身份不等于公开改编权。R2/R3 启动需要后续选择，不得无限扩张直到“像所有引擎一样”。

## 7. 文档关系和执行优先级

本文件及 ENGINE-* 为最新完整能力范围；原 README/C01–C15 的自由创作、存档身份、证据边界继续生效，已映射进 M/G 工作包，不重复施工。旧 ps1-iteration 的固定模板实施方向继续失效，代码缺陷证据仍可用。

优先级：用户最新要求 → 本 R1 范围与 ENGINE-SYSTEMS/ACCEPTANCE → 自由 SceneModule 约束 → 旧实现兼容。最终交接见 [Kimi 提示词](KIMI-ENGINE-PROMPT.md)。
