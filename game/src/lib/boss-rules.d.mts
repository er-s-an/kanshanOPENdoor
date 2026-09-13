import type { BossCase, BossDecision, BossRunState, Scene, Vars } from '../types';

export function bossCases(scene: Scene): BossCase[];
export function createBossRun(scene: Scene): BossRunState | null;
export function restoreBossRun(scene: Scene, candidate: BossRunState | null | undefined): BossRunState | null;
export function selectBossClaim(scene: Scene, run: BossRunState, claimId: string): BossDecision | null;
export function selectBossSuspect(scene: Scene, run: BossRunState, suspectId: string): BossDecision | null;
export function presentBossEvidence(scene: Scene, run: BossRunState, clue: string, vars: Vars): BossDecision | null;
export function advanceBossCase(scene: Scene, run: BossRunState): BossDecision | null;
