# SPEC-01 · 数据驱动 PS1 运行时

状态：CONTRACT FROZEN / LOCAL CORE IMPLEMENTED。依赖 [内容契约](SPEC-02-CONTENT.md)。覆盖 R03–R05、R10、R12；浏览器、真机和长时间资源回收证据仍待验收。

## 1. 架构与目录边界

```text
授权片段 → authoring artifacts → compiler → StoryPackage v1
                                         │
                         shared validation / reducer
                                         │
                            PS1 Player + templates
                                         │
                       同一预览播放器 / 静态导出播放器

Skill ── CLI ──┐
              ├── studio application services
Studio ─ API ─┘       jobs / revisions / reviews / export
```

拟新增结构（尚不存在）：

- `packages/story-contract/`：独立 npm 包；Schema、TS 类型、语义验证、纯状态 reducer、有限状态探查。不能依赖 DOM、Three.js、文件系统、模型或服务器。
- `game-ps1/src/runtime/`：Player、StoryDirector、WorldAssembler、InteractionSystem、HUD、SaveStore；`src/runtime/templates/` 受控几何模板。
- `game-ps1/player.html`：新包入口，旧 `index.html`、`blue-blood.html`、`end-consort.html` 不删除。
- `studio/`：独立 npm 包，`src/{services,cli,server,web,authoring}/`；作者工具、工作区持久化与 UI。

不改根目录 workspace 配置。`game-ps1` 和 `studio` 显式声明 `file:../packages/story-contract` 依赖；先构建 shared 的 `dist/`，两端使用公开导出，不跨目录偷引私有源码。发布构建按 shared → player → studio 顺序。S01 固定 Node 24 LTS 工具链及锁文件；当前机器 Node 25 不是可复现依据。

## 2. 单一状态权威

`StoryState = { beatId, flags, inventory, collectedItems, knownFacts, ended }`。inventory 表示当前持有、允许消耗；collectedItems 是本次游玩曾拾取的只增集合，消费不删除它，避免物品复活。

包定义初始状态；纯函数 `reduce(state, event, package)` 返回 `{state, diagnostics}`，不读取时间、随机数或 DOM。随机故事行为不在 P0 内。允许剧情事件为 `complete-option` 和 `confirm-end`，不能从 UI 直接写旗标。

运行 envelope：`{packageDigest, saveSlotId, engineMajor, sessionId, generation, revision, state}`。saveSlotId 是持久游玩槽位；sessionId 是本次播放器实例，generation 是本实例异步任务世代，后二者不作为跨刷新存档身份。

共同事件 envelope：`{eventId, sessionId, expectedGeneration, expectedRevision, beatId, type}`；`complete-option` 额外要求 optionId，`confirm-end` 禁止 optionId。异步执行器开始时捕获 generation；输入系统先校验距离、视线、前置条件、当前 session/beat 和 modal 状态。之后完成选项 cues，最后单次原子提交 effects + next beat；collect 同一事务向 collectedItems 登记 itemId。已拾取物品不能再次 collect，不论 inventory 是否已消耗。提交时再次检查 sessionId、expectedGeneration、revision、guard 和动作前置条件；不满足则返回显式 stale/invalid，不能重复给物品。即使重试的是同一个 beat 且 revision 未变，旧 generation 结果也必须丢弃。adapter 维护有限事件去重记录，重复 eventId 返回既有结果。

P0 一个播放器仅允许一个过场／动作执行器。提交前核对 generation；持久化事务是短临界区，期间不接受重试／切换，或者先成功 abort 事务再开始新 generation。已提交的事务按完成事件处理；不得让晚到 oncomplete 回调写入已销毁实例。游戏推进不依赖任意回调被保存、Promise 被序列化，或 AI 临时生成条件。

## 3. Beat 生命周期

`enter → 展示 entry cues → 等待空间行动／选择 → 展示 option cues → 原子提交 → next`。

- entry cues 不产生持久 effects；显式确认才能结束对白，不用自动延时触发剧情。可有纯视觉动效。
- 一般动作 beat 只有一个选项；choose 有 2–4 个选项；end 没有选项。guard 为 AND 条件数组。
- cues 展示过程中隐藏其他交互；取消／重试／重载放弃尚未提交的动作，重新进入同一 beat。允许重播尚未提交的对白，但不重复提交 effects。
- 每次切换、重试、离开播放器递增 session generation 并 AbortController 取消等待、音频和输入订阅。旧异步结果不得修改新场景。
- 暂停冻结输入和动效调度；恢复保留当前对白位置；跨刷新只恢复最近的 beat 边界，不承诺逐字保存。
- end 的 entry cues 确认后发 `confirm-end`，通过同一 fencing、reducer、原子存档与重放路径，只把 `ended` 置 true，无任意下一节点。只能在 end beat 接受此事件；末页标明“当前片段到此”，不自动补写大结局。

## 4. 空间装配与可达性

世界坐标：米，Y 向上，XZ 移动；yaw 为弧度。spawn.position 是相机眼睛坐标，平地模板固定 Y=1.6 m，脚底坐标由眼睛 Y−1.6 得到；anchor.position 是地面交互站位，固定 Y=0。碰撞胶囊等价 XZ 半径 0.25 m。实际模板碰撞实现可以复用当前 AABB 经验，但共享同一参数给验证器。

首发两个固定地面模板：`room-v1`（内部 X ±5、Z ±4）、`courtyard-v1`（内部 X/Z ±6）。平地、无楼层和楼梯；每个模板发布几何、边界、出生允许区和 obstacle metadata。`templateVersion` 和 prefab catalog 均由 capabilities 固定。

P0 prefab：`table-v1`、`key-v1`、`door-v1`、`note-v1`、`person-v1`、`plant-v1`。catalog 给出包围盒、朝向、可见反馈能力、是否碰撞及许可。package 仅给位置／yaw，不可任意缩放，不含材质脚本、外部模型 URL 或自定义 mesh。

scene 声明对象与交互锚点。anchor 绑定 targetObject，位于玩家可站立位置附近；交互点不是“玩家必须站到物体中心”。选择目标需要玩家距锚点的 XZ 平面距离 ≤ radius，且玩家眼睛至目标视觉点射线无遮挡（忽略目标自身），键盘和触控使用相同判断。

验证器膨胀障碍后按 0.25 m 栅格检查出生点到锚点交互区域的连通性，再检验目标视线。这只是近似静态证据，不能替代真实碰撞下的自然步行测试。动态状态下重新投影对象并检查；P0 不允许动态封死唯一路径。精确射线／碰撞以 player 和 shared geometry metadata 同源为准。

进入不同 scene 使用目标 spawn；同场景换 beat 保留位置。刷新、重试当前 beat 用该 scene.spawn 重定位，因此每一个可存档 beat 都必须从 spawn 可到达当前目标。不要保存悬空坐标或门内坐标。

## 5. 状态 → 画面投影

世界从 StoryState 派生，不以 DOM 或 Three.js 对象可见性作为事实来源。

- 拾取物品 prefab 可声明 itemId，collectedItems 含该 ID 后永久隐藏，与 inventory 是否持有无关；每 item 在整个包内最多一个拾取对象。flag 驱动对象固定可见／隐藏状态，不支持自由 JS；门的“使用”在 P0 以反馈和 scene/beat 转移表达，不做真实物理门模拟。
- UI 任务文案来自当前 beat；背包来自 inventory；已知信息来自 knownFacts。行动至少提供 HUD 确认 + 世界／信息的一项可见变化。
- 对话 speaker 显式使用当前允许的称呼；不自动展示 authoring 内部角色真名。
- 基础 PS1 样式与 myopia、fear 完全分开。先保留可调低分辨率／抖动／色彩；不默认开启近视或恐惧效果。
- 字幕文字用 textContent 或安全 React 文本节点，不允许包内 HTML。必须可关闭闪烁、保留高可读字幕；关键操作不只靠颜色／声音。

## 6. 存档与版本

IndexedDB 数据库名 `kanshan.story.v1`，save 记录主键 `[packageDigest, saveSlotId]`。保存 `{packageDigest,saveSlotId,engineMajor,revision,state,lastCommittedEvent}`，不把旧 sessionId/generation 恢复为新实例身份；首次为包创建 default 槽位，“复制独立会话”生成新 saveSlotId 并复制最近有效 checkpoint。槽位 ID 由运行时生成，不由内容包指定。

使用 IndexedDB readwrite transaction：读当前 revision、比较 expectedRevision、写入下个 state/revision 与去重事件。仅在事务成功后正式采用新持久状态；不能用普通 localStorage 的先读后写伪装 compare-and-swap。事务冲突不推进内存状态，提示载入或复制。存储不可用／非冲突写入失败时，可明确切为独立 memory-only 模式继续，保留原存档且提示本次不能持久化；不得显示“已保存”。

加载时验证结构、digest、engineMajor、beatId、旗标／物品／事实声明范围和状态可达性。非法存档隔离并提供重新开始，不能覆盖原数据。P0 不跨内容 hash 迁移，不把《蓝血》旧章号当新 beatId。

同一包同一 saveSlot 在多标签页写入：以事务判定 revision 冲突，提示选择载入更新或复制到独立槽位；不能静默 last-write-wins。不同槽位、内容修订均隔离；广播仅用于 UI 提醒，不代替事务锁。重放测试比较完整 canonical state，而不是只比较 end 页面截图。

## 7. 生命周期、扩展与性能

WorldAssembler 拥有本次场景资源；共享材质／纹理必须引用计数或由顶层所有，销毁不能误删共享资源。dispose 移除监听器、动画帧、计时器、音频和 WebGL 资源。测试连续载入／退出 20 次，检查监听器数量和资源趋势，不能用一次 heap 截图保证无泄漏。

不把现有种菜／棋局／镜面机制偷偷塞进通用 action。S03 如果迁移片段需要这些能力：缩小片段，或记录 `CAPABILITY_GAP` 并按计划变更流程新增受审插件。P0 包内不能注册插件；开发者可信 registry 才可后续扩展，扩展必须声明输入、输出事件、保存和取消契约。

性能门槛见 [验收](ACCEPTANCE.md)。复用渲染不等于已满足移动设备性能；移动控件存在不代表真机测试完成。
