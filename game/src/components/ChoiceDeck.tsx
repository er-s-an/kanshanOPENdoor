import type { Choice } from '../types';
import { choiceLocked } from '../lib/rules.mjs';
import { sfxClick } from '../lib/sound';
import { usePrefs } from '../state/prefs';
import { useGame } from '../state/engine';

export function ChoiceDeck({ choices, onPick, prompt, disabled }: {
  choices: Choice[]; onPick: (c: Choice) => void; prompt?: string; disabled?: boolean;
}) {
  const { prefs } = usePrefs();
  const { vars, navBusy, scene } = useGame();
  return <div className="deckbar" aria-label="选项">
    {prompt ? <p className="deckbar__prompt">{prompt}</p> : null}
    <div className="deckbar__list">{choices.map((c, index) => {
      const locked = choiceLocked(c, vars);
      const missing = Object.keys(c.requires || {}).filter((id) => vars[id] !== c.requires?.[id]);
      const item = scene?.investigation?.items.find((entry) => missing.includes(entry.clue));
      const topic = scene?.dialogue?.topics.find((entry) => entry.grants?.some((id) => missing.includes(id)) && Object.entries(entry.requires || {}).every(([id, value]) => vars[id] === value));
      const check = scene?.investigation?.checks.find((entry) => entry.grants.some((id) => missing.includes(id)));
      const hint = item ? `先查看「${item.title}」` : topic ? `可以先问：${topic.prompt}` : check ? '先核对这一幕的记录，再作决定' : locked;
      return <button key={c.id} className={`deckbar__btn${locked ? ' deckbar__btn--locked' : ''}`} disabled={Boolean(locked) || navBusy || disabled} onClick={() => { if (prefs.sfx) sfxClick(); onPick(c); }}>
        <span className="deckbar__num" aria-hidden>{String(index + 1).padStart(2, '0')}</span>
        <span className="deckbar__text">{c.text}{locked ? <span className="deckbar__lockhint">{hint}</span> : null}</span>
        <span className="deckbar__arrow" aria-hidden>{locked ? '待完成' : '→'}</span>
      </button>;
    })}</div>
  </div>;
}
