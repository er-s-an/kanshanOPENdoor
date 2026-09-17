# 灯塔最后一班 · The Keeper's Last Shift

原创第一人称室内叙事探索小品（R1 自由代码示例作品）：雨夜，一座小灯塔的
内部，守塔人值最后一班。与专程赶来的陈老师傅完成一次对话交接，找回散落的
三页日志，然后点亮灯器——让旋转的光与雾号替这段岁月收尾。

## 空间与进程

```
        B 值守室 (z -4.6..0)          桌 + 卡住的抽屉 · 床铺 ·  stove
        ──────── 门洞 ────────
        A 灯室 (z 0..6.4)             灯器(转子) · 控制台 · 西墙窗(窗外落雨) ·  边桌
```

- 两个连通的非矩形房间，单一门洞；西墙窗洞外是一个 `ParticleEmitter`
  雨幕（reduce-motion 下半量发射）。
- **对话**：与陈师傅的 `DialogueRunner` 树，三个分支点（q1/q2/q3），两条
  结局。选项效果经 `CommitChannel`（即本模块的 `ctx.commit`）以确定性
  eventId（`keeper:<node>:<index>`）提交为持久事实；E 推进、1/2 选择，
  全部由 mechanics 阶段的输入沿驱动。
- **收集**：三页日志进入 `Inventory`（容量 3）。抽屉里那页在抽屉拉开前
  不可交互——卡住的抽屉默认要拉两次：第一次只卡住（jam 音效），第二次
  才滑开（`keeper.drawer-opened` 事实）。
- **点灯链**：控制台仅在 交接完成 + 三页集齐 后成为候选；按下后提交
  `keeper.lamp-lit`，转子进入程序化旋转（每步 `dt * lamp-speed`，由
  committed 事实驱动，恢复安全），`AudioPlayer` 立即排程点火音、
  `playAt` 排程雾号，并开始可跳过的 outro `Timeline`（`cancelPolicy:
  'finish'`，声明式 endState）。outro 的 cue（`keeper:outro-done`）在自然
  完成与跳过两条路径上都恰好提交一次，最终 objective 由 tracker 经
  `ctx.commit` 恰好完成一次（`objectives:light-the-lamp:completed`）。

## 运行时的系统组合

| 系统 | 用途 |
| --- | --- |
| RuntimeSessionHost 受控步进 | 唯一时钟/相位管线；离线回放证据 |
| PhysicsWorld + Rapier | 房间碰撞、门洞门槛板、灯座/家具/NPC 碰撞体 |
| HeadlessInputDevice → ActionMapper → FirstPersonController | 公开输入路径（键 + 指针增量转向） |
| interaction/system.ts | 近距候选 + interact 按下沿分发（本作品直接用引擎原版） |
| DialogueRunner（gameplay/dialogue） | 三分支对话树；效果提交幂等 |
| Inventory（gameplay/inventory） | 三页日志，容量与快照/恢复 |
| ObjectiveTracker（gameplay/objectives） | 三段目标链；双重防重（eventId 去重 + complete 短路） |
| Timeline（animation/timeline） | outro 运镜 + cue；finish 策略跳过等价 |
| ParticleEmitter（effects/particles） | 窗外雨幕；reduce-motion 半量 |
| ScreenFade / ScreenFlash（effects/screen） | 入场揭幕、点火闪白；reduce-motion 即时/抑制 |
| AudioPlayer（RecordingBackend 离线） | 6 个运行时合成音效；回放可断言排程 |
| GameState + 检查点 | 进度/目标/背包/位姿/事实日志快照与 wholesale 恢复 |

## 检查点

`handles.saveCheckpoint()` 产出 JSON 可序列化检查点：GameState 快照、目标
进度、Inventory 快照、玩家位姿/视角（yaw + pitch）、模拟时间与事实日志
（恢复时按原 eventId 重放以重建幂等集合）。恢复由
`createKeepersLastShiftModule({ checkpoint })` 完成；schemaVersion 不匹配是
显式报错（`SCHEMA_VERSION_MISMATCH`），对话进行中存档是显式报错
（`BAD_STATE`），均不做静默合并。

## 离线回放测试

```bash
cd game-ps1
PATH=/opt/homebrew/bin:$PATH node --test test/creative/work-keepers-last-shift.test.ts
```

7 个用例：对话树三分支（输入沿驱动、效果/目标各提交一次、选项节点 E 无效）、
卡住的抽屉挡住页张直到拉开 + 三页集齐、全程公开输入回放直达点灯（跳过
outro）、自然完成 vs 输入跳过到达同一语义终局、中途检查点销毁会话→新会话
恢复→完成同一目标、窗外雨幕遵循 reduce-motion、参数校验与热更新
（雨速/灯速/抽屉拉动次数）。

## 已知取舍（示例级简化）

- NPC 陈师傅是固定站位 + 程序化 sway，不做寻路；检查点不记录其位姿。
- 对话进行中禁止存档（runner 的中间节点不入检查点）；完成后的 talkDone
  事实随 commits 重放恢复。
- 雾号用 `playAt(simTime + 1.4)` 排程；离线 RecordingBackend 时钟不前进，
  断言只取 AUDIO_SCHEDULING_ONLY 证据（排程发生，不等于可闻）。
- 检查点在 outro 进行中保存时，恢复后会从头重放 outro（cue 的 eventId
  保证完成事实仍只提交一次）。
- 抽屉滑出是阻尼动画，不写入模拟事实；恢复按 drawerOpened 直接置全开。

## 结构

```
experience.json   清单（format/formatVersion/id/entry/runtimeApiVersion/checkpointSchemaVersion）
source.json       来源声明：完全原创（kind: original, provenance: invented）
src/scene.ts      作品本体：SceneModule + 对话/背包/目标 + 接线 + 检查点 + 参数
src/three.ts      本地 three 转发（离线直跑时指向 game-ps1 的同一副本；打包宿主中为裸 'three'）
```
