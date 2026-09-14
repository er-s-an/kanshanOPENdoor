const MAX_LINE_LENGTH = 72;
const ACTION_HINT = /^(?:先|第一步|去|与|和|从|走近|听|问|查|看清|试试|记住|别|你可以|你要|远处看不清)/;
const ANOMALY_HINT = /(?:异常|陌生|危险|不对|不可信|失踪|死亡|迷路|看不清|模糊|只有|却|但是|然而|突然|副本|诡异|奇怪|雾)/;

function cleanProse(value) {
  return String(value || '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/【[^】]+】/g, ' ')
    .replace(/[`*_>#~]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function sentences(value) {
  const clean = cleanProse(value);
  if (!clean) return [];
  return clean.match(/[^。！？!?；;]+[。！？!?；;]?/g)?.map((line) => line.trim()).filter(Boolean) || [];
}

function finishSentence(value) {
  const clean = cleanProse(value).replace(/[：:，、—\-]+$/u, '').trim();
  if (!clean) return '';
  const chars = Array.from(clean);
  if (chars.length > MAX_LINE_LENGTH) return `${chars.slice(0, MAX_LINE_LENGTH - 1).join('').replace(/[，、：:；;\s]+$/u, '')}…`;
  return /[。！？!?；;…]$/.test(clean) ? clean : `${clean}。`;
}

function identityFrom(lines) {
  for (const line of lines) {
    const match = line.match(/(?:^|[，,])(?:进去以后|此刻|现在)?你(?:就)?是([^，,。！？!?；;]{1,28})/);
    if (match) return finishSentence(`你是${match[1].trim()}`);
  }
  return '';
}

function firstSentence(value) {
  return finishSentence(sentences(value)[0] || '');
}

function actionFor(scene, introLines) {
  const guideLine = introLines.find((line) => ACTION_HINT.test(cleanProse(line)));
  if (guideLine) return finishSentence(guideLine);
  const authored = [
    scene?.objective,
    scene?.investigation?.objective,
    scene?.encounter?.objective,
    scene?.goal,
  ].map(firstSentence).find(Boolean);
  if (authored) return authored;
  return '';
}

function fallbackAction(scene) {
  if (scene?.type === 'chat') return `先听听${scene.npc ? `「${scene.npc}」` : '眼前的人'}怎么说，再决定是否相信。`;
  if (scene?.type === 'investigate') return '先从眼前能确认的细节开始搜证。';
  if (scene?.type === 'encounter') return '先看清手里的资源，再采取第一步行动。';
  return '先看清眼前发生了什么，再做第一步选择。';
}

/**
 * Build a spoiler-bounded three-line handoff from data visible at the first scene.
 * Future scenes, lore, clues and endings are deliberately never inspected here.
 */
export function buildStoryBriefing(story, scene) {
  const title = cleanProse(story?.story?.title) || '这个故事';
  const introLines = sentences(story?.kanshan?.intro);
  const firstSceneLines = sentences(scene?.text);
  const visibleLines = [...introLines, ...firstSceneLines];

  const identity = identityFrom(visibleLines) || `你是《${title}》里的当事人，接下来由你做决定。`;
  const firstStep = actionFor(scene, introLines) || fallbackAction(scene);
  const identityClean = cleanProse(identity);
  const stepClean = cleanProse(firstStep);
  const anomalyCandidate = introLines.find((line) => {
    const clean = cleanProse(line);
    return clean !== identityClean && clean !== stepClean && !ACTION_HINT.test(clean) && ANOMALY_HINT.test(clean);
  }) || firstSceneLines.find((line) => ANOMALY_HINT.test(cleanProse(line)))
    || firstSceneLines.find((line) => !ACTION_HINT.test(cleanProse(line)));
  const anomaly = finishSentence(anomalyCandidate || '眼前发生的事还没有完整答案。');

  return {
    identity: finishSentence(identity),
    anomaly: anomaly === identity || anomaly === firstStep ? '眼前发生的事还没有完整答案。' : anomaly,
    firstStep: finishSentence(firstStep),
  };
}
