# PS1 Story Studio · 当前代码审阅

> 后续方向已修订为[自由场景 Creative Runtime](../ps1-creative-runtime-20260916/README.md)。本文件保留代码缺陷证据；第 3 节旧迭代顺序不再是执行指令。新格式使用新的验收，旧模板限定不应迁入新 SDK。

日期：2026-09-16。范围：只读源码审阅，为 Kimi Agent 制作实施规划。本次没有运行产品测试、启动服务、调用模型或修改实现；下面的触发场景是待执行的复现用例，不是本次实测结果。

## 1. 当前基线

- 仓库：`/Users/xiejiachen/zhihu-hackathon-2026/kanshan-v2`。
- 本地 HEAD：`ff5c4f1db32fe558d0a66b1bb2103a6ae76dc894`；分支 `codex/initial-upload`。
- 本轮开始时 `git status --porcelain=v1` 无输出；PS1 runtime、Studio、Skill 已被跟踪。旧文档中的“无 remote、game-ps1 整体未跟踪”属于旧快照，不能当作今天的状态。
- remote 配置为 `https://github.com/er-s-an/kanshanOPENdoor.git`；没有 fetch，也没有核验远端最新版本或线上服务。
- 未在本仓库及检查过的祖先目录发现适用 AGENTS.md；执行者仍应重新检查。
- 历史 [REVIEW.md](../../docs/ps1-studio/REVIEW.md) 记录过契约 10 项、Studio 3 项测试及 54 项静态整合检查通过；本次未重跑，这些数字不作为当前新增验收的结果。

已有可保留的基础：Three.js PS1 表现、六类 action、两个模板、共享 reducer 与有界状态探查、文件工作区、CLI/HTTP、Skill 骨架。下一轮的重点是把这些组件接成可靠的作者流程。

## 2. 必须先处理的具体缺口

以下“代码确认”指控制流或字段可从源码直接确认；“影响待复现”指需执行测试确定实际表现和范围。A 编号对应 [验收计划](ACCEPTANCE.md)。

| 编号 / 优先级 | 代码证据 | 具体触发与影响 | 规划动作 / 验收 |
| --- | --- | --- | --- |
| D01 / P0 | [默认包](../../game-ps1/public/story-packages/bookstall-opening.json#L48)、[Player loader](../../game-ps1/src/runtime/player.ts#L23) | 默认包四条 cue 缺 provenance；loader 只检查少量顶层字段，不调用完整共享验证。默认演示和规范样例不是同一份有效包。代码确认。 | 一份 canonical fixture 生成 docs、Player、测试引用；先补包再收紧 loader。A01 |
| D02 / P0 | [Director](../../game-ps1/src/runtime/story-director.ts#L38)、[Studio digest](../../studio/src/util.mjs#L9)、[构建](../../studio/src/services.mjs#L137)、[预览](../../studio/src/services.mjs#L104) | Director 通常以 source.digest 当存档键；同一故事两版布局/beat 会共享槽位。Studio build 用 canonical packageDigest，preview/export 等却用普通 JSON.stringify hash。代码确认；串档实际表现待复现。 | 统一 canonical digest；source、package、revision、session 各有用途。A02/A06 |
| D03 / P0 | [交互入口](../../game-ps1/src/runtime/story-director.ts#L72)、[HUD cues](../../game-ps1/src/runtime/hud.ts#L80) | 执行 option 时 busy=true，interact 在 continueCue 之前返回；键盘“继续”无法推进这段 cue，DOM 按钮则走另一条路径。代码确认；pointer lock 下完整体验待复现。 | 区分推进字幕与启动新动作；键盘/按钮/触控调用同一交互语义。A04 |
| D04 / P0 | [空间判定](../../game-ps1/src/runtime/world-assembler.ts#L87)、[碰撞构建](../../game-ps1/src/runtime/world-assembler.ts#L38)、[共享验证](../../packages/story-contract/src/validate.ts#L515)、[报告](../../studio/src/services.mjs#L165) | 遮挡使用 hits.some(target)，目标即使在障碍后也可能通过；碰撞列表目前仅模板墙，prefab 未登记碰撞。共享验证仅结构/语义/状态，Studio 却固定写 spatial pass。代码确认；具体地图影响待复现。 | 同源模板几何、碰撞与可交互区域探查；最近有效阻挡优先；未执行检查不能 PASS。A03/A05/A10 |
| D05 / P0 | [adapter](../../game-ps1/src/runtime/contract-adapter.ts#L46)、[Player loop](../../game-ps1/src/runtime/player.ts#L115)、[HUD destroy](../../game-ps1/src/runtime/hud.ts#L154)、[SaveStore](../../game-ps1/src/runtime/save-store.ts) | adapter 使用固定 session 和 0/0，未传 reducer fencing context；Director 有自己的 generation 检查和 SaveStore CAS，但未完整接通共享事件契约。Player 无整体 teardown，HUD 取消 cue 不结算等待 Promise；复制槽位与损坏存档恢复也未形成用户流程。代码确认，竞态/资源趋势待复现。 | 接通真实 envelope；暂停/重试/销毁有终态；槽位/失败恢复有测试。A06/A07 |
| D06 / P0 | [import](../../studio/src/services.mjs#L110)、[buildPackage](../../studio/src/contract.mjs#L116)、[规范](../../docs/ps1-studio/SPEC-02-CONTENT.md) | import 只要求 analysis/blueprint 是 object；build 接收 package/storyPackage，覆盖 source，未验证 Analysis→Blueprint 的来源链。原规格却要求 packageDraft 与分析/事件映射等字段。源文本也未采用已有规范化函数。代码确认。 | 冻结作者产物 v1；旧格式显式迁移；不把别篇来源静默改成当前来源。A08 |
| D07 / P0 | [wrapper](../../skills/story-to-ps1/scripts/story-to-ps1.mjs#L9)、[转发](../../skills/story-to-ps1/scripts/story-to-ps1.mjs#L116)、[CLI](../../studio/src/cli.mjs#L24) | wrapper 发 import，CLI 只识别 revision import；wrapper 不支持 project create。workflow 的 generate --base-revision 与 CLI 接收的 revision/revision-id 不一致；失败退出码也被 wrapper 统一折成 5。代码确认。 | 统一公共命令语法和文档，从空目录用真实 CLI 完整跑一次。A09 |
| D08 / P0 | [validate](../../studio/src/services.mjs#L154)、[runJob](../../studio/src/services.mjs#L245)、[UI](../../studio/src/web/app.mjs#L15) | invalid 或 browser inconclusive 仍用 ok:true 返回，job 固定 succeeded，UI action 最后覆盖成“完成”；用户可能把“执行完”读成“内容通过”。代码确认。 | 分离 transport/job completion 与 validation result；缺能力、失败、不确定贯穿 CLI/API/UI。A10 |
| D09 / P0 | [import 幂等顺序](../../studio/src/services.mjs#L113)、[job](../../studio/src/services.mjs#L217)、[store](../../studio/src/store.mjs#L76) | 同一次 import 成功后重试，先检查旧 base=head 会拒绝，尚未查到幂等记录。job 各自 queueMicrotask，无按项目写队列或跨进程锁；cancel 成功前后使用旧 job 快照；启动未恢复 running。代码确认，竞争结果待复现。 | 幂等先查、正文后比、再检查 head；写入串行化、事务终态、重启恢复。A11/A12 |
| D10 / P0 | [export](../../studio/src/services.mjs#L187)、[HTTP jobs](../../studio/src/http.mjs#L43)、[预览 fallback](../../studio/src/http.mjs#L107) | 导出复制整个多入口 assets；可能带出无关旧故事 JS。缺 player 时仍生成成功说明页；fallback 直接把 JSON 放进 script，含结束标签的文本存在 HTML 注入路径。通用 jobs 路由透传 body，out 可绕过专用 exports 路由的限制。代码确认，负例待复现。 | 单 Player 依赖闭包、缺 bundle 明确失败、文本安全嵌入、HTTP 字段白名单和工作区路径约束。A13/A14 |
| D11 / P1 | [Studio 页面](../../studio/src/web/index.html)、[交互](../../studio/src/web/app.mjs) | 三栏布局已存在，但中栏是文件导入和状态 JSON；没有 beat/option/坐标表单、来源定位、项目重开、草稿恢复、取消按钮。代码确认。 | 先做表单编辑与诊断定位，支持一次小改动后的重新构建/预览。A15 |
| D12 / P1 可选 | [capabilities](../../studio/src/services.mjs#L53)、[generate](../../studio/src/services.mjs#L145) | 环境变量只要填 provider 名称便宣称 configured，但 generate 的 provider 分支无条件抛错。这是尚未实现的 adapter，不只是没填写密钥。代码确认。 | 本轮优先 host-agent：Kimi 写作者产物。能力声明如实；Studio 内生成作为后续可选模块。A16 |

独立只读审查补充了三个明确的覆盖缺口，已并入 K01/K02 和 A01/A04/A06：

- [validate.ts](../../packages/story-contract/src/validate.ts#L494) 的 span 语义边界只遍历 facts，entry/option cues 没有对应 start<end、end≤source length 检查。
- [FPSInput](../../game-ps1/src/engine/input.ts#L104) 要通过 setMobileUI 解禁触控行动按钮；Player 未调用它。choose 目前只有 DOM click，需在 K02 接通键盘选择与 pointer-lock 交接。
- [SaveStore](../../game-ps1/src/runtime/save-store.ts#L97) 在 IDB 写失败后返回 unavailable，但 Director 仍推进内存 revision，后续提交可能冲突；[读取](../../game-ps1/src/runtime/save-store.ts#L130) 在完整验证前 cloneEnvelope，缺数组的坏记录可先抛错。需用故障注入复现，不能仅断言“保存函数返回 false”。

补充关联问题：预览与作者页面同 origin；“没有在 URL 传 token”不能证明隔离，因为同源脚本仍可读取含 token 的主页。公开导出审阅条件使用历史 approve 的 some，后续 reject 未明确撤销此前批准。它们纳入 K06 的本地边界回归，不要求此次真正公开内容。

## 3. 审阅结论

“本地引擎骨架已落地”有源码支持；“作者输入新故事便能稳定得到游戏”仍有上述集成缺口。建议下一轮先交付 **离线作者闭环 v0.2**，再增加机制包与更多故事。旧的测试通过记录值得保留，但不能覆盖新发现的缺口。

本文件没有宣布上述用例已经复现，也没有根据文件数量推算完成百分比。执行者在 K00 复现后逐项标为 CONFIRMED / NOT_REPRODUCED / FIXED，附版本与证据。
