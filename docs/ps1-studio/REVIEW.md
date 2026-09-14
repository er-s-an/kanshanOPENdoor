# 规划审查记录

状态：规格审查与本地核心整合完成 · 2026-09-15。**不是浏览器／真机／外部模型／公开发布验收。**

## 独立审查与修正

按 blueprint 的独立审查阶段，由只读审查者检查运行时、内容契约、工具、Skill 和步骤依赖。第一轮发现 6 项，修订后第二轮确认闭合，并补充第 7 项；第 7 项由主执行者修正与文本复核，未再声称经过第三轮独立审查。

| 问题 | 规格修正 | 后续验收 |
| --- | --- | --- |
| end 无 option，却需要持久修改 ended | 判别事件 complete-option / confirm-end，共用 reducer／存档 | T03/T06 |
| 物品消耗可能令原对象复活 | collectedItems 永续拾取记录与 inventory 分离 | T05/T06 |
| bodyDigest 放入幂等键导致异正文无法冲突 | project+operation+key 查记录，再比较正文 digest | T10 |
| CLI 与 HTTP 来源／审阅字段不等价 | create --metadata，review --scope，缺字段明确错误 | T12/T20 |
| 相机与锚点的三维距离导致交互不可达 | 明确眼睛／脚底坐标，交互半径采用 XZ，视线另测 | T04 |
| 多标签保存与复制会话无原子隔离 | IndexedDB 事务 CAS、独立 saveSlotId、显式 memory-only 降级 | T06 |
| 同 beat 重试仍可能接收旧异步结果 | expectedGeneration fencing，提交临界区／abort 规则 | T06 |

额外对齐：作者产物最小字段和 digest 链；Schema 中 speaker 的条件规则与文字规格一致；能力目录／导出／公开批准均标明尚待实现。

Skill 前向思想实验：给定授权故事而 CLI 不存在，应交付分析／设计与 NOT_IMPLEMENTED，不能伪造 preview 或通关结果。这个检查是审阅推演，不是实际模型生成行为实验。

## 本轮机器检查结果

- Python jsonschema Draft202012Validator：Schema 自身有效；原创 StoryPackage 示例结构通过。
- 12 个结构负例全部拒绝：未知字段、版本、模板、prefab；缺 anchor；end 带 option；sourced 无 span；dialogue 缺 speaker；narration 带 speaker；flag 超限；坐标越界；choose 仅一个选项。
- 原创 source.txt 为 83 个 Unicode 码点，SHA-256 与包一致；引用范围和 ID 指向检查通过。
- 对这个线性示例做了临时脚本状态顺序检查：read-note → take-key → open-door → excerpt-end。**没有实现通用 reducer、完整穷举器、空间验证器或 player。**
- Skill 草案通过 skill-creator quick_validate；仅证明格式，不证明可安装后运行。
- 14 个新增规划／样例文件，42 个本地文档链接存在，未发现行尾空白或缺终止换行。

检查使用本机已有 Python/jsonschema 与 Node；未安装新依赖、未生成运行时代码。原创样例不是盐选作品，也不是正式 5–10 分钟游戏，专用于说明契约。

## 未运行与待实施

新 runtime、场景几何、浏览器自然游玩、原作品回归、模型生成、Skill 安装／真实前向评测、Studio、导出、真机性能与发布审阅均为 NOT_RUN / NOT_IMPLEMENTED。机器结构通过不能替代这些证据。

本轮新增／修改了 `packages/story-contract/`、`game-ps1/src/runtime/` 和 `player.html`/依赖、`studio/`、`skills/story-to-ps1/`、`scripts/verify-ps1-studio.mjs`、`.gitignore`，以及本目录规划文件。没有改旧 story 主流程、原有存档、密钥或全局配置；没有 commit/push/deploy。本轮末次状态中 `game/vite.config.js`、`game/` 下其他文件也有既有工作范围外的修改，原样保留；接手时重新检查工作树。

## 当前本地实现检查

- `npm test`（root）：1 passed。
- `npm --prefix packages/story-contract test`：10 passed。
- `npm --prefix game-ps1 run build`：TypeScript 与 Vite build 通过，生成 `dist/player.html`。
- `npm --prefix studio run build` 与 `npm --prefix studio test`：3 passed；本地 root/API token 保护和真实 Player preview asset 路由 smoke 通过。
- `npm --prefix skills/story-to-ps1 run check` 与 skill-creator quick_validate：通过。
- `node scripts/verify-ps1-studio.mjs --json`：54 PASS / 0 WARN / 0 FAIL。

以上是本机静态／单元／构建证据，不是 T07/T08/T15 的自然游玩证明，也不是模型、真机、授权或比赛提交证明。
