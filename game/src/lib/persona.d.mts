import type { GameJson, MemoEntry, Vars } from '../types';

export type PersonaCode = 'FIRE' | 'ANON' | 'CLEAN' | 'CTRL' | 'ECHO' | 'ASKR' | 'FAIR' | 'FEEL';
export interface PersonaDefinition {
  code: PersonaCode;
  name: string;
  route: string;
  roast: string;
  praise: string;
  asset: string;
}
export interface PersonaResult extends PersonaDefinition {
  axes: { source: 'evidence' | 'testimony'; pace: 'push' | 'restrain'; voice: 'public' | 'private' };
  proofLines: string[];
  basis: Record<'source' | 'pace' | 'voice', Array<{ sceneId: string; choiceId: string; text: string }>>;
  matchedChoices: number;
  unresolved: string[];
  confidence: 'explicit' | 'compat' | 'provisional';
}

export const PERSONAS: Readonly<Record<PersonaCode, Readonly<PersonaDefinition>>>;
export function derivePersona(story: GameJson, vars: Vars, memo: MemoEntry[]): PersonaResult;
export function buildPersonaShareUrl(storyId: string, personaCode: PersonaCode, baseHref?: string): string;
