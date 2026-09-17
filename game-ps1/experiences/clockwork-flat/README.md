# 钟鸣陋室 · Clockwork Flat

原创室内机制探索小品（R1 自由代码示例作品）：一套不规则户型的老公寓，
玩家以第一人称从门厅走到阁楼，让停摆的铜钟重新走起来。

## 空间与进程

```
A 门厅 (y=0)  ──滑门+机关──▶  B 中厅 (y=0)  ──升降平台──▶  C 阁楼 (y=2.4)  🔔
```

- 三个连通空间都是非矩形多边形（`floorPolygon` + 逐边墙体）。
- **第一道门**：`SlidingDoor` 门板封死 A→B 的门洞，玩家需走到门侧机关座
  前按 E（interaction 按下沿分发），门板升起后通行。
- **第二道门**：`MovingPlatform` 升降平台是登上阁楼的唯一方式（竖井有侧墙
  与楣梁围合，平台到位时甲板与楼面平齐）。
- **目标**：走到铜钟旁（近距判定）→ `ObjectiveTracker.progress` →
  `objectives.completed` 以幂等 eventId 提交。

## 运行时的系统组合

| 系统 | 用途 |
| --- | --- |
| RuntimeSessionHost 受控步进 | 唯一时钟/阶段管线；离线回放证据 |
| PhysicsWorld + Rapier | 全部碰撞、机关 kinematic 目标、平台搭载 (carry) |
| HeadlessInputDevice → ActionMapper → FirstPersonController | 公开输入路径（键 + 指针增量转向） |
| Timeline | 开场运镜（camera cut + cue），可跳过，声明 `cancelPolicy: 'finish'` |
| CameraDirector + 自写 HeadRig | 运镜 token 交出/还回；平时相机绑定玩家头部 |
| AudioPlayer（可注入 backend） | 3 个运行时合成音效；离线用 `RecordingBackend` 断言调度 |
| Hud（FakeDocument/BrowserDocument） | 中文字幕 FIFO 队列 + 交互提示 |
| GameState + ObjectiveTracker | 检查点快照/恢复 + 幂等目标提交 |
| exposeParameters | 门宽 / 门速 / 平台速度，校验失败拒绝并保留旧值，apply 即时重建机关 |

## 检查点

`handles.saveCheckpoint()` 产出 JSON 可序列化检查点：GameState 快照、
目标进度、玩家位姿/视角、模拟时间（换算平台相位）以及本会话事实日志
（`onCommit` 记录，恢复时按原 eventId 重放以重建幂等集合）。恢复由
`createClockworkFlatModule({ checkpoint })` 完成；schemaVersion 不匹配是
显式报错（`SCHEMA_VERSION_MISMATCH`），不做静默合并。

## 离线回放测试

```bash
cd game-ps1
PATH=/opt/homebrew/bin:$PATH node --test test/creative/work-clockwork-flat.test.ts
```

5 个用例：开场运镜与跳过策略、闭门物理阻挡→交互开门→通行（+HUD/音频）、
全程公开输入回放直达成目标、中途检查点销毁会话→新会话恢复→完成同一目标、
参数校验与热更新。

## 已知取舍（示例级简化）

- 门宽参数只重建门板，不重建门洞墙体（墙洞宽保持 1.4 m）。
- 检查点保存时门若正在运动中，恢复后门按 `doorOpened` 直接置全开。
- 玩家在平台升顶时走入空井无惩罚（井底即中厅地面，平台下降会“接住”玩家）。
- 物理 sensor 会阻挡 kinematic 角色控制器（其 shapecast 无 sensor 过滤），
  因此目标触发用普通近距代码而非 sensor 体积。

## 结构

```
experience.json   清单（format/formatVersion/id/entry/runtimeApiVersion/checkpointSchemaVersion）
source.json       来源声明：完全原创（kind: original, provenance: invented）
src/scene.ts      作品本体：SceneModule + 机关 + 接线 + 检查点 + 参数
src/three.ts      本地 three 转发（离线直跑时指向 game-ps1 的同一副本；打包宿主中为裸 'three'）
```
