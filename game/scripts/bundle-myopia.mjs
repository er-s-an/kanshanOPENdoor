import { cp, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const gameRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = path.resolve(gameRoot, '../game-ps1/dist');
const destination = path.resolve(gameRoot, 'dist/myopia-3d');

try {
  const sourceStats = await stat(source);
  if (!sourceStats.isDirectory()) throw new Error('not a directory');
} catch {
  throw new Error(`近视眼 3D 产物不存在：${source}。请先运行 ../game-ps1 的构建。`);
}

await rm(destination, { recursive: true, force: true });
await cp(source, destination, { recursive: true });
process.stdout.write(`Bundled Myopia PS1 experience → ${destination}\n`);
