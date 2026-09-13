// 偏好（语速 / 音效）上下文
import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import type { Prefs } from '../types';
import { loadPrefs, persistPrefs } from '../lib/store';
import { setSound, unlockAudio } from '../lib/sound';

interface PrefsApi {
  prefs: Prefs;
  patch: (p: Partial<Prefs>) => void;
}

const Ctx = createContext<PrefsApi | null>(null);

export function PrefsProvider({ children }: { children: ReactNode }) {
  const [prefs, setPrefs] = useState<Prefs>(() => loadPrefs());

  useEffect(() => {
    persistPrefs(prefs);
    setSound(prefs.sfx, prefs.tick);
  }, [prefs]);

  // 首次手势解锁音频
  useEffect(() => {
    const unlock = () => unlockAudio();
    window.addEventListener('pointerdown', unlock, { once: true });
    return () => window.removeEventListener('pointerdown', unlock);
  }, []);

  const api = useMemo<PrefsApi>(
    () => ({
      prefs,
      patch: (p) => setPrefs((prev) => ({ ...prev, ...p })),
    }),
    [prefs],
  );

  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}

export function usePrefs(): PrefsApi {
  const v = useContext(Ctx);
  if (!v) throw new Error('usePrefs must be inside <PrefsProvider>');
  return v;
}
