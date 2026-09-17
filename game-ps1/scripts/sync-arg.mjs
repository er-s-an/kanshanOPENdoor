#!/usr/bin/env node
/**
 * Sync the ARG portal build (game/dist) into the portal bundle as dist/arg/,
 * so the hall's 蓝血门 can iframe it SAME-ORIGIN (localStorage saves and the
 * future postMessage protocol work; /api is proxied by portal-serve).
 * Tolerant: warns instead of failing when game/dist has not been built.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const GAME_PS1 = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.resolve(GAME_PS1, '..', 'game', 'dist');
const DST = path.join(GAME_PS1, 'dist', 'arg');

if (!fs.existsSync(path.join(SRC, 'index.html'))) {
  console.warn(`[sync-arg] ${SRC} not built — skipping (the 蓝血门 will not work until game/ is built).`);
  process.exit(0);
}
// Pollution guard: assemble-root promotes the ps1 build INTO game/dist, so
// after an assemble the root contains portal.html / myopia-3d/ / arg/ and an
// index.html that is the HALL. Copying that into dist/arg would serve the
// hall inside the hall (the "enter 蓝血 bounces back to 门厅" bug). A clean
// React build (vite empties outDir) must not contain any of these.
const POLLUTION_MARKERS = ['portal.html', 'myopia-3d', 'stories.html', 'myopia.html'];
const polluted = POLLUTION_MARKERS.filter((m) => fs.existsSync(path.join(SRC, m)));
if (polluted.length > 0 || fs.existsSync(path.join(SRC, 'arg'))) {
  console.error(`[sync-arg] REFUSING to sync: ${SRC} looks like an ASSEMBLED root (found: ${polluted.join(', ') || 'arg/'}).`);
  console.error('[sync-arg] Its index.html is the hall, not the React app. Fix: rebuild the React app first —');
  console.error('             cd game && npm run build   (or the full chain: npm run build:experiences)');
  process.exit(1);
}
fs.rmSync(DST, { recursive: true, force: true });
fs.mkdirSync(DST, { recursive: true });
copy(SRC, DST);
const files = count(DST);
console.log(`[sync-arg] ${SRC} -> ${DST} (${files} files)`);

function copy(src, dst) {
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dst, entry.name);
    if (entry.isDirectory()) {
      fs.mkdirSync(d, { recursive: true });
      copy(s, d);
    } else {
      fs.copyFileSync(s, d);
    }
  }
}
function count(dir) {
  let n = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    n += entry.isDirectory() ? count(path.join(dir, entry.name)) : 1;
  }
  return n;
}
