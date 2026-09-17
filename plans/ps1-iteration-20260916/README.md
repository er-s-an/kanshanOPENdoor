# PS1 Story Studio · 下一轮迭代与 Kimi 交接规划

> 2026-09-16 架构修订：用户要求保留 Agent 的原生 Three.js 创作自由。以下“StoryPackage 唯一执行数据、固定模板、任意代码禁止、只改 JSON”的方向已被[Creative Runtime 新规划](../ps1-creative-runtime-20260916/README.md)取代。不要直接执行旧 K00–K07 全量计划；本目录审阅中的正确性缺陷仍作为证据，按新 F0–F5 选择性修复。新的[执行提示词](../ps1-creative-runtime-20260916/KIMI-PROMPT.md)优先。

版本：1.0 · 2026-09-16 · PLANNING ONLY。

本轮仅新增规划文档；实施、测试和运行交给 Kimi Agent。入口材料：[当前审阅](CURRENT-AUDIT.md) · [验收计划](ACCEPTANCE.md) · [可复制提示词](KIMI-PROMPTS.md) · [规划审查记录](REVIEW.md)。原架构与数据定义见 [原规格入口](../../docs/ps1-studio/README.md)。

## 1. 推荐方向

下一轮定位为 **离线作者闭环 v0.2**：Kimi 根据故事编写结构化方案，工具可靠构建，Studio 能直接调整剧情/布局，导出独立游戏。验收和修补现有主流程优先于扩展引擎。

完成后的作者流程：

```text
提供故事 → Kimi + Skill 生成 Analysis/Blueprint → 导入修订
    → 构建与分层诊断 → Studio 修改文案/动作/位置 → 指定版本预览
    → 私有静态游戏 + manifest + 验收报告
```

| 方向 | 给用户带来的改善 | 本轮选择 |
| --- | --- | --- |
| P0 正确性与完整流程 | 默认样例有效、同源不同修订不串档、动作不挂住、报告准确、Skill 可执行 | K00–K04、K06；优先完成 |
| P1 作者效率 | 编辑 beat、选项、来源、布局后重新试玩，不反复手改整份 JSON | K05，纳入 v0.2 |
| P1 复用证明 | 两个开发样例 + 一个冻结后再做的新片段，覆盖不同剧情结构 | K07，纳入 v0.2；不要求真实用户实测 |
| P2 可选机制扩展 | 调查/证据关联、顺序操作、角色对话等各自有玩法区别 | v0.2 后按下文选一个，暂不实施 |
| P2 Studio 内模型生成 | 用户点按钮便生成方案，服务接 provider | 可后置；Kimi 宿主生成已能支持本轮作者流程 |

不建议本轮增加通用 3D 编辑器、开放世界、多人协作、任意代码插件、同时支持多种叙事语言。只有实际故事出现具体能力缺口，才开启新机制规格。

验收遵循前文用户偏好：以本地自动检查和执行结果为主，不要求真人试玩、真机、外部付费模型或公开部署。已有浏览器可用时可做本地自动操作；无浏览器时完成确定性测试并记录缺项，不把它伪装成自然通关。

## 2. 执行前提与决策

工作目录：`/Users/xiejiachen/zhihu-hackathon-2026/kanshan-v2`。审阅基线为 `ff5c4f1db32fe558d0a66b1bb2103a6ae76dc894`，执行时先刷新本地状态，不硬回退到此 SHA。开始规划前工作树干净；交接后预计只增加本目录文档。

- 保留当前 Three.js/PS1 技术路线与旧入口。`StoryPackage` 继续是唯一执行数据；可信代码解释白名单动作。
- 固定 Node 24 与现有锁文件。根目录没有统一 build，按包安装和构建，先 shared 再 Player/Studio。不升级全仓依赖。
- Kimi 是作者宿主：直接产出 analysis/blueprint，用真实 CLI 执行。host-agent 不要求 Studio 假装调用 Kimi API，也不要求额外密钥。
- StoryPackage v1 兼容现有动作；作者产物另有版本。严格验证需显式迁移旧 fixture，不通过放宽 schema 让坏数据混过去。
- 新契约/诊断/几何元数据先冻结，之后各实现消费公开接口。禁止各模块复制 validator、reducer、hash 或模板几何逻辑。
- 本地规划不需要 gh auth；没有核验 GitHub 远端最新状态。实施默认本地交付，不 commit/push/发布。若后来需要 PR，再核验 remote 与基线。

## 3. 工作包和依赖

K 是本轮执行编号；旧 S01–S09 作为架构背景，不继续用旧状态表宣布完成。

```text
K00 基线复现 → K01 契约冻结 ─┬→ K02 Player / 空间 / 存档 ─────┐
                           └→ K03 Studio 服务 / CLI ─┬→ K04 Skill
                                                   ├→ K05 编辑器
                                                   └→ K06 导出 ← K02
               K02 + K04 + K05 + K06 → K07 新故事与统一交付
```

K02/K03 可以并行；K03 冻结公共接口后 K04/K05 可以并行，K06 等 K02/K03 完成后开始。K02 和 K03 都不能自行修改 K01 的共享契约，必要改动由总负责人串行合入。K06 修改 exporter 和 HTTP 预览，与 K03 结束后才交接；K05 只改 web，不抢写服务。

**验收归属**：工作包完成只表示其自身子断言和接口通过，记 `WP_DONE`。A02/A08/A09 等跨包用例分阶段积累证据，不能在 K01/K04 提前写整个 ID 为 PASS；等 K07 运行完整流程后才汇总。下游尚未实现写 `PENDING_INTEGRATION` 到工作包记录，最终 required 仍未完成则总验收不通过。

**共享文件归属**：所有 package.json、lockfile、共享 test helpers、汇总 runner 由总集成串行修改，各角色提交依赖/脚本请求。测试文件分别使用 `game-ps1/test/runtime-*`、`studio/test/service-*`、`studio/test/ui-*`、`studio/test/export-*` 和 `skills/story-to-ps1/test/` 的独立范围。K02 的新增 spatial.ts 是 K01 明确委托的实现范围；接口/类型变化仍回总集成审阅。不能以“不同业务目录”推定依赖清单也无冲突。

工程量粗估：K00 0.25–0.5 日，K01 1–2 日，K02 2–3 日，K03 1.5–2.5 日，K04 0.5–1 日，K05 1.5–2.5 日，K06 1–2 日，K07 1–2 日。是工程工作量估计，不是 Kimi 的运行时间承诺；K00 后按复现结果重估。若时间紧，先完成 P0，再交付编辑器和新增机制。

### K00 · 把历史通过记录变成当前可复现基线

**上下文**：当前有 54 项存在性/样例整合检查和少量单元测试；它们没有覆盖 Skill 真实命令、默认 Player 包与空间报告差异。

**读取**：[当前审阅](CURRENT-AUDIT.md)、[原验收](../../docs/ps1-studio/ACCEPTANCE.md)、各包 package.json 和现有测试。

**任务**：记录 HEAD、WIP、Node/依赖；在隔离临时工作区跑现有命令；对 D01/D02/D03/D07/D08 至少各做一个最小复现。新增回归应调用公开接口/真实 CLI，而非搜索字符串。记录初始失败，后续才修复。

**产物**：`evidence/ps1-studio/v0.2/baseline.md`、`baseline.json`、必要的最小测试。目录为拟新增，不声称当前已有报告。

**验证**：ACCEPTANCE 中“已有命令”；检查 A00 的证据字段。**退出**：每个 P0 有复现任务或明确静态证据，初始失败不隐藏；版本与包构建顺序明确。

**回退**：只保留报告与独立测试，不改变用户故事/存档。负责人：Kimi 总集成，使用其最强可用推理配置。

### K01 · 统一作者契约、hash 和模板元数据

**前置**：K00。**上下文**：shared 已有 reducer/canonical/state explorer，但 Studio 作者模型、运行时类型、fixture、空间元数据仍分叉；更严格 loader 会先暴露默认包错误。

**读取**：[SPEC-02](../../docs/ps1-studio/SPEC-02-CONTENT.md)、`packages/story-contract/src/`、`studio/src/contract.mjs`、runtime 类型与 WorldAssembler。

**任务**：

1. 导出规范化文本、canonical digest、Schema/类型/catalog；包只保留一种身份算法，时间戳和审批留 manifest/report。Studio request hash 先去掉可选 undefined，再 canonicalize，不能直接替换函数导致所有请求报错。补齐 facts/entry/option cues 的 span 语义边界遍历。
2. 按 SPEC-02 冻结 SourceRecord、Analysis、Blueprint v1，统一 `packageDraft`、sourceDigest/analysisDigest 和事件到动作映射；旧 package/storyPackage 入口经显式迁移，保留原文件。输入来源错配要报错。
3. 修正 canonical 样例；docs/Player/Skill 中需要的副本通过复制/生成任务同步并验证 digest。所有实际发布到 public 的包都进入校验集合。
4. 抽出纯数据几何 metadata：模板边界、眼高/脚底、玩家半径、prefab 碰撞/交互目标点、可见性投影。使静态空间检查与实际 world 装配可用同一数据，不引入 Three.js 到纯契约层。
5. 输出冻结接口表，包括分层 diagnostics、validation 状态、真实 run envelope 和 build manifest；消除 runtime 的宽泛双重类型断言。

**文件边界**：`packages/story-contract/`；共享样例/Schema；`studio/src/contract.mjs` 的作者契约；其他模块仅最小导入对接。几何 checker 实现在 K02，服务行为实现在 K03。

**验证**：shared test/build，完成 A01/A02/A08 的共享契约子断言：BOM/CRLF/emoji、键序不同、错源、缺 provenance、作者版本不兼容。**退出**：冻结文档和 golden fixtures 同时可用，跨包只有一套 hash/模型定义；Studio/Player/export 消费者一致性留 K07 整体验收。

**回退**：保留旧作者产物，迁移生成新修订；新 loader 和默认 fixture 必须一起提交。负责人：契约/总集成，强推理。

### K02 · Player 的动作、空间、存档和生命周期

**前置**：K01；可与 K03 并行。**上下文**：现有 Player 有完整骨架，但 busy/cue、遮挡、存档身份和资源清理影响换故事后的可靠性。

**读取**：[SPEC-01](../../docs/ps1-studio/SPEC-01-RUNTIME.md)、CURRENT-AUDIT 的 D01–D05、K01 冻结接口。

**任务**：严格加载有效包；字幕继续不被 busy 拦截、选择有具体禁用原因；键盘选择与 pointer lock 交接，setMobileUI 同步触控行动状态；实际 session/generation/revision/event receipt 传递到 reducer 和存档。实现加载、暂停、恢复、重试、重新开始、复制槽位、destroy；保存失败后进入独立 memory-only 模式而非推进到下一次磁盘冲突；冲突可载入或复制槽。非法存档先验证再克隆，不覆盖原件。

使用 K01 几何数据装配碰撞与目标点；可见状态改变同步碰撞。遮挡只接受目标之前没有有效阻挡；静态网格探查每个可达状态从 spawn 到交互区域的路径，包含隐藏/拾取对象状态。有限预算超限报告 inconclusive，支持诊断路径定位。不能用全图 beat 列表代替状态访问结果。

销毁取消 RAF/监听器/音频/等待 Promise，晚到回调不得改变新场景。使用可注入存储和调度的单元测试验证竞态，浏览器自动化作为额外实际输入层。

暂停不等于取消：pause 冻结输入与动效，保留当前 cue/进度，resume 继续；retry/destroy 才结算取消并使旧 generation 失效。若暂停请求发生在已经开始的短存档事务内，允许事务完成并更新 checkpoint，然后停在提交边界再暂停，不能撤销已提交事实或把它当晚到错误。

**文件边界**：`game-ps1/src/runtime/`、Player/default fixture、`packages/story-contract/src/spatial.ts`（拟新增，由 K01 接口负责人审核）；必要时给旧 input/audio 加兼容的生命周期 API。旧 story 主流程不重写。

**验证**：game-ps1 build；拟新增 `test:runtime`；A03–A07，已有浏览器再跑 B01/B02。**退出**：六动作/两个模板的正反例、save/replay/cancel 有断言；未跑浏览器的状态如实记录。

**回退**：旧入口继续可构建；新存档保留旧命名空间，不自动迁移或删除。负责人：runtime/空间，强推理。

### K03 · 统一 Studio 服务、CLI 与结果语义

**前置**：K01；可与 K02 并行。**上下文**：文件存储与 jobs 存在，但原子 rename 不等于多文件事务或跨进程串行；CLI/UI 也未正确区分检查结束和检查通过。

**读取**：[SPEC-03](../../docs/ps1-studio/SPEC-03-TOOLS-STUDIO.md)、D06–D09/D12、`studio/src/{services,store,util,cli,http}.mjs`。

**任务**：

1. 固定 CLI 语法：`project create`、`revision import`、`build`、`validate`、`preview`、`export`、`job status/cancel`、`review record`。统一工作区参数/环境变量；默认目录不能随子进程 cwd 悄悄分裂。preview 服务未运行时返回说明/启动办法，不把 url:null 当已启动。
2. adopt K01 作者契约；所有分层报告含 status、version、packageDigest、diagnostics。缺空间/浏览器能力返回 NOT_RUN 或 INCONCLUSIVE；CLI 正确退出码，API/Job/UI 可区分 invalid 和 succeeded。
3. 幂等读取在 head 校验前，键查到后比较 canonical body；create/import/review/job 都测试重放/冲突。按项目串行变更，跨 CLI/HTTP 进程锁和 crash recovery；不可只用 JS Map。
4. queued/running/terminal 有明确状态转换；取消与提交共用终态判定，晚到任务保存为候选但不推进 head，重启不自发重发任务。数据原子落盘与项目 head 一致。
5. capabilities 明示 host-agent 可用、provider adapter 尚不可用；环境变量存在不能代表功能已实现。冻结 UI/Skill/Export 要消费的接口，含项目列表/重开、authoring 保存、任务取消、诊断定位、精确 preview 和导出状态。

**文件边界**：`studio/src/` 服务/CLI/HTTP/类型；`studio/test/`。本步冻结接口，不实现 web 编辑器。导出与预览隔离由 K06 接手同一服务文件，不同时改。

**验证**：Studio test/build；拟新增 `test:service`/`test:cli`；A02/A08/A10–A12/A16。**退出**：CLI 与 HTTP 结果一致，失败不显示通过；同项目多进程与重启恢复有回归。缺 provider 不妨碍离线构建。

**回退**：工作区版本化迁移保留原件，失败不更新 head；不读取其他账户凭据。负责人：服务/集成，强推理。

### K04 · Skill 变成可执行的故事制作流程

**前置**：K01+K03。**上下文**：现有 Skill 是流程文档与薄 wrapper，但 import/project/create 语法未打通；只有格式检查无法发现。

**读取**：[正式 Skill](../../skills/story-to-ps1/SKILL.md)、workflow、schema、K03 CLI 契约；修改 Skill 时按可用 skill-creator 规范。

**任务**：wrapper 支持完整公共子命令；旧 `import` 若保留，明确映射成 `revision import` 并测别名，不能直接转发坏命令。支持显式 CLI 路径、非仓库 cwd、含空格路径、正确退出码。流程分能力检查→来源/认知分析→可玩事件映射→蓝图→真实构建→按 JSON Pointer 局部修复→交付；最多两轮修复，说明改文案/结构/布局的区别。实际模型就是 Kimi 宿主，不伪装 provider。

**文件边界**：`skills/story-to-ps1/` 与其 tests/示例；CLI 若需修改，交 K03 所有人串行修正。不要默认安装到全局。

**验证**：Skill check/quick_validate；拟新增 `test:integration`；完成 A09/A16 的 wrapper/真实 CLI create→import→build→validate 与失败语义子断言，编写完整 preview/export 用例。后两步依赖 K02/K06，尚未就绪记 PENDING_INTEGRATION，由 K07 跑完整流程后才填 A09 PASS。含缺工具、无效包、仅校验、错 revision；禁止仅用假 CLI 证明兼容。

**退出**：Kimi 只需拿到故事和本 Skill，便知道产物字段、实际命令、有限修复与停止条件。确定性测试不宣称测得 AI 增益。

**回退**：项目内 Skill 版本化，原稿保留；无全局配置更改。负责人：Skill，默认配置即可，来源/契约争议交总负责人。

### K05 · Studio 从导入面板升级为编辑器

**前置**：K03 接口冻结；可与 K04/K06 前端无重叠部分并行。**上下文**：现有三栏可复用，但作者修改一句对白也需重新上传 JSON。

**任务**：左栏来源/事实定位；中栏 beat 列表和表单（目标、cue/speaker、guards/effects、next、动作目标）；场景俯视图/数值坐标/朝向/radius 与实时静态诊断；右栏诊断定位和指定修订预览。支持项目列表/重开、未提交草稿、刷新恢复、提交新 revision、冲突提示、当前预览版本标识、真实任务取消和审阅状态。删除被引用对象须提示并阻止坏引用提交。

优先列表/表单/SVG 俯视图，暂不引入图编辑库与任意 3D 拖拽。UI 调用服务校验；不能复制一套编译器。将 provenance 转成“原文/改编/新增”可读标签，调试 ID 放详情，作者主操作使用中文。

**文件边界**：`studio/src/web/` 和 `studio/test/ui-*`；test:ui 脚本/依赖向总集成提交，由其修改 package/lock。API 缺项提交给 K03/K06 负责人，禁止并行抢写 services/http。

**验证**：web build/check；拟新增 `test:ui` 的编辑状态/提交逻辑测试；A15，浏览器可用再 B03。**退出**：无需手改 TS/整包 JSON，能改对白、动作目标和坐标，生成新修订且旧预览不串版。

**回退**：保留 import JSON 与 CLI 入口，编辑器故障不丢源稿。负责人：Studio UI。

### K06 · 导出独立 Player 与本地预览边界

**前置**：K02+K03；与 K04/K05 仅在冻结接口下并行。**上下文**：当前导出复制多入口 assets，有 fallback 说明页；完成导出必须检查真正可运行的资源集合。

**任务**：用独立 Player entry 或 manifest 依赖闭包收集 JS/CSS/必要资源；缺 bundle/资源直接失败。导出只含本次游戏数据和所需代码、最小 manifest/归属/第三方 NOTICE；不复制无关故事文本、源稿/analysis/日志/token。

预览使用只读独立 origin/端口，由服务管理生命周期；明确精确 package/engine digest。HTTP mutation body 使用字段白名单，所有路由统一禁止客户端 arbitrary out；对 symlink/路径逃逸做真实文件系统测试。展示含 `<`/结束标签的故事时使用安全文本/独立 JSON，不把原始 JSON 直接塞 HTML script。

审阅读取最新有效决定并绑定完整输入/build digest；approve 后 reject 必须生效，修改任何绑定输入使旧批准不适用。测试可用合成 review records 验证政策；不会替真实内容记录人工批准。public 导出仍按既有门槛，v0.2 默认交付 private。

**文件边界**：`studio` exporter/http、game-ps1 Player 专用构建、NOTICE/manifest；K03 完成后才修改服务文件。

**验证**：拟新增 `test:export`；A13/A14；静态服务挂 `/games/sample/` 下逐一加载资源，关闭作者服务仍无缺资产；有浏览器再 B04。**退出**：没有以说明页冒充游戏导出、没有整目录附带其他作品、包与报告一致。

**回退**：只写新输出目录，失败保留工作区；不自动覆盖非空目录。负责人：导出/集成。

### K07 · 新故事、AI 价值记录与交付

**前置**：K02/K04/K05/K06。**上下文**：一个读纸条/拿钥匙样例不能证明广泛复用；新的故事不能靠修改引擎适配后再算成功。

**任务**：两个开发样例分别覆盖空间物品流程、对话/知识/选择分支，并覆盖 room/courtyard 与六动作。随后冻结 engine/template/Skill/CLI 版本，再开始一个此前没用于调整核心的原创片段，优先温和/生活题材。最终要求新片段只变作者产物/故事包，不改核心或模板；需要新机制则记录 CAPABILITY_GAP 并作为后续迭代，不偷偷写 storyId 特例。

新片段由 Kimi 按 Skill 实际创作 authoring 并通过确定性验证。记录输入摘要、版本、命令、人工改动、修复轮数、是否修改引擎；只运行一次不声称统计效率提升。完整 A/B 模型评估单列可选实验，不作为本轮代码交付前置。

输出 `evidence/ps1-studio/v0.2/results.json`、`RESULTS.md`、使用说明、启动/构建/验收一条入口和私有导出位置。每项状态可查，更新原规格能力表中过期“已实现/未实现”，不篡改历史运行结果。门户如需本地展示，先重建 `game` 的 build:experiences；只 build game-ps1 不会更新门户目录。

**验证**：A00–A16 + R01；可选 B01–B04/E01–E03 按实际运行记录。**退出**：required 全通过或明确失败，optional 未运行不计入 PASS；所有产物与精确版本一致；使用者从干净依赖安装可以重现。

**回退**：样例是独立包，失败例也保留；不发布到线上。负责人：Kimi 总集成。

## 4. v0.2 之后的迭代候选

按“至少两个真实目标片段都需要”选择一个开发，不同时扩张：

1. **可组合机制包**：先调查/证据关联，再考虑顺序操作。一个机制必须声明输入/事件/保存/取消/空间和正反例，只注册可信代码；包数据不能注入代码。用不同故事验证不是专属支线。
2. **情绪与美术预设**：光照、雾、色板、音景、字幕密度作为模板参数；中性/温和故事不继承近视/恐惧表现。验收同机制换预设不改变剧情 state 和可达性。
3. **作者效率**：诊断自动定位、局部补丁 diff、布局约束建议、模板片段库。优先衡量“修改一次要几步、修复几轮、手改几处”，不以新增按钮数衡量。
4. **可选 provider adapter**：只接实际要用的一种，按届时官方接口实现；假 provider 做故障回归，真调用另行启用。没有 adapter 时 capabilities 应如实关闭。

暂缓 Ink/节点图/云协作，直至作者使用暴露出具体导入或协同需求。本计划没有重新调查开源库或赛事评分，亦不承诺新增功能必然加分。

## 5. 计划调整规则

执行者先复现再修，不能因原实现“看起来做了”跳过验收。某发现当前已修好，提供测试证据后标 NOT_REPRODUCED，不为符合本计划重复改动。新增类型/动作先更新契约和负例，再改消费者；K01 冻结后有变更，记录受影响工作包并串行整合。

遇到无浏览器/无模型凭据，可继续其他本地工作并在结果里写 NOT_RUN；遇到必需代码仍缺失则不能标 full completion。所有需要用户决定的机制扩张单列下一版，不阻塞既定 v0.2 修补与交付。
