# R1 引擎验收结果 · PS1 Creative Runtime

Date: 2026-09-17 · HEAD: `ff5c4f1db32fe558d0a66b1bb2103a6ae76dc894` (branch `codex/initial-upload`; R1 work is uncommitted working-tree changes, no commit/push performed).

范围：S01–S16 R1 最低能力 + G01–G19 及必需子断言。R2/R3 未实施也未冒充。旧 C01–C15 断言经 legacy adapter / legacy 套件保留，未删换。

## 总览

| 层级 | 状态 | 证据 |
| --- | --- | --- |
| LOCAL_ENGINEERING | **PASS** | `node scripts/verify-ps1-engine.mjs --json`（results.json）；创意套件 519 tests 全绿；tsc clean |
| BROWSER_RENDER_AUDIO | **PASS（限定范围）** | B01 真实 Chromium 冒烟 ×3 导出包：boot/WebGL/帧渲染/键盘输入可见移动/手势无错误。画面质量、听感未评审 |
| CREATIVE_REVIEW | **UNREVIEWED** | 无真人创意评审 |
| PUBLIC_RELEASE | **NOT_REQUESTED** | 未发布 |

环境偏差（如实记录）：仓库 engines 要求 Node ≥24；本机默认 `node` 为 v22.0.0（不满足），所有 R1 命令均以 `/opt/homebrew/bin/node` v25.9.0 运行（PATH 前缀）。TS 测试依赖 Node ≥24 的 type-stripping。

## 命令与证据

安装（lockfile 为准，Node ≥24；本机用 /opt/homebrew/bin/node v25.9.0）：

```sh
cd /Users/xiejiachen/zhihu-hackathon-2026/kanshan-v2
npm --prefix packages/story-contract install
npm --prefix game-ps1 install
npm --prefix studio install
npm --prefix skills/story-to-ps1 install
```

基准命令（baseline/baseline-run.log 为接手前状态，全部通过但属历史）与 R1 新增：

```sh
# 验收总入口（写 results.json）
PATH=/opt/homebrew/bin:$PATH node scripts/verify-ps1-engine.mjs --json

# 引擎核心+系统+作品+工具（519 tests）
cd game-ps1 && PATH=/opt/homebrew/bin:$PATH node --test test/creative/*.test.ts

# 旧路径保留
npm --prefix packages/story-contract test   # 10 pass
npm --prefix studio test                    # 3 pass
node scripts/verify-ps1-studio.mjs --json   # PASS

# Skill
cd skills/story-to-ps1 && npm run check && npm run test:integration   # 7 + 8

# B 组（需本地 Chromium，playwright-core 已锁定）
cd game-ps1 && node scripts/b01-browser-smoke.mjs --export <导出处>
```

## 架构决策

见 `architecture-decisions.md`：Rapier 0.20.0 锁定核验（Apache-2.0、11MB、WASM 内联离线可打包、headless 实测）、单时钟固定步相位顺序、transform 权威表、三种历史/三种 digest、RuntimeSessionHost 协议、异常隔离、Node/TS 测试策略、无全局 Entity 注册。

## 三个真实作品（全部公开输入回放 + 中途 checkpoint 恢复）

| 作品 | 路径 | 核心操作 | 覆盖系统 | 回放测试 |
| --- | --- | --- | --- | --- |
| 钟鸣陋室 clockwork-flat | `game-ps1/experiences/clockwork-flat/` | 第一人称机关探索 | 墙开口/滑门/移动平台/timeline intro/空间音频/HUD/参数绑定 | `work-clockwork-flat.test.ts`（含 checkpoint 恢复 + 门阻断负例） |
| 旷野信号站 signal-field | `game-ps1/experiences/signal-field/` | 俯视信号对齐 + NPC | A*/巡逻/跟随/感知 LOS/跨场景状态/触发器 | `work-signal-field.test.ts`（NPC 不穿墙逐帧断言） |
| 灯塔最后一班 keepers-last-shift | `game-ps1/experiences/keepers-last-shift/` | 对白/背包/目标 | 对白树/背包/目标链/粒子雨/程序化灯旋转 | `work-keepers-last-shift.test.ts`（skip≡自然终态） |

第三个作品在冻结（FREEZE.md，哈希清单 freeze-hashes.txt）后按新 brief 完成，**未改 core/systems/Skill/tools 任何一行**（泛化验证通过，无 CAPABILITY_GAP）。

导出（私有静态包，含可玩 boot 宿主、NOTICE、report.json、闭包校验）：
`evidence/ps1-engine/r1/exports/{clockwork-flat,signal-field,keepers-last-shift}/`

## 工具闭环（G15/G18 演示）

`test/creative/tools-loop.test.ts`，全链路只走真实 engine-cli：
窄门 fixture（开口 0.4m < 角色直径 0.5m）→ 录制输入 trace 回放失败（被门挡住，无完成事件）→ `query physics` 看到 gate-panel 与 player collider → `author patch gate.opening-width=1.0`（幂等、版本化）→ 新会话重建 → `input replay` 同一 trace → 通过且 `gate.passed` 提交。合成失败例，非用户工程缺陷声明。

## 工具使用（Agent / Studio 同一协议）

```sh
CLI="node game-ps1/tools/engine-cli.mjs"   # 或 skills/story-to-ps1 wrapper（同命令面）

$CLI capabilities
$CLI session start --experience game-ps1/experiences/clockwork-flat
$CLI input inject --session <id> --events '[{"type":"keyDown","code":"KeyW"}]'
$CLI session step --session <id> --steps 120
$CLI query scene --session <id> --limit 100      # 还有 object/commits/physics
$CLI observe metrics --session <id>              # tick/丢弃时间/提交数；GPU/FPS = NOT_MEASURED
$CLI trace start --session <id> --out t.json ; $CLI trace stop --session <id>
$CLI input replay --session <id> --trace t.json  # 只接受 normal-input trace
$CLI author parameters list --experience <dir>
$CLI author patch --experience <dir> --set gate.opening-width=1.0 --base-revision <id> --command-id <uuid>
$CLI author undo|redo --experience <dir> --command-id <uuid>
$CLI build --experience <dir> ; $CLI export --experience <dir> --out <dir>
$CLI session stop --session <id>
```

人类 Studio UI：会话启动后由 daemon 同源服务 `http://127.0.0.1:<port>/studio`（token 注入页面，不经 URL/localStorage；作者写操作需 token；未绑定对象只读）。场景树/只读 inspector/参数编辑/吸附步长变换编辑/undo-redo/会话控制条，全部走同一 command 协议。

## 审计响应（2026-09-17，针对 de8c066 的外部审计）

独立审计复现了导出链两处 P0（F01 未定义 outDir、F02 摘要参数类型不符）——已在固定提交上亲自复现（真实 CLI export exit 5），并全部修复 + 加固：artifactDigest 升级为防篡改规范清单（F03）；browser-player 消费导出身份与作者覆盖并与 headless 机制等价（F04，browser-config.test.ts）；生命周期句柄 + 真实表现时钟（F05）；CI 覆盖实际分支与 test:creative/skill 集成（F06）；能力报告拆分 源码存在/静态测试发现/运行记录 三级（F07）；新增 `check --experience` 真实类型检查（F08）。细节见 architecture-decisions.md AD-09。

重要修正：先前报告的一次「519/519 + 导出全绿」汇总结果与固定提交上的确定性失败矛盾，说明那次绿灯不可从该提交复现。当前所有结论以修复后的新提交 + 新汇总 run（含独立 browser 层级）为准；导出类断言已升级为「先真实失败、修复后真实通过」的形态。

## 已知限制（诚实清单）

- 传感器不参与角色控制器的障碍计算（Rapier 0.20 KinematicCharacterController 不过滤 sensor），目标区域用接近检测实现——已在作品 README 记录。
- NPC 导航是声明式 waypoint 图 + A*，非自动 navmesh；无动态避障，卡住时如实报 `no-path`/`blocked`/`stalled` 而非穿墙。
- 跨场景 = 两个会话 + SessionStateBag（R1 无会话内实例热切换）。
- 音频空间衰减为增益模型（非 PannerNode）；B02 听感未验证。
- 旧 studio（studio/）保持 legacy 路径；新工具链在 game-ps1/tools/，两者未合并 UI。旧 audit 的 digest 不一致等缺陷属旧路径，未在新路径复刻（identity 统一 canonical）。
- 浏览器 UI 的实际点击/拖拽未自动化（tools-web 为 HTTP 层证据）；gizmo 为数值+吸附编辑器，2D 视口拖拽属 R2。
- 物理非跨平台确定性；回放证据限于固定步模拟。

## 状态词汇

PASS / FAIL / NOT_IMPLEMENTED / NOT_RUN / INCONCLUSIVE 按实际命令与断言；capabilities.json 含每个 S 最低 feature → G 子项 → 证据映射；无 subagent 汇报直接计为证据——所有结论均由汇总 runner 与本地复跑验证。
