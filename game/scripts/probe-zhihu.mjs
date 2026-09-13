// A single, bounded live gateway check. Sends ONLY the fixed fictional fixture below.
// --dry-run prints the full test content and reads no credentials. Never dump upstream headers.
import { mkdtemp, mkdir, copyFile, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
const gameRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let fixture = {
  story: { id: 'fictional-probe', title: '虚构测试房间', author: '开发测试', tags: [] },
  source: { kind: 'zhihu-hackathon', workId: 'fixture-only', title: '虚构测试房间', author: '开发测试', scope: 'excerpt' },
  release: { status: 'preview' }, start: 'room',
  scenes: [{ id: 'room', type: 'encounter', npc: 'child', text: '这是完全虚构的联调房间。' }],
  npcs: [{ id: 'child', name: '测试角色', card: { description: '虚构的温和角色，正在等人帮忙整理房间。', system_prompt: '仅回应眼前的整理与照料，不添加任何游戏规则或任务结果。' } }],
};
let request = { storyId: 'fictional-probe', sceneId: 'room', history: [{ role: 'user', content: '我把地面擦干净了。你想先坐一会儿，还是先换件干净衣服？' }], choiceSummary: '虚构测试动作：整理地面已完成。', noCache: true };
const chapterMode = process.argv.includes('--chapter');
if (chapterMode) {
  const data = JSON.parse(await readFile(path.join(gameRoot, 'stories', '蓝血-2025684191967294692.json'), 'utf8'));
  // Only the current fictional scene/card is included, no personal conversations.
  const scene = data.scenes.find((entry) => entry.id === 'chat_zhangwei');
  fixture = { ...data, scenes: [scene], start: scene.id, npcs: data.npcs.filter((entry) => entry.id === scene.npc), lore: [] };
  request = { storyId: data.story.id, sceneId: scene.id, topicId: 'care', cluesFound: ['clue_public'],
    history: [{ role: 'user', content: '你觉得我刚才哪里不对劲？我只是想听清楚你为什么担心。' }], noCache: true };
}
if (process.argv.includes('--dry-run')) {
  console.log(JSON.stringify({ destination: 'https://developer.zhihu.com/v1/chat/completions', fixture, request, maxGatewayRequests: 1, personalData: false }, null, 2));
} else {
  if (!process.env.ZHIHU_SECRET_FILE && !process.env.ZHIHU_ACCESS_SECRET) throw new Error('Supply a server-only credential through environment or file path');
  const root = await mkdtemp(path.join(tmpdir(), 'kanshan-live-probe-'));
  const port = Number(process.env.KANSHAN_PROBE_PORT || 18791);
  await mkdir(path.join(root, 'server')); await mkdir(path.join(root, 'stories'));
  for (const file of ['gateway.mjs', 'catalog.mjs', 'dialogue.mjs']) await copyFile(path.join(gameRoot, 'server', file), path.join(root, 'server', file));
  await writeFile(path.join(root, 'stories', 'fictional.json'), JSON.stringify(fixture));
  const child = spawn(process.execPath, [path.join(root, 'server/gateway.mjs')], {
    env: { PATH: process.env.PATH, CHAT_PORT: String(port), ZHIHU_SECRET_FILE: process.env.ZHIHU_SECRET_FILE || '/tmp/kanshan-no-credential', ZHIHU_ACCESS_SECRET: process.env.ZHIHU_ACCESS_SECRET || '', ZHIDA_BASE_URL: 'https://developer.zhihu.com/v1', ZHIDA_MODEL: 'zhida-fast-1p5' },
    stdio: 'ignore',
  });
  try {
    let ready = false;
    for (let attempt = 0; attempt < 30; attempt++) {
      try { const health = await fetch(`http://127.0.0.1:${port}/api/health`); if (health.ok) { ready = true; break; } } catch {}
      await delay(100);
    }
    if (!ready) throw new Error('Local probe gateway failed to start');
    const started = Date.now();
    const response = await fetch(`http://127.0.0.1:${port}/api/chat`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request), signal: AbortSignal.timeout(60000) });
    const raw = await response.text();
    const events = raw.split('\n').filter((line) => line.startsWith('data:')).map((line) => JSON.parse(line.slice(5)));
    const done = events.find((e) => e.type === 'done');
    const error = events.find((e) => e.type === 'error');
    const passed = Boolean(done?.reply?.trim()) && (chapterMode ? done.mode === 'ai' && done.clues?.includes('clue_zhangwei') && done.goalAchieved === true : done.goalAchieved === false);
    console.log(JSON.stringify({ passed, elapsedMs: Date.now() - started, realUpstream: 'developer.zhihu.com', mode: done?.mode, clueIds: done?.clues, testimonyPresent: Boolean(done?.testimony), model: done?.model, responseChars: done?.reply?.length || 0, goalAchieved: done?.goalAchieved, errorCode: error?.code || null }));
    if (!passed) process.exitCode = 1;
  } finally {
    if (child.exitCode === null) {
      const stopped = new Promise((resolve) => child.once('exit', resolve));
      child.kill('SIGTERM');
      await stopped;
    }
    await rm(root, { recursive: true, force: true });
  }
}
