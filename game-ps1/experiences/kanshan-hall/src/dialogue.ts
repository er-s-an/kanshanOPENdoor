/**
 * 看山任意门 · hall dialogue data.
 *
 * ⚠️ DRAFT — 以下台词均为初稿，待用户审阅（语气按「看山式」要求起草：
 * 亲切、松弛、偶尔皮一下、有知识分子的冷幽默）。文本定稿前请勿视作最终文案。
 *
 * All lines are subtitle-only (no voice). Keyed by story beat; scene.ts
 * renders 看山's lines as a DOM bubble above his head (falling back to the
 * HUD subtitle when he is off-camera or too far away).
 */

export type DialogueBeat =
  | 'peek'
  | 'greet'
  | 'intro'
  | 'guide'
  | 'open.duanfei'
  | 'open.blue-blood'
  | 'open.myopia'
  | 'seeoff'
  | 'return';

export const DIALOGUE: Record<DialogueBeat, string> = {
  peek: '……来啦？',
  greet: '来啦？欢迎。我是刘看山——这片地方的看门人，也算是向导。',
  intro: '这里是所有故事的中转站。看到那三扇门了吗？每扇后面，都是一个世界。',
  guide: '想去哪个，走过去就行。门我来开——开锁这件事，我略懂。',
  'open.duanfei': '端妃的世界……进去吧。宫里的时间，和外面不一样。',
  'open.blue-blood': '蓝血。友情提示：里面的答案，比题目更锋利。',
  'open.myopia': '近视眼那间……别怕黑，真正的黑没那么可怕。',
  seeoff: '去吧。看完记得回来——门会一直开着。',
  return: '回来啦？这次的故事怎么样。',
};

/** Beat used when 看山 starts opening a given door. */
export function doorOpenBeat(doorId: string): DialogueBeat | null {
  if (doorId === 'duanfei') return 'open.duanfei';
  if (doorId === 'blue-blood') return 'open.blue-blood';
  if (doorId === 'myopia') return 'open.myopia';
  return null;
}

/**
 * 和刘看山聊天 — the player-initiated conversation tree (modal).
 * ⚠️ DRAFT, same as the rest of the copy. Pure data: scene.ts drives the
 * chat state, the dialogue box, and the commits from these tables.
 */
export type ChatTopic = 'place' | 'doors' | 'who' | 'bye';

export interface ChatOption {
  /** Row label as rendered (「N 这是哪儿？」 numbering happens in scene). */
  readonly label: string;
  readonly topic: ChatTopic;
}

export const CHAT_ROOT_LINE = '嗯？想聊点什么？';

export const CHAT_OPTIONS: readonly ChatOption[] = [
  { label: '这是哪儿？', topic: 'place' },
  { label: '那三扇门？', topic: 'doors' },
  { label: '你到底是谁？', topic: 'who' },
  { label: '没事，随便逛逛', topic: 'bye' },
];

/** Answer per topic; topics 1–3 return to the root options, 'bye' closes. */
export const CHAT_ANSWERS: Record<ChatTopic, string> = {
  place: '知乎所有故事的候车大厅。每一扇门后面都是一个完整的世界——进去之前，先想好自己想带走什么。',
  doors: '端妃、蓝血、近视眼，三个真实存在过的故事。走到门前站一会儿，我就来开门。',
  who: '刘看山。看门的山，也是看故事的山。好了，不能再剧透了。',
  bye: '行，慢慢逛。开门的事，包在我身上。',
};
