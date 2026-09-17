#!/usr/bin/env node
/** Static server for the built portal (dist). Default page: portal.html.
 *  - Serves dist/ (with dist/arg = the ARG portal build, synced by sync-arg).
 *  - Proxies /api/* to the ARG gateway (default 127.0.0.1:8790) so the
 *    蓝血 iframe is fully functional same-origin.
 *  - Spawns the gateway as a child unless KANSHAN_ARG=0 or it is already up.
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(process.argv[2] ?? 'dist');
const port = Number(process.argv[3] ?? 8817);
const GAME_PS1 = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Keep dist/arg in sync with the ARG build (game/dist) when it exists.
spawnSync(process.execPath, [path.join(GAME_PS1, 'scripts', 'sync-arg.mjs')], { stdio: 'inherit' });
const GATEWAY_PORT = Number(process.env.CHAT_PORT || 8790);
const GATEWAY_URL = `http://127.0.0.1:${GATEWAY_PORT}`;
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.wasm': 'application/wasm',
};

async function gatewayUp() {
  try {
    const res = await fetch(`${GATEWAY_URL}/api/stories`, { signal: AbortSignal.timeout(1500) });
    return res.ok;
  } catch {
    return false;
  }
}

let gatewayChild = null;
if (process.env.KANSHAN_ARG !== '0') {
  if (await gatewayUp()) {
    console.log(`[portal] ARG gateway already running at ${GATEWAY_URL}`);
  } else {
    gatewayChild = spawn(process.execPath, [path.join(GAME_PS1, '..', 'game', 'server', 'gateway.mjs')], {
      env: { ...process.env, CHAT_PORT: String(GATEWAY_PORT) },
      stdio: ['ignore', 'inherit', 'inherit'],
    });
    gatewayChild.on('exit', (code) => {
      console.warn(`[portal] ARG gateway exited (code ${code}) — the 蓝血门 needs it. Set KANSHAN_ARG=0 to disable.`);
      gatewayChild = null;
    });
    console.log(`[portal] spawned ARG gateway at ${GATEWAY_URL}`);
  }
}

const server = http.createServer((req, res) => {
  const url = (req.url ?? '/').split('?')[0];
  // ---- /api proxy to the ARG gateway (same-origin trick for the iframe) ----
  if (url.startsWith('/api/')) {
    const target = `${GATEWAY_URL}${req.url}`;
    const proxy = http.request(target, { method: req.method, headers: { ...req.headers, host: `127.0.0.1:${GATEWAY_PORT}` } }, (up) => {
      res.writeHead(up.statusCode ?? 502, up.headers);
      up.pipe(res);
    });
    proxy.on('error', () => {
      res.writeHead(502, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: false, error: 'ARG gateway unreachable (start game/server/gateway.mjs)' }));
    });
    req.pipe(proxy);
    return;
  }
  // ---- static --------------------------------------------------------------
  const rel = url === '/' ? 'portal.html' : decodeURIComponent(url).replace(/^\/+/, '');
  let file = path.join(root, rel);
  if (!fs.existsSync(file) && !path.extname(rel)) {
    const asHtml = path.join(root, `${rel}.html`);
    if (fs.existsSync(asHtml)) file = asHtml;
  }
  // Directory (e.g. /arg/) serves its index.html — the ARG SPA lives in a subdir.
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) {
    const index = path.join(file, 'index.html');
    if (fs.existsSync(index)) file = index;
  }
  // The ARG story data references /art/* and /sources/* as site-root paths;
  // they actually live under dist/arg/ — fall back there before 404.
  if ((!fs.existsSync(file) || !fs.statSync(file).isFile()) && /^\/(art|sources)\//.test(url)) {
    const underArg = path.join(root, 'arg', rel);
    if (fs.existsSync(underArg) && fs.statSync(underArg).isFile()) file = underArg;
  }
  if (!file.startsWith(root) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('404');
    return;
  }
  res.writeHead(200, { 'content-type': MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});

server.listen(port, () => {
  console.log(`portal: http://localhost:${port}/ (serving ${root}${fs.existsSync(path.join(root, 'arg')) ? ' + /arg' : ''}, /api -> ${GATEWAY_URL})`);
});

function shutdown() {
  if (gatewayChild) gatewayChild.kill('SIGTERM');
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
