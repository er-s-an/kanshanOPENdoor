# 看山任意门 · 游戏运行时（kanshan-portal/game）

知乎黑客松 2026「看山任意门」的**游戏运行时前端**：以第一人称穿越进知乎盐言故事的互动叙事网页应用。
移动端优先、开箱即玩、多结局；NPC 由**知乎直答 API** 扮演，附刘看山救场与全链路优雅降级。

> 默认对接知乎直答（`developer.zhihu.com/v1/chat/completions`）；只有在服务端显式设置
> `ZHIDA_BASE_URL` 时才使用兼容端点，凭证始终只留在服务端。
> 实现过程中未参考/复制 SillyTavern 代码，仅按其公开文档所述概念设计。

```
game/
├── index.html / vite.config.js / tsconfig.json / package.json
├── server/                Chat 网关（零依赖 Node：原生 http + fetch）
│   ├── gateway.mjs        转发直答 / SSE / 缓存 / 降级 / 故事加载 / 托管 dist
│   └── mock-upstream.mjs  本地假上游（无密钥联调用）
├── stories/               game.json 故事文件（含 1 个完整示例）
└── src/                   React 19 + TS
    ├── components/        Boot / Doors / StoryView / ChatView / EndingView /
    │                      Poster / SettingsSheet / Art / TypedProse …
    ├── state/             engine.tsx（场景/变量/存档/导航）、prefs.tsx
    └── lib/               api(SSE) / md / sound / report / store / config …
```

## 运行

```bash
cd game
npm install

npm run dev          # 网关(8790) + Vite(5173)，打开 http://localhost:5173
npm run build        # 产物到 dist/
npm run build:experiences # 同时打包门厅与近视眼 PS1 3D 体验（/myopia-3d/）
npm start            # 生产：单进程托管 API + dist 静态页 → http://127.0.0.1:8790
```

移动端真机联调：`npm run dev` 后手机访问 `http://<电脑局域网IP>:5173`（Vite 已 `host: true`）。

### 3D 门的开发态入口

先生成近视眼 PS1 的独立产物，再照常启动门厅：

```bash
npm --prefix ../game-ps1 run build
npm run dev
```

开发服务器会只读挂载 `../game-ps1/dist`，因此下列同源地址可直接用于开门和分享回归：

```text
http://localhost:5173/myopia-3d/
http://localhost:5173/myopia-3d/end-consort.html
```

PS1 重新构建后刷新页面即可看到新产物，不需要重新构建门厅；若独立产物缺失，以上地址会明确返回构建命令而不是回退到门户首页。生产部署仍应使用 `npm run build:experiences`，由该命令复制产物到 `game/dist/myopia-3d/`。

### 统一发布

发布任意门时只使用门户目录的完整构建，而不要把 `game-ps1/dist` 单独当成最终站点：

```bash
cd kanshan-portal/game
npm run build:experiences
npm start
```

这会在 `dist/` 内同时产出门厅、`/myopia-3d/`（近视眼）和
`/myopia-3d/end-consort.html`（端妃）。Node 网关会同源托管这三页；裸
`/myopia-3d` 也会规范跳转到带尾斜杠的入口。若使用纯静态平台，部署根目录
应为 `game/dist/`，并保留这两个目录路由及其相对 `assets/` 文件。互动故事的
`/api` 仍需要单独托管网关或等价的服务端适配层；不要把 Access Secret 放入静态
环境变量或前端产物。

两个 3D 页的记录卡和系统分享都会回到门厅并高亮对应门：
`?story=myopia-3d` 或 `?story=consort-3d`。链接不包含存档、恐惧值、进度或选择。

### 密钥（Access Secret）

网关鉴权只发给服务端配置的上游；**永不入库、不进日志、不回传前端**。解析顺序：

1. 环境变量 `ZHIHU_ACCESS_SECRET`
2. 本地文件（`ZHIHU_SECRET_FILE`，默认仓库根目录 `.access_secret`）
3. 都没有 → **降级模式**（见下），游戏照常可玩

没有密钥也能全流程跑通：对话会触发「时空信号中断 → 刘看山救场 → 选择继续剧情」。

### 无网络联调（假上游，不耗额度）

```bash
npm run dev:mock     # 终端 A：监听 127.0.0.1:8791 的 OpenAI 兼容假直答
ZHIDA_BASE_URL=http://127.0.0.1:8791/v1 ZHIHU_ACCESS_SECRET=any npm run dev:gateway
# 或：npm run dev 后另开终端跑上面命令会端口冲突，请先杀掉 8790 的进程
```

假上游规则（`server/mock-upstream.mjs`）：玩家消息含「船票/十年前」→ 老周说出真相（goalAchieved=true），
否则继续推脱（false），用于验证流式、目标判定、救场、缓存。

## 玩法（体验清单）

- **开场 10 秒**：深色 → 🦊 刘看山推门 → 门缝白光（<600ms 穿越光效，点按可跳）→ 门厅。
- **门厅**：故事封面卡横向滑动；有存档时出现「继续上次的旅程」。
- **叙事（novel/choice）**：打字机正文（已完成段落走 markdown、当前段逐字），轻触跳过段、可跳全部；
  渲染前先经 marked→DOMPurify 净化。无场景图时用哈希配色的渐变+噪点占位，有图则淡入+轻微视差。
  顶部细进度条按章节推进。
- **对话（chat）**：气泡+头像色块；SSE 流式逐字；「换一条」（以 noCache 重新提问）与「继续剧情」
  （达成 goal 后解锁；信号中断/救场后也会放行，永不卡死）。
- **刘看山救场**（亮点，不是补丁）：三条触发——① 连续 4 轮 goalAchieved=false；
  ② 玩家消息命中剧透关键词（内容安全闸，本地拦截，不耗 LLM 额度）；
  ③ 网关报错/超时/限流/无密钥（时空信号中断）。狐狸插话（台词轮换）+ 3 个回归主线选项：
  「回到正题，继续聊」「主线提示是什么？（本地取 scene.goal，不耗额度）」「跳过这段，推进剧情」。
- **结局页**：尾声 → 结局大字（衬线渐变）→「你的故事人格报告」（纯模板，基于变量与抉择回放拼词，不接 LLM）
  → Canvas 海报（大号故事名+八型人格视觉主题）→ 保存 PNG／系统分享 →「再穿一次」。
- **系统**：localStorage 存档（场景/变量/抉择回放/对话窗口，刷新续玩）；`?scene=<id>` 评委暗门直达
  （不读档不写档）；无声可玩，音效/打字音默认关，设置里可开；语速可调。
- **场景图**：`scene.image` 支持完整 URL 或相对路径（放在 game/public/ 下，生产由网关同源托管）。

## 网关 /api/chat 约定（对接用）

```
POST /api/chat      Content-Type: application/json
{
  "storyId": "mist-ferry",            // 对应 game.json story.id
  "sceneId": "cabin",                 // chat 场景 id
  "history": [{"role":"user"|"assistant","content":"…"}],  // 近 ≤12 轮，末条须为 user
  "choiceSummary": "你选择了「…」；…",  // 可选：玩家全局选择历史摘要
  "noCache": false,                    // true = 换一条（绕过 LLM 响应缓存）
  "model": "zhida-fast-1p5"            // 可选，默认读 env ZHIDA_MODEL
}
```

响应为 `text/event-stream`，每帧 `data: {...json}\n\n`：

| 事件 | 字段 | 说明 |
|---|---|---|
| `delta` | `content` | 台词增量（网关已把 LLM 末尾的 `{"goalAchieved":…}` 尾巴藏住，不会漏到 UI） |
| `done` | `reply`,`goalAchieved`,`cache`(`hit/miss`),`model` | 回合结束；网关容错解析 LLM 输出 |
| `error` | `code`,`message` | `NO_KEY` / `TIMEOUT` / `RATE_LIMIT` / `AUTH` / `NETWORK` / `STREAM_BROKEN` / `BAD_REQUEST` / `NO_STORY` / `BAD_SCENE`；message 为可读的「时空信号中断」文案 |

**Prompt 组装在网关做**：NPC 卡（description/personality/scenario/system_prompt/mes_example）
+ 本场景 lore + 玩家选择历史摘要 + 对话目标（goal，用于判定 goalAchieved）+ 扮演/防剧透/输出格式铁律。
要求模型输出：台词 + 换行 JSON `{"goalAchieved":true|false}`；网关按
「整段 JSON → 正文+末尾对象 → 正则兜底」三级容错解析。

其它只读接口：`GET /api/stories`（封面列表元数据）、`GET /api/story?id=`（完整 game.json）、
`GET /api/health`（`llm: up|degraded` 与原因，用于设置页展示与排查）。

**game.json 契约**：与编译管线共享的 schema 见仓库约定（story/scenes[npc/lore/choices/…]/endings/kanshan）。
本仓库的 TS 类型即运行时事实源：`game/src/types.ts`。契约之外，运行时还支持：chat 场景 `next`/`goto`
推进；chat 场景无 next 但有 `choices` 时达成目标后展示“后置抉择”；ending 场景可带 `choices`（达成后继续分支）。

## 降级行为（无密钥 / 超时 / 限流 / 上游错误）

所有 LLM 路径都先保证**游戏可继续**，再谈体验：

1. 聊天前（前端本地）：剧透关键词 → 刘看山拦截 + 3 个回归主线选项（0 消耗）。
2. 请求失败（网关 error 事件或前端网络错）：
   - NPC 回复换成刘看山「时空信号中断」气泡（`DEGRADE_COPY`），文案按错误码区分；
   - 立即给出 3 个回归主线选项，其中「主线提示」与「推进剧情」都不再依赖 LLM；
   - 「继续剧情」在降级后被放行 → 直接沿 scene.next 推进。
3. 回复被缓存：`server/.cache/` 按请求指纹落盘，相同请求不再消耗直答额度（demo 里重复对话会秒回 cache hit）；
   「换一条」用 `noCache` 绕过；`KANSHAN_NO_CACHE=1` 全局关闭。相同指纹的并发 miss 会合并成一次上游调用，缓存采用临时文件原子替换，流内报错的半截回复不落盘。
4. 只对真实上游调用做进程内保护：默认每个客户端 10 分钟 60 次；知乎直答端点全局每个 UTC 日 80 次，兼容模型端点默认 4500 次，为已核对的不同额度分别预留余量。缓存命中与并发跟随者不计数，目标裁判的额外请求会计数。可用
   `KANSHAN_CHAT_RATE_LIMIT`、`KANSHAN_CHAT_RATE_WINDOW_MS`、`KANSHAN_CHAT_DAILY_LIMIT` 调整，设为 `0` 可关闭相应保护。日计数会随网关重启清零；`CF-Connecting-IP` 仅在直连来源为本机回环地址时采信，其余情况按 TCP 对端限流。

## 已知缺口 / 后续

- 真实 zhida 联调未跑（试用额度极小，保护配额）：网关用 OpenAI 兼容 mock 做了同协议全链路验证；
  若有真实 key，`npm run dev` + 正常对话即可直接用（消息流经真实 `developer.zhihu.com`）。
- 支持 `zhida-thinking-1p5`/`zhida-agent` 档位（按场景传 `model` 即可切换），默认 `zhida-fast-1p5`。
- 刘看山文案当前用 🦊 emoji + 文本；官方素材就位后替换（Boot/Doors/气泡头像三处引用）。
- 结局海报是可保存、可系统分享的静态视觉；故事入口以分享面板中的链接承接，不在卡面固化会持续变动的二维码。
- 剧透关键词表为本地启发式列表（`src/lib/config.ts`），可按故事语料扩充；误伤时走救场而非报错。
- 场景图资源当前走同源 /public；大量封面素材后可换成 CDN URL（`scene.image` 直填即可）。
- 未做 PWA/离线包、无障碍读屏专项、音量分级（仅有开关）。

## License

MIT
