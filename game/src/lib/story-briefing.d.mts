import type { GameJson, Scene } from '../types';

export interface StoryBriefingCopy {
  identity: string;
  anomaly: string;
  firstStep: string;
}

export function buildStoryBriefing(story: GameJson, scene: Scene): StoryBriefingCopy;
