// 步骤编排：参数解析 + mock/真实模式切换 + 每步产物落盘 out/<storyId>/。
// 各步骤文件（ingest/analyze/design/compile/validate）是薄入口，复用这里。
import fs from 'node:fs';
import path from 'node:path';
import { PKG_ROOT, OUT_ROOT, log, warn, err, readJson, writeJson, setQuiet } from './util.mjs';
import { resolveConfig, resolveSecret, forceMockFromEnv } from './conf.mjs';
import { validateAnalysis, validateStructure, deriveLoreIds } from './schemas.mjs';
import * as zhihu from './zhihu.mjs';
import * as mock from './mock.mjs';
import * as prompts from './prompts.mjs';
import { ingestFile } from './ingest-lib.mjs';
import { buildGame } from './compile-lib.mjs';

const DEFAULT_STORY = path.join(PKG_ROOT, 'examples', 'door-1007.txt');

export function parseArgs(argv) {
  const o = { story: null, out: null, file: null, mock: false, force: false, quiet: false, help: false, list: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    switch (a) {
      case '--story': case '-s': o.story = next(); break;
      case '--out': case '-o': o.out = next(); break;
      case '--file': case '-f': o.file = next(); break;
      case '--mock': o.mock = true; break;
      case '--force': o.force = true; break;
      case '--quiet': case '-q': o.quiet = true; break;
      case '--list': o.list = true; break;
      case '--help': case '-h': o.help = true; break;
      default: if (a && !a.startsWith('-')) o.story = a;
    }
  }
  return o;
}

export function pickStory(opts) {
  const given = opts.story || DEFAULT_STORY;
  const candidates = [given, path.resolve(given)];
  if (path.isAbsolute(given)) {
    candidates.length = 1;
  } else {
    candidates.push(path.join(PKG_ROOT, given.replace(/^pipeline[/\\]/, '')));
  }
  for (const p of candidates) {
    if (fs.existsSync(p)) return path.resolve(p);
  }
  throw new Error(`找不到故事文件：${given}\n用法：--story <路径.txt>（默认为 examples/door-1007.txt）`);
}

export function storyIdOf(file) {
  const base = path.basename(file).replace(/\.txt$/i, '');
  const s = base.replace(/[^\u4e00-\u9fa5A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
  return s || 'story';
}

export function artifactFile(storyId, name, outOverride) {
  return path.join(outOverride || OUT_ROOT, storyId, name);
}

function loadArtifact(storyId, name, outOverride) {
  return readJson(artifactFile(storyId, name, outOverride));
}

export async function detectMode(opts) {
  const conf = resolveConfig();
  const secretInfo = resolveSecret();
  const mockMode = opts.mock || forceMockFromEnv() || !secretInfo;
  return { conf, secretInfo, mockMode };
}

export function helpText() {
  return `看山任意门 · 编译管线
用法：
  npm run all    -- --story <txt路径> [--mock] [--force] [--out 目录]
  npm run ingest -- --story <txt路径>            # 只跑某一步（可单独重跑）
  npm run analyze / design / compile / validate  # 同理
  npm run validate -- --story <id> 或 --file <game.json>

参数：
  --story <txt>   故事文件（默认 examples/door-1007.txt）
  --file <json>   validate 直接检查某个 game.json
  --mock          强制 mock（无 key 时自动进入 mock，无需此参数）
  --force         绕过 LLM 本地缓存重跑
  --out <目录>    产物根目录（默认 pipeline/out）
  --quiet         减少日志
环境变量：ZHIHU_ACCESS_SECRET / ZHIHU_ACCESS_SECRET_FILE / ZHIHU_MODEL_THINKING /
          ZHIHU_MODEL_FAST / ZHIHU_MOCK=1（详见 .env.example 与 README）
`;
}

// ---------- 步骤实现 ----------

async function stepIngest(opts) {
  const file = pickStory(opts);
  const raw = ingestFile(file);
  const storyId = raw.storyId;
  const outFile = writeJson(artifactFile(storyId, 'raw.json', opts.out), raw);
  log(`[ingest] ${path.basename(file)} → ${raw.title}（${raw.wordCount} 字，${raw.paragraphs.length} 段）`);
  log(`         ${path.relative(PKG_ROOT, outFile)}`);
  return { storyId, raw };
}

async function stepAnalyze(opts) {
  const { conf, secretInfo, mockMode } = await detectMode(opts);
  const file = pickStory(opts);
  const storyId = storyIdOf(file);
  const raw = loadArtifact(storyId, 'raw.json', opts.out);
  let analysis;
  if (mockMode) {
    analysis = mock.mockAnalyze(raw);
  } else {
    log(`[analyze] 知乎直答 ${conf.modelFor('thinking')}（缓存按 prompt hash）`);
    const msg = prompts.buildAnalyze(raw);
    const problems = validateAnalysis;
    analysis = await zhihu.llmJson({
      baseUrl: conf.baseUrl, secret: secretInfo.secret, model: conf.modelFor(msg.kind),
      system: msg.system, user: msg.user, validate: (d) => validateAnalysis(d), retries: 2, force: opts.force,
    });
  }
  const p = validateAnalysis(analysis);
  if (p.length) throw new Error(`analysis 未通过 schema：\n${p.slice(0, 8).join('\n')}`);
  const outFile = writeJson(artifactFile(storyId, 'analysis.json', opts.out), analysis);
  log(`[analyze] 人物 ${analysis.characters.length} · 地点 ${analysis.locations.length} · 事件 ${analysis.timeline.length} · 世界观规则 ${analysis.worldRules.length} · 伏笔 ${analysis.foreshadowing.length}`);
  log(`         ${path.relative(PKG_ROOT, outFile)}`);
  return { storyId, analysis };
}

async function stepDesign(opts) {
  const { conf, secretInfo, mockMode } = await detectMode(opts);
  const file = pickStory(opts);
  const storyId = storyIdOf(file);
  const raw = loadArtifact(storyId, 'raw.json', opts.out);
  const analysis = loadArtifact(storyId, 'analysis.json', opts.out);
  const ctx = structureCtx(raw, analysis);
  let structure;
  if (mockMode) {
    structure = mock.mockDesign(raw, analysis);
  } else {
    log(`[design] 知乎直答 ${conf.modelFor('thinking')}（缓存 + schema 校验重试）`);
    const msg = prompts.buildDesign(raw, analysis);
    structure = await zhihu.llmJson({
      baseUrl: conf.baseUrl, secret: secretInfo.secret, model: conf.modelFor(msg.kind),
      system: msg.system, user: msg.user,
      validate: (d) => validateStructure(d, ctx), retries: 4, force: opts.force,
    });
  }
  const p = validateStructure(structure, ctx);
  if (p.length) throw new Error(`structure 未通过 schema/图校验：\n${p.slice(0, 8).join('\n')}`);
  const outFile = writeJson(artifactFile(storyId, 'structure.json', opts.out), structure);
  const byType = {};
  for (const s of structure.scenes) byType[s.type] = (byType[s.type] || 0) + 1;
  log(`[design] ${structure.scenes.length} 场景（${Object.entries(byType).map(([k, v]) => `${k}×${v}`).join(' ')}）· ${structure.endings.length} 结局 · ${structure.npcs.length} NPC · ${structure.variables.length} 变量`);
  log(`         ${path.relative(PKG_ROOT, outFile)}`);
  return { storyId, structure };
}

function structureCtx(raw, analysis) {
  return {
    paragraphCount: (raw.paragraphs || []).length,
    charIds: (analysis.characters || []).map((c) => c.id),
    nonProtagonistIds: (analysis.characters || []).filter((c) => c.role !== 'protagonist').map((c) => c.id),
    loreIds: deriveLoreIds(analysis),
  };
}

async function stepCompile(opts) {
  const { conf, secretInfo, mockMode } = await detectMode(opts);
  const file = pickStory(opts);
  const storyId = storyIdOf(file);
  const raw = loadArtifact(storyId, 'raw.json', opts.out);
  const analysis = loadArtifact(storyId, 'analysis.json', opts.out);
  const structure = loadArtifact(storyId, 'structure.json', opts.out);

  const sceneTexts = new Map();
  let npcCards;
  let kanshan;
  if (mockMode) {
    mock.mockSceneTexts(raw, analysis, structure).forEach((v, k) => sceneTexts.set(k, v));
    mock.mockEndingTexts(raw, analysis, structure, sceneTexts);
    npcCards = mock.mockNpcCards(analysis, structure, sceneTexts);
    kanshan = mock.mockKanshan(analysis);
  } else {
    log(`[compile] 场景正文（${conf.modelFor('thinking')}）`);
    const msgA = prompts.buildSceneTexts(raw, analysis, structure);
    const expectIds = structure.scenes.filter((s) => s.type !== 'ending').map((s) => s.id);
    const sceneRes = await zhihu.llmJson({
      baseUrl: conf.baseUrl, secret: secretInfo.secret, model: conf.modelFor(msgA.kind),
      system: msgA.system, user: msgA.user, retries: 1, force: opts.force,
      validate: (d) => {
        const p = [];
        if (!Array.isArray(d?.scenes)) return ['缺少 scenes 数组'];
        const got = d.scenes.map((s) => s?.id);
        for (const id of expectIds) if (!got.includes(id)) p.push(`缺少场景正文：${id}`);
        for (const s of d.scenes) if (!s || typeof s.text !== 'string' || !s.text.trim()) p.push(`场景 ${s?.id || '?'} text 为空`);
        return p;
      },
    });
    for (const s of sceneRes.scenes) {
      sceneTexts.set(s.id, { text: s.text, chapter: s.chapter || '' });
    }

    log(`[compile] 结局 + NPC 卡（${conf.modelFor('thinking')}）`);
    const msgB = prompts.buildEndingsAndNpcs(raw, analysis, structure);
    const endingRes = await zhihu.llmJson({
      baseUrl: conf.baseUrl, secret: secretInfo.secret, model: conf.modelFor(msgB.kind),
      system: msgB.system, user: msgB.user, retries: 1, force: opts.force,
      validate: (d) => {
        const p = [];
        const eIds = structure.endings.map((e) => e.id);
        const nIds = structure.npcs.map((n) => n.id);
        for (const id of eIds) if (!(d?.endings || []).some((e) => e.id === id)) p.push(`缺少结局文本：${id}`);
        for (const id of nIds) if (!(d?.npcs || []).some((n) => n.id === id)) p.push(`缺少 NPC 卡：${id}`);
        for (const n of d?.npcs || []) {
          const card = n?.card || {};
          for (const k of ['description', 'personality', 'scenario', 'first_mes', 'mes_example', 'system_prompt']) {
            if (typeof card[k] !== 'string') p.push(`NPC ${n.id} card.${k} 需为字符串`);
          }
        }
        return p;
      },
    });
    for (const e of endingRes.endings) {
      sceneTexts.set(e.id, { text: e.text, chapter: '' });
    }
    npcCards = endingRes.npcs.map((n) => ({ id: n.id, name: null, card: n.card }));
    for (const card of npcCards) {
      const ch = (analysis.characters || []).find((c) => c.id === card.id);
      card.name = ch?.name || card.id;
      card.card.system_prompt = ensureNpcConstraints(card.card.system_prompt, analysis.title);
    }

    log(`[compile] 刘看山引导（${conf.modelFor('fast')}）`);
    const msgC = prompts.buildKanshan(analysis);
    kanshan = await zhihu.llmJson({
      baseUrl: conf.baseUrl, secret: secretInfo.secret, model: conf.modelFor(msgC.kind),
      system: msgC.system, user: msgC.user, retries: 1, force: opts.force,
      validate: (d) => {
        const p = [];
        if (!d || typeof d.intro !== 'string' || !d.intro.trim()) p.push('缺少 intro');
        if (!Array.isArray(d?.rescueLines) || d.rescueLines.length < 3) p.push('rescueLines 至少 3 条');
        return p;
      },
    });
  }

  const game = buildGame({ raw, analysis, structure, sceneTexts, npcCards, kanshan });
  // 补 ending 场景 chapter（若 LLM 没给）
  for (const e of structure.endings) {
    const s = game.scenes.find((x) => x.id === e.id);
    if (s && !s.chapter) s.chapter = `结局 · ${e.title}`;
  }
  const outFile = writeJson(artifactFile(storyId, 'game.json', opts.out), game);
  const summary = summarize(game);
  log(`[compile] ${summary}`);
  log(`         ${path.relative(PKG_ROOT, outFile)}`);
  return { storyId, game };
}

function ensureNpcConstraints(systemPrompt, title) {
  let s = systemPrompt || '';
  const rules = [];
  if (!/剧透/.test(s)) rules.push('不剧透尚未发生的剧情，不主动揭露伏笔与结局');
  if (!/原著人设|人设/.test(s)) rules.push(`不脱离《${title}》原著人设`);
  if (!/AI|人工智能|程序|模型/.test(s)) rules.push('你不是 AI，也不承认自己是模型或程序');
  if (rules.length) {
    s = `${s.replace(/\s*$/, '')}\n附加约束：${rules.join('；')}。`;
  }
  return s;
}

function summarize(game) {
  const ends = game.scenes.filter((s) => s.type === 'ending').length;
  const chats = game.scenes.filter((s) => s.type === 'chat').length;
  const choices = game.scenes.filter((s) => s.type === 'choice').length;
  const vars = new Set();
  for (const s of game.scenes) for (const c of s.choices || []) Object.keys(c.set || {}).forEach((k) => vars.add(k));
  return `game.json：${game.scenes.length} 场景（novel×${game.scenes.length - ends - chats - choices} choice×${choices} chat×${chats} ending×${ends}）· NPC×${game.npcs.length} · lore×${game.lore.length} · 结局×${game.endings.length} · 变量 ${[...vars].join('/') || '无'}`;
}

export async function stepValidate(opts) {
  const { secretInfo, mockMode } = await detectMode(opts);
  void secretInfo; void mockMode;
  let gameFile = opts.file;
  let label;
  if (!gameFile) {
    const file = pickStory(opts);
    const storyId = storyIdOf(file);
    gameFile = artifactFile(storyId, 'game.json', opts.out);
    label = `story=${storyId}`;
  } else {
    label = path.basename(gameFile);
  }
  if (!fs.existsSync(gameFile)) {
    throw new Error(`找不到 ${gameFile}——先跑 ingest/analyze/design/compile（npm run all -- --story … --mock）`);
  }
  const game = readJson(gameFile);
  const { checkGameContract } = await import('./schemas.mjs');
  const res = checkGameContract(game);
  if (res.problems.length) {
    err(`[validate] ${label}：契约/图检查失败 ${res.problems.length} 项`);
    for (const p of res.problems) err(`  · [${p.code}] ${p.path || '(root)'} ${p.msg}`);
    return { ok: false, res };
  }
  log(`[validate] ${label}：通过（${game.scenes.length} 场景 / ${game.endings.length} 结局 / ${game.npcs.length} NPC / ${game.lore.length} lore）`);
  if (res.warnings.length) {
    for (const w of res.warnings) warn(`  · ${w.msg}`);
  }
  return { ok: true, res };
}

// ---------- 单一入口 ----------
export async function runStep(stepName, argv) {
  const opts = parseArgs(argv);
  if (opts.help) {
    console.log(helpText());
    return { ok: true };
  }
  if (opts.quiet) setQuiet(true);
  switch (stepName) {
    case 'ingest': return stepIngest(opts);
    case 'analyze': return stepAnalyze(opts);
    case 'design': return stepDesign(opts);
    case 'compile': return stepCompile(opts);
    case 'validate': return stepValidate(opts);
    case 'all': return runAll(opts);
    default: throw new Error(`未知步骤 ${stepName}`);
  }
}

export async function runAll(opts) {
  const story = pickStory(opts);
  const storyId = storyIdOf(story);
  const { mockMode, secretInfo, conf } = await detectMode(opts);
  log(`看山任意门管线 · ${storyId}`);
  log(`  模式：${mockMode ? 'mock（规则生成器，离线可用）' : `真实（${conf.modelThinking} / ${conf.modelFast}，缓存于 .cache/）`}`);
  if (!mockMode && secretInfo) log(`  secret 来源：${secretInfo.source}（内容不落日志）`);
  const t0 = Date.now();
  await stepIngest(opts);
  await stepAnalyze(opts);
  await stepDesign(opts);
  await stepCompile(opts);
  const v = await stepValidate(opts);
  log(`完成，耗时 ${((Date.now() - t0) / 1000).toFixed(1)}s → out/${storyId}/game.json`);
  return v;
}
