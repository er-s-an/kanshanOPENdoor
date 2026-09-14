# PS1 Story Studio · 可接手开发计划

状态：LOCAL CORE IMPLEMENTED · 2026-09-15 · 9 步计划；S01、S02、S04、S05、S06、S07 的本地核心已落地，S03/S08/S09 的内容与外部验证门槛仍需完成或明确标记。

目标：复用现有 Three.js 渲染，建设受约束 StoryPackage 运行时、共用作者工具、可安装 Skill 与本地轻量 Studio，并用留出故事证明复用。

当前实现映射：共享契约与 10 项测试对应 S01；Player、模板、交互和存档对应 S02；Studio CLI/HTTP/服务/UI 对应 S04/S05/S07；项目内 Skill 与 wrapper 对应 S06；`scripts/verify-ps1-studio.mjs` 是静态整合门。S03 目前只有原创 Player 示例，尚未把真实旧故事迁移为 StoryPackage；S08 留出故事／AI 对照和 S09 的正式公开导出仍需按验收矩阵完成。不要因为本地 build 通过而把这些步骤都标记为完成。

规格入口：[docs/ps1-studio/README.md](../docs/ps1-studio/README.md)。工作目录：仓库根目录。

## 全局执行约定

接手任意一步：先读本文件该步、所列规格和 [BASELINE](../docs/ps1-studio/BASELINE.md)，检查 `git status --short` 和实际依赖。当前 `game-ps1/` 整体未跟踪，多个 game 文件有旧 WIP；不全量 add、不 reset、不覆盖未知改动。当前无 remote；默认本地精确文件修改，不假设 PR 流程。用户后来要求 branch/commit/PR 时才安排，默认分支前缀 `codex/`。

本表命令是步骤应交付的 scripts 接口，不是当前可用脚本。命令缺失是该步未完成，不得用 `echo PASS`、mock 画面或静态文案替代。安装依赖前固定 Node24 与锁文件；不要为方便升级整个旧项目依赖。

每步交付改动清单、命令与退出码、测试报告、已知缺口、下一步接手说明。预算／截止时间变化时先缩减发布范围，不删验收证据。所有改动可通过停止使用新入口／功能开关回退；实际删除或 Git 回滚需另按用户授权执行。

## 依赖与并行

```text
S01 契约 → S02 运行时 → S03 迁移样本 ─┐
        └──────────→ S04 工具链 ────┼→ S05 服务与模型
                                    │          ├→ S06 Skill ─┐
                                    │          └→ S07 Studio ┼→ S08 留出验收 → S09 导出收口
                                    └─────────────────────────┘
```

S02 与 S04 可在 S01 接口冻结后并行，分别改 `game-ps1/` 与 `studio/`；shared 变更由 S01 所有人审阅，不双方抢改。S06 与 S07 可在 S05 冻结接口后并行。S03 的迁移结果是 provider 默认设计能力可用的前提，不能跳过后直接宣传可生成。

模型分工建议：S01/S02/S04 架构及 S08 审查由最强可用推理配置处理；固定契约后的 UI/fixture 工作用默认配置即可。这是工作建议，不自动创建任务或切换用户模型。

## S01 · 冻结内容契约和确定性状态机

前置：无。上下文：旧 contract.ts 带函数回调，旧 pipeline recipe 不是 PS1 包。本步引入唯一数据契约，不迁移旧故事。

必读：[SPEC-02](../docs/ps1-studio/SPEC-02-CONTENT.md)、[SPEC-01 §2–3](../docs/ps1-studio/SPEC-01-RUNTIME.md)、[ACCEPTANCE](../docs/ps1-studio/ACCEPTANCE.md)。

任务／文件：新建 `packages/story-contract/` 的 package、TS 导出、schema、semantic validator、canonical encoder、纯 reducer、状态 BFS 和 fixtures。将本轮 schema/example 作为起点；生产源移入包后，docs 通过构建复制并校验 digest，不分叉维护。先解决 guard/beat/end 语义和 finite limits，再冻结 v1。

验证（本步需实现）：`npm --prefix packages/story-contract run build`；`npm --prefix packages/story-contract test`。覆盖 T01/T02/T03，含跨 Node/browser canonical golden fixtures。退出：正常例通过；每类负例正确拒绝；超限为 inconclusive；不存在 eval、DOM、Three.js／provider 依赖。

回退：新包未接旧入口，可停止采用，无需动旧 game 数据。估计 1–2 工程日。

## S02 · 新 Player 与受控空间

前置：S01。上下文：三个旧 PS1 入口继续保留；本步新增 `player.html`，共享契约但不重写旧 story main。

必读：[SPEC-01](../docs/ps1-studio/SPEC-01-RUNTIME.md)、[SPEC-02 §3/5](../docs/ps1-studio/SPEC-02-CONTENT.md)。

任务／文件：`game-ps1/src/runtime/` Player/Director/Assembler/Input/HUD/SaveStore；room/courtyard 两模板和六个 prefab catalog；加入新 Vite 入口、file dependency、runtime tests。把 PS1 视觉与 myopia/fear 分开；实现中断、资源所有权、存档、guard 反馈、事件 fencing；模板几何数据与空间验证同源。

验证：`npm --prefix game-ps1 run build`；新增 `npm --prefix game-ps1 run test:runtime` 和 `test:player`。覆盖 T03–T06/T19；真实走动原创样例，20 次销毁重建，end 恢复无重复 effects。退出：六动作有测试，两个模板通过同一装配器，不能靠专用 TS 回调装作包驱动。

回退：旧入口无须引用新 Player；禁用新入口保留新包／存档，不删除旧 key。估计 3–5 工程日。

## S03 · 迁移一个现有故事片段

前置：S02。上下文：《蓝血》与《末等妃嫔》各有手写状态机；不要求本步迁完全文。优先选择不依赖镜面／棋局的完整事件片段，保留原入口用于对照。

必读：[BASELINE](../docs/ps1-studio/BASELINE.md)、[PRD §5](../docs/ps1-studio/PRD.md)、[ACCEPTANCE §3–4](../docs/ps1-studio/ACCEPTANCE.md)；对应旧 story main/world/README 与原始授权片段。

任务／文件：新内容 fixture、来源审阅和 migration mapping；把事件逐一映射成 scenes/beats，记录不得移植的 bespoke 逻辑。不得为了覆盖完整作品无计划扩大 v1。如果必须改模板／动作，在此步内重新冻结，记版本。

验证：`npm --prefix game-ps1 run test:player`；新增 `test:legacy` 覆盖三个旧入口核心路径；人工来源审阅和自然通关录像。退出：T07/T08，至少两个空间行动、一个持久状态反馈；当前代码／模板 digest 已记录。未知授权只做私有证据，不公开原文。

回退：保留旧故事默认路由；迁移包独立存放，不能替换原作入口到坏包。估计 1–2 工程日。

## S04 · 作者产物、工作区与公共 CLI

前置：S01；可与 S02 并行，浏览器级验收等待 S02。上下文：旧 pipeline 可借鉴分析／设计经验，但缺密钥自动 mock 和旧 chapter 格式不能直接沿用。

必读：[SPEC-02](../docs/ps1-studio/SPEC-02-CONTENT.md)、[SPEC-03 §1–2](../docs/ps1-studio/SPEC-03-TOOLS-STUDIO.md)。

任务／文件：`studio/src/{services,cli,authoring}/`；SourceRecord/Analysis/Blueprint schema；import/build/static validate、canonical manifest、版本库与 capabilities。明确添加 `.story-workspaces/` 忽略项，不顺手改其他 ignore。接口按 SPEC-03；preview/browser 命令接 S02 player，不复制解释器。

验证：`npm --prefix studio run build`；新增 `npm --prefix studio run test:core`；`npm --prefix studio run story -- capabilities --json`。用手工蓝图离线 build 两次，字节 digest 相同；恶意文本／路径不越界。退出：T01/T03/T09/T11；host-agent 有真实可用的 import→build→validate 路径，无模型也可构建。

回退：独立工作区和包，保留用户源稿；停止新 CLI，不动旧 pipeline。估计 2–3 工程日。

## S05 · 任务服务、provider 与审阅状态

前置：S03+S04。上下文：CLI 与 HTTP 必须调用同一 service；仅本地单用户，不建公开多租户平台。provider 接入选择用户实际配置，官方接口需届时核验。

必读：[SPEC-03 §3–4/6](../docs/ps1-studio/SPEC-03-TOOLS-STUDIO.md)、[SPEC-04 §2](../docs/ps1-studio/SPEC-04-SKILL.md)。

任务／文件：`studio/src/server/` HTTP、任务持久化、预算／取消／幂等、provider adapter、review invalidation；单写队列、revision 冲突、local token+Origin/Host。默认不发送外部模型请求；真实集成测试须在已配置和获授权预算下显式启用，不自动用用户凭据。

验证：新增 `npm --prefix studio run test:service`，fake provider 注入 401/429/timeout/bad JSON/late result；T09/T10/T12/T18/T20。退出：无凭据返回失败；mock 有标签；crash 不自动重发付费任务；对同修订 CLI/API digest 相同。至少一次真实模型生成是 G2 AI 证据前提，未跑单列 NOT_RUN。

回退：服务保持 loopback；关闭 provider／服务仍能离线 build。任何配置和数据迁移保留原件。估计 1–2 工程日。

## S06 · 正式 Skill 包与前向测试

前置：S05。上下文：当前 `docs/ps1-studio/skill-draft/` 不是已安装 Skill。此步必须先有真实 CLI，不能只将草案复制进全局目录就叫完成。

必读：[SPEC-04](../docs/ps1-studio/SPEC-04-SKILL.md)、[草案](../docs/ps1-studio/skill-draft/story-to-ps1/SKILL.md)、当时可用的 skill-creator。

任务／文件：正式 `skills/story-to-ps1/`，简短入口、实际必要 references 和薄 wrapper；版本／安装前置校验，host/provider 状态和失败交付。不要默认全局安装；先在隔离工作区调用测试。

验证：skill-creator quick_validate；新增 `npm --prefix studio run test:skill`，加独立前向行为测试。T11/T13；缺工具返回 NOT_IMPLEMENTED，能力缺口不偷偷改 TS，公开批准不被代签。退出：另一环境可找到正确 CLI，执行真实生成／校验路径；所有结果可溯源。

回退：撤销新 Skill 的选择／打包引用即可；不修改官方知乎 Skill 或用户其他技能。估计 0.5–1 工程日。

## S07 · 轻量 Studio 界面

前置：S05；与 S06 无共享业务实现，可并行。上下文：是本地作者工具，不是第二套生成器或通用 3D 编辑器。

必读：[SPEC-03 §5](../docs/ps1-studio/SPEC-03-TOOLS-STUDIO.md)、[PRD](../docs/ps1-studio/PRD.md)。

任务／文件：`studio/src/web/` 输入页、三栏编辑、source spans、beat/option 表单、场景俯视图、诊断定位、任务进度／取消、revision 冲突 UI、精确版本预览和审阅。预览与作者 API 隔离；无 React Flow、账户或公共写 API。

验证：新增 `npm --prefix studio run test:ui`；T12/T14/T18/T20，未提交草稿、旧报告、刷新、取消、无 provider、审阅失效逐项走通。退出：普通作者不用手改 TS 就能改文案、动作绑定和布局并重新试玩；导出按钮在 S09 前明确不可用，不冒充成功。

回退：CLI/Skill 可独立使用；禁用 UI 不影响内容包。估计 1.5–3 工程日。

## S08 · 冻结与留出故事 / AI 价值实验

前置：S06+S07。上下文：迁移一篇不能证明复用；样例通过不能证明 Skill 有增益。此步不要为了漂亮数字改实验条件。

必读：[ACCEPTANCE](../docs/ps1-studio/ACCEPTANCE.md)、[SPEC-04 §6](../docs/ps1-studio/SPEC-04-SKILL.md)。

任务／文件：`evidence/ps1-studio/`（仅脱敏可发布证据）与私有原始日志；固定引擎／模板／模型／提示和分组；选择权利明确、开发时未使用的片段，至少一个非恐怖风格；用普通提示与 Skill 配对比较。两名评阅者独立看完整结果；真实来源材料不默认入仓库。

验证：新增 `npm --prefix studio run eval:story`（显式模式与预算）；T08/T15/T16。退出：同版无需改核心，新故事自然通关，报告包括失败和手工修改。若改了 runtime/template，本次留出尝试记失败，再用新故事重测。小样本／未跑真实 provider 的局限明确标注。

回退：可以判定 NO-GO 并只发布“运行时原型”定位；不删失败记录。估计 1–2 工程日，不含等待人工审阅／模型配额。

## S09 · 静态导出与交付收口

前置：S07+S08。上下文：导出独立游戏不等于部署；作者服务和原始源稿不能随包公开。

必读：[SPEC-03 §6](../docs/ps1-studio/SPEC-03-TOOLS-STUDIO.md)、[ACCEPTANCE §6](../docs/ps1-studio/ACCEPTANCE.md)。

任务／文件：`studio/src/services/exporter`、UI/CLI export 连接、asset allowlist、NOTICE、内容与版本清单、非根路径构建和导出测试。私有／公开用途门槛明确；公开按钮引用精确批准。更新开发说明与真实能力清单，保留 Planned 项。

验证：新增 `npm --prefix studio run test:export`；所有包 build、T07/T14/T17–T20 回归；全新静态 server 非根路径通关，断开作者服务；检查包内容、网络请求和隐私清单。退出：G1/G2/G3 有版本化证据，旧入口正常，未实测平台单列。

回退：不覆盖非空输出；导出失败保留工作区。停止新导出／入口即可回到原功能。上线、提交、commit/push 由用户另行授权。估计 1–2 工程日。

## 变更协议与关键风险

任何一步可拆分／延后，但必须记录日期、原因、影响的需求／验收、依赖调整和旧决策。新增能力先改 schema/catalog/spec 与负例，再改实现；不能用“临时故事特例”跳过兼容约束。出现临时硬编码时把 G2 标未达成。

- 模板不足：先缩改编片段；新增机制需要明确代价与留出重新冻结。
- 作者侧 API 范围膨胀：P0 保持 loopback 单作者；云端协作是独立项目范围。
- 模型不稳定：上限／局部修复／可人工编辑，不以无尽重试掩盖失败。
- 来源或赛事条件不明：继续私有原创样例技术验证；公开／参赛主张等待明确依据。
- 人工审阅排期：技术通过与来源／体验审阅分开报告，不能由开发者自动批准自己的未知素材。

总量级约 12–20 工程日，细项会重叠且误差较大；S03 后根据实测重估。先交付可玩数据驱动片段，再开放作者工具和 Studio，不以 UI 完成百分比代替闭环验收。
