/**
 * 看山任意门 · hall dialogue data.
 *
 * ⚠️ DRAFT — 以下台词均为初稿，待用户审阅（语气按「看山式」要求起草：
 * 亲切、松弛、偶尔皮一下、有知识分子的冷幽默）。文本定稿前请勿视作最终文案。
 *
 * All lines are subtitle-only (no voice). Keyed by story beat; scene.ts
 * renders them through the HUD subtitle queue.
 */

export type DialogueBeat =
  | 'greet'
  | 'intro'
  | 'guide'
  | 'open.duanfei'
  | 'open.blue-blood'
  | 'open.myopia'
  | 'seeoff'
  | 'return';

export const DIALOGUE: Record<DialogueBeat, string> = {
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
