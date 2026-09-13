// 各步骤的 LLM prompt 构造器（真实模式使用；mock 模式不走这里）。
// 关键决策：
// - 只输出 JSON 且给出字段清单 → 配合 llmJson 的 retry/schema 自纠闭环；
// - analyze/design 的 id 强制 ASCII，便于后续跨文档引用；
// - design 把“结局由变量累积决定、两难而非对错、原著段落尽量覆盖”写成硬规则。
import { clip } from './util.mjs';

const JSON_ONLY = '只输出一个合法 JSON 对象，不要 Markdown 代码块、不要任何解释文字。';

// model 由调用方（runner）按 kind 经 conf.modelFor() 解析，这里只标注 kind，
// 避免把默认模型名烤进消息体而绕过 ZHIHU_MODEL_* 环境变量覆盖。
function messages(kind, system, user) {
  if (typeof system !== 'string' || !system.trim()) throw new Error('prompt 构造器内部错误：system 非字符串');
  if (typeof user !== 'string' || !user.trim()) throw new Error('prompt 构造器内部错误：user 非字符串');
  return { kind, system, user };
}

export function buildAnalyze(raw) {
  const system = `你是一位严谨的中文叙事分析引擎。你会拿到一篇 2000–8000 字的短篇故事（可能是第一人称）。你的任务是为它生成一份“改编前分析”，供后续交互化结构设计使用。
要求：
1. 只抽取原文明确呈现的内容，不脑补动机/背景；原文没写的字段用“原文未明说”或空串，绝不编造结局。
2. 所有 id 必须是 ASCII 标识符（正则 ^[A-Za-z][A-Za-z0-9_-]{0,39}$），例如 npc_xuzhuo、loc_library、ev_3、rule_time、hook_door。
3. 人物至少包含主角与 2–4 个可对话角色（原文若只有主角+1 人，就写 2 个；不要把“我”的内心独白当成别人）。
4. personality 是 3–6 个词的性格标签；catchphrase 填该人物反复出现的口头禅/说话习惯，没有就空串。
5. timeline 按故事内发生的先后排序，order 从 1 递增，importance 只允许 major/minor。
6. worldRules 抽取世界观里“不可违背的规则/异常设定”（例如时间循环条件、门的规则、系统任务），没有就返回空数组。
7. foreshadowing 抽取伏笔/异常细节（例如反复出现的意象、说不通的细节），plantedAt 标注它埋在第几段附近，payoffHint 标注它在故事中的呼应点（未知则空串）。
8. completeness 判断文本完整性，只看文本本身、不脑补：
   - "complete"：故事有完整收束/结局；
   - "truncated"：在剧情中段戛然而止，主要悬念没有答案（连载试读常见这种形态）；
   - 拿不准用 "unknown"。
9. discoveries 抽取“玩家在互动改编里可以发现的事”——事实(fact)、秘密(secret)、心事/真实感受(feeling)、世界规则(rule)。只抽原文明确呈现的内容；criticalForClimax=true 表示“没发现它就不该通向真相/隐藏结局”的关键发现（0–4 条，宁缺毋滥）。没有合适的就返回空数组。`;
  const user = `故事文件：${raw.sourceFile}
标题：${raw.title}
字数：${raw.wordCount}

请输出以下 JSON：
{
  "storyId": "${raw.storyId}",
  "title": "正式标题",
  "author": "作者（txt 中若未注明则为空串）",
  "logline": "一句话梗概（40 字内）",
  "tags": ["2-4 个题材标签，如 悬疑/情感/无限流/都市"],
  "completeness": "complete|truncated|unknown",
  "discoveries": [{"id":"ascii","kind":"fact|secret|feeling|rule","content":"原文明确呈现、玩家可发现的事","criticalForClimax":true}],
  "characters": [{"id":"ascii","name":"人物名","role":"protagonist|key_npc|antagonist|minor","summary":"身份与处境一句话","personality":["标签"],"motivation":"动机","catchphrase":"口头禅或空串"}],
  "locations": [{"id":"ascii","name":"地点名","kind":"室内/室外/异空间…","description":"一句话描写"}],
  "timeline": [{"id":"ascii","order":1,"title":"事件名","description":"发生了什么","importance":"major|minor"}],
  "worldRules": [{"id":"ascii","rule":"规则原文或转述"}],
  "foreshadowing": [{"id":"ascii","description":"伏笔/异常细节","plantedAt":"埋设位置描述","payoffHint":"呼应点（未知空串）"}]
}

以下是原文（已分段，保留段落编号便于引用）：\n\n${paraList(raw)}`;

  return messages('thinking', system, user);
}

export function buildDesign(raw, analysis) {
  let system = `你是一位互动叙事架构师，负责把一篇短篇改编成“抉择式互动故事”的蓝图（structure.json）。运行时随后会照此蓝图逐场景生成文本。
### 硬性结构约束（必须全部满足）
1. scenes 总数 8–14；endings 3–5；npcs 2–4；chat 类型场景 1–3 个。
2. scenes 类型四选一：novel（展示原著段落）、choice（抉择点）、chat（与 NPC 对话）、ending（结局）。endings 数组里的每个 id 都必须等于某个 type=ending 的 scene id，反之亦然（运行时用 scene id 查结局元数据）。
3. novel 场景通过 paragraphRange（1 起始、闭区间）指向原著段落，几个 novel 场景的范围要首尾相接、尽量覆盖除结局外的全部段落；不得重叠。结尾留 1–2 段给“结局·原著”场景用。choice/chat 场景 paragraphRange 一律 null；ending 场景中只有“原著结局”可以带 paragraphRange（引用特意留出的结尾段），其余结局不带。
4. 抉择点设计原则：
   - “两难”而非“对错”：每个选项在角色视角下都说得通，代价不同（如信任某人 vs 怀疑某人、救人 vs 自保、坦白 vs 隐瞒），禁止“选 A 是蠢、选 B 显然正确”；
   - 结局差异必须由前面累积的变量决定，而不是只有最后一次选择才算数：较早的 choice/chat 选项要写 set 修改变量（如 trust_xuzhuo、approach），越靠近结局的选项文案越要呼应前面攒下的变量/线索；
   - 每个 choice 场景 2–4 个选项，每个选项 text 要有画面/心理，不要干巴巴的“去A/去B”；next 指向存在的 scene id；set 只允许使用 variables 里声明过的变量。
5. 变量：variables 先声明 {name, meaning, values[]}，name 匹配 ^[a-z][a-z0-9_]{0,31}$；所有 choice.set 的键都必须来自 variables；不要造拼写相近的重复变量。
6. chat 场景：npc 必须是 analysis.characters 里 role 非 protagonist 的角色；goal 写清玩家这次对话要达成的小目标（拿到线索/建立信任/说服对方）；chat 场景也带 2 个玩家回应选项并 set 变量（如 trust_xxx）。其余场景类型不要带 choices。
7. 连通性：从 scenes[0]（start，建议首个 novel 场景）出发所有场景都可达；**除 ending 外每个场景都必须显式写出 next/goto 或 choices——仅按数组顺序排列不等于连通，s1 不会自动走向 s2**；每个场景都能最终到达某个 ending；不允许出现无出口的死循环。paragraphRange 之外不要引用段落。
8. ending 场景不带 choices/next；chapter 是 ≤20 字的短标题（编译会再润色）；tone 用情绪词（遗憾/惊悚/平静/温暖…）。
9. novel 场景的 narrative 写“编译提示”：这段应沿用哪些关键描写/金句、第一人称视角如何收束；choice/chat/ending 的 narrative 写清这个场景该表达的情绪与信息量。
10. npcs 数组：每个 npc 都要有 chatScene（它出现在哪个 chat 场景）、appearsIn（它登场的 novel/chat 场景 id 列表）；不要在 npcs 里放主角。`;
  const extras = designExtras(analysis);
  if (extras.length) system += `\n\n${extras.join('\n\n')}\n\n附加规则与基础规则冲突时，以附加规则为准。`;
  system += '\n最后只输出 JSON。';
  const user = `分析结果：
${JSON.stringify(analysis, null, 2)}

原文段落（1..${raw.paragraphs.length}，结尾保留段落供结局复用）：
${paraList(raw)}

请输出 structure.json：
{
  "storyId": "${analysis.storyId}",
  "title": "${analysis.title}",
  "premise": "这个互动的核心两难，一句话",
  "tags": ${JSON.stringify(analysis.tags || [])},
  "variables": [{"name":"","meaning":"","values":[]}],
  "scenes": [
    {"id":"s1","type":"novel","chapter":"","paragraphRange":[1,3],"purpose":"","narrative":"","lore":["rule_xxx_id 或 hook 相关"]},
    {"id":"c_mid","type":"choice","chapter":"","paragraphRange":null,"purpose":"","narrative":"","choices":[{"text":"","next":"","set":{}}]},
    {"id":"chat_xu","type":"chat","chapter":"","paragraphRange":null,"npc":"npc_xuzhuo","goal":"","purpose":"","narrative":"","choices":[{"text":"","next":"","set":{}}]},
    {"id":"e_main","type":"ending","chapter":"","paragraphRange":null,"purpose":"","narrative":""}
  ],
  "endings": [{"id":"e_main","title":"","tone":"","summary":""}],
  "npcs": [{"id":"","notes":"","chatScene":"","appearsIn":[]}]
}

可用 lore id（从分析文档派生，scene.lore 只能填这些）：
${availableLore(analysis)}

${JSON_ONLY}`;
  return messages('thinking', system, user);
}

// design 的条件附加规则：按分析结果决定激活哪些模板（通用门控 / 剧本杀 / 序章）
function designExtras(analysis) {
  const extras = [];
  const tags = analysis.tags || [];
  const mystery = tags.some((t) => /悬疑|推理|惊悚|刑侦|案件|恐怖|灵异/.test(t));
  const truncated = analysis.completeness === 'truncated';
  const critical = (analysis.discoveries || []).filter((d) => d && d.criticalForClimax);

  if (critical.length) {
    const eg = `clue_${critical[0].id}`.replace(/[^A-Za-z0-9_]/g, '_');
    extras.push(`### 附加规则：关键发现门控（线索 = 变量）
- 分析文档里 criticalForClimax=true 的发现共 ${critical.length} 条（${critical.map((d) => d.id).join('、')}）。每条声明一个 clue_ 前缀变量（如 ${eg}，meaning 写成这条线索的展示名，values 为 ["found"]）。
- 在玩家获得该发现的选项上 set 它——chat 场景达成 goal 后的出口选项是天然的获得点；多个发现的获得点要分散在不同场景，别堆在一处。
- 在收束用的 choice 场景里，通往“真相/隐藏”类结局的选项必须带 requires（如 {"${eg}":"found"}）与 lockedHint（≤16 字，如“还缺关键线索”）。
- 每个 choice 场景至多 1 个带 requires 的选项；普通/遗憾结局的选项绝不带门——任何玩家都必须有路可走。`);
  }
  if (mystery) {
    extras.push(`### 附加规则：剧本杀模式（悬疑题材）
- chapter 节拍按「案发 → 搜证 → 指认 → 复盘」命名；premise 写成核心谜题（谁在说谎/真相是什么），而非抽象两难。
- chat 场景的 goal 写成审讯目标（“让 X 说出昨晚的行踪”），把嫌疑人/知情人安排进 chat。
- 收束 choice 场景的选项要是具体判断（指认某人、指出某个具体矛盾），不要“相信直觉”这类空泛文案。`);
  }
  if (truncated) {
    extras.push(`### 附加规则：序章模式（原著文本在中段截断，没有结局）
- novel 场景的 paragraphRange 首尾相接覆盖全部段落，不留“原著结局”保留段；所有结局的 paragraphRange 一律为 null。
- 结局全部写成“序章收束”：阶段性站队（你目前怀疑谁/你打算怎么办）或推理进度小结，结尾自然引导玩家去读原著原文寻找答案；**严禁编造原著未写的真相、真凶或结局走向**。
- endings 的 title/tone 不得暗示真相已揭晓（禁用“真相大白/原著结局/真凶”这类词），可用“疑云未散/未完待续/各有嫌疑”这类。`);
  }
  return extras;
}

// 编译第 1 步：逐场景正文（novel 第一人称改写 / choice / chat 开场）
export function buildSceneTexts(raw, analysis, structure) {
  const novel = structure.scenes.filter((s) => s.type === 'novel' || s.type === 'chat' || s.type === 'choice');
  const jobs = novel
    .map((s) => {
      const paras =
        s.paragraphRange && raw.paragraphs.length
          ? raw.paragraphs.slice(s.paragraphRange[0] - 1, s.paragraphRange[1]).map((x) => x.text)
          : [];
      return {
        id: s.id,
        type: s.type,
        chapterHint: s.chapter,
        purpose: s.purpose,
        narrative: s.narrative,
        goal: s.goal || '',
        originalParagraphs: paras,
      };
    })
    .map((j) => `### ${j.id}（${j.type}）
purpose：${j.purpose}
narrative：${j.narrative}
${j.type === 'chat' ? `goal：${j.goal}\n` : ''}${j.originalParagraphs.length ? `原著段落：\n${j.originalParagraphs.join('\n')}\n` : '（无原著段落，请依据 narrative 自行铺陈，≤120 字）'}`)
    .join('\n\n');

  const system = `你是中文互动叙事的文字编译。把结构蓝图中的每个场景写成最终展示文本，输出 JSON：{"scenes":[{"id":"场景id","text":"markdown 正文"}]}。
规则：
1. novel 场景：基于给出的原著段落重写为第一人称（若原段落已是第一人称则顺承润色），**保留关键描写、对话与金句**；只写该段场景内容，长度与原著相当或略短；不要提前揭开后续伏笔/结局；不要出现任何结构元信息（如“选项”“结局一”）。
2. chat 场景：写“你来到某处见到该 NPC”的环境与人物反应（80–160 字），NPC 的开场白单独放在 scene.text 末尾一行（以“> ”引用开头也行）；不要替玩家说话。
3. choice 场景：写当前两难处境（60–120 字），不写选项本身（选项文本已由蓝图给出）。
4. 全部 markdown 合法；人称统一为“我/你 的视角”（用第二人称“你”指代玩家亦可，全文统一）；输出文本的 key 必须与输入 id 一一对应、不多不少。`;
  const user = `标题：《${analysis.title}》
logline：${analysis.logline}

请为以下场景生成正文：
${jobs}

${JSON_ONLY}`;
  return messages('thinking', system, user);
}

// 编译第 2 步：结局文本 + NPC 角色卡
export function buildEndingsAndNpcs(raw, analysis, structure) {
  const mainEnding = structure.endings.find((e) => {
    const sc = structure.scenes.find((s) => s.id === e.id);
    return sc && sc.type === 'ending';
  });
  const byId = new Map(structure.scenes.map((s) => [s.id, s]));
  const endingsPart = structure.endings
    .map((e) => {
      const sc = byId.get(e.id);
      const paras =
        sc?.paragraphRange && raw.paragraphs.length
          ? raw.paragraphs.slice(sc.paragraphRange[0] - 1, sc.paragraphRange[1]).map((x) => x.text)
          : [];
      return `### ${e.id}（${e.title}｜${e.tone}）
summary：${e.summary}
${paras.length ? `可复用的原著结尾段落：\n${paras.join('\n')}\n` : '（结局需基于 summary 与全篇伏笔自行撰写，160–260 字）'}`;
    })
    .join('\n\n');

  const chars = new Map(analysis.characters.map((c) => [c.id, c]));
  const npcsPart = structure.npcs
    .map((n) => {
      const c = chars.get(n.id);
      return `### ${n.id}（${c?.name || n.id}）
notes：${n.notes}
role：${c?.role}
summary：${c?.summary || ''}
personality：${(c?.personality || []).join('、')}
motivation：${c?.motivation || ''}
catchphrase：${c?.catchphrase || ''}`;
    })
    .join('\n\n');

  let system = `你是互动叙事的编译器。基于原著分析输出两部分内容的 JSON：
{"endings":[{"id":"","text":"结局正文 markdown"}],"npcs":[{"id":"","card":{"description":"","personality":"","scenario":"","first_mes":"","mes_example":"","system_prompt":""}}]}
规则：
1. endings：结局正文 160–260 字，第一人称收束；e_main（原著结局）要自然复用原著结尾段落的关键句；“秘密/反转”类结局要呼应 analysis.foreshadowing 里的伏笔；各结局写法要拉开差异（基调由 tone 决定）。
2. npc card 字段：
   - description：一句人物介绍；
   - personality：性格标签串（来自分析）；
   - scenario：当前时间点该 NPC 身处何地何事（参考 its chatScene 前后剧情，30–50 字）；
   - first_mes：玩家在它的 chat 场景中、当下这一刻听到它开口说的第一句话（30–80 字），**必须与 scenario 的处境严丝合缝**（例如 scenario 是深夜来电，开口就应是电话里的话）；可以改编原著原话，但只有当它符合此刻情境时才可用；
   - mes_example：2–3 行“原著风”对话示例，格式为 \`<name>：“……”\`，每行一个；
   - system_prompt：为该 NPC 写的角色扮演系统提示，**必须包含三点**：①不脱离《title》原著人设；②不剧透尚未发生的剧情、不主动揭露伏笔与结局；③它不是 AI/程序，不承认自己是模型，也不会讨论现实。用语自然，不要机械堆砌编号。
3. 输出 npcs 的 id 必须与输入一一对应。`;
  if (analysis.completeness === 'truncated') {
    system += `
4. 序章收束（原著文本在中段截断，没有结局）：结局正文**不要揭示真相**——写玩家此刻的推理状态（发现了什么、还卡在哪、最怀疑谁），最后一句自然邀请玩家去读原著原文寻找答案（不要编造章节号或后续情节）。语气意犹未尽；严禁编造原著未写的真相、真凶或结局走向。`;
  }
  const user = `标题：《${analysis.title}》
logline：${analysis.logline}
tags：${(analysis.tags || []).join('/')}

【结局需求】
${endingsPart}

【NPC 需求】
${npcsPart}

【可用的伏笔/规则素材】
${availableLore(analysis)}

${JSON_ONLY}`;
  return messages('thinking', system, user);
}

// 编译第 3 步：刘看山引导（简单步骤 → fast 模型）
export function buildKanshan(analysis) {
  const system = `你是“刘看山”，知乎的北极狐吉祥物，在一款“穿越进盐言故事”的互动阅读里当引路人。输出 JSON：{"intro":"","rescueLines":[]}。
intro（80–140 字）：玩家刚“推开一扇门”进入《故事》的世界。要点题“穿越/进门”这个机制，语气像老朋友在故事线外打招呼，带一点俏皮，但不破坏故事氛围；结尾自然把玩家推向第一个场景。**人称红线：刘看山（北极狐）是“我”——开口引路的吉祥物；玩家是“你”——穿越进来的人类。绝不能把玩家写成北极狐，也不能让刘看山变成故事里的角色。**
rescueLines（3–4 条）：玩家卡关/线索断裂时的俏皮但不出戏的引路语，能塞进故事而不违和，每条 ≤28 字。不要剧透。
禁止出现“你其实已经死了/凶手是/这一切都是梦”这类破坏性提示。只输出 JSON。`;
  const user = `故事：《${analysis.title}》
类型：${(analysis.tags || []).join('/')}
梗概：${analysis.logline}
主角：${(analysis.characters || []).filter((c) => c.role === 'protagonist').map((c) => c.name).join('、') || '我'}
主要地点：${(analysis.locations || []).slice(0, 3).map((l) => l.name).join('、')}

${JSON_ONLY}`;
  return messages('fast', system, user);
}

function paraList(raw) {
  return (raw.paragraphs || []).map((p, i) => `【${i + 1}】${p.text}`).join('\n');
}

function availableLore(analysis) {
  const parts = [];
  for (const r of analysis.worldRules || []) parts.push(`rule-${r.id}：${clip(r.rule, 100)}`);
  for (const f of analysis.foreshadowing || []) parts.push(`hook-${f.id}：${clip(f.description, 100)}`);
  return parts.join('\n') || '（无）';
}
