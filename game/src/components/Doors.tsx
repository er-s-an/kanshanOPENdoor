// 门厅：每个真实入口都由按钮承载；选门后先完成开门演出，再进入故事。
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import '../portal-ux.css';
import type { StorySummary } from '../types';
import { loadSave } from '../lib/store';
import { sfxOpen } from '../lib/sound';
import { useGame } from '../state/engine';
import { usePrefs } from '../state/prefs';

const BLUE_STORY_ID = '蓝血-2025684191967294692';
const TRANSITION_ART = '/art/portal/liu-kanshan-opening-door-transition-v2.png';
const BLUE_COVER = '/art/blue/blue-cover.jpg';
const BLUE_FIRST_SCENE = '/art/blue/blue-training-hall.jpg';
const CLOSED_DOOR = '/art/portal/door-card-closed.jpg';
const OPEN_DOOR = '/art/portal/door-card-open.jpg';
const MYOPIA_EXPERIENCE_ID = 'myopia-3d';
const MYOPIA_TITLE = '近视眼勇闯恐怖游戏';
const CONSORT_EXPERIENCE_ID = 'consort-3d';
const CONSORT_TITLE = '端妃黑又壮';
const PORTAL_EXPERIENCES: Record<string, { id: string; title: string }> = {
  [MYOPIA_EXPERIENCE_ID]: { id: MYOPIA_EXPERIENCE_ID, title: MYOPIA_TITLE },
  [CONSORT_EXPERIENCE_ID]: { id: CONSORT_EXPERIENCE_ID, title: CONSORT_TITLE },
};
const STORY_ALIASES: Record<string, string> = {
  'playable-blue': BLUE_STORY_ID,
  'playable-myopic': '近视眼勇闯恐怖游戏-1747681485547843585',
};

// Re-entering the lobby during one SPA visit should not replay onboarding.
// A full page load intentionally introduces Liu Kanshan again.
let portalIntroduced = false;

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
      <span>刘看山正在推门</span>
      <strong>正在为你打开《{entry.title}》</strong>
      <i aria-hidden><b /></i>
    </div>
  </section>;
}

export function Doors() {
  const { stories, storyError, enterStory, refreshStories } = useGame();
  const { prefs } = usePrefs();
  const judgeBypass = new URLSearchParams(window.location.search).has('scene');
  const linkedStoryId = new URLSearchParams(window.location.search).get('story');
  const [showWelcome, setShowWelcome] = useState(() => !judgeBypass && !portalIntroduced);
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [entry, setEntry] = useState<EntryState | null>(null);
  const [fail, setFail] = useState('');
  const [guideOk, setGuideOk] = useState(true);
  const enteringRef = useRef(false);
  const welcomeHeadingRef = useRef<HTMLHeadingElement>(null);
  const libraryHeadingRef = useRef<HTMLHeadingElement>(null);
  const linkedStoryRef = useRef<HTMLButtonElement>(null);
  const focusLibraryRef = useRef(false);

  const saved = useMemo(() => loadSave(), []);
  const featuredStories = useMemo(() => {
    const blue = stories.find((story) => story.id === BLUE_STORY_ID) || stories.find(isBlue);
    return blue ? [blue] : [];
  }, [stories]);
  const resumeStory = useMemo(
    () => (saved ? featuredStories.find((s) => s.id === saved.storyId) || null : null),
    [featuredStories, saved],
  );
  const linkedDoor = useMemo(() => {
    if (!linkedStoryId) return null;
    const experience = PORTAL_EXPERIENCES[linkedStoryId];
    if (experience) return experience;
    const resolvedId = STORY_ALIASES[linkedStoryId] || linkedStoryId;
    return featuredStories.find((story) => story.id === resolvedId) || null;
  }, [featuredStories, linkedStoryId]);

  useEffect(() => {
    // Only the one entrance still and the flagship cover are warmed here.
    // Character motion remains strictly state-driven and is not bulk-loaded.
    void preloadImage(TRANSITION_ART);
    void preloadImage(BLUE_COVER);
  }, []);

  useEffect(() => {
    if (showWelcome) welcomeHeadingRef.current?.focus();
    else if (focusLibraryRef.current) {
      focusLibraryRef.current = false;
      window.requestAnimationFrame(() => (linkedStoryRef.current || libraryHeadingRef.current)?.focus());
    }
  }, [showWelcome]);

  const revealLibrary = useCallback(() => {
    portalIntroduced = true;
    focusLibraryRef.current = true;
    setShowWelcome(false);
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

  const pick3DExperience = useCallback(async (id: string, title: string, destination: string) => {
    if (enteringRef.current) return;
    enteringRef.current = true;
    setLoadingId(id);
    setFail('');
    setEntry({ title });
    if (prefs.sfx) sfxOpen();
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    await wait(reduceMotion ? 180 : 650);
    // The independently authored PS1 experiences are packed under stable
    // paths during `npm run build:experiences`.
    window.location.assign(new URL(destination, window.location.href).toString());
  }, [prefs.sfx]);

  const pickMyopia = useCallback(() => pick3DExperience(MYOPIA_EXPERIENCE_ID, MYOPIA_TITLE, 'myopia-3d/'), [pick3DExperience]);
  const pickConsort = useCallback(() => pick3DExperience(CONSORT_EXPERIENCE_ID, CONSORT_TITLE, 'myopia-3d/end-consort.html'), [pick3DExperience]);

  // Only the explicit review shortcut may bypass the welcome and door choice.
  // A normal ?story= link merely highlights that door after Liu Kanshan's welcome.
  const autoEntered = useRef(false);
  useEffect(() => {
    if (autoEntered.current || !stories.length) return;
    const params = new URLSearchParams(window.location.search);
    if (!params.has('scene')) return;
    const target = params.get('story');
    if (!target) return;
    const s = featuredStories.find((x) => x.id === (STORY_ALIASES[target] || target));
    if (!s) return;
    autoEntered.current = true;
    void pick(s);
  }, [featuredStories, pick]);

  if (showWelcome) {
    const heading = linkedDoor
      ? `我替你守着《${linkedDoor.title}》的门。`
      : '先别急着进故事。让我带你认认这里。';
    const message = linkedDoor
      ? '有人把这扇门送到了你面前。我先带你去门前，你看清楚以后，再决定要不要进去。'
      : '每扇门后，都有人困在一个还没想明白的问题里。进去以后，你会借他的眼睛看，用他的身份说话。';
    return <main className="library library--welcome">
      <section className="portal-welcome" aria-labelledby="portal-welcome-title">
        <figure className="portal-welcome__figure">
          {guideOk ? <img src="/art/character/motion/liu-kanshan-wave.gif" alt="刘看山站在任意门前向你挥手" loading="eager" decoding="async" onError={() => setGuideOk(false)} /> : <span className="portal-welcome__fallback">刘看山</span>}
          <figcaption>刘看山 · 在门口等你</figcaption>
        </figure>
        <div className="portal-welcome__copy">
          <p className="portal-welcome__eyebrow">看山任意门</p>
          <h1 id="portal-welcome-title" ref={welcomeHeadingRef} tabIndex={-1}>{heading}</h1>
          <div className="portal-welcome__speech">
            <strong>我是刘看山。</strong>
            <p>{message}</p>
            <p>选好一扇，我替你把门推开。</p>
          </div>
          <button className="btn btn--primary btn--lg portal-welcome__action" type="button" onClick={revealLibrary}>
            {linkedDoor ? `先看看《${linkedDoor.title}》` : '去选一扇门'} <span aria-hidden>→</span>
          </button>
          <small>{featuredStories.length ? '前面亮着 3 扇门' : '前面的灯还没亮'}</small>
        </div>
      </section>
    </main>;
  }

  return <main className="library" aria-busy={loadingId !== null}>
    <header className="library__head"><p className="library__brand">看山任意门 <span>知乎盐言 · 互动故事</span></p><h1 ref={libraryHeadingRef} tabIndex={-1}>现在，选一扇你想推开的门。</h1><p className="library__intro">先看清它通往哪里；选好以后，刘看山会替你开门。</p><p className="library__guide-note"><b>刘看山</b><span>{linkedDoor ? `我替你标出了《${linkedDoor.title}》的门，但最后由你决定。` : '不用赶时间。故事会记住你的进度。'}</span></p></header>
    {resumeStory && saved ? <button className="library__resume" disabled={loadingId !== null} onClick={() => void pick(resumeStory, true)} aria-label={`继续上次的旅程：${resumeStory.title}`}><span className="library__resume-icon" aria-hidden>↳</span><span><small>继续上次进度</small><strong>{resumeStory.title}</strong></span><span className="library__resume-action">继续旅程 →</span></button> : null}
    <div className="library__section"><h2>选择你的处境</h2><span>{featuredStories.length ? '3 座可进入的故事世界' : '正在点亮第一扇门'}</span></div>
    {storyError && !featuredStories.length ? <section className="library__empty" role="alert"><p>暂时没有连接上故事库。</p><button className="btn btn--primary" onClick={refreshStories}>重新加载</button></section> : null}
    <section className="library__stories" aria-label="故事列表">{featuredStories.map((s, i) => {
      const hasSave = Boolean(loadSave(s.id));
      const flagship = isBlue(s);
      const opening = loadingId === s.id;
      return <article className={`library-story${opening ? ' is-opening' : ''}`} key={s.id}>
        <button ref={linkedDoor?.id === s.id ? linkedStoryRef : undefined} className={`library-story__open${linkedDoor?.id === s.id ? ' is-linked' : ''}`} disabled={loadingId !== null} onClick={() => void pick(s)} aria-label={`${hasSave ? '继续' : '进入'}《${s.title}》`} aria-busy={opening}>
          <span className={`library-story__folio library-story__folio--${i % 3}${flagship ? ' library-story__folio--cover' : ''}`} aria-hidden>
            {flagship ? <img className="library-story__cover-image" src={BLUE_COVER} alt="" loading="eager" decoding="async" onError={(e) => { e.currentTarget.style.display = 'none'; }} /> : <><img className="library-story__door library-story__door--closed" src={CLOSED_DOOR} alt="" loading="lazy" decoding="async" onError={(e) => { e.currentTarget.style.display = 'none'; }} /><img className="library-story__door library-story__door--open" src={OPEN_DOOR} alt="" loading="lazy" decoding="async" onError={(e) => { e.currentTarget.style.display = 'none'; }} /></>}
            <small>{flagship ? '旗舰故事' : 'STORY'}</small><b>{String(i + 1).padStart(2, '0')}</b><span>{opening ? '门已打开' : '看山任意门'}</span>
          </span>
          <span className="library-story__body"><span className="library-story__genre">{(s.tags || []).slice(0, 2).join(' / ') || '互动叙事'}</span><strong className="library-story__title">{s.title}</strong><span className="library-story__author">{s.author ? `${s.author} · 原作` : '知乎开放故事'}</span><span className="library-story__intro">{s.intro}</span><span className="library-story__enter">{loadingId === s.id ? '正在打开…' : hasSave ? '继续这个故事' : '进入这个故事'} <span aria-hidden>→</span></span></span>
        </button>
        {s.source?.sourceUrl ? <a className="library-story__source" href={s.source.sourceUrl} target="_blank" rel="noreferrer">先读开放原文 ↗</a> : null}
      </article>;
    })}
      <article className={`library-story library-story--myopia${loadingId === MYOPIA_EXPERIENCE_ID ? ' is-opening' : ''}`}>
        <button ref={linkedDoor?.id === MYOPIA_EXPERIENCE_ID ? linkedStoryRef : undefined} className={`library-story__open${linkedDoor?.id === MYOPIA_EXPERIENCE_ID ? ' is-linked' : ''}`} disabled={loadingId !== null} onClick={() => void pickMyopia()} aria-label={`进入 3D 体验《${MYOPIA_TITLE}》`} aria-busy={loadingId === MYOPIA_EXPERIENCE_ID}>
          <span className="library-story__folio library-story__folio--myopia" aria-hidden><small>3D FIRST PERSON</small><b>02</b><span>{loadingId === MYOPIA_EXPERIENCE_ID ? '门已打开' : 'PS1 沉浸体验'}</span></span>
          <span className="library-story__body"><span className="library-story__genre">3D 沉浸 / 恐怖生存</span><strong className="library-story__title">{MYOPIA_TITLE}</strong><span className="library-story__author">沈南因 · 原作</span><span className="library-story__intro">一米之外皆是雾。你可以眯眼看清，也要承担看清之后的恐惧。</span><span className="library-story__enter">{loadingId === MYOPIA_EXPERIENCE_ID ? '正在打开…' : '进入 3D 首章'} <span aria-hidden>→</span></span></span>
        </button>
        <span className="library-story__source">独立网页 3D · 当前为开放首章</span>
      </article>
      <article className={`library-story library-story--consort${loadingId === CONSORT_EXPERIENCE_ID ? ' is-opening' : ''}`}>
        <button ref={linkedDoor?.id === CONSORT_EXPERIENCE_ID ? linkedStoryRef : undefined} className={`library-story__open${linkedDoor?.id === CONSORT_EXPERIENCE_ID ? ' is-linked' : ''}`} disabled={loadingId !== null} onClick={() => void pickConsort()} aria-label={`进入 3D 体验《${CONSORT_TITLE}》`} aria-busy={loadingId === CONSORT_EXPERIENCE_ID}>
          <span className="library-story__folio library-story__folio--consort" aria-hidden><small>3D COURTYARD</small><b>03</b><span>{loadingId === CONSORT_EXPERIENCE_ID ? '门已打开' : 'PS1 庭院篇章'}</span></span>
          <span className="library-story__body"><span className="library-story__genre">3D 沉浸 / 宫廷日常</span><strong className="library-story__title">{CONSORT_TITLE}</strong><span className="library-story__author">重十八 · 原作</span><span className="library-story__intro">走进景华宫，安顿宫人、翻土播种、洗手下棋，把日子一件件过好。</span><span className="library-story__enter">{loadingId === CONSORT_EXPERIENCE_ID ? '正在打开…' : '进入 3D 开放篇章'} <span aria-hidden>→</span></span></span>
        </button>
        <span className="library-story__source">独立网页 3D · 当前为开放篇章</span>
      </article>
      {featuredStories.length === 0 && !storyError ? <p className="library__empty" role="status">正在打开故事库…</p> : null}</section>
    {fail ? <p className="library__empty" role="alert">{fail}</p> : null}
    <footer className="library__foot">基于官方开放片段改编 · 每个首章均可独立体验</footer>
    {entry ? <PortalEntry entry={entry} /> : null}
  </main>;
}
