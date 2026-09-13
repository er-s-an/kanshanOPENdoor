// validate 步骤入口（契约 + 图完整性；坏图时 exit 1）
import { runStep } from './lib/runner.mjs';

try {
  const res = await runStep('validate', process.argv.slice(2));
  process.exitCode = res && res.ok === false ? 1 : 0;
} catch (e) {
  console.error(`✗ validate 失败：${e.message}`);
  process.exitCode = 1;
}
