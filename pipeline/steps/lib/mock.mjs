// mock 模式：无 key / --mock 时的内置规则生成器。
// 目标：全流程可跑通、产物结构完整、内容较简单且确定性（同一输入 → 同一输出）。
// 文档约定：所有 mock 产物里（mock）字样表示“真实模式会由 LLM 补全/润色”。
import { clip } from './util.mjs';

// ---------------- 文本小工具 ----------------
const STOP_NAMES = new Set(['我', '你', '他', '她', '它', '我们', '你们', '他们', '她们', '它们', '有人', '别人', '大家', '自己', '不是', '还是', '可是', '但是', '没有', '忽然', '男人', '女人', '小孩', '一个', '那个', '这扇', '然后', '如果', '所以', '因为', '说着', '心想', '以为']);

function sentencesOf(text) {
  const t = String(text || '');
  return t.split(/(?<=[。！？!?；;])/).map((s) => s.trim()).filter(Boolean);
}

function firstSentence(text) {
  return sentencesOf(text)[0] || String(text || '').trim();
}

function lastSentence(text) {
  const s = sentencesOf(text);
  return s.length ? s[s.length - 1] : String(text || '').trim();
}

function quotedIn(text) {
  const out = [];
  // 兼容“跨段续引”（说：”…”）与正常 “…”：按对取内容即可，不纠结开闭方向
  const re = /[“”「」]([^“”「」]{1,160})[“”「」]/g;
  let m;
  while ((m = re.exec(text))) out.push(m[1]);
  return out;
}

function clipSentence(s, n = 60) {
  const c = clip(s.replace(/[“”「」]/g, ''), n);
  return c.length >= n ? `${c}…` : c;
}

// ---------------- mock analyze ----------------
export function mockAnalyze(raw) {
  const text = raw.fullText || '';
  const paragraphs = raw.paragraphs || [];
  const tags = guessTags(text);
  const proto = detectProtagonist(text);
  const detected = detectSpeakersFilter(detectSpeakers(paragraphs, proto.name), paragraphs);
  const characters = buildCharacters(proto, detected, paragraphs);
  const nonProto = characters.filter((c) => c.role !== 'protagonist');
  // 至少保证 2 个非主角角色（结构层 npcs 需要 2–4）
  while (nonProto.length < 2) {
    const isKey = nonProto.length === 0;
    const id = isKey ? 'npc_supp1' : 'npc_supp2';
    const n = {
      id,
      name: isKey ? '线索人' : '神秘人',
      role: isKey ? 'key_npc' : 'antagonist',
      summary: '（mock 补充角色：原文缺少可归名的关键配角，真实模式会从原文补全）',
      personality: ['克制', '话不多'],
      motivation: '（mock）掌握一部分关键信息，是否说出来取决于你的态度',
      catchphrase: '',
    };
    characters.push(n);
    nonProto.push(n);
  }
  const locations = detectLocations(paragraphs);
  const hooks = detectHooks(paragraphs);
  const timeline = paragraphs.map((p, i) => {
    const s = firstSentence(p.text);
    return {
      id: `ev_${i + 1}`,
      order: i + 1,
      title: clipSentence(s, 14) || `第 ${i + 1} 段`,
      description: clip(p.text.replace(/\s+/g, ''), 110),
      importance: /(发现|原来|真相|死|失踪|门|钥匙|信|威胁|突然|消失|记得|竟然|血|错|对不起|回来)/.test(p.text) ? 'major' : 'minor',
    };
  }).slice(0, 30);
  const analysis = {
    schema: 'kanshan/analysis/1',
    storyId: raw.storyId,
    title: raw.title,
    author: raw.author || '',
    logline: clipSentence(firstSentence(paragraphs[0]?.text || text), 44) || `关于《${raw.title}》的一段往事。`,
    tags,
    completeness: 'complete',
    discoveries: hooks.slice(0, 2).map((f, i) => ({
      id: `d${i + 1}`,
      kind: 'fact',
      content: f.description,
      criticalForClimax: i === 0,
    })),
    characters,
    locations,
    timeline,
    worldRules: detectRules(text, tags),
    foreshadowing: hooks,
  };
  return analysis;
}

function guessTags(text) {
  const t = String(text || '');
  const tags = [];
  const add = (k) => {
    if (!tags.includes(k)) tags.push(k);
  };
  if (/(门|失踪|警察|尸体|凶|血|密室|传说|秘密|害怕|惊悚)/.test(t)) add('悬疑');
  if (/(时间|循环|回到|重来|穿越|重生|倒带|同一天|预知)/.test(t)) add('时间循环');
  if (/(系统|副本|规则怪谈|无限流|任务|积分)/.test(t)) add('无限流');
  if (/(哭|泪|对不起|妈妈|爸爸|爱|遗憾|告白|原谅|告别)/.test(t)) add('情感');
  if (/(雨|夜|加班|末班车|电话|手机|地铁)/.test(t)) add('都市');
  if (!tags.length) tags.push('悬疑');
  return tags.slice(0, 4);
}

function detectProtagonist(text) {
  const t = String(text || '');
  const iCount = (t.match(/我/g) || []).length;
  const uCount = (t.match(/你/g) || []).length;
  if (iCount >= 5 && iCount > uCount) return { name: '我', role: 'protagonist' };
  return { name: '主角', role: 'protagonist', synthetic: true };
}

// 抽取“谁说了话 / 谁被点名出场”。
// 策略：①动词紧贴引号前（如 徐灼压着声音，“…” / 老周的声音：“…”）——只在这种
// 强上下文里取名字，避免把“你听我说”拆成“你听我”；
// ②“称谓+名字”（男友徐灼 / 管理员老周）。
// 命中的段落里的引文会关联给该角色，作为 first_mes / mes_example 素材。
const NAME_HEAD_BAD = new Set([...'我你他她它谁别不又也都还没这那就把被让在从向和与及或但可如果因为对所以的着是了有会说要看起想找等将于跟很再才只']);

function isBadName(n) {
  if (!n || n.length < 2 || n.length > 4) return true;
  if (STOP_NAMES.has(n)) return true;
  if (NAME_HEAD_BAD.has(n[0])) return true;
  // 合成噪音：把“老周的声音”误切成“老周的 / 理员老周”这类
  if (/[的得着]|[理员]/.test(n)) return true;
  // 以方位/趋向动词结尾多半是“离开前/房间外”这类截断
  if (/[前里上下中后来回出去进走过处边旁]$/.test(n)) return true;
  // 问候/祝福语尾巴（“老师节快乐”→ 节快乐）
  if (/(快乐|愉快|晚安|早安|您好|再见|加油|辛苦|生日快乐)$/.test(n)) return true;
  return false;
}

function detectSpeakers(paragraphs, skipName) {
  const counts = new Map();
  const quotes = new Map();
  const firstPara = new Map();
  // ① 对话式：名字（恰好 2 字）之前必须是断点（行首/标点/引号闭合），紧跟说话动词与引号。
  //    名字 + (动词短语) + (我)? + [，：: ]? + “/「
  const SPEECH = '(?:压着声音|的声音|沉声|低声|轻声|笑着说|笑着|叹了口气|叹道|怒道|急道|说|道|问|喊|答|应|吼|骂|提醒|警告|开口|接话)';
  const SPEAK_RE = new RegExp(`(?<![\\u4e00-\\u9fa5])([\\u4e00-\\u9fa5]{2,3})${SPEECH}(?:我)?[，,：:]?[“”「」]`, 'gu');
  // ② 称谓式：称谓 + 名字。名字取 2–3 字，其后必须是断点或动作/说话动词（避免把“陈叔探”收进名字）
  const FOLLOW = new Set([...'的说问道喊答应叹吼骂笑着压探端挠走站坐看递塞抬回冲摇点哭跑追拉拍瞪皱沉转咳愣低望听挡抢夺张招晃瞪眨抿住']);
  const TITLE_RE = /(?:管理员|老师|同学|同事|邻居|男友|女友|朋友|老板|司机|医生|护士|主持人|导播|保安|民警|教授|店主|房东|学长|学姐|弟弟|妹妹|哥哥|姐姐|父亲|母亲|妈妈|爸爸|爷爷|奶奶|老头|老太|名叫|叫作)([\u4e00-\u9fa5]{2,3})/g;

  const add = (name, paraIdx, qs, viaTitle = false) => {
    if (!counts.has(name)) {
      counts.set(name, 0);
      quotes.set(name, []);
      firstPara.set(name, paraIdx + 1);
      titleHit.set(name, viaTitle);
    }
    if (viaTitle) titleHit.set(name, true);
    counts.set(name, counts.get(name) + 1);
    for (const q of qs) if (!quotes.get(name).includes(q)) quotes.get(name).push(q);
  };
  const okName = (n) => n && n !== skipName && !isBadName(n);
  const titleHit = new Map();

  paragraphs.forEach((p, idx) => {
    const m = p.text;
    const qs = quotedIn(m);
    SPEAK_RE.lastIndex = 0;
    let mm;
    while ((mm = SPEAK_RE.exec(m))) {
      if (okName(mm[1])) {
        add(mm[1], idx, qs, false);
      } else {
        // 3 字候选被拒时回退 1 字符，让更短的 2 字名也能命中
        SPEAK_RE.lastIndex = mm.index + 1;
      }
    }
    TITLE_RE.lastIndex = 0;
    while ((mm = TITLE_RE.exec(m))) {
      const raw = mm[1];
      const acceptLen = (len) => {
        const n = raw.slice(0, len);
        const after = m[mm.index + mm[0].length - (raw.length - len)] || '';
        return !after || !/[\u4e00-\u9fa5]/.test(after) || FOLLOW.has(after) ? n : null;
      };
      const n = raw.length === 3 ? acceptLen(3) || acceptLen(2) : acceptLen(2);
      if (n && okName(n)) add(n, idx, qs, true);
    }
  });

  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 4)
    .map(([name, count]) => ({ name, count, firstPara: firstPara.get(name), quotes: quotes.get(name).slice(0, 3), viaTitle: titleHit.get(name) || false }));
}

// 高频功能词/常见词：仅在缺少称谓/高频/引文支撑时排除
const COMMON_NOISE = new Set([
  '一样', '一般', '自己', '什么', '怎么', '因为', '所以', '如果', '虽然', '但是', '可是', '只是', '还是', '就是', '已经',
  '现在', '时候', '然后', '后来', '原来', '其实', '终于', '突然', '以为', '知道', '觉得', '记得', '看见', '听见',
  '心里', '脸上', '手里', '眼前', '房间', '走廊', '声音', '有点', '有些', '有人', '别的', '的话', '似的', '接着',
  '跟着', '像是', '好像', '仿佛', '不过', '而且', '甚至', '一直', '一起', '一会', '一点', '一天', '一夜', '安静',
  '快乐', '生日', '祝福', '节日', '庆祝', '平安', '担心', '害怕', '喜欢', '讨厌', '离开', '进来', '出去', '回来',
  '过去', '手机', '电话', '消息', '微信', '聊天', '朋友', '同事', '老师', '同学', '保安', '直播', '现在', '那时',
  '偶尔', '总是', '常常', '刚才', '沉默', '回头', '抬头', '低头', '身上', '手上', '肩上', '桌上', '心里', '嘴里',
]);

function detectSpeakersFilter(detected, paragraphs) {
  const all = paragraphs.map((p) => p.text);
  return detected.filter((d) => {
    if (d.viaTitle) return !COMMON_NOISE.has(d.name) || d.count >= 2;
    const hits = all.reduce((n, t) => n + (t.includes(d.name) ? 1 : 0), 0);
    if (d.count >= 3) return true;
    if (COMMON_NOISE.has(d.name)) return false;
    if (d.count >= 2) return true;
    if (d.quotes.length && hits >= 3) return true;
    return false;
  });
}

function buildCharacters(proto, detected, paragraphs) {
  const chars = [];
  chars.push({
    id: proto.synthetic ? 'protagonist' : 'me',
    name: proto.name,
    role: 'protagonist',
    summary: proto.synthetic ? '故事的中心人物（mock：原文未出现明确的“我”，以主角代称）' : '故事的叙述者与中心人物',
    personality: ['敏锐', '重情', '有行动力'],
    motivation: '弄清眼前的异常，把故事推向自己想要的结局',
    catchphrase: '',
  });
  const roles = ['key_npc', 'antagonist', 'minor'];
  detected.forEach((d, i) => {
    const role = roles[Math.min(i, roles.length - 1)];
    const loc = paragraphs[d.firstPara - 1]?.text || '';
    chars.push({
      id: role === 'key_npc' ? 'npc_key' : role === 'antagonist' ? 'npc_shadow' : `npc_${i}`,
      name: d.name,
      role,
      summary: `出现在第 ${d.firstPara} 段：${clipSentence(firstSentence(loc), 40)}`,
      personality: role === 'key_npc' ? ['知情人', '克制'] : role === 'antagonist' ? ['偏执', '深藏不露'] : ['旁观者', '警觉'],
      motivation: role === 'key_npc' ? '（mock）掌握关键信息，是否告诉主角由信任决定' : role === 'antagonist' ? '（mock）阻止主角接近真相' : '（mock）被动卷入事件',
      catchphrase: d.quotes[0] ? clipSentence(d.quotes[0], 18) : '',
    });
  });
  return chars;
}

const PLACE_WORDS = ['直播间', '导播间', '播音室', '演播室', '录音室', '图书馆', '报刊室', '阅览室', '教室', '学校', '天台', '宿舍', '公寓', '医院', '病房', '办公室', '电梯', '地下室', '仓库', '车站', '地铁', '隧道', '老宅', '巷子', '街道', '便利店', '咖啡店', '走廊', '房间', '窗台', '河边', '树林'];
const KIND_OF = { 直播间: '室内', 导播间: '室内', 播音室: '室内', 演播室: '室内', 录音室: '室内', 图书馆: '室内', 报刊室: '室内', 阅览室: '室内', 教室: '室内', 学校: '室内', 天台: '室外', 宿舍: '室内', 公寓: '室内', 医院: '室内', 病房: '室内', 办公室: '室内', 电梯: '室内', 地下室: '室内', 仓库: '室内', 车站: '公共', 地铁: '公共', 隧道: '室外', 老宅: '室内', 巷子: '室外', 街道: '室外', 便利店: '室内', 咖啡店: '室内', 走廊: '室内', 房间: '室内', 窗台: '室内', 河边: '室外', 树林: '室外' };

function detectLocations(paragraphs) {
  const found = [];
  for (let i = 0; i < paragraphs.length && found.length < 5; i++) {
    const t = paragraphs[i].text;
    for (const w of PLACE_WORDS) {
      if (found.some((f) => f.name === w)) continue;
      // 只在引号之外的正文里找地点（避免把人物台词里的词当场景）
      let idx = -1;
      while ((idx = t.indexOf(w, idx + 1)) >= 0) {
        const before = t.slice(0, idx);
        const q = (before.match(/[“”「」]/g) || []).length;
        if (q % 2 === 0) break; // 不在引号内
      }
      if (idx < 0) continue;
      const s = sentencesOf(t).find((x) => x.includes(w)) || t;
      found.push({
        id: `loc_${found.length + 1}`,
        name: w,
        kind: KIND_OF[w] || '场景',
        description: clipSentence(s, 50),
      });
    }
  }
  if (!found.length) {
    found.push({ id: 'loc_1', name: '事发之地', kind: '未知', description: '（原文未明确描写具体地点，真实模式补全）' });
  }
  return found;
}

function detectRules(text, tags) {
  const rules = [];
  const t = String(text || '');
  const add = (r) => {
    if (!rules.some((x) => x.id === r.id)) rules.push(r);
  };
  if (/(时间|循环|回到|重来|同一天|倒带|预知)/.test(t)) {
    add({ id: 'time', rule: '（mock）故事里存在时间异常：某些时刻会重来或倒带，触发条件与代价由原著设定。' });
  }
  if ((t.match(/门/g) || []).length >= 2) {
    add({ id: 'door', rule: '（mock）「那扇门」是连接两个时间/地点的枢纽：推开即离开当前现实，何时出现、向谁出现皆有讲究。' });
  }
  const limit = /([^。！？\n]{2,50}(?:千万|千万不|不能|禁止|千万别|只能|永远别)[^。！？]{0,40})/.exec(t);
  if (limit) add({ id: 'limit', rule: `（mock）原著明示的限制：${clip(limit[1].trim(), 80)}` });
  if (/(系统|副本|无限流|任务|积分|规则怪谈)/.test(t)) add({ id: 'system', rule: '（mock）故事带有“无限流/系统”设定，规则类内容以原著为准。' });
  if (!rules.length) add({ id: 'none', rule: '（mock）本故事未明写超自然规则——冲突主要来自人物与选择。' });
  return rules.slice(0, 3);
}

function detectHooks(paragraphs) {
  const hooks = [];
  const MARK = /(奇怪|不对劲|却|竟然|仿佛|好像|难道|记得|总觉得|传说|消失|半枚|泛黄|旧|重复|不对劲|偏偏)/;
  for (let i = 0; i < paragraphs.length && hooks.length < 3; i++) {
    const p = paragraphs[i];
    if (!MARK.test(p.text)) continue;
    if (hooks.some((h) => h.plantedAt === `第 ${i + 1} 段`)) continue;
    hooks.push({
      id: `p${i + 1}`,
      description: clipSentence(firstSentence(p.text), 70),
      plantedAt: `第 ${i + 1} 段`,
      payoffHint: '',
    });
  }
  return hooks;
}

// ---------------- mock design（蓝图） ----------------
// 输出与真实模式相同的 structure.json；保证通过 validateStructure。
export function mockDesign(raw, analysis) {
  const paras = raw.paragraphs || [];
  const N = paras.length;
  const nonProto = analysis.characters.filter((c) => c.role !== 'protagonist');
  const npcIds = nonProto.slice(0, 4).map((c) => c.id);
  const chatNpcId = npcIds[0];
  // 关键发现 → 线索变量（审讯获得，门控隐藏结局）
  const critical = (analysis.discoveries || []).filter((d) => d && d.criticalForClimax);
  const clueVar = critical.length ? `clue_${String(critical[0].id).replace(/[^A-Za-z0-9_]/g, '_')}` : null;
  const clueSet = clueVar ? { [clueVar]: 'found' } : {};
  const ruleLoreIds = (analysis.worldRules || []).map((r) => `rule-${r.id}`);
  const hookLoreIds = (analysis.foreshadowing || []).map((f) => `hook-${f.id}`);

  const minimal = N <= 4;
  const reserved = minimal ? (N >= 3 ? 1 : 0) : 2; // 留给“原著结局”的段数
  const spineN = Math.max(0, N - reserved);

  // —— 段落分配 ——
  const chunk = (a, b) => [a, b];
  const ranges = [];
  if (minimal) {
    for (let i = 1; i <= spineN; i++) ranges.push(chunk(i, i));
    if (ranges.length === 0) ranges.push(chunk(1, N)); // N=0 理论上不会发生
    if (N === 1) ranges.push(chunk(1, 1)); // 兜底填充：真实故事不会只有 1 段
  } else {
    // 从 1 走到 spineN，每块至多 c 段（最后一块收尾），保证不越界、不重叠
    const c = Math.max(1, Math.ceil(spineN / Math.min(5, spineN)));
    let start = 1;
    while (start <= spineN) {
      const end = Math.min(start + c - 1, spineN);
      ranges.push(chunk(start, end));
      start = end + 1;
    }
  }

  const novelIds = ranges.map((_, i) => `n${i + 1}`);
  const novels = ranges.map((r, i) => makeNovel(novelIds[i], r, paras));
  const mainEndRange = reserved > 0 ? chunk(spineN + 1, N) : null;

  // —— 统一的链式编排（对任意 novel 数量 m≥2 都成立） ——
  // 规则：novel 顺序成链；第 jMid 个 novel 之后挂 choice_mid（继续→下一 novel，退→e_bad）；
  //       最后一个 novel 之后挂 chat（→ choice_final）；choice_final 分叉到三个结局。
  const eMeta = endingMeta(analysis);
  const m = novelIds.length;
  const jMid = m >= 3 ? Math.floor(m / 2) : 1;
  const chatNpc = nonProto.find((c) => c.id === chatNpcId) || nonProto[0];

  // novel 链
  for (let i = 0; i < m; i++) {
    const sc = novels[i];
    if (i + 1 === jMid) sc.next = 'choice_mid';
    else if (i === m - 1) sc.next = `chat_${chatNpcId}`;
    else sc.next = novelIds[i + 1];
  }
  // choice_mid：两难（继续 vs 抽身，退即通往“过早放手”结局）
  const choiceMid = {
    id: 'choice_mid', type: 'choice', chapter: '岔路口', paragraphRange: null,
    purpose: '中途第一个两难抉择：继续深入 vs 抽身而退（退即通往“过早放手”结局）',
    narrative: '写主角站在岔路口的迟疑：继续要承担后果，退开则可能永远错过真相。',
    lore: ruleLoreIds.slice(0, 1),
    choices: [
      { text: '继续往前走。就算前面等着我的不是答案，我也要亲眼看看。', next: novelIds[jMid] /* jMid 是 1-based：下一段在 index jMid */, set: { approach: '正面' } },
      { text: '退一步。有些门，推开就回不了头——我先保住现在有的。', next: 'e_bad', set: { approach: '退场' } },
    ],
  };
  // chat 场景：与关键 NPC 对话，两个回应都 set trust_xxx（影响最终抉择的语境）
  const chatScene = {
    id: `chat_${chatNpcId}`, type: 'chat', chapter: `与${chatNpc.name}交谈`, paragraphRange: null,
    npc: chatNpcId,
    goal: `从${chatNpc.name}口中问出关于「${analysis.locations[0]?.name || '那扇门'}」的关键线索，并判断该信他几分`,
    purpose: '与关键 NPC 对话：索取线索/建立信任',
    narrative: '环境描写 + NPC 的开场白；玩家要决定提问方式（直问或试探）。',
    lore: hookLoreIds.slice(0, 1),
    choices: [
      { text: `直问${chatNpc.name}：“你究竟知道多少？”`, next: 'choice_final', set: { [`trust_${chatNpcId}`]: '直问', ...clueSet } },
      { text: `先不急着问，陪${chatNpc.name}说几句别的，让他放下戒心。`, next: 'choice_final', set: { [`trust_${chatNpcId}`]: '试探', ...clueSet } },
    ],
  };
  // choice_final：收束，走向三种结局
  const choiceFinal = {
    id: 'choice_final', type: 'choice', chapter: '最后一扇门', paragraphRange: null,
    purpose: '收束前把所有累积的选择摊到桌面上，走向不同结局',
    narrative: '所有线索在此汇合：按原著走、相信伏笔走另一条路、或被执念吞没。',
    lore: hookLoreIds.slice(-1),
    choices: [
      { text: '照我一直以来的判断走——让故事按它本来的样子收场。', next: 'e_main', set: { ending: 'main' } },
      {
        text: '不。我忽然想通了那个一直说不通的细节——我要改写结局。', next: 'e_secret', set: { ending: 'secret' },
        ...(clueVar ? { requires: { [clueVar]: 'found' }, lockedHint: '还缺关键线索——先把那个说不通的细节问清楚' } : {}),
      },
      { text: '我不甘心。门一定还藏着更多秘密——再试一次。', next: 'e_dark', set: { ending: 'dark' } },
    ],
  };
  const endingScenes = [
    endScene('e_bad', eMeta.e_bad),
    endScene('e_main', eMeta.e_main, mainEndRange),
    endScene('e_secret', eMeta.e_secret),
    endScene('e_dark', eMeta.e_dark),
  ];
  const scenes = [...novels, choiceMid, chatScene, choiceFinal, ...endingScenes];

  // 结构校验前的自检
  const structure = {
    schema: 'kanshan/structure/1',
    storyId: raw.storyId,
    title: analysis.title,
    premise: `在「${analysis.locations[0]?.name || '那扇门'}」面前，选择相信别人给出的解释，还是相信自己的直觉——而无论怎么选，都要有人承担代价。`,
    tags: analysis.tags,
    variables: [
      { name: 'approach', meaning: '中途抉择的方向', values: ['正面', '退场'] },
      ...npcIds.slice(0, 2).map((id) => ({ name: `trust_${id}`, meaning: `对 ${id} 的信任方式`, values: ['直问', '试探'] })),
      { name: 'ending', meaning: '最终走向的结局', values: ['main', 'secret', 'dark'] },
      ...(clueVar ? [{ name: clueVar, meaning: `关键线索：${clip(String(critical[0].content), 18)}`, values: ['found'] }] : []),
    ],
    scenes,
    endings: endingScenes.map((s) => ({ id: s.id, title: eMeta[s.id].title, tone: eMeta[s.id].tone, summary: eMeta[s.id].summary })),
    npcs: nonProto.slice(0, 4).map((c) => ({
      id: c.id,
      notes: c.role === 'key_npc' ? '关键 NPC：可对话，掌握线索' : c.role === 'antagonist' ? '对立角色：若可对话，需要攻心' : '次要角色',
      chatScene: c.id === chatNpcId ? `chat_${c.id}` : null,
      appearsIn: appearsInFor(c.name, paras, scenes),
    })),
  };
  return structure;
}

function makeNovel(id, [a, b], paras) {
  const head = paras[a - 1]?.text || '';
  const tail = paras[b - 1]?.text || '';
  return {
    id, type: 'novel', chapter: '', paragraphRange: [a, b],
    purpose: `展示原著段落 ${a}–${b}`,
    narrative: `沿用原著段落 ${a}–${b} 的描写与对话，第一人称视角顺承（mock 不做改写）。`,
    lore: [],
    next: '',
  };
}

function endScene(id, meta, range = null) {
  return {
    id, type: 'ending', chapter: `结局 · ${meta.title}`, paragraphRange: range,
    purpose: `${meta.title}（${meta.tone}）`,
    narrative: meta.narrative,
    lore: [],
  };
}

function endingMeta() {
  return {
    e_bad: { id: 'e_bad', title: '抽身而退', tone: '遗憾', summary: '主角中途退开，那扇门再也没有打开；故事停在“如果当时”。', narrative: '遗憾收束：选择安全，等于放弃答案。' },
    e_main: { id: 'e_main', title: '原著结局', tone: '平静', summary: '遵循原著走向的结局。', narrative: '自然复用原著结尾段落（已在 paragraphRange 保留），第一人称收尾。' },
    e_secret: { id: 'e_secret', title: '门后的另一天', tone: '温暖', summary: '想通伏笔后走出的隐藏结局。', narrative: '呼应分析里抽出的伏笔/异常细节，让主角改变关键一步。' },
    e_dark: { id: 'e_dark', title: '循环里的人', tone: '惊悚', summary: '执念让主角反复试探那扇门，最终没能回来。', narrative: '惊悚收束：追逐确定答案的代价。' },
  };
}

function appearsInFor(name, paras, scenes) {
  const idx = paras.findIndex((p) => p.text.includes(name));
  if (idx < 0) return [];
  const paraNo = idx + 1;
  const hit = scenes.find((s) => s.paragraphRange && paraNo >= s.paragraphRange[0] && paraNo <= s.paragraphRange[1]);
  return hit ? [hit.id] : [];
}

// ---------------- mock compile（正文 / NPC 卡 / 结局 / 刘看山） ----------------
export function mockSceneTexts(raw, analysis, structure) {
  const byId = new Map(structure.scenes.map((s) => [s.id, s]));
  const npcName = new Map(analysis.characters.map((c) => [c.id, c.name]));
  const paras = raw.paragraphs || [];
  const out = new Map();
  for (const sc of structure.scenes) {
    const base = byId.get(sc.id);
    if (sc.type === 'novel') {
      const text = (sc.paragraphRange ? paras.slice(sc.paragraphRange[0] - 1, sc.paragraphRange[1]).map((p) => p.text) : []).join('\n\n');
      out.set(sc.id, { text, chapter: mockChapter(text) });
    } else if (sc.type === 'choice') {
      out.set(sc.id, { text: mockChoiceText(sc.id, sc.choices, analysis), chapter: sc.chapter || '抉择' });
    } else if (sc.type === 'chat') {
      const name = npcName.get(sc.npc) || sc.npc;
      const firstMes = mockFirstMes(analysis, sc.npc, name);
      const place = analysis.locations[0]?.name || '老地方';
      out.set(sc.id, {
        text: `你在${place}见到了${name}。\n\n${name}看了你一眼，像是早就料到你会来：\n\n> ${firstMes}`,
        chapter: sc.chapter || `与${name}交谈`,
      });
    } else {
      out.set(sc.id, { text: '', chapter: sc.chapter || '' }); // ending 在结局生成里补
    }
  }
  return out;
}

export function mockEndingTexts(raw, analysis, structure, sceneTexts) {
  const byId = new Map(structure.scenes.map((s) => [s.id, s]));
  const paras = raw.paragraphs || [];
  const titles = new Map(structure.endings.map((e) => [e.id, e]));
  const npcName = analysis.characters.filter((c) => c.role !== 'protagonist').map((c) => c.name);
  const hookChar = npcName[1] || npcName[0] || '那个人';
  const hint = (analysis.foreshadowing || []).slice(0, 1).map((f) => clip(f.description, 60))[0] || '';
  const motif = motifWord(paras.map((p) => p.text).join('\n'));

  const meta = {
    e_main: () => {
      const sc = byId.get('e_main');
      const original = sc?.paragraphRange ? paras.slice(sc.paragraphRange[0] - 1, sc.paragraphRange[1]).map((p) => p.text).join('\n\n') : '';
      const lead = '我沿着来时的路，走完了最后一段。';
      return original ? `${lead}\n\n${original}` : `${lead}\n\n故事在这里落下句点。${motif}再也没有出现过——但我知道，它一直在那里。`;
    },
    e_secret: () => {
      const flavor = hint ? `\n\n有件事一直在我心里硌着，说不通——${hint.replace(/[。！？!?…\s]+$/, '')}。` : '';
      return `我在最后一刻停住了。${flavor}\n\n${hookChar}说过的那些话在我脑子里重新拼了一遍——它们从来不是巧合。我转身，没有走向既定的结局，而是沿着被我忽略的那条路，把故事里最疼的那个结，轻轻解开了。\n\n风平浪静之后，被改变的不只是我的结局。`;
    },
    e_dark: () => {
      return `我不甘心。答案一定还藏在某处——我一遍遍尝试，一遍遍回到同一个原点。${motif}每次出现都更远一些、更模糊一些，像一条耐心耗尽的迷宫。\n\n最后一次，它没有再出现。\n\n后来的日子里，我总在深夜惊醒，觉得自己还欠那个故事一个答案。`;
    },
    e_bad: () => {
      return `我最终退开了。\n\n${motif}在我身后悄无声息地退远，生活照旧。只是我总在深夜惊醒，想起自己转身的那一刻，还有那个没能问出口的问题。\n\n有些问题，不问，就没有答案。`;
    },
  };
  for (const e of structure.endings) {
    const text = (meta[e.id] || meta.e_main)();
    sceneTexts.set(e.id, { text, chapter: `结局 · ${titles.get(e.id)?.title || e.id}` });
  }
}

function motifWord(fullText) {
  const order = [
    [/门/g, '那扇门'],
    [/电梯/g, '那部电梯'],
    [/录音|磁带/g, '那卷录音'],
    [/电话|来电|手机/g, '那个来电'],
    [/隧道|地铁|列车|火车/g, '那趟列车'],
    [/房间|走廊|楼梯|老宅/g, '那个地方'],
  ];
  for (const [re, word] of order) if (re.test(fullText)) return word;
  return '那件事';
}

export function mockNpcCards(analysis, structure, sceneTexts) {
  const chars = new Map(analysis.characters.map((c) => [c.id, c]));
  const scenes = new Map(structure.scenes.map((s) => [s.id, s]));
  const out = [];
  for (const n of structure.npcs) {
    const c = chars.get(n.id);
    if (!c) continue;
    const chatSceneId = n.chatScene || scenes.size && [...scenes.values()].find((s) => s.type === 'chat' && s.npc === n.id)?.id;
    const where = chatSceneId ? `此刻你们在${chatSceneId}对应的场景相遇` : '在故事中与你相遇';
    const scenario = `故事当前进行到：${n.notes}。${where}。`;
    const firstMes = mockFirstMes(analysis, n.id, c.name);
    const quotes = c.catchphrase ? [c.catchphrase] : [];
    const mesExample = quotes.length
      ? quotes.slice(0, 3).map((q) => `${c.name}：“${q}”`).join('\n')
      : `${c.name}：“……你果然会来找我。”\n${c.name}：“这话我只说一遍，信不信由你。”`;
    const personality = (c.personality || []).join('、') || '（原著性格标签待真实模式补全）';
    out.push({
      id: n.id,
      name: c.name,
      card: {
        description: `《${analysis.title}》中的${c.name}：${c.summary}`,
        personality,
        scenario,
        first_mes: firstMes,
        mes_example: mesExample,
        system_prompt: npcSystemPrompt(analysis.title, c.name, personality, c.catchphrase || ''),
      },
    });
  }
  return out;
}

function mockFirstMes(analysis, npcId, name) {
  const c = (analysis.characters || []).find((x) => x.id === npcId);
  const q = c?.catchphrase;
  if (q) return q;
  const place = analysis.locations[0]?.name || '这里';
  return `你来了。我在${place}等你很久了——有些话，只能现在说。`;
}

export function npcSystemPrompt(title, name, personality, catchphrase) {
  const lines = [
    `你是《${title}》里的${name}，一个活在故事里的角色，不是 AI、不是程序、也不是任何模型。`,
    `你的人设：${personality}${catchphrase ? `；口头禅/说话习惯：${catchphrase}` : ''}。`,
    `回答规则：`,
    `1. 不脱离原著人设，用 ${name} 的口吻说话，贴合故事的时代与氛围；`,
    `2. 不剧透尚未发生的剧情，不主动揭露伏笔与结局；玩家试探或逼问时，用符合角色的方式回避、反问或转移话题；`,
    `3. 不承认自己是 AI，不讨论现实世界、模型或本游戏；`,
    `4. 回答保持中文、口语化、有镜头感，一般 2–4 句，别长篇大论。`,
  ];
  return lines.join('\n');
}

export function mockKanshan(analysis) {
  const t = analysis.title;
  return {
    intro: `夜深了，你刚读完《${t}》的最后一页，意犹未尽。合上屏幕的一瞬，房间里的灯暗了一秒——再亮起时，门边多了一道湖绿色的光。\n\n刘看山从光里探出脑袋，尾巴一甩：「这是看山任意门。故事还没真正结束——这一次，得由你亲自走进去。」`,
    rescueLines: [
      '卡住了？退一步，海阔天空——故事的路从来不止一条。',
      '线索断了别慌，跟着你最先动心的那个细节走。',
      '放心，我不剧透。但方向，我记得。',
      '拿不定主意的时候，就选那个让你心跳加速的。',
    ],
  };
}

function mockChoiceText(id, choices, analysis) {
  if (id === 'choice_mid') {
    return '我停下脚步。走廊尽头的风很凉，像是故事本身在等一个决定。\n\n继续，可能会揭开我承受不起的真相；退开，那扇门大概再也不会为我打开。';
  }
  if (id === 'choice_final') {
    return '所有的线索、所有的试探，都在这一刻汇到眼前。我握紧手心里的东西，知道接下来的三秒，会决定我走出这扇门时，身上带着哪一段人生。';
  }
  return '我站在原地，做了决定。';
}

function mockChapter(text) {
  const s = firstSentence(text).replace(/[“”「」]/g, '');
  if (!s) return '序';
  return clip(s, 12);
}
