import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const config = readFileSync(new URL('../src/lib/config.ts', import.meta.url), 'utf8');
const typedProse = readFileSync(new URL('../src/components/TypedProse.tsx', import.meta.url), 'utf8');

test('新玩家默认逐字读剧情，旧偏好不会继续遮住新默认值', () => {
  assert.match(config, /STORAGE_PREFS\s*=\s*'kanshan:prefs:v2'/);
  assert.match(config, /DEFAULT_PREFS[^\n]+typewriter:\s*true/);
  assert.match(config, /DEFAULT_PREFS[^\n]+calm:\s*false/);
});

test('逐字正文尊重玩家和系统的降动效选择', () => {
  assert.match(typedProse, /prefers-reduced-motion:\s*reduce/);
  assert.match(typedProse, /!prefs\.calm\s*&&\s*!reducedMotion/);
  assert.match(typedProse, /显示本幕全文/);
});
