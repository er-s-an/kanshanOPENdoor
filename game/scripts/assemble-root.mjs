// 把「蓝白 hall 占据站点根」的组装逻辑固化下来。vite build 会清空 dist，
// 每次构建后必须重跑。前置：game 已 --base=/arg/ 构建、ps1 已构建、sync-arg 已跑。
// 产物：/ = hall（含 arg/），/arg/ = React 门户，/myopia-3d/ = 镜像，/app/ = 跳转
import { cp, mkdir, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const gameRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.resolve(gameRoot, 'dist');
const ps1Dist = path.resolve(gameRoot, '../game-ps1/dist');

try {
  if (!(await stat(ps1Dist)).isDirectory()) throw new Error('not a directory');
} catch {
  throw new Error(`game-ps1 产物不存在：${ps1Dist}。请先构建 ../game-ps1。`);
}

// 0. 清掉 vite 留下的 React 构建文件，避免无人引用的产物混进根 assets/
await rm(path.resolve(dist, 'index.html'), { force: true });
await rm(path.resolve(dist, 'assets'), { recursive: true, force: true });

// 1. hall（含 sync-arg 放进来的 arg/）提到根
await cp(ps1Dist, dist, { recursive: true });

// 2. /myopia-3d/ 完整镜像
await rm(path.resolve(dist, 'myopia-3d'), { recursive: true, force: true });
await cp(ps1Dist, path.resolve(dist, 'myopia-3d'), { recursive: true });

// 3. /app/ 兼容跳转（指回 /arg/，防书签 404）
const appDir = path.resolve(dist, 'app');
await rm(appDir, { recursive: true, force: true });
await mkdir(appDir, { recursive: true });
await writeFile(
  path.resolve(appDir, 'index.html'),
  '<!doctype html><meta charset="utf-8"><meta http-equiv="refresh" content="0; url=/arg/"><a href="/arg/">门户已搬到 /arg/</a>\n',
);

process.stdout.write(`Assembled site root → ${dist}\n  / = hall, /arg/ = React portal, /myopia-3d/ = PS1 mirror, /app/ → /arg/\n`);
