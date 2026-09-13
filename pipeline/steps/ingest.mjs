// ingest 步骤入口：node steps/ingest.mjs [--story x.txt]
import { runStep } from './lib/runner.mjs';

try {
  const res = await runStep('ingest', process.argv.slice(2));
  process.exitCode = res && res.ok === false ? 1 : 0;
} catch (e) {
  console.error(`✗ ingest 失败：${e.message}`);
  if (!/--mock/.test(process.argv.join(' '))) {
    console.error('  提示：断网/无 key 时可加 --mock 用内置规则生成器跑通全流程。');
  }
  process.exitCode = 1;
}
