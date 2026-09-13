// analyze 步骤入口
import { runStep } from './lib/runner.mjs';

try {
  const res = await runStep('analyze', process.argv.slice(2));
  process.exitCode = res && res.ok === false ? 1 : 0;
} catch (e) {
  console.error(`✗ analyze 失败：${e.message}`);
  process.exitCode = 1;
}
