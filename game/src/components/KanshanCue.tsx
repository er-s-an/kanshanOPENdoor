import type { KanshanCueData } from '../types';
import '../kanshan-cue.css';

const DEFAULT_MOTION = '/art/character/motion/liu-kanshan-computer.gif';
const STILL_ART = '/art/character/reference/liu-kanshan-front-green.jpg';

export function KanshanCue({ cue, className = '' }: { cue?: KanshanCueData; className?: string }) {
  if (!cue?.lines?.length) return null;
  return (
    <aside className={`kanshan-cue ${className}`.trim()} aria-label="刘看山的话">
      <picture className="kanshan-cue__character">
        <source media="(prefers-reduced-motion: reduce)" srcSet={STILL_ART} />
        <img src={cue.art || DEFAULT_MOTION} alt="" width="320" height="320" decoding="async" />
      </picture>
      <div className="kanshan-cue__copy">
        <p className="kanshan-cue__label">{cue.label || '刘看山'}</p>
        {cue.lines.slice(0, 2).map((line, index) => <p key={`${index}:${line}`}>{line}</p>)}
      </div>
    </aside>
  );
}
