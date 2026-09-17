# Creative Runtime · 本地验收与证据

2026-09-16 · 拟执行用例；本次规划没有运行这些测试，也不继承历史 54 PASS。

配套：[架构与工作包](README.md) · [Kimi 提示词](KIMI-PROMPT.md)。本表替代旧计划对“新作品只能改 JSON、六动作两模板”的验收要求。旧 correctness 缺陷仍按实际调用路径纳入回归。

## 1. 结果分层

- `PASS / FAIL`：具体断言实际执行后的结果。
- `NOT_IMPLEMENTED / NOT_RUN / INCONCLUSIVE`：能力缺失、未执行、结果不足，不能计入 PASS。
- `PENDING_INTEGRATION`：仅中间工作包使用；最终 required 项仍为此状态则未完成。
- `UNREVIEWED`：创意/故事体验未有人评审，不阻塞用户要求的本地工程交付，但不能称体验已验收。
- 最终可分别给 `LOCAL_ENGINEERING_PASS`、`BROWSER_STATUS`、`CREATIVE_REVIEW_STATUS`、`PUBLIC_RELEASE_NOT_REQUESTED`。没有浏览器证明时不能称自然通关/视觉达标。

每项至少记录：command、cwd、HEAD/WIP 标识、runtime/experience/build digest、输入 fixture、实际断言、退出码、日志路径、状态和原因。工作区未提交时记录相关文件 hash，不能只写 HEAD。

## 2. 必需本地工程断言

| ID | 条件与关键反例 | 归属 |
| --- | --- | --- |
| C01 原生造景 | 独立 TS 入口直接创建 Group/Mesh/自建 Geometry；未在核心登记墙/物件 enum，普通本地 import 可用 | F1 |
| C02 空间自由 | 不规则布局、非默认尺寸、真实门窗开口；静态墙和开口的碰撞断言符合几何，不能外包围盒封洞 | F1 |
| C03 表现自由 | 自定义材质/灯光/镜头或控制器可经公开接口替换；PS1 预设不强制所有题材同色同相机 | F1 |
| C04 动画入口 | procedural update 和 AnimationMixer 两条入口实际调用；至少一个局部自有实现不用动画模板，时钟可注入 | F1/F2 |
| C05 生命周期 | pause 冻结模拟并保留 cue，resume 连续；重复进入/退出、retry/destroy、异步加载迟到不串实例；自有资源释放且借用资源仍有效 | F2 |
| C06 扩展机制 | 命名空间事件和模块 payload/state 校验，旧六动作 enum 无需修改；坏 payload/旧实例/重复收据不得推进事实 | F2 |
| C07 动态空间 | 动门或移动障碍的视觉目标与 collider 状态同源，门前/门后通路正反例；隐藏/销毁同步，交互点随角色移动 | F1/F2 |
| C08 恢复一致 | checkpoint 场景与 resumable fixture 均测中途暂停/刷新；重建后的视觉、碰撞、叙事一致；未提交过渡按声明处理，完成回调不重复发奖 | F2 |
| C09 身份与失败 | 同内容在两个干净目录构建得到相同 experienceDigest 并恢复旧 checkpoint；同 source 不同代码/参数/资产默认隔离；存储不可用时准确报告且不假持久化，失败不覆盖原槽；迁移显式 | F2/F3 |
| C10 编译/诊断 | 真正 TS 和 bundler 编译；故意坏类型/缺资产/未知 API 失败并定位；不通过删除自由代码自动降级成 legacy | F3 |
| C11 manifest/导出 | 构建图资源闭包含纹理/GLB/bin/必要解码器，缺项失败；挂子路径逐项 HTTP 检查；关闭 Studio 不依赖作者 API；不夹带其他故事或凭据 | F3 |
| C12 预览/作者边界 | preview 独立只读 origin，不提供 token；author mutation 验证 token/origin 等既有边界；输出路径/符号链接/HTML 文本注入负例；不宣称沙箱安全 | F3 |
| C13 兼容与验证诚实 | 原包走 legacy validator；新模块不被旧模板 schema 拒绝；静态分析不覆盖的连续/动态行为明确范围；invalid/缺 bundle 不返回成功 | F3 |
| C14 Skill/Studio | 从实际能力检查到 create/import/build/validate/preview/export 的真实 CLI/wrapper；指定 build 不串版，修改暴露参数不改/丢 TS；无 provider 仍可 host-agent 模式 | F4/F5 |
| C15 泛化交付 | 两个开发作品 + 冻结后第三个原创作品；第三作仅修改作品代码/资产/参数/测试，核心/helper/Skill 不变；空间、核心操作和关键动画差异有具体说明；每个真实 SceneModule 均通过初态→目标及中途恢复→目标的离线集成回放，输出完整项目与报告 | F5 |

表中“视觉目标”断言可以在注入式测试中读取 Three 对象 transform/visibility，不冒充屏幕渲染证据。GLB 可用项目自有或合成小 fixture，不要求下载第三方资源。C12 的本地 HTTP 断言必需；真正浏览器隔离和渲染行为另见 B 组。

C15 的 `simulated-runtime` 必须加载作品实际入口，通过公开输入/controller、update、交互判定和真实碰撞逻辑到达该作品声明的目标，并在一个中途 checkpoint 恢复后再次到达目标。允许注入时钟、存储与无 GPU 的渲染边界；不得替换玩法/collider、直接 setState 或瞬移到完成态，或绕过玩家行为直接提交成功事件。记录输入序列、经过的机制阶段与目标断言。它证明该离线路径可运行，不等同于浏览器画面、自然通关或所有路径完备。

初始两个示例必须有实质不同的创作 brief，场景名称仅作提示，不固定为将来模板：

- 室内：非矩形走廊、墙窗开口、动态门；玩法由实际创意决定。
- 室外：开放地形/栈道、路径角色或环境动画；核心操作不同于室内例，至少一项几何直接手写。
- 第三个 brief 在冻结之后确定，记录提出时间及不可改核心规则，不能事先围绕前两个例子写出“未见测试”。

## 3. 可选项（不阻塞本地工程交付）

| ID | 用途 | 未执行怎么报告 |
| --- | --- | --- |
| B01 本地自动浏览器 | 三作品实际装载/首帧、输入、关键交互、暂停恢复/退出、错误日志 | NOT_RUN，不称视觉或通关验收 |
| B02 独立包浏览器 | 子路径运行、资源/网络无作者 API 依赖、两个 origin 边界 | NOT_RUN，保留 HTTP/构建图证据但不扩大结论 |
| E01 A/B/C pilot | 相同任务比较旧模板/原生 Three/新 SDK，九个产物，记录失败 | NOT_RUN，不声称 AI 增益或评分上升 |
| E02 创意/体验评审 | 不同作品是否真有表现和玩法差异，故事改编是否合适 | UNREVIEWED |

不要求真人试玩、手机真机、付费 provider、公开部署。当前可用浏览器可自动跑；环境缺失不临时购买服务或要求用户准备账号。有限工程证据是用户选定的交付范围，不是取消公开发布的独立条件。

## 4. 命令与实现责任

工作目录 `/Users/xiejiachen/zhihu-hackathon-2026/kanshan-v2`。执行者先检查 Node 24、依赖与 AGENTS；以下为当前实际存在的脚本，不代表本次已运行。不要从仓库根目录假设有统一 build。

```sh
npm --prefix packages/story-contract test
npm --prefix game-ps1 run build
npm --prefix studio run build
npm --prefix studio test
npm --prefix skills/story-to-ps1 run check
node scripts/verify-ps1-studio.mjs --json
```

F0 记录哪些旧断言因 legacy 兼容应保留，哪些模板限定已经不适用于新 format，后者新增双模式断言而不是简单删除失败测试。

以下是**拟新增接口**，由总集成实现后才可运行/声称存在；F0 确认命名后更新本文：

```sh
npm --prefix game-ps1 run test:creative
npm --prefix studio run test:experience
npm --prefix skills/story-to-ps1 run test:integration
node scripts/verify-ps1-creative.mjs --json
```

依赖缺失时使用各包现有锁文件和项目约定安装；不要升级全仓。测试使用 `mktemp -d` 的独立数据目录，不读取/覆盖用户已有作品和存档。所有 package/lockfile、共享 fixture/runner 由总集成串行修改。

总报告还要包含：旧回归、新断言、浏览器、创意评审各自状态；三个作品启动和导出路径；未验证范围；SDK/作品代码边界 diff；若删减创意才构建成功，保留删减记录并判 C15 不通过。
