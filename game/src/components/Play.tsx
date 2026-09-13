import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { Scene } from '../types';
import { useGame } from '../state/engine';
import { usePrefs } from '../state/prefs';
import { StoryView } from './StoryView';
import { ChatView } from './ChatView';
import { EndingView } from './EndingView';
import { SettingsSheet } from './SettingsSheet';
import { ClueSheet } from './ClueSheet';
import { InvestigationView } from './InvestigationView';
import { EncounterView } from './EncounterView';
import { BossView } from './BossView';

function SceneView({ scene }: { scene: Scene }) {
  if (scene.type === 'investigate') return <InvestigationView scene={scene} />;
  if (scene.type === 'encounter') return <EncounterView scene={scene} />;
  if (scene.type === 'chat') return <ChatView scene={scene} />;
  if (scene.type === 'boss') return <BossView scene={scene} />;
  if (scene.type === 'ending') return <EndingView scene={scene} />;
  return <StoryView scene={scene} />;
}
const modes: Record<Scene['type'], string> = { novel: '阅读', choice: '抉择', chat: '交谈', investigate: '调查', encounter: '行动', boss: '对线', ending: '本章收束' };

export function Play() {
  const { prefs } = usePrefs();
  const { story, scene, sceneId, vars, backToDoor } = useGame();
  const [settings, setSettings] = useState(false);
  const [clueOpen, setClueOpen] = useState(false);
  const [newRecords, setNewRecords] = useState('');
  const clues = story?.clues || [];
  const found = clues.filter((c) => vars[c.id] === 'found');
  const seen = useRef(new Set(found.map((c) => c.id)));
  const sceneRoot = useRef<HTMLDivElement>(null);
  const sceneTitle = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    const added = clues.filter((c) => vars[c.id] === 'found' && !seen.current.has(c.id));
    if (added.length) {
      added.forEach((c) => seen.current.add(c.id));
      setNewRecords(added.map((c) => c.name).join('、'));
    }
  }, [vars, clues]);
  useEffect(() => {
    if (!newRecords) return;
    const timer = window.setTimeout(() => setNewRecords(''), 3000);
    return () => window.clearTimeout(timer);
  }, [newRecords]);
  useLayoutEffect(() => {
    window.scrollTo(0, 0);
    sceneRoot.current?.querySelectorAll<HTMLElement>('.reading-scene__scroll, .chat__scroll, .chat__guide, .investigation, .boss__scroll, .ending__scroll, .encounter').forEach((element) => {
      element.scrollTop = 0;
      element.scrollLeft = 0;
    });
    sceneTitle.current?.focus({ preventScroll: true });
  }, [sceneId]);
  if (!story || !scene) return <main className="play"><div className="play__lost"><p>暂时没找到这一幕。</p><button className="btn btn--primary" onClick={() => backToDoor(true)}>返回门厅</button></div></main>;
  const chapterParts = (scene.chapter || story.story.title).split('·').map((part) => part.trim());
  const chapterTitle = chapterParts.at(-1);
  const chapterLead = chapterParts.length > 1 ? chapterParts[0] : '';
  return <main className={`play play--${scene.type}${prefs.calm ? ' play--calm' : ''}`}>
    <header className="topbar">
      <button className="topbar__back" onClick={() => backToDoor(true)} aria-label="返回门厅"><span aria-hidden>←</span><span>门厅</span></button>
      <div className="topbar__identity"><p><span className="topbar__story-name">{story.story.title}</span><span className="topbar__chapter-lead">{chapterLead}</span><span className="topbar__mode">{modes[scene.type]}</span></p><h1 ref={sceneTitle} tabIndex={-1}>{chapterTitle}</h1></div>
      <nav className="topbar__tools" aria-label="游戏工具">
        {clues.length ? <button className={`topbar__record${newRecords ? ' has-new' : ''}`} aria-label={`线索簿，已记录 ${found.length} 条`} onClick={() => { setClueOpen(true); setNewRecords(''); }}><span>记录</span><b>{found.length}</b>{newRecords ? <i aria-label="有新记录" /> : null}</button> : null}
        <button className="topbar__settings" onClick={() => setSettings(true)} aria-label="设置">设置</button>
      </nav>
    </header>
    <div className="play__scene" ref={sceneRoot} key={`${story.story.id}:${sceneId}`}><SceneView scene={scene} /></div>
    <p className="sr-only" role="status">{newRecords ? `已记下：${newRecords}` : ''}</p>
    <SettingsSheet open={settings} onClose={() => setSettings(false)} />
    <ClueSheet open={clueOpen} onClose={() => setClueOpen(false)} />
  </main>;
}
