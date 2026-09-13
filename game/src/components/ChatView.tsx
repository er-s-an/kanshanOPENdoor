// NPC expression is free-form; compiled testimony alone owns investigation facts.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import type { ChatTurn, Choice, Scene } from '../types';
import { streamChat } from '../lib/api';
import { FOX_NAME } from '../lib/config';
import { choiceLocked } from '../lib/rules.mjs';
import { renderMarkdown } from '../lib/md';
import { useStickToBottom } from '../lib/useStick';
import { loadSave } from '../lib/store';
import { sfxClick } from '../lib/sound';
import { useGame } from '../state/engine';
import { usePrefs } from '../state/prefs';
import Art from './Art';
import { ChoiceDeck } from './ChoiceDeck';
import '../chat-ux.css';

interface BubbleTurn extends ChatTurn { stream?: boolean; topicId?: string }
const normalize = (value: string) => value.normalize('NFKC').toLocaleLowerCase().replace(/\s+/g, '');
const nameHue = (name: string) => {
  let hash = 0;
  for (const ch of name) hash = (hash * 33 + (ch.codePointAt(0) || 0)) >>> 0;
  return hash % 360;
};
const commentAvatarStyle = (name: string): CSSProperties => {
  const hue = nameHue(name);
  return { background: `linear-gradient(140deg, hsl(${hue} 34% 32%), hsl(${(hue + 46) % 360} 36% 21%))` };
};

export function ChatView({ scene }: { scene: Scene }) {
  const { story, vars, nextSceneOf, continueKind, nav, memo, saveChat, judge, chooseAndNav, grantVars, navBusy } = useGame();
  const { prefs } = usePrefs();
  const npc = useMemo(() => story?.npcs?.find((entry) => entry.id === scene.npc), [story, scene.npc]);
  const npcName = npc?.name || '神秘人';
  const topics = scene.dialogue?.topics || [];
  const requiredClues = scene.dialogue?.requiredClues || [];
  const isDialogue = !!scene.dialogue;
  const init = useMemo(() => {
    if (judge) return null;
    const save = loadSave(story?.story.id);
    return save?.chats?.[scene.id] ?? (save?.chat?.sceneId === scene.id ? save.chat : null);
  }, [judge, scene.id, story?.story.id]);
  const [turns, setTurns] = useState<BubbleTurn[]>(() => {
    if (init?.turns?.length) return init.turns.filter((turn) => turn.role !== 'system');
    const first = npc?.card?.first_mes?.trim();
    return first ? [{ role: 'assistant', content: first }] : [];
  });
  const [legacyGoal, setLegacyGoal] = useState(init?.goalMet === true);
  const [failStreak, setFailStreak] = useState(init?.failedStreak ?? 0);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [deckOpen, setDeckOpen] = useState(false);
  const [degraded, setDegraded] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);
  const [showLatest, setShowLatest] = useState(false);
  const composingRef = useRef(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const goalMet = isDialogue ? requiredClues.every((id) => vars[id] === 'found') : legacyGoal;
  const refs = useRef({ turns, goalMet, failStreak });
  refs.current = { turns, goalMet, failStreak };
  const saveRef = useRef(saveChat);
  saveRef.current = saveChat;

  const flushChat = useCallback(() => {
    const current = refs.current;
    saveRef.current({ sceneId: scene.id, turns: current.turns.filter((turn) => !turn.stream).map(({ stream: _stream, ...turn }) => turn), goalMet: current.goalMet, failedStreak: current.failStreak });
  }, [scene.id]);
  // Settled turns persist immediately. saveChat's identity changing with game
  // state must never trigger the request cleanup or write an old scene snapshot.
  useEffect(() => { if (!busy) flushChat(); }, [turns, goalMet, failStreak, busy, flushChat]);
  useEffect(() => {
    window.addEventListener('pagehide', flushChat);
    return () => {
      window.removeEventListener('pagehide', flushChat);
      abortRef.current?.abort();
      abortRef.current = null;
      // Navigation owns its latest state snapshot; do not rewrite it on unmount.
    };
  }, [flushChat]);
  const liveLen = turns.at(-1)?.content.length || 0;
  useStickToBottom(scrollRef, [turns.length, liveLen, busy, deckOpen]);
  useEffect(() => {
    if (!inputRef.current) return;
    inputRef.current.style.height = '50px';
    inputRef.current.style.height = `${Math.min(112, Math.max(50, inputRef.current.scrollHeight + 2))}px`;
  }, [input]);

  const clueName = (id: string) => story?.clues?.find((clue) => clue.id === id)?.name || '相关记录';
  const prerequisite = (id: string) => {
    const earlier = topics.find((topic) => topic.grants?.includes(id));
    return earlier ? `先聊：${earlier.prompt}` : '先回到现场补充相关记录';
  };
  const missingClues = requiredClues.filter((id) => vars[id] !== 'found');
  const availableChoices = (scene.choices || []).filter((choice) => !choiceLocked(choice, vars));
  const kind = continueKind(scene);
  const canContinue = (kind === 'next' || availableChoices.length > 0)
    && (isDialogue || goalMet || degraded || !scene.goal || failStreak >= 4);
  const directChoice = kind === 'deck' && availableChoices.length === 1 ? availableChoices[0] : null;
  const asked = new Set(turns.flatMap((turn) => turn.role === 'assistant' && !turn.stream
    ? [turn.testimony?.topicId || turn.topicId].filter((id): id is string => !!id) : []));
  const pendingTopics = topics.filter((topic) => !asked.has(topic.id));
  const readyTopics = pendingTopics.filter((topic) => Object.entries(topic.requires || {}).every(([id, value]) => vars[id] === value));
  const lockedTopics = pendingTopics.filter((topic) => Object.entries(topic.requires || {}).some(([id, value]) => vars[id] !== value));
  const askedTopics = topics.filter((topic) => asked.has(topic.id));
  const objective = scene.objective || scene.goal || `听听${npcName}想说什么，也可以说出你的想法。`;

  const request = useCallback((base: BubbleTurn[], noCache: boolean, topicId?: string) => {
    const windowed = base.filter((turn) => turn.role === 'user' || turn.role === 'assistant').slice(-12)
      .map((turn) => ({ role: turn.role as 'user' | 'assistant', content: turn.content }));
    const choiceSummary = memo.filter((entry): entry is Extract<(typeof memo)[number], { kind: 'choice' }> => entry.kind === 'choice')
      .slice(-6).map((entry) => `你选择了「${entry.text}」`).join('；');
    const cluesFound = Object.keys(vars).filter((id) => id.startsWith('clue_') && vars[id] === 'found');
    const selected = topicId !== undefined ? scene.dialogue?.topics.find((topic) => topic.id === topicId)
      : scene.dialogue?.topics.find((topic) => topic.keywords.some((word) => normalize(word) && normalize(windowed.at(-1)?.content || '').includes(normalize(word))));
    const eligible = selected && Object.entries(selected.requires || {}).every(([id, value]) => id.startsWith('clue_') && value === 'found' && vars[id] === 'found');
    const allowed = new Set(eligible ? selected.grants || [] : []);
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setBusy(true);
    setTurns([...base, { role: 'assistant', content: '', stream: true }]);
    const current = () => !ctrl.signal.aborted && abortRef.current === ctrl;
    streamChat({ storyId: story?.story.id || '', sceneId: scene.id, history: windowed, choiceSummary, cluesFound, topicId, noCache }, {
      onDelta: (chunk) => {
        if (!current()) return;
        setTurns((previous) => {
          const last = previous.at(-1);
          return last?.stream ? [...previous.slice(0, -1), { ...last, content: last.content + chunk }] : previous;
        });
      },
      onDone: (result) => {
        if (!current()) return;
        abortRef.current = null;
        setBusy(false);
        // Check scene registration, request topic, prerequisites and canonical
        // text again before accepting any evidence from the network response.
        const testimony = eligible && result.testimony?.topicId === selected.id && result.testimony.text === selected.reply.trim()
          ? { topicId: selected.id, text: selected.reply.trim(), clues: (selected.grants || []).filter((id) => /^clue_[A-Za-z0-9_]+$/.test(id)) } : undefined;
        const clues = testimony ? [...new Set((result.clues || []).filter((id) => /^clue_[A-Za-z0-9_]+$/.test(id) && allowed.has(id) && vars[id] !== 'found'))] : [];
        if (clues.length) grantVars(Object.fromEntries(clues.map((id) => [id, 'found'])), scene.id);
        const completed = isDialogue ? (scene.dialogue?.requiredClues || []).every((id) => vars[id] === 'found' || clues.includes(id)) : result.goalAchieved;
        setTurns((previous) => [...previous.slice(0, -1), { role: 'assistant', content: result.reply || '这次没有听清，请再问一次。', goal: completed, mode: result.mode, testimony, clues, topicId }]);
        if (!isDialogue && completed) setLegacyGoal(true);
        setDegraded(result.mode === 'scripted');
        setFailStreak((count) => completed ? 0 : count + 1);
      },
      onError: (code, message) => {
        if (!current() || code === 'ABORTED') return;
        abortRef.current = null;
        setBusy(false);
        setDegraded(true);
        const guidance = isDialogue ? '可以重试这句话，或换一个话题。已经记下的内容会保留。' : '可以重试这句话，也可以继续剧情。';
        setTurns((previous) => [...previous.filter((turn) => !turn.stream), { role: 'kanshan', content: `${message || '这次传讯没有接通。'}\n\n${guidance}`, error: true }]);
      },
    }, ctrl.signal);
  }, [memo, vars, scene, story?.story.id, isDialogue, grantVars]);

  const send = useCallback((raw: string, topicId?: string) => {
    const text = raw.trim();
    if (!text || abortRef.current || navBusy) return;
    const base: BubbleTurn[] = [...refs.current.turns, { role: 'user', content: text, topicId }];
    refs.current = { ...refs.current, turns: base };
    // A suggested question must not erase a free-form draft the player is writing.
    if (!topicId) setInput('');
    setGuideOpen(false);
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    request(base, false, topicId);
  }, [request, navBusy]);
  const retry = useCallback(() => {
    if (abortRef.current) return;
    const current = refs.current.turns;
    const lastUserIndex = current.map((turn) => turn.role).lastIndexOf('user');
    if (lastUserIndex < 0) return;
    request(current.slice(0, lastUserIndex + 1), true, current[lastUserIndex].topicId);
  }, [request]);
  const stop = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setBusy(false);
    setTurns((current) => [...current.filter((turn) => !turn.stream), {
      role: 'kanshan', content: '已暂停这次回答。你可以重试，或换个问题。', error: true,
    }]);
  }, []);
  const doContinue = useCallback(() => {
    if (!canContinue || busy || navBusy) return;
    flushChat();
    if (prefs.sfx) sfxClick();
    if (directChoice) chooseAndNav(directChoice);
    else if (nextSceneOf(scene)) nav(nextSceneOf(scene)!);
    else if (scene.choices?.length) setDeckOpen(true);
  }, [canContinue, busy, navBusy, flushChat, directChoice, nextSceneOf, scene, nav, prefs.sfx, chooseAndNav]);
  const topicButton = (topic: (typeof topics)[number], completed = false) => {
    const missing = Object.entries(topic.requires || {}).filter(([id, value]) => vars[id] !== value);
    return <div key={topic.id} className={`chat__topic${completed ? ' chat__topic--asked' : ''}`}>
      <button type="button" disabled={busy || navBusy || deckOpen || missing.length > 0} onClick={() => send(topic.prompt, topic.id)}>
        <span>{completed ? '再问一次 · ' : ''}{topic.prompt}</span><span aria-hidden>{completed ? '↻' : '↗'}</span>
      </button>
      {missing.length ? <p>{[...new Set(missing.map(([id]) => prerequisite(id)))].join('；')}</p> : null}
    </div>;
  };
  const lastUserIndex = turns.map((turn) => turn.role).lastIndexOf('user');

  return (
    <section className="chat chat--focused">
      <Art id={scene.id} image={scene.image} label={story?.story.title} />
      <div className="chat__head">
        <span className="chat__npc"><span className="chat__avatar" aria-hidden>{npcName.slice(0, 1)}</span><span className="chat__who"><b>{npcName}</b><i>{busy ? '正在回答你' : '正在交谈'}</i></span></span>
      </div>
      <aside className="chat__guide" aria-label="交谈指引">
        <p className="chat__objective">{objective}</p>
        {topics.length > 0 ? <>
          <button className="chat__guide-toggle" type="button" aria-expanded={guideOpen} aria-controls={`chat-guide-${scene.id}`} onClick={() => setGuideOpen((open) => !open)}>
            <span>{readyTopics.length ? `可以聊的话题 · ${readyTopics.length}` : goalMet ? '已聊到关键内容' : '交谈指引'}</span><span aria-hidden>{guideOpen ? '收起 −' : '展开 +'}</span>
          </button>
          <div id={`chat-guide-${scene.id}`} className={`chat__guide-content${guideOpen ? ' is-open' : ''}`}>
            <h2>{goalMet ? '还想聊聊' : '可以从这里问起'}</h2>
            {readyTopics.length ? <div className="chat__topic-list">{readyTopics.map((topic) => topicButton(topic))}</div> : null}
            {lockedTopics.length ? <details className="chat__topic-group"><summary>稍后再聊 · {lockedTopics.length}</summary>{lockedTopics.map((topic) => topicButton(topic))}</details> : null}
            {askedTopics.length ? <details className="chat__topic-group"><summary>已经聊过 · {askedTopics.length}</summary>{askedTopics.map((topic) => topicButton(topic, true))}</details> : null}
            {goalMet ? <p className="chat__progress-note">关键内容已记下。你可以继续追问，也可以往下走。</p> : missingClues.length > 0 ? <p className="chat__progress-note">从当前可问的话题继续，把这次谈话听完整。</p> : null}
          </div>
        </> : <p className="chat__progress-note">在下方说出你的问题或想法。{goalMet ? '对方已回应了这次谈话的要点。' : ''}</p>}
      </aside>
      <div className="chat__conversation">
      <div className="chat__scroll" ref={scrollRef} onScroll={(event) => { const el = event.currentTarget; setShowLatest(el.scrollHeight - el.scrollTop - el.clientHeight > 120); }}>
        {scene.text ? <div className="chat__narration md" dangerouslySetInnerHTML={{ __html: renderMarkdown(scene.text) }} /> : null}
        {scene.comments?.length ? <div className="chat__comments">
          <p className="chat__comments-head">围观评论 · {scene.comments.length}</p>
          {scene.comments.map((comment, index) => <div className="chat__comment" key={`${comment.name}-${index}`}>
            <span className="chat__comment-avatar" style={commentAvatarStyle(comment.name)} aria-hidden>{comment.name.slice(0, 1)}</span>
            <div className="chat__comment-main">
              <p className="chat__comment-meta"><b className="chat__comment-name">{comment.name}</b>{comment.likes ? <span className="chat__comment-likes">♥ {comment.likes}</span> : null}</p>
              <p className="chat__comment-text">{comment.text}</p>
            </div>
          </div>)}
        </div> : null}
        <div className="chat__list">
          {!turns.length && !busy ? <p className="chat__list-empty">对话还没有开始。先开口说点什么，或从上方的话题问起。</p> : null}
          {turns.map((turn, index) => <Bubble key={index} turn={turn} npcName={npcName} clueName={clueName} onRetry={!busy && !deckOpen && index === turns.length - 1 && index > lastUserIndex && lastUserIndex >= 0 ? retry : undefined} />)}
        </div>
        {deckOpen ? <ChoiceDeck choices={scene.choices || []} onPick={(choice: Choice) => { flushChat(); setDeckOpen(false); chooseAndNav(choice); }} prompt="接下来，你想——" /> : null}
      </div>
      {showLatest ? <button type="button" className="chat__latest" onClick={() => scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: prefs.calm ? 'instant' : 'smooth' })}>回到最新对话 ↓</button> : null}
      </div>
      <div className="chat__compose">
        {!deckOpen ? <label className="chat__input-label" htmlFor={`chat-input-${scene.id}`}>你的话 <span>自由提问或回应</span></label> : null}
        {!deckOpen ? <form className="chat__form" onSubmit={(event) => { event.preventDefault(); if (!composingRef.current) send(input); }}>
          <textarea id={`chat-input-${scene.id}`} ref={inputRef} className="chat__input" aria-label={`向${npcName}自由提问`} value={input} onChange={(event) => setInput(event.target.value)} onCompositionStart={() => { composingRef.current = true; }} onCompositionEnd={() => { composingRef.current = false; }} onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              if (event.nativeEvent.isComposing || composingRef.current || event.keyCode === 229) return;
              event.preventDefault();
              send(input);
            }
          }} rows={1} maxLength={4000} placeholder={busy ? '可以先写下一个问题…' : `对${npcName}说点什么…`} enterKeyHint="send" />
          {busy ? <button key="stop" className="chat__send chat__send--stop" type="button" onClick={(event) => { event.preventDefault(); stop(); }}>停止</button> : <button key="send" className="chat__send" type="submit" disabled={!input.trim() || navBusy}>发送</button>}
        </form> : null}
        {busy ? <p className="chat__waiting" role="status">{npcName}正在回答，草稿会留在输入框里。</p> : null}
        {!deckOpen && !canContinue && !busy ? <p className="chat__compose-note">聊到要点之后，就能继续往下走。</p> : null}
        {deckOpen ? <button className="chat__return" type="button" onClick={() => setDeckOpen(false)}>← 继续和{npcName}交谈</button> : canContinue ? <div className="chat__next"><button className={`btn ${isDialogue && !goalMet ? 'btn--ghost' : 'btn--primary'}`} type="button" onClick={doContinue} disabled={busy || navBusy}>{directChoice?.text || scene.dialogue?.leaveLabel || scene.continueLabel || '想好怎么回应了'}<span aria-hidden> →</span></button></div> : null}
      </div>
    </section>
  );
}

function Bubble({ turn, npcName, clueName, onRetry }: { turn: BubbleTurn; npcName: string; clueName: (id: string) => string; onRetry?: () => void }) {
  if (turn.role === 'user') return <div className="bubble-row bubble-row--me"><div className="bubble bubble--me">{turn.content}</div></div>;
  if (turn.role === 'kanshan') return <div className="bubble-row bubble-row--fox"><div className="bubble-fox"><span className="bubble-fox__name">{FOX_NAME}</span><div className="bubble bubble--fox">{turn.content}</div>{turn.error && onRetry ? <button className="chat__retry" type="button" onClick={onRetry}>重试这句话</button> : null}</div></div>;
  return <div className="bubble-row"><div className="bubble-fox">
    <span className="bubble-fox__name">{npcName}</span>
    <div className="bubble bubble--npc">
      {turn.content || (turn.stream ? <span className="chat__thinking">{npcName}正在组织回答…</span> : null)}
      {turn.stream && turn.content ? <span className="bubble__caret" aria-hidden /> : null}
    </div>
    {turn.testimony ? <details className="chat__testimony"><summary>{turn.testimony.clues.length ? `已记下 · ${turn.testimony.clues.map(clueName).join('、')}` : '保留这次回应'}</summary><p>{turn.testimony.text}</p></details> : null}
    {!turn.stream && onRetry ? <details className="chat__message-more"><summary aria-label="这条回答的更多选项">更多</summary><div>{turn.mode ? <span>{turn.mode === 'scripted' ? '当前使用故事预写对白，自由对话暂不可用。' : '这段回答由 AI 演绎，已记下的证言可展开核对。'}</span> : null}<button className="chat__retry" type="button" onClick={onRetry}>换一种说法</button></div></details> : null}
  </div></div>;
}
