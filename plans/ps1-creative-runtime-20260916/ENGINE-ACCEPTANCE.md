# R1 引擎能力验收合同

2026-09-16 · PLANNED / NOT_RUN。规划本身没有运行产品测试。工作包见 [路线图](ENGINE-ROADMAP.md)，系统边界见 [规格](ENGINE-SYSTEMS.md)。

## 1. 完成标准

R1 = S01–S16 的路线图最低能力 + G01–G19 必需自动断言。R2/R3 不计入 R1，但不能把未完成 R1 项改名成 R2 来取得全绿。旧 C01–C15 被下列 G 组吸收，保留其自由创作、身份、实例、真实作品回放边界。

状态：PASS、FAIL、NOT_IMPLEMENTED、NOT_RUN、INCONCLUSIVE；工作包阶段可用 PENDING_INTEGRATION，最终 required 不能为此值。报告分别列 LOCAL_ENGINEERING、BROWSER_RENDER_AUDIO、CREATIVE_REVIEW、PUBLIC_RELEASE；无真实体验评审写 UNREVIEWED，无发布请求写 NOT_REQUESTED。

“无需真人实测”仍保留；必须运行的是本地编译、单测、真实 CLI/文件系统/API、实际 Three/physics 数学路径及模拟集成。浏览器自动化是可选补证，没有环境不阻塞本地工程完成，但不得声称画面/声音/自然通关已验证。

## 2. 必需断言与归属

| ID | 必须证明什么 | 反例/边界 | 工作包 |
| --- | --- | --- | --- |
| G01 开放/模块化 | 原生 Three 作品不登记全局 prefab/entity；可独立不用物理/背包/timeline | 无关系统及其 WASM 不进入最小 bundle；helpers 可绕过 | M0/M1/M5 |
| G02 调度/生命周期 | 单宿主固定步/插值，暂停恢复时间连续，scope 释放、迟到回调隔离 | 长暂停不补一大段 dt；资源借用不误删；权威 transform 无竞争 | M0/M3 |
| G03 自由场景 | 自建 Geometry、helper、用户组合工厂混用；真实门窗开口 | 不通过加入核心 enum 接新物件；动态对象不要求持久 ID | M1 |
| G04 资产/美术 | GLB/纹理/音频引用及共享 cache、缺失报错、PS1/近视解耦 | 两实例共享资源退出一个仍有效；新色调/镜头可配置 | M1/M3 |
| G05 输入/控制 | FPS/俯视两路线，键鼠/触屏逻辑映射、modal 焦点与 blur 清理 | UI 选择不同时移动人物；pressed/held/released 不串帧 | M2 |
| G06 物理/运动 | 使用真实选定 adapter：墙/门洞、刚体/trigger、坡阶/重力跳跃、移动平台案例 | 测不能穿过闭门、台阶限高/坡限值、门动后 collider 同源；不是 mock collision | M2 |
| G07 动画/过场 | Clip/Mixer/procedural 三者与 timeline 接通，播放/skip 语义终态一致 | pause/cancel/恢复/迟到完成；scrub 不提交事实或存档 | M3 |
| G08 音频 | bus/空间参数/fade/loop 的调度和释放，解锁策略 | 未解锁不假称发声；退出后的 pending unlock 不启动旧声源 | M3 |
| G09 镜头/效果 | fixed/follow/path 和 cut/blend、粒子/屏幕效果、reduce-motion | 相机切回原 rig，不改玩家权威位置；无 GPU 不报渲染/FPS PASS | M3 |
| G10 NPC/导航 | waypoint/图 A*、感知、巡逻/跟随，controller 受真实碰撞约束 | 门状态令路径失效/重算；无路径/卡住可观察，不穿墙直达 | M4 |
| G11 状态/身份 | checkpoint/resumable、跨场景恢复、同内容重建身份一致、修改隔离 | 两干净目录同 identity；失败保存不假持久化；重复事件不发奖 | M0/M5 |
| G12 玩法开放 | 自定义机制 + 可选对话/背包/目标；事件 payload 校验 | 不改六动作 enum；禁用某玩法库仍构建；坏事件不改状态 | M4 |
| G13 UI | 中文字幕/菜单/提示、中文长文状态、字体大小/动态效果设置、focus | DOM/状态断言不冒充排版目测；取消 cue Promise 有结算 | M4 |
| G14 编辑/撤销 | scene tree/inspect 与绑定参数/gizmo 命令、吸附、undo/redo、修订/重建 | 无绑定 mesh 只读/临时；并发源代码改动令旧 undo 冲突，不覆盖新值 | M6 |
| G15 Agent 工具 | capabilities/inspect/author patch/build/preview/replay 的真实接口闭环 | 过期 session/handle/revision 被拒；query 有界，trace 区分 debug-assisted | M5/M6 |
| G16 构建/导出 | 真正依赖闭包含所需 WASM/纹理/bin/声音，子路径私有静态包 | 关闭 Studio 无作者 API 依赖；不带无关故事/调试接口/token，缺 bundle 失败 | M5 |
| G17 安全/兼容 | 独立预览 origin、作者 mutation、路径/HTML 边界、legacy loader | 否决不被历史批准覆盖；不削弱旧 public gate；旧档/源码保留 | M5 |
| G18 Skill 作者链 | 实际 wrapper/CLI，原生最小例 + 系统组合例，定位诊断→局部修复 | 缺命令/能力诚实失败；不用假 provider/假 preview，参数提交不覆盖自由 TS | M6 |
| G19 组合与泛化 | 两个开发作品 + 冻结后的新 brief；三个都从公开输入到目标并从中途恢复到目标 | 不直接 setState/teleport/发终局事件；第三作不改 core/systems/Skill/tools | M7 |

表中无 GPU 的对象/参数断言用实际 Three 对象和运行逻辑；音频可用可记录 adapter 断言调度，但标为 AUDIO_SCHEDULING_ONLY。物理 required 不用假 adapter 替代，必须运行实际选定库。真实 WebAudio 听感、shader 编译/画面、浏览器输入/字体需 B 组另证。

### 必需子断言：不能只给大类一个 PASS

以下是独立审查发现容易遗漏的最低子项，同属上述 required gate，不增加 R2 范围：

- **G02.a 异常隔离**：分别注入 create/update/destroy 抛错；实例进入明确错误/停止状态，已登记资源继续清理，其他会话不被污染；诊断包含阶段和源位置。任意未受管的全局副作用不能因此被宣称自动安全。
- **G06.a 空间查询**：实际 adapter 的 raycast、shape cast、overlap 各有正反例；self/layer 过滤、最近有效遮挡、已移除 collider 不再命中。
- **G07.a 编排**：sequence/parallel/wait 的时序、Clip 混合和循环、取消结算；skip 与自然完成事件去重；scrub 使用隔离状态，不推进存档。
- **G11.a 存档冲突**：同槽 CAS 冲突、重复 receipt、损坏/旧 schema 存档、存储不可用、复制/迁移失败保留原件；非法数据先校验，不在 clone 时直接崩溃。
- **G15.a 真实会话**：CLI/工具连接实际 RuntimeSessionHost；公开输入 + step 后，同一 session 的 tick/姿态/碰撞状态按真实逻辑改变。pause 后自动步停止，手动 step 仅推进指定步；running 时不启动第二套步进；stop 后 handle/query 被拒。禁止查询预设 JSON 冒充运行状态。
- **G15.b 可观测性**：错误日志可回到作品源位置；实际 CPU 阶段计时和对象/资源计数随操作变化；headless 无法得到的 GPU/FPS/截图明确 NOT_MEASURED/NOT_RUN。查询有上限和版本，不能泄露作者 token/全量源文。
- **G17.a 作者并发**：同 commandId/同正文重试幂等，不同正文冲突；两个独立进程基于同 head 提交不得相互覆盖；取消/完成竞态及重启后未完成任务有明确状态，不自发重复提交。
- **G12.a 来源边界**：有来源的作品校验 source digest、跨度/片段范围和 provenance 字段；原创内容显式 original/invented，不把结构校验称为人工忠实性审核。

M0 将路线图中每个 R1 最低功能拆成 assertion，并登记 `S → feature → G/子项 → evidence`。下列是类别映射，不能代替叶子断言；缺映射或未运行子项不得声明对应 S complete：

| 系统 | 验收归属 |
| --- | --- |
| S01 | G01/G02/G02.a/G11/G15.a |
| S02 | G03/G14 |
| S03 | G04/G16 |
| S04 | G04/G09/G15.b，真实渲染另列 B01 |
| S05 | G05/G09 |
| S06 | G06/G06.a |
| S07 | G07/G07.a |
| S08 | G08，真实声音另列 B02 |
| S09 | G09，真实效果另列 B01/B02 |
| S10 | G10 |
| S11 | G05/G13，实际排版另列 B01/B02 |
| S12 | G12/G12.a |
| S13 | G11/G11.a |
| S14 | G14/G17.a |
| S15 | G15/G15.a/G15.b/G18 |
| S16 | G01/G16/G17/G17.a |

## 3. 实际作品与交互路线

示例题材只是开发 brief，不变成新的世界模板。建议两个开发作品覆盖不同控制方式、空间、行为：

- **室内机关探索**：不规则空间与开口、门或平台、交互/背包任选、一次动画/镜头过场，checkpoint。
- **开放空间 NPC/信号谜题**：非封闭布局、路径 NPC/感知、另一种核心操作、空间音效及可见文字替代、一个跨场景状态。

允许更换 brief，只要覆盖矩阵清楚且不是同一钥匙故事换皮。未适合塞入作品的基础刚体/极端输入等可用独立 fixture 验收，不把全部功能硬塞进每个小游戏。

第三个在冻结后由 Kimi 按新需求确定，记录 core/systems/Skill/tools 哈希和 brief 时间。只写作品代码/资产/参数/测试；若核心必须修改，记录能力缺口并重新冻结、换一个新 brief，不能算原测试成功。

每份作品的 simulated-runtime 必须加载实际 SceneModule、真实 controller/碰撞/机制，注入公开输入和时钟完成目标；途中保存、卸载/恢复后完成同一目标。允许无 GPU 渲染边界和可注入存储，不允许替换玩法逻辑、直接完成事件跳关。trace 记录阶段、checkpoint、目标断言，标明模拟证据。

G15/G18 至少一条真实工具调试闭环：构造窄门导致角色无法通过 → inspect 实际 collider/角色半径 → 通过 author patch 扩大门洞 → 重建 → 重放相同输入 → 目标通过。不能只让假工具返回预设成功文本；构造失败例是合成测试，不是声明用户原工程有此缺陷。

## 4. 可选补证

| ID | 范围 | 缺环境时 |
| --- | --- | --- |
| B01 | 本地浏览器实际画面、shader/GLB 首帧、键鼠/触屏事件、gizmo、截图与日志 | NOT_RUN；保留逻辑证据，不声称视觉正确 |
| B02 | 真实 WebAudio 解锁/暂停/退出及声源行为、中文 UI 画面、reduce-motion | NOT_RUN；合成调度测试不是听感证明 |
| B03 | 导出包子路径播放、跨 origin 预览桥接、同内容重建加载存档 | NOT_RUN；HTTP/身份断言仍必须做 |
| E01 | 原模板/原生 Three/新 SDK 的相同 brief 小规模比较 | NOT_RUN，不宣称效率/评分提升 |
| E02 | 真人创意/故事忠实性/体验评价、真机/公网 | 不要求；UNREVIEWED/NOT_RUN |

有可用浏览器时执行 B 组，缺失不自行购买服务/使用账号。没有实测前不承诺 FPS、移动设备表现、音效质量、泛化成功率或 AI 增益数值。

## 5. 命令、文件所有权和报告

实际 cwd：`/Users/xiejiachen/zhihu-hackathon-2026/kanshan-v2`。先刷新 AGENTS/WIP/Node 24/锁文件与可用脚本。已有基础命令：

```sh
npm --prefix packages/story-contract test
npm --prefix game-ps1 run build
npm --prefix studio run build
npm --prefix studio test
npm --prefix skills/story-to-ps1 run check
node scripts/verify-ps1-studio.mjs --json
```

拟新增命令由 M0/M5 集成者实现并登记后才有效，不声称当前存在：

```sh
npm --prefix game-ps1 run test:creative
npm --prefix game-ps1 run test:engine-systems
npm --prefix studio run test:author-tools
npm --prefix skills/story-to-ps1 run test:integration
node scripts/verify-ps1-engine.mjs --json
```

测试建议按 core-/assets-/physics-/presentation-/gameplay-/author-/export- 分开目录/文件，package/lockfile/公共 fixture/runner 由总集成串行维护。新测试数据使用独立临时目录，不改用户故事/旧档。历史固定模板断言改为明确 legacy 路径，不删失败断言换“新模式通过”。

报告拟落 `evidence/ps1-engine/r1/`：

- baseline：HEAD/WIP、文件 hash、环境、当前能力和初始失败。
- capabilities.json：每个 S 的 status、版本、具体范围、evidence level、限制，以及每个最低 feature 对应的 G/子项与证据，不能只有布尔 available。
- results.json / RESULTS.md：G/B/E 逐项实际 command/cwd/输入/断言/退出码/日志、模块和作品身份。
- architecture-decisions：物理候选选型、身份/clock/author command/trace 版本与影响。
- examples/export：三个完整作品源项目、导出路径、安装/构建/启动/工具操作说明。

不以 subagent 完成消息、文件数量或脚本存在判全完成；总负责人必须运行汇总。必需未通过就报告真实缺项，不用 optional NOT_RUN 掩盖 required 失败。
