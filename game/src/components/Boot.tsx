import { useEffect, useState } from 'react';
import { useGame } from '../state/engine';

export function Boot() {
  const { booted } = useGame();
  const [meetOk, setMeetOk] = useState(true);
  useEffect(() => {
    // The judge deep-link must remain instant; the normal entrance gets one
    // stable paint so the official guide is an introduction, not a flash.
    if (new URLSearchParams(window.location.search).has('scene')) {
      booted();
      return;
    }
    const timer = window.setTimeout(booted, 720);
    return () => window.clearTimeout(timer);
  }, [booted]);

  return <main className="boot-ready" role="status" aria-live="polite">
    <span className="boot-ready__meet">
      {meetOk ? <img className="boot-ready__fox" src="/art/character/motion/liu-kanshan-wave.gif" alt="" loading="eager" decoding="async" onError={() => setMeetOk(false)} /> : null}
      <strong className="boot-ready__brand">看山任意门</strong>
      <span className="boot-ready__text">刘看山正在找那几扇亮着的门…</span>
      <span className="boot-ready__hint">他会在门口等你</span>
    </span>
  </main>;
}
