/**
 * 看山工作室 · Studio — session-daemon served UI (M6a/M6c).
 *
 * Plain JS, no build step, no CDN. The session token is injected into
 * index.html by the daemon and read here from the meta tag only — never from
 * the URL or browser storage. All dynamic text is written with textContent;
 * there is no innerHTML anywhere in this file.
 *
 * Panes:
 *  - scene tree + read-only inspector (runtime objects are facts; only author
 *    params are writable, and only through versioned author patch commands)
 *  - author parameters panel (list / patch / undo / redo) with a numeric
 *    transform editor ("gizmo") for params declared with kind
 *    'transform' | 'vector3' in describeParameters() extras
 *  - session control bar (pause / resume / step(N) / metrics)
 */

const tokenMeta = document.querySelector('meta[name="kanshan-studio-token"]');
const TOKEN = tokenMeta ? tokenMeta.content : '';

const $ = (id) => document.getElementById(id);

const READONLY_LABEL = '只读（未绑定到作者工程）';

// ---------------------------------------------------------------------------
// transport
// ---------------------------------------------------------------------------

function showDiagnostics(entries) {
  const list = $('diagnostics-list');
  while (list.firstChild) list.removeChild(list.firstChild);
  for (const entry of entries) {
    const li = document.createElement('li');
    li.textContent = `[${entry.code ?? 'ERROR'}] ${entry.message ?? String(entry)}`;
    list.appendChild(li);
  }
  $('diagnostics').hidden = entries.length === 0;
}

function reportError(prefix, err) {
  const code = err && err.code ? err.code : 'ERROR';
  const message = err && err.message ? err.message : String(err);
  showDiagnostics([{ code, message: `${prefix}：${message}` }]);
}

/** Author tool call — every studio author response is a ToolEnvelope. */
async function authorApi(action, payload) {
  const res = await fetch(`/studio/api/author/${action}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${TOKEN}`,
    },
    body: JSON.stringify(payload ?? {}),
  });
  const env = await res.json();
  if (!env || typeof env !== 'object') {
    throw Object.assign(new Error('作者接口返回了非信封数据'), { code: 'BAD_ENVELOPE' });
  }
  return env;
}

/** Session RPC (query scene / pause / resume / step / observe). */
async function sessionRpc(op, params) {
  const res = await fetch('/rpc', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${TOKEN}`,
    },
    body: JSON.stringify({ op, params: params ?? {} }),
  });
  const env = await res.json();
  if (!env || typeof env !== 'object') {
    throw Object.assign(new Error('会话接口返回了非信封数据'), { code: 'BAD_ENVELOPE' });
  }
  return env;
}

/** Run an envelope-returning call; surface failures as diagnostics. */
async function guarded(label, fn) {
  try {
    const env = await fn();
    if (env.ok !== true) {
      const diag = env.diagnostics && env.diagnostics[0] ? env.diagnostics[0] : { code: 'ERROR', message: '未知错误' };
      showDiagnostics([{ code: diag.code, message: `${label}失败：${diag.message}` }]);
      return null;
    }
    showDiagnostics([]);
    return env.data;
  } catch (err) {
    reportError(label, err);
    return null;
  }
}

// ---------------------------------------------------------------------------
// small DOM helpers (textContent only)
// ---------------------------------------------------------------------------

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function formatVec(v) {
  if (!Array.isArray(v)) return String(v);
  return v.map((n) => (typeof n === 'number' ? n.toFixed(3) : String(n))).join(', ');
}

function isVec3Object(value) {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    ['x', 'y', 'z'].every((k) => Number.isFinite(value[k]))
  );
}

function isVec3Array(value) {
  return Array.isArray(value) && value.length === 3 && value.every((n) => Number.isFinite(n));
}

function isVec3(value) {
  return isVec3Object(value) || isVec3Array(value);
}

// ---------------------------------------------------------------------------
// state
// ---------------------------------------------------------------------------

const state = {
  sceneObjects: [],       // bounded snapshots from query scene
  selectedHandle: null,   // selected scene node handle
  params: [],           // author list params (enriched with kind)
  head: null,           // author history head from the last list response
  snapStep: 0.5,        // gizmo snap step
  commandCounter: 0,
};

function nextCommandId() {
  state.commandCounter += 1;
  return `studio-${Date.now().toString(36)}-${state.commandCounter}`;
}

// ---------------------------------------------------------------------------
// (c) session control bar
// ---------------------------------------------------------------------------

async function refreshStatus() {
  const data = await guarded('查询会话状态', () => sessionRpc('status'));
  if (!data) return;
  $('session-status').textContent =
    `会话状态：${data.status} · 模式 ${data.mode} · 刻 ${data.tick} · ${Number(data.time).toFixed(2)}s`;
}

async function doPause() {
  await guarded('暂停', () => sessionRpc('pause'));
  await refreshStatus();
}

async function doResume() {
  await guarded('继续', () => sessionRpc('resume'));
  await refreshStatus();
}

async function doStep() {
  const raw = Number($('step-count').value);
  const steps = Number.isInteger(raw) && raw >= 1 ? Math.min(raw, 100000) : 1;
  await guarded('步进', () => sessionRpc('step', { steps }));
  await refreshStatus();
  await loadScene();
}

async function toggleMetrics() {
  const pane = $('metrics-pane');
  if (!pane.hidden) {
    pane.hidden = true;
    return;
  }
  const data = await guarded('查询指标', () => sessionRpc('observe', { kind: 'metrics' }));
  if (!data) return;
  const view = $('metrics-view');
  view.textContent = JSON.stringify(data, null, 2);
  pane.hidden = false;
}

// ---------------------------------------------------------------------------
// (a) scene tree + read-only inspector
// ---------------------------------------------------------------------------

function findObject(handle) {
  return state.sceneObjects.find((o) => o.handle === handle) ?? null;
}

function declaredParamIds() {
  return new Set(state.params.map((p) => p.authorId));
}

async function loadScene() {
  const data = await guarded('查询场景', () => sessionRpc('query', { kind: 'scene', limit: 200 }));
  if (!data) return;
  // query 信封的 data 是 { handle, status, tick, data, truncated }；场景数组在 data.data。
  state.sceneObjects = Array.isArray(data.data) ? data.data : [];
  if (state.selectedHandle && !findObject(state.selectedHandle)) {
    state.selectedHandle = null;
  }
  renderSceneTree();
  renderInspector();
}

function renderSceneTree() {
  const tree = $('scene-tree');
  while (tree.firstChild) tree.removeChild(tree.firstChild);
  if (state.sceneObjects.length === 0) {
    tree.appendChild(el('p', 'muted', '（场景为空或尚未加载）'));
    return;
  }
  const byParent = new Map();
  for (const obj of state.sceneObjects) {
    const key = obj.parent ?? '';
    if (!byParent.has(key)) byParent.set(key, []);
    byParent.get(key).push(obj);
  }
  const bound = declaredParamIds();
  const walk = (parentKey, depth) => {
    const children = byParent.get(parentKey) ?? [];
    for (const obj of children) {
      const row = el('div', 'tree-row');
      row.style.paddingLeft = `${depth * 16}px`;
      const label = obj.name || obj.handle;
      const tag = bound.has(obj.authorId) ? ' ⚿' : '';
      row.appendChild(el('span', 'tree-name', `${label}${tag}`));
      row.appendChild(el('span', 'tree-type', obj.type));
      row.addEventListener('click', () => {
        state.selectedHandle = obj.handle;
        renderSceneTree();
        renderInspector();
      });
      if (obj.handle === state.selectedHandle) row.classList.add('selected');
      tree.appendChild(row);
      walk(obj.handle, depth + 1);
    }
  };
  walk('', 0);
}

function inspectorRow(label, value) {
  const row = el('div', 'inspector-row');
  row.appendChild(el('span', 'inspector-label', label));
  row.appendChild(el('span', 'inspector-value', value));
  return row;
}

async function refreshSelectedObject() {
  if (!state.selectedHandle) return;
  const data = await guarded('刷新节点', () =>
    sessionRpc('query', { kind: 'object', handle: state.selectedHandle }),
  );
  if (!data || !data.data) return;
  const snapshot = data.data;
  const index = state.sceneObjects.findIndex((o) => o.handle === state.selectedHandle);
  if (index >= 0) state.sceneObjects[index] = snapshot;
  renderInspector();
}

function renderInspector() {
  const box = $('inspector');
  while (box.firstChild) box.removeChild(box.firstChild);
  const obj = state.selectedHandle ? findObject(state.selectedHandle) : null;
  if (!obj) {
    box.appendChild(el('p', 'muted', '在场景树中选择一个节点。'));
    return;
  }
  box.appendChild(inspectorRow('名称', obj.name || '（未命名）'));
  box.appendChild(inspectorRow('类型', obj.type));
  box.appendChild(inspectorRow('位置', formatVec(obj.position)));
  box.appendChild(inspectorRow('旋转', formatVec(obj.rotation)));
  box.appendChild(inspectorRow('缩放', formatVec(obj.scale)));
  box.appendChild(inspectorRow('可见', obj.visible ? '是' : '否'));
  box.appendChild(inspectorRow('作者参数 ID', obj.authorId ?? '（无）'));
  box.appendChild(inspectorRow('userData 键', obj.userDataKeys && obj.userDataKeys.length > 0 ? obj.userDataKeys.join(', ') : '（无）'));

  const bound = declaredParamIds().has(obj.authorId);
  if (bound) {
    box.appendChild(el('p', 'bound-note', `已绑定作者参数：${obj.authorId}（在右侧参数面板中编辑）`));
  } else {
    box.appendChild(el('p', 'readonly-note', READONLY_LABEL));
  }
  const refresh = el('button', '', '刷新数值');
  refresh.type = 'button';
  refresh.addEventListener('click', refreshSelectedObject);
  box.appendChild(refresh);
}

// ---------------------------------------------------------------------------
// (b) author parameters panel + numeric transform editor (gizmo)
// ---------------------------------------------------------------------------

function snapValue(value) {
  const step = state.snapStep;
  const snapped = Math.round(value / step) * step;
  // Keep the display honest about the step granularity without float noise.
  const decimals = step >= 1 ? 0 : step >= 0.5 ? 1 : step >= 0.1 ? 1 : 3;
  return Number(snapped.toFixed(decimals));
}

/** Commit a param value through the SAME versioned author patch command used
 *  by every other edit path (gizmo included). */
async function commitParamValue(authorId, value) {
  const data = await guarded('作者补丁', () =>
    authorApi('patch', {
      set: { [authorId]: value },
      baseRevision: state.head,
      commandId: nextCommandId(),
    }),
  );
  if (data) await loadParams();
}

function paramHeader(param) {
  const head = el('div', 'param-head');
  head.appendChild(el('span', 'param-id', param.authorId));
  const badges = el('span', 'param-badges');
  badges.appendChild(el('span', 'badge', `v${param.schemaVersion}`));
  badges.appendChild(el('span', 'badge', param.declaredBy));
  if (param.overridden) badges.appendChild(el('span', 'badge badge-overridden', '已覆盖'));
  if (param.kind) badges.appendChild(el('span', 'badge badge-kind', `kind:${param.kind}`));
  head.appendChild(badges);
  return head;
}

/** Numeric transform editor — the R1 gizmo. Shown ONLY for declared params
 *  whose describeParameters() extras mark them kind 'transform' | 'vector3'. */
function gizmoEditor(param) {
  const wrap = el('div', 'gizmo');
  wrap.appendChild(el('div', 'gizmo-title', '变换编辑器（数值）'));
  const axisRow = el('div', 'gizmo-row');
  const inputs = [];
  for (const axis of ['x', 'y', 'z']) {
    const field = el('label', 'gizmo-field');
    field.appendChild(el('span', '', axis.toUpperCase()));
    const input = document.createElement('input');
    input.type = 'number';
    input.step = String(state.snapStep);
    input.value = String(param.currentValue[axis] ?? 0);
    field.appendChild(input);
    inputs.push(input);
    axisRow.appendChild(field);
  }
  wrap.appendChild(axisRow);

  const snapRow = el('div', 'gizmo-row');
  snapRow.appendChild(el('span', 'gizmo-label', '吸附步长'));
  const snap = document.createElement('select');
  for (const step of ['0.1', '0.5', '1']) {
    const opt = document.createElement('option');
    opt.value = step;
    opt.textContent = step;
    if (Number(step) === state.snapStep) opt.selected = true;
    snap.appendChild(opt);
  }
  snap.addEventListener('change', () => {
    state.snapStep = Number(snap.value);
    for (const input of inputs) input.step = snap.value;
  });
  snapRow.appendChild(snap);
  wrap.appendChild(snapRow);

  const apply = el('button', '', '应用变换');
  apply.type = 'button';
  apply.addEventListener('click', async () => {
    const asArray = Array.isArray(param.currentValue);
    const next = asArray ? [0, 1, 2].map((i) => snapValue(Number(inputs[i].value))) : {
      x: snapValue(Number(inputs[0].value)),
      y: snapValue(Number(inputs[1].value)),
      z: snapValue(Number(inputs[2].value)),
    };
    await commitParamValue(param.authorId, next);
  });
  wrap.appendChild(apply);
  return wrap;
}

function genericEditor(param) {
  const wrap = el('div', 'param-edit');
  const valueIsNumber = typeof param.currentValue === 'number';
  const input = document.createElement('input');
  input.type = valueIsNumber ? 'number' : 'text';
  if (valueIsNumber) input.step = 'any';
  input.value = valueIsNumber ? String(param.currentValue) : JSON.stringify(param.currentValue);
  wrap.appendChild(input);
  const apply = el('button', '', '应用');
  apply.type = 'button';
  apply.addEventListener('click', async () => {
    let value;
    if (valueIsNumber) {
      value = Number(input.value);
      if (!Number.isFinite(value)) {
        showDiagnostics([{ code: 'INVALID_VALUE', message: `参数 ${param.authorId} 需要数字` }]);
        return;
      }
    } else {
      try {
        value = JSON.parse(input.value);
      } catch (err) {
        showDiagnostics([{ code: 'INVALID_JSON', message: `参数 ${param.authorId} 的值不是合法 JSON：${err.message}` }]);
        return;
      }
    }
    await commitParamValue(param.authorId, value);
  });
  wrap.appendChild(apply);
  return wrap;
}

function renderParams() {
  const list = $('params-list');
  while (list.firstChild) list.removeChild(list.firstChild);
  if (state.params.length === 0) {
    list.appendChild(el('p', 'muted', '（本体验没有声明作者参数）'));
    return;
  }
  for (const param of state.params) {
    const card = el('div', 'param-card');
    card.appendChild(paramHeader(param));
    if (param.description) card.appendChild(el('p', 'param-desc', param.description));
    card.appendChild(inspectorRow('当前值', JSON.stringify(param.currentValue)));
    const kind = param.kind;
    if ((kind === 'transform' || kind === 'vector3') && isVec3(param.currentValue)) {
      card.appendChild(gizmoEditor(param));
    } else {
      card.appendChild(genericEditor(param));
    }
    list.appendChild(card);
  }
}

async function loadParams() {
  const data = await guarded('列出作者参数', () => authorApi('list'));
  if (!data) return;
  state.params = Array.isArray(data.params) ? data.params : [];
  state.head = typeof data.head === 'string' ? data.head : null;
  $('params-head').textContent = `head：${state.head ?? '（无历史）'}`;
  renderParams();
  renderSceneTree(); // re-evaluate bound tags
  renderInspector();
}

async function doUndo() {
  const data = await guarded('撤销', () => authorApi('undo', { commandId: nextCommandId() }));
  if (data) await loadParams();
}

async function doRedo() {
  const data = await guarded('重做', () => authorApi('redo', { commandId: nextCommandId() }));
  if (data) await loadParams();
}

// ---------------------------------------------------------------------------
// wiring + boot
// ---------------------------------------------------------------------------

function wire(id, fn) {
  $(id).addEventListener('click', fn);
}

wire('btn-pause', doPause);
wire('btn-resume', doResume);
wire('btn-step', doStep);
wire('btn-metrics', toggleMetrics);
wire('btn-refresh-scene', loadScene);
wire('btn-undo', doUndo);
wire('btn-redo', doRedo);
wire('btn-reload-params', loadParams);

if (!TOKEN) {
  showDiagnostics([{ code: 'NO_TOKEN', message: '页面中没有注入会话令牌，无法调用工作室接口。' }]);
} else {
  refreshStatus();
  loadScene();
  loadParams();
}
