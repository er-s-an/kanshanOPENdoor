import { useEffect, useRef, useState } from 'react';
import type { Scene } from '../types';
import { actionLocked, completedOutcome } from '../lib/rules.mjs';
import { streamChat } from '../lib/api';
import { useGame } from '../state/engine';
import { SceneVisual } from './SceneVisual';

/** Optional character performance. It has no access to dispatch or state effects. */
function CharacterAside({ scene }: { scene: Scene }) {
  const { story, memo } = useGame();
  const npc = story?.npcs?.find((n) => n.id === scene.npc);
  const [input, setInput] = useState('');
  const [turns, setTurns] = useState<Array<{ role: 'user' | 'assistant'; content: string }>>([]);
  const [reply, setReply] = useState('');
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  if (!npc || !story) return null;
  const send = () => {
    if (controller.current || !input.trim()) return;
    const history = [...turns, { role: 'user' as const, content: input.trim() }].slice(-8);
    const ctrl = new AbortController();
    controller.current = ctrl;
    setTurns(history);
    setInput('');
    setReply('');
    setBusy(true);
    setStatus('正在等待回应…');
    const choiceSummary = memo.filter((m) => m.kind === 'action' && m.sceneId === scene.id).slice(-6)
      .map((m) => m.kind === 'action' ? `${m.text} → ${m.feedback}` : '').join('\n');
    streamChat({ storyId: story.story.id, sceneId: scene.id, history, choiceSummary }, {
      onDelta: (chunk) => { if (!ctrl.signal.aborted) setReply((r) => r + chunk); },
      onDone: (result) => {
        if (ctrl.signal.aborted) return;
        controller.current = null;
        setBusy(false);
        setReply(result.reply);
        setTurns([...history, { role: 'assistant', content: result.reply }]);
        setStatus(result.reply.trim() ? (result.cache === 'hit' ? 'AI 回应 · 已缓存' : 'AI 回应') : '这次没有收到回应，可以再试。');
      },
      onError: (code) => {
        if (ctrl.signal.aborted || code === 'ABORTED') return;
        controller.current = null;
        setBusy(false);
        setReply('');
        setStatus('暂时没有连上角色。你可以重试，也可以继续行动。');
      },
    }, ctrl.signal);
  };
  return (
    <details className="encounter__aside">
      <summary>和{npc.name}说句话 <span>可选互动</span></summary>
      {npc.card.first_mes ? <p>{npc.card.first_mes}</p> : null}
      {turns.filter((t) => t.role === 'user').length ? <p className="encounter__said">你：{turns.filter((t) => t.role === 'user').at(-1)?.content}</p> : null}
      <div aria-live="polite"><small>{status}</small>{reply ? <p>{reply}</p> : null}</div>
      <form onSubmit={(e) => { e.preventDefault(); send(); }}>
        <label className="sr-only" htmlFor="encounter-message">对{npc.name}说的话</label>
        <input id="encounter-message" value={input} onChange={(e) => setInput(e.target.value)} maxLength={1000} placeholder="你想对 TA 说什么？" disabled={busy} />
        <button className="btn btn--primary" disabled={busy || !input.trim()}>{busy ? '回应中…' : '说出来'}</button>
      </form>
    </details>
  );
}

export function EncounterView({ scene }: { scene: Scene }) {
  const { story, vars, memo, act, nav, navBusy } = useGame();
  const encounter = scene.encounter;
  if (!encounter) return <p>这一幕还没有配置行动。</p>;
  const outcome = completedOutcome(scene, vars);
  const log = memo.filter((m) => m.kind === 'action' && m.sceneId === scene.id);
  const last = log.at(-1);
  return (
    <section className="encounter">
      {scene.image ? <SceneVisual scene={scene} fallbackLabel={story?.story.title || '行动现场'} variant="encounter" className="encounter__visual" /> : null}
      <header className="encounter__head">
        <span className="encounter__eyebrow">章节试玩 · 你来决定怎么做</span>
        <h1>{scene.chapter}</h1>
        <p>{scene.text}</p>
        <div className="encounter__objective"><span>此刻的目标</span><strong>{encounter.objective}</strong></div>
      </header>

      <div className="encounter__resources" aria-label="当前状态">
        {encounter.resources.map((r) => (
          <div className="encounter__resource" key={r.key}>
            <div><span>{r.label}</span><strong>{vars[r.key]}<small> / {r.max}{r.unit || ''}</small></strong></div>
            <meter min={r.min} max={r.max} value={Number(vars[r.key])} aria-label={r.label} />
          </div>
        ))}
      </div>

      {last?.kind === 'action' ? (
        <div className="encounter__feedback" role="status">
          <span>刚才，你{last.text}</span><p>{last.feedback}</p>
          <div>{last.changes.map((c) => <small key={c.key}>{c.label} {c.before} → {c.after}</small>)}</div>
        </div>
      ) : <p className="encounter__guide">先看代价，再选行动。已做过的事会留在本局记录里。</p>}

      {outcome ? (
        <section className="encounter__outcome" aria-label="本幕结果">
          <span>这一幕有了结果</span><h2>{outcome.text}</h2>
          <button className="btn btn--primary btn--lg" disabled={navBusy} onClick={() => nav(outcome.next)}>看看接下来 →</button>
        </section>
      ) : (
        <div className="encounter__actions" aria-label="可执行行动">
          {encounter.actions.map((action, i) => {
            const locked = actionLocked(scene, action, vars);
            return <button className="encounter__action" key={action.id} disabled={Boolean(locked) || navBusy} onClick={() => act(action.id)}>
              <span className="encounter__action-no">{String(i + 1).padStart(2, '0')}</span>
              <strong>{action.text}</strong>
              {action.cost ? <span className="encounter__cost">{action.cost}</span> : null}
              <small>{locked || action.hint}</small>
            </button>;
          })}
        </div>
      )}

      {scene.npc ? <CharacterAside scene={scene} /> : null}
      {log.length ? <details className="encounter__log"><summary>本局行动记录 · {log.length} 次</summary>
        <ol>{log.map((entry, i) => entry.kind === 'action' ? <li key={i}><strong>{entry.text}</strong><p>{entry.feedback}</p></li> : null)}</ol>
      </details> : null}
      {story?.source ? <details className="encounter__source"><summary>故事来源与改编说明</summary><p>原作《{story.source.title}》 · {story.source.author || '官方接口未提供作者'} · 知乎黑客松开放内容</p><p>{story.source.adaptationNote}</p><small>作品编号 {story.source.workId}</small></details> : null}
    </section>
  );
}
