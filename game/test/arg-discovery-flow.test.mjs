import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import {
  openInvestigationBrowserDocument,
  queryInvestigationBrowser,
  savePostExtractable,
} from '../src/lib/rules.mjs';

const story = JSON.parse(fs.readFileSync(new URL('../stories/蓝血-2025684191967294692.json', import.meta.url), 'utf8'));
const sceneOf = (id) => story.scenes.find((scene) => scene.id === id);

test('the fictional browser belongs only to the desktop investigation', () => {
  const browserScenes = story.scenes.filter((scene) => scene.investigation?.browser).map((scene) => scene.id);
  assert.deepEqual(browserScenes, ['invest_desktop']);
  const itemIds = new Set(sceneOf('invest_desktop').investigation.items.map((item) => item.id));
  for (const document of sceneOf('invest_desktop').investigation.browser.documents) {
    if (document.itemId) assert.ok(itemIds.has(document.itemId), `${document.id} points outside invest_desktop`);
  }
});

test('querying returns mixed display-safe pages without changing evidence', () => {
  const vars = { clue_red: 'found' };
  const before = structuredClone(vars);
  const result = queryInvestigationBrowser(story, 'invest_desktop', '东方明珠', vars);
  assert.equal(result.status, 'results');
  assert.equal(result.results.length, 2);
  assert.deepEqual(vars, before);
  for (const page of result.results) {
    assert.deepEqual(Object.keys(page).sort(), ['id', 'snippet', 'source', 'title', 'url']);
    assert.equal('itemId' in page || 'clue' in page || 'text' in page || 'vars' in page, false);
  }
});

test('only opening an authored source can grant its raw record', () => {
  const vars = { clue_red: 'found' };
  const noise = openInvestigationBrowserDocument(story, 'invest_desktop', 'doc_tower_noise', vars);
  assert.equal(noise.status, 'noise');
  assert.deepEqual(vars, { clue_red: 'found' });
  assert.equal('vars' in noise, false);

  const evidence = openInvestigationBrowserDocument(story, 'invest_desktop', 'doc_tower_reference', vars);
  assert.equal(evidence.status, 'evidence');
  assert.equal(evidence.vars.clue_landmark, 'found');
  assert.equal(evidence.vars.clue_mismatch, undefined);
  assert.deepEqual(vars, { clue_red: 'found' });

  const wrongScene = openInvestigationBrowserDocument(story, 'invest_blood', 'doc_tower_reference', vars);
  assert.equal(wrongScene.status, 'miss');
  assert.equal('vars' in wrongScene, false);
});

test('post extraction stores authored notes but never evidence', () => {
  const vars = { clue_web: 'found' };
  const saved = savePostExtractable(story, 'post_feed', 'extract_old_index', vars);
  assert.ok(saved);
  assert.equal(saved.vars.note_old_index, 'saved');
  assert.equal(saved.vars.clue_similar_post, undefined);
  assert.equal(Object.keys(saved.fragment.set).every((key) => key.startsWith('note_')), true);
  assert.deepEqual(vars, { clue_web: 'found' });
  assert.equal(savePostExtractable(story, 'post_feed', 'missing', vars), null);
});

test('desktop exit needs two investigation lines, not every optional page', () => {
  const exit = sceneOf('invest_desktop').choices.find((choice) => choice.id === 'desktop_on');
  assert.deepEqual(exit.requires, { clue_mismatch: 'found', clue_web: 'found' });
  assert.equal(exit.requires.clue_river, undefined);
});
