// 门厅：故事封面卡横向滑动选择。带“继续上次”入口（存档续玩）。
import { useEffect, useMemo, useRef, useState } from 'react';
import '../portal-ux.css';
import type { StorySummary } from '../types';
import { loadSave } from '../lib/store';
import { sfxOpen } from '../lib/sound';
import { useGame } from '../state/engine';
import { usePrefs } from '../state/prefs';

export function Doors() {
  const { stories, storyError, enterStory, refreshStories } = useGame();
  const { prefs } = usePrefs();
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [fail, setFail] = useState('');
  const [guideOk, setGuideOk] = useState(true);

  const saved = useMemo(() => loadSave(), []);
  const resumeStory = useMemo(
    () => (saved ? stories.find((s) => s.id === saved.storyId) || null : null),
    [saved, stories],
  );

  // 盐选壳页直达：?story=<id> 时跳过点选，自动推门（演示入口链路）
  const autoEntered = useRef(false);
  useEffect(() => {
    if (autoEntered.current || loadingId || !stories.length) return;
    const target = new URLSearchParams(window.location.search).get('story');
    if (!target) return;
    const aliases: Record<string, string> = { 'playable-blue': '蓝血-2025684191967294692', 'playable-myopic': '近视眼勇闯恐怖游戏-1747681485547843585' };
    const s = stories.find((x) => x.id === (aliases[target] || target));
    if (!s) return;
    autoEntered.current = true;
    void pick(s);
  }, [stories, loadingId]);

  const pick = async (s: StorySummary, resume = Boolean(loadSave(s.id))) => {
    if (loadingId) return;
    setLoadingId(s.id);
    setFail('');
    if (prefs.sfx) sfxOpen();
    try {
      await enterStory(s.id, { resume });
    } catch (err) {
      setFail(err instanceof Error ? err.message : String(err));
      setLoadingId(null);
    }
  };

  return <main className="library">
    <header className="library__head"><p className="library__brand">看山任意门 <span>知乎盐言 · 互动故事</span></p><h1>选一扇门，进入故事。</h1><p className="library__intro">与人物交谈，亲自行动。每个故事，都有它自己的玩法。</p><figure className="library__guide">{guideOk ? <img className="library__guide-img" src="/art/portal/liu-kanshan-lobby-guide.jpg" alt="" onError={() => setGuideOk(false)} /> : null}<figcaption className="library__guide-line"><b>引路人 · 刘看山</b><span>每一扇门后都是一个故事。选一扇，我为你开门引路。</span></figcaption></figure></header>
    {resumeStory && saved ? <button className="library__resume" disabled={loadingId !== null} onClick={() => void pick(resumeStory, true)} aria-label={`继续上次的旅程：${resumeStory.title}`}><span className="library__resume-icon" aria-hidden>↳</span><span><small>继续上次进度</small><strong>{resumeStory.title}</strong></span><span className="library__resume-action">继续旅程 →</span></button> : null}
    <div className="library__section"><h2>选择你的处境</h2><span>{stories.length ? `${stories.length} 个互动首章` : '正在寻找故事'}</span></div>
    {storyError && !stories.length ? <section className="library__empty" role="alert"><p>暂时没有连接上故事库。</p><button className="btn btn--primary" onClick={refreshStories}>重新加载</button></section> : null}
    <section className="library__stories" aria-label="故事列表">{stories.map((s, i) => {
      const hasSave = Boolean(loadSave(s.id));
      return <article className="library-story" key={s.id}>
        <button className="library-story__open" disabled={loadingId !== null} onClick={() => void pick(s)} aria-label={`${hasSave ? '继续' : '进入'}《${s.title}》`}>
          <span className={`library-story__folio library-story__folio--${i % 3}`} aria-hidden><img className="library-story__door library-story__door--closed" src="/art/portal/door-card-closed.jpg" alt="" loading="lazy" onError={(e) => { e.currentTarget.style.display = 'none'; }} /><img className="library-story__door library-story__door--open" src="/art/portal/door-card-open.jpg" alt="" loading="lazy" onError={(e) => { e.currentTarget.style.display = 'none'; }} /><small>STORY</small><b>{String(i + 1).padStart(2, '0')}</b><span>看山任意门</span></span>
          <span className="library-story__body"><span className="library-story__genre">{(s.tags || []).slice(0, 2).join(' / ') || '互动叙事'}</span><strong className="library-story__title">{s.title}</strong><span className="library-story__author">{s.author ? `${s.author} · 原作` : '知乎开放故事'}</span><span className="library-story__intro">{s.intro}</span><span className="library-story__enter">{loadingId === s.id ? '正在打开…' : hasSave ? '继续这个故事' : '进入这个故事'} <span aria-hidden>→</span></span></span>
        </button>
        {s.source?.sourceUrl ? <a className="library-story__source" href={s.source.sourceUrl} target="_blank" rel="noreferrer">先读开放原文 ↗</a> : null}
      </article>;
    })}{stories.length === 0 && !storyError ? <p className="library__empty" role="status">正在打开故事库…</p> : null}</section>
    {fail ? <p className="library__empty" role="alert">{fail}</p> : null}
    <footer className="library__foot">基于官方开放片段改编 · 每个首章均可独立体验</footer>
  </main>;
}
