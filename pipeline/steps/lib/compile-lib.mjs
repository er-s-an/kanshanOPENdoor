// compile 核心：把 structure.json + 各来源文本组装成与运行时共享的 game.json。
import { warn } from './util.mjs';
import { deriveLoreIds } from './schemas.mjs';

export function buildGame({ raw, analysis, structure, sceneTexts, npcCards, kanshan }) {
  const loreContent = new Map();
  for (const r of analysis.worldRules || []) loreContent.set(`rule-${r.id}`, r.rule);
  for (const f of analysis.foreshadowing || []) {
    const content = f.payoffHint
      ? `${f.description}（呼应：${f.payoffHint}）`
      : f.description;
    loreContent.set(`hook-${f.id}`, content);
  }
  const availIds = new Set(deriveLoreIds(analysis));

  const chapters = new Map();
  for (const sc of structure.scenes) {
    const got = sceneTexts.get(sc.id);
    chapters.set(sc.id, got?.chapter || sc.chapter || '');
  }
  // ending 场景 chapter 兜底
  for (const e of structure.endings) {
    if (!chapters.get(e.id)) chapters.set(e.id, `结局 · ${e.title}`);
  }

  const scenes = structure.scenes.map((sc) => {
    const out = {
      id: sc.id,
      type: sc.type,
      chapter: chapters.get(sc.id) || '',
      image: '',
      text: sceneTexts.get(sc.id)?.text || sc.narrative || '',
    };
    if (sc.type === 'chat') {
      out.npc = sc.npc;
      out.goal = sc.goal || '';
    }
    const lore = (sc.lore || []).filter((id) => availIds.has(id));
    if (lore.length) out.lore = lore;
    if (sc.type !== 'ending') {
      if (sc.choices?.length) {
        out.choices = sc.choices.map((c, i) => {
          const choice = {
            id: `c-${sc.id}-${i + 1}`,
            text: c.text,
            next: c.next,
            set: c.set || {},
          };
          if (c.requires && Object.keys(c.requires).length) choice.requires = c.requires;
          if (c.lockedHint) choice.lockedHint = c.lockedHint;
          return choice;
        });
      } else if (sc.next) {
        out.next = sc.next;
      }
    }
    return out;
  });

  // 图完整性快速自检（编译期即兜底报错，避免产出坏图）
  const ids = new Set(scenes.map((s) => s.id));
  for (const sc of scenes) {
    const refs = [];
    if (sc.next) refs.push(sc.next);
    for (const c of sc.choices || []) refs.push(c.next);
    for (const r of refs) {
      if (!ids.has(r)) warn(`[compile] 场景 ${sc.id} 指向未知场景 ${r}（已保留，validate 会拦截）`);
    }
  }

  const lore = [...loreContent.entries()].map(([id, content]) => ({ id, content }));
  const nameById = new Map((analysis.characters || []).map((c) => [c.id, c.name]));
  const npcs = (npcCards || []).map((n) => ({
    id: n.id,
    name: n.name || nameById.get(n.id) || n.id,
    card: n.card,
  }));

  // 线索簿元数据：clue_* 变量 → 引擎线索簿展示（meaning 作展示名）
  const clues = (structure.variables || [])
    .filter((v) => typeof v?.name === 'string' && v.name.startsWith('clue_'))
    .map((v) => ({ id: v.name, name: v.meaning || v.name }));

  return {
    story: {
      id: raw.storyId,
      title: structure.title || analysis.title || raw.title,
      author: analysis.author || '',
      tags: structure.tags?.length ? structure.tags : analysis.tags || [],
    },
    start: scenes[0]?.id || '',
    scenes,
    npcs,
    lore,
    endings: (structure.endings || []).map((e) => ({ id: e.id, title: e.title, tone: e.tone })),
    ...(clues.length ? { clues } : {}),
    kanshan: kanshan || { intro: '', rescueLines: [] },
  };
}
