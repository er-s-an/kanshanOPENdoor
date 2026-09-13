import { useEffect, useId, useState } from 'react';
import { useGame } from '../state/engine';
import { usePrefs } from '../state/prefs';
import { useDialog } from '../lib/useDialog';

export function SettingsSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { story, backToDoor, enterStory } = useGame();
  const { prefs, patch } = usePrefs();
  const [confirm, setConfirm] = useState(false);
  const [health, setHealth] = useState('检查连接中…');
  const uid = useId();
  const panel = useDialog(open, onClose);
  useEffect(() => {
    if (!open) { setConfirm(false); return; }
    let dead = false;
    fetch('/api/health', { cache: 'no-store' }).then((r) => r.json()).then((j) => {
      if (!dead) setHealth(j.llm === 'configured' || j.llm === 'up' ? '可尝试自由对话；未接通时使用预写对白。' : '当前使用预写对白，仍可取得证言和推进故事。');
    }).catch(() => { if (!dead) setHealth('暂时没有连接上对话服务，可稍后重试。'); });
    return () => { dead = true; };
  }, [open]);
  if (!open) return null;
  return <div className="sheet-mask" onClick={onClose}><div className="utility-sheet settings-panel" ref={panel} role="dialog" aria-modal="true" aria-labelledby={`${uid}-title`} onClick={(e) => e.stopPropagation()}>
    <header className="utility-sheet__head"><div><p>按你的节奏阅读</p><h2 id={`${uid}-title`}>阅读设置</h2></div><button className="utility-sheet__close" aria-label="关闭设置" onClick={onClose}>×</button></header>
    <section className="settings-panel__group"><h3>文字呈现</h3><div className="seg" role="group" aria-label="文字呈现"><button className={!prefs.typewriter ? 'is-on' : ''} aria-pressed={!prefs.typewriter} onClick={() => patch({ typewriter: false })}>直接阅读全文</button><button className={prefs.typewriter ? 'is-on' : ''} aria-pressed={!!prefs.typewriter} onClick={() => patch({ typewriter: true })}>逐字呈现</button></div>{prefs.typewriter ? <div className="settings-panel__speed"><span>逐字速度</span><div className="seg">{(['慢', '标准', '快'] as const).map((s, i) => <button key={s} aria-pressed={prefs.speed === i} className={prefs.speed === i ? 'is-on' : ''} onClick={() => patch({ speed: i as 0 | 1 | 2 })}>{s}</button>)}</div></div> : null}</section>
    <section className="settings-panel__group"><h3>声音与动态</h3><label className="switch"><span>提示音效</span><input type="checkbox" checked={prefs.sfx} onChange={(e) => patch({ sfx: e.target.checked })} /><i aria-hidden /></label>{prefs.typewriter ? <label className="switch"><span>打字声</span><input type="checkbox" checked={prefs.tick} onChange={(e) => patch({ tick: e.target.checked })} /><i aria-hidden /></label> : null}<label className="switch"><span>减少动态效果</span><input type="checkbox" checked={prefs.calm} onChange={(e) => patch({ calm: e.target.checked })} /><i aria-hidden /></label></section>
    {story ? <section className="settings-panel__group"><h3>这次旅程</h3><button className="btn btn--ghost" onClick={() => { onClose(); backToDoor(true); }}>返回门厅，保留进度</button>{!confirm ? <button className="settings-panel__restart" onClick={() => setConfirm(true)}>从头体验《{story.story.title}》</button> : <div className="settings-panel__confirm"><p>将重新开始这一篇故事，当前进度会重置。</p><div><button className="btn btn--ghost" onClick={() => setConfirm(false)}>保留进度</button><button className="btn btn--primary" onClick={() => { onClose(); void enterStory(story.story.id, { fresh: true }); }}>确定重新开始</button></div></div>}</section> : null}
    <details className="settings-panel__connection"><summary>对话连接状态</summary><p>{health}</p></details>
    <footer className="utility-sheet__foot"><button className="btn btn--primary" onClick={onClose}>回到故事</button></footer>
  </div></div>;
}
