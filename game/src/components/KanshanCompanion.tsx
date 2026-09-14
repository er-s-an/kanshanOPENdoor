import { useEffect, useId, useRef, useState } from 'react';
import type { FormEvent, KeyboardEvent as ReactKeyboardEvent } from 'react';
import type { GameJson, Scene } from '../types';
import { streamKanshan } from '../lib/api';
import { usePrefs } from '../state/prefs';
import '../kanshan-companion.css';

const IDLE_ART = '/art/character/motion/liu-kanshan-idle.gif';
const STILL_ART = '/art/character/reference/liu-kanshan-front-green.jpg';

interface CompanionTurn {
  role: 'user' | 'assistant';
  content: string;
  stream?: boolean;
}

const LOCAL_FALLBACK = '先看当前目标和已经记下的事。我不替你下结论，但可以陪你把它们排清楚。';

export function KanshanCompanion({ story, scene, cluesFound }: { story: GameJson; scene: Scene; cluesFound: string[] }) {
  const { prefs } = usePrefs();
  const titleId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const composingRef = useRef(false);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [input, setInput] = useState('');
  const [turns, setTurns] = useState<CompanionTurn[]>([
    { role: 'assistant', content: '我就在旁边。想不清下一步时，问我；答案还是由你来找。' },
  ]);

  useEffect(() => () => abortRef.current?.abort(), []);
  useEffect(() => {
    if (!open) return;
    window.requestAnimationFrame(() => inputRef.current?.focus({ preventScroll: true }));
    const closeOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setOpen(false);
      window.requestAnimationFrame(() => triggerRef.current?.focus({ preventScroll: true }));
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [open]);
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [turns, busy, open]);
  useEffect(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setBusy(false);
  }, [scene.id]);

  const close = () => {
    setOpen(false);
    window.requestAnimationFrame(() => triggerRef.current?.focus({ preventScroll: true }));
  };

  const send = (raw: string) => {
    const content = raw.trim();
    if (!content || busy) return;
    const base: CompanionTurn[] = [...turns.filter((turn) => !turn.stream), { role: 'user', content }];
    setTurns([...base, { role: 'assistant', content: '', stream: true }]);
    setInput('');
    setBusy(true);
    const controller = new AbortController();
    abortRef.current = controller;
    const active = () => abortRef.current === controller && !controller.signal.aborted;
    streamKanshan({
      storyId: story.story.id,
      sceneId: scene.id,
      history: base.slice(-8).map(({ role, content: text }) => ({ role, content: text })),
      cluesFound,
    }, {
      onDelta: (chunk) => {
        if (!active()) return;
        setTurns((current) => {
          const last = current.at(-1);
          return last?.stream ? [...current.slice(0, -1), { ...last, content: last.content + chunk }] : current;
        });
      },
      onDone: (result) => {
        if (!active()) return;
        abortRef.current = null;
        setBusy(false);
        setTurns((current) => [...current.slice(0, -1), { role: 'assistant', content: result.reply || LOCAL_FALLBACK }]);
      },
      onError: (code) => {
        if (!active() || code === 'ABORTED') return;
        abortRef.current = null;
        setBusy(false);
        setTurns((current) => [...current.filter((turn) => !turn.stream), { role: 'assistant', content: LOCAL_FALLBACK }]);
      },
    }, controller.signal);
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!composingRef.current) send(input);
  };
  const sendOnEnter = (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing || composingRef.current || event.keyCode === 229) return;
    event.preventDefault();
    send(input);
  };
  const stop = () => {
    abortRef.current?.abort();
    abortRef.current = null;
    setBusy(false);
    setTurns((current) => [...current.filter((turn) => !turn.stream), { role: 'assistant', content: '好，我先停在这里。你想好了再问。' }]);
  };

  return <div className={`kanshan-companion${open ? ' is-open' : ''}`}>
    {open ? <aside className="kanshan-companion__panel" role="dialog" aria-modal="false" aria-labelledby={titleId}>
      <header>
        <div><span>同行中</span><h2 id={titleId}>问刘看山</h2></div>
        <button type="button" onClick={close} aria-label="收起刘看山对话">×</button>
      </header>
      <div className="kanshan-companion__turns" ref={scrollRef} aria-live="polite">
        {turns.map((turn, index) => <div key={index} className={`kanshan-companion__turn kanshan-companion__turn--${turn.role}`}>
          <small>{turn.role === 'user' ? '你' : '刘看山'}</small>
          <p>{turn.content || (turn.stream ? '我想想怎么说，才不会替你下结论……' : '')}{turn.stream && turn.content ? <i aria-hidden /> : null}</p>
        </div>)}
      </div>
      <div className="kanshan-companion__prompts" aria-label="可以这样问">
        {['我现在该注意什么？', '帮我整理已经知道的。'].map((prompt) => <button key={prompt} type="button" disabled={busy} onClick={() => send(prompt)}>{prompt}</button>)}
      </div>
      <form className="kanshan-companion__form" onSubmit={submit}>
        <textarea
          ref={inputRef}
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={sendOnEnter}
          onCompositionStart={() => { composingRef.current = true; }}
          onCompositionEnd={() => { composingRef.current = false; }}
          rows={2}
          maxLength={280}
          placeholder="问他一句……"
          aria-label="和刘看山聊天"
        />
        {busy ? <button type="button" onClick={stop}>停止</button> : <button type="submit" disabled={!input.trim()}>问他</button>}
      </form>
      <p className="kanshan-companion__boundary">他会帮你理思路，不会替你拆穿这扇门。</p>
    </aside> : null}
    <button ref={triggerRef} className="kanshan-companion__trigger" type="button" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
      <picture>
        {!prefs.calm ? <source media="(prefers-reduced-motion: reduce)" srcSet={STILL_ART} /> : null}
        <img src={prefs.calm ? STILL_ART : IDLE_ART} alt="" width="320" height="320" decoding="async" />
      </picture>
      <span><b>刘看山</b><small>{open ? '正听着' : '点我聊聊'}</small></span>
    </button>
  </div>;
}
