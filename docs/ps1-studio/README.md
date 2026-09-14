# 故事 → PS1 小游戏：规划与规格

版本：0.2 · 2026-09-15 · **LOCAL CORE IMPLEMENTED / 外部验证待完成**

## 决策摘要

在当前 Three.js PS1 游戏之上，建设“受约束的叙事运行时 + 故事编译工具链 + Skill + 轻量 Studio”。产品价值是把获授权的故事片段变成可以走动、观察、操作和选择的短游戏，而非仅把文字换进对话框。

第一版的核心证明：**冻结同一版运行时和场景模板，先迁移一段现有故事，再接入一篇此前未用于开发的新故事；新故事不修改引擎或模板代码，能自然游玩到片段边界。**

本轮已经落地共享契约包、数据驱动 PS1 Player、Studio/CLI/本地 HTTP、项目内 Skill 和整合检查脚本，并保留设计文档、JSON Schema 与原创示例。没有调用付费模型、提交比赛或部署；浏览器自然通关、真机性能、授权与公开发布仍是独立门槛。Schema 或静态检查通过不等于这些门槛已完成。

## 从哪里读

| 文件 | 回答的问题 |
| --- | --- |
| [PRD.md](PRD.md) | 为谁做、第一版做到哪里、如何证明价值 |
| [BASELINE.md](BASELINE.md) | 现有代码有什么、距离完成缺什么 |
| [SPEC-01-RUNTIME.md](SPEC-01-RUNTIME.md) | 渲染、空间、剧情状态、存档如何拆分 |
| [SPEC-02-CONTENT.md](SPEC-02-CONTENT.md) | 故事如何表达为安全、确定的内容包 |
| [SPEC-03-TOOLS-STUDIO.md](SPEC-03-TOOLS-STUDIO.md) | CLI、任务 API、Studio 的共同接口 |
| [SPEC-04-SKILL.md](SPEC-04-SKILL.md) | AI 工作流、输出、修复和停止条件 |
| [ACCEPTANCE.md](ACCEPTANCE.md) | 功能、来源忠实度、复用性与 AI 价值验收 |
| [开发计划](../../plans/ps1-studio.md) | 9 个可独立接手的开发步骤、依赖与退出条件 |
| [内容包 Schema](schema/story-package.schema.json) / [示例](examples/story-package.json) | 数据契约草案；不是现有游戏支持的格式 |
| [项目内 Skill](../../skills/story-to-ps1/SKILL.md) | 可检查、导入、构建、校验与预览的项目内 Skill |
| [Skill 草案](skill-draft/story-to-ps1/SKILL.md) | 设计阶段入口稿，保留用于对照 |
| [REVIEW.md](REVIEW.md) | 本轮规格审查、已验证和未运行项目 |

## 实施顺序

`内容契约 → 运行时与场景模板 → 迁移样本 → 编译/校验工具 → Skill 与 Studio → 留出新故事验收 → 导出`

Skill 和 Studio 都调用同一套工具，不各自维护生成器。P0 使用列表／表单编辑剧情，不引入节点编辑器；Ink 导入、自由场景编辑、复杂谜题、云端协作均后置。

## 工作边界

- 当前工作树有大量既有改动，`game-ps1/` 整体未跟踪；新增 runtime 文件与本目录代码是本轮实现，旧 story 文件和其他 WIP 仍不自动归入本轮成果。
- 旧游戏保留原入口；新运行时走新入口，按片段逐步迁移，不整体重写。
- “盐选会员”不是本规格中的改编授权凭据。输入范围是用户有权用于本用途的故事／片段；不自动抓付费全文。
- 比赛规则、提交截止时间、更新作品是否计分需实施／提交前重新核实。文档不保证这项新增工作仍能计入本届评审，也不保证增加评分。
- Skill 只落在项目内 `skills/story-to-ps1/`，未注册到全局，不改官方知乎 Skill；没有把根目录转换为 monorepo。
