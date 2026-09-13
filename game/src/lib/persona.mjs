// Deterministic chapter-end persona rules. Only authored choices that appear in
// the current run may affect the three primary axes; exploration counts do not.

export const PERSONAS = Object.freeze({
  FIRE: Object.freeze({
    code: 'FIRE', name: '热榜点火器', route: '证物 · 追击 · 公开',
    roast: '你不是来围观热榜的，你是来给热榜安排加班的。',
    praise: '你敢发声，但不是空手冲锋；你希望问题进入公共核验。',
    asset: '/art/character/motion/liu-kanshan-basketball.gif',
  }),
  ANON: Object.freeze({
    code: 'ANON', name: '匿名拆弹员', route: '证物 · 追击 · 隐蔽',
    roast: '线索可以实名，调查员暂时不必。',
    praise: '你推进得很快，也知道先把证据安全带回来比抢镜重要。',
    asset: '/art/character/motion/liu-kanshan-stroll.gif',
  }),
  CLEAN: Object.freeze({
    code: 'CLEAN', name: '证据洁癖', route: '证物 · 克制 · 公开',
    roast: '没有来源的消息，到你这里连八卦都算不上。',
    praise: '你愿意公开问题，也拒绝替证据说它没说过的话。',
    asset: '/art/character/motion/liu-kanshan-computer.gif',
  }),
  CTRL: Object.freeze({
    code: 'CTRL', name: '草稿保险柜', route: '证物 · 克制 · 隐蔽',
    roast: '能说的写结论，不能说的连冲动一起存草稿。',
    praise: '你不急着抢答，但会把材料和判断边界一起保存好。',
    asset: '/art/character/motion/liu-kanshan-sleepy.gif',
  }),
  ECHO: Object.freeze({
    code: 'ECHO', name: '证词扩音器', route: '人证 · 追击 · 公开',
    roast: '别人刚说完悄悄话，你已经替它配好了热榜标题。',
    praise: '你擅长让被忽略的声音进入讨论，也愿意继续追问。',
    asset: '/art/character/motion/liu-kanshan-wave.gif',
  }),
  ASKR: Object.freeze({
    code: 'ASKR', name: '私信永动机', route: '人证 · 追击 · 隐蔽',
    roast: '别人说“没事”，你已经在私信里问到了第三幕。',
    praise: '你知道第一句话很少是完整答案，也懂得保护谈话空间。',
    asset: '/art/character/motion/liu-kanshan-computer.gif',
  }),
  FAIR: Object.freeze({
    code: 'FAIR', name: '人话公证员', route: '人证 · 克制 · 公开',
    roast: '负责把评论区的人话翻译成人话，并附上出处。',
    praise: '你让不同立场被听见，也替每句话保留它原本的边界。',
    asset: '/art/character/motion/liu-kanshan-idle.gif',
  }),
  FEEL: Object.freeze({
    code: 'FEEL', name: '人情线雷达', route: '人证 · 克制 · 隐蔽',
    roast: '案子还没破，证人已经愿意把真话留给你了。',
    praise: '你记得每条证词后面站着一个人，也愿意给关系留余地。',
    asset: '/art/character/motion/liu-kanshan-sleepy.gif',
  }),
});

const PERSONA_BY_ROUTE = Object.freeze({
  'evidence|push|public': 'FIRE',
  'evidence|push|private': 'ANON',
  'evidence|restrain|public': 'CLEAN',
  'evidence|restrain|private': 'CTRL',
  'testimony|push|public': 'ECHO',
  'testimony|push|private': 'ASKR',
  'testimony|restrain|public': 'FAIR',
  'testimony|restrain|private': 'FEEL',
});

const AXIS_COPY = Object.freeze({
  source: {
    evidence: '关键选择更常先核对材料，再形成判断',
    testimony: '关键选择更常从当事人的说法继续推进',
  },
  pace: {
    push: '遇到矛盾时，你更常选择继续追问或行动',
    restrain: '证据未齐时，你更常收窄说法并保留余地',
  },
  voice: {
    public: '准备发声时，你倾向把可核验部分带到公开场',
    private: '准备发声时，你倾向先控制公开范围与身份暴露',
  },
});

const TEXT_SIGNALS = Object.freeze({
  source: {
    positive: ['证据', '记录', '核对', '查', '题型', '卷', '报告', '网页', '事实', '假说', '材料', '线索', '检索', '编号', '指纹', '试剂', '时间线', '差别', '备忘录'],
    negative: ['问她', '问他', '告诉她', '告诉他', '听见', '听清', '关系', '情绪', '姐姐', '妹妹', '师父', '猴哥', '老君', '关心', '证词', '当事人'],
  },
  pace: {
    positive: ['继续追', '追问', '逼近', '摊牌', '对质', '再查', '重开', '维护', '闯', '不放', '公开', '发出去', '说出推断', '明确'],
    negative: ['暂时', '先停', '停下', '收窄', '保留余地', '退回', '退半步', '放缓', '轻轻', '不急', '不回', '删掉', '离开', '收束', '拒绝'],
  },
  voice: {
    positive: ['公开', '发出去', '回帖', '当众', '举手', '告诉', '说出', '摊牌', '维护', '质问'],
    negative: ['匿名', '隐去身份', '草稿', '离线', '私信', '不回', '不发', '藏', '悄悄', '暂时收回', '只留下', '保留', '扣在桌上', '退回'],
  },
});

const normalize = (value) => String(value ?? '').normalize('NFKC').toLocaleLowerCase('zh-CN');
const hits = (text, list) => list.reduce((count, token) => count + (text.includes(token) ? 1 : 0), 0);

function explicitChoiceSignals(choice) {
  const raw = choice?.personaSignals;
  if (!raw || typeof raw !== 'object') return [];
  const signals = [];
  for (const [side, axis, sign] of [
    ['evidence', 'source', 1], ['testimony', 'source', -1],
    ['push', 'pace', 1], ['restrain', 'pace', -1],
    ['public', 'voice', 1], ['private', 'voice', -1],
  ]) {
    const amount = Number(raw[side]);
    if (Number.isFinite(amount) && amount > 0) signals.push({ axis, value: sign * amount, origin: 'explicit' });
  }
  return signals;
}

function setSignals(choice) {
  const set = choice?.set || {};
  const signals = [];
  const add = (axis, value) => signals.push({ axis, value, origin: 'compat' });
  for (const [key, rawValue] of Object.entries(set)) {
    const value = normalize(rawValue);
    if (key === 'persona_source') add('source', value === 'testimony' ? -4 : value === 'evidence' ? 4 : 0);
    if (key === 'persona_pace') add('pace', value === 'push' ? 4 : value === 'restrain' ? -4 : 0);
    if (key === 'persona_voice') add('voice', value === 'public' ? 4 : value === 'private' ? -4 : 0);

    if (key.startsWith('trust_')) add('source', ['high', 'rely', '1', '2'].includes(value) ? -2 : ['low', 'reserved', '0'].includes(value) ? 2 : 0);
    if (['relation_lin', 'relation_chen', 'terms_zhao', 'my_door_tone', 'care'].includes(key)) add('source', -2);
    if (key === 'exam_approach' || key === 'post_record' || key === 'pursue_songye' || key === 'leads_to') add('source', 2);
    if (key === 'final_stance') {
      if (value === 'protect') { add('source', -2); add('pace', 3); add('voice', 3); }
      if (value === 'calm') { add('source', -2); add('pace', -2); add('voice', -2); }
      if (value === 'distance' || value === 'guard') { add('source', -1); add('pace', -3); add('voice', -3); }
      if (value === 'reopen') { add('source', 2); add('pace', 3); add('voice', -1); }
      if (value === 'accept') { add('source', -2); add('pace', -1); add('voice', -1); }
    }
    if (key === 'resolve') {
      if (value === 'expose') { add('pace', 3); add('voice', 4); }
      if (value === 'seek') { add('source', 2); add('pace', 2); add('voice', -3); }
      if (value === 'connection') { add('source', -3); add('pace', -1); add('voice', -2); }
      if (value === 'pause' || value === 'shaken') { add('pace', -3); add('voice', -3); }
      if (value === 'steady') add('pace', 2);
    }
    if (key === 'pursue_songye') { add('pace', value === 'yes' ? 3 : -3); add('voice', -1); }
    if (key === 'tell_truth') { add('source', -2); add('pace', value === 'full' ? 2 : -1); add('voice', value === 'full' ? 2 : -2); }
    if (key === 'post_record') { add('pace', -1); add('voice', -3); }
    if (key === 'exam_approach') { add('pace', value === 'question' ? 2 : -1); add('voice', value === 'question' ? 2 : -2); }
    if (key === 'route') {
      if (value === 'public') { add('pace', 3); add('voice', 4); }
      if (['leave', 'retreat', 'nanhai_first'].includes(value)) { add('pace', -2); add('voice', -2); }
      if (value === 'lingshan_rash') add('pace', 3);
    }
    if (key === 'self_honesty') {
      if (value === 'confess') { add('pace', 2); add('voice', 3); }
      if (value === 'rationalize' || value === 'dream') { add('pace', -2); add('voice', -2); }
    }
    if (key === 'relation_lin' || key === 'relation_chen') {
      add('pace', ['longing', 'bargain'].includes(value) ? 2 : -1);
      add('voice', -1);
    }
    if (key === 'terms_zhao') {
      add('pace', value === 'explicit' ? 2 : -2);
      add('voice', value === 'explicit' ? 1 : -1);
    }
    if (key === '去留') { add('pace', value === '留下' ? 2 : -2); add('voice', -1); }
    if (key === '心') add('pace', value === '豪赌' ? 2 : -2);
  }
  return signals.filter((signal) => signal.value !== 0);
}

function textSignals(choice) {
  const text = normalize(choice?.text);
  const signals = [];
  for (const axis of ['source', 'pace', 'voice']) {
    const positive = hits(text, TEXT_SIGNALS[axis].positive);
    const negative = hits(text, TEXT_SIGNALS[axis].negative);
    if (positive !== negative) signals.push({ axis, value: Math.sign(positive - negative), origin: 'compat' });
  }
  return signals;
}

function findChoice(story, entry) {
  const scene = story?.scenes?.find((candidate) => candidate.id === entry.sceneId);
  return scene?.choices?.find((choice) => choice.text === entry.text) || null;
}

function summarizeAxes(axes) {
  return [AXIS_COPY.source[axes.source], AXIS_COPY.pace[axes.pace], AXIS_COPY.voice[axes.voice]];
}

export function derivePersona(story, vars = {}, memo = []) {
  const totals = { source: 0, pace: 0, voice: 0 };
  const last = { source: 0, pace: 0, voice: 0 };
  const basis = { source: [], pace: [], voice: [] };
  const origins = new Set();
  let matchedChoices = 0;

  for (const entry of memo) {
    if (entry?.kind !== 'choice') continue;
    const choice = findChoice(story, entry);
    if (!choice) continue;
    matchedChoices += 1;
    const explicit = explicitChoiceSignals(choice);
    const structured = setSignals(choice);
    const semantic = textSignals(choice);
    const seen = new Set();
    for (const signal of [...explicit, ...structured, ...semantic]) {
      if (seen.has(signal.axis)) continue;
      seen.add(signal.axis);
      totals[signal.axis] += signal.value;
      last[signal.axis] = signal.value;
      basis[signal.axis].push({ sceneId: entry.sceneId, choiceId: choice.id, text: choice.text });
      origins.add(signal.origin);
    }
  }

  // Old saves can lose their memo tail. Only final vars that were authored by a
  // choice are used as a compatibility signal; clue and exploration vars are ignored.
  if (Object.values(totals).some((value) => value === 0)) {
    const virtualChoice = { text: '', set: vars };
    for (const signal of setSignals(virtualChoice)) {
      if (totals[signal.axis] !== 0) continue;
      totals[signal.axis] += signal.value;
      last[signal.axis] = signal.value;
      origins.add('compat');
    }
  }

  const unresolved = Object.entries(totals).filter(([, value]) => value === 0).map(([axis]) => axis);
  const signed = (axis) => totals[axis] || last[axis] || -1;
  const axes = {
    source: signed('source') > 0 ? 'evidence' : 'testimony',
    pace: signed('pace') > 0 ? 'push' : 'restrain',
    voice: signed('voice') > 0 ? 'public' : 'private',
  };
  const code = PERSONA_BY_ROUTE[`${axes.source}|${axes.pace}|${axes.voice}`];
  const persona = PERSONAS[code];
  return {
    ...persona,
    axes,
    proofLines: summarizeAxes(axes),
    basis,
    matchedChoices,
    unresolved,
    confidence: unresolved.length ? 'provisional' : origins.has('compat') ? 'compat' : 'explicit',
  };
}

export function buildPersonaShareUrl(storyId, personaCode, baseHref) {
  const href = baseHref || (typeof window !== 'undefined' ? window.location.href : 'https://kanshan.makebook.hk2048.online/');
  const url = new URL(href);
  url.hash = '';
  url.search = '';
  url.searchParams.set('story', storyId);
  url.searchParams.set('from', 'persona-card');
  url.searchParams.set('persona', personaCode);
  return url.toString();
}
