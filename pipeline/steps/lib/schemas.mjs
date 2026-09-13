// schema 校验与图完整性检查（纯函数，供 steps 与 test 复用）
// - validateAnalysis / validateStructure：把模型（或 mock）输出变成可用的内部文档，
//   校验失败返回可读问题列表（作为 LLM 重试反馈）。
// - checkGameContract：对最终 game.json 做契约 + 图完整性检查，
//   返回 [{code,path,msg}] problems 与 warnings（规模目标等软性提示）。

const TYPES = ['novel', 'chat', 'choice', 'ending'];
const ROLES = ['protagonist', 'key_npc', 'antagonist', 'minor'];
const ID_RE = /^[A-Za-z][A-Za-z0-9_-]{0,39}$/;
const VAR_RE = /^[a-z][a-z0-9_]{0,31}$/;

const isStr = (v) => typeof v === 'string';
const nonEmptyStr = (v) => typeof v === 'string' && v.trim().length > 0;
const isArr = (v) => Array.isArray(v);
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isInt = (v) => Number.isInteger(v);

function pushIf(cond, sink, msg) {
  if (!cond) return;
  if (typeof sink === 'function') sink(msg);
  else sink.push(msg);
}

function basicProblems(list, kind) {
  const p = [];
  pushIf(!isObj(list), p, `${kind} 必须是对象`);
  return p;
}

function idsUnique(items, p, label, get = (x) => x?.id) {
  const seen = new Set();
  for (const it of items) {
    const id = get(it);
    if (!nonEmptyStr(id)) p.push(`${label}存在缺少 id 的条目`);
    else if (seen.has(id)) p.push(`${label} id 重复：${id}`);
    else if (!ID_RE.test(id)) p.push(`${label} id 需为 ASCII 标识符（如 npc_xu），得到：${id}`);
    seen.add(id);
  }
}

// ---------------- analysis.json ----------------
export function validateAnalysis(a) {
  const p = basicProblems(a, 'analysis');
  if (p.length) return p;
  const need = ['storyId', 'title', 'logline', 'tags', 'characters', 'locations', 'timeline', 'worldRules', 'foreshadowing', 'completeness', 'discoveries'];
  for (const k of need) pushIf(!(k in a), p, `缺少顶层字段 ${k}`);
  if (need.some((k) => !(k in a))) return p;
  pushIf(!nonEmptyStr(a.storyId), p, 'storyId 为空');
  pushIf(!nonEmptyStr(a.title), p, 'title 为空');
  pushIf(!nonEmptyStr(a.logline), p, 'logline 为空');
  pushIf(!isArr(a.tags) || a.tags.some((t) => !nonEmptyStr(t)), p, 'tags 需为非空字符串数组');
  if (!['complete', 'truncated', 'unknown'].includes(a.completeness)) {
    p.push(`completeness 需为 complete|truncated|unknown，得到：${a.completeness}`);
  }
  if (!isArr(a.discoveries)) p.push('discoveries 需为数组（可为空）');
  else {
    idsUnique(a.discoveries, p, 'discoveries');
    for (const d of a.discoveries) {
      if (!isObj(d)) { p.push('discovery 需为对象'); continue; }
      if (!nonEmptyStr(d.content)) p.push(`discovery ${d.id || '?'} 缺少 content`);
      if (!['fact', 'secret', 'feeling', 'rule'].includes(d.kind)) p.push(`discovery ${d.id || '?'} kind 非法：${d.kind}（应为 fact/secret/feeling/rule）`);
      if (typeof d.criticalForClimax !== 'boolean') p.push(`discovery ${d.id || '?'} criticalForClimax 需为布尔值`);
    }
  }
  for (const [k, min] of [['characters', 1], ['locations', 1], ['timeline', 1]]) {
    if (!isArr(a[k])) p.push(`${k} 需为数组`);
    else if (a[k].length < min) p.push(`${k} 至少 ${min} 条`);
  }
  if (p.length) return p;
  idsUnique(a.characters, p, 'characters');
  for (const c of a.characters) {
    if (!isObj(c)) { p.push('character 需为对象'); continue; }
    pushIf(!nonEmptyStr(c.name), p, `角色 ${c.id || '?'} 缺少 name`);
    if (!ROLES.includes(c.role)) p.push(`角色 ${c.id || '?'} role 非法：${c.role}（应为 ${ROLES.join('/')}）`);
    pushIf(!isArr(c.personality) || c.personality.some((t) => !nonEmptyStr(t)), p, `角色 ${c.id || '?'} personality 需为非空字符串数组`);
    pushIf(!isStr(c.motivation), p, `角色 ${c.id || '?'} motivation 需为字符串`);
    pushIf(!isStr(c.catchphrase), p, `角色 ${c.id || '?'} catchphrase 需为字符串（可空）`);
    pushIf(!isStr(c.summary), p, `角色 ${c.id || '?'} summary 需为字符串`);
  }
  idsUnique(a.locations, p, 'locations');
  for (const l of a.locations) {
    if (!isObj(l)) { p.push('location 需为对象'); continue; }
    for (const k of ['name', 'kind', 'description']) pushIf(!nonEmptyStr(l[k]), p, `地点 ${l.id || '?'} 缺少 ${k}`);
  }
  idsUnique(a.timeline, p, 'timeline');
  let lastOrder = -Infinity;
  for (const t of a.timeline) {
    if (!isObj(t)) { p.push('timeline 条目需为对象'); continue; }
    for (const k of ['title', 'description']) pushIf(!nonEmptyStr(t[k]), p, `事件 ${t.id || '?'} 缺少 ${k}`);
    if (!['major', 'minor'].includes(t.importance)) p.push(`事件 ${t.id || '?'} importance 非法：${t.importance}`);
    pushIf(!isInt(t.order), p, `事件 ${t.id || '?'} order 需为整数`);
    if (isInt(t.order) && t.order < lastOrder) p.push('timeline 需按 order 升序排列');
    if (isInt(t.order)) lastOrder = t.order;
  }
  idsUnique(a.worldRules, p, 'worldRules');
  for (const r of a.worldRules) if (!isObj(r) || !nonEmptyStr(r.rule)) p.push(`worldRule ${r?.id || '?'} 缺少 rule 文本`);
  idsUnique(a.foreshadowing, p, 'foreshadowing');
  for (const f of a.foreshadowing) {
    if (!isObj(f)) { p.push('foreshadowing 条目需为对象'); continue; }
    pushIf(!nonEmptyStr(f.description), p, `伏笔 ${f.id || '?'} 缺少 description`);
    pushIf(!isStr(f.plantedAt), p, `伏笔 ${f.id || '?'} plantedAt 需为字符串`);
    pushIf(!isStr(f.payoffHint), p, `伏笔 ${f.id || '?'} payoffHint 需为字符串`);
  }
  return p;
}

// ---------------- 图相关共用 ----------------
// 计算“可到达结局”集合（反向 BFS）
function endingReachable(scenes, outEdges) {
  const byId = new Map(scenes.map((s) => [s.id, s]));
  const rev = new Map(scenes.map((s) => [s.id, []]));
  for (const s of scenes) {
    if (byId.has(s.id) && byId.get(s.id) === s) {
      for (const t of outEdges(s)) {
        if (rev.has(t)) rev.get(t).push(s.id);
      }
    }
  }
  const canEnd = new Set();
  const stack = scenes.filter((s) => s.type === 'ending').map((s) => s.id);
  while (stack.length) {
    const id = stack.pop();
    if (canEnd.has(id)) continue;
    canEnd.add(id);
    for (const prev of rev.get(id) || []) stack.push(prev);
  }
  return canEnd;
}

export function buildOutEdges(scene) {
  const viaChoices = (scene.choices || []).map((c) => c.next);
  const viaOne = [scene.next, scene.goto].filter(Boolean);
  if (scene.type === 'ending') return [...viaChoices, ...viaOne]; // 仅用于发现“结局不该有出口”的违规
  if (viaChoices.length) return viaChoices;
  return viaOne;
}

// 图完整性：返回 [{code,path,msg}]。scenes 需含 type/id/next/goto/choices。
export function graphProblems(scenes, opts = {}) {
  const p = [];
  const byId = new Map();
  for (const s of scenes) {
    if (!byId.has(s.id)) byId.set(s.id, s);
  }
  const edges = buildOutEdges;
  for (const s of scenes) {
    const path = `scenes.${s.id}`;
    const outs = edges(s);
    for (const t of outs) {
      if (!byId.has(t)) p.push({ code: 'target-missing', path, msg: `${path} 指向不存在的场景 ${t}` });
    }
    if (s.type !== 'ending' && outs.length === 0) {
      p.push({ code: 'no-outgoing', path, msg: `${path}（${s.type}）没有可前进的出口` });
    }
    if (s.type === 'ending' && outs.length > 0) {
      p.push({ code: 'ending-has-out', path, msg: `${path} 是 ending 场景，不应有 next/goto/choices` });
    }
  }
  const start = opts.startId;
  if (start === undefined) return p;
  if (!byId.has(start)) {
    p.push({ code: 'start-missing', path: 'start', msg: `start 指向不存在的场景 ${start}` });
    return p;
  }
  // 从 start 出发的可达性
  const reach = new Set();
  const stack = [start];
  while (stack.length) {
    const id = stack.pop();
    if (reach.has(id)) continue;
    reach.add(id);
    const s = byId.get(id);
    if (!s) continue;
    for (const t of edges(s)) if (!reach.has(t)) stack.push(t);
  }
  for (const s of scenes) {
    if (!reach.has(s.id)) {
      p.push({ code: 'unreachable', path: `scenes.${s.id}`, msg: `场景 ${s.id} 从 start 不可达` });
    }
  }
  // 每个场景都能（最终）走到某个 ending，否则说明存在死路/死循环
  const canEnd = endingReachable(scenes, edges);
  for (const s of scenes) {
    if (reach.has(s.id) && !canEnd.has(s.id)) {
      p.push({ code: 'no-end-path', path: `scenes.${s.id}`, msg: `场景 ${s.id} 无法到达任何结局（死路或死循环）` });
    }
  }
  return p;
}

// 条件门可满足性：带 requires 的选项，其每个「变量=值」都必须能被上游某个选项设置，
// 且设置者所在场景能到达本场景（否则这扇门永远打不开）。返回 [{path,msg}]。
export function gateProblems(scenes) {
  const p = [];
  const byId = new Map(scenes.map((s) => [s.id, s]));
  // setter 索引：'var=value' → 能设置它的场景 id 集合
  const setters = new Map();
  for (const s of scenes) {
    for (const c of s.choices || []) {
      for (const [k, v] of Object.entries(c.set || {})) {
        const key = `${k}=${String(v)}`;
        if (!setters.has(key)) setters.set(key, new Set());
        setters.get(key).add(s.id);
      }
    }
  }
  const reachCache = new Map();
  const reachableFrom = (start) => {
    if (reachCache.has(start)) return reachCache.get(start);
    const seen = new Set();
    const stack = [start];
    while (stack.length) {
      const id = stack.pop();
      if (seen.has(id)) continue;
      seen.add(id);
      const s = byId.get(id);
      if (!s) continue;
      for (const t of buildOutEdges(s)) stack.push(t);
    }
    reachCache.set(start, seen);
    return seen;
  };
  for (const s of scenes) {
    for (const c of s.choices || []) {
      if (!isObj(c.requires)) continue;
      const label = clipText(String(c.text || c.id || '?'), 18);
      for (const [k, v] of Object.entries(c.requires)) {
        const from = [...(setters.get(`${k}=${String(v)}`) || [])].filter((id) => id !== s.id);
        if (!from.length) {
          p.push({ path: `scenes.${s.id}`, msg: `选项「${label}」要求 ${k}=${String(v)}，但没有任何其他场景的选项能设置它` });
          continue;
        }
        if (!from.some((id) => reachableFrom(id).has(s.id))) {
          p.push({ path: `scenes.${s.id}`, msg: `选项「${label}」要求 ${k}=${String(v)}，但能设置它的场景都到不了 ${s.id}（门永远锁死）` });
        }
      }
    }
  }
  return p;
}

function clipText(s, n) {
  return s.length <= n ? s : `${s.slice(0, n)}…`;
}

// ---------------- structure.json（design 步骤产物） ----------------
// ctx: { paragraphCount, charIds, nonProtagonistIds, loreIds, chatAllowedNpcIds }
export function validateStructure(s, ctx = {}) {
  const p = basicProblems(s, 'structure');
  if (p.length) return p;
  const need = ['storyId', 'title', 'premise', 'tags', 'variables', 'scenes', 'endings', 'npcs'];
  for (const k of need) if (!(k in s)) p.push(`缺少顶层字段 ${k}`);
  if (need.some((k) => !(k in s))) return p;
  const P = (m) => p.push(m);
  pushIf(!nonEmptyStr(s.storyId), P, 'storyId 为空');
  pushIf(!nonEmptyStr(s.premise), P, 'premise（两难主题一句话）为空');
  pushIf(!isArr(s.variables), P, 'variables 需为数组');
  pushIf(!isArr(s.scenes) || s.scenes.length < 8 || s.scenes.length > 14, P, `scenes 数量需在 8–14（得到 ${s.scenes?.length}）`);
  pushIf(!isArr(s.endings) || s.endings.length < 3 || s.endings.length > 5, P, `endings 数量需在 3–5（得到 ${s.endings?.length}）`);
  pushIf(!isArr(s.npcs) || s.npcs.length < 2 || s.npcs.length > 4, P, `npcs 数量需在 2–4（得到 ${s.npcs?.length}）`);
  pushIf(!isArr(s.tags) || s.tags.some((t) => !nonEmptyStr(t)), P, 'tags 需为非空字符串数组');
  if (p.length) return p;

  // variables
  const varNames = new Set();
  const varByName = new Map();
  for (const v of s.variables) {
    if (!isObj(v) || !nonEmptyStr(v.name)) { P('variables 条目缺少 name'); continue; }
    if (!VAR_RE.test(v.name)) P(`变量名需匹配 ${VAR_RE}，得到：${v.name}`);
    if (varNames.has(v.name)) P(`变量重复：${v.name}`);
    varNames.add(v.name);
    varByName.set(v.name, v);
    pushIf(!isArr(v.values), P, `变量 ${v.name} 缺少 values`);
    pushIf(!nonEmptyStr(v.meaning), P, `变量 ${v.name} 缺少 meaning`);
  }

  // scenes 基础形状
  idsUnique(s.scenes, p, 'scenes');
  const byId = new Map(s.scenes.map((x) => [x.id, x]));
  const endingIds = new Set();
  for (const sc of s.scenes) {
    if (!isObj(sc)) { P('scene 需为对象'); continue; }
    const here = `scene ${sc.id}`;
    if (!TYPES.includes(sc.type)) P(`${here} type 非法：${sc.type}`);
    if (sc.type === 'ending') endingIds.add(sc.id);
    pushIf(!nonEmptyStr(sc.purpose), P, `${here} 缺少 purpose（叙事意图说明）`);
    pushIf(!isStr(sc.chapter) || sc.chapter.length > 30, P, `${here} chapter 需为 ≤30 字符字符串（可空由编译补）`);
    pushIf(!isStr(sc.narrative), P, `${here} narrative（编译提示）需为字符串`);
    // paragraphRange
    if (sc.paragraphRange != null) {
      const [a, b] = sc.paragraphRange;
      const total = ctx.paragraphCount;
      if (!isArr(sc.paragraphRange) || sc.paragraphRange.length !== 2 || !isInt(a) || !isInt(b) || a < 1 || (total != null && b > total) || a > b) {
        P(`${here} paragraphRange 需为 [起,止] 且在 1..${total ?? '?'} 内`);
      }
      if (sc.type === 'choice' || sc.type === 'chat') {
        P(`${here} 类型 ${sc.type} 不应带 paragraphRange（抉择/对话场景文本由编译生成）`);
      }
    }
    if (sc.type === 'novel' && sc.paragraphRange == null) P(`${here} novel 场景需要 paragraphRange 指向原著段落`);
    if (!isArr(sc.lore) || sc.lore.some((x) => !nonEmptyStr(x))) P(`${here} lore 需为 lore id 数组`);
  }
  if (p.length) return p;

  // endings ↔ scenes(type=ending) 双向一致
  idsUnique(s.endings, p, 'endings');
  for (const e of s.endings) {
    if (!isObj(e)) { P('endings 条目需为对象'); continue; }
    for (const k of ['title', 'tone']) pushIf(!nonEmptyStr(e[k]), P, `ending ${e.id || '?'} 缺少 ${k}`);
    pushIf(!isStr(e.summary), P, `ending ${e.id || '?'} summary 需为字符串`);
    if (!endingIds.has(e.id)) P(`endings 条目 ${e.id} 没有对应的 ending 场景`);
  }
  for (const id of endingIds) {
    if (!s.endings.some((e) => e.id === id)) P(`ending 场景 ${id} 未登记到 endings[]`);
  }

  // npcs
  idsUnique(s.npcs, p, 'npcs');
  const npcIds = new Set();
  const nonProto = new Set(ctx.nonProtagonistIds || []);
  for (const n of s.npcs) {
    if (!isObj(n) || !nonEmptyStr(n.id)) { P('npcs 条目缺少 id'); continue; }
    npcIds.add(n.id);
    if (ctx.charIds && ctx.charIds.length && !nonProto.has(n.id)) {
      P(`npc ${n.id} 不是分析文档里的非主角角色（主角不能做可对话 NPC）`);
    }
    pushIf(!isStr(n.notes), P, `npc ${n.id} notes 需为字符串`);
    if (n.chatScene != null) {
      const cs = byId.get(n.chatScene);
      if (!cs) P(`npc ${n.id} chatScene 指向不存在的场景 ${n.chatScene}`);
      else if (cs.type !== 'chat') P(`npc ${n.id} 的 chatScene ${n.chatScene} 不是 chat 类型`);
      else if (cs.npc !== n.id) P(`chat 场景 ${n.chatScene} 的 npc 不是 ${n.id}`);
    }
    if (!isArr(n.appearsIn)) P(`npc ${n.id} appearsIn 需为数组`);
    else for (const sc of n.appearsIn) if (!byId.has(sc)) P(`npc ${n.id} appearsIn 含未知场景 ${sc}`);
  }

  // 逐场景关系
  let chatCount = 0;
  for (const sc of s.scenes) {
    const here = `scene ${sc.id}`;
    const hasChoices = isArr(sc.choices) && sc.choices.length > 0;
    if (hasChoices) {
      if (sc.type !== 'choice' && sc.type !== 'chat') P(`${here} 只有 choice/chat 场景可以带 choices`);
      if (sc.choices.length > 4) P(`${here} choices 最多 4 个`);
      for (const c of sc.choices) {
        if (!isObj(c)) { P(`${here} 的 choice 需为对象`); continue; }
        pushIf(!nonEmptyStr(c.text), P, `${here} choice 缺少 text`);
        pushIf(!nonEmptyStr(c.next) || !byId.has(c.next), P, `${here} choice.next 非法：${c.next}`);
        pushIf(!isObj(c.set), P, `${here} choice.set 需为对象`);
        for (const k of Object.keys(c.set || {})) {
          if (!varNames.has(k)) {
            const near = [...varNames].find((v) => levenshteinDist(v, k) === 1);
            P(`${here} choice.set 使用了未声明变量 ${k}${near ? `（疑似拼写错误，应为 ${near}）` : ''}`);
          }
          const v = c.set[k];
          if (!['string', 'number', 'boolean'].includes(typeof v)) P(`${here} choice.set.${k} 值需为 string/number/boolean`);
        }
        if (c.requires != null) {
          if (!isObj(c.requires)) P(`${here} choice.requires 需为对象`);
          else for (const [k, v] of Object.entries(c.requires)) {
            if (!varNames.has(k)) P(`${here} choice.requires 使用了未声明变量 ${k}`);
            if (!['string', 'number', 'boolean'].includes(typeof v)) P(`${here} choice.requires.${k} 值需为 string/number/boolean`);
          }
        }
        if (c.lockedHint != null && (!isStr(c.lockedHint) || c.lockedHint.length > 40)) {
          P(`${here} choice.lockedHint 需为 ≤40 字符字符串`);
        }
      }
    } else if (sc.type === 'choice') {
      P(`${here} choice 场景必须提供 choices`);
    } else if (sc.type !== 'ending') {
      const out = sc.next || sc.goto;
      if (!nonEmptyStr(out) || !byId.has(out)) P(`${here} 缺少指向存在的 next/goto`);
    }
    if (sc.type === 'chat') {
      chatCount += 1;
      pushIf(!nonEmptyStr(sc.npc) || !npcIds.has(sc.npc), P, `${here} chat 场景缺少合法 npc`);
      pushIf(!nonEmptyStr(sc.goal), P, `${here} chat 场景缺少 goal（玩家此行要达成的目标）`);
    }
  }
  if (chatCount < 1 || chatCount > 3) P(`chat 场景数量需在 1–3（得到 ${chatCount}）`);
  if (ctx.loreIds) {
    const avail = new Set(ctx.loreIds);
    for (const sc of s.scenes) {
      const seen = new Set();
      for (const lid of sc.lore || []) {
        if (!avail.has(lid)) P(`scene ${sc.id} 引用了未知 lore：${lid}`);
        if (seen.has(lid)) P(`scene ${sc.id} lore 重复：${lid}`);
        seen.add(lid);
      }
    }
  }
  if (p.length) return p;

  // 图完整性（start 为首个 novel 场景；若 LLM 结构不是从 novel 开始则仍以 scenes[0] 为 start）
  const g = graphProblems(s.scenes, { startId: s.scenes[0].id });
  for (const x of g) p.push(x.msg);
  // 条件门可满足性（requires 的变量必须能在上游获得）
  for (const x of gateProblems(s.scenes)) p.push(`${x.path}：${x.msg}`);
  return p;
}

function levenshteinDist(a, b) {
  // 轻量编辑距离，仅用于拼写纠错提示
  const m = String(a).length;
  const n = String(b).length;
  if (Math.abs(m - n) > 1) return 9;
  const dp = Array.from({ length: m + 1 }, (_, i) => [i]);
  for (let j = 1; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
  }
  return dp[m][n];
}

// ---------------- game.json（compile 产物 / 最终契约） ----------------
const contract = {
  'story.id': (v) => nonEmptyStr(v),
  'story.title': (v) => nonEmptyStr(v),
  'story.author': (v) => isStr(v),
  'story.tags': (v) => isArr(v) && v.every(nonEmptyStr),
  start: (v) => nonEmptyStr(v),
  scenes: (v) => isArr(v) && v.length > 0,
  npcs: (v) => isArr(v),
  lore: (v) => isArr(v),
  endings: (v) => isArr(v) && v.length >= 3,
  'kanshan.intro': (v) => nonEmptyStr(v),
  'kanshan.rescueLines': (v) => isArr(v) && v.length >= 3 && v.every(nonEmptyStr),
};

export function checkGameContract(game) {
  const problems = [];
  const warn = [];
  const P = (code, path, msg) => problems.push({ code, path, msg });
  const W = (path, msg) => warn.push({ path, msg });
  if (!isObj(game)) return { ok: false, problems: [{ code: 'bad-root', path: '', msg: '根节点不是对象' }], warnings: warn };
  for (const [path, fn] of Object.entries(contract)) {
    const v = path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), game);
    if (!fn(v)) P('field', path, `字段 ${path} 缺失或不符合契约`);
  }
  if (problems.length) return { ok: false, problems, warnings: warn };

  // scenes
  const byId = new Map();
  for (const [i, sc] of game.scenes.entries()) {
    const path = `scenes[${i}]`;
    if (!isObj(sc)) { P('badtype', path, '场景需为对象'); continue; }
    if (!nonEmptyStr(sc.id)) P('field', path, '缺少 id');
    else if (byId.has(sc.id)) P('dup-id', `scenes.${sc.id}`, `场景 id 重复：${sc.id}`);
    byId.set(sc.id, sc);
    if (!TYPES.includes(sc.type)) P('field', `scenes.${sc.id}`, `type 非法：${sc.type}（合法：${TYPES.join('/')}）`);
    if (!isStr(sc.chapter)) P('field', `scenes.${sc.id}`, 'chapter 需为字符串');
    if (!isStr(sc.image)) P('field', `scenes.${sc.id}`, 'image 需为字符串');
    if (!nonEmptyStr(sc.text)) P('field', `scenes.${sc.id}`, 'text 不能为空（叙事文本）');
    if (sc.type === 'chat') {
      if (!nonEmptyStr(sc.npc)) P('field', `scenes.${sc.id}`, 'chat 场景缺少 npc');
      if (!nonEmptyStr(sc.goal)) P('field', `scenes.${sc.id}`, 'chat 场景缺少 goal');
    }
    if (isArr(sc.lore)) {
      for (const lid of sc.lore) if (!nonEmptyStr(lid)) P('field', `scenes.${sc.id}.lore`, 'lore 含空 id');
    } else if (sc.lore !== undefined) P('badtype', `scenes.${sc.id}.lore`, 'lore 需为数组');
    if (isArr(sc.choices)) {
      const seenC = new Set();
      for (const [j, c] of sc.choices.entries()) {
        const cp = `scenes.${sc.id}.choices[${j}]`;
        if (!isObj(c)) { P('badtype', cp, 'choice 需为对象'); continue; }
        if (!nonEmptyStr(c.id)) P('field', cp, 'choice 缺少 id');
        else if (seenC.has(c.id)) P('dup-id', cp, `choice id 重复：${c.id}`);
        seenC.add(c.id);
        if (!nonEmptyStr(c.text)) P('field', cp, 'choice 缺少 text');
        if (!nonEmptyStr(c.next)) P('field', cp, 'choice 缺少 next');
        if (c.set != null) {
          if (!isObj(c.set)) P('badtype', cp, 'set 需为对象');
          else for (const k of Object.keys(c.set)) {
            if (!VAR_RE.test(k)) P('var-name', cp, `set 变量名非法：${k}`);
          }
        }
        if (c.requires != null) {
          if (!isObj(c.requires)) P('badtype', cp, 'requires 需为对象');
          else for (const [k, v] of Object.entries(c.requires)) {
            if (!VAR_RE.test(k)) P('var-name', cp, `requires 变量名非法：${k}`);
            if (!['string', 'number', 'boolean'].includes(typeof v)) P('badtype', cp, `requires.${k} 值需为 string/number/boolean`);
          }
        }
        if (c.lockedHint != null && !isStr(c.lockedHint)) P('badtype', cp, 'lockedHint 需为字符串');
      }
      if (sc.type === 'novel') P('field', `scenes.${sc.id}`, 'novel 场景不应带 choices（抉择请用 choice/chat 场景）');
    } else if (sc.type === 'choice') P('field', `scenes.${sc.id}`, 'choice 场景缺少 choices');
  }

  // npcs / lore / endings
  const npcIds = new Set();
  for (const [i, n] of (game.npcs || []).entries()) {
    const path = `npcs[${i}]`;
    if (!isObj(n)) { P('badtype', path, 'npc 需为对象'); continue; }
    if (!nonEmptyStr(n.id)) P('field', path, 'npc 缺少 id');
    else if (npcIds.has(n.id)) P('dup-id', path, `npc id 重复：${n.id}`);
    npcIds.add(n.id);
    if (!nonEmptyStr(n.name)) P('field', path, `npc ${n.id || '?'} 缺少 name`);
    for (const k of ['description', 'personality', 'scenario', 'first_mes', 'mes_example', 'system_prompt']) {
      if (!isStr(n.card?.[k])) P('field', path, `npc ${n.id || '?'} card.${k} 需为字符串`);
    }
  }
  const loreIds = new Set();
  for (const [i, l] of (game.lore || []).entries()) {
    if (!isObj(l)) { P('badtype', `lore[${i}]`, 'lore 需为对象'); continue; }
    if (!nonEmptyStr(l.id)) P('field', `lore[${i}]`, 'lore 缺少 id');
    else if (loreIds.has(l.id)) P('dup-id', `lore.${l.id}`, `lore id 重复：${l.id}`);
    loreIds.add(l.id);
    if (!nonEmptyStr(l.content)) P('field', `lore.${l.id || i}`, 'lore 缺少 content');
  }
  const endIds = new Set();
  for (const [i, e] of (game.endings || []).entries()) {
    if (!isObj(e)) { P('badtype', `endings[${i}]`, 'endings 需为对象'); continue; }
    for (const k of ['id', 'title', 'tone']) if (!nonEmptyStr(e[k])) P('field', `endings[${i}]`, `endings 缺少 ${k}`);
    if (e.id && endIds.has(e.id)) P('dup-id', `endings.${e.id}`, `endings id 重复：${e.id}`);
    endIds.add(e.id);
  }
  // clues（线索簿元数据，可选）
  if (game.clues !== undefined) {
    if (!isArr(game.clues)) P('badtype', 'clues', 'clues 需为数组');
    else {
      const clueIds = new Set();
      for (const [i, cl] of game.clues.entries()) {
        const path = `clues[${i}]`;
        if (!isObj(cl)) { P('badtype', path, 'clue 需为对象'); continue; }
        if (!nonEmptyStr(cl.id) || !VAR_RE.test(cl.id)) P('field', path, `clue id 非法：${cl.id || '(空)'}`);
        else if (clueIds.has(cl.id)) P('dup-id', path, `clue id 重复：${cl.id}`);
        clueIds.add(cl.id);
        if (!nonEmptyStr(cl.name)) P('field', path, `clue ${cl.id || '?'} 缺少 name`);
        if (cl.desc != null && !isStr(cl.desc)) P('badtype', path, 'clue.desc 需为字符串');
      }
    }
  }
  if (!problems.length) {
    // 引用一致性 & ending 双向映射
    for (const sc of game.scenes) {
      if (sc.type === 'chat' && sc.npc && !npcIds.has(sc.npc)) P('ref-missing', `scenes.${sc.id}`, `chat npc ${sc.npc} 不存在于 npcs[]`);
      if (sc.type === 'ending' && !endIds.has(sc.id)) P('ref-missing', `scenes.${sc.id}`, `ending 场景未登记到 endings[]`);
      for (const lid of sc.lore || []) if (!loreIds.has(lid)) P('ref-missing', `scenes.${sc.id}`, `lore ${lid} 不存在`);
    }
    const endingScenes = game.scenes.filter((s) => s.type === 'ending');
    for (const e of game.endings || []) {
      if (!endingScenes.some((s) => s.id === e.id)) P('ref-missing', `endings.${e.id}`, `endings 条目 ${e.id} 没有对应 ending 场景`);
    }
  }

  // 图
  if (!problems.length) {
    for (const g of graphProblems(game.scenes, { startId: game.start })) problems.push(g);
    for (const g of gateProblems(game.scenes)) problems.push({ code: 'gate-unsatisfiable', path: g.path, msg: g.msg });
    // set 变量拼写一致性（跨场景收集后做编辑距离扫描）
    const seen = new Map();
    for (const sc of game.scenes) {
      for (const c of sc.choices || []) {
        for (const k of Object.keys(c.set || {})) {
          for (const [prev, where] of seen) {
            if (prev !== k && lev(prev, k) === 1) {
              P('var-typo', `scenes.${sc.id}`, `set 变量 ${k} 与 ${prev}（${where}）疑似拼写不一致`);
            }
          }
          seen.set(k, `scenes.${sc.id}`);
        }
      }
    }
  }
  if (!problems.length) {
    const scale = checkScale(game);
    warn.push(...scale);
  }
  return { ok: problems.length === 0, problems, warnings: warn };
}

function lev(a, b) {
  return levenshteinDist(a, b);
}

function checkScale(game) {
  const w = [];
  const n = game.scenes.length;
  if (n < 8 || n > 14) w.push({ path: 'scenes', msg: `规模目标 8–14 场景，实际 ${n}（软性提示）` });
  if (game.npcs.length < 2 || game.npcs.length > 4) w.push({ path: 'npcs', msg: `规模目标 2–4 NPC，实际 ${game.npcs.length}（软性提示）` });
  const chats = game.scenes.filter((s) => s.type === 'chat').length;
  if (chats < 1 || chats > 3) w.push({ path: 'scenes', msg: `规模目标 1–3 个 chat 场景，实际 ${chats}（软性提示）` });
  const ends = game.scenes.filter((s) => s.type === 'ending').length;
  if (ends < 3 || ends > 5) w.push({ path: 'scenes', msg: `规模目标 3–5 结局，实际 ${ends}（软性提示）` });
  return w;
}

export function describeGameProblems(problems) {
  return problems.map((x) => `${x.code} @ ${x.path || '(root)'}：${x.msg}`).slice(0, 20);
}

// lore 可用 id（analysis → 可挂载 lore 的派生清单），design 与 compile 共用
export function deriveLoreIds(analysis) {
  return [
    ...(analysis.worldRules || []).map((r) => `rule-${r.id}`),
    ...(analysis.foreshadowing || []).map((f) => `hook-${f.id}`),
  ];
}
