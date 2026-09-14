import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PERSONAS } from '../src/lib/persona.mjs';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const story = JSON.parse(read('../stories/蓝血-2025684191967294692.json'));
const endingView = read('../src/components/EndingView.tsx');
const bossView = read('../src/components/BossView.tsx');
const poster = read('../src/components/Poster.tsx');
const kanshanCue = read('../src/components/KanshanCue.tsx');

test('geography deduction and every resolved confrontation receive exactly two Liu Kanshan lines', () => {
  const geographyScene = story.scenes.find((scene) => scene.id === 'invest_desktop');
  const geographyCheck = geographyScene?.investigation?.checks?.find((check) => check.id === 'geography');
  assert.equal(geographyCheck?.kanshan?.lines?.length, 2);
  assert.match(geographyCheck.kanshan.lines[0], /地理信息/);

  const bossScene = story.scenes.find((scene) => scene.id === 'boss_blue');
  assert.deepEqual(Object.keys(bossScene?.boss?.resolvedGuides || {}).sort(), ['egg', 'fold', 'truth']);
  for (const outcome of ['truth', 'fold', 'egg']) {
    assert.equal(bossScene.boss.resolvedGuides[outcome].lines.length, 2, `${outcome} should receive two guide lines`);
  }
  assert.match(bossView, /查看本局分支结局/);
});

test('the failed confrontation is an explicit, recoverable bad ending', () => {
  const ending = story.endings.find((candidate) => candidate.id === 'e_fold');
  const endingScene = story.scenes.find((scene) => scene.id === 'e_fold');
  assert.equal(ending?.rating, 'bad');
  assert.match(poster, /bad: 'BAD END · 论证失焦'/);
  assert.match(ending?.title || '', /折叠线下/);
  assert.match(endingScene?.text || '', /折叠线下/);
  assert.ok(endingScene?.choices?.some((choice) => /重新收窄表述/.test(choice.text)));
});

test('all investigator cards use unique abstract share copy instead of analysis copy', () => {
  const personas = Object.values(PERSONAS);
  assert.equal(personas.length, 8);
  assert.equal(new Set(personas.map((persona) => persona.shareLine)).size, personas.length);
  for (const persona of personas) assert.ok(persona.shareLine.length >= 10);
  assert.doesNotMatch(poster, /proofLines|report\.badge/);
});

test('the persona card is awarded immediately and the full analysis follows below it', () => {
  const posterIndex = endingView.indexOf('<Poster');
  const analysisIndex = endingView.indexOf('className="ending-analysis"');
  assert.ok(posterIndex > -1);
  assert.ok(analysisIndex > posterIndex);
  assert.match(endingView, /你获得了/);
  assert.doesNotMatch(endingView, /posterOpen|打开我的分享卡|收起分享卡/);
  assert.match(kanshanCue, /prefers-reduced-motion/);
});
