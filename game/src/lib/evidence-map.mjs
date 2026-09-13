// Deterministic evidence graph: only authored, already-unlocked material is shown.
// It never asks a model to infer a relationship or reveals undiscovered clues.
const kindOf = (clue) => clue?.kind || 'observation';

export function buildEvidenceGraph(story, vars = {}, memo = []) {
  const clues = story?.clues || [];
  const byId = new Map(clues.map((clue) => [clue.id, clue]));
  const found = clues.filter((clue) => vars[clue.id] === 'found');
  const linkedIds = new Set();

  const checks = (story?.scenes || []).flatMap((scene) =>
    (scene.investigation?.checks || []).map((check) => ({ scene, check })),
  );
  const verified = checks.flatMap(({ scene, check }) => {
    const unlocked = (check.grants || []).some((id) => vars[id] === 'found');
    if (!unlocked) return [];
    const evidence = (check.answer || []).map((id) => byId.get(id)).filter((clue) => clue && vars[clue.id] === 'found');
    const conclusions = (check.grants || []).map((id) => byId.get(id)).filter((clue) => clue && vars[clue.id] === 'found');
    for (const clue of [...evidence, ...conclusions]) linkedIds.add(clue.id);
    return [{
      id: `${scene.id}:${check.id}`,
      chapter: scene.chapter || '',
      claim: check.claim || check.prompt,
      boundary: check.success,
      evidence: evidence.map((clue) => ({ id: clue.id, name: clue.name, kind: kindOf(clue) })),
      conclusions: conclusions.map((clue) => ({ id: clue.id, name: clue.name, kind: kindOf(clue) })),
    }];
  });

  const argumentsByScene = new Map();
  for (const entry of memo) {
    if (entry.kind !== 'boss') continue;
    const scene = story?.scenes?.find((candidate) => candidate.id === entry.sceneId);
    if (!scene?.boss) continue;
    const current = argumentsByScene.get(entry.sceneId) || {
      id: entry.sceneId,
      question: scene.boss.question,
      claim: '',
      outcome: undefined,
      evidence: [],
    };
    if (entry.claimId) {
      const claim = scene.boss.claims?.find((candidate) => candidate.id === entry.claimId);
      if (claim) current.claim = claim.statement;
    }
    if (entry.clue && entry.accepted && !current.evidence.some((item) => item.id === entry.clue && item.caseId === entry.caseId)) {
      const clue = byId.get(entry.clue);
      if (clue) {
        linkedIds.add(clue.id);
        current.evidence.push({ id: clue.id, name: clue.name, kind: kindOf(clue), caseId: entry.caseId, result: entry.result || 'supported' });
      }
    }
    if (entry.outcome) current.outcome = entry.outcome;
    argumentsByScene.set(entry.sceneId, current);
  }

  const argumentsMade = [...argumentsByScene.values()].filter((item) => item.claim || item.evidence.length);
  const loose = found.filter((clue) => !linkedIds.has(clue.id)).map((clue) => ({ id: clue.id, name: clue.name, kind: kindOf(clue) }));
  return { foundCount: found.length, verified, arguments: argumentsMade, loose };
}
