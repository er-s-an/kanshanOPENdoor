import { useId, useRef, useState, type KeyboardEvent } from 'react';
import type { ClueMeta, InvestigationItem, Scene } from '../types';
import { renderMarkdown } from '../lib/md';
import { choiceLocked } from '../lib/rules.mjs';
import { useGame } from '../state/engine';
import { ChoiceDeck } from './ChoiceDeck';
import '../investigation.css';

const itemKinds = { observation: '现场观察', testimony: '人物证言', record: '书面记录' };
const clueKinds = { observation: '观察', testimony: '证言', inference: '推断' };
const normalize = (value: string) => value.normalize('NFKC').toLocaleLowerCase().replace(/\s+/g, '');
type Workspace = 'observe' | 'verify';

function EvidenceLabel({ clue, compact = false }: { clue: ClueMeta; compact?: boolean }) {
  return <>
    <span className="investigation__evidence-name"><small>{clueKinds[clue.kind || 'observation']}</small><strong>{clue.name}</strong></span>
    {!compact && clue.desc ? <span className="investigation__evidence-desc">{clue.desc}</span> : null}
    {!compact && clue.sourceLabel ? <span className="investigation__source">来源 · {clue.sourceLabel}</span> : null}
  </>;
}

/** Discovery and verification are separate workspaces; the rule engine still owns every grant and exit. */
export function InvestigationView({ scene }: { scene: Scene }) {
  const { story, vars, inspect, verify, chooseAndNav, navBusy, nextSceneOf, nav } = useGame();
  const uid = useId();
  const recordRef = useRef<HTMLElement>(null);
  const placesRef = useRef<HTMLElement>(null);
  const exitsRef = useRef<HTMLElement>(null);
  const tabRefs = useRef<Partial<Record<Workspace, HTMLButtonElement | null>>>({});
  const [workspace, setWorkspace] = useState<Workspace>(scene.investigation?.items.length ? 'observe' : 'verify');
  const [draft, setDraft] = useState('');
  const [query, setQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [contextOpen, setContextOpen] = useState(true);
  const [exitsOpen, setExitsOpen] = useState(false);
  const [activeItemId, setActiveItemId] = useState<string | null>(null);
  const [activeCheckId, setActiveCheckId] = useState(scene.investigation?.checks[0]?.id || '');
  const [openEvidenceId, setOpenEvidenceId] = useState<string | null>(null);
  const [selections, setSelections] = useState<Record<string, string[]>>({});
  const [feedback, setFeedback] = useState<Record<string, { ok: boolean; text: string }>>({});
  const investigation = scene.investigation;
  if (!investigation) return <section className="investigation"><p>这一幕尚未提供调查内容。</p></section>;

  const isFound = (id: string) => vars[id] === 'found';
  const available = investigation.items.filter((item) => Object.entries(item.requires || {}).every(([key, value]) => vars[key] === value));
  const search = normalize(query);
  // Search only exposed object names and keywords, never hidden observations or answers.
  const results = available.filter((item) => !search || [item.title, ...item.keywords].some((word) => normalize(word).includes(search)));
  const activeItem = available.find((item) => item.id === activeItemId);
  const known = (story?.clues || []).filter((clue) => isFound(clue.id));
  const activeClue = known.find((clue) => clue.id === activeItem?.clue);
  const recordText = (clue: ClueMeta) => {
    // A known record can be reread in full; no unearned observation is rendered.
    const observation = story?.scenes.flatMap((entry) => entry.investigation?.items || []).find((item) => item.clue === clue.id);
    if (observation) return observation.text;
    const testimony = story?.scenes.flatMap((entry) => entry.dialogue?.topics || []).find((topic) => topic.grants?.includes(clue.id));
    if (testimony) return testimony.reply;
    const conclusion = story?.scenes.flatMap((entry) => entry.investigation?.checks || []).find((check) => check.grants.includes(clue.id));
    return conclusion?.success || clue.desc || '这条记录已留在线索簿。';
  };
  const currentCheck = investigation.checks.find((check) => check.id === activeCheckId) || investigation.checks[0];
  const candidates = currentCheck?.candidates ? known.filter((clue) => currentCheck.candidates?.includes(clue.id)) : known;
  const passed = (check: typeof investigation.checks[number]) => check.grants.length > 0 && check.grants.every(isFound);
  const completed = investigation.checks.filter(passed).length;
  const selected = currentCheck ? (selections[currentCheck.id] || []).filter((id) => candidates.some((clue) => clue.id === id)) : [];
  const checkPassed = currentCheck ? passed(currentCheck) : false;
  const lastFeedback = currentCheck ? feedback[currentCheck.id] : undefined;
  const visited = investigation.items.filter((item) => isFound(item.clue)).length;
  const hasItems = investigation.items.length > 0;
  const hasChecks = investigation.checks.length > 0;
  const hasTabs = hasItems && hasChecks;
  const next = nextSceneOf(scene);
  const choices = scene.choices || [];
  const singleExit = choices.length === 1 ? choices[0] : undefined;
  const singleExitLocked = singleExit ? choiceLocked(singleExit, vars) : null;
  const nextUnseen = available.find((item) => !isFound(item.clue));
  // Describe only observations actually required by an exit, without forcing optional exploration.
  const requiredUnseen = singleExit ? available.filter((item) => !isFound(item.clue) && singleExit.requires?.[item.clue] === 'found') : [];
  const pendingCheck = investigation.checks.find((check) => !passed(check));
  const canLeave = Boolean(singleExit ? !singleExitLocked : !choices.length && next);
  const longExitLabel = Boolean(canLeave && singleExit && singleExit.text.length > 16);
  const suggestedObservation = requiredUnseen[0] || (workspace === 'observe' ? nextUnseen : undefined);
  const status = canLeave ? longExitLabel ? `接下来：${singleExit?.text}` : '这一幕的记录已准备好' : choices.length > 1 ? '你可以继续核对，也可以决定下一步' : requiredUnseen.length ? `还需查看 ${requiredUnseen.length} 处记录` : suggestedObservation ? `现场还有 ${available.filter((item) => !isFound(item.clue)).length} 处未查看` : pendingCheck ? workspace === 'verify' ? selected.length ? `已选 ${selected.length} 条，可以核对了` : '选择能帮助判断的记录' : '还需把线索放在一起核对' : singleExitLocked || '记录已留在线索簿';

  const focusInto = (ref: { current: HTMLElement | null }) => window.requestAnimationFrame(() => {
    ref.current?.scrollIntoView({ block: 'start', behavior: 'instant' });
    ref.current?.focus({ preventScroll: true });
  });
  const openItem = (item: InvestigationItem) => {
    if (navBusy) return;
    inspect(item.id);
    setWorkspace('observe');
    setContextOpen(false);
    setActiveItemId(item.id);
    focusInto(recordRef);
  };
  const returnToPlaces = () => {
    setActiveItemId(null);
    focusInto(placesRef);
  };
  const changeWorkspace = (value: Workspace, focusTab = false) => {
    setWorkspace(value);
    setContextOpen(false);
    setExitsOpen(false);
    window.requestAnimationFrame(() => {
      const target = focusTab ? tabRefs.current[value] : document.getElementById(`${uid}-${value}-panel`);
      target?.scrollIntoView({ block: 'start', behavior: 'instant' });
      target?.focus({ preventScroll: true });
    });
  };
  const tabKey = (event: KeyboardEvent<HTMLButtonElement>, value: Workspace) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    changeWorkspace(event.key === 'Home' ? 'observe' : event.key === 'End' ? 'verify' : value === 'observe' ? 'verify' : 'observe', true);
  };
  const toggleEvidence = (id: string) => {
    if (!currentCheck || checkPassed) return;
    setSelections((previous) => {
      const list = previous[currentCheck.id] || [];
      return { ...previous, [currentCheck.id]: list.includes(id) ? list.filter((item) => item !== id) : [...list, id] };
    });
    setFeedback((previous) => {
      const nextFeedback = { ...previous };
      delete nextFeedback[currentCheck.id];
      return nextFeedback;
    });
  };
  const submitCheck = () => {
    if (!currentCheck || checkPassed || !selected.length || navBusy) return;
    const ok = verify(currentCheck.id, selected);
    setFeedback((previous) => ({ ...previous, [currentCheck.id]: { ok, text: ok ? currentCheck.success : currentCheck.failure } }));
    window.requestAnimationFrame(() => {
      const result = document.getElementById(`${uid}-check-feedback`);
      result?.scrollIntoView({ block: 'nearest', behavior: 'instant' });
      result?.focus({ preventScroll: true });
    });
  };
  const primaryAction = () => {
    if (navBusy) return;
    if (canLeave) {
      if (singleExit) chooseAndNav(singleExit);
      else if (next) nav(next);
      return;
    }
    if (choices.length > 1) {
      setExitsOpen(true);
      focusInto(exitsRef);
    } else if (suggestedObservation) openItem(suggestedObservation);
    else if (workspace === 'verify' && currentCheck && !checkPassed) {
      if (selected.length) submitCheck();
      else {
        const evidence = document.getElementById(`${uid}-evidence`);
        evidence?.scrollIntoView({ block: 'start', behavior: 'instant' });
        evidence?.focus({ preventScroll: true });
      }
    } else if (pendingCheck) {
      setActiveCheckId(pendingCheck.id);
      changeWorkspace('verify');
    } else if (nextUnseen) openItem(nextUnseen);
    else returnToPlaces();
  };
  const primaryLabel = canLeave ? longExitLabel ? '继续故事' : singleExit?.text || scene.continueLabel || '继续故事' : choices.length > 1 ? '决定下一步' : suggestedObservation ? '查看下一处' : pendingCheck ? workspace === 'verify' ? selected.length ? '核对这些记录' : '挑选记录' : '整理线索' : nextUnseen ? '查看下一处' : '回看记录';

  return (
    <section className="investigation" aria-labelledby={`${uid}-title`}>
      <header className="investigation__head">
        <p className="investigation__eyebrow">{hasChecks ? '眼下要弄清' : '眼下要做的事'}</p>
        <h2 id={`${uid}-title`}>{investigation.objective}</h2>
        {scene.text ? <details className="investigation__context" open={contextOpen} onToggle={(event) => setContextOpen(event.currentTarget.open)}>
          <summary>场景回顾</summary>
          <div className="investigation__intro prose" dangerouslySetInnerHTML={{ __html: renderMarkdown(scene.text) }} />
        </details> : null}
      </header>

      <div className={`investigation__actionbar${longExitLabel ? ' has-long-exit' : ''}`}>
        <p role="status">{status}</p>
        <button className={`btn ${canLeave || choices.length > 1 ? 'btn--primary' : 'btn--ghost'}`} onClick={primaryAction} disabled={navBusy} aria-label={longExitLabel ? singleExit?.text : undefined}>{primaryLabel}<span aria-hidden>→</span></button>
      </div>

      {choices.length > 1 && exitsOpen ? <section ref={exitsRef} className="investigation__exits" tabIndex={-1} aria-labelledby={`${uid}-exits-title`}>
        <div className="investigation__section-heading"><h3 id={`${uid}-exits-title`}>接下来，你想怎么做</h3><button className="investigation__text-button" onClick={() => { setExitsOpen(false); changeWorkspace(workspace); }}>继续整理</button></div>
        <ChoiceDeck choices={choices} onPick={chooseAndNav} disabled={navBusy} />
      </section> : null}

      {hasTabs ? <div className="investigation__tabs" role="tablist" aria-label="调查工作区">
        <button ref={(element) => { tabRefs.current.observe = element; }} role="tab" id={`${uid}-observe-tab`} aria-selected={workspace === 'observe'} aria-controls={`${uid}-observe-panel`} tabIndex={workspace === 'observe' ? 0 : -1} onClick={() => changeWorkspace('observe')} onKeyDown={(event) => tabKey(event, 'observe')}>观察现场 <span>{visited}/{investigation.items.length}</span></button>
        <button ref={(element) => { tabRefs.current.verify = element; }} role="tab" id={`${uid}-verify-tab`} aria-selected={workspace === 'verify'} aria-controls={`${uid}-verify-panel`} tabIndex={workspace === 'verify' ? 0 : -1} onClick={() => changeWorkspace('verify')} onKeyDown={(event) => tabKey(event, 'verify')}>整理查证 <span>{completed}/{investigation.checks.length}</span></button>
      </div> : null}

      {hasItems ? <section className={`investigation__field${activeItem ? ' has-record' : ''}`} id={`${uid}-observe-panel`} role={hasTabs ? 'tabpanel' : undefined} aria-labelledby={hasTabs ? `${uid}-observe-tab` : `${uid}-places-title`} hidden={workspace !== 'observe'} tabIndex={-1}>
        <section ref={placesRef} className="investigation__places" aria-labelledby={`${uid}-places-title`} tabIndex={-1}>
          <div className="investigation__section-heading"><h3 id={`${uid}-places-title`}>选一处仔细看看</h3>{!hasTabs ? <span className="investigation__count">{visited}/{investigation.items.length} 已看</span> : null}</div>
          <ul className="investigation__objects" aria-label="可查看的地点和物件">
            {results.map((item) => <li key={item.id}>
              <button className={`investigation__object${activeItemId === item.id ? ' is-active' : ''}${isFound(item.clue) ? ' is-found' : ''}`} onClick={() => openItem(item)} disabled={navBusy} aria-pressed={activeItemId === item.id} aria-controls={`${uid}-record`}>
                <span className="investigation__object-index" aria-hidden>{String(investigation.items.indexOf(item) + 1).padStart(2, '0')}</span>
                <strong>{item.title}</strong>
                <span className="investigation__object-state">{isFound(item.clue) ? '已看 ✓' : '待查看'}<i aria-hidden>›</i></span>
              </button>
            </li>)}
          </ul>
          {!results.length ? <div className="investigation__empty">{query ? '没有找到这个物件。试试更短的名称，或显示全部。' : '眼下还没有可以查看的物件。先看看已有记录里有什么方向。'}</div> : null}
          {query ? <div className="investigation__search-state" role="status"><span>“{query}” · 找到 {results.length} 处</span><button onClick={() => { setDraft(''); setQuery(''); }}>显示全部</button></div> : null}
          <details className="investigation__search-disclosure" open={searchOpen} onToggle={(event) => setSearchOpen(event.currentTarget.open)}><summary>凭印象搜寻物件</summary>
            <form className="investigation__search" role="search" onSubmit={(event) => { event.preventDefault(); setQuery(draft.trim()); }}>
              <label htmlFor={`${uid}-search`} className="sr-only">搜寻本场景的地点或物件</label>
              <input id={`${uid}-search`} type="search" value={draft} maxLength={120} placeholder={investigation.searchPlaceholder || '输入地点或物件名称'} onChange={(event) => { setDraft(event.target.value); if (!event.target.value) setQuery(''); }} aria-describedby={`${uid}-search-note`} />
              <button type="submit">搜寻</button>
            </form>
            <p className="investigation__search-note" id={`${uid}-search-note`}>只搜这一幕。也可以直接查看上面的物件。</p>
          </details>
          {available.length < investigation.items.length ? <p className="investigation__hint">还有 {investigation.items.length - available.length} 处，需要新线索才能查看。</p> : null}
          {investigation.hints.length ? <details className="investigation__directions"><summary>需要一点方向 · {investigation.hints.length} 条</summary><ul>{investigation.hints.map((hint, index) => <li key={index}>{hint}</li>)}</ul></details> : null}
        </section>

        {activeItem && isFound(activeItem.clue) ? <article ref={recordRef} className="investigation__record" id={`${uid}-record`} tabIndex={-1} aria-labelledby={`${uid}-record-title`}>
          <button className="investigation__back" onClick={returnToPlaces}><span aria-hidden>←</span> 返回全部 {available.length} 处</button>
          <div className="investigation__record-meta"><span>{itemKinds[activeItem.kind || 'observation']}</span><span>已记入线索簿 ✓</span></div>
          <h3 id={`${uid}-record-title`}>{activeItem.title}</h3>
          <div className="investigation__observation prose" dangerouslySetInnerHTML={{ __html: renderMarkdown(activeItem.text) }} />
          {activeClue ? <details className="investigation__note"><summary>回看这条线索的摘要</summary><EvidenceLabel clue={activeClue} /></details> : null}
          <div className="investigation__record-actions">
            {nextUnseen ? <button className="btn btn--ghost" disabled={navBusy} onClick={() => openItem(nextUnseen)}>下一处：{nextUnseen.title}<span aria-hidden>→</span></button> : hasChecks ? <button className="btn btn--ghost" onClick={() => changeWorkspace('verify')}>带着记录去核对<span aria-hidden>→</span></button> : <p className="investigation__hint">这一幕已全部看过，可以继续故事了。</p>}
          </div>
        </article> : null}
      </section> : null}

      {currentCheck ? <section className="investigation__checks" id={`${uid}-verify-panel`} role={hasTabs ? 'tabpanel' : undefined} aria-labelledby={hasTabs ? `${uid}-verify-tab` : `${uid}-claim-title`} hidden={workspace !== 'verify'} tabIndex={-1}>
        {investigation.checks.length > 1 ? <div className="investigation__questions" role="group" aria-label="选择要核对的说法">
          {investigation.checks.map((check) => <button key={check.id} className={`investigation__question${currentCheck.id === check.id ? ' is-active' : ''}`} aria-pressed={currentCheck.id === check.id} onClick={() => { setActiveCheckId(check.id); setOpenEvidenceId(null); }}><span>{check.prompt}</span><small>{passed(check) ? '已核对 ✓' : '待核对'}</small></button>)}
        </div> : null}

        {checkPassed ? <div className="investigation__verified">
          <div className="investigation__feedback investigation__feedback--success" id={`${uid}-check-feedback`} tabIndex={-1} role="status"><h3 id={`${uid}-claim-title`}>这次核对得出的结论</h3><p>{currentCheck.success}</p></div>
          <details className="investigation__proof-disclosure"><summary>回看依据 · {currentCheck.answer.length} 条线索</summary><ul className="investigation__proofs">{known.filter((clue) => currentCheck.answer.includes(clue.id)).map((clue) => <li key={clue.id}><EvidenceLabel clue={clue} /></li>)}</ul></details>
          <p className="investigation__hint">{requiredUnseen.length ? `结论已记下。现场还有 ${requiredUnseen.length} 处必要记录未查看。` : pendingCheck ? '结论已记下，还有其他说法可以核对。' : '结论已记下。你可以决定下一步，也可以回看现场。'}</p>
          {requiredUnseen[0] ? <button className="btn btn--ghost" onClick={() => openItem(requiredUnseen[0])}>继续查看现场 →</button> : pendingCheck ? <button className="btn btn--ghost" onClick={() => { setActiveCheckId(pendingCheck.id); setOpenEvidenceId(null); }}>核对下一个说法 →</button> : null}
        </div> : <>
          <div className="investigation__claim"><h3 id={`${uid}-claim-title`}>待核对的说法</h3><p>{currentCheck.claim}</p></div>
          <form onSubmit={(event) => {
            event.preventDefault();
            submitCheck();
          }}>
            <fieldset className="investigation__evidence" id={`${uid}-evidence`} tabIndex={-1} disabled={navBusy}>
              <legend>哪些记录能帮你判断？</legend>
              {candidates.length ? <div className="investigation__evidence-list">{candidates.map((clue) => <div key={clue.id} className={`investigation__evidence-card${selected.includes(clue.id) ? ' is-selected' : ''}`}>
                <label><input type="checkbox" value={clue.id} checked={selected.includes(clue.id)} onChange={() => toggleEvidence(clue.id)} /><EvidenceLabel clue={clue} compact /></label>
                <button type="button" className="investigation__evidence-read" aria-expanded={openEvidenceId === clue.id} aria-controls={`${uid}-evidence-${clue.id}`} aria-label={`查看记录：${clue.name}`} onClick={() => setOpenEvidenceId(openEvidenceId === clue.id ? null : clue.id)}>{openEvidenceId === clue.id ? '收起' : '读记录'}</button>
                <div className="investigation__evidence-detail" id={`${uid}-evidence-${clue.id}`} hidden={openEvidenceId !== clue.id}>{openEvidenceId === clue.id ? <><div className="prose" dangerouslySetInnerHTML={{ __html: renderMarkdown(recordText(clue)) }} />{clue.sourceLabel ? <span className="investigation__source">来源 · {clue.sourceLabel}</span> : null}</> : null}</div>
              </div>)}</div> : <div className="investigation__empty"><p>{known.length ? '手头还没有与这个问题相关的记录。' : '线索簿还是空的。'}</p>{hasItems ? <button type="button" className="btn btn--ghost" onClick={() => changeWorkspace('observe')}>先观察现场 →</button> : <p>回看已有经历，取得相关记录后再来核对。</p>}</div>}
            </fieldset>
            {lastFeedback ? <div className={`investigation__feedback${lastFeedback.ok ? ' investigation__feedback--success' : ''}`} id={`${uid}-check-feedback`} tabIndex={-1} role="status"><strong>{lastFeedback.ok ? '查证完成' : '再想一想这组记录'}</strong><p>{lastFeedback.text}</p>{!lastFeedback.ok ? <small>线索都会保留。可以修改组合，再试一次。</small> : null}</div> : null}
            <div className="investigation__verify-action"><span aria-live="polite">已选 {selected.length} 条</span><button className="btn btn--primary" type="submit" disabled={!selected.length || navBusy}>用这些线索核对<span aria-hidden>→</span></button></div>
          </form>
        </>}
        {investigation.hints.length ? <details className="investigation__directions"><summary>需要一点核对方向 · {investigation.hints.length} 条</summary><ul>{investigation.hints.map((hint, index) => <li key={index}>{hint}</li>)}</ul></details> : null}
        {hasItems ? <button className="investigation__text-button" onClick={() => changeWorkspace('observe')}>← 回到现场观察</button> : null}
      </section> : null}
    </section>
  );
}
