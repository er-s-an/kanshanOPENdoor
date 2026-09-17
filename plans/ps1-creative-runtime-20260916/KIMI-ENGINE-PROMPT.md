# Kimi 执行提示词 · 常用游戏引擎能力 R1

最新完整执行入口。继承自由 SceneModule 方向，扩展常用引擎能力；不要求先执行旧 F0–F5 再重复 M0–M7。以下仅供用户复制，本轮规划没有派发或实施。

```text
你接手看山 PS1 游戏创作引擎，负责实际实施与本地自动验收。目标是“面向 Agent 的轻量 Web 3D 游戏引擎与工作台”，不是固定模板生成器。用户已认可普通 TS/Three.js SceneModule 的自由创作方向，现在要求补齐常见游戏引擎能力，使 Agent 拥有人类开发者同样的创作工具和反馈。

仓库：/Users/xiejiachen/zhihu-hackathon-2026/kanshan-v2
先完整阅读：
1. plans/ps1-creative-runtime-20260916/ENGINE-ROADMAP.md
2. plans/ps1-creative-runtime-20260916/ENGINE-SYSTEMS.md
3. plans/ps1-creative-runtime-20260916/ENGINE-ACCEPTANCE.md
4. plans/ps1-creative-runtime-20260916/ENGINE-REVIEW.md
5. plans/ps1-creative-runtime-20260916/README.md（自由代码和稳定身份底线）
6. plans/ps1-iteration-20260916/CURRENT-AUDIT.md（已有缺陷线索，不执行旧固定模板方向）

执行范围：S01–S16 的 R1 最低能力与 M0–M7 工作包。R2/R3 是后续候选，不要无限扩张，也不能把未完成的 R1 静默改为 R2。M0–M7 已吸收旧 F 工作包，不重复实施；当前代码若已经满足某项，先验证证据再复用。

R1 要提供：
- 小内核：单宿主生命周期、模拟时钟/固定步、scope、事件/提交、版本/存档身份。
- 自由场景/资产/渲染：任意 Three mesh/geometry、普通 TS 组合工厂、墙与开口 helper、本地 GLB/纹理/声音、cache/lease、可调 PS1 和原生材质/shader 入口。
- 输入/物理：action map、键鼠/触屏与焦点；第一人称/俯视；静态/运动学/基础刚体、trigger/query、重力跳跃、坡阶和移动平台案例。
- 表现：Clip/Mixer/procedural update、普通代码 timeline 与可扩展回调、跟随/固定/路径镜头、空间音频/bus/fade、轻粒子/屏幕效果。
- NPC/玩法/UI：状态机/waypoint/图 A*、感知/跟随/巡逻；自定义机制与可选对白/背包/目标；中文 HUD/设置/文字大小/reduce-motion。
- 创作工具：场景树/只读运行态 inspector、显式参数和 gizmo/吸附/undo；Agent 可 capabilities/inspect/patch/build/run/pause/step/replay/observe，通过真实反馈迭代。
- 可靠交付：checkpoint/跨场景恢复、真实 CLI/构建/私有静态导出、能力与验收报告、旧入口/StoryPackage 兼容。

架构底线：
1. SceneModule 直接写普通 TS/Three。helpers 和系统 optional；不用物理的作品不能打包 physics WASM，不用背包不依赖背包。不能要求每个对象先登记全局 Entity/prefab/schema，也不做统一巨型 JSON DSL。相机、控制器、玩法均可替换。
2. 单时钟不等于所有系统随便写 position。按规格固定模拟阶段和 transform 权威：导航给意图，controller/physics 修正根运动；动态刚体由物理控制，kinematic 门由机制驱动；表现插值不发奖。pause 不积累巨大 dt，退出隔离迟到回调，区分自有/借用资源。
3. 作者 undo、玩家 checkpoint、作品 revision/build 是三种不同历史。运行态对象默认只读；只有显式 author binding 可永久改参。旧 revision 的 patch/undo 要冲突拒绝，不能反向生成整份 TS 覆盖用户代码。
4. Stable experienceDigest 排除时间、临时绝对路径、日志/报告/摘要自引用；同内容在不同干净目录重建可恢复旧档，代码/参数/资产变化默认隔离。artifactDigest 和 buildId 另有用途。
5. 时间线 scrub 只做隔离表现预览，不改事实/作者产物/存档；播放和 skip 的语义终态需声明并测一致性。音频遵守真实手势解锁，不伪造听感证明。
6. Agent 和 Studio 使用相同 command/query/build 协议。trace 区分真实公开输入与 debug teleport/setState；后者不能算可玩证据。工具返回带版本和实例且有界，不向模型倾倒全场景/原文/凭据。
7. 预览独立只读 origin，无 Studio 作者 token；release 不带调试/作者接口。任意 TS 不是安全沙箱，JSON 检查/模拟回放也不证明所有路径或真实视觉。
8. 无浏览器时工具必须连接真正运行的 RuntimeSessionHost：M0 定协议，M5 启动/连接/停止，M6 接工具。加载实际 SceneModule/controller/physics，query 读真实内存状态，step 推进唯一时钟；只替换 renderer/音频输出，不从预设 JSON 或构建缓存伪造运行态。stop 后旧 handle 失效。

执行顺序：M0 核心协议 → M1 场景/资产；之后 M2 输入物理与 M3 视听可分工，M4 组合 NPC/玩法/UI。M5a 版本/构建协议在 M0 后提前做，M5b 等系统集成；M6a UI/工具骨架、M6b 接协议、M6c 接完整链路。最后 M7 冻结后第三作品和总验收。先交自由空间+动门/平台+动画/声音的切片，不要先做庞大编辑器或数十个无使用场景的工具端点。

环境和边界：
- 先刷新 HEAD/WIP/AGENTS/当前依赖。规划快照 HEAD ff5c4f1db32fe558d0a66b1bb2103a6ae76dc894，分支 codex/initial-upload，仅规划目录未跟踪；不是让你 reset 的目标，未核验远端最新。
- 用 Node 24 与锁文件，Three 当前锁定 0.180.0。沿用 Three/WebAudio；Rapier 原生 JS 是物理首选候选，在 M0 核验 API/许可/体积/WASM 离线打包后锁版本。不要切 React、整体换 Godot 或批量升级依赖。
- 接口/所有 package.json、lockfile、构建配置、公共测试 fixture、汇总 runner 由你串行整合；支持多 agent 时只给独立系统/测试目录，禁止抢写 services/http/contract 等共享文件。
- 不要求真实用户/真机/付费 provider/部署。有可用本地浏览器时运行 B 组，没有则 NOT_RUN，不阻塞必需的离线工程验收。不能声称画面、听感或自然通关已测。
- 默认原创/合成样例；实际故事片段保留来源/新增标记，不抓付费全文，不把会员身份当公开改编权。不要全局安装 Skill、读取无关密钥、覆盖旧作品/存档、commit/push/发布。

验收必须执行 G01–G19 及其必需子断言，M0 建立每个 S 最低 feature→G子项→证据映射，不能大类绿而叶子功能缺失。覆盖 create/update/destroy 异常隔离、空间查询过滤、timeline 并行/混合、存档 CAS/损坏、实际 pause/step/metrics/logs、作者幂等/双进程 head 冲突。物理用实际选定 adapter，不用假 collider 达成通过；GPU/声音需要浏览器才可证明的部分分层标注。三个真实作品都通过公开输入/controller/update/碰撞从初态到目标，再中途 checkpoint 恢复到同一目标，不能 setState/瞬移/发完成事件跳关。

两个开发样例后冻结 core/systems/Skill/tools，再选第三个新 brief；只改作品 TS/资产/参数/测试，不改核心，否则报告泛化失败并修正后另选新 brief。另必须演示真实工具闭环：窄门失败→inspect collider/角色尺寸→author 参数 patch→重建→同输入 replay→通过。不要用假工具文本代替。

更新项目内 skills/story-to-ps1：按需读取系统参考，先了解实际能力，再选择原生代码/可选库；理解故事→空间/动作设计→代码/资源→构建/检查→inspect 反馈→局部修复→交付。缺 helper 不是创作禁令；不要退回模板模式掩盖失败。实现 Skill 时遵循可用 skill-creator 规范。

在制作 Skill 中补一段轻量 vision-in-the-loop 指引即可，不扩引擎：有运行/截图/图像理解工具时主动看实际玩家画面，按创作意图决定是否调整；动画按需看连续帧，修改后按需复看相关部分。观察时机、数量、审美和修复取舍由制作 Agent 自己判断，不规定评分表、截图配额、修复轮数、审核报告或视觉完成门禁。缺工具就如实说明未观察画面并继续其他工作；只存截图不代表已看懂画面。这是面向未来游戏制作 Agent 的 Skill 指引，不是要求你本轮额外进行真人实测或新增强制浏览器验收。

最终交付 evidence/ps1-engine/r1/ 下 baseline、capabilities.json、results.json/RESULTS.md、架构决策、三个源项目与私有导出路径、准确 cwd 的安装/启动/构建/验收/工具使用说明。每个状态附真实命令/断言/版本/WIP hash/日志。分开 LOCAL_ENGINEERING、BROWSER_RENDER_AUDIO、CREATIVE_REVIEW、PUBLIC_RELEASE，不继承历史 54 PASS，不以 subagent 报告或文件数量称完成。

从 M0 开始持续推进 R1；真实阻塞要给出最小复现、已尝试替代和影响的 gate。若抽象限制原生 Three 创意，开放接口或缩减抽象，不通过增加模板或删独特玩法来制造全绿。
```
