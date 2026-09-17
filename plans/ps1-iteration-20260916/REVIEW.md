# 本轮规划审查记录

日期：2026-09-16。使用 blueprint 的工作包/依赖/独立审查结构，为 Kimi 执行提供可冷启动上下文。用户要求本次只负责规划，所以只新增本目录 Markdown；未修改产品实现、运行产品测试或发送任务给 Kimi。

## 只读审查范围

主执行者检查 Studio/CLI/HTTP/Skill、现有规格、测试覆盖与本地 Git 基线；独立审查者检查 shared/runtime，并对四份初稿做一次对抗性规划审查。没有把代码推理当作浏览器复现，没有继承历史测试为今天的新结果。

当前审阅表记录 12 组缺口；独立审查补充 cue spans 漏检、触控状态未接、IDB 写失败与损坏读取路径。执行者须在 K00 做最小复现，再根据当前版本决定修复。

## 草案发现与修订

| 问题 | 修订 |
| --- | --- |
| A10 把可选 browser unavailable 和必需层失败一律用来拒绝导出，与 offline/private 目标冲突 | 明确 required 结构/语义/状态/空间与资源完整性阻断 private；optional browser NOT_RUN 不阻断 offline/private，public 仍保留原门槛 |
| K01/K04 的退出要求依赖尚未开始的 Player/export 全链，可能形成等待死锁 | 增加 WP_DONE 与 PENDING_INTEGRATION；各包只完成子断言，K07 才汇总跨包 ID |
| 并行任务没分配 package.json/lockfile/公共测试文件所有权 | 交总集成串行修改，测试按角色分前缀；spatial.ts 明确委托 K02，接口由 K01 审查 |
| pause 与 retry/destroy 混成取消，违背保留对白位置的原规格 | pause/resume 保留 cue；retry/destroy 才取消旧 generation；进行中的短事务在 checkpoint 边界完成后暂停 |

以上修订由主执行者完成并核对相关段落；没有声称又进行了一轮独立审查。原规格历史文档保留，执行阶段再更新其当前能力状态表。

## 文档交付检查

本轮仅检查新规划的文件存在、Markdown 本地链接、代码围栏、终止换行、尾随空白及工作树变更范围。它们是规划文件质量检查，不属于 A/B/E 产品验收。所有拟新增测试命令已标明尚待 Kimi 实现。

没有修改 memory、全局 Skill、账户、仓库 remote、用户素材或原存档；没有 commit/push/发布。规划中的 GitHub URL 只是本地 remote 配置，未核验线上最新状态。
