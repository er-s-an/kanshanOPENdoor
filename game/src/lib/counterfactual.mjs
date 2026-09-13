// Finds one real authored fork from this run. It describes the choice delta only;
// unwitnessed story consequences are intentionally not invented.
import { choicePersonaSignals } from './persona.mjs';

const AXIS = {
  evidence: ['证物', '证言'], testimony: ['证言', '证物'],
  push: ['继续追击', '保持克制'], restrain: ['保持克制', '继续追击'],
  public: ['公开发声', '隐蔽留存'], private: ['隐蔽留存', '公开发声'],
};

const signalPairs = (selected, candidate) => {
  const left = choicePersonaSignals(selected);
  const right = choicePersonaSignals(candidate);
  return left.flatMap((signal) => right
    .filter((other) => other.axis === signal.axis && other.side !== signal.side)
    .map((other) => ({ signal, other, score: signal.weight + other.weight })));
};

export function buildCounterfactual(story, memo = []) {
  for (let index = memo.length - 1; index >= 0; index -= 1) {
    const entry = memo[index];
    if (entry.kind === 'boss' && entry.event === 'claim-selected' && entry.claimId) {
      const scene = story?.scenes?.find((candidate) => candidate.id === entry.sceneId);
      const selected = scene?.boss?.claims?.find((claim) => claim.id === entry.claimId);
      const claims = scene?.boss?.claims || [];
      if (!selected || claims.length < 2) continue;
      const alternative = selected.resolution === 'fold'
        ? claims.find((claim) => claim.id !== selected.id && claim.resolution !== 'fold')
        : claims.find((claim) => claim.id !== selected.id && claim.resolution !== 'fold' && claim.certainty !== selected.certainty)
          || claims.find((claim) => claim.id !== selected.id && claim.resolution !== 'fold');
      if (!alternative) continue;
      const label = (claim) => claim.resolution === 'fold' ? '越界指认' : claim.certainty === 'fact' ? '事实陈述' : '有限假说';
      return {
        sceneId: scene.id,
        chapter: scene.chapter || '公开论证',
        selected: selected.statement,
        alternative: alternative.statement,
        axisFrom: label(selected),
        axisTo: label(alternative),
        note: '这会直接改变公开论证能否站在现有证据上；未被材料支持的幕后原因仍不会被替你写成真相。',
      };
    }
    if (entry.kind !== 'choice') continue;
    const scene = story?.scenes?.find((candidate) => candidate.id === entry.sceneId);
    if (!scene?.choices || scene.choices.length < 2) continue;
    const selected = scene.choices.find((choice) => choice.id === entry.choiceId)
      || scene.choices.find((choice) => choice.text === entry.text);
    if (!selected) continue;
    const comparisons = scene.choices
      .filter((choice) => choice.id !== selected.id)
      .flatMap((alternative) => signalPairs(selected, alternative).map((pair) => ({ alternative, ...pair })))
      .sort((a, b) => b.score - a.score);
    const comparison = comparisons[0];
    if (!comparison || !AXIS[comparison.signal.side]) continue;
    const labels = AXIS[comparison.signal.side];
    return {
      sceneId: scene.id,
      chapter: scene.chapter || '本章途中',
      selected: selected.text,
      alternative: comparison.alternative.text,
      axisFrom: labels[0],
      axisTo: AXIS[comparison.other.side]?.[0] || labels[1],
      note: '这会改变刘看山记录你的调查姿态，并让故事沿另一条已写好的路线继续；没有发生的结果不会被替你编出来。',
    };
  }
  return null;
}
