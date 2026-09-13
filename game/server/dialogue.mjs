// Compiled topics own facts and state. Model text is presentation only.
const clueId = (value) => typeof value === 'string' && /^clue_[A-Za-z0-9_]+$/.test(value);
const normalize = (value) => String(value || '').normalize('NFKC').toLocaleLowerCase().replace(/\s+/g, '');

export function planDialogue(scene, { topicId, text = '', cluesFound = [] } = {}) {
  const known = new Set(Array.isArray(cluesFound) ? cluesFound.filter(clueId) : []);
  const topics = Array.isArray(scene.dialogue?.topics) ? scene.dialogue.topics : [];
  // An explicit unknown id cannot silently select a different topic by keyword.
  const topic = topicId !== undefined
    ? topics.find((entry) => entry.id === topicId)
    : topics.find((entry) => (entry.keywords || []).some((word) => normalize(word) && normalize(text).includes(normalize(word))));
  const requirements = Object.entries(topic?.requires || {});
  const unlocked = !!topic && requirements.every(([id, value]) => clueId(id) && value === 'found' && known.has(id));
  const registered = unlocked && typeof topic.reply === 'string' && topic.reply.trim()
    ? [...new Set((Array.isArray(topic.grants) ? topic.grants : []).filter(clueId))] : [];
  const clues = registered.filter((id) => !known.has(id));
  const allKnown = new Set([...known, ...clues]);
  const required = scene.dialogue?.requiredClues;
  const goalAchieved = Array.isArray(required) && required.every((id) => clueId(id) && allKnown.has(id));
  return {
    topic: topic || null,
    blocked: !!topic && !unlocked,
    clues,
    goalAchieved,
    testimony: unlocked && typeof topic.reply === 'string' && topic.reply.trim()
      ? { topicId: topic.id, text: topic.reply.trim(), clues: registered } : undefined,
  };
}

export function finishDialogue(plan, { reply, mode = 'ai', reason } = {}) {
  const scripted = mode === 'scripted';
  const fallback = plan.blocked
    ? '这件事还需要你先查到相关线索。回到调查现场核实后，再来问我。'
    : plan.testimony?.text || '现在暂时无法自由接话。你仍可点击上方的询问主题，获取证言并完成调查；也可以返回现场继续查找。';
  return {
    reply: scripted ? fallback : (typeof reply === 'string' ? reply.trim() : ''),
    mode: scripted ? 'scripted' : 'ai',
    goalAchieved: plan.goalAchieved,
    clues: [...plan.clues],
    ...(plan.testimony ? { testimony: plan.testimony } : {}),
    ...(reason ? { reason } : {}),
  };
}

export function dialogueInstruction(plan) {
  if (!plan.testimony) return '【本轮自由交谈】本轮没有匹配已编译的证言主题。只能按当前处境与世界观自由回应；不得编造案件事实、声称发现或授予线索、宣告目标达成。对未知事件明确表示不知道。';
  return `【本轮已核定证言】${JSON.stringify({ topicId: plan.testimony.topicId, testimony: plan.testimony.text })}\n你只能润色这份证言的措辞和角色语气，不得新增事实、改动含义、推断凶手或结果。规范证言会由系统单独呈现给玩家；你的输出不能授予线索或改变进度。`;
}
