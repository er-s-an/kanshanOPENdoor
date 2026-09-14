# 当前实现基线

> 说明：本文件记录的是 2026-09-15 开发前的接手基线，用来区分旧 WIP、HEAD 与新增实现；“本轮未做”段落描述的是基线快照，不覆盖后续实现。当前本地构建与检查结果以 [REVIEW.md](REVIEW.md) 为准。

检查日期：2026-09-15。这是代码静态检查，不是本轮启动／通关证明。

仓库：当前仓库根目录。
HEAD：`cc6db15`，2026-09-14，`feat: vary Liu Kanshan proactive cues`。
`git remote -v` 本轮无输出；不假定 GitHub PR／默认远端分支。`game-ps1/` 整体未跟踪，**HEAD 不能代表这些 PS1 文件**。开发接手必须重新检查 WIP 和源码。

## 可复用与缺口

| 层 | 观察到的代码 | 判断 |
| --- | --- | --- |
| PS1 呈现 | `game-ps1/src/engine/renderer.ts`；两故事直接导入 `PS1Pipeline` | 可作为视觉底座，仍需拆出近视特效和生命周期约束 |
| 输入与空间 | `src/engine/input.ts`、`src/world/kit.ts`、`src/world/apartment.ts` | 有基础设施，不等于模板化场景装配器 |
| 运行时接口 | `src/engine/contract.ts:21,103` 的 WorldData / GameAPI | 引擎类型与 fear、回调式交互耦合，不能直接作为可序列化包契约 |
| 《蓝血》 | `src/stories/blue-blood/main.ts:7,8,110,154` | 有片段截止、章存档、8 章专用流程，场景与任务在 TS 中编排 |
| 《末等妃嫔》 | `src/stories/end-consort/main.ts:47,50,105` | 复用 PS1 渲染，但有独立世界和 20 阶段状态机；不能视为统一运行时第二个包 |
| 旧文字编译管线 | `pipeline/steps/lib/runner.mjs`，`pipeline/lib/compile-chapter.mjs:338,391,398` | 有分析、设计、编译、图校验经验；旧 chapter 输出不是 PS1 内容包 |
| 模型模式 | `pipeline/steps/lib/runner.mjs:64–68` | 缺凭据会自动 mock；新工具必须显式区分 provider / host-agent / mock |
| Studio | 未发现统一内容包编辑、修订管理、任务 API | 需要新建；不是把几个旧页面接起来即可完成 |
| 自动化 | 现有故事有各自 QA 脚本／历史证据 | 不等于新 runtime/Skill/Studio 已通过验收，本轮未重跑 |

本表 `src/` 均相对 `game-ps1/`。这些引用便于接手，不是稳定 API；后续以文件哈希和新测试为准。

## 继承什么，不继承什么

继承 PS1 渲染手法、几何／材质工具、故事设计、已验证的交互经验和来源审阅经验。用 adapter 渐进迁移，不直接把某个故事的 Game 类改名为通用引擎。

不继承：原文未授权即可发布的假设、缺凭据即 mock 的成功语义、storyId 硬编码路由、序列化函数回调、以一次截图代替自然通关、将整段小说视为已提供全文。

已有存档不承诺自动迁移。新命名空间与旧 key 并存；可以提示从头开始，不覆盖旧记录。

## 开源决策

| 组件 | 决策 | 理由与边界 |
| --- | --- | --- |
| Three.js | 保留已有依赖，先锁定本地可复现版本 | 不为了“做引擎”切换整套渲染技术；新加 scene lifecycle 与内容解释器 |
| Ink / inkjs | P2 可选导入适配器，不进入 P0 运行时 | inkjs 能执行／编译 Ink，但不会替我们生成 3D 布局；P0 避免两个剧情状态权威。[官方仓库](https://github.com/y-lohse/inkjs) |
| React Flow | P1 节点图候选 | 适合定制剧情节点交互；P0 用列表／表单先完成闭环。[官方文档](https://reactflow.dev/learn/customization/custom-nodes) |
| JSON Schema | P0 采用 Draft 2020-12，另加语义／空间验证 | Schema 只验证结构，不证明剧情可达、来源正确或游戏好玩。[规范](https://json-schema.org/draft/2020-12) |

不用一个新的完整开源游戏编辑器替换现有工程。将来接入 Ink 时只接受明确子集，转换为本项目包；不在运行时同时执行 Ink 与自己的状态机。第三方依赖与素材在引入时核验版本、许可、NOTICE；本文件不声称已完成整个依赖许可审计。

## 规则与来源的不确定性

本地 `docs/archive/HACKATHON-READINESS-20260913.md` 和 `pipeline/stories/SOURCES.md` 是历史上下文，不是本轮核验过的最新官方规则。不要用其中评分、额度或截止时间作为当前保证。新作品公开使用前核实实际用途授权；模型 provider 接入前核实当前接口与配额。

## 基线快照时未做

基线快照时没有运行现有游戏构建、浏览器通关、真机测试或外部模型生成；没有提交／推送／部署。该快照中的计划命令当时均为待实现验收命令；实现后的本地证据与仍未运行的门槛见 [REVIEW.md](REVIEW.md)。

## 关键文件指纹

以下 SHA-256 是本轮读取的具体源码指纹，便于区分未跟踪 WIP 与 HEAD；不是全仓快照，也不包含密钥或来源正文。

| 文件 | SHA-256 |
| --- | --- |
| `game-ps1/package.json` | `341a99f4afe931bb6d6aa894c6588f4a2af8720d5e79189b56f26f6c1ca299d2` |
| `game-ps1/src/engine/contract.ts` | `d709c3388fd22c467f8d2ae15bb2220b8a050d5309482e18b24d131857b4ce41` |
| `game-ps1/src/engine/renderer.ts` | `11fce01bb9ccf08153b4927835e596fcc024c5fbf78f911ee7a53cc8127268fe` |
| `game-ps1/src/stories/blue-blood/main.ts` | `97d452c0daf55db70c389529f3d8dbb2da8723a87723bbf452739ec3ca3f2af4` |
| `game-ps1/src/stories/end-consort/main.ts` | `ca396a9f1d9e7916fd3340e519ee6d42b668f809a71a7aa12c95ef4ab58a7d8b` |
| `pipeline/steps/lib/runner.mjs` | `086e4bf281515e936b656b1c9aa4eb9b20aecf8e6efc20bdabaed05d213c6c72` |
