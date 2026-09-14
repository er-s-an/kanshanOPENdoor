import { useState } from 'react';
import type { Scene } from '../types';
import { sfxClick } from '../lib/sound';
import { useGame } from '../state/engine';
import { usePrefs } from '../state/prefs';
import { ChoiceDeck } from './ChoiceDeck';
import { SceneVisual } from './SceneVisual';
import { TypedProse } from './TypedProse';

export function StoryView({ scene }: { scene: Scene }) {
  const { nextSceneOf, continueKind, chooseAndNav, nav, navBusy } = useGame();
  const { prefs } = usePrefs();
  const [typed, setTyped] = useState(!scene.text || !prefs.typewriter);
  const next = nextSceneOf(scene);
  const kind = continueKind(scene);
  const hasChoices = Boolean(scene.choices?.length);
  return (
    <section className="reading-scene" aria-label="故事正文">
      <div className="reading-scene__scroll">
        {scene.image ? <SceneVisual scene={scene} fallbackLabel="当前章节" className="reading-scene__visual" /> : null}
        <article className="reading-scene__body">
          {scene.type === 'choice' ? <div className="reading-scene__eyebrow">你停了一下</div> : null}
          {scene.objective ? <p className="reading-scene__lead">{scene.objective}</p> : null}
          {scene.text ? <TypedProse md={scene.text} autoTick onDone={setTyped} /> : null}
          {typed && (kind === 'deck' || hasChoices) ? <ChoiceDeck choices={scene.choices || []} onPick={chooseAndNav} prompt="接下来，你会怎么做？" /> : null}
          {kind === 'next' && next && !hasChoices ? <div className="reading-scene__next">
            <button className="btn btn--primary btn--lg" disabled={!typed || navBusy} onClick={() => { if (prefs.sfx) sfxClick(); nav(next); }}>
              {scene.continueLabel || '继续故事'} <span aria-hidden>→</span>
            </button>
          </div> : null}
        </article>
      </div>
    </section>
  );
}
