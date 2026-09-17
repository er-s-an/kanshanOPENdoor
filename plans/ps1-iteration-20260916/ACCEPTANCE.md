# v0.2 验收执行合同

> 新 Creative Runtime 格式的验收以[新验收计划](../ps1-creative-runtime-20260916/ACCEPTANCE.md)为准。本表保留旧解释器回归线索，不能用固定六动作/两模板/只改 JSON 限制新作品。

状态：PLANNED / NOT_RUN · 2026-09-16。本文是给 Kimi 的执行要求，本次规划没有执行以下测试。与原 [T01–T20](../../docs/ps1-studio/ACCEPTANCE.md) 对应；不覆盖或抹去原发布门槛。

## 1. 验收层级和完成定义

| 层级 | 内容 | 默认执行要求 | 通过后可说什么 |
| --- | --- | --- | --- |
| A / 必需 | 本地构建、公开 API/CLI 集成、真实临时文件系统、注入式 runtime/存储/任务测试、DOM 编辑逻辑、资源闭包检查 | A00–A16 + R01 全部完成 | 本地实现和自动验收通过 |
| B / 可选 | 本地浏览器实际键鼠/触控模拟、页面恢复、资源销毁、非根路径游玩 | 已有环境可用就跑；不可用记录 NOT_RUN，继续 A | 指定浏览器/版本的自动路径通过 |
| E / 可选 | 真人自然试玩、手机真机、真实外部 provider、AI 对照实验、公开部署 | 本轮不要求；不因此阻塞本地实现 | 只按确实取得的证据描述 |

用户前文已说明无需真实实测。本计划因此不把真人/真机/付费调用设为本轮前置，但也不把 A 当作已经验证 B/E。浏览器 runner 可单独启用；实现缺失与环境缺失要分开写，不能把缺功能一律归为环境不可用。

required 任一 FAIL / INCONCLUSIVE / NOT_IMPLEMENTED，`localComplete=false`；required 尚未执行为 NOT_RUN，也不能算完成。optional NOT_RUN 不阻塞 `localComplete`，但 `browserVerified`/`publicReady` 仍为 false。公开导出按原策略校验，不删除其门槛以追求本轮全绿。

导出聚合策略：private 要求必需的结构/语义/状态/空间检查通过，以及 Player 资源完整；optional browser NOT_RUN 不阻止 private 导出和 offline completion。public 仍要求原规格规定的浏览器和人工审阅。显式请求一次 browser validate 而缺 runner 时，该命令返回非零/NOT_RUN，但不会把已经通过的 offline 报告改成失败或伪造通过。

建议在 K03 冻结统一报告：请求是否成功、job 是否完成、validation 是否通过为不同字段。允许查询成功的 HTTP 200 返回 invalid 报告，但 CLI 校验须非零，UI 明确“未通过”，导出拒绝；job 不能仅以 succeeded 给出绿色总通过。

## 2. 必需用例

所有用例记录具体输入、操作、预期、实际、证据路径和版本。以下均为预期，不是已通过结果。

| ID / 负责人 / 原测试 | 用例与关键断言 |
| --- | --- |
| A00 / K00,K07 / 全部 | 在 Node24、记录的锁文件下按 shared→Player→Studio 构建；旧入口仍存在并能构建。脚本列举每项 required/optional，子进程失败向上返回非零；不能只有文件存在或 grep 就 PASS。 |
| A01 / K01,K02 / T01,T08 | 对 docs、Player public、Studio fixture、export 中每份实际 StoryPackage 使用共享校验。正常例通过；未知字段/版本、重复 ID、缺 cue provenance、错误 speaker、错 next 拒绝并有 JSON Pointer。facts、entry cues、option cues 三处都测 start>=end 与 end>source length；补充 emoji 码点。默认包必须在收紧 loader 的同一改动中修正。 |
| A02 / K01,K03,K06 / T03,T12 | 相同内容改变 object key 插入顺序，build/validate/preview/review/export/Player 的 package digest 一致；改变对白/布局/动作后 digest 改变。BOM/CRLF 按规范化一次处理，保留其余空白；source digest 独立于 package digest。可选字段 undefined 在服务输入规范化阶段处理。 |
| A03 / K02 / T02,T04 | 分支汇合、可退出循环、封闭循环、相互矛盾 guards、缺物品、隐藏当前目标、取走后再次 collect、跨场景相同局部 anchor ID。BFS 与 runtime 前置一致；超状态/时间预算为 INCONCLUSIVE，不能误报通过。报告中的可达 beats 来自探索结果。 |
| A04 / K02 / T05 | 六类 action 均有操作例；entry cue、option cue、choose、end 使用真实 Director/HUD 方法接受相同语义输入。busy 期间可推进当前字幕但不可重复发起动作；键盘选择/按钮/触控状态同步，disabled 说明具体 guard。输入按住/连击只提交一次。pointer lock 的真实浏览器交接留 B01。 |
| A05 / K02 / T04 | 两模板共用几何元数据；spawn 墙内/墙外、目标埋墙、anchor 超边界、玩家半径后窄路不可达、目标在遮挡物后全部被拒绝。无遮挡/绕行可达是正例。按最近有效阻挡判定，不因射线后来命中目标而放行；prefab 碰撞/隐藏状态与几何探查一致。 |
| A06 / K02 / T06 | 同 source 的包 A/B 内容不同：A 存档后 B 从初态开始，A 重载恢复；同包不同 slot 隔离。IDB 第一次写入失败后再执行两次行动，明确进入 memory-only 且能继续，不永久 conflict、不覆盖原持久记录。两实例同 revision CAS 仅一个成功，另一个能载入或复制槽。缺数组/坏 flags/未知 beat/异常 revision/不可达状态的保存先校验并隔离，能够重新开始。 |
| A07 / K02 / T03,T06,T19 | pause 冻结输入/动效，resume 保留当前 cue 位置且只提交一次；已开始的短存档事务允许完成，在 checkpoint 边界暂停。retry/destroy 才取消并结算等待 Promise，使旧 generation 无效；随后旧回调不产生新 effects。confirm-end 重放不重复写。20 次挂载/销毁后注册监听器/调度任务回基线，资源释放调用成对；实际 WebGL 资源趋势留 B02。 |
| A08 / K01,K03 / T01,T08,T11 | SourceRecord→Analysis→Blueprint→Package digest 链一致；错源、分析不符、事件循环、fact/角色引用未知、必要事件缺映射有诊断。旧 package/storyPackage fixture 显式迁移生成新产物；不能用覆盖 source 字段消除错误。故事中要求读密钥/运行代码的文字仅留在源数据，构建不执行指令。 |
| A09 / K04 / T13 | 从非仓库 cwd、含空格 CLI 路径、隔离工作区运行 wrapper 的 project create→revision import→build→validate→preview→private export。目标是真实 CLI，不用 echo 假成功；预览需本地服务和精确资源可取。命令语法、revision/base-revision、stdout JSON 和退出码一致；缺 CLI=3、参数/内容错=2、冲突=4、执行失败=5（以冻结契约为准）。同时测试只校验现有包和仅 capabilities。 |
| A10 / K03,K05 / T10,T12,T14 | 构造 static invalid/state inconclusive：CLI 非零、API 报告明确、job/UI 不出现“校验通过”，private/public 均拒绝。单独请求 browser validate 且 runner unavailable：命令非零/NOT_RUN，public 拒绝；offline 必需检查通过的 private 不因此拒绝。空间 checker 没运行不得硬写 pass；通知不能被通用“完成”覆盖。成功结果的版本和诊断不会贴到新草稿。 |
| A11 / K03 / T09,T10 | create/import/review/job 的同 key 同 body 返回原结果；import 成功后 head 变化，再重试仍返回原修订。相同 key 不同 body=409；两个进程同时用同 base 提交，只有一个晋升 head，另一个得到 409 或明确候选结果，不丢历史。 |
| A12 / K03 / T09,T10 | 可控延迟任务注入：排队取消、执行取消、提交前取消、提交后取消、晚到结果、进程中断和重启。终态不被覆盖；重启把 running 正确归为 interrupted/failed，queued 有明确恢复策略，不隐式重发模型。head、修订文件、job 结果一致；破损临时文件不替换有效修订。 |
| A13 / K06 / T17 | 在新目录导出；缺 Player bundle 明确失败；非空输出拒绝。manifest 每个资源存在且 hash 一致，仅包含 Player 依赖闭包；无未选旧故事文本/JS、完整源稿、analysis、作者 API/token/日志。用临时静态服务挂到 /games/sample/，关闭作者服务再请求所有资源仍 200；页面不能是 fallback 说明页。实际游玩留 B04。 |
| A14 / K06 / T09,T18,T20 | 所有 mutation 路由显式字段白名单，jobs 的 out/嵌套覆盖参数不能写任意路径；临时 workspace 中 symlink 指向外部 sentinel，操作拒绝且 sentinel 不变。外部 Origin/错 Host/token 拒绝；预览端口/能力与作者端分离且不提供 token 页/API。含结束标签的故事/标题仍为文本。合成审阅 approve→reject 后 public export 被拒绝；任一 source/analysis/blueprint/package/build 版本变化使旧审批失效。真实内容不自动批准。 |
| A15 / K05 / T14 | 在编辑状态/DOM 测试中：导入→修改对白→改 action 绑定→移动 object/anchor→诊断定位→提交新 revision。删除仍被引用对象不能静默留下坏引用；离开提醒、刷新草稿恢复、重开项目、head 冲突、取消任务都有行为断言。新 preview revision 与旧报告分离，原 JSON 导入路径仍可用。真实页面手势和布局留 B03。 |
| A16 / K03,K04 / T10,T13 | provider adapter 不存在时，设置 provider 名称也不能把模式宣称为可用；host-agent 正常路径完全不调用 provider。mock 显式标记，不是生成证据；Skill 交付 source/analysis/blueprint/package/report/revision/缺项，修复不超过约定轮数。无浏览器是 NOT_RUN，不能伪造 playtest 通过。 |

### R01 · 冻结后内容复用

由 K07 负责，对应原 T08/T15/T16 中的本地可验证部分。准备两个开发包：空间物品线性包、知识/对话/选择分支包，覆盖六动作与两个模板。然后记录 runtime/template/CLI/Skill 文件集摘要，冻结后再创作第三篇原创片段；第三篇只允许修改作者产物和内容包。

第三篇要求至少两个空间行动、一个可观察的状态反馈、一个选择或知识变化、清楚的片段结束。禁止只换标题/对白复刻同一份钥匙图。自动检查来源链、状态/空间、导出与核心文件未改；保留生成/修复全部尝试。若需修改核心，本次复用尝试记失败，修完后重新冻结、换新材料。

这能支持“同版引擎接入新的内容包”的有限结论。Kimi 同时参与开发和出题时，不叫独立盲测；没有浏览器/真人证据，也不叫自然通关。通关时长和好玩程度不从 beat 数估算。

## 3. 可选增强验收

| ID | 运行方法和断言 | 未运行影响 |
| --- | --- | --- |
| B01 | 本地 Chromium 用实际键盘/鼠标/触控模拟从入口走到边界，覆盖字幕、choose、end、pointer lock、每个保存 beat 重载；禁用跳章/设 flag/瞬移。测试 hook 只读观测状态。 | 不宣称完整浏览器交互已验证 |
| B02 | 20 次实际加载/退出，观察 RAF、DOM、音频/WebGL 资源趋势；参考桌面 10 分钟帧时间记录，原提案 p95≤33.3ms 仅在记录硬件/视口下适用。 | 不宣称实际性能/无泄漏 |
| B03 | Studio 真页面完成修改三类字段、诊断跳转、修订切换、取消、刷新；验证预览跨 origin 无法读作者 token/API；补长中文和小窗口。 | DOM 单元测试不能证明布局/实际浏览器隔离 |
| B04 | 导出包在另一静态服务的非根路径实际玩完并刷新；作者服务关闭、网络日志只访问导出资源。 | 只能说明资源闭包验证通过 |
| E01 | 真人自然游玩及真实手机性能，按原 T15/T19 留记录。 | 不作为本轮前置 |
| E02 | 外部 provider 真调用；费用/模型/接口/失败与修复次数按真实值。 | host-agent 不依赖它；不报告 provider 成功 |
| E03 | 同一模型/工具/素材/预算，普通提示与 Skill 比较；建议 3 篇×两组×2 次=12 次，保留失败，至少 2 人独立评阅。 | 本轮只做运行记录，不声称有统计效率增益 |

## 4. 命令合同

在仓库根运行。以下是本次读取 package.json 确认已存在的命令，不表示本次执行过：

```sh
npm --prefix packages/story-contract test
npm --prefix game-ps1 run build
npm --prefix studio run build
npm --prefix studio test
npm --prefix skills/story-to-ps1 run check
node scripts/verify-ps1-studio.mjs --json
```

需要干净安装时按各 package-lock 执行 npm ci，先 `packages/story-contract` 安装和 build，再安装/构建消费者。记录实际 Node24 路径；不要因为全局 Node 能跑就宣称 Node24 已验证。根目录 `npm test` 仅根模板测试，不代替以上命令。

下列均为 **拟新增接口**，不得现在报告可用；对应工作包负责实现或在接口冻结时给出等价命令并更新本文：

| 拟新增命令 | 归属 | 用途 |
| --- | --- | --- |
| `npm --prefix game-ps1 run test:runtime` | K02 | 确定性输入/空间/存档/生命周期用例 |
| `npm --prefix studio run test:service` / `test:cli` | K03 | 临时工作区、真实 CLI/API、任务竞态 |
| `npm --prefix skills/story-to-ps1 run test:integration` | K04 | wrapper 调真实 CLI 完整流程 |
| `npm --prefix studio run test:ui` | K05 | 编辑状态和 DOM 行为，浏览器另列 |
| `npm --prefix studio run test:export` | K06 | 导出内容、资源闭包和本地边界 |
| `node scripts/accept-ps1-studio.mjs --mode offline --json` | K07 | 汇总 required 与 evidence，不执行外部 provider |
| `node scripts/accept-ps1-studio.mjs --mode browser --json` | K07 | 明确 opt-in 的本地浏览器用例 |

Skill quick_validate 路径依执行环境定位；它只验证 Skill 格式，不代替 A09。测试报告输出目录统一为 `evidence/ps1-studio/v0.2/`；包含用户源稿的中间数据使用被忽略的临时工作区，报告只存可公开的合成材料和最小摘要。

## 5. 结果格式与反作弊要求

总报告至少含 `runId / startedAt / finishedAt / gitHead / workingTreeDigest / nodeVersion / lockfileDigests / engineDigest / templateDigest / skillDigest / toolVersion / tests / localComplete / browserVerified / publicReady`。每项 test 含 `id / required / status / evidenceScope / command / exitCode / fixtureDigest / reportPath / reason`。

状态枚举：PASS、FAIL、NOT_RUN、NOT_IMPLEMENTED、INCONCLUSIVE。负例“正确拒绝”是测试 PASS，但被拒内容仍是 invalid；两个层次不能混淆。注入式 IndexedDB/DOM/调度测试的 evidenceScope 写 simulated-runtime，不能写 real-browser。无报告不能从旧日志补 PASS。

总命令检查每个 required ID 是否有本轮结果，缺一项就非零；不能只运行存在的 scripts 再忽略缺失测试。仅退出 0、页面 200、文件存在、截图、模型自评、自动批准或新增测试数量都不是完整验收依据。
