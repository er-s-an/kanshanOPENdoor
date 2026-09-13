// 全流程入口：npm run all -- --story <txt> [--mock]
// 也可 --only analyze 之类重跑局部（需先有前置产物）
import { runStep, parseArgs } from './lib/runner.mjs';
import { PKG_ROOT, log } from './lib/util.mjs';

const argv = process.argv.slice(2);
const opts = parseArgs(argv);
const only = (() => {
  const i = argv.indexOf('--only');
  return i >= 0 && argv[i + 1] ? argv[i + 1] : null;
})();

try {
  if (opts.help || opts.list) {
    const { helpText } = await import('./lib/runner.mjs');
    console.log(helpText());
    process.exitCode = 0;
  } else if (only) {
    await runStep(only, argv);
  } else {
    const res = await runStep('all', argv);
    process.exitCode = res && res.ok === false ? 1 : 0;
  }
} catch (e) {
  console.error(`✗ 管线失败：${e.message}`);
  console.error('  提示：断网/无 key 时可加 --mock 全流程跑通（内置规则生成器）；真实模式调知乎直答 zhida-thinking-1p5。');
  process.exitCode = 1;
}
