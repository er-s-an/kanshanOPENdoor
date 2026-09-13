# 看山任意门 · 玩法与编译方法可吸收清单

> 2026-09-13 · 三路并行调研（SillyTavern 酒馆生态 / LLM 叙事游戏玩法 / 故事→游戏编译方法）+ 代码现状盘点的整合
> 三档：**48h 直接做** / **写进计划书** / **明确不做**

---

## 档一：48h 直接做

### A. 体验层（评委和人气奖直接看得见）

| # | 改动 | 来源灵感 | 成本 | 理由 |
|---|---|---|---|---|
| A1 | **人格报告文案升级：巴纳姆夸奖 + 稀有度标签**（"只有 3% 的玩家走到这个结局"） | 网易云人格色 H5（3.2 亿阅读） | ~0.5h | 只改模板文案，分享欲的直接引擎 |
| A2 | **海报 Wordle 化：晒结局编号 + 稀有度 + 抉择雷达，不剧透结局内容** | Wordle 分享格 | ~1h | 可识别、不剧透、可比较，适配知乎想法区 |
| A3 | **对话目标进度可视化**：chat 场景顶部一格进度条，每轮 goalAchieved 判定后即时反馈 | Event[0] 情绪可见 / 橙光好感度 | ~2h | 隐藏目标现在完全不可见，评委只能靠猜；这条让 demo 效果翻倍 |
| A4 | **抉择 10 秒倒计时 + 超时默认选项** | 剧本杀限时投票 | ~1h | 路演防卡壳神器，压力感拉满 |
| A5 | **结局复盘页「你离真相只差一步」**：显示哪个变量、哪次选择把结局推向另一边 | 剧本杀复盘 | ~2h | 制造"再穿一次"动机，变量回放数据已有（memo） |
| A6 | **多周目彩蛋**：localStorage 记游玩次数，二周目解锁隐藏选项/暗门提示 | 多周目 meta | ~1h | 成本极小，评委喜欢"有心思" |
| A7 | **路演脚本：让观众举手投票选第一个两难** | 通用 demo 技巧 | 0 | 不用写代码，写进 demo 脚本 |

### B. NPC 与提示词层（酒馆生态实证有效的模式）

| # | 改动 | 来源灵感 | 成本 | 理由 |
|---|---|---|---|---|
| B1 | **硬规则后置**：把「本场对话目标 + 不剧透 + 输出格式」从系统提示里拆出来，追加为 history 之后的最后一条消息 | 酒馆社区核心发现：post-history 指令权重最高。当前网关 `gateway.mjs:483` 是单条 system 前置，确实可改 | ~1h | 不改逻辑只改拼装顺序，goal 遵循率提升 |
| B2 | **NPC 红线改正向表述**："不许剧透/不要脱离人设" → "你只知晓此刻之前发生的事，以 xx 的身份语气回应" | 酒馆官方文档实证：正向 > 否定式 | ~0.5h | 改管线 compile 的 system_prompt 模板 |
| B3 | **关键词触发 lore**：玩家 chat 里问"红绳结" → 命中关键词 → 对应 lore 注入提示词 → NPC 接得住梗 | 酒馆 lorebook。中文务必**关闭整词匹配**（无空格会全哑） | ~3h | 把"法医宇宙"三篇共享彩蛋做成可探索的，"好奇有回报"，demo 效果极好 |
| B4 | **暗号彩蛋**：玩家说出特定暗号 → 触发彩蛋 flag/场景跳转 | 酒馆 Automation ID：把关键词引擎当游戏逻辑触发器 | ~1.5h | 配合暗门玩法，站内讨论点 |
| B5 | **NPC 情绪 sticky 注入**：被激怒后"生气语气"持续 3 轮；同一提示冷却防刷屏 | 酒馆 Timed Effects（sticky/cooldown） | ~2h | NPC 现在是每轮无状态的，情绪记忆让对话活起来 |

### C. 管线质量层（保护开赛后用真实故事接口新编译的故事）

| # | 改动 | 来源灵感 | 成本 | 理由 |
|---|---|---|---|---|
| C1 | **validate 加图检查三件套**：陷阱环（有入口无出口的强连通分量）、从 ending 反向 BFS 找死端、汇合点状态一致性（两条支路汇入同一场景时引用的状态必须都成立） | MDPI Symmetry 2026-01 的 Twine 修复框架 | ~3h | 全是确定性检查，零 LLM 成本，直接防演示事故 |
| C2 | **GENEVA 约束写进 design prompt**：原作主线必须作为必经 spine；2–3 个不连续共享 beat 当 bottleneck；分支逐条迭代生成（参照已有分支），不要一次全出 | Microsoft GENEVA（IEEE CoG 2024）实证：一次全出会得到互不相交的平行线 | ~1h | 只改 prompt，直接提升分支交织度 |
| C3 | **实体 ID 术语表检查**：场景文本里的实体引用必须解析到分析步的术语表 ID | STORY2GAME 头号失败模式（别名漂移 Key vs Metallic Key） | ~2h | validate 加一个确定性检查 |
| C4 | **修复回路对齐 SINE 参数**：错误日志喂回（比自我反省可靠）+ ≤3 轮封顶（我们已有 retry×2，对齐即可） | SINE（MDPI 2026-03）：首轮成功率 ~32% 是正常的，修复后 ~74% | ~0.5h | 量化预期：编译失败一两次别慌 |
| C5 | **四类叙事反例做成 judge 检查**：事实冲突 / 承诺冲突 / 改写玩家已提交行动 / 向未见证者泄密 | zenstory-ai/novel-to-game QA 契约 | ~2h | 计划书也可引用为"质量保障体系" |
| C6 | **自动试玩模拟**：脚本随机玩 N 局，输出结局分布 + 从未被走到的选项清单 | story-weaver simulate / ChoiceScript Randomtest | ~3h | 提交前 QA 兜底；"正确路径随机乱走走不到"是好标准 |

**建议的 Day-1 包**（约 12h）：A1 A2 A4 B1 B2 + C1 C2（质量底座）→ Day-2：A3 B3 + 部署/OAuth/计划书。

---

## 档二：写进计划书（roadmap / 理论背书，不开发）

1. **Façade 的 Drama Manager 智慧**（2005，交互戏剧鼻祖）：LLM 只放在 beat 内部做表达层，主线张力由人工结构控制——**这就是我们"确定性主干 game.json + 受限即兴 NPC"架构的理论背书**，直接引用
2. **80 Days / ink 的质量驱动叙事（QBN）范式**：我们的"二元抉择 + 累积变量"即此范式的自动化，inkle 的 ink 已成行业标准脚本语言——引用说明设计血统
3. **并行候选 + judge 择优**（ScyllaChat 2026-07 的 Call Pipeline）：chat 并行生成 2–3 条回复由 judge 选最优——效果好但额度消耗翻倍，直答 100 次/天扛不住，列为额度放开后的路线
4. **多 NPC 同场**（周凛/宋野对质戏）：酒馆群聊实证要用 Swap 模式（只带当前发言人卡 + 其余 NPC 精简摘要），Join 模式会人格污染
5. **ChatHaruhi 式原文台词检索**（arXiv 2308.09597，中文社区项目）：从原文抽台词片段，运行时 embedding 检索注入，"鼓励复用原文台词"——NPC 保声口的最便宜路径
6. **创作者工具化远景**：管线吃任意 txt → "每个盐言作者的一键改编器"（呼应 S1 冠军"存量内容新连接"的赢法 + 作者反哺叙事）

## 档三：明确不做（别人的死因清单）

| 坑 | 死因证据 |
|---|---|
| 语音输入/输出 | 星之低语（蔡浩宇 Anuttacon）：UE5 画质+语音，上线即遇冷——语音救不了"除了聊天没玩法" |
| UGC 剧本/角色市场 | 筑梦岛被网信办约谈（2025-06）；X Eva、美团 Wow 双双停服（2025-11）——UGC+LLM = 审核债务 |
| 亲密度付费墙/擦边 | 与知乎调性和评委完全错配 |
| "一切交给 AI 生成" | AI Roguelite 销量天花板 ~1.75 万份，评测高频抱怨连贯性 |
| 完整剧本杀/海龟汤多人循环 | 3 小时流程，3 分钟 demo 无法呈现；只借"限时投票""复盘"单点 |
| AI 自由侦探取证 | Vaudeville 死于 LLM 编假线索；要做推理就用海龟汤"是/否/无关"受限回答当护栏 |
| 诱导分享话术 | 网易云人格色 H5 被微信屏蔽前车之鉴；靠海报内容质量，不求转发话术 |

---

## 附：分支设计启发式精选（喂给 design 步 prompt）

1. **结构选型**（Ashwell CYOA 模式分类）：小说改编默认 branch-and-bottleneck，配状态追踪才有意义
2. **CoG 选项质量五规则**：每个选项都有真实后果；玩家必须有决策依据（拒绝硬币翻转）；无明显最优项（靠补强而非隐藏信息修）
3. **对立属性对**（CoG 数值设计）：美德之间对立而非善恶一根轴；两侧都要被检查；警惕写进去却从未被读取的废数值
4. **条件门槛用 ≥ 不用 =**（橙光官方教程）：防数值越过阈值死锁
5. **数值变化即时明示反馈**（橙光）：玩家在 3 分钟内要被告知其目标
6. **结局处逐一点名结算累积变量**（Emily Short 的 endgame time cave）：正好对应我们 ending 场景
7. **乱序收集类情节用 storylet 模式**（QBN）：3 个自由 storylet + 1 个按前置状态解锁，避免 6 叉树爆炸

## 关键来源

- 酒馆：[SillyTavern World Info](https://docs.sillytavern.app/usage/core-concepts/worldinfo/) / [Prompts](https://docs.sillytavern.app/usage/prompts/) / [角色卡 V2 规格](https://github.com/malfoyslastname/character-card-spec-v2) / [V3](https://github.com/kwaroran/character-card-spec-v3) / [RisuAI](https://github.com/kwaroran/Risuai) / [ScyllaChat](https://app.scylla.love/docs/changelog.html)
- 游戏：[Suck Up!](https://store.steampowered.com/app/2726370/Suck_Up/) / [1001 Nights](https://store.steampowered.com/app/2782660/1001_Nights_Demo/) / [Façade 论文](https://www.cs.cmu.edu/~dgroup/papers/CMU-CS-02-206.pdf) / [Event[0] 设计文](https://www.gamedeveloper.com/design/making-a-chatbot-that-drives-a-narrative-in-sci-fi-exploration-game-i-event-0-i-)
- 编译：[GENEVA](https://arxiv.org/html/2311.09213v3) / [STORY2GAME](https://arxiv.org/abs/2505.03547) / [SINE](https://www.mdpi.com/2076-3417/16/6/2932) / [Twine 修复框架](https://www.mdpi.com/2073-8994/18/1/113) / [zenstory-ai/novel-to-game](https://github.com/zenstory-ai/novel-to-game) / [ChatHaruhi](https://arxiv.org/pdf/2308.09597) / [story-weaver](https://github.com/ComicSans/story-weaver)
- 设计理论：[Ashwell CYOA 模式](https://heterogenoustasks.wordpress.com/2015/01/26/standard-patterns-in-choice-based-games/) / [CoG 选项五规则](https://www.choiceofgames.com/2010/03/5-rules-for-writing-interesting-choices-in-multiple-choice-games/) / [Emily Short 小规模结构](https://emshort.blog/2016/11/05/small-scale-structures-in-cyoa/)
