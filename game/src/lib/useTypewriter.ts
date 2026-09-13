// 打字机：段落级推进。上一段整段渲染（markdown），当前段按纯文本逐字显示；
// 点按跳过当前段，finishAll() 直接显示全文。速度随偏好实时变化。
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Prefs } from '../types';
import { TYPING_MS } from './config';
import { paragraphs, type Para } from './md';

export interface Typewriter {
  paras: Para[];
  curIdx: number;
  n: number; // 当前段已打字数
  typing: boolean;
  done: boolean;
  skipPara: () => void;
  finishAll: () => void;
}

export function useTypewriter(md: string, speed: Prefs['speed'], enabled = true): Typewriter {
  const paras = useMemo(() => paragraphs(md), [md]);
  const [curIdx, setCurIdx] = useState(0);
  const [n, setN] = useState(0);
  const done = !enabled || curIdx >= paras.length;

  const stepMs = TYPING_MS[speed] ?? 22;

  useEffect(() => {
    if (done) return;
    const timer = window.setTimeout(() => {
      const total = paras[curIdx]?.plain.length ?? 0;
      if (n + 1 >= total) {
        setCurIdx(curIdx + 1);
        setN(0);
      } else setN(n + 1);
    }, stepMs);
    return () => window.clearTimeout(timer);
  }, [done, curIdx, n, paras, stepMs]);

  const skipPara = useCallback(() => {
    if (done) return;
    setCurIdx((i) => Math.min(i + 1, paras.length));
    setN(0);
  }, [done, paras.length]);

  const finishAll = useCallback(() => {
    setCurIdx(paras.length);
    setN(0);
  }, [paras.length]);

  return { paras, curIdx: enabled ? curIdx : paras.length, n, typing: !done, done, skipPara, finishAll };
}
