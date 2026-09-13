import type { GameJson, MemoEntry } from '../types';

export interface Counterfactual {
  sceneId: string; chapter: string; selected: string; alternative: string;
  axisFrom: string; axisTo: string; note: string;
}

export function buildCounterfactual(story: GameJson, memo?: MemoEntry[]): Counterfactual | null;
