# 看山任意门

> **当前版本：完整首章重做 v2.2（2026-09-13）**。此前两段 playable 小样例退出默认入口。新版恢复三篇官方多幕故事；蓝血 27 节点、近视眼 24 节点，主线聊天／搜证／查证／行动／结算已接通。以 [PRD-v2.2](PRD-v2.2.md) 和 [本次修复验收](docs/REBUILD-ACCEPTANCE-20260913.md) 为最新事实，下面旧记录按历史阅读。


把知乎故事编排成不同玩法的章节试玩。当前已实现两种规则循环；玩法库扩展与异步互助的设计见 [PRD v2.1](PRD-v2.1.md)，实际验证与待办见 [开发记录](docs/DEVELOPMENT-20260913.md)。

## 本地运行游戏

```bash
cd game
npm install
npm run build
npm start
```

打开 <http://127.0.0.1:8790/>。`/shell.html` 是阅读入口演示。故事加载、动作和阶段结果无需模型；可选角色对话需要服务端配置 `ZHIHU_ACCESS_SECRET` 或 `ZHIHU_SECRET_FILE`。凭证不放在前端、故事 JSON 或仓库。

默认只列出明确标记为 `release.status=preview` 且声明官方活动来源的包。`KANSHAN_INCLUDE_DEV_STORIES=1` 仅供本地查看旧测试故事，不用于公开提交。已知作者缺失会直接说明，不编造署名。

## 编译玩法样例

```bash
node pipeline/lib/compile-playable.mjs --recipe pipeline/recipes/playable-blue.json --out game/stories/playable-blue.json
node pipeline/lib/compile-playable.mjs --recipe pipeline/recipes/playable-myopic.json --out game/stories/playable-myopic.json
```

这条新路径是人工策划 recipe → 公共规则验证 → game.json，当前每包一个 encounter。原有 `pipeline/steps` 的 V1 文本分析与编译路径保留兼容；不宣称已自动完成所有小说的玩法设计。

```bash
npm test --prefix pipeline
npm test --prefix game
npm run typecheck --prefix game
npm run build --prefix game
```

网关测试只使用本机假上游。可选单次真实联调先执行 `node game/scripts/probe-zhihu.mjs --dry-run` 查看固定虚构测试内容；实际执行需以服务端环境提供凭证。

根目录的官方 Hello World 脚手架另有 `npm start`（4173），它不是游戏 Demo 启动命令。OAuth、真实知乎关注匹配、多人异步帮助和公网发布尚未由本轮交付。
