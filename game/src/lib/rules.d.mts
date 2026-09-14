import type { Choice, EncounterAction, EncounterCondition, EncounterOutcome, GameJson, Scene, Vars, InvestigationItem, InvestigationCheck, InvestigationMode, InvestigationSearchResult, InvestigationBrowserQueryResult, InvestigationBrowserOpenResult, PostExtractable } from '../types';
export function applyEntry(story: GameJson, sceneId: string, vars: Vars): Vars;
export function inspectItem(story: GameJson, sceneId: string, itemId: string, vars: Vars): { vars: Vars; item: InvestigationItem } | null;
export function searchInvestigation(story: GameJson, sceneId: string, query: string, vars: Vars, mode?: InvestigationMode): InvestigationSearchResult;
export function queryInvestigationBrowser(story: GameJson, sceneId: string, query: string, vars: Vars): InvestigationBrowserQueryResult;
export function openInvestigationBrowserDocument(story: GameJson, sceneId: string, documentId: string, vars: Vars): InvestigationBrowserOpenResult;
export function savePostExtractable(story: GameJson, sceneId: string, extractableId: string, vars: Vars): { vars: Vars; fragment: PostExtractable } | null;
export function verifyEvidence(story: GameJson, sceneId: string, checkId: string, evidenceIds: string[], vars: Vars): { vars: Vars; check: InvestigationCheck; correct: boolean } | null;
export function outcomeKey(sceneId: string): string;
export function matches(conditions: EncounterCondition[] | undefined, vars: Vars): boolean;
export function choiceLocked(choice: Choice, vars: Vars): string | null;
export function applyChoice(story: GameJson, sceneId: string, choiceId: string, vars: Vars): { choice: Choice; vars: Vars; sceneId: string } | null;
export function completedOutcome(scene: Scene, vars: Vars): EncounterOutcome | null;
export function actionLocked(scene: Scene, action: EncounterAction, vars: Vars): string | null;
export function applyAction(scene: Scene, actionId: string, vars: Vars): {
  vars: Vars; action: EncounterAction; outcome: EncounterOutcome | null;
  changes: Array<{key: string; label: string; before: string; after: string}>;
} | null;
