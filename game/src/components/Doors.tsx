// 门厅：每个真实入口都由按钮承载；选门后先完成开门演出，再进入故事。
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import '../portal-ux.css';
import type { StorySummary } from '../types';
import { loadSave } from '../lib/store';
import { sfxOpen } from '../lib/sound';
import { useGame } from '../state/engine';
import { usePrefs } from '../state/prefs';

const BLUE_STORY_ID = '蓝血-2025684191967294692';
const TRANSITION_ART = '/art/portal/liu-kanshan-opening-door-transition.jpg';
const BLUE_COVER = '/art/blue/blue-cover.jpg';
const BLUE_FIRST_SCENE = '/art/blue/blue-training-hall.jpg';
const CLOSED_DOOR = '/art/portal/door-card-closed.jpg';
const OPEN_DOOR = '/art/portal/door-card-open.jpg';

type EntryState = { title: string };

const imageLoads = new Map<string, Promise<void>>();
function preloadImage(src: string): Promise<void> {
  const cached = imageLoads.get(src);
  if (cached) return cached;
  const load = new Promise<void>((resolve) => {
    const image = new Image();
    image.decoding = 'async';
    image.onload = () => { void image.decode().catch(() => undefined).finally(resolve); };
    image.onerror = () => resolve();
    image.src = src;
  });
  imageLoads.set(src, load);
  return load;
}

const wait = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms));
const isBlue = (story: StorySummary) => story.id === BLUE_STORY_ID || story.id === 'playable-blue';
const coverFor = (story: StorySummary) => isBlue(story) ? BLUE_COVER : CLOSED_DOOR;
const firstSceneFor = (story: StorySummary) => isBlue(story) ? BLUE_FIRST_SCENE : '';

function PortalEntry({ entry }: { entry: EntryState }) {
  return <section className="portal-entry" role="status" aria-live="polite" aria-label={`正在打开《${entry.title}》`}>
    <div className="portal-entry__backdrop" aria-hidden />
    <img className="portal-entry__art" src={TRANSITION_ART} alt="" decoding="async" />
    <div className="portal-entry__veil" aria-hidden />
    <div className="portal-entry__copy">
      <span>系统引导·刘看山</span>
      <strong>正在为你打开《{entry.title}》</strong>
      <i aria-hidden><b /></i>
    </div>
  </section>;
}

export function Doors() {
  const { stories, storyError, enterStory, refreshStories } = useGame();
  const { prefs } = usePrefs();
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [entry, setEntry] = useState<EntryState | null>(null);
  const [fail, setFail] = useState('');
  const [guideOk, setGuideOk] = useState(true);
  const enteringRef = useRef(false);

  const saved = useMemo(() => loadSave(), []);
  const resumeStory = useMemo(
    () => (saved ? stories.find((s) => s.id === saved.storyId) || null : null),
    [saved, stories],
  );

  useEffect(() => {
    // Only the one entrance still and the flagship cover are warmed here.
    // Character motion remains strictly state-driven and is not bulk-loaded.
    void preloadImage(TRANSITION_ART);
    void preloadImage(BLUE_COVER);
  }, []);

  const pick = useCallback(async (story: StorySummary, resume = Boolean(loadSave(story.id))) => {
    if (enteringRef.current) return;
    enteringRef.current = true;
    setLoadingId(story.id);
    setFail('');

    const judgeBypass = new URLSearchParams(window.location.search).has('scene');
    if (!judgeBypass) {
      setEntry({ title: story.title });
      if (prefs.sfx) sfxOpen();
      const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      const critical = [TRANSITION_ART, coverFor(story), firstSceneFor(story)].filter(Boolean);
      const warmed = Promise.allSettled(critical.map(preloadImage));
      // Keep the transition readable, but never let a failed/slow image hold the door forever.
      await Promise.all([wait(reduceMotion ? 180 : 650), Promise.race([warmed, wait(1200)])]);
    }

    try {
      await enterStory(story.id, { resume });
    } catch (err) {
      setFail(err instanceof Error ? err.message : String(err));
      setEntry(null);
      setLoadingId(null);
      enteringRef.current = false;
    }
  }, [enterStory, prefs.sfx]);

  // 盐选壳页直达：?story=<id> 时跳过点选，自动推门（演示入口链路）
  const autoEntered = useRef(false);
  useEffect(() => {
    if (autoEntered.current || !stories.length) return;
    const target = new URLSearchParams(window.location.search).get('story');
    if (!target) return;
    const aliases: Record<string, string> = { 'playable-blue': '蓝血-2025684191967294692', 'playable-myopic': '近视眼勇闯恐怖游戏-1747681485547843585' };
    const s = stories.find((x) => x.id === (aliases[target] || target));
    if (!s) return;
    autoEntered.current = true;
    void pick(s);
  }, [pick, stories]);

  return <main className="library" aria-busy={loadingId !== null}>
    <header className="library__head"><p className="library__brand">看山任意门 <span>知乎盐言 · 互动故事</span></p><h1>选一扇门，进入故事。</h1><p className="library__intro">与人物交谈，亲自行动。每个故事，都有它自己的玩法。</p><figure className="library__guide">{guideOk ? <img className="library__guide-img" src="/art/portal/liu-kanshan-lobby-guide.jpg" alt="" loading="eager" decoding="async" onError={() => setGuideOk(false)} /> : null}<figcaption className="library__guide-line"><b>系统引导·刘看山</b><span>每一扇门后都是一个故事。选好以后，我会为你打开通往这篇故事的门。</span></figcaption></figure></header>
    {resumeStory && saved ? <button className="library__resume" disabled={loadingId !== null} onClick={() => void pick(resumeStory, true)} aria-label={`继续上次的旅程：${resumeStory.title}`}><span className="library__resume-icon" aria-hidden>↳</span><span><small>继续上次进度</small><strong>{resumeStory.title}</strong></span><span className="library__resume-action">继续旅程 →</span></button> : null}
    <div className="library__section"><h2>选择你的处境</h2><span>{stories.length ? `${stories.length} 个互动首章` : '正在寻找故事'}</span></div>
    {storyError && !stories.length ? <section className="library__empty" role="alert"><p>暂时没有连接上故事库。</p><button className="btn btn--primary" onClick={refreshStories}>重新加载</button></section> : null}
    <section className="library__stories" aria-label="故事列表">{stories.map((s, i) => {
      const hasSave = Boolean(loadSave(s.id));
      const flagship = isBlue(s);
      const opening = loadingId === s.id;
      return <article className={`library-story${opening ? ' is-opening' : ''}`} key={s.id}>
        <button className="library-story__open" disabled={loadingId !== null} onClick={() => void pick(s)} aria-label={`${hasSave ? '继续' : '进入'}《${s.title}》`} aria-busy={opening}>
          <span className={`library-story__folio library-story__folio--${i % 3}${flagship ? ' library-story__folio--cover' : ''}`} aria-hidden>
            {flagship ? <img className="library-story__cover-image" src={BLUE_COVER} alt="" loading="eager" decoding="async" onError={(e) => { e.currentTarget.style.display = 'none'; }} /> : <><img className="library-story__door library-story__door--closed" src={CLOSED_DOOR} alt="" loading="lazy" decoding="async" onError={(e) => { e.currentTarget.style.display = 'none'; }} /><img className="library-story__door library-story__door--open" src={OPEN_DOOR} alt="" loading="lazy" decoding="async" onError={(e) => { e.currentTarget.style.display = 'none'; }} /></>}
            <small>{flagship ? '旗舰故事' : 'STORY'}</small><b>{String(i + 1).padStart(2, '0')}</b><span>{opening ? '门已打开' : '看山任意门'}</span>
          </span>
          <span className="library-story__body"><span className="library-story__genre">{(s.tags || []).slice(0, 2).join(' / ') || '互动叙事'}</span><strong className="library-story__title">{s.title}</strong><span className="library-story__author">{s.author ? `${s.author} · 原作` : '知乎开放故事'}</span><span className="library-story__intro">{s.intro}</span><span className="library-story__enter">{loadingId === s.id ? '正在打开…' : hasSave ? '继续这个故事' : '进入这个故事'} <span aria-hidden>→</span></span></span>
        </button>
        {s.source?.sourceUrl ? <a className="library-story__source" href={s.source.sourceUrl} target="_blank" rel="noreferrer">先读开放原文 ↗</a> : null}
      </article>;
    })}{stories.length === 0 && !storyError ? <p className="library__empty" role="status">正在打开故事库…</p> : null}</section>
    {fail ? <p className="library__empty" role="alert">{fail}</p> : null}
    <footer className="library__foot">基于官方开放片段改编 · 每个首章均可独立体验</footer>
    {entry ? <PortalEntry entry={entry} /> : null}
  </main>;
}
