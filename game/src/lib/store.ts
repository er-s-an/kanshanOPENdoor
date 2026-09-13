// localStorage 存档：位置 / 变量 / 抉择回放 / 对话窗口，刷新续玩
import { STORAGE_PREFS, STORAGE_SAVE, DEFAULT_PREFS } from './config';
import type { Prefs, SaveData } from '../types';

const storyKey = (id: string) => `${STORAGE_SAVE}:${encodeURIComponent(id)}`;

export function loadSave(storyId?: string): SaveData | null {
  try {
    const raw = (storyId ? localStorage.getItem(storyKey(storyId)) : null) || localStorage.getItem(STORAGE_SAVE);
    if (!raw) return null;
    const s = JSON.parse(raw) as SaveData;
    if (!s || s.v !== 1 || !s.storyId || !s.sceneId) return null;
    if (storyId && s.storyId !== storyId) return null;
    s.vars = s.vars || {};
    s.memo = Array.isArray(s.memo) ? s.memo : [];
    return s;
  } catch {
    return null;
  }
}

export function persistSave(save: SaveData) {
  try {
    localStorage.setItem(storyKey(save.storyId), JSON.stringify({ ...save, v: 1 }));
    localStorage.setItem(STORAGE_SAVE, JSON.stringify({ ...save, v: 1 }));
  } catch {
    /* 隐私模式 / 存满：无存档继续玩 */
  }
}

export function clearSave(storyId?: string) {
  try {
    const last = loadSave();
    const target = storyId || last?.storyId;
    if (target) localStorage.removeItem(storyKey(target));
    if (!storyId || last?.storyId === storyId) localStorage.removeItem(STORAGE_SAVE);
  } catch {
    /* noop */
  }
}

export function loadPrefs(): Prefs {
  try {
    const raw = localStorage.getItem(STORAGE_PREFS);
    if (!raw) return DEFAULT_PREFS;
    return { ...DEFAULT_PREFS, ...(JSON.parse(raw) as Partial<Prefs>) };
  } catch {
    return DEFAULT_PREFS;
  }
}

export function persistPrefs(p: Prefs) {
  try {
    localStorage.setItem(STORAGE_PREFS, JSON.stringify(p));
  } catch {
    /* noop */
  }
}

export function archiveSave(save: SaveData) {
  try {
    const key = `${storyKey(save.storyId)}:archive:${encodeURIComponent(save.storyVersion || 'legacy')}`;
    if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify(save));
  } catch { /* storage restrictions must not prevent play */ }
}
