# R1 系统规格与 Agent 创作接口

2026-09-16 · 提案，不代表接口已经实现。配套：[路线图](ENGINE-ROADMAP.md) · [验收](ENGINE-ACCEPTANCE.md)。本文件冻结语义和最小范围，具体 TS 签名由 M0 写可编译 fixture 后确定。

## 1. 共同接入原则

- SceneModule 可以直接持有真实 Three 对象与任意局部 TS 模块。**不需要为了加入一面墙先建立全局 Entity、组件 registry 和 schema。**
- 需要某系统时再绑定小接口：physics body、animation mixer、sound source、navigation agent、persisted state、author parameter。绑定系统元数据不等于将整个场景翻译成 JSON。
- `scope` 管理资源、订阅、任务、mixer/audio/physics/nav handles；共享资产借用和自有资源释放分开。退出后返回的异步资产须释放或归还，不能重新挂载旧实例。
- 每个 optional system 声明自身版本、实际依赖、支持的能力及限制。先实现一个真实后端，不为“可插拔”同时造多套物理/音频引擎。
- 推荐目录 `creative/{core,scene,assets,render,input,physics,controllers,animation,camera,audio,effects,ai,interaction,gameplay,ui,state,debug}/` 只是文件所有权建议，不意味着每个目录都拆 npm 包。

## 2. 时钟、阶段与 transform 写入权

一个宿主调度器，分模拟时间与工具/UI 实时时间。建议固定模拟步默认 1/60 秒，可配置；最大追帧步数与丢弃时间记录在诊断，不无限追帧。暂停冻结 simulation time，恢复不把暂停时长加入 dt。固定步不等于跨浏览器/跨 CPU 物理严格确定性。

每个固定步语义顺序：

1. 消费输入与焦点层，检查 session/generation/revision；处理已排队的安全控制命令。
2. controller、NPC、timeline 计算意图；需要碰撞的程序运动转换为角色/kinematic 意图。
3. 执行物理/空间查询与碰撞修正，生成接触/trigger 结果。
4. 交互/机制处理结果，提交带 receipt 的事实/机制事件；需要存储的提交使用明示事务边界，失败策略可观察。
5. 表现系统根据权威状态更新动画/声音/镜头；render 阶段插值并绘制，不在插值中提交玩法事实。

普通 `update` 仍是合法入口；作者可选择模拟/表现 hook，无需为每个属性注册回调。只有一个属性由多个系统共同控制时，才需要明确写入权：

| 对象 | 权威写入方 | 其他系统怎样参与 |
| --- | --- | --- |
| 动态刚体的根 transform | PhysicsWorld | 动画/脚本通过力、速度或明确 teleport 控制，不每帧抢写 mesh.position |
| 玩家/NPC 根运动 | 被选定的 controller + 物理修正 | 导航给路径/速度意图；骨骼 Clip 默认只影响视觉子节点，root motion 未接入时明确禁用 |
| 门/升降台等运动学对象 | 机制阶段 + kinematic target | timeline 给目标；物理碰撞与 render pose 同源，不能各走一条时间线 |
| 没有碰撞意义的布片/灯光/粒子 | 场景脚本或表现系统 | 允许自由 update，不强制状态序列化 |
| 镜头 | 当前 active camera rig | 过场切换通过控制权令牌，退出后恢复旧 rig；叠加震屏不更改角色权威位置 |

不同脚本竞争同一已绑定通道时开发模式可报警，而非自动禁止所有原生 transform 操作。debug teleport 不等于玩家移动，必须出现在 trace 标记中。

## 3. 场景、资产与渲染（S02–S04）

### 数据与接口边界

- `authorId` 是作者主动声明的稳定对象/参数标识；运行时产生的 Mesh 可只有实例 handle，不要求全场景每个粒子都有永久 ID。
- 可复用组合工厂是普通函数，例如作者自己的窗框/货架/NPC 构造函数；可嵌套，可返回 Group 与可选系统绑定，不能限定 catalog。
- 资产描述含逻辑 key、本地引用、类型和归属；缓存 key 基于资源内容/加载参数。预加载/引用计数/缺失诊断统一，可显式延迟加载。
- glTF 的外部 bin/纹理、必要解码器必须进入依赖闭包；不承诺导入 .blend/FBX，R1 输入以 glTF/GLB 为主。资产归属记录不能代替许可证许可核验。
- PS1 基础层负责像素分辨率/采样等；近视、恐惧值或具体故事 palette 为可选效果。文字 UI 保持可读，不能随低分辨率画布一起糊掉。
- 性能记录 draw calls、triangles、资产字节和 CPU 阶段耗时；FPS/GPU 时间只能来自实际渲染，headless 无法获得时明确 NOT_MEASURED。

### R1 具体退出条件

原生手写几何、一个 helper、一个用户工厂、一个小型自有 glTF fixture 能同时存在；同一共享材质被两个实例借用时退出一个不损坏另一个。灯光/雾/相机/材质可不同于默认故事，未使用系统不进入 bundle。

## 4. 输入、物理和角色（S05–S06）

输入从设备映射为作者可扩展 action/axis，不把 `squint` 固定在通用接口。区分 pressed/held/released，焦点层按 modal UI → editor → game 仲裁；blur/退出清理状态，防卡键。测试从这些公开输入进入，不能直接改人物坐标冒充正常输入。

R1 物理首选候选为 Rapier 原生 JS adapter；M0 核验后锁版本。最低提供：

- 静态、运动学、基础动态刚体；box/sphere/capsule/适当的静态 mesh，collision groups、sensor/trigger。
- raycast/shape cast、overlap 查询及调试数据；过滤 self、分层和最近遮挡。
- 第一人称/俯视控制与同一角色移动通道：重力、grounded、跳跃、斜坡限值、台阶、移动平台支撑；参数按作品调整。
- mesh/collider transform 同步的唯一责任；销毁/隐藏/状态变化是否解除碰撞须显式，不把 `visible=false` 一律当穿透。

R1 不必证明任意高速/复杂关节场景正确。动态 concave 碰撞、高速穿透等超出已声明范围时给准确诊断与替代，不把 AABB 近似伪装成完全物理。静态导航路径不是物理可行性的证明。

## 5. 动画、timeline 与镜头（S07）

提供三条等价创作路径：原生 procedural update、Three Clip/Mixer、可选普通 TS sequence/timeline。timeline 自带少量常用工具但允许回调/自写模块，不把所有新动画都强迫改成专有 DSL。

R1 timeline 最低含 sequence/parallel/wait、tween/Clip 播放、camera cut/blend、sound cue、可取消 scope。玩法信号经机制提交接口，有幂等收据；时间轴视觉 scrub 使用隔离的预览实例，**不能发奖、写游戏存档或修改作者工程**。

每条含玩法效果的 sequence 声明：自然播放终态、skip 终态、checkpoint/resumable 恢复策略、cancel 语义。R1 只承诺声明了 skipPolicy 的过场可跳过；播放和 skip 到相同语义终态，音效是否略过另行定义。timeline 不能越过碰撞把角色塞进墙里；需要瞬时重建机关时按声明 checkpoint 状态重建 collider。

镜头提供固定、follow、路径 rig 与切换控制权；位置/朝向任意 TS 仍允许。全套 IK/重定向、复杂 root motion 不是 R1 必需。

## 6. 音频、效果与可访问性（S08–S09/S11）

- Web Audio 统一 master/music/sfx/voice bus，并允许作者增本地 bus；clip key 来自作品资产，不固定十个 SoundName。
- 支持一次性/循环、空间衰减/朝向、fade、静音与音量、scene scope；旧 SynthAudio 是可选声源，不是唯一入口。
- 用户手势解锁不可伪造。未解锁时状态可观察；一次性声音按策略丢弃/延迟，不在解锁后瞬间积累爆发。停止场景必须停 source/oscillator，解除 pending listener。
- 音频原生 AudioContext 时间与 simulation 时间做显式映射；pause/resume/seek 更新调度基准，不假定两者天然相同。
- 轻粒子/emitter、屏幕淡出/闪光/震屏和简单天气可配置、有 scope，允许直接自写 effects；可关闭/降低强度。
- UI 提供中文字幕/选项/提示/设置，支持中文长文、键盘焦点、触屏、文字大小和 reduce-motion。核心逻辑不依赖“必须听见声音/看清某种颜色”才有反馈，关键提示有可选文字替代。

离线测试可以证明调度/状态，不能证明声音听起来正确、字体实际清晰或 GPU 特效正确。

## 7. NPC、玩法和叙事（S10/S12）

NPC 可以不用框架提供的行为系统。选择使用时：有限状态机工具 + 自定义状态方法；waypoint/图 A* 路由；感知使用共享 ray/range query；controller 执行运动，禁止导航层直接穿墙。

图边可绑定门/机关的通行状态，变化时失效/重新规划；無路径或卡住返回原因。R1 不声称自动为任意导入场景生成完整 navmesh。跟随/巡逻例仅是能力示例，不是所有角色行为模板。

交互系统负责候选、距离/遮挡/焦点/输入分发；具体效果由作者代码定义。背包/目标/对白是可选模块，提供 typed events 与可序列化状态，不把 enum 做成所有玩法的总开关。

故事事实与自定义机制可关联，source span、片段边界及 sourced/adapted/invented 仍保留；生成一个背包或追逐桥段可标游戏性新增，不能伪称源文事实。离线逻辑为默认；LLM 对话/provider 不是 NPC 或引擎必需依赖。

## 8. 三种历史与身份（S13–S14）

| 历史 | 记录什么 | 写入与恢复方式 |
| --- | --- | --- |
| 作者 undo/redo | 代码外显式暴露的参数/资产引用等作者修改 | 版本化 author command；撤销是新的逆向编辑，不恢复玩家进度 |
| 玩家 checkpoint | 作品模块声明的机制/事实与恢复数据 | 游戏事务 + receipt，关联 experienceDigest/slot；schema 不兼容需明确迁移 |
| revision/build | 固定的代码、参数、资产、runtime 与配置 | 不可变修订与构建记录；新构建使旧运行实例失效，不能晚到写回 |

继承上一版身份规则：canonical `experienceDigest` 取代码/依赖/资产/参数/来源/runtime 等实质输入；排除临时路径、构建时间、报告和摘要自引用。相同内容在不同干净目录稳定；artifactDigest 检查输出字节，buildId 追踪任务。用户主动兼容迁移另走新槽，不能自动覆盖旧档。

跨场景恢复分离 persistent world/module state 与 disposable scene instance；不得因卸载 scene 顺手清空持续任务/背包。R1 用小型跨场景例验证，不要求流送大世界。

## 9. Studio 永久编辑的边界（S14）

场景树可展示所有可观察对象，运行态 inspector 默认只读。作者可通过 `exposeParameters` 一类接口（名称拟定）声明参数 schema、逻辑 author ID、影响范围及作者文件位置；代码继续是真正来源。

- gizmo 对暴露 transform 参数产生 command，提供坐标空间/单位/吸附与 before/after；程序化生成但未绑定的 mesh 只能观察或临时实验，UI 显示“未保存至作者工程”。
- 永久参数改动先校验 `baseRevision + parameterSchemaVersion + commandId`，落新修订、重建后才称保存生效；构建失败保留作者修改和上个可运行预览，标明版本不同。
- undo/redo 带冲突检查。代码手改或第三次编辑造成目标参数已变化，旧逆向命令应拒绝/要求重算，不覆盖别人的新值。
- UI 和 Agent 用同一 command handler，不各自保存两份世界。任意 TS 没有通用可靠的反向 round-trip；不能在保存时重生成整份 scene.ts 覆盖局部代码。
- editor 模式、play 模式、debug 临时变更有明确标识；运行中的 transform 拖动不能偷偷成为作者改动，也不能计入玩家完成证据。

## 10. Agent 工具面（S15）

先实现本地 CLI/JSON 和已有 HTTP 的明确端点；MCP 只是将来 adapter，不为此新增账户、服务平台或全局安装。下列是拟定的逻辑操作，M0/M5a 冻结真实命令后更新 Skill：

**真实 RuntimeSession 宿主**：M0 定义协议，M5 实现本地会话启动/连接/停止，M6 接 Studio/Agent。headless 模式实际加载同一作品的 SceneModule、controller、机制与真实 physics adapter，由宿主持有并推进唯一模拟时钟，query 返回其当前内存状态；不能读构建缓存或 fixture JSON 冒充运行实例。浏览器特定的 renderer/DOM/audio 输出边界使用显式 adapter；输出可替换，玩法/collider 不能替换。作品 import/create 不应硬依赖全局 document/WebGL 才能构造模拟部分；纯视觉 GPU 特性在 headless 声明不可测，不据此删掉创意功能。

会话可在本地受控子进程持有，连接点由现有本地服务管理；无需先做持久化分布式 session 平台。请求有步数/输出/时间上限，stop/异常使实例失效并释放资源；进程隔离和超时回收不是执行任意代码的安全沙箱。真实浏览器 bridge 消费同一 session 协议，但物理/输入测试不会因此被称为浏览器证明。

| 操作 | 最小返回/行为 | 权限与证据 |
| --- | --- | --- |
| capabilities / help | 当前版本、可用系统/操作、API 示例、限制与 evidence level | 不能因有依赖名就声称功能可用 |
| inspect.scene / inspect.object | 层级/姿态、author binding、活动 Clip/physics/nav/state 摘要 | 有界、只读，不序列化函数/整个源文/密钥 |
| inspect.physics / navigation | collider、接触、路径/无路原因、遮挡 | 来自实际 adapter，不提供假分析结果 |
| author.parameters.patch / undo / redo | 命令 id、目标 revision、前置条件、差异与新修订 | 永久写入作者产物；与玩家存档完全分离 |
| build / validate / export | precise versions、diagnostics、artifact graph | 真编译、真失败语义，不用解释页冒充游戏 |
| preview.start / stop / pause / step | session/generation、模拟 tick、运行态 | step 只适用可控模拟模式，不能推进两套主循环 |
| input.record / replay | 从公开输入进入的 trace、场景阶段/目标断言 | 标注 normal-input 或 debug-assisted，后者不作通关证据 |
| observe.frame / metrics / logs | 可用时截图引用、资源/时间指标和 source location | 无浏览器/GPU 返回 NOT_RUN/NOT_MEASURED，不编截图/FPS |

每个 session-scoped 请求带 `experienceDigest/buildId/sessionId/generation`；对象 handle 不能跨实例复用。author 命令另带 baseRevision/schemaVersion/idempotency key。返回可分页/按范围筛选，避免全场景输出淹没 Agent 上下文。

调试工具默认只在本地 author/preview 构建可用，不随 public/private 游戏 release bundle 暴露作者接口。预览独立 origin、只读资源服务；如需 parent/preview 通信，核验精确 origin/window/session，使用有限时会话控制权而非 Studio 作者 token。这里的“只读”指文件/作者 API，不禁止会话内输入/暂停。跨 origin 不等于任意代码安全沙箱。

最先演示一条工具闭环：角色卡门 → 查询 collider/姿态 → 修改作者暴露的开口参数 → 重建 → 重放同一输入路线 → 对比碰撞/目标结果。它比先写几十个未被使用的工具端点更能检验工具是否有用。

## 11. Skill 分层

仍以项目内 `skills/story-to-ps1/` 为主入口，避免先建多个互相漂移的 Skill。按需读取参考：runtime、scene-assets、physics-input、animation-camera、audio-effects、npc-gameplay、authoring-debug、sources。

工作流：理解原文/创意 → 定义空间/动作/动画目标 → capabilities → 选用必要系统或原生代码 → 编写作品及输入路径 → build/run/inspect → 定位并局部修复 → 私有产物/来源/证据交付。

**轻量视觉反馈，仅写在制作 Skill 中**：制作 Agent 有运行、截图和图像理解工具时，主动看看实际玩家会看到的画面，结合本次创作意图判断是否值得调整；动画可按需看连续帧或短片段。观察时机、视角、范围和修改取舍交给 Agent，不设固定截图数量、评分表、修复轮数或必走关卡，也不把某种审美当成统一正确答案。做了影响画面或交互的修改后，按需再看相关部分，确认改动效果。实际观察与保存截图不是一回事；没看过就不要声称已经视觉检查。

这是一条创作习惯，不新增引擎接口、构建/导出门禁或 G/B 验收项，不要求单独视觉审核报告。缺少视觉工具时简短说明未观察画面，继续可做的创作与验证；Skill 不会凭空提供浏览器或视觉模型能力。原有运行证据、来源及发布边界不因此取消。

对普通原创 brief 不强迫盐选格式；对片段改编保持来源界限。工具缺少 helper 不等于不能创作；宿主真实能力缺口才报告 CAPABILITY_GAP。构建失败不能默认删特色退回固定模板。Skill 同时包含“只用原生 Three + 内核”和“组合可选系统”的示例。

## 12. 构建和发布（S16）

真实 bundler 图决定依赖；资产闭包包含必要的 WASM/解码器，未使用系统不引入体积。作者工具、无关故事、分析文本、token 和源素材许可之外的数据不进入游戏包。提供依赖/归属 NOTICE，缺包/资产直接失败。

R1 默认本地私有静态包，发布需另行授权；旧 StoryPackage 走 legacy adapter。所有能力报告分数据/类型、模拟逻辑、HTTP/资产、浏览器视觉/声音、真人体验层级，未跑项不冒充 PASS。
