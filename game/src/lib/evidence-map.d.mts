import type { GameJson, MemoEntry, Vars } from '../types';

export interface EvidenceGraphItem { id: string; name: string; kind: 'observation' | 'testimony' | 'inference' }
export interface EvidenceGraphVerification {
  id: string; chapter: string; claim: string; boundary: string;
  evidence: EvidenceGraphItem[]; conclusions: EvidenceGraphItem[];
}
export interface EvidenceGraphArgument {
  id: string; question: string; claim: string; outcome?: 'truth' | 'fold' | 'egg';
  evidence: Array<EvidenceGraphItem & { caseId?: string; result: 'supported' | 'partial' | 'overreach' }>;
}
export interface EvidenceGraph {
  foundCount: number;
  verified: EvidenceGraphVerification[];
  arguments: EvidenceGraphArgument[];
  loose: EvidenceGraphItem[];
}

export function buildEvidenceGraph(story: GameJson, vars?: Vars, memo?: MemoEntry[]): EvidenceGraph;
