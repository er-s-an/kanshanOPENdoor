import http from 'node:http';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { StudioServices } from './services.mjs';
import { MAX_JSON_BYTES, assert, failure, sessionToken, StudioError } from './util.mjs';

const PLAYER_DIST = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../game-ps1/dist');

export function createStudioServer({ services = new StudioServices(), host = '127.0.0.1', port = 0, token = sessionToken() } = {}) {
  const server = http.createServer((req, res) => handleRequest({ req, res, services, token, host }).catch((error) => sendError(res, error)));
  return { server, services, token, host, port };
}

export async function startStudioServer(options = {}) {
  const app = createStudioServer(options);
  await new Promise((resolve, reject) => { app.server.once('error', reject); app.server.listen(app.port, app.host, resolve); });
  const address = app.server.address(); app.port = typeof address === 'object' ? address.port : app.port;
  app.baseUrl = `http://${app.host}:${app.port}`;
  return app;
}

async function handleRequest({ req, res, services, token, host }) {
  const url = new URL(req.url || '/', `http://${req.headers.host || `${host}:80`}`);
  const bootstrapAsset = req.method === 'GET' && ['/', '/index.html', '/app.mjs', '/studio.css'].includes(url.pathname);
  // The read-only preview player is deliberately token-free so a new tab/iframe
  // does not receive the author session. Local Host/Origin checks still apply.
  enforceLocalAccess(req, token, host, { allowBootstrap: bootstrapAsset || url.pathname.startsWith('/preview/') });
  if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) return serveStudioApp({ res, token });
  if (bootstrapAsset) return serveStudioAsset({ res, pathname: url.pathname });
  if (url.pathname.startsWith('/preview/')) return servePreview({ req, res, services, url });
  assert(url.pathname.startsWith('/api/v1'), 'NOT_FOUND', 'route not found', undefined, 404);
  if (req.method === 'OPTIONS') { res.writeHead(204, { 'access-control-allow-origin': originFor(req), 'access-control-allow-headers': 'content-type,x-story-studio-token,idempotency-key', 'access-control-allow-methods': 'GET,POST,OPTIONS', vary: 'Origin' }); return res.end(); }
  const route = url.pathname.slice('/api/v1'.length).split('/').filter(Boolean);
  const body = ['POST', 'PUT', 'PATCH'].includes(req.method) ? await readJsonBody(req) : {};
  let output;
  if (req.method === 'GET' && route.length === 1 && route[0] === 'capabilities') output = services.capabilities();
  else if (req.method === 'POST' && route.length === 1 && route[0] === 'projects') output = await services.createProject({ sourceText: body.sourceText, metadata: body, idempotencyKey: req.headers['idempotency-key'] || body.idempotencyKey });
  else if (route[0] === 'projects' && route.length === 2 && req.method === 'GET') output = await services.getProject(route[1]);
  else if (route[0] === 'projects' && route[2] === 'revisions' && route.length === 4 && req.method === 'GET') output = await services.getRevision(route[1], route[3]);
  else if (route[0] === 'projects' && route[2] === 'revisions' && route.length === 5 && route[4] === 'preview' && req.method === 'GET') output = await services.preview({ projectId: route[1], revisionId: route[3], baseUrl: `${url.protocol}//${req.headers.host}` });
  else if (route[0] === 'projects' && route[2] === 'revisions' && route.length === 3 && req.method === 'POST') output = await services.importRevision({ projectId: route[1], baseRevisionId: body.baseRevisionId, analysis: body.analysis, blueprint: body.blueprint, idempotencyKey: req.headers['idempotency-key'] || body.idempotencyKey });
  else if (route[0] === 'projects' && route[2] === 'jobs' && route.length === 3 && req.method === 'POST') output = await services.createJob({ ...body, projectId: route[1], idempotencyKey: req.headers['idempotency-key'] || body.idempotencyKey });
  else if (route[0] === 'projects' && route[2] === 'exports' && route.length === 3 && req.method === 'POST') output = await services.createJob({ projectId: route[1], revisionId: body.revisionId, operation: 'export', audience: body.audience, idempotencyKey: req.headers['idempotency-key'] || body.idempotencyKey });
  else if (route[0] === 'projects' && route[2] === 'reviews' && route.length === 3 && req.method === 'POST') output = await services.recordReview({ projectId: route[1], ...body, idempotencyKey: req.headers['idempotency-key'] || body.idempotencyKey });
  else if (route[0] === 'jobs' && route.length === 2 && req.method === 'GET') output = await services.getJob(route[1]);
  else if (route[0] === 'jobs' && route.length === 3 && route[2] === 'cancel' && req.method === 'POST') output = await services.cancelJob(route[1]);
  else throw new StudioError('NOT_FOUND', 'route not found', undefined, 404);
  sendJson(res, output, output?.ok ? 200 : 400, req);
}

function enforceLocalAccess(req, token, host, { allowBootstrap = false } = {}) {
  const requestedHost = String(req.headers.host || '').split(':')[0].replace(/\[|\]/g, '');
  assert(['127.0.0.1', 'localhost', '::1'].includes(requestedHost), 'LOCAL_ACCESS_DENIED', 'host is not local', undefined, 403);
  if (!allowBootstrap) assert(req.headers['x-story-studio-token'] === token, 'LOCAL_ACCESS_DENIED', 'missing or invalid local session token', undefined, 401);
  if (req.headers.origin) {
    const origin = new URL(req.headers.origin);
    assert(['127.0.0.1', 'localhost', '[::1]', '::1'].includes(origin.hostname), 'LOCAL_ACCESS_DENIED', 'origin is not local', undefined, 403);
    assert(origin.host === req.headers.host, 'LOCAL_ACCESS_DENIED', 'origin/host mismatch', undefined, 403);
  }
}

async function serveStudioApp({ res, token }) {
  const file = new URL('./web/index.html', import.meta.url);
  let html = await readFile(file, 'utf8');
  html = html.replaceAll('__STUDIO_TOKEN__', escapeHtml(token));
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }); res.end(html);
}

async function serveStudioAsset({ res, pathname }) {
  const assets = { '/app.mjs': ['app.mjs', 'text/javascript; charset=utf-8'], '/studio.css': ['studio.css', 'text/css; charset=utf-8'] };
  const [name, contentType] = assets[pathname] || [];
  assert(name, 'NOT_FOUND', 'static asset not found', undefined, 404);
  const content = await readFile(new URL(`./web/${name}`, import.meta.url));
  res.writeHead(200, { 'content-type': contentType, 'cache-control': 'no-store' }); res.end(content);
}

function originFor(req) { return req.headers.origin || `http://${req.headers.host}`; }

async function readJsonBody(req) {
  let size = 0; const chunks = [];
  for await (const chunk of req) { size += chunk.length; if (size > MAX_JSON_BYTES) throw new StudioError('TOO_LARGE', 'request body exceeds 2 MiB', undefined, 413); chunks.push(chunk); }
  if (!size) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new StudioError('BAD_INPUT', 'request body must be valid JSON', undefined, 400); }
}

async function servePreview({ res, services, url }) {
  const parts = url.pathname.split('/').filter(Boolean); assert(parts.length >= 3, 'NOT_FOUND', 'preview route not found', undefined, 404);
  const projectId = decodeURIComponent(parts[1]); const revisionId = decodeURIComponent(parts[2]);
  const revision = await services.store.getRevision(projectId, revisionId); assert(revision.package && revision.build?.status === 'built', 'BAD_INPUT', 'preview requires a built revision');
  if (parts.length > 3) {
    const relative = parts.slice(3).join('/');
    assert(!relative.includes('..') && !relative.startsWith('/'), 'NOT_FOUND', 'preview asset not found', undefined, 404);
    if (relative === 'story-packages/bookstall-opening.json') {
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
      return res.end(JSON.stringify(revision.package));
    }
    assert(relative.startsWith('assets/'), 'NOT_FOUND', 'preview asset not found', undefined, 404);
    const asset = path.join(PLAYER_DIST, relative);
    assert(await import('./util.mjs').then(({ exists }) => exists(asset)), 'NOT_FOUND', 'preview asset not found', undefined, 404);
    const contentType = relative.endsWith('.css') ? 'text/css; charset=utf-8' : relative.endsWith('.js') ? 'text/javascript; charset=utf-8' : 'application/octet-stream';
    res.writeHead(200, { 'content-type': contentType, 'cache-control': 'no-store' });
    return res.end(await readFile(asset));
  }
  const title = escapeHtml(revision.package.title); const manifest = { projectId, revisionId, packageDigest: revision.build.packageDigest };
  const playerFile = path.join(PLAYER_DIST, 'player.html');
  const htmlSource = await import('./util.mjs').then(async ({ exists }) => exists(playerFile)
    ? await readFile(playerFile, 'utf8')
    : `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${title}</title><body><main><h1>${title}</h1><p>Preview revision <code>${escapeHtml(revisionId)}</code></p><p>PS1 Player bundle is not built in this environment; StoryPackage 已锁定并可供 runtime 加载。</p></main><script type="application/json" id="manifest">${JSON.stringify(manifest)}</script><script type="application/json" id="story-package">${JSON.stringify(revision.package)}</script></body></html>`);
  const html = htmlSource.includes('<head>')
    ? htmlSource.replace('<head>', `<head><base href="/preview/${encodeURIComponent(projectId)}/${encodeURIComponent(revisionId)}/">`)
    : htmlSource;
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }); res.end(html);
}

function sendJson(res, payload, status = 200, req = undefined) { const headers = { 'content-type': 'application/json; charset=utf-8', vary: 'Origin', 'cache-control': 'no-store' }; if (req) headers['access-control-allow-origin'] = originFor(req); res.writeHead(status, headers); res.end(JSON.stringify(payload)); }
function sendError(res, error) { const known = error instanceof StudioError; const payload = failure(error); const status = known && error.status ? error.status : ({ BAD_INPUT: 400, NOT_FOUND: 404, LOCAL_ACCESS_DENIED: 403, REVISION_CONFLICT: 409, IDEMPOTENCY_CONFLICT: 409, TOO_LARGE: 413, CONTENT_INVALID: 422, CAPABILITY_GAP: 422, NEEDS_REVIEW: 422, BUDGET_EXCEEDED: 429, PROVIDER_UNAVAILABLE: 503 }[error?.code] || 500); sendJson(res, payload, status); }
function escapeHtml(value) { return String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;'); }
