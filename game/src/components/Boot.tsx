import { useEffect, useState } from 'react';
import { useGame } from '../state/engine';

export function Boot() {
  const { booted } = useGame();
  const [meetOk, setMeetOk] = useState(true);
  useEffect(() => { booted(); }, [booted]);
  return <main className="boot-ready" role="status"><span className="boot-ready__meet">{meetOk ? <img className="boot-ready__fox" src="/art/character/motion/liu-kanshan-wave.gif" alt="" onError={() => setMeetOk(false)} /> : null}<span className="boot-ready__text">正在打开故事…</span><span className="boot-ready__hint">刘看山正在门后向你招手</span></span></main>;
}
