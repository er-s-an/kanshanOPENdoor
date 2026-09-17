import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CommitLog } from '../../src/creative/core/events.ts';
import { DialogueRunner, DialogueError } from '../../src/creative/gameplay/dialogue.ts';
import type { DialogueNode } from '../../src/creative/gameplay/dialogue.ts';

const ctx = { generation: 0, tick: 1 };

/** Adapt the bare CommitLog (which needs an explicit commit ctx) to the channel shape. */
function channelOf(log: CommitLog) {
  return { commit: (name: string, payload: unknown, eventId: string) => log.commit(name, payload, eventId, ctx) };
}

function makeNodes(): DialogueNode[] {
  return [
    { id: 'open', speaker: '思思', text: '你回来了。', next: 'choice' },
    {
      id: 'choice',
      speaker: '旁白',
      text: '你要怎么回应？',
      options: [
        { label: '蹲下安慰她', next: 'comforted', effect: { name: 'story.comforted-sisi', payload: { trust: 1 } } },
        { label: '质问来者', next: 'confronted', effect: { name: 'story.confronted-stranger' } },
      ],
    },
    { id: 'comforted', speaker: '思思', text: '她拉住了你的袖子。' },
    { id: 'confronted', speaker: '???', text: '呵，有趣。', next: 'end' },
    { id: 'end', speaker: '旁白', text: '空气冷了下来。' },
  ];
}

test('advance via input edge walks node.next; option node requires a choice', async () => {
  const runner = new DialogueRunner({ nodes: makeNodes() });
  const outcome = runner.start('open');
  assert.equal(runner.current?.nodeId, 'open');

  runner.advance();
  assert.equal(runner.current?.nodeId, 'choice');
  assert.deepEqual(
    runner.current?.options.map((o) => o.label),
    ['蹲下安慰她', '质问来者'],
  );

  runner.advance(); // no-op: options must be chosen
  assert.equal(runner.current?.nodeId, 'choice');

  runner.choose(0);
  assert.equal(runner.current?.nodeId, 'comforted');
  assert.equal(runner.current?.terminal, true);

  runner.advance(); // terminal advance completes
  assert.equal((await outcome).status, 'completed');
  assert.equal(runner.done, true);
  assert.equal(runner.current, null);
});

test('effect commits through CommitLog with deterministic idempotent eventIds', async () => {
  const log = new CommitLog({ sessionId: 's1', generation: 0 });
  let awarded = 0;
  log.onCommit((envelope) => {
    if (envelope.name === 'story.comforted-sisi') awarded += 1;
  });
  const runner = new DialogueRunner({ nodes: makeNodes(), commit: channelOf(log) });

  const outcome = runner.start('open');
  runner.advance();
  runner.choose(0);
  runner.advance();
  assert.equal((await outcome).status, 'completed');

  const effect = log.entries.find((e) => e.name === 'story.comforted-sisi');
  assert.ok(effect, 'effect committed');
  assert.equal(effect.eventId, 'dialogue:choice:0');
  assert.equal(awarded, 1);
});

test('idempotent replay: same path over the same CommitLog never double-applies', async () => {
  const log = new CommitLog({ sessionId: 's1', generation: 0 });
  let awarded = 0;
  log.onCommit((envelope) => {
    if (envelope.name === 'story.comforted-sisi') awarded += 1;
  });

  for (let run = 0; run < 2; run += 1) {
    const runner = new DialogueRunner({ nodes: makeNodes(), commit: channelOf(log) });
    const outcome = runner.start('open');
    runner.advance();
    runner.choose(0);
    runner.advance();
    assert.equal((await outcome).status, 'completed');
  }
  assert.equal(awarded, 1, 'replayed choice must not re-award');
  assert.equal(log.entries.filter((e) => e.name === 'story.comforted-sisi').length, 1);
});

test('cancel mid-cue settles the waiter with a cancelled outcome (old HUD bug)', async () => {
  const log = new CommitLog({ sessionId: 's1', generation: 0 });
  const runner = new DialogueRunner({ nodes: makeNodes(), commit: channelOf(log) });

  const outcome = runner.start('open');
  runner.advance(); // now sitting at the option node, cue on screen
  assert.equal(runner.current?.nodeId, 'choice');

  runner.cancel();
  const settled = await outcome; // must resolve, never hang
  assert.deepEqual(settled, { status: 'cancelled' });
  assert.equal(runner.done, true);
  assert.equal(runner.current, null);
  assert.equal(log.entries.length, 0, 'cancelled run commits nothing');

  // idempotent: cancelling again is a no-op, and a fresh run still works
  runner.cancel();
  const second = runner.start('open');
  runner.advance();
  runner.choose(1);
  runner.advance();
  runner.advance();
  assert.equal((await second).status, 'completed');
});

test('choose on an invalid index throws DialogueError and stays put', () => {
  const runner = new DialogueRunner({ nodes: makeNodes() });
  void runner.start('open');
  runner.advance();
  let caught: unknown = null;
  try {
    runner.choose(9);
  } catch (err) {
    caught = err;
  }
  assert.ok(caught instanceof DialogueError);
  assert.equal(caught.code, 'BAD_OPTION');
  assert.equal(runner.current?.nodeId, 'choice');
});

test('programmatic next() jumps; unknown ids throw; effect commit failure surfaces', () => {
  const runner = new DialogueRunner({ nodes: makeNodes() });
  void runner.start('open');
  runner.next('end');
  assert.equal(runner.current?.nodeId, 'end');

  let caught: unknown = null;
  try {
    runner.next('nope');
  } catch (err) {
    caught = err;
  }
  assert.ok(caught instanceof DialogueError);
  assert.equal(caught.code, 'UNKNOWN_NODE');

  // host-side commit rejection (e.g. render-phase fence) must surface, not vanish
  const failing = new DialogueRunner({
    nodes: makeNodes(),
    commit: {
      commit: () => {
        throw new Error('COMMIT_IN_RENDER');
      },
    },
  });
  void failing.start('open');
  failing.advance();
  caught = null;
  try {
    failing.choose(0);
  } catch (err) {
    caught = err;
  }
  assert.ok(caught instanceof DialogueError);
  assert.equal(caught.code, 'EFFECT_COMMIT_FAILED');
});

test('start twice while running throws; onChange fires per view change', async () => {
  const runner = new DialogueRunner({ nodes: makeNodes() });
  const seen: (string | null)[] = [];
  runner.onChange((view) => seen.push(view?.nodeId ?? null));

  const outcome = runner.start('open');
  let caught: unknown = null;
  try {
    runner.start('open');
  } catch (err) {
    caught = err;
  }
  assert.ok(caught instanceof DialogueError);
  assert.equal(caught.code, 'ALREADY_RUNNING');

  runner.advance();
  runner.choose(0);
  runner.advance();
  await outcome;
  assert.deepEqual(seen, ['open', 'choice', 'comforted', null]);
});
