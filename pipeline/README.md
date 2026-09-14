# 看山任意门 · 故事编译管线

把一篇中文短篇故事（知乎盐言风格：悬疑 / 无限流 / 情感，2000–8000 字）自动改编成
互动叙事数据文件 `game.json`，供「看山任意门」运行时使用（契约见下文）。

管线参考 zenstory-ai/novel-to-game（MIT）的「分步、产物落盘、可审查」思路实现，
**不引用任何 SillyTavern 代码**（AGPL，禁止复制）。

## 快速开始

```bash
# 全流程（mock：离线规则生成，产出结构完整但内容较简单的 game.json）
npm run all -- --story examples/door-1007.txt --mock
npm run all -- --story "examples/零点回音.txt" --mock

# 指定输出目录 / 只跑某一步（产物相互依赖，前序产物需已存在）
npm run ingest  -- --story <故事.txt>
npm run analyze -- --story <故事.txt>
npm run design  -- --story <故事.txt>
npm run compile -- --story <故事.txt>
npm run validate --story <故事.txt>        # 或 --file out/<storyId>/game.json

# 测试（契约 + 图完整性 + mock 端到端 + 确定性）
npm test
```

把真实故事放进 `pipeline/stories/*.txt` 后直接：
`npm run all -- --story stories/<文件名>.txt --mock`。
> 注：原故事文本的版权与发布授权需自行确认后再对外分发。

## mock 与真实模式

| | mock（默认） | 真实 |
|---|---|---|
| 触发 | 无 key / `--mock` / `ZHIHU_MOCK=1` | 配置了知乎直答 Access Secret |
| LLM | 无（内置规则生成器，确定性） | `zhida-thinking-1p5`（分析/设计/正文/NPC 卡）＋ `zhida-fast-1p5`（刘看山引导等简单步骤） |
| 网络 | 无 | 有；每次成功结果按 prompt hash 缓存到 `pipeline/.cache/`，同故事重跑不再消耗额度 |
| 输出 | 结构完整、文本较简单（原文照用，不改写人称/不细化） | 第一人称改写、保留金句、NPC 卡按原著打磨 |

Secret 解析优先级（**内容绝不进代码/日志**）：

1. 环境变量 `ZHIHU_ACCESS_SECRET`
2. `pipeline/.env`（已 gitignore）里的同名变量
3. 本地开发文件（默认仓库根目录 `.access_secret`，
   可用 `ZHIHU_DEV_SECRET_FILE` 改路径；显式设 `ZHIHU_ACCESS_SECRET_FILE=` 可强制离线）

端点：`POST https://developer.zhihu.com/v1/chat/completions`
请求头：`Authorization: Bearer <Secret>` + `X-Request-Timestamp: <unix 秒>`。
模型名可用 `ZHIHU_MODEL_THINKING` / `ZHIHU_MODEL_FAST` 覆盖，基址可用 `ZHIHU_BASE_URL` 覆盖。

> 试用额度极小：真实模式每一次运行约消耗 5 次调用（analyze 1 + design 1 + compile 3），
> 全部落缓存。调试验证请优先 `--mock`，需要试真实输出再开 key。

## 目录与每步产物

```
pipeline/
├── stories/                  # 你的真实故事 txt
├── examples/                 # 示例（自测用）
├── steps/                    # ingest/analyze/design/compile/validate/run-all + lib/
├── test/                     # node:test 用例
├── out/<storyId>/            # 分步产物（gitignore）
│   ├── raw.json              # 1. ingest  读 txt → 分段/标题/字数
│   ├── analysis.json         # 2. analyze 人物/地点/事件时间线/世界观规则/伏笔
│   ├── structure.json        # 3. design  分支结构蓝图
│   └── game.json             # 4. compile 最终互动数据（5. validate 校验）
└── .cache/                   # LLM prompt-hash 缓存（gitignore）
```

- `analyze` 真实模式：JSON schema 校验 + **失败重试 2 次**（把校验错误回喂给模型自纠）+ 缓存。
- `design` 真实模式：同样带 schema/图完整性校验与重试。
- `validate`：schema + 图完整性，任何问题 exit 1。

## 设计原则（写入 design 步骤的 prompt 与 mock 蓝图）

1. **抉择点要“两难”，不要“对错”**：每个选项在角色视角下都成立，代价不同
   （信任 vs 怀疑、救人 vs 自保、坦白 vs 隐瞒）；禁止“选 A 是蠢、选 B 显然正确”。
2. **结局差异由选择累积（set 变量）决定**，不能只靠最后一次选择：较早的抉择/对话
   写 `set` 修改变量（如 `trust_npc`、`approach`），越靠后的选项文案越要呼应前面攒下的线索。
   当前契约是静态分支（选项没有条件门），所以 mock 用“岔路再汇合 + 结局各有累积分支”近似；
   真正的“变量到达某值才解锁选项”需要运行时支持条件（见「已知缺口」）。
3. **NPC 可对话 ≠ 全知**：chat 场景给明确 `goal`（拿线索/建立信任/说服）；NPC 卡
   `system_prompt` 强制包含“不脱离原著人设 / 不剧透未发生剧情 / 不知道自己是 AI”。
4. **原著是底稿**：novel 场景的段落范围尽量无缝覆盖全文（结尾 1–2 段留给“原著结局”），
   编译时第一人称改写但保留关键描写与金句。

## game.json 契约（与运行时共享）

```jsonc
{
  "story": { "id": "str", "title": "str", "author": "str", "tags": ["str"] },
  "start": "sceneId",
  "scenes": [
    { "id": "str", "type": "novel|chat|choice|ending",
      "chapter": "str", "image": "", "text": "markdown",
      "npc": "npcId", "lore": ["loreId"],
      "choices": [{ "id": "str", "text": "str", "next": "sceneId", "set": {} }],
      "next": "sceneId", "goal": "str", "goto": "sceneId" }
  ],
  "npcs": [{ "id": "str", "name": "str",
    "card": { "description": "str", "personality": "str", "scenario": "str",
              "first_mes": "str", "mes_example": "str", "system_prompt": "str" } }],
  "lore": [{ "id": "str", "content": "str" }],
  "endings": [{ "id": "str", "title": "str", "tone": "str" }],
  "kanshan": { "intro": "str", "rescueLines": ["str"] }
}
```

约定（运行时 `game/src/lib/game.js` 的 `validate()` 也在检查）：

- **endings[].id == 对应 ending 场景的 scene.id**（运行时用 scene.id 查结局标题/基调）；
- ending 场景是终点（无 `next`/`goto`/`choices`）；
- `lore` 场景引用、`npc` 引用必须存在；
- 图完整性：`next`/`goto`/`choice.next` 指向存在；所有场景从 `start` 可达；每个场景都能到达某个结局（无死路/死循环）；≥3 个结局；`choice.set` 的变量名拼写一致。

规模目标：8–14 场景、2–4 NPC、3–5 结局、穿插 1–3 个 chat 场景。

## 已知缺口（真实模式待打磨）

- 运行时没有「条件选项」，变量累积目前只影响剧情措辞与结局文本，无法真正“解锁”某选项（需要给 choice 加 `if` 表达式，留给运行时）。
- mock 检测人名/地点靠启发式，复杂叙述会漏检或补合成 NPC（如“神秘人”），真实模式由 LLM 解决；第三人称故事 mock 不做人称改写。
- LLM 长输出（多场景一次性生成）有被截断的风险；已拆成“正文 / 结局+NPC 卡 / 刘看山”三次调用并带 JSON 校验重试，极端长文仍需观察。
- `author`/`tags` 依赖文本自身信息；txt 里可用 `作者：xxx` 首行注明。
