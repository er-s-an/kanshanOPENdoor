import { useEffect, useId, useState } from 'react';
import type { ClueMeta } from '../types';
import { useGame } from '../state/engine';
import { useDialog } from '../lib/useDialog';
import '../evidence-ux.css';

const KIND_GROUPS: Array<{ kind: NonNullable<ClueMeta['kind']>; label: string }> = [
  { kind: 'observation', label: '现场观察' },
  { kind: 'testimony', label: '角色证言' },
  { kind: 'inference', label: '我的推断' },
];
const kindOf = (clue: ClueMeta) => clue.kind || 'observation';

export function ClueSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { story, scene, vars } = useGame();
  const uid = useId();
  const panel = useDialog(open, onClose);
  const [scope, setScope] = useState<'scene' | 'all'>('scene');
  const [query, setQuery] = useState('');
  const pool = story?.clues || [];
  const found = pool.filter((c) => vars[c.id] === 'found');
  const relatedIds = new Set([
    ...Object.keys(scene?.onEnter || {}),
    ...(scene?.dialogue?.topics || []).flatMap((t) => [...(t.grants || []), ...Object.keys(t.requires || {})]),
    ...(scene?.investigation?.items || []).map((i) => i.clue),
    ...(scene?.investigation?.checks || []).flatMap((c) => [...(c.candidates || []), ...c.grants]),
    ...(scene?.choices || []).flatMap((c) => Object.keys(c.requires || {})),
  ]);
  const relatedPool = pool.filter((c) => relatedIds.has(c.id));
  useEffect(() => { if (open) { setScope(relatedPool.length ? 'scene' : 'all'); setQuery(''); } }, [open]);
  if (!open || !story) return null;
  const match = query.trim().normalize('NFKC').toLowerCase();
  const visible = (scope === 'scene' ? relatedPool : pool)
    .filter((c) => !match || [c.name, c.desc, c.sourceLabel].some((s) => s?.normalize('NFKC').toLowerCase().includes(match)));
  const groups = KIND_GROUPS
    .map((g) => ({ ...g, items: visible.filter((c) => kindOf(c) === g.kind) }))
    .filter((g) => g.items.length > 0)
    .map((g) => ({ ...g, got: g.items.filter((c) => vars[c.id] === 'found').length }));
  return <div className="sheet-mask" onClick={onClose}>
    <div className="utility-sheet records-sheet" ref={panel} role="dialog" aria-modal="true" aria-labelledby={`${uid}-title`} onClick={(e) => e.stopPropagation()}>
      <header className="utility-sheet__head"><div><p>旅途中的依据</p><h2 id={`${uid}-title`}>线索簿 <small>{found.length} 条记录</small></h2></div><button className="utility-sheet__close" aria-label="关闭线索簿" onClick={onClose}>×</button></header>
      <div className="records-sheet__tools">
        <div className="seg" role="group" aria-label="记录范围"><button className={scope === 'scene' ? 'is-on' : ''} aria-pressed={scope === 'scene'} onClick={() => setScope('scene')}>本幕相关 · {relatedPool.length}</button><button className={scope === 'all' ? 'is-on' : ''} aria-pressed={scope === 'all'} onClick={() => setScope('all')}>全部记录 · {pool.length}</button></div>
        <label className="records-sheet__search">查找记录<input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="名称、内容或来源" /></label>
      </div>
      <div className="records-sheet__list">
        {groups.map((g) => <section className="cluegroup" key={g.kind} aria-label={`${g.label}，已发现 ${g.got} 条，共 ${g.items.length} 条`}>
          <h3 className="cluegroup__head"><span>{g.label}</span><span className={`cluegroup__count${g.got === g.items.length ? ' cluegroup__count--done' : ''}`}>{g.got}/{g.items.length}</span></h3>
          {g.items.map((clue) => vars[clue.id] === 'found'
            ? <details className="record-entry" key={clue.id}><summary><span><strong>{clue.name}</strong></span><span className="record-entry__expand" aria-hidden>＋</span></summary><div className="record-entry__content"><p>{clue.desc}</p>{clue.sourceLabel ? <small>来源 · {clue.sourceLabel}</small> : null}</div></details>
            : <div className="record-entry record-entry--missing" key={clue.id}><span className="record-entry__missing"><strong>???</strong><small>未发现</small></span><span className="record-entry__expand" aria-hidden>·</span></div>)}
        </section>)}
        {!visible.length ? <div className="records-sheet__empty"><p>{match ? '没有找到匹配的记录。' : scope === 'scene' ? '这一幕暂时没有相关记录。' : '你的记录从这里开始。'}</p>{match ? <button className="btn btn--ghost" onClick={() => setQuery('')}>清除搜索</button> : scope === 'scene' && pool.length ? <button className="btn btn--ghost" onClick={() => setScope('all')}>查看全部记录</button> : <p>查看物件、听取证言后，会自动记在这里。</p>}</div> : null}
      </div>
      <p className="records-sheet__tip">已发现的线索会在关键时刻派上用场——核对说法、打开新的去处。</p>
      <footer className="utility-sheet__foot"><span>证言是人物的说法，推断仍有边界。</span><button className="btn btn--primary" onClick={onClose}>回到故事</button></footer>
    </div>
  </div>;
}
