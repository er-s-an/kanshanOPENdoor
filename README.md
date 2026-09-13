# 看山任意门

> 把知乎盐选故事编译成「搜证-对峙-指认」的单人剧本杀——整个游戏界面就是一个「真的知乎」，高潮 Boss 战发生在知乎评论区。知乎黑客松 2026 校园新锐季 · 跨次元游乐场赛道。

## 快速入口

- **线上 Demo**：https://kanshan.makebook.hk2048.online（备用 https://kanshan.hk2048.online）
- **本地运行**：`cd game && npm install && npm run build && bash start-demo.sh`（网关+隧道，8791）
- **玩法权威**：[GDD.md](GDD.md) v1.1（含 ARG 质感层）
- **当前状态**：[STATUS.md](STATUS.md)（部署/素材/LLM/待办的最新事实）

## 文档地图

| 文档 | 作用 | 状态 |
|---|---|---|
| [GDD.md](GDD.md) | 玩法总体设计（唯一权威） | **当前** |
| [STATUS.md](STATUS.md) | 开发状态看板 | **当前** |
| [ART-ASSETS.md](ART-ASSETS.md) | 素材提示词包（GPT Image 用） | **当前** |
| [TEAM-BRIEF.md](TEAM-BRIEF.md) | 给队友的项目说明 | **当前** |
| [PRD-v2.2.md](PRD-v2.2.md) | 完整首章产品需求（诚实框架、章节设计原则） | 当前（GDD 前身的最新版） |
| [docs/ARG-DESIGN.md](docs/ARG-DESIGN.md) | 知乎原生 ARG 综合设计（评论流玩法+能力地图） | **当前** |
| [docs/UX-REVIEW-20260913.md](docs/UX-REVIEW-20260913.md) | 信息层级三问原则 | 参考 |
| [docs/MYOPIC-CHAPTER-DESIGN.md](docs/MYOPIC-CHAPTER-DESIGN.md) | 近视眼首章设计 | 参考 |
| [docs/ZHIHU-SOCIAL-API-NOTES.md](docs/ZHIHU-SOCIAL-API-NOTES.md) | 知乎社交 API 事实边界（OAuth 用） | 参考 |
| [docs/SOCIAL-RESEARCH-NOTES.md](docs/SOCIAL-RESEARCH-NOTES.md) | 异步互助设计（roadmap） | 参考 |
| [docs/research/](docs/research/) | ARG 经典 + 伪界面悬疑两路研究报告 | 参考 |
| [docs/archive/](docs/archive/) | 过期 PRD、调研、阶段验收（含吸收批注） | 归档 |

## 架构速览

```
pipeline/   故事→game.json 编译器（analyze→design→compile→validate，开发期 kimi）
game/
  src/      React+TS 前端（门厅/阅读/对话/调查/行动/Boss/结局 + ARG post 场景施工中）
  server/   网关（知乎直答或 kimi 可切；改写式提示词+出戏检测+磁盘缓存）
  stories/  编译产物（蓝血 31 幕旗舰切片 / 西游 / 近视眼）
  public/art/ GPT Image 场景图 + 刘看山官方素材 + 物证底板
```

关键设计：主线判定全确定性（线索变量+结构化呈证），LLM 只做表达层（改写式提示词，事实零编造）；序章合规——3000 字截断故事不编造真相、结局引流原文。
