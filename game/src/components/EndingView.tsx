// Chapter closure keeps the result and next step ahead of optional records and keepsakes.
import { useEffect, useRef, useState } from 'react';
import type { Scene } from '../types';
import { buildReport } from '../lib/report';
import { choiceLocked } from '../lib/rules.mjs';
import { sfxChime } from '../lib/sound';
import { useGame } from '../state/engine';
import { usePrefs } from '../state/prefs';
import { TypedProse } from './TypedProse';
import { Poster, ENDING_RATING_LABEL } from './Poster';
import { SceneVisual } from './SceneVisual';
import '../ending-ux.css';

export function EndingView({ scene }: { scene: Scene }) {
  const { story, vars, memo, enterStory, backToDoor, chooseAndNav, navBusy } = useGame();
  const { prefs } = usePrefs();
  const [typed, setTyped] = useState(!scene.text);
  const [posterOpen, setPosterOpen] = useState(false);
  const [confirmRestart, setConfirmRestart] = useState(false);
  const [restarting, setRestarting] = useState(false);
  const [restartError, setRestartError] = useState('');
  const sounded = useRef(false);
  const restartButton = useRef<HTMLButtonElement>(null);
  const cancelButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!typed || sounded.current) return;
    sounded.current = true;
    if (prefs.sfx) sfxChime();
  }, [typed, prefs.sfx]);

  useEffect(() => {
    if (confirmRestart) cancelButton.current?.focus();
  }, [confirmRestart]);

  if (!story) return null;
  const report = buildReport(story, scene, vars, memo);
  const records = report.lines.filter((line) => line.value.trim());
  const decisions = records.find((line) => line.label === '你作出的决定');
  const actions = records.find((line) => line.label === '行动与后果');
  const recap = decisions
    ? decisions.value.split('\n').filter(Boolean).slice(-2).map((line) => line.replace(/^·\s*/, ''))
    : actions
      ? actions.value.split('\n\n').filter(Boolean).slice(-1).map((line) => line.replace(/^·\s*/, ''))
      : [records.find((line) => line.label === '本次穿越')?.value || '这一次的经历已经留在记录里。'];

  const cancelRestart = () => {
    if (restarting) return;
    setConfirmRestart(false);
    setRestartError('');
    window.requestAnimationFrame(() => restartButton.current?.focus());
  };

  const restart = async () => {
    if (restarting || navBusy) return;
    setRestarting(true);
    setRestartError('');
    try {
      await enterStory(story.story.id, { fresh: true });
    } catch {
      setRestartError('这次没有打开故事，原有记录仍保留。可以再试一次，或取消重开。');
    } finally {
      setRestarting(false);
    }
  };

  return (
    <section className="ending ending--refined">
      <div className="ending__scroll">
        <div className="ending__body">
          {scene.image ? <SceneVisual scene={scene} fallbackLabel={report.meta.title || story.story.title} variant="ending" className="ending__visual" /> : null}
          {scene.text ? <div className="ending-read"><TypedProse md={scene.text} autoTick onDone={setTyped} /></div> : null}

          {typed ? <>
            <header className="ending-result">
              <p className="ending-result__eyebrow">{story.source?.scope === 'excerpt' ? '首章 · 阶段收束' : '本局结果'}</p>
              <h2>{report.meta.title}</h2>
              {report.meta.rating ? <p className={`ending-result__rating ending-result__rating--${report.meta.rating}`}>{ENDING_RATING_LABEL[report.meta.rating]}</p> : null}
              {report.meta.tone ? <p className="ending-result__tone">{report.meta.tone}</p> : null}
              {story.source?.scope === 'excerpt' ? <p className="ending-result__scope">故事仍未结束，这里是本次体验的阶段结果。</p> : null}
            </header>

            <section className="ending-recap" aria-labelledby="ending-recap-title">
              <h2 id="ending-recap-title">{decisions ? '你留下的选择' : actions ? '你做过的事' : '这一次的经历'}</h2>
              <ul>{recap.map((line, index) => <li key={index}>{line}</li>)}</ul>
              {report.clueFound > 0 ? <p className="ending-recap__note">已记下 {report.clueFound} 条线索。</p> : null}
            </section>

            {scene.choices?.length ? <section className="ending-next-choices" aria-labelledby="ending-next-title">
              <h2 id="ending-next-title">接下来，你决定</h2>
              <div className="ending-next-choices__list">{scene.choices.map((choice) => {
                const locked = choiceLocked(choice, vars);
                return <button key={choice.id} className="ending-next-choice" disabled={Boolean(locked) || navBusy || restarting} onClick={() => chooseAndNav(choice)}>
                  <span>{choice.text}{locked ? <small>{locked}</small> : null}</span><span aria-hidden>→</span>
                </button>;
              })}</div>
            </section> : null}

            <nav className="ending-next" aria-label="章节结束后的操作">
              <button className="btn btn--primary" disabled={navBusy || restarting} onClick={() => backToDoor(true)}>回到门厅，看看其他故事 <span aria-hidden>→</span></button>
              <p>本次进度会保留，回来仍可查看这个结果。</p>
              <div className="ending-next__secondary">
                <button ref={restartButton} className="btn btn--ghost" disabled={navBusy || confirmRestart || restarting} onClick={() => setConfirmRestart(true)}>重新体验这一章</button>
                {story.source?.sourceUrl ? <a className="btn btn--ghost" href={story.source.sourceUrl} target="_blank" rel="noreferrer">阅读开放原文 <span aria-hidden>↗</span></a> : null}
              </div>
            </nav>

            {confirmRestart ? <section className="ending-restart" aria-labelledby="ending-restart-title" onKeyDown={(event) => {
              if (event.key === 'Escape') { event.preventDefault(); cancelRestart(); }
            }}>
              <h2 id="ending-restart-title">从开头再来一次？</h2>
              <p>重新开始会替换《{story.story.title}》当前这次的进度、对话与选择记录。其他故事的进度不受影响。</p>
              <div>
                <button ref={cancelButton} className="btn btn--ghost" disabled={restarting} onClick={cancelRestart}>保留本次记录</button>
                <button className="btn btn--primary" disabled={navBusy || restarting} onClick={() => void restart()}>{restarting ? '正在打开故事…' : '确认重新开始'}</button>
              </div>
              {restartError ? <p className="ending-restart__error" role="alert">{restartError}</p> : null}
            </section> : null}

            <div className="ending-extras">
              <details className="ending-extra">
                <summary>回看完整记录与改编说明</summary>
                <dl className="ending-records">{records.map((line, index) => <div key={index}>
                  <dt>{line.label}</dt><dd>{line.value}</dd>
                </div>)}</dl>
              </details>
              <details className="ending-extra" onToggle={(event) => setPosterOpen(event.currentTarget.open)}>
                <summary>生成本次纪念卡 <span>可选</span></summary>
                {posterOpen ? <div className="ending-keepsake"><Poster storyTitle={story.story.title} report={report} /></div> : null}
              </details>
            </div>
          </> : null}
        </div>
      </div>
    </section>
  );
}
