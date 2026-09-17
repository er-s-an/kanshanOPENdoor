import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SimulationClock } from '../../src/creative/core/clock.ts';

test('fixed step: accumulate real time into exact fixed steps', () => {
  const clock = new SimulationClock({ fixedDt: 1 / 60 });
  // First frame establishes the baseline; no steps due.
  assert.equal(clock.beginFrame(0), 0);
  // 1/30s later -> exactly 2 steps.
  assert.equal(clock.beginFrame(1 / 30), 2);
  assert.ok(clock.step());
  assert.ok(clock.step());
  assert.equal(clock.step(), false);
  assert.equal(clock.tick, 2);
  assert.ok(Math.abs(clock.time - 2 / 60) < 1e-12);
});

test('pause freezes simulation time; resume does not inherit paused wall time (G02)', () => {
  const clock = new SimulationClock();
  clock.beginFrame(0);
  clock.beginFrame(0.1);
  const timeBefore = clock.time;
  clock.pause();
  assert.equal(clock.beginFrame(5.0), 0, 'paused clock schedules nothing');
  assert.equal(clock.time, timeBefore);
  clock.resume(10.0);
  // Only post-resume elapsed counts.
  assert.equal(clock.beginFrame(10.05), 3);
  while (clock.step()) {}
  assert.ok(clock.time - timeBefore <= 3 * clock.fixedDt + 1e-12, 'no giant catch-up dt after pause');
});

test('catch-up cap discards and records excess time', () => {
  const clock = new SimulationClock({ fixedDt: 1 / 60, maxCatchUpSteps: 4, maxFrameTime: 10 });
  clock.beginFrame(0);
  const due = clock.beginFrame(1.0); // 60 steps worth, capped to 4
  assert.equal(due, 4);
  assert.ok(clock.discardedTime > 0.9, `discarded ${clock.discardedTime}`);
});

test('manual stepOnce advances exactly one fixed step even while paused', () => {
  const clock = new SimulationClock();
  clock.pause();
  clock.stepOnce();
  assert.equal(clock.tick, 1);
  assert.ok(Math.abs(clock.time - clock.fixedDt) < 1e-12);
});
