# 旷野信号站 · Signal Field

原创开放旷野俯视角小品（R1 自由代码示例作品）：黄昏旷野上散布着三座天线
桅杆、一座信标塔、一名巡逻/跟随的向导 NPC 和一间小型控制地堡。玩家以
**俯视角**走到每座桅杆前反复按 E 转动天线，使它们逐一瞄准信标塔；三座
全部对准后，信标运镜触发（相机混合至塔顶、合成音扬起、可跳过），目标完成。

与工作一（钟鸣陋室）的差异：控制方案（俯视角 TopDownController + 固定相机
偏航，而非第一人称指针转向）、空间（无围合的自由多边形旷野 + 局部建筑，
而非封闭室内动线）、行为（信号阵列解谜 + 感知驱动的 NPC 巡逻/跟随，而非
门/升降平台机关链）。

## 空间与进程

```
        旷野（floorPolygon 自由地面，无围墙闭合）
  备忘录石板 ── 桅杆2 ── 木箱/岩石 ── 桅杆1
      │                                  │
    出生点 ── 巡逻路线(n2↔n5) ── 中心 ── 桅杆0
                     │                      │
               地堡小屋(带门)            信标塔(北)
```

- **天线阵列**：每座桅杆是一个 interaction 候选（`createInteractionSystem`），
  按 E 转动一个步进角；当天线头瞄准信标塔（角度容差内）时提交
  `signal.mast-aligned` 事实并计 1 点目标进度；已校准的天线禁用。
- **信标**：第三座对准后 `signal-beacon` 时间线运行（cameraBlend 到塔顶
  机位 → `signal.beacon-lit` cue → 停顿），声明 `cancelPolicy: 'finish'`，
  跳过与自然结束到达同一终态；cue 以幂等 eventId 提交恰好一次。
- **向导 NPC**：`PatrolBehavior`（n2↔n5 环路）与 `FollowBehavior`（目标为
  玩家实时位置）由 FSM 按感知结论切换；感知 = 8m 射程 + Rapier 射线 LOS
  （排除自身）。行为只输出移动意图，位移由 `KinematicCharacterCore` 经
  PhysicsWorld 执行——永远不穿墙（回放逐步断言其中心位于每个已知障碍
  AABB 之外）。
- **双场景**：R1 宿主每个会话只装载一个 SceneInstance，因此地堡是同工厂
  的第二个配置（`scene: 'bunker'`），与旷野共享一个 `SessionStateBag`：
  手记/天线/目标进度在每个事实提交时写入 bag，create 时水合；场景切换
  （地堡门交互）由 bag 中的 transition 请求 + 双侧 ScreenFade 衔接。
- **目标**：`recover-logs`（2 份手记，跨场景计点）与 `light-the-beacon`
  （3 座天线）。

## 运行时的系统组合

| 系统 | 用途 |
| --- | --- |
| RuntimeSessionHost 受控步进 | 唯一时钟/阶段管线；离线回放证据 |
| PhysicsWorld + Rapier | 旷野/地堡碰撞、角色 kinematic 控制、感知射线 |
| HeadlessInputDevice → ActionMapper → TopDownController | 公开输入路径（WASD 相对固定俯视相机） |
| NavGraph + Patrol/Follow 行为 + Fsm | NPC 巡逻/跟随意图（位移由角色控制器执行） |
| createPerception（注入 raycast） | 射程 + LOS 感知门控 |
| createInteractionSystem | 桅杆/手记/门的近距交互分发（按下沿一次） |
| Timeline | 信标 reveal（cameraBlend + cue + wait），可跳过 |
| CameraDirector + FollowRig/FixedRig | 平时俯视跟随；运镜 token 交出/还回 |
| AudioPlayer（RecordingBackend 离线） | 6 个运行时合成音（信标嗡鸣为位置音源） |
| Hud（FakeDocument/BrowserDocument） | 中文字幕 FIFO + 交互提示 + 手记面板 |
| GameState + ObjectiveTracker + SessionStateBag | 检查点快照/恢复 + 跨场景持久化 |
| ScreenFade/ScreenFlash | 场景切换淡入淡出（reduce-motion 即时化） |
| exposeParameters | 天线步进角（15..90°）/ NPC 速度（0.5..3），校验拒绝保留旧值，apply 即时生效 |

## 检查点

`handles.saveCheckpoint()`（旷野场景）产出 JSON 可序列化检查点：进度
状态（桅杆朝向 + 授奖标志 + 手记 + 信标标志）、目标进度、玩家位姿、
NPC 位姿/FSM 状态、模拟时间与事实日志（恢复时按原 eventId 重放以重建
幂等集合）。`createSignalFieldModule({ checkpoint })` 恢复；
schemaVersion 不匹配是显式报错（`SCHEMA_VERSION_MISMATCH`），不做静默合并。

## 离线回放测试

```bash
cd game-ps1
PATH=/opt/homebrew/bin:$PATH node --test test/creative/work-signal-field.test.ts
```

7 个用例：俯视角相机相对移动、全程公开输入回放（手记 + 三座桅杆 + 信标
时间线跳过，提交恰好一次）、NPC 感知门控跟随（墙挡 LOS 绝不跟随 / 开阔地
接近 / 拉开距离掉落回巡逻）、中途检查点销毁→新会话恢复→完成同一目标、
跨场景持久化（旷野→地堡→旷野，手记/目标/桅杆进度不丢、完成不重复提交）、
参数校验与热更新、reduce-motion 淡入淡出即时化。

## 已知取舍（示例级简化）

- R1 宿主不支持会话中切换场景实例：双场景以"共享 SessionStateBag 的
  两个会话"实现，切换过渡（fade + bag transition 请求）由作品自身衔接。
- 地堡为俯视"娃娃屋"做法：有墙体无屋顶，否则俯视相机被屋顶遮挡。
- 导航图为作者声明的稀疏路点（非 navmesh）：follow 的最后一段与路点间
  直线由控制器物理保证不穿墙，但 NPC 没有动态避障——玩家把 NPC 引到
  障碍旁时它会如实停住（`handles.npc.stuck`），这是 R1 行为层的声明
  限制，不是 clipping。
- 行为层按 3D 距离 steering：导航路点声明在角色胶囊中心高度（y=0.85），
  地面高度的路点会落在 arrive 半径之外。
- 'stalled'（被玩家身体等动态障碍顶住）视为普通物理，不进宿主诊断日志；
  'no-path'/'blocked' 这类导航失败才会上报。
- 桅杆步进角热更新会按"步进单位"重新推导未授奖桅杆的初始朝向，保证
  任意合法步进下谜题可解；已授奖桅杆的朝向是已提交事实，永不回退。

## 结构

```
experience.json   清单（format/formatVersion/id/entry/runtimeApiVersion/checkpointSchemaVersion）
source.json       来源声明：完全原创（kind: original, provenance: invented）
src/scene.ts      作品本体：SceneModule 工厂（旷野 + 地堡两配置）+ NPC + 信标 + 接线 + 检查点 + 参数
src/three.ts      本地 three 转发（离线直跑时指向 game-ps1 的同一副本；打包宿主中为裸 'three'）
```
