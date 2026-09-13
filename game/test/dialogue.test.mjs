import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { copyFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { planDialogue, finishDialogue } from '../server/dialogue.mjs';

const scene = {
  id: 'witness', type: 'chat', npc: 'witness-npc', goal: 'MODEL_MUST_NOT_JUDGE_THIS_GOAL',
  dialogue: { topics: [
    { id: 'time', prompt: '你几点看见他？', keywords: ['几点', '时间'], reply: '钟敲了九下，我看见他走进门。', grants: ['clue_time'] },
    { id: 'coat', prompt: '衣服上有什么？', keywords: ['衣服', '痕迹'], reply: '我看见他的袖口沾着蓝色粉末。', requires: { clue_record: 'found' }, grants: ['clue_coat'] },
  ], requiredClues: ['clue_time', 'clue_coat'] },
};
const fixture = {
  story: { id: 'dialogue-fixture', title: '证言边界测试', author: '测试作者', tags: [] },
  source: { kind: 'zhihu-hackathon', workId: 'fixture', title: '测试原作', author: '测试作者' },
  release: { status: 'preview' }, start: scene.id, scenes: [scene],
  npcs: [{ id: 'witness-npc', name: '目击者', card: { description: '你只见过当晚门口的情景。' } }],
  lore: [{ id: 'future', content: 'FUTURE_KILLER_SHOULD_NEVER_REACH_NPC' }],
};
const request = (overrides = {}) => ({ storyId: fixture.story.id, sceneId: scene.id, history: [{ role: 'user', content: '几点？' }], ...overrides });
const done = (events) => {
  const found = events.find((event) => event.type === 'done');
  assert.ok(found, JSON.stringify(events));
  assert.equal(events.some((event) => event.type === 'error'), false);
  return found;
};

test('compiled topics match ids or keywords and enforce prerequisites without accepting arbitrary grants', () => {
  const byKeyword = planDialogue(scene, { text: '凶手的时间证据是什么？', grants: ['clue_fake'] });
  assert.equal(byKeyword.topic.id, 'time');
  assert.deepEqual(byKeyword.clues, ['clue_time']);
  assert.equal(byKeyword.goalAchieved, false);
  const invalid = planDialogue(scene, { topicId: 'unknown', text: '几点？' });
  assert.deepEqual(invalid.clues, []);
  assert.equal(invalid.topic, null);
  const locked = planDialogue(scene, { topicId: 'coat', cluesFound: ['clue_time'] });
  assert.equal(locked.blocked, true);
  assert.deepEqual(locked.clues, []);
  assert.equal(locked.testimony, undefined);
  assert.doesNotMatch(finishDialogue(locked, { mode: 'scripted' }).reply, /蓝色粉末/);
  const unlocked = planDialogue(scene, { topicId: 'coat', cluesFound: ['clue_record', 'clue_time'] });
  assert.deepEqual(unlocked.clues, ['clue_coat']);
  assert.equal(unlocked.goalAchieved, true);
  const repeat = planDialogue(scene, { topicId: 'coat', cluesFound: ['clue_record', 'clue_time', 'clue_coat'] });
  assert.deepEqual(repeat.clues, []);
  assert.deepEqual(repeat.testimony.clues, ['clue_coat']);
  const badRequirement = structuredClone(scene);
  badRequirement.dialogue.topics[0].requires = { trust: 'found' };
  assert.equal(planDialogue(badRequirement, { topicId: 'time', cluesFound: ['trust'] }).blocked, true);
});

async function localHarness(t) {
  const requests = [];
  let reply = '九点左右，我在门口看见他。'; // No goal marker: no second judge request is permitted.
  let failure = null;
  const upstream = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    requests.push(JSON.parse(Buffer.concat(chunks).toString('utf8')));
    if (failure === 'http') { res.writeHead(503); res.end('{}'); return; }
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    const payload = failure === 'embedded' ? { error: { message: 'fixture error' } } : { choices: [{ delta: { content: reply } }] };
    res.end(`data: ${JSON.stringify(payload)}\n\ndata: [DONE]\n\n`);
  });
  upstream.listen(0, '127.0.0.1');
  await once(upstream, 'listening');
  const directory = await mkdtemp(path.join(tmpdir(), 'kanshan-dialogue-test-'));
  const game = path.join(directory, 'game');
  const server = path.join(game, 'server');
  await mkdir(server, { recursive: true });
  const sources = fileURLToPath(new URL('../server/', import.meta.url));
  await Promise.all(['gateway.mjs', 'catalog.mjs', 'dialogue.mjs'].map((name) => copyFile(path.join(sources, name), path.join(server, name))));
  await writeFile(path.join(game, 'game.json'), JSON.stringify(fixture));
  const children = [];
  t.after(async () => {
    await Promise.all(children.map(async (child) => {
      if (child.exitCode !== null || child.signalCode !== null) return;
      const exited = once(child, 'exit'); child.kill('SIGTERM'); await exited;
    }));
    upstream.closeAllConnections();
    await new Promise((resolve) => upstream.close(resolve));
    await rm(directory, { recursive: true, force: true });
  });
  const start = async (configured) => {
    // No inherited env, real secret files, remote API, real stories or cache.
    const child = spawn(process.execPath, [path.join(server, 'gateway.mjs')], { cwd: game, env: {
      CHAT_PORT: '0', CHAT_HOST: '127.0.0.1', KANSHAN_NO_CACHE: '1',
      ZHIDA_BASE_URL: `http://127.0.0.1:${upstream.address().port}/v1`,
      ZHIHU_SECRET_FILE: path.join(directory, 'deliberately-nonexistent-secret'),
      ...(configured ? { ZHIHU_ACCESS_SECRET: 'local-fake-secret' } : {}),
    }, stdio: ['ignore', 'pipe', 'pipe'] });
    children.push(child);
    const base = await new Promise((resolve, reject) => {
      let output = '';
      const timer = setTimeout(() => reject(new Error(`Gateway startup timeout: ${output}`)), 5000);
      const add = (chunk) => { output += chunk.toString(); const match = /http:\/\/127\.0\.0\.1:\d+/.exec(output); if (match) { clearTimeout(timer); resolve(match[0]); } };
      child.stdout.on('data', add); child.stderr.on('data', add);
      child.once('error', (error) => { clearTimeout(timer); reject(error); });
      child.once('exit', (code) => { clearTimeout(timer); reject(new Error(`Gateway exited ${code}: ${output}`)); });
    });
    return async (body) => {
      const response = await fetch(`${base}/api/chat`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(5000) });
      return (await response.text()).split('\n').filter((line) => line.startsWith('data:')).map((line) => JSON.parse(line.slice(5)));
    };
  };
  return { start, requests, setReply: (value) => { reply = value; }, setFailure: (value) => { failure = value; } };
}

test('HTTP dialogue keeps canonical facts and grants independent of AI, goal claims and upstream failures', async (t) => {
  const harness = await localHarness(t);
  const ai = await harness.start(true);
  const offline = await harness.start(false);
  await t.test('AI polishing returns separate canonical testimony and never calls judge', async () => {
    const result = done(await ai(request()));
    assert.equal(result.mode, 'ai');
    assert.equal(result.reply, '九点左右，我在门口看见他。');
    assert.deepEqual(result.testimony, { topicId: 'time', text: scene.dialogue.topics[0].reply, clues: ['clue_time'] });
    assert.deepEqual(result.clues, ['clue_time']);
    assert.equal(result.goalAchieved, false);
    assert.equal(harness.requests.length, 1);
    const messages = JSON.stringify(harness.requests[0].messages);
    assert.match(messages, /钟敲了九下/);
    assert.doesNotMatch(messages, /FUTURE_KILLER|MODEL_MUST_NOT_JUDGE_THIS_GOAL|蓝色粉末/);
  });
  await t.test('forged client and model grant or goal fields cannot award unregistered facts', async () => {
    harness.setReply('{"reply":"我猜他就是凶手。","goalAchieved":true,"clues":["clue_invented","clue_coat"]}');
    const result = done(await ai(request({ grants: ['clue_invented'], clueDrops: [{ id: 'clue_coat' }], topicId: 'time' })));
    assert.deepEqual(result.clues, ['clue_time']);
    assert.equal(result.goalAchieved, false);
    assert.equal(result.testimony.text, scene.dialogue.topics[0].reply);
    const free = done(await ai(request({ history: [{ role: 'user', content: '你认为真相是什么？' }] })));
    assert.equal(free.mode, 'ai');
    assert.deepEqual(free.clues, []);
    assert.equal(free.testimony, undefined);
    assert.equal(free.goalAchieved, false);
  });
  await t.test('missing prerequisites reveal no locked testimony and do not contact upstream', async () => {
    const before = harness.requests.length;
    const result = done(await ai(request({ topicId: 'coat', cluesFound: ['clue_time'] })));
    assert.equal(result.mode, 'scripted');
    assert.equal(result.reason, 'REQUIRES_CLUES');
    assert.deepEqual(result.clues, []);
    assert.equal(result.testimony, undefined);
    assert.doesNotMatch(result.reply, /蓝色粉末/);
    assert.equal(harness.requests.length, before);
  });
  await t.test('no key still grants matched testimony; goal is complete only with required evidence', async () => {
    const result = done(await offline(request({ topicId: 'coat', cluesFound: ['clue_record', 'clue_time'] })));
    assert.equal(result.mode, 'scripted');
    assert.equal(result.reason, 'NO_KEY');
    assert.equal(result.reply, scene.dialogue.topics[1].reply);
    assert.deepEqual(result.clues, ['clue_coat']);
    assert.equal(result.goalAchieved, true);
    const free = done(await offline(request({ history: [{ role: 'user', content: '你今天心情如何？' }] })));
    assert.equal(free.mode, 'scripted');
    assert.match(free.reply, /询问主题/);
    assert.equal(free.goalAchieved, false);
    assert.deepEqual(free.clues, []);
  });
  await t.test('HTTP and embedded upstream failures fall back to marked compiled dialogue', async () => {
    for (const failure of ['http', 'embedded']) {
      harness.setFailure(failure);
      const result = done(await ai(request({ topicId: 'time' })));
      assert.equal(result.mode, 'scripted');
      assert.equal(result.reason, 'UPSTREAM_ERROR');
      assert.equal(result.reply, scene.dialogue.topics[0].reply);
      assert.deepEqual(result.clues, ['clue_time']);
      assert.equal(result.goalAchieved, false);
    }
  });
});
