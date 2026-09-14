# SPEC-02 · 内容模型与编译契约

状态：PROPOSED。机器结构草案：[Schema](schema/story-package.schema.json)，[原创示例](examples/story-package.json)。覆盖 R01–R06。

## 1. 四种产物，不能混为一谈

| 产物 | 必含内容 | 是否进入导出游戏 |
| --- | --- | --- |
| SourceRecord | 原始输入、规范化文本、sha256、用途／授权声明、来源与截断说明 | 只输出最少元数据，不带完整 source.txt |
| StoryAnalysis | 事实及来源定位、事件顺序、角色知情范围、未知项、不可越过边界 | 不输出，避免额外剧透与源稿泄漏 |
| SceneBlueprint | 玩家目标、原文事件到动作映射、模板选择、空间布局、人工审阅项 | 不输出 |
| StoryPackage | 本 Schema 描述的可执行数据、必要玩家文案与最少归属信息 | 输出；默认可被玩家读取，不具备保密性 |

作者端另存 Revision / Review / BuildManifest，不能在 package 里放一个 `approved: true` 自我认证。

## 2. 来源定位和忠实度

只规范化 UTF-8 BOM 与 CRLF→LF，不 trim、不做 Unicode NFC 转换。哈希基于规范化 UTF-8 字节。offset 使用 **Unicode 码点**而不是 JS UTF-16 索引，起点含、终点不含；行号从 1 开始供 UI 显示，不作为唯一定位。

source.id 是工作区引用；package.source 仅包含 title / author / digest / codepointLength / extent / boundary / usage / 可选核验 URL。`extent = excerpt | complete` 来自实际输入，而不是产品摘要；不确定时用 excerpt。usage 为 `private-prototype | authorized-public`，是使用者声明，不是法律认证。

文本事实与每条 cue 必须有 provenance：

- `sourced`：对应原文表达，至少一个 span；是否逐字引用由文字本身决定，标签不代表自动版权授权。
- `adapted`：从原文转成动作／转述，至少一个 span，并写说明。
- `invented`：空间布置、衔接文案等新增内容，必须说明目的，不允许 masquerade 为原作事实。

span = `{start, end}`，必须落在 normalized source 范围；authoring 保存可显示的来源片段。源文本不在公开包里，因此公开端只能验证范围；作者端才验证 span 是否准确支持文案。

facts.kind = `observed | reported | hypothesis | unknown`，区分亲见、转述、人物判断和未知。knownFacts 表示玩家获知某条表述，不意味着该表述是世界真相。所有包内文字都会被技术读者看到；对正常 UI 的揭示顺序需单独验证。

## 3. StoryPackage v1

顶层：`schemaVersion, id, title, runtime, source, flags, items, facts, scenes, startBeat, beats`。对象封闭（additionalProperties:false），所有 ID 只用小写字母／数字／短横线，跨表引用由语义验证器处理。

runtime 固定 `engineMajor:1, templateVersion:1`。仅 bool flags，每包最多 8 个；最多 8 个物品、32 个事实。开始时 inventory/collectedItems/knownFacts 为空，flags 使用各自 initial。

scene 对应受信模板，包含 spawn、objects、anchors。object 可选 itemId（曾收集后永久隐藏，不随消耗复活）、visibleWhen 单一 flag 条件；anchor 关联 object。全包内同 itemId 最多一个拾取对象；P0 无丢弃／再拾取。所有坐标和 radius 为有界有限数。Schema 无法保证碰撞和引用正确，须通过额外检查。

beat 包含 sceneId、objective、entry cues、action、options。action 为：

| kind | 附加字段／语义 |
| --- | --- |
| inspect | anchorId；空间内观察 |
| collect | anchorId, itemId；成功选项必须含匹配 inventory present:true effect |
| use | anchorId, itemId；成功选项必须要求已有该物品，是否消耗显式写 effect |
| talk | anchorId；靠近人物进入固定对话，非模型聊天 |
| choose | 无空间参数；2–4 个选项，有意义的抉择或解释，不自动设定原文真相 |
| end | 无参数，无选项；显示当前片段完成说明 |

inspect / collect / use / talk 恰好一个选项。每个 option 包含 id / label / guards / cues / effects / next。guard 数组按 AND；条件只有 flag/value、inventory/present、knowledge/present。effect 只有 flag/value、inventory/present、knowledge/present；必须引用已声明 ID，无表达式求值。

effect 数组对每个 `(kind,id)` 最多一次赋值，避免依赖数组顺序的冲突。collect/use 必须有对应可见目标对象；collect 的 targetObject.itemId 必须匹配 action.itemId，且尚未登记 collectedItems。collect 成功除显式 effects 外，确定地登记 collectedItems，这是内建动作语义，不是包内任意隐式脚本。guard 不满足的选项显示禁用和原因。P0 不支持跳到尚未存在的 beat、自动脚本事件或模型回调。

cue 仅 narration/dialogue + text + provenance，dialogue 必须有 speaker（当时可用称呼），narration 禁止 speaker；Schema 已用条件规则表达，语义审阅再核实称呼是否剧透。选择是否消耗、信息是否撤回都显式描述；撤回原先知情不是“玩家忘记”，内容审核可禁止不合理的 knowledge present:false。

## 4. 作者中间产物与确定性编译

S04 在实现时为 SourceRecord / Analysis / Blueprint 建立独立机器 schema，冻结以下最低字段，不得变成无契约的大段 prompt：

- SourceRecord：version、source.id/title/author/extent/boundary/usage、authorizationNote、rawText、normalizedText、digest、codepointLength、可选 verifiedUrl；id/digest/规范化结果由服务产生，不信任模型填写。
- Analysis：version、sourceDigest、facts（同本包 fact 结构）、characters（id、当时允许称呼、initialKnownFactIds）、events（id、provenance、participantIds、factIds、mustFollowEventIds）、unknowns、boundary、reviewQuestions。认知和事件引用必须存在，mustFollow 不得形成矛盾循环；仅表达源片段内事件。
- Blueprint：version、sourceDigest、analysisDigest、packageDraft（本 StoryPackage 结构）、eventToAction（eventId、beatIds、rationale）、creativeAdditions（paths、reason）、reviewQuestions。paths 为 packageDraft JSON Pointer；事件映射可以多对多，但关键事件的遗漏必须有明确说明和审阅。

compiler 验证三份产物的 digest 链；packageDraft.source 必须匹配 SourceRecord 对外元数据，不符就报错，不能偷偷覆盖。包内事实须来自 analysis 的相同 fact ID／表述，新增事实先回到 analysis 并重新审阅。引用外事实或提前改变角色称呼的疑点进入人工审阅报告。

AI 负责产出 Analysis 和 Blueprint；`build` 是无模型、无网络的确定性编译：去掉作者注释，计算 manifest、验证 ID／状态／空间，输出 StoryPackage。相同规范化输入、蓝图、compiler/runtime/template 版本必须产生相同 package digest。

digest 使用递归排序 object key、保持 array 顺序、标准 JSON 编码后的 UTF-8 SHA-256；拒绝非有限数值，规范化 -0 为 0，不变换文本。digest 不放回自身 package；放 BuildManifest。输出时间戳仅在外部报告，不混进 digest。跨 Node／browser golden test 比较精确字节。

manifest = `{packageDigest, sourceDigest, analysisDigest, blueprintDigest, compilerVersion, engineVersion, templateVersion, schemaVersion}`。每次源稿／蓝图改动形成新 revision，旧报告和批准不能沿用。

## 5. 分层验证与失败语义

1. Structural：schema、ID 唯一、大小／类型上限。
2. Semantic：所有引用、action/option 基数、item 对应、cue speaker、effect 冲突、来源 span、完整 end、模板能力。
3. State：从初始状态 BFS 穷举可达 `(beat,flags,inventory,collectedItems,knownFacts,ended)`，使用与 runtime 相同的动作前置条件和 reducer，验证每个可达非 end 状态有可用选项，且能经 confirm-end 到达 ended；环可存在，但不能有非终止封闭分量。不把纯图可达当成带条件状态可达。
4. Spatial：每个可达 beat 状态都能从该场景 spawn 走到一个有效可用目标，按当时可见物体与碰撞投影检查。
5. Browser：实际输入、碰撞、渲染、存档、导出路径。
6. Editorial：来源支持、认知顺序、新增内容、情绪／玩法贴合；需要人工明确审阅，不由 Schema 宣布通过。

状态探查最多 100,000 个状态／30 秒；超限 `INCONCLUSIVE_STATE_SPACE`，**不能当 PASS**。缩小包或改设计后再测。动态 prefab 能力缺失为 `CAPABILITY_GAP`，不能编译为无效果占位动作。

diagnostic = `{code,severity,path,message,evidence,repairHint}`，path 为 JSON Pointer，severity = error/warning/info。自动修改只根据明确诊断，报告列 changed paths；忠实度修改需要重新审阅。不可自动删除关键剧情以“修到可达”。

## 6. 版本与导入边界

schemaVersion 精确为 `1.0.0`；未知 major/minor 在 loader 拒绝，不按猜测兼容。迁移函数后续显式实现并留原件。旧 pipeline chapter recipe 不兼容此格式；适配器必须转换并重新验证，不能直接改字段名宣称支持。

未来 Ink 导入仅转换受支持节点、选项、变量，报告不支持的函数／外部调用；不执行不可信源码。第一版无用户插件、HTML、代码、任意 URL、文件路径或外部资源下载。
