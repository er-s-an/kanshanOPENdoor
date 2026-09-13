// 全局状态引擎：故事加载 / 场景导航（带 300ms 过渡）/ 变量 / 抉择回放 / 自动存档 / URL 暗门
import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import type { ChatTurn, Choice, GameJson, MemoEntry, Scene, StorySummary, Vars } from '../types';
import { fetchStory, fetchStories } from '../lib/api';
import { archiveSave, clearSave, loadSave, persistSave } from '../lib/store';
import { applyAction, applyChoice, completedOutcome, applyEntry, inspectItem, verifyEvidence } from '../lib/rules.mjs';

export type Phase = 'boot' | 'door' | 'play';
export type NavPhase = 'idle' | 'out' | 'in';

export interface GameState {
  phase: Phase;
  stories: StorySummary[];
  storyError: string;
  story: GameJson | null;
  sceneId: string;
  vars: Vars;
  memo: MemoEntry[];
  judge: boolean; // 评委暗门：?scene= 直达，不读档不写档
}

type Action =
  | { type: 'BOOTED' }
  | { type: 'STORIES'; stories: StorySummary[]; error: string }
  | { type: 'ENTER'; story: GameJson; sceneId: string; vars: Vars; memo: MemoEntry[]; judge: boolean }
  | { type: 'GOTO'; sceneId: string; from: string }
  | { type: 'CHOOSE'; choiceId: string; from: string }
  | { type: 'ACT'; actionId: string; from: string }
  | { type: 'GRANT'; vars: Vars; from?: string }
  | { type: 'INSPECT'; itemId: string; from: string }
  | { type: 'VERIFY'; checkId: string; evidenceIds: string[]; from: string }
  | { type: 'TO_DOOR'; keepSave: boolean };

function reducer(s: GameState, a: Action): GameState {
  switch (a.type) {
    case 'BOOTED':
      return s.phase === 'boot' ? { ...s, phase: 'door' } : s;
    case 'STORIES':
      return { ...s, stories: a.stories, storyError: a.error };
    case 'ENTER':
      return { ...s, phase: 'play', story: a.story, sceneId: a.sceneId, vars: a.vars, memo: a.memo, judge: a.judge };
    case 'GOTO': {
      if (!s.story || s.phase !== 'play' || s.sceneId !== a.from || !s.story.scenes.some((sc) => sc.id === a.sceneId) || s.sceneId === a.sceneId) return s;
      const current = s.story.scenes.find((sc) => sc.id === s.sceneId);
      if (!current) return s;
      const destinations = current.type === 'encounter'
        ? [completedOutcome(current, s.vars)?.next]
        : current.type === 'boss'
          ? [current.boss?.endings.truth, current.boss?.endings.fold, current.boss?.egg?.ending, current.next, current.goto]
          : [current.next, current.goto];
      if (!destinations.includes(a.sceneId)) return s;
      const memo = [...s.memo];
      const prev = memo[memo.length - 1];
      if (prev?.kind !== 'scene' || prev.sceneId !== a.sceneId) {
        memo.push({ kind: 'scene', sceneId: a.sceneId, chapter: s.story.scenes.find((sc) => sc.id === a.sceneId)?.chapter });
      }
      return { ...s, sceneId: a.sceneId, vars: applyEntry(s.story, a.sceneId, s.vars), memo: memo.slice(-240) };
    }
    case 'CHOOSE': {
      if (!s.story || s.phase !== 'play' || s.sceneId !== a.from) return s;
      const applied = applyChoice(s.story, s.sceneId, a.choiceId, s.vars);
      if (!applied) return s;
      const memo: MemoEntry[] = [...s.memo];
      memo.push({ kind: 'choice', sceneId: s.sceneId, text: applied.choice.text });
      memo.push({ kind: 'scene', sceneId: applied.sceneId, chapter: s.story.scenes.find((sc) => sc.id === applied.sceneId)?.chapter });
      return { ...s, sceneId: applied.sceneId, vars: applied.vars, memo: memo.slice(-240) };
    }
    case 'ACT': {
      if (!s.story || s.phase !== 'play' || s.sceneId !== a.from) return s;
      const scene = s.story.scenes.find((sc) => sc.id === s.sceneId);
      if (!scene) return s;
      const result = applyAction(scene, a.actionId, s.vars);
      if (!result) return s;
      const entry: MemoEntry = { kind: 'action', sceneId: scene.id, actionId: result.action.id, text: result.action.text, feedback: result.action.feedback, changes: result.changes };
      return { ...s, vars: result.vars, memo: [...s.memo, entry].slice(-240) };
    }
    case 'INSPECT': {
      if (!s.story || s.sceneId !== a.from) return s;
      const result = inspectItem(s.story, s.sceneId, a.itemId, s.vars);
      if (!result || s.vars[result.item.clue] === 'found') return s;
      const entry: MemoEntry = { kind: 'action', sceneId: s.sceneId, actionId: `inspect:${a.itemId}`, text: `查看：${result.item.title}`, feedback: result.item.text, changes: [] };
      return { ...s, vars: result.vars, memo: [...s.memo, entry].slice(-240) };
    }
    case 'VERIFY': {
      if (!s.story || s.sceneId !== a.from) return s;
      const result = verifyEvidence(s.story, s.sceneId, a.checkId, a.evidenceIds, s.vars);
      if (!result) return s;
      const entry: MemoEntry = { kind: 'action', sceneId: s.sceneId, actionId: `verify:${a.checkId}`, text: `查证：${result.check.prompt}`, feedback: result.correct ? result.check.success : result.check.failure, changes: [] };
      return { ...s, vars: result.vars, memo: [...s.memo, entry].slice(-240) };
    }
    case 'GRANT': {
      if (!s.story || (a.from && a.from !== s.sceneId)) return s;
      const current = s.story.scenes.find((sc) => sc.id === s.sceneId);
      const allowed = new Set(current?.dialogue?.topics.flatMap((t) => t.grants || []) || []);
      const vars = { ...s.vars };
      for (const [k, v] of Object.entries(a.vars)) {
        if (allowed.has(k) && v === 'found') vars[k] = v;
      }
      return { ...s, vars };
    }
    case 'TO_DOOR': {
      if (!a.keepSave) clearSave(s.story?.story.id);
      return { ...s, phase: 'door', story: null, sceneId: '', vars: {}, memo: [], judge: false };
    }
    default:
      return s;
  }
}

export interface EnterOptions {
  /** 从存档续玩（默认） */
  resume?: boolean;
  /** 强制从某场景进入（含 ?scene= 评委暗门，不读档不写档） */
  forcedScene?: string;
  /** 重新开始（清档后从 start 进入） */
  fresh?: boolean;
}

export interface Engine extends GameState {
  scene: Scene | null;
  sceneList: Scene[];
  nextSceneOf: (sc: Scene) => string | null;
  continueKind: (sc: Scene) => 'next' | 'deck' | 'none';
  navBusy: boolean;
  navToken: number;
  booted: () => void;
  refreshStories: () => void;
  enterStory: (storyId: string, opts?: EnterOptions) => Promise<void>;
  /** 带门缝光过渡的导航；busy 时忽略 */
  nav: (sceneId: string) => void;
  chooseAndNav: (c: Choice) => void;
  act: (actionId: string) => void;
  /** Preserved V1 clue integration. Encounter actions never call this. */
  grantVars: (vars: Vars, fromSceneId?: string) => void;
  inspect: (itemId: string) => void;
  verify: (checkId: string, evidenceIds: string[]) => boolean;
  backToDoor: (keepSave?: boolean) => void;
  resetRun: () => void;
  saveChat: (chat?: { sceneId: string; turns: ChatTurn[]; goalMet: boolean; failedStreak: number }) => void;
}

const Ctx = createContext<Engine | null>(null);

export function GameProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(reducer, {
    phase: 'boot',
    stories: [],
    storyError: '',
    story: null,
    sceneId: '',
    vars: {},
    memo: [],
    judge: false,
  });

  const stateRef = useRef(state);
  stateRef.current = state;

  // 立即换场景，短暂保留防重复点击保护。
  const [navBusy, setNavBusy] = useState(false);
  const [navToken, setNavToken] = useState(0);
  const busyRef = useRef(false);
  const timers = useRef<number[]>([]);
  const later = useCallback((fn: () => void, ms: number) => {
    const id = window.setTimeout(fn, ms);
    timers.current.push(id);
  }, []);
  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  const fireNav = useCallback(
    (sceneId: string) => {
      if (!state.story || busyRef.current) return;
      if (state.sceneId === sceneId || !state.story.scenes.some((sc) => sc.id === sceneId)) return;
      setNavBusy(true);
      busyRef.current = true;
      later(() => {
        dispatch({ type: 'GOTO', sceneId, from: state.sceneId });
        setNavToken((t) => t + 1);
        later(() => {
          setNavBusy(false);
          busyRef.current = false;
        }, 160);
      }, 0);
    },
    [state.story, state.sceneId, navBusy, later],
  );

  // 故事列表
  const [reloadTick, setReloadTick] = useState(0);
  useEffect(() => {
    let dead = false;
    void (async () => {
      try {
        const stories = await fetchStories();
        if (dead) return;
        dispatch({ type: 'STORIES', stories, error: '' });
        if (!stories.length) dispatch({ type: 'STORIES', stories: [], error: '还没有故事：把 game.json 放到 game/stories/ 或 portal 根目录。' });
      } catch (err) {
        if (dead) return;
        dispatch({ type: 'STORIES', stories: [], error: `连不上网关 /api/stories：${err instanceof Error ? err.message : String(err)}` });
      }
    })();
    return () => {
      dead = true;
    };
  }, [reloadTick]);
  const refreshStories = useCallback(() => setReloadTick((t) => t + 1), []);

  const saveSnapshot = useCallback(() => {
    if (!state.story || state.judge || state.phase !== 'play') return;
    const existing = loadSave(state.story.story.id);
    persistSave({ v: 1, storyVersion: state.story.version, storyId: state.story.story.id, sceneId: state.sceneId, vars: state.vars, memo: state.memo,
      ...(existing && existing.storyVersion === state.story.version ? { chats: existing.chats, chat: existing.chats?.[state.sceneId] || (existing.chat?.sceneId === state.sceneId ? existing.chat : undefined) } : {}) });
  }, [state.story, state.judge, state.phase, state.sceneId, state.vars, state.memo]);

  // 自动存档
  useEffect(() => {
    const id = window.setTimeout(saveSnapshot, 120);
    return () => clearTimeout(id);
  }, [saveSnapshot]);

  const booted = useCallback(() => dispatch({ type: 'BOOTED' }), []);

  const enterStory = useCallback(
    async (storyId: string, opts: EnterOptions = {}) => {
      try {
        const story = await fetchStory(storyId);
        timers.current.forEach(clearTimeout);
        timers.current = [];
        busyRef.current = false;
        setNavBusy(false);
        const params = new URLSearchParams(window.location.search);
        const forced = opts.forcedScene || params.get('scene');
        const forcedOk = forced ? story.scenes.some((sc) => sc.id === forced) : false;

        // 评委暗门：强制场景直达，不读档不写档
        if (forcedOk) {
          dispatch({ type: 'ENTER', story, sceneId: forced as string, vars: applyEntry(story, forced as string, { ...story.initialVars }), memo: [], judge: true });
          return;
        }
        if (opts.fresh) clearSave(storyId);

        const save = loadSave(storyId);
        if (save && save.storyVersion !== story.version) archiveSave(save);
        const resumeOk = save && save.storyVersion === story.version && story.scenes.some((sc) => sc.id === save.sceneId) && opts.resume !== false;
        const target = resumeOk ? (save as NonNullable<typeof save>).sceneId : story.start;
        if (!target || !story.scenes.some((sc) => sc.id === target)) throw new Error('story 缺少可用的 start 场景');
        dispatch({
          type: 'ENTER',
          story,
          sceneId: target,
          vars: applyEntry(story, target, resumeOk ? save.vars : { ...story.initialVars }),
          memo: resumeOk ? save.memo : [{ kind: 'scene', sceneId: target, chapter: story.scenes.find((sc) => sc.id === target)?.chapter }],
          judge: false,
        });
      } catch (err) {
        dispatch({ type: 'STORIES', stories: state.stories, error: `打开故事失败：${err instanceof Error ? err.message : String(err)}` });
        throw err;
      }
    },
    [state.stories],
  );

  const chooseAndNav = useCallback(
    (c: Choice) => {
      if (!state.story || busyRef.current || !applyChoice(state.story, state.sceneId, c.id, state.vars)) return;
      busyRef.current = true;
      dispatch({ type: 'CHOOSE', choiceId: c.id, from: state.sceneId });
      setNavBusy(true);
      later(() => {
        setNavToken((t) => t + 1);
        later(() => { setNavBusy(false); busyRef.current = false; }, 160);
      }, 210);
    },
    [later, state.story, state.sceneId, state.vars],
  );

  const grantVars = useCallback((vars: Vars, fromSceneId?: string) => dispatch({ type: 'GRANT', vars, from: fromSceneId }), []);
  const inspect = useCallback((itemId: string) => {
    if (!busyRef.current) dispatch({ type: 'INSPECT', itemId, from: state.sceneId });
  }, [state.sceneId]);
  const verify = useCallback((checkId: string, evidenceIds: string[]) => {
    if (!state.story || busyRef.current) return false;
    const result = verifyEvidence(state.story, state.sceneId, checkId, evidenceIds, state.vars);
    if (!result) return false;
    dispatch({ type: 'VERIFY', checkId, evidenceIds, from: state.sceneId });
    return result.correct;
  }, [state.story, state.sceneId, state.vars]);

  const act = useCallback((actionId: string) => {
    if (busyRef.current) return;
    dispatch({ type: 'ACT', actionId, from: state.sceneId });
  }, [state.sceneId]);

  const backToDoor = useCallback((keepSave = true) => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
    busyRef.current = false;
    setNavBusy(false);
    if (keepSave) saveSnapshot();
    window.history.replaceState(null, '', window.location.pathname);
    dispatch({ type: 'TO_DOOR', keepSave });
  }, [saveSnapshot]);
  const resetRun = useCallback(() => {
    backToDoor(false);
  }, [backToDoor]);

  const saveChat = useCallback(
    (chat?: { sceneId: string; turns: ChatTurn[]; goalMet: boolean; failedStreak: number }) => {
      const current = stateRef.current;
      if (!current.story || current.judge || current.phase !== 'play' || !chat) return;
      const existing = loadSave(current.story.story.id);
      const chats = existing && existing.storyVersion === current.story.version ? { ...existing.chats } : {};
      chats[chat.sceneId] = chat;
      persistSave({ v: 1, storyVersion: current.story.version, storyId: current.story.story.id, sceneId: current.sceneId,
        vars: current.vars, memo: current.memo, chats, chat: chats[current.sceneId] });
    }, [],
  );

  const sceneList = state.story?.scenes || [];
  const scene = state.story ? state.story.scenes.find((sc) => sc.id === state.sceneId) || null : null;

  const nextSceneOf = useCallback(
    (sc: Scene) => {
      if (!state.story) return null;
      for (const t of [sc.next, sc.goto]) if (t && state.story.scenes.some((s) => s.id === t)) return t;
      return null;
    },
    [state.story],
  );

  const continueKind = useCallback(
    (sc: Scene): 'next' | 'deck' | 'none' => {
      if (sc.type === 'chat') return nextSceneOf(sc) ? 'next' : sc.choices?.length ? 'deck' : 'none';
      if (sc.type === 'novel') return nextSceneOf(sc) ? 'next' : sc.choices?.length ? 'deck' : 'none';
      return 'none';
    },
    [nextSceneOf],
  );

  const value: Engine = useMemo(
    () => ({
      ...state,
      scene,
      sceneList,
      nextSceneOf,
      continueKind,
      navBusy,
      navToken,
      booted,
      refreshStories,
      enterStory,
      nav: fireNav,
      chooseAndNav,
      act,
      grantVars,
      inspect,
      verify,
      backToDoor,
      resetRun,
      saveChat,
    }),
    [state, scene, sceneList, nextSceneOf, continueKind, navBusy, navToken, booted, refreshStories, enterStory, fireNav, chooseAndNav, act, grantVars, inspect, verify, backToDoor, resetRun, saveChat],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useGame(): Engine {
  const v = useContext(Ctx);
  if (!v) throw new Error('useGame must be inside <GameProvider>');
  return v;
}
