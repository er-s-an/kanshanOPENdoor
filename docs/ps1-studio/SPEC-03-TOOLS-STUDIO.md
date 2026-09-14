# SPEC-03 · 公共工具链与轻量 Studio

状态：LOCAL CORE IMPLEMENTED。本文的 CLI、服务、HTTP 和轻量页面已提供对应最小实现；provider、browser validation 和公开部署仍按规格保持显式门槛。覆盖 R06–R09、R12。

## 1. 一套 application services，两种入口

CLI 和 HTTP adapter 调用 `studio/src/services/` 的相同函数；compiler、validator、revision store、exporter 不复制进 UI／Skill。前端通过服务取能力和报告，不硬编码另一套 action 枚举。

P0 是**本地单作者工具**：服务只绑定 127.0.0.1；作品导出后才是公开静态页面。账户登录、多人共享、云端生成、公开写 API 不在本版范围。local 不等于无安全要求：浏览器其他网站也可能试图请求 localhost。

工作区默认 `.story-workspaces/<projectId>/`，先加入忽略规则再存任何源稿；导出到用户指定的新目录。projectId/revisionId/jobId 由服务产生，不能当路径直接拼接，拒绝路径穿越／符号链接逃逸。原始故事不进入仓库默认跟踪。

建议内部结构：`source/`（原稿与规范化稿）、`revisions/<id>/`（analysis/blueprint/package/manifest）、`reports/`、`reviews/`、`jobs/`。除任务状态外修订不可变；写临时文件、fsync、rename 原子提交，失败保留最后有效修订。两进程抢写用锁与超时错误，不做静默覆盖。

## 2. CLI 契约

提供 npm script：`npm --prefix studio run story -- <command>`。Node24，stdout 为请求的 JSON 结果，stderr 放脱敏进度。下列命令是已冻结的 CLI 契约；本地核心可执行性见 [REVIEW.md](REVIEW.md)，provider、浏览器和公开导出的门槛仍不能由静态检查冒充。

| command | 参数与作用 |
| --- | --- |
| `capabilities --json` | 输出 tool/schema/runtime/template 版本、模板几何元数据、action catalog、已配置 provider 名称、支持的工作模式；不返回密钥 |
| `project create` | `--source FILE --metadata FILE`；metadata 含 title/author/extent/boundary/usage/authorizationNote 和可选 verifiedUrl，与 HTTP 输入一致；复制源稿、生成项目 ID |
| `revision import` | `--project ID --analysis FILE --blueprint FILE --base-revision ID`；host-agent／人工产物导入，返回新 revisionId |
| `generate` | `--project ID --base-revision ID --mode provider\|mock --provider NAME --max-calls N --max-repairs N`；provider 模式必须显式配置，无密钥就失败 |
| `build` | `--project ID --revision ID`；确定性编译，无模型／网络 |
| `validate` | `--project ID --revision ID --level static\|browser`；static 包含结构、语义、状态、空间；browser 需实际浏览器 |
| `preview` | `--project ID --revision ID`；启动／返回 localhost 指定修订的播放器，不能默认为最新草稿 |
| `review record` | `--project ID --revision ID --scope source\|experience\|public-use --decision approve\|reject --note TEXT`；仅用户显式作出审阅决定后记录，不能自动调用形成批准 |
| `export` | `--project ID --revision ID --out NEW_DIR --audience private\|public`；只导出已 build 的精确包，禁止覆盖非空目录 |
| `job status` / `job cancel` | `--job ID`；取消停止新请求，不保证外部已发出的模型请求可退费 |

所有 mutation 支持 `--idempotency-key KEY`。`project create` 返回一个空白初始 revisionId，后续 import/generate 必须传该 base。首次无 analysis 不使用虚构的默认分析；缺少来源必填字段或 review.scope 均返回 BAD_INPUT，不用隐式默认批准填补。CLI 不自动查找／读取无关用户凭据，provider 由明确配置选择。

统一结果：`{ok,requestId,data,diagnostics}`；失败 `data:null`，给机器可区分 code。退出码 0 成功，2 参数／内容无效，3 能力缺失／预算或权限不足，4 revision 冲突，5 执行失败或验证不确定，130 取消。mock 输出有 mode 标签，不能通过 AI 实证测试。

## 3. HTTP API 与并发

拟提供 `/api/v1`。请求 JSON 大小上限 2 MiB，源文本仍受 20,000 码点限制；只接受本地 UI 固定 Origin、匹配 Host 和会话随机 token。CORS 不使用 `*`；校验 Origin/Host 防跨站／DNS rebinding。token 不放 URL 或静态导出，授权失败 401/403。CLI 调用本地 services 不绕过路径／revision 校验。

| endpoint | 输入 | 输出 |
| --- | --- | --- |
| GET `/capabilities` | — | 同 CLI 能力目录 |
| POST `/projects` | sourceText, title, author, extent, boundary, usage, authorizationNote | projectId, revisionId |
| GET `/projects/:id` | — | source 元数据、headRevisionId、任务摘要 |
| GET `/projects/:id/revisions/:rev` | — | 精确修订的 authoring 与 build 状态 |
| POST `/projects/:id/revisions` | baseRevisionId, analysis, blueprint | 新不可变 revisionId |
| POST `/projects/:id/jobs` | revisionId, operation, mode?, provider?, budget? | 202 jobId, statusUrl |
| GET `/jobs/:id` | — | status, phase, revisionId, attempts, usage, diagnostics |
| POST `/jobs/:id/cancel` | — | cancel_requested / cancelled / already_terminal |
| POST `/projects/:id/reviews` | revisionId, decision, scope, note | reviewId，绑定所有输入／构建 digest |
| POST `/projects/:id/exports` | revisionId, audience | 202 jobId；服务器管理导出目录，不接受浏览器任意路径 |

operation = generate/build/validate-static/validate-browser；只有 generate 接收 provider/mock。host-agent 是外部 agent 通过 revision import 提交产物，不是 Studio 服务可调用的虚构模型。以 project+operation+Idempotency-Key 查找幂等记录，再比较其中存储的 bodyDigest；同 key 同 body 返回同 job，同 key 异 body 返回 409，不能把 bodyDigest 放进查找键。尚无 projectId 的 create 以本地作者工作区+operation+key 为作用域。

baseRevision 与 head 不一致返回 409 REVISION_CONFLICT，展示差异／允许显式另建分支，不静默覆盖。job 固定读取提交时的 revision，不读取随时变化的 head。任务生成结果若 head 已变化，保存为可查看候选，不抢占最新编辑。取消与成功竞态以持久化的第一个终态为准，晚到结果不得晋升 head。

错误：400 BAD_INPUT、401/403 LOCAL_ACCESS_DENIED、404 NOT_FOUND、409 REVISION_CONFLICT/IDEMPOTENCY_CONFLICT、413 TOO_LARGE、422 CONTENT_INVALID/CAPABILITY_GAP、429 BUDGET_EXCEEDED、503 PROVIDER_UNAVAILABLE。provider 返回内容不回显认证头；自动重试不得把授权失败当作模型输出格式错误。

## 4. 任务状态与故障恢复

`queued → running → succeeded | failed | cancelled`。phase 为 ingest/analyze/design/build/validate/browser/export，展示真实开始／结束时间，不用模拟百分比。

持久化 job 的输入 digest、mode、provider/model 标识、工具版本、尝试次数、诊断和产物指针。记录 token／费用时使用 provider 实际返回值；不可用标 unknown，禁止估算值冒充实付。

每项目一个写任务，其余排队；多个只读 preview 可以并存。重启后 running 标为 interrupted/failed，不自行重发付费请求。用户显式 retry 创建关联的新 job，复用确定性缓存但不凭旧“开始”日志认定已完成。

生成默认预算提案：最多 6 次模型请求、最多 2 轮内容修复、总墙钟 10 分钟；均在运行前可调并展示。网络 retry 也计入请求预算；到限输出部分产物和报告。无 credentials、额度未知／不足或 provider 不可用，不自动降级 mock；可建议用户显式切换模式。

## 5. Studio 信息结构

P0 桌面三栏：

- 左：源文本定位、事实／事件清单、角色知情和片段边界，来源与新增标签。
- 中：beat 顺序列表和选项关系摘要；选中后编辑目标、文案、guard/effect、场景对象坐标。空间用俯视简图／数值表单，非通用 gizmo 编辑器。
- 右：独立 preview iframe、诊断列表及定位；显示正在试玩哪个 revision，避免把旧成功报告贴到新草稿。

顶部只保留“生成方案、校验、试玩、导出”。保存用版本提交／防抖 draft buffer；未提交草稿离开前提醒。初始页解释输入范围；生成期间可取消；没有 provider 时仍可人工／host-agent 导入，不能展示假的生成进度。

公开模板示例默认只读。作者 UI 和播放器隔离：player 只读指定包，不持有作者 token；iframe 限制能力，postMessage 检查来源、类型与会话 ID，不接收任意代码／路径。S07 确定独立本地 player origin，避免与作者服务同源暴露存储。

人工审阅分 source（来源／剧情）、experience（体验）、public-use（公开用途）三项，与 CLI/API 的 scope 枚举一致，不用一个绿勾代替所有证明。任何源稿／analysis／blueprint／package digest 改变，审批失效；需要明确指出旧审阅存在但不适用新版本。私人预览不要求公开用途批准。

## 6. 导出

private：可导出带“私人原型／未审阅”提示的静态包，但结构／状态／空间有 error 或 inconclusive 时不导出为可分享成功产物。

public：须通过静态与浏览器验证、来源与体验审阅、usage=authorized-public，并有用户对当前用途明确批准。声明只是工作流记录，不由工具确认法律权利。没有权利依据时，允许退回原创／自有文本样例，不阻止本地技术开发。

产物：静态 index、锁定 player 资源、必要 StoryPackage、build manifest、作者／来源归属、第三方 NOTICE。不带原始完整源稿、内部分析、模型对话、tokens、缓存、作者 API 或用户个人信息。manifest/元数据同样做隐私审查。包内用于实际游玩的文字是有意发布的内容，公开前一并审核。

路径支持非根目录部署；不依赖作者本地服务、外部字体或未打包资源。接受不等于自动部署；上传／公开发布仍是另外的明确动作。输出 ZIP 时固定排序／时间等元数据实现可复现内容，报告可独立保存实际生成时间。
