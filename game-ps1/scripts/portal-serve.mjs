#!/usr/bin/env node
/** Static server for the built portal (dist). Default page: portal.html. */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(process.argv[2] ?? 'dist');
const port = Number(process.argv[3] ?? 8817);
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

http
  .createServer((req, res) => {
    const url = decodeURIComponent((req.url ?? '/').split('?')[0]);
    let rel = url === '/' ? 'portal.html' : url.replace(/^\/+/, '');
    let file = path.join(root, rel);
    // SPA-ish fallback: unknown paths without an extension try .html
    if (!fs.existsSync(file) && !path.extname(rel)) {
      const asHtml = path.join(root, `${rel}.html`);
      if (fs.existsSync(asHtml)) file = asHtml;
    }
    if (!file.startsWith(root) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('404');
      return;
    }
    res.writeHead(200, { 'content-type': MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  })
  .listen(port, () => {
    console.log(`portal: http://localhost:${port}/ (serving ${root})`);
  });
