import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { RuntimeSessionHost, CreativeError } from '../../src/creative/core/index.ts';
import type { SceneContext, SceneInstance } from '../../src/creative/core/index.ts';
import { create as createMinimal } from './fixtures/minimal-scene.ts';

function hostOpts() {
  return { experienceDigest: 'exp-1', buildId: 'build-1', mode: 'controlled' as const };
}

test('a system-free module loads, updates and exits (G01 core)', async () => {
  const host = new RuntimeSessionHost(hostOpts());
  await host.start({ create: createMinimal });
  assert.equal(host.currentStatus, 'running');
  host.step(3);
  assert.equal(host.clock.tick, 3);
  const scene = host.query({ kind: 'scene' });
  assert.equal(scene.ok, true);
  const names = (scene.data as Array<{ name: string }>).map((o) => o.name);
  assert.ok(names.includes('minimal-root') && names.includes('spinner'));
  await host.stop();
  assert.equal(host.currentStatus, 'stopped');
});

test('step while auto-running is rejected; pause stops scheduling (G15.a core)', async () => {
  const host = new RuntimeSessionHost({ ...hostOpts(), mode: 'auto' });
  await host.start({ create: createMinimal });
  assert.equal(host.advance(0), 0);
  assert.throws(() => host.step(1), (e) => (e as CreativeError).code === 'STEP_WHILE_RUNNING');
  host.pause();
  assert.equal(host.advance(100), 0, 'paused session schedules nothing');
  host.step(2); // manual step is allowed while paused
  assert.equal(host.clock.tick, 2);
  await host.stop();
});

test('stop invalidates handles: query/step/command reject (G15.a core)', async () => {
  const host = new RuntimeSessionHost(hostOpts());
  await host.start({ create: createMinimal });
  await host.stop();
  const q = host.query({ kind: 'session' });
  assert.equal(q.ok, false);
  assert.equal(q.error?.code, 'SESSION_STOPPED');
  assert.throws(() => host.step(1), (e) => (e as CreativeError).code === 'SESSION_STOPPED');
});

test('G02.a: create throw -> error state, cleanups run, other sessions unaffected', async () => {
  let cleaned = 0;
  const bad = {
    create(ctx: SceneContext): SceneInstance {
      ctx.scope.defer(() => (cleaned += 1));
      throw new Error('kaboom from create at fake.ts:12');
    },
  };
  const host = new RuntimeSessionHost(hostOpts());
  await assert.rejects(() => host.start(bad));
  assert.equal(host.currentStatus, 'error');
  assert.equal(cleaned, 1, 'registered cleanups still ran');
  const diag = host.diagnosticsLog.find((d) => d.phase === 'create');
  assert.ok(diag, 'diagnostic carries the create phase');

  const other = new RuntimeSessionHost(hostOpts());
  await other.start({ create: createMinimal });
  other.step(1);
  assert.equal(other.currentStatus, 'running', 'other session unpolluted');
  await other.stop();
});

test('G02.a: update throw -> error state with phase + source; scope disposed', async () => {
  let cleaned = 0;
  const mod = {
    create(ctx: SceneContext): SceneInstance {
      ctx.scope.defer(() => (cleaned += 1));
      const root = new THREE.Group();
      return {
        root,
        update() {
          throw new Error('update exploded');
        },
      };
    },
  };
  const host = new RuntimeSessionHost(hostOpts());
  await host.start(mod);
  host.step(1);
  assert.equal(host.currentStatus, 'error');
  assert.equal(cleaned, 1);
  const diag = host.diagnosticsLog.find((d) => d.phase === 'mechanics');
  assert.ok(diag && diag.message.includes('update exploded'));
  // Error sessions refuse further stepping but can still be inspected and stopped.
  assert.throws(() => host.step(1), CreativeError);
  assert.equal(host.query({ kind: 'session' }).ok, true);
  await host.stop();
});

test('G02.a: destroy throw is recorded and stop completes; resources still released', async () => {
  let cleaned = 0;
  const mod = {
    create(ctx: SceneContext): SceneInstance {
      ctx.scope.defer(() => (cleaned += 1));
      const root = new THREE.Group();
      return {
        root,
        destroy() {
          throw new Error('destroy failed');
        },
      };
    },
  };
  const host = new RuntimeSessionHost(hostOpts());
  await host.start(mod);
  await host.stop();
  assert.equal(host.currentStatus, 'stopped');
  assert.equal(cleaned, 1, 'scope cleanup still ran after destroy error');
  assert.ok(host.diagnosticsLog.some((d) => d.phase === 'destroy'));
});

test('render-phase commit is rejected (G02: interpolation awards nothing)', async () => {
  const mod = {
    create(ctx: SceneContext): SceneInstance {
      const root = new THREE.Group();
      return {
        root,
        render() {
          ctx.commit('cheat.reward', {}, 'cheat-1');
        },
      };
    },
  };
  const host = new RuntimeSessionHost(hostOpts());
  await host.start(mod);
  host.renderFrame();
  assert.equal(host.currentStatus, 'error');
  assert.equal(host.commits.entries.length, 0, 'no fact committed from interpolation');
  await host.stop();
});

test('query results are bounded and flagged when truncated (G15.b core)', async () => {
  const mod = {
    create(): SceneInstance {
      const root = new THREE.Group();
      for (let i = 0; i < 10; i += 1) root.add(new THREE.Group());
      return { root };
    },
  };
  const host = new RuntimeSessionHost(hostOpts());
  await host.start(mod);
  const q = host.query({ kind: 'scene', limit: 5 });
  assert.equal(q.ok, true);
  assert.equal((q.data as unknown[]).length, 5);
  assert.equal(q.truncated, true);
  await host.stop();
});
