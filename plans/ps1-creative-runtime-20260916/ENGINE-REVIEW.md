# R1 独立规划审查

2026-09-16 · 仅对规划做只读审查；不代表产品实现或验收已通过。

按 blueprint 技能的独立审查要求，`plan_runtime_review` 阅读 ENGINE-ROADMAP、ENGINE-SYSTEMS、ENGINE-ACCEPTANCE 和 KIMI-ENGINE-PROMPT，审查范围、依赖、创作自由与验收覆盖。

## 初审边界

采纳四项跨系统约束：

1. 系统按需绑定，不强制全场景 Entity/组件模型，不同时为可插拔做多个后端。
2. 唯一模拟时钟之外，还要明确 controller/physics/animation/navigation 的 transform 写入权。
3. 作者 undo、玩家 checkpoint、作品 revision/build 三种历史完全分开；没有 author binding 的运行对象不能自动写回 TS。
4. Agent 与 Studio 共用可观察/编辑/构建协议；debug setState/teleport 不得混入玩家输入验收。

## 完整草案审查与修订

审查未发现重新变为固定模板的阻断设计，认为 M0–M7 总体闭环；指出两项明显遗漏，主代理已修订：

- **实际运行会话归属缺失**：无浏览器时仍要求 inspect/step/replay，不能只提供静态 HTTP 预览。现由 M0 冻结 RuntimeSession 协议，M5 实现本地真实 SceneModule/controller/physics 宿主，M6 接工具；G15.a 验证 step 改变实际状态、pause/stop 与实例失效，浏览器 bridge 另列证据。
- **验收仅覆盖类别、未覆盖全部叶子功能**：新增 G02.a、G06.a、G07.a、G11.a、G15.a/b、G17.a 与来源边界 G12.a；补异常隔离、空间查询过滤、编排混合、CAS/坏存档、真实日志计数、幂等/跨进程冲突。capabilities 必须列 S→最低 feature→G 子项→证据，不能仅凭 19 个组名 PASS 宣布 16 类系统完整。

此次没有启动游戏、运行 npm 测试、安装依赖或调用模型生成作品。文档检查只核对链接、结构与写入范围；实现正确性由 Kimi 按验收合同执行后报告。
