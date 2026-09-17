# 给 Kimi Agent 的提示词

> 已有新方向：本文件 A 的固定模板实施范围已被用户最新“自由编写场景/墙体/动画”要求取代。请复制[Creative Runtime 提示词](../ps1-creative-runtime-20260916/KIMI-PROMPT.md)，不要复制下方 A 直接执行。下方 B 可用于旧引擎验收，但不代表新架构验收。

本文件提供两种独立用法。推荐 A：执行 v0.2 迭代并自动验收。B 用于想先让 Kimi 只验收再决定修复的情况。它们不会由本次规划自动发送或执行。

## A. 推荐：实施与自动验收

将以下整段复制给有本地仓库访问权的 Kimi Agent：

```text
你接手看山知乎项目的 PS1 Story Studio，负责实施并交付“离线作者闭环 v0.2”。请实际改代码、运行本地自动检查、修复发现的问题并完成交付，不停在再写一份计划。

项目目录：/Users/xiejiachen/zhihu-hackathon-2026/kanshan-v2
先完整阅读：
1. plans/ps1-iteration-20260916/README.md
2. plans/ps1-iteration-20260916/CURRENT-AUDIT.md
3. plans/ps1-iteration-20260916/ACCEPTANCE.md
然后按各工作包读取对应规格和源码。2026-09-16 审阅时本地 HEAD 是 ff5c4f1db32fe558d0a66b1bb2103a6ae76dc894，分支 codex/initial-upload，工作树干净；这只是证据基线，请重新检查当前 HEAD、WIP、AGENTS.md、依赖和可用命令，不 reset 到旧版本。

目标：故事 → Kimi 宿主产出 Analysis/Blueprint → 真实 CLI 导入/构建/校验 → Studio 修改对白、动作绑定和位置 → 指定修订预览 → 独立私有静态游戏与验收报告。保留现有 Three.js/PS1 和旧故事入口，沿用共享 StoryPackage，不整套换引擎。

执行顺序：K00 基线复现，K01 契约冻结，K02 runtime 和 K03 服务可以并行。K03 接口冻结后 K04 Skill、K05 web 可并行，K06 等 K02/K03 完成后接手导出/HTTP，最后 K07 新故事与整合。若环境支持子 agent，按计划的文件所有权分工；不支持就按依赖顺序做。你始终负责整合与最终测试，不以子 agent 完成消息代替检查。

必须优先处理代码审阅的 P0：默认 Player 包缺 provenance；shared/Studio/Player 的 digest 与作者产物格式不一致；同原文不同改编串存档；busy 导致动作字幕不能按键继续；触控/选择输入未接通；射线遮挡及 prefab 碰撞/空间检查缺口；存档失败/取消/destroy；Skill import 与 CLI revision import 语法冲突；invalid/inconclusive 被包装成成功；幂等/并发/重启；导出缺 bundle 或夹带其他故事及路径/文本边界。先用最小测试复现，若当前已修好则附证据，不重复修改。

本轮采用 host-agent：你本人根据故事生成作者产物，随后调用真实工具。无需额外 provider 密钥或付费调用；未实现 provider 时 capabilities 如实关闭，不能因环境变量有名字就称可用。先修 Skill 的命令和 schema，再用它制作新包；不能复制同一钥匙故事只改对白作为所有示例。

按 ACCEPTANCE.md 完成 A00–A16 和 R01。本地构建/单元/真实临时文件系统/CLI/API/注入式 runtime 测试必须跑。无需真人实测、手机真机、外部付费模型或公开部署。已有浏览器可用时做 B 组本地自动操作；没有环境时记 NOT_RUN 并继续完成必需工作，不用等待用户。不要把静态或模拟测试写成自然通关，也不要削弱原 public 导出门槛来取得全绿。

测试用原创/合成材料；已有作品只使用本地实际提供的片段并保留边界。普通实现和修复直接推进；不默认读取无关凭据、抓付费全文、安装全局 Skill、覆盖源稿/存档、commit、push、公开发布。需要新玩法机制或外部行动时列入下一版，不阻塞当前已授权的本地交付。

工作要求：使用 Node24 和锁文件，先构建 shared 再构建消费者；遵守现有 WIP；使用精确文件修改；不要把 test 脚本存在或总 PASS 数当成功依据。K01 冻结契约后，共享接口变更由总负责人串行整合。新拟定命令必须真正实现，缺脚本算 NOT_IMPLEMENTED。

并行时所有 package.json、lockfile、共享 test helpers 与总验收 runner 由你串行维护，各 agent 只新增其命名范围内的测试。工作包只完成自己的子断言，跨包 A02/A09 等到 K07 才填整项 PASS；不要让 K01/K04 等待尚未开始的下游导出。pause 保留当前字幕，retry/destroy 才取消；事务已经提交的事实不可因暂停而撤销。

最终交付：
- 本地代码与三个结构不同的内容包，其中一个在冻结引擎后制作，核心/模板不因它改变。
- Studio 和 Player 的准确启动方法、指定修订预览地址/可重现启动命令、私有导出路径；能从干净依赖安装重建。
- evidence/ps1-studio/v0.2/baseline.md、baseline.json、RESULTS.md、results.json。
- 原缺口逐项对应“复现/未复现/已修”和证据，所有 required 项的结果与精确版本。
- 简短列出改动、验收、剩余缺项和下一步；必需项未过不能说全完成，可选项目未运行须明示。
请从检查当前仓库和 K00 开始，持续推进到上述本地交付完成。
```

## B. 仅验收，不实现

```text
请只验收看山 PS1 Story Studio，不修改产品实现。
仓库：/Users/xiejiachen/zhihu-hackathon-2026/kanshan-v2
完整阅读 plans/ps1-iteration-20260916/CURRENT-AUDIT.md 和 ACCEPTANCE.md。

先确认当前 HEAD/WIP/Node24/AGENTS.md；在隔离临时工作区运行现有 build/test 和可执行的最小复现，验证审阅发现。可以新增独立验收脚本和报告，但不能修改业务源码、用户源稿或存档，不能把报错通过修改输入限制掩盖。

先检查默认 Player 包契约、同 source 不同包 digest/存档、字幕 busy 输入、Skill→真实 CLI 子命令、invalid/inconclusive 结果、import 幂等、空间 false-pass、导出资源闭包。未实现的测试/能力写 NOT_IMPLEMENTED，无法运行写 NOT_RUN。历史 54 PASS 不继承到今天；模拟测试不等于浏览器/真人证明。

无需真人、真机、付费模型或部署。已有本地浏览器可运行可选 B 组，不可用则记录原因并继续。产出 evidence/ps1-studio/v0.2/acceptance-only.md 和 acceptance-only.json，给出已复现缺陷、代码位置、最小触发、预期/实际、优先级和修复工作包映射。不要执行修复或另建实施任务。
```

## 多 agent 分工卡（Kimi 支持时可用）

每位执行者都先读 README 的对应工作包和 ACCEPTANCE 的用例；以下不是允许彼此覆盖文件的授权。

| 角色 | 拿到的任务 | 独占范围与交接 |
| --- | --- | --- |
| 总集成 | K00/K01/K07，冻结接口、共享 digest/作者 schema/几何元数据，最终结果 | shared package 与公共 fixture/schema；其他角色需要改接口先回报 |
| Runtime | K02：输入/空间/存档/生命周期 | runtime 与 Player；消费 K01 元数据；不改 Studio/Skill |
| 服务 | K03：workspaces/jobs/CLI/HTTP/结果语义 | Studio backend；冻结后交给导出角色，停止并行改同文件 |
| Skill | K04：完整子命令、流程和前向测试 | skills/story-to-ps1；调用真实 CLI，CLI 缺项交服务/总集成 |
| Web | K05：表单/布局/诊断/草稿/修订 | studio/src/web；不复制 compiler/validator，不抢写 backend |
| 导出 | K06：Player 资源闭包、预览隔离、报告/路径 | 等 K02/K03 完成后接手 exporter/http 与 Player build 配置 |

子 agent 回报格式：目标工作包、变更文件、接口变更、测试命令/退出码、验收 ID 与证据、未完成事项、交接注意。总负责人合并后再运行集成验收。

清单/锁文件/共享测试基础设施统一归总集成；Runtime、服务、Web、导出各用独立测试文件前缀。服务与导出之间是先后交接同一 backend 范围，不能同时修改 services/http。
