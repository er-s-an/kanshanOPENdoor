// 端到端：mock 模式全流程（断网/无 key 等价场景），产物落盘且通过最终校验。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkGameContract } from '../steps/lib/schemas.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TMP = path.join(ROOT, 'test', '.tmp-out');

const STORIES = [
  path.join(ROOT, 'examples', 'door-1007.txt'),
  path.join(ROOT, 'examples', '零点回音.txt'),
];

for (const story of STORIES) {
  test(`mock 全流程可跑通：${path.basename(story)}`, () => {
    fs.rmSync(TMP, { recursive: true, force: true });
    const out = execFileSync(
      process.execPath,
      ['steps/run-all.mjs', '--story', story, '--mock', '--out', TMP],
      { cwd: ROOT, encoding: 'utf8', env: { ...process.env, ZHIHU_ACCESS_SECRET: '' } },
    );
    assert.match(out, /通过/);

    const storyId = path.basename(story).replace(/\.txt$/, '');
    for (const f of ['raw.json', 'analysis.json', 'structure.json', 'game.json']) {
      assert.ok(fs.existsSync(path.join(TMP, storyId, f)), `${storyId}/${f} 应存在`);
    }
    const game = JSON.parse(fs.readFileSync(path.join(TMP, storyId, 'game.json'), 'utf8'));
    const res = checkGameContract(game);
    assert.equal(res.problems.length, 0, res.problems.map((p) => `${p.code} ${p.msg}`).join('\n'));

    // 规模目标
    assert.ok(game.scenes.length >= 8 && game.scenes.length <= 14, `场景数 ${game.scenes.length}`);
    assert.ok(game.endings.length >= 3 && game.endings.length <= 5, '结局数 3–5');
    assert.ok(game.npcs.length >= 2 && game.npcs.length <= 4, 'NPC 2–4');
    assert.ok(game.scenes.filter((s) => s.type === 'chat').length >= 1, '至少 1 个 chat 场景');
    assert.ok(game.kanshan.rescueLines.length >= 3, 'rescueLines ≥3');

    // 确定性：同一输入重跑应产出逐字节一致的 game.json
    execFileSync(process.execPath, ['steps/run-all.mjs', '--story', story, '--mock', '--out', TMP], {
      cwd: ROOT, encoding: 'utf8', env: { ...process.env, ZHIHU_ACCESS_SECRET: '' },
    });
    const again = JSON.parse(fs.readFileSync(path.join(TMP, storyId, 'game.json'), 'utf8'));
    assert.deepEqual(again, game, 'mock 输出应确定性一致');
  });
}

test('无 key 且不加 --mock 时也应自动降级为 mock 并跑通', () => {
  fs.rmSync(TMP, { recursive: true, force: true });
  const out = execFileSync(
    process.execPath,
    ['steps/run-all.mjs', '--story', path.join(ROOT, 'examples', 'door-1007.txt'), '--out', TMP],
    { cwd: ROOT, encoding: 'utf8', env: { ...process.env, ZHIHU_ACCESS_SECRET: '', ZHIHU_ACCESS_SECRET_FILE: '' } },
  );
  assert.match(out, /通过/);
});
