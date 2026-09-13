// 共享小工具：路径、IO、参数解析、日志、字符串工具
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const PKG_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const OUT_ROOT = path.join(PKG_ROOT, 'out');
export const CACHE_ROOT = path.join(PKG_ROOT, '.cache');

export function jsonPath(storyId, file) {
  return path.join(OUT_ROOT, storyId, file);
}

export function readJson(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

export function writeJson(p, data) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const tmp = `${p}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
  fs.renameSync(tmp, p);
  return p;
}

export function sha1Hex(s) {
  return crypto.createHash('sha1').update(s).digest('hex');
}

export function cjkCount(s) {
  const m = String(s || '').match(/[\u4e00-\u9fff]/g);
  return m ? m.length : 0;
}

export function slugify(name) {
  const base = String(name || 'story')
    .replace(/\.txt$/i, '')
    .replace(/[^\u4e00-\u9fa5A-Za-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return base || 'story';
}

// 截取前 n 个“字符”，按 code point 计
export function clip(s, n) {
  const t = String(s || '');
  return t.length <= n ? t : `${[...t].slice(0, n).join('')}`;
}

export function levenshtein(a, b) {
  const x = String(a || '');
  const y = String(b || '');
  if (x === y) return 0;
  const dp = Array.from({ length: x.length + 1 }, (_, i) => [i, ...Array(y.length).fill(0)]);
  for (let j = 0; j <= y.length; j++) dp[0][j] = j;
  for (let i = 1; i <= x.length; i++) {
    for (let j = 1; j <= y.length; j++) {
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + (x[i - 1] === y[j - 1] ? 0 : 1),
      );
    }
  }
  return dp[x.length][y.length];
}

let quiet = false;
export function setQuiet(v) {
  quiet = v;
}
export function log(...args) {
  if (!quiet) console.log(...args);
}
export function warn(...args) {
  if (!quiet) console.warn('⚠', ...args);
}
export function err(...args) {
  console.error('✗', ...args);
}

// 极简 .env 解析（无第三方依赖），已存在的环境变量优先
export function loadDotEnv(file = path.join(PKG_ROOT, '.env')) {
  if (!fs.existsSync(file)) return {};
  const out = {};
  for (const raw of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#') || !line.includes('=')) continue;
    const i = line.indexOf('=');
    const k = line.slice(0, i).trim();
    let v = line.slice(i + 1).trim();
    if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
    if (process.env[k] === undefined) out[k] = v;
  }
  Object.assign(process.env, out);
  return out;
}

export function pct(n, d) {
  return d === 0 ? '0%' : `${((n / d) * 100).toFixed(0)}%`;
}
