import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { GameJson, Scene } from '../types';
import { buildStoryBriefing } from '../lib/story-briefing.mjs';
import '../story-briefing.css';

const KANSHAN_WAVE = '/art/character/motion/liu-kanshan-wave.gif';
const KANSHAN_STILL = '/art/character/reference/liu-kanshan-front-white.jpg';

export interface StoryBriefingProps {
  story: GameJson;
  scene: Scene;
  onContinue: () => void;
  onBack?: () => void;
  onSkip?: () => void;
  /** Mirrors the in-game calm preference in addition to OS reduced motion. */
  calm?: boolean;
}

export function StoryBriefing({ story, scene, onContinue, onBack, onSkip, calm = false }: StoryBriefingProps) {
  const copy = useMemo(() => buildStoryBriefing(story, scene), [story, scene]);
  const [artOk, setArtOk] = useState(true);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const titleId = useId();
  const copyId = useId();

  useLayoutEffect(() => {
    window.scrollTo(0, 0);
    titleRef.current?.focus({ preventScroll: true });
  }, [story.story.id]);

  useEffect(() => {
    if (!onBack) return;
    const handleKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      event.preventDefault();
      onBack();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onBack]);

  return <main className={`story-briefing${calm ? ' story-briefing--calm' : ''}`} aria-labelledby={titleId} aria-describedby={copyId}>
    <div className="story-briefing__glow" aria-hidden />
    {onBack ? <button className="story-briefing__back" type="button" onClick={onBack} aria-keyshortcuts="Escape">
      <span aria-hidden>←</span><span>换一扇门</span>
    </button> : null}

    <section className="story-briefing__stage">
      <figure className={`story-briefing__guide${artOk ? '' : ' story-briefing__guide--fallback'}`}>
        {artOk ? <picture>
          {!calm ? <source media="(prefers-reduced-motion: reduce)" srcSet={KANSHAN_STILL} /> : null}
          <img
            className={`story-briefing__kanshan${calm ? ' story-briefing__kanshan--still' : ''}`}
            src={calm ? KANSHAN_STILL : KANSHAN_WAVE}
            alt="刘看山站在门边向你挥手"
            loading="eager"
            decoding="async"
            onError={() => setArtOk(false)}
          />
        </picture> : <span className="story-briefing__fallback-mark" aria-hidden>看山</span>}
        <figcaption><strong>刘看山</strong><span>在门口等你</span></figcaption>
      </figure>

      <div className="story-briefing__panel">
        <p className="story-briefing__eyebrow">门内 · 刘看山留步</p>
        <h1 id={titleId} ref={titleRef} tabIndex={-1}>{copy.identity}</h1>
        <p className="story-briefing__story">《{story.story.title}》</p>

        <ol className="story-briefing__copy" id={copyId}>
          <li><span>门后</span><p>{copy.anomaly}</p></li>
          <li><span>记着</span><p>{copy.firstStep}</p></li>
        </ol>

        <div className="story-briefing__actions">
          <button className="story-briefing__continue" type="button" onClick={onContinue}>
            <span>记住了，推门进去</span><span aria-hidden>→</span>
          </button>
          {onSkip ? <button className="story-briefing__skip" type="button" onClick={onSkip}>我自己进去看看</button> : null}
        </div>
      </div>
    </section>
  </main>;
}
