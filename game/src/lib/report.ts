// Local run recap: observable choices and costs, with no invented rarity or personality scores.
import type { EndingMeta, GameJson, MemoEntry, Scene, Vars } from '../types';

export interface Report {
  meta: EndingMeta;
  words: string[];
  choices: string[];
  chapterCount: number;
  lines: Array<{ label: string; value: string }>;
  clueFound: number;
  clueTotal: number;
  badge: string;
}

export function buildReport(data: GameJson, scene: Scene, vars: Vars, memo: MemoEntry[]): Report {
  const meta = data.endings?.find((e) => e.id === scene.id) || { id: scene.id, title: scene.chapter || '故事终了' };
  const decisions = memo.filter((m) => m.kind === 'choice' || m.kind === 'action');
  const choices = decisions.map((m) => m.text);
  const sceneIds = new Set(memo.map((m) => m.sceneId));
  const chapters = new Set(data.scenes.filter((s) => sceneIds.has(s.id) && s.chapter).map((s) => s.chapter));
  const badge = data.source?.scope === 'excerpt' ? '章节试玩 · 阶段结果' : '本局记录';
  const lines = [{ label: '本次穿越', value: `经历 ${Math.max(sceneIds.size, 1)} 幕，留下 ${choices.length} 条选择与行动记录。` }];
  const resources = new Map(data.scenes.flatMap((s) => s.encounter?.resources || []).map((r) => [r.key, r]));
  if (resources.size) lines.push({ label: '剩余状态', value: [...resources.values()].map((r) => `${r.label} ${vars[r.key]}${r.unit || ''}`).join(' · ') });
  const clues = data.clues || [];
  const clueFound = clues.filter((c) => vars[c.id] === 'found').length;
  if (clues.length) lines.push({ label: '已记下的线索', value: `${clueFound} / ${clues.length}` });
  const chapterChoices = decisions.filter((m) => {
    if (m.kind !== 'choice') return false;
    const choice = data.scenes.find((sc) => sc.id === m.sceneId)?.choices?.find((c) => c.text === m.text);
    return choice?.set && Object.keys(choice.set).length > 0;
  });
  if (chapterChoices.length) lines.push({ label: '你作出的决定', value: chapterChoices.slice(-6).map((m) => `· ${m.text}`).join('\n') });
  if (decisions.length) lines.push({ label: '行动与后果', value: decisions.filter((m) => m.kind === 'action' && !m.actionId.startsWith('inspect:')).slice(-8).map((m) => m.kind === 'action' ? `· ${m.text}\n  ${m.feedback}${m.changes.length ? `（${m.changes.map((c) => `${c.label} ${c.before}→${c.after}`).join('，')}）` : ''}` : `· ${m.text}`).join('\n\n') });
  if (data.source) {
    lines.push({ label: '原作与改编', value: `《${data.source.title}》 / ${data.source.author || '官方接口未提供作者'}\n来源：知乎黑客松开放内容\n${data.source.adaptationNote}` });
  }
  return { meta, words: ['亲自选择', '留下经历'], choices, chapterCount: chapters.size, lines, clueFound, clueTotal: clues.length, badge };
}
