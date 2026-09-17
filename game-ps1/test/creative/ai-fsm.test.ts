import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Fsm, createFsm } from '../../src/creative/ai/fsm.ts';
import { CreativeError } from '../../src/creative/core/errors.ts';

/** Capture hook call order for one state. */
function makeState(id: string, log: string[]) {
  return {
    id,
    enter: (prev: string | null) => log.push(`${id}.enter(${prev ?? 'null'})`),
    update: (dt: number) => log.push(`${id}.update(${dt})`),
    exit: (next: string) => log.push(`${id}.exit(${next})`),
  };
}

function expectThrow(fn: () => void, code: string): void {
  try {
    fn();
  } catch (err) {
    assert.ok(err instanceof CreativeError, `expected CreativeError, got ${err}`);
    assert.equal(err.code, code);
    return;
  }
  assert.fail(`expected throw with code ${code}`);
}

test('fsm: start enters the initial state; update drives only the current state', () => {
  const log: string[] = [];
  const fsm = createFsm({ states: [makeState('idle', log), makeState('run', log)], initial: 'idle' });
  assert.equal(fsm.stateId, 'idle');
  fsm.update(1 / 60);
  assert.deepEqual(log, ['idle.enter(null)', 'idle.update(0.016666666666666666)']);
});

test('fsm: transition runs exit -> enter with correct prev/next ids', () => {
  const log: string[] = [];
  const fsm = createFsm({
    states: [makeState('idle', log), makeState('run', log)],
    transitions: [{ from: 'idle', on: 'go', to: 'run' }],
  });
  assert.equal(fsm.fire('go'), true);
  assert.deepEqual(log, ['idle.enter(null)', 'idle.exit(run)', 'run.enter(idle)']);
  assert.equal(fsm.stateId, 'run');
});

test('fsm: guarded transition denied -> stays, returns false; allowed -> goes', () => {
  const log: string[] = [];
  let allowed = false;
  const fsm = createFsm({
    states: [makeState('idle', log), makeState('run', log)],
    transitions: [{ from: 'idle', on: 'go', to: 'run', guard: () => allowed }],
  });
  assert.equal(fsm.fire('go'), false, 'guard denied: no transition');
  assert.equal(fsm.stateId, 'idle');
  assert.equal(log.length, 1, 'no exit/enter ran');
  allowed = true;
  assert.equal(fsm.can('go'), true, 'can() dry-runs the guard');
  assert.equal(fsm.fire('go'), true);
  assert.equal(fsm.stateId, 'run');
});

test('fsm: first matching transition wins; guard receives the event', () => {
  const log: string[] = [];
  const seen: (string | undefined)[] = [];
  const fsm = createFsm({
    states: [makeState('a', log), makeState('b', log), makeState('c', log)],
    transitions: [
      { from: 'a', on: 'x', to: 'b', guard: (event) => (seen.push(`first:${event}`), false) },
      { from: 'a', on: 'x', to: 'c', guard: (event) => (seen.push(`second:${event}`), true) },
    ],
  });
  assert.equal(fsm.fire('x'), true);
  assert.deepEqual(seen, ['first:x', 'second:x'], 'guards evaluated in declaration order');
  assert.equal(fsm.stateId, 'c');
});

test('fsm: wildcard from "*" and omitted on match any state / any event', () => {
  const log: string[] = [];
  const fsm = createFsm({
    states: [makeState('a', log), makeState('b', log), makeState('panic', log)],
    transitions: [{ from: '*', to: 'panic' }],
  });
  assert.equal(fsm.fire('anything'), true);
  assert.equal(fsm.stateId, 'panic');
});

test('fsm: per-instance isolation — two machines from one def do not share state', () => {
  const log: string[] = [];
  const def = () => ({
    states: [makeState('idle', log), makeState('run', log)],
    transitions: [{ from: 'idle', on: 'go', to: 'run' }],
  });
  const one = createFsm(def());
  const two = createFsm(def());
  one.fire('go');
  assert.equal(one.stateId, 'run');
  assert.equal(two.stateId, 'idle', 'the second machine is untouched');
});

test('fsm: serializable snapshot restores the current state id', () => {
  const log: string[] = [];
  const fsm = createFsm({
    states: [makeState('idle', log), makeState('run', log)],
    transitions: [{ from: 'idle', on: 'go', to: 'run' }],
  });
  fsm.fire('go');
  const json = JSON.stringify(fsm.toSnapshot());
  assert.equal(json, '{"state":"run"}');

  const restored = createFsm({ states: [makeState('idle', log), makeState('run', log)] });
  restored.restore(JSON.parse(json));
  assert.equal(restored.stateId, 'run');
  assert.ok(log.includes('run.enter(null)'), 'restore re-enters via enter(null)');
});

test('fsm: go(to) only takes transitions that end at `to`', () => {
  const log: string[] = [];
  const fsm = createFsm({
    states: [makeState('idle', log), makeState('run', log), makeState('walk', log)],
    transitions: [
      { from: 'idle', to: 'run' },
      { from: 'idle', to: 'walk' },
    ],
  });
  assert.equal(fsm.go('walk'), true);
  assert.equal(fsm.stateId, 'walk');
  assert.equal(fsm.go('run'), false, 'no run transition out of walk');
});

test('fsm: errors — unknown state, update before start, duplicate state', () => {
  const fsm = new Fsm();
  expectThrow(() => fsm.update(1 / 60), 'FSM_NOT_STARTED');
  expectThrow(() => fsm.start('missing'), 'FSM_UNKNOWN_STATE');
  fsm.addState({ id: 'a' });
  expectThrow(() => fsm.addState({ id: 'a' }), 'FSM_DUPLICATE_STATE');
  expectThrow(() => {
    const f = new Fsm();
    f.addState({ id: 'a' });
    f.start();
    f.fire('x'); // no transitions declared: false, not an error; transition to unknown IS
    f.addTransition({ from: 'a', to: 'nope' });
    f.fire('x');
  }, 'FSM_UNKNOWN_STATE');
  expectThrow(() => {
    const f = new Fsm();
    f.addState({ id: 'a' });
    f.start();
    f.restore({ state: 'ghost' });
  }, 'FSM_UNKNOWN_STATE');
});
