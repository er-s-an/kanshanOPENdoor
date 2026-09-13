import { useEffect, useId, useState } from 'react';
import type { ClueMeta } from '../types';
import { useGame } from '../state/engine';
import { useDialog } from '../lib/useDialog';
import { buildEvidenceGraph } from '../lib/evidence-map.mjs';
import { EvidenceDocument } from './EvidenceDocument';
import '../evidence-ux.css';

const KIND_GROUPS: Array<{ kind: NonNullable<ClueMeta['kind']>; label: string }> = [
  { kind: 'observation', label: '现场观察' },
  { kind: 'testimony', label: '角色证言' },
  { kind: 'inference', label: '我的推断' },
];
const kindOf = (clue: ClueMeta) => clue.kind || 'observation';
const normalize = (value?: string) => (value || '').normalize('NFKC').toLocaleLowerCase('zh-CN');
const KIND_LABEL = { observation: '观察', testimony: '证言', inference: '推断' } as const;
const RESULT_LABEL = { supported: '直接支持', partial: '部分支持', overreach: '越过边界' } as const;

export function ClueSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { story, scene, vars, memo } = useGame();
  const uid = useId();
  const panel = useDialog(open, onClose);
  const [view, setView] = useState<'map' | 'records'>('map');
  const [scope, setScope] = useState<'scene' | 'all'>('scene');
  const [query, setQuery] = useState('');
  const found = (story?.clues || []).filter((clue) => vars[clue.id] === 'found');
  const relatedIds = new Set([
    ...Object.keys(scene?.onEnter || {}),
    ...(scene?.dialogue?.topics || []).flatMap((topic) => [...(topic.grants || []), ...Object.keys(topic.requires || {})]),
    ...(scene?.investigation?.items || []).map((item) => item.clue),
    ...(scene?.investigation?.checks || []).flatMap((check) => [...(check.candidates || []), ...check.grants]),
    ...(scene?.choices || []).flatMap((choice) => Object.keys(choice.requires || {})),
  ]);
  const relatedFound = found.filter((clue) => relatedIds.has(clue.id));
  useEffect(() => {
    if (open) {
      setView(found.length >= 2 ? 'map' : 'records');
      setScope(relatedFound.length ? 'scene' : 'all');
      setQuery('');
    }
  }, [open]);
  if (!open || !story) return null;

  const graph = buildEvidenceGraph(story, vars, memo);

  const recordText = (clue: ClueMeta) => {
    const observation = story.scenes.flatMap((entry) => entry.investigation?.items || []).find((item) => item.clue === clue.id);
    if (observation) return observation.text;
    const testimony = story.scenes.flatMap((entry) => entry.dialogue?.topics || []).find((topic) => topic.grants?.includes(clue.id));
    if (testimony) return testimony.reply;
    const conclusion = story.scenes.flatMap((entry) => entry.investigation?.checks || []).find((check) => check.grants.includes(clue.id));
    return conclusion?.success || clue.desc || '这条记录已留在线索簿。';
  };
  const match = normalize(query.trim());
  const visible = (scope === 'scene' ? relatedFound : found)
    .filter((clue) => !match || [clue.name, clue.desc, clue.sourceLabel, recordText(clue)].some((value) => normalize(value).includes(match)));
  const groups = KIND_GROUPS
    .map((group) => ({ ...group, items: visible.filter((clue) => kindOf(clue) === group.kind) }))
    .filter((group) => group.items.length > 0);

  return <div className="sheet-mask" onClick={onClose}>
    <div className="utility-sheet records-sheet" ref={panel} role="dialog" aria-modal="true" aria-labelledby={`${uid}-title`} onClick={(event) => event.stopPropagation()}>
      <header className="utility-sheet__head"><div><p>旅途中的依据</p><h2 id={`${uid}-title`}>线索簿 <small>{found.length} 条记录</small></h2></div><button className="utility-sheet__close" aria-label="关闭线索簿" onClick={onClose}>×</button></header>
      <div className="records-sheet__view-switch seg" role="group" aria-label="线索簿视图">
        <button className={view === 'map' ? 'is-on' : ''} aria-pressed={view === 'map'} onClick={() => setView('map')}>关系板</button>
        <button className={view === 'records' ? 'is-on' : ''} aria-pressed={view === 'records'} onClick={() => setView('records')}>逐条记录</button>
      </div>
      {view === 'records' ? <>
        <div className="records-sheet__tools">
          <div className="seg" role="group" aria-label="记录范围"><button className={scope === 'scene' ? 'is-on' : ''} aria-pressed={scope === 'scene'} onClick={() => setScope('scene')}>本幕相关 · {relatedFound.length}</button><button className={scope === 'all' ? 'is-on' : ''} aria-pressed={scope === 'all'} onClick={() => setScope('all')}>全部记录 · {found.length}</button></div>
          <label className="records-sheet__search">查找已发现的记录<input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="名称、内容或来源" /></label>
        </div>
        <div className="records-sheet__list">
          {groups.map((group) => <section className="cluegroup" key={group.kind} aria-label={`${group.label}，${group.items.length} 条`}>
            <h3 className="cluegroup__head"><span>{group.label}</span><span className="cluegroup__count cluegroup__count--done">{group.items.length}</span></h3>
            {group.items.map((clue) => <details className="record-entry" key={clue.id}>
              <summary><span><strong>{clue.name}</strong>{clue.sourceLabel ? <small>来源 · {clue.sourceLabel}</small> : null}</span><span className="record-entry__expand" aria-hidden>＋</span></summary>
              <div className="record-entry__content"><EvidenceDocument clue={clue} body={recordText(clue)} className="records-sheet__document" /></div>
            </details>)}
          </section>)}
          {!visible.length ? <div className="records-sheet__empty"><p>{match ? '已发现的记录里没有匹配项。' : scope === 'scene' ? '这一幕暂时没有已发现的相关记录。' : '你的记录从这里开始。'}</p>{match ? <button className="btn btn--ghost" onClick={() => setQuery('')}>清除搜索</button> : scope === 'scene' && found.length ? <button className="btn btn--ghost" onClick={() => setScope('all')}>查看全部已发现记录</button> : <p>搜寻物件、听取证言后，会自动记在这里。</p>}</div> : null}
        </div>
        <p className="records-sheet__tip">这里仅收录已经发现的线索。它们会在核对说法、打开新去处时派上用场。</p>
      </> : <div className="records-sheet__map evidence-map">
        <header className="evidence-map__intro"><p>只连起你已经亲手核对过的关系；没有发现的记录和未发生的真相不会提前出现。</p></header>
        {graph.verified.map((link) => <article className="evidence-link" key={link.id}>
          <p className="evidence-link__eyebrow">核对完成{link.chapter ? ` · ${link.chapter}` : ''}</p>
          <h3>{link.claim}</h3>
          <div className="evidence-link__flow">
            <div><small>依据</small><ul>{link.evidence.map((item) => <li key={item.id}><span>{KIND_LABEL[item.kind]}</span>{item.name}</li>)}</ul></div>
            <span className="evidence-link__arrow" aria-hidden>→</span>
            <div><small>可以负责的结论</small><ul>{link.conclusions.map((item) => <li key={item.id}><span>{KIND_LABEL[item.kind]}</span>{item.name}</li>)}</ul></div>
          </div>
          <details><summary>这组关系的边界</summary><p>{link.boundary}</p></details>
        </article>)}
        {graph.arguments.map((argument) => <article className="evidence-link evidence-link--argument" key={argument.id}>
          <p className="evidence-link__eyebrow">公开论证{argument.outcome ? ` · ${argument.outcome === 'truth' ? '已形成记录' : argument.outcome === 'fold' ? '需要收窄' : '发现新问题'}` : ' · 正在整理'}</p>
          <h3>{argument.question}</h3>
          {argument.claim ? <blockquote>{argument.claim}</blockquote> : null}
          {argument.evidence.length ? <ul className="evidence-link__argument-list">{argument.evidence.map((item, index) => <li key={`${item.id}:${index}`}><span>{RESULT_LABEL[item.result]}</span><strong>{item.name}</strong></li>)}</ul> : <p>主张已经选定，尚未放入可以直接回应质疑的记录。</p>}
        </article>)}
        {graph.loose.length ? <section className="evidence-map__loose"><h3>仍待连线的记录</h3><p>它们已经被发现，但还没有通过核对或进入公开论证。</p><ul>{graph.loose.map((item) => <li key={item.id}><span>{KIND_LABEL[item.kind]}</span>{item.name}</li>)}</ul></section> : null}
        {!graph.verified.length && !graph.arguments.length && !graph.loose.length ? <div className="records-sheet__empty"><p>关系板还没有内容。</p><p>先在现场观察、和人物交谈；完成一次核对后，依据与结论会在这里连起来。</p></div> : null}
      </div>}
      <footer className="utility-sheet__foot"><span>证言是人物的说法，推断仍有边界。</span><button className="btn btn--primary" onClick={onClose}>回到故事</button></footer>
    </div>
  </div>;
}
