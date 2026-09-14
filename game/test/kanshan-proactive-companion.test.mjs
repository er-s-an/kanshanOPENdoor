import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new URL('../src/components/KanshanCompanion.tsx', import.meta.url), 'utf8');
const css = await readFile(new URL('../src/kanshan-companion.css', import.meta.url), 'utf8');

test('刘看山 has authored, non-spoiler proactive beats for every game scene', () => {
  assert.match(source, /const NUDGE_COPY: Record<Scene\['type'\]/);
  for (const sceneType of ['novel', 'choice', 'chat', 'investigate', 'encounter', 'post', 'boss', 'ending']) {
    assert.match(source, new RegExp(`\\n  ${sceneType}: \\[`));
  }
  assert.match(source, /function nudgeForScene\(scene: Scene\)/);
  assert.doesNotMatch(source.match(/const NUDGE_COPY:[\s\S]*?\n};/)?.[0] ?? '', /正确答案|选第|点击.*通关/);
});

test('a proactive nudge is shown once per scene, expires, and opens the existing chat rather than blocking play', () => {
  assert.match(source, /seenNudgesRef = useRef\(new Set<string>\(\)\)/);
  assert.match(source, /window\.setTimeout\(\(\) => setNudge\(sceneNudge\), 850\)/);
  assert.match(source, /12_500/);
  assert.match(source, /!open && nudge/);
  assert.match(source, /onClick=\{openFromNudge\}/);
  assert.match(source, /aria-modal="false"/);
  assert.match(css, /\.kanshan-companion__nudge \{ pointer-events:auto/);
  assert.match(css, /prefers-reduced-motion:reduce[\s\S]*\.kanshan-companion__nudge \{ animation:none/);
});
