// Deterministic boss rules shared by the React engine and Node tests.
// Wrong evidence may change exposure, but is never consumed and never blocks a later valid counter.

const finite = (value, fallback) => Number.isFinite(Number(value)) ? Number(value) : fallback;

const bounds = (config = {}) => {
  const min = finite(config.min, 0);
  return { min, max: Math.max(min, finite(config.max, 100)) };
};

const clamp = (value, config) => {
  const { min, max } = bounds(config);
  return Math.min(max, Math.max(min, finite(value, min)));
};

export function bossCases(scene) {
  const boss = scene?.boss;
  if (!boss) return [];
  if (Array.isArray(boss.cases) && boss.cases.length) {
    return boss.cases.map((entry) => ({
      id: String(entry.id),
      claim: String(entry.claim || entry.cue || ''),
      cue: entry.cue,
      counters: Array.isArray(entry.counters) ? entry.counters : [],
    }));
  }
  return (boss.rounds || []).map((round) => ({
    id: String(round.id),
    claim: String(round.claim || round.cue || ''),
    cue: round.cue,
    counters: Array.isArray(round.counters) && round.counters.length ? round.counters : (round.slots || []),
  }));
}

export function createBossRun(scene) {
  if (scene?.type !== 'boss' || !scene.boss) return null;
  return {
    v: 1,
    sceneId: scene.id,
    phase: 'claim',
    caseIndex: 0,
    credibility: clamp(scene.boss.credibility?.initial ?? scene.boss.baseLikes ?? 0, scene.boss.credibility),
    exposure: clamp(scene.boss.exposure?.initial ?? 0, scene.boss.exposure),
    usedClues: [],
    clearedCases: [],
  };
}

export function restoreBossRun(scene, candidate) {
  const fresh = createBossRun(scene);
  if (!fresh || !candidate || candidate.v !== 1 || candidate.sceneId !== scene.id) return fresh;
  const cases = bossCases(scene);
  const phase = ['claim', 'counter', 'resolved'].includes(candidate.phase) ? candidate.phase : fresh.phase;
  const outcome = ['truth', 'fold', 'egg'].includes(candidate.outcome) ? candidate.outcome : undefined;
  return {
    ...fresh,
    phase,
    ...(typeof candidate.claimId === 'string' ? { claimId: candidate.claimId } : {}),
    ...(typeof candidate.suspectId === 'string' ? { suspectId: candidate.suspectId } : {}),
    caseIndex: Math.min(Math.max(0, Math.trunc(finite(candidate.caseIndex, 0))), Math.max(0, cases.length - 1)),
    credibility: clamp(candidate.credibility, scene.boss.credibility),
    exposure: clamp(candidate.exposure, scene.boss.exposure),
    usedClues: Array.isArray(candidate.usedClues) ? [...new Set(candidate.usedClues.filter((id) => typeof id === 'string'))] : [],
    clearedCases: Array.isArray(candidate.clearedCases)
      ? [...new Set(candidate.clearedCases.filter((id) => cases.some((entry) => entry.id === id)))] : [],
    ...(phase === 'resolved' && outcome ? { outcome } : {}),
  };
}

const decision = (run, status, extra = {}) => ({
  status,
  accepted: false,
  consumed: false,
  run,
  ...extra,
});

export function selectBossSuspect(scene, run, suspectId) {
  const current = restoreBossRun(scene, run);
  if (!current || current.phase !== 'claim' || scene.boss.claims?.length) return current ? decision(current, 'inactive') : null;
  const suspect = scene.boss.suspects.find((entry) => entry.id === suspectId);
  if (!suspect) return decision(current, 'inactive');
  if (!suspect.correct) {
    const next = { ...current, phase: 'resolved', suspectId, outcome: 'fold' };
    return decision(next, 'wrong-suspect', { destination: scene.boss.endings.fold });
  }
  const next = { ...current, phase: 'counter', suspectId };
  return decision(next, 'suspect-selected', { accepted: true });
}

export function selectBossClaim(scene, run, claimId) {
  const current = restoreBossRun(scene, run);
  if (!current || current.phase !== 'claim') return current ? decision(current, 'inactive') : null;
  const claim = scene.boss.claims?.find((entry) => entry.id === claimId);
  if (!claim) return decision(current, 'inactive');
  const next = {
    ...current,
    phase: 'counter',
    claimId,
    credibility: clamp(current.credibility + finite(claim.credibility, 0), scene.boss.credibility),
    exposure: clamp(current.exposure + finite(claim.exposure, 0), scene.boss.exposure),
  };
  return decision(next, 'claim-selected', { accepted: true });
}

export function presentBossEvidence(scene, run, clue, vars) {
  const current = restoreBossRun(scene, run);
  if (!current || current.phase !== 'counter') return current ? decision(current, 'inactive', { clue }) : null;
  if (vars?.[clue] !== 'found') return decision(current, 'not-held', { clue });
  if (scene.boss.egg?.clue === clue) {
    const next = { ...current, phase: 'resolved', outcome: 'egg', usedClues: [...new Set([...current.usedClues, clue])] };
    return decision(next, 'egg', { accepted: true, consumed: true, clue, destination: scene.boss.egg.ending });
  }
  const bossCase = bossCases(scene)[current.caseIndex];
  if (!bossCase) return decision(current, 'inactive', { clue });
  if (current.clearedCases.includes(bossCase.id)) return decision(current, 'already-cleared', { clue, caseId: bossCase.id });
  if (current.usedClues.includes(clue)) return decision(current, 'already-used', { clue, caseId: bossCase.id });
  const counter = bossCase.counters.find((entry) => entry.clue === clue);
  if (!counter) {
    const next = {
      ...current,
      exposure: clamp(current.exposure + finite(scene.boss.exposure?.miss, 1), scene.boss.exposure),
    };
    return decision(next, 'miss', { clue, caseId: bossCase.id });
  }
  const result = counter.result || 'supported';
  if (result === 'overreach') {
    const next = {
      ...current,
      exposure: clamp(current.exposure + finite(counter.exposure, finite(scene.boss.exposure?.miss, 1)), scene.boss.exposure),
    };
    return decision(next, 'overreach', {
      clue, caseId: bossCase.id, counter, result, explanation: counter.explanation,
    });
  }
  const next = {
    ...current,
    credibility: clamp(current.credibility + finite(counter.credibility ?? counter.likes, 1), scene.boss.credibility),
    exposure: clamp(current.exposure + finite(counter.exposure, 0), scene.boss.exposure),
    usedClues: [...current.usedClues, clue],
    clearedCases: [...current.clearedCases, bossCase.id],
  };
  return decision(next, result, {
    accepted: true, consumed: true, clue, caseId: bossCase.id, counter, result, explanation: counter.explanation,
  });
}

export function advanceBossCase(scene, run) {
  const current = restoreBossRun(scene, run);
  if (!current || current.phase !== 'counter') return current ? decision(current, 'inactive') : null;
  const cases = bossCases(scene);
  const bossCase = cases[current.caseIndex];
  if (!bossCase || !current.clearedCases.includes(bossCase.id)) {
    return decision(current, 'case-locked', { caseId: bossCase?.id });
  }
  if (current.caseIndex + 1 >= cases.length) {
    const next = { ...current, phase: 'resolved', outcome: 'truth' };
    return decision(next, 'truth', { accepted: true, destination: scene.boss.endings.truth, caseId: bossCase.id });
  }
  const next = { ...current, caseIndex: current.caseIndex + 1 };
  return decision(next, 'advanced', { accepted: true, caseId: cases[next.caseIndex].id });
}
