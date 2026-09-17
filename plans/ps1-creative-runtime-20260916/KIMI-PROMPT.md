# 交给 Kimi Agent 的实施提示词

> 若执行用户最新“常用引擎功能也补齐”的范围，请使用[新版引擎 R1 提示词](KIMI-ENGINE-PROMPT.md)。本文件保留为仅自由场景切片的较小范围，不与新版顺序重复执行。

本提示词是供用户复制的交接材料；Codex 本轮没有发送任务或实施。它取代上一版“固定模板离线作者闭环”的主提示词。

```text
你接手看山知乎黑客松项目的 PS1 创作引擎。请实际实施并完成本地工程交付，不停在重写规划。

仓库：/Users/xiejiachen/zhihu-hackathon-2026/kanshan-v2
先完整读：
1. plans/ps1-creative-runtime-20260916/README.md
2. plans/ps1-creative-runtime-20260916/ACCEPTANCE.md
3. plans/ps1-iteration-20260916/CURRENT-AUDIT.md（历史静态缺陷线索，逐项按当前代码核验）
4. plans/ps1-creative-runtime-20260916/REVIEW.md

用户最新决策：固定模板限制 Agent，自由创作比模板数量更重要。把项目改为“薄运行底座 + 一级 TS/Three.js 场景模块 + 可选 helper + 故事改编 Skill”。不能把两种房间换成更大的 prefab/action 白名单，也不能造一套要求所有几何/动画翻译成 JSON 的 DSL。

Agent 必须能直接写 Mesh/Group/自有 geometry、材质/灯光、任意墙体和开口、角色路径、AnimationMixer 或 procedural update，以及模块自有交互/机制；控制器与镜头可替换。模板与 PS1 preset 只是起点，不定义所有题材。新玩法代码在作品目录，通常不需要修改引擎核心。

只约束共同边界：实例/时钟/输入生命周期、资源归属、checkpoint 与事件提交、来源和改编标记、构建/版本/资源闭包。SDK 接口不是安全沙箱；类型检查也不证明任意 TS 可穷举通关。保留 legacy StoryPackage 解释器，但它不再是唯一执行产物。新 experience manifest 只描述入口、版本、来源/参数/资产归属，不罗列整张地图，也不内嵌 eval 代码。

执行顺序按 F0–F5：先最小接口，马上做两种不同的自由场景垂直切片，再加固动画/机制恢复，之后构建/CLI/导出，最后 Skill/Studio 最小接入和冻结后的第三作品。不要先花一整轮做固定模板编辑器或完成旧 K00–K07 才开始新方向。保留旧审阅中本轮路径相关的 digest、输入 busy、销毁/存储错误、错误报告和导出边界修复，不能把已知错误复制进新宿主。

先检查当前 HEAD/WIP/AGENTS/依赖。规划时 HEAD ff5c4f1db32fe558d0a66b1bb2103a6ae76dc894、分支 codex/initial-upload；这是本地审阅快照，不是让你 reset 的目标，也未核验远端最新。保留用户 WIP 和旧入口，使用 Node 24 和锁定 Three 0.180.0，在线文档的新 API 需对照本地版本。不要整体换引擎、切 React、追新依赖或建设第三方插件托管平台。

几项不能妥协的实现要求：
- 允许不用 helper 的普通 TS，自有局部函数/模块不需全局注册；不能把新玩法都降为六动作。
- 宿主单时钟与 scope 处理 mixer/update/异步取消；暂停保留进度，销毁隔离迟到回调；区分模块自有资源和共享缓存，不能误 dispose 别的场景材质。
- 门/桥等动画影响通路时由机制状态驱动视觉和 collider。checkpoint/resumable 声明恢复策略；动画结束不能重复提交事实，保存失败不能伪装持久化成功。
- 存档绑定稳定 canonical experienceDigest，不能绑定构建时间或随机 buildId；排除报告/临时路径/摘要自引用。同内容在两个干净目录重建身份一致并恢复旧档，代码/参数/资产改变默认隔离；artifactDigest 另作产物校验。
- 首个自由造景切片要验证门窗开口和移动障碍碰撞，不能只得到一幅静态画面。物理引擎按需使用 adapter，不为了自由摆墙先做通用物理平台。
- 新 scene 用真实 TS/bundler 入口和构建图导出依赖；缺资源失败，不能复制全部多故事 dist 或用说明页假装游戏。
- Studio 首轮只负责预览、诊断、显式参数和修订；不得把任意 TS round-trip 到 JSON 并覆盖。Skill 改成真实分析→代码生成→工具检查→局部修复→交付，不偷偷切回模板模式。

host-agent 就是你本人，不需要另接付费 provider。测试故事使用原创/合成片段；已有原文只按实际提供边界改编，不抓付费全文，不把会员身份当公开改编权。禁止为了通过测试把独特玩法删成拿钥匙、读纸条而不报告。

验收按 C01–C15，现有命令和拟新增命令见 ACCEPTANCE。每个必需项有真实断言/结果，不用字符串存在性或历史 PASS 总数证明完成。工作包完成只写自己的子项，跨包尚未实现记 PENDING_INTEGRATION，最终再跑完整链路。无需真人、手机真机、外部付费模型或公开部署；有本地浏览器可自动运行 B 组，无则 NOT_RUN，不能称已自然通关或视觉评审通过。

两个开发作品后冻结 runtime/helper/Skill/CLI，再定第三个原创 brief。第三作只改作品代码/资产/参数/测试；如必须改核心，记录泛化失败，修接口后另选新 brief。三个真实 SceneModule 都要跑 simulated-runtime：从初态经公开输入/update/实际碰撞到达目标，再从中途 checkpoint 恢复到同一目标；可注入时钟/存储/无 GPU 渲染边界，不许替换玩法或直接 setState/瞬移/发成功事件跳关。无需浏览器，但必须标注这只是离线路径证明。可选 A/B/C 比较不是前置，未跑不得声称比原生 Three 更好或评分提高。

如支持多 agent，只在接口稳定后并行作品或 Skill/web；所有 package.json、锁文件、公共接口、构建配置、汇总 runner 由你串行维护。你负责实际整合和运行，不能只收集子 agent 的完成消息。普通本地实施持续推进；不要擅自 commit/push/部署、安装全局 Skill、读取无关凭据、覆盖源稿/旧存档或执行公开发布。

最后交付：
1. 可用的薄 runtime/SDK，legacy 兼容路径，以及 3 个不同的原创作品项目和私有独立包。
2. 改好的项目内 Skill、实际 CLI 命令和 Studio 最小入口。
3. evidence/ps1-creative/v0.1/ 下 baseline、RESULTS.md、机器可读结果、精确版本/文件 hash 和逐项证据。
4. 正确 cwd 下的安装/构建/启动/验收方法，预览与导出路径。
5. LOCAL_ENGINEERING、BROWSER、CREATIVE_REVIEW、PUBLIC_RELEASE 分层状态，说明哪些未测，哪些能力仍缺失。

如果新 SDK 限制了原生 Three 能做到的创意，优先去掉抽象或开放 seam；如果它不能带来工程复用收益，缩减为 starter + 工具库 + Skill，而不是不断加模板。现在从 F0 开始，推进到本地交付完成或明确的真实阻塞。
```
