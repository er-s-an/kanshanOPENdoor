# 看山任意门 · 开发状态

> **当前版本：GDD 垂直切片 v3（2026-09-14，kanshan-v2 副本）**。在 v2.2 手作章节之上叠加「评论区对线 Boss 战」：调查员世界观（刘看山=系统）、三段式循环、三通道线索、折叠轮回、彩蛋指控。以 [GDD.md](GDD.md) 为玩法权威。
> **并行副本**：施工在 `/Users/xiejiachen/zhihu-hackathon-2026/kanshan-v2`，原 kanshan-portal 保持可演示不动。
> **已实玩验证（ego space 18，8790→8791 端口）**：错选嫌疑人→折叠→e_fold（普通结局徽章）→轮回差分；选对→3 轮呈证（赞同 47→1071→3119→4143）→收网→e_true（传说 ★★★ 徽章）；彩蛋 clue_landmark→e_egg（彩蛋 ✦）。全链路 PASS。
> **关键修复**：合并版引擎 GOTO reducer 白名单只认 next/goto，boss 场景多目的地被静默拒绝——已加 boss 分支（truth/fold/egg  endings）。
> **素材（9/14 已全量上线）**：GPT Image 19 张蓝血场景图+3 张 NPC 头像（`/art/blue/*.jpg`，1600 宽）已接 24 个场景；官方刘看山素材（6 GIF+立绘）进门厅引导/Boot 迎接/DoorFx 转场；portal-hall 门厅背景、门卡片故事卡（悬停开门）；Boss 战物证卡（clue→试卷/网页/目击/陈述底板精确映射）+线索簿软木板底纹。62MB→20MB。全链路浏览器复检 PASS（门厅/对话/Boss 呈证气泡物证卡/无效呈证反驳）。
> **部署（9/14 已上线）**：公网 **https://kanshan.makebook.hk2048.online**（主）+ https://kanshan.hk2048.online（备用，同服务）—— cloudflared 命名隧道 `kanshan-hackathon`（id 8e520862，config `~/.cloudflared/kanshan.yml`，knowfeed 隧道与 makebook 主站均未动）。本地 8791 网关（kimi）经隧道出公网。重启：`bash kanshan-v2/game/start-demo.sh`。注意：/api/chat 无鉴权，公开后 LLM 用量走 kimi 额度，磁盘缓存吸收重复提问；如出现异常用量再限流。
> **待办**：项目广场提交占位（用户手动，需公网链接=已有）；计划书（9/15 10:00 必交）；提交包过滤；西游/近视眼 Boss 化推广（如时间允许）。

> **LLM 现状（9/14 定案）**：zhida 全系（fast/thinking）拒绝角色扮演（产品层「AI 搜索」对齐，冒烟实测）；用户拍板**演示用 kimi**（赛事规则允许任选模型）。网关提示词架构改为「文本加工」：事实素材+玩家原话→对白（buildRewritePrompt），模型只加工不扮演；出戏检测（OFFLINE_RE）+ 缓冲放行，拒答文案绝不进气泡；剧本主题确定性授线索。实测：张薇能直接回应玩家具体提问且证言事实完整保留（kimi-for-coding，8791 网关运行中）。zhida 留作非扮演用途（人格侧写/复盘解读，roadmap）。

---

> **历史版本：完整首章重做 v2.2（2026-09-13）**。此前两段 playable 小样例退出默认入口。新版恢复三篇官方多幕故事；蓝血 27 节点、近视眼 24 节点，主线聊天／搜证／查证／行动／结算已接通。以 [PRD-v2.2](PRD-v2.2.md) 和 [本次修复验收](docs/archive/REBUILD-ACCEPTANCE-20260913.md) 为历史事实，下面旧记录按历史阅读。（文档体系 9/14 已整理：过期件入 docs/archive/，索引见 README）


> 2026-09-13 更新：产品方向以 [PRD-v2.1.md](docs/archive/PRD-v2.1.md) 的「玩法库 × 前人留痕」为准；已验证实现及后续交接见 [开发记录](docs/archive/DEVELOPMENT-20260913.md)。下文保留凌晨的 V1 开发历史，不代表 V2 已全部实现。

## 项目
- 知乎黑客松 2026 校园新锐季，赛道：跨次元游乐场（AI 游戏与互动叙事）
- 当前产品方向：多类型故事适配不同主玩法；剧本杀是玩法库的一类。V1 搜证/指认路径保留兼容，V2.1 补充异步互助设计。
- 演示形态不变：盐选壳页 + "穿进这个故事"入口 → 刘看山带路 → 剧本杀循环（入局→搜证→指认→复盘）
- 赛程：9/13 10:00 开赛 → 9/15 10:00 交件 → 9/19 决赛（798/腾讯会议）
- 模型选择：用户补充的赛事规则明确底层模型自由选择。当前已验证知乎直答；模型与凭证由服务端配置。

## 两档文本框架（PRD §4，诚实框架）
- A 档完整闭环：完整故事 → 指认全书真凶 → 真相复盘
- B 档序章模式：API 试读（~3000 字截断）→ 指认降级为"本章内可解疑点"（从试读文本实有内容提取，不发明）→ 推理报告+站队+引流原文
- 管线 analyze 自动检测截断（completeness）→ design 自动选档；API 若放出完整章节则自动升 A 档

## 凭证与 API 事实（9/13 实测）
- Access Secret：`~/zhihu-hackathon-2026/.access_secret`（600），已配 zhihu-cli 钥匙串
- zhihu-cli **0.6.0**：`"$HOME/Library/Application Support/zhihu-cli/current/zhihu-cli"`（search/hot/answer/me/knowledge/question/quota；**无 story 命令**，故事走裸 HTTP）
- 配额口径存在冲突，不能把旧快照当当前余额：凌晨历史快照记录过**直答 5000**、搜索 5000×2、热榜 100；仓库内当前开放平台说明则写搜索 5000×2、热榜 100、**直答 100**。上线设计暂按更保守的直答 100 次/日，实际剩余额度只以个人中心「用量统计」为准。
- **zhida-agent 不支持多轮上下文**——NPC chat 只能用 fast/thinking；thinking 流式先吐 reasoning_content；`--output text` 必须配 `--stream`
- 故事接口（无需鉴权不占额度）：`GET https://api.zhihu.com/km-indep-home/hackathon/v2/story/list`（20 篇）+ `/story/{work_id}`。**关键事实：正文全部截断在恰好 ~3000 字、断在剧情中段**（19/20 恰好 3000 字；字段名 `chapter_name`）——付费连载试读章节，坐实"互动预告片"定位
- 知识详情接口 `/knowledge/list` 10 条全 400；按官方文档 **9/13 10:00 才完全开放 CLI/API**，到点再验证
- 文档在 skill 0.7.1：`/tmp/skill071/zhihu/references/hackathon-content-api.md`；本轮已读 Skill 0.7.2 的 OAuth 与用户资料文档，见 docs/ZHIHU-SOCIAL-API-NOTES.md
- 官方 skill 包：~/zhihu-hackathon-2026/skill/zhihu-hackathon/；OAuth 应用未注册（人气奖登录数用）

## 故事缓存纪律（硬性）
- 接口用一次少一次，**已全部落盘，禁止再调**：`pipeline/stories/api/` 下 `list.json` + `raw/<work_id>.json` + `<标题>-<work_id>.txt`（管线直接可吃）
- 20 篇题材：悬疑惊悚 4（蓝血/西游之众佛腐烂/李冬原著/近视眼勇闯恐怖游戏）、言情甜宠 ~8、仙侠玄幻 ~5、科幻末世 2、现实情感 1

## 代码（~/zhihu-hackathon-2026/kanshan-portal/）
- `game/`：Vite6+React19+TS。`npm start` 单进程 8790；typecheck+build 绿
- `pipeline/`：txt→game.json 五步（ingest/analyze/design/compile/validate），mock-first+LLM 缓存，**29/29 测试绿**

### 剧本杀生成器改造（9/13 凌晨，全部完成）
- **契约**：`Choice.requires`（条件门）+ `Choice.lockedHint` + `GameJson.clues`（线索元数据，从 clue_* 变量派生）——types.ts / compile-lib / schemas 三处同步
- **analyze**：+`completeness`（complete/truncated/unknown 截断检测）+`discoveries`（fact/secret/feeling/rule + criticalForClimax 标记）
- **design**：条件附加规则——①通用门控（critical 发现 → clue_* 变量 → 真相/隐藏结局选项带 requires）；②剧本杀模式（悬疑标签激活：案发→搜证→指认→复盘节拍、审讯目标、具体指认选项）；③序章模式（truncated 激活：段落全覆盖、结局序章收束+引流、严禁编造真相）
- **validate**：`gateProblems` 门控可满足性检查（变量有上游设置者 + 设置者可达门场景），LLM 重试可自纠
- **引擎**：锁定选项灰显+🔒提示；顶栏 🔎x/n 线索簿抽屉（未发现的显示？？？不剧透）；复盘报告+线索收集+结局稀有度（全门控=稀有★★/双门控=传说★★★）；海报同步稀有度与线索统计

## 故事库存
- 自采 3 篇（听听我的故事吧，**仅开发测试，不进提交包**）：story-04《上岸》3.8k 情感 / story-03《如果最后都要分离》12k 悬疑 / story-01《雾夜解剖台》22k 法医悬疑（全链路实玩 PASS；三篇构成法医宇宙）
- 官方池三篇已编译+仿真验证，全入 `game/stories/`：**蓝血**（都市悬疑，4 线索 4 重门→传说结局）、**西游之众佛腐烂**（克苏鲁西游，3 线索门）、**近视眼勇闯恐怖游戏**（喜剧无限流，2 线索门）；裸奔路线均自动落普通结局不死局；蓝血另过浏览器 UI 实测（锁选项/toast/线索簿 1/4）
- design 加固（9/13）：retries 2→4 + prompt 显式连通性（"数组顺序不等于连通"）——西游首跑失败（s1-s5 缺 next）即被此修复；近视眼用到第 3 次重试才过，加固见效
- 标题修正已固化：txt 首部 `标题：`/`作者：` 元信息行，ingest 支持

## 开发期 LLM 配置（用户授权）
- 管线 dev 跑法：`ZHIHU_BASE_URL=https://api.kimi.com/coding/v1 ZHIHU_MODEL_THINKING=kimi-for-coding ZHIHU_MODEL_FAST=kimi-for-coding ZHIHU_TEMPERATURE=omit ZHIHU_TIMEOUT_MS=900000 ZHIHU_ACCESS_SECRET="$KIMI_CODE_API_KEY" npm run all -- --story stories/api/xxx.txt`
- 网关 dev 跑法：`ZHIDA_BASE_URL=https://api.kimi.com/coding/v1 ZHIDA_MODEL=kimi-for-coding ZHIHU_ACCESS_SECRET="$KIMI_CODE_API_KEY" npm start`
- kimi-for-coding 只允许 temperature=1；单 call 1-3 分钟；长文编译需 ZHIHU_TIMEOUT_MS=900000
- 切换兼容模型端点通过服务端 env；正式是否选直答由效果、时延和额度决定，不是赛事强制要求。

## 待办（按优先级）
1. **9/13 10:00 后**：验证 API 全开（知识详情/完整章节？）；zhida 真实 chat 冒烟（限 1-2 次，验 {"goalAchieved"} 格式自觉性）
2. 《蓝血》实玩验证 → 再编译 1-2 篇差异化悬疑（西游克苏鲁/无限流）证明生成器
3. **部署占位（人气奖 9/13 起算）**：先放封面+idea 攒赞 → 需读 hackathon-oauth.md 走 OAuth 注册
4. 刘看山官方素材替换 🦊 emoji（素材包在飞书文档，需用户手动下载）
5. 产品说明计划书（必交，初审重点）——GDD.md 是内核，强化社区契合度表述
6. 演示视频（选交加分）

## 评分抓手（计划书要点）
初审=知乎业务线负责人：主打"盐言 IP 库存互动化改编管线"（对比短剧授权，边际成本趋零）；生成器证明=现场喂新故事；人气奖=9.13-9.23 项目广场点赞+使用+评论，越早挂越好；最佳游戏创意奖=赛道专属 ¥2000。
