/**
 * 空转补丁 · Noop Patch — minimal build-hygiene fixture.
 *
 * A single rotating marker box with one author-exposed numeric parameter
 * (spin speed). It deliberately imports NO physics, audio, input or UI
 * systems, so a bundle of this experience must stay free of the rapier
 * WASM payload — that is what tools-build.test.ts asserts (G01).
 *
 * `three` is bare-imported on purpose: the engine build aliases it to the
 * game package's copy, which this fixture exercises.
 */
import * as THREE from 'three';
import type { SceneContext, SceneInstance, SceneModule } from '../../../src/creative/core/context.ts';
import { exposeParameters } from '../../../src/creative/scene/authoring.ts';
import type { ParameterRegistry } from '../../../src/creative/scene/authoring.ts';

export interface NoopPatchHandles {
  parameters: ParameterRegistry;
  setSpinSpeed(value: number): void;
}

export interface NoopPatchInstance extends SceneInstance {
  readonly handles: NoopPatchHandles;
}

const DEFAULT_SPIN_SPEED = 0.5;

export const module: SceneModule = {
  create(ctx: SceneContext): NoopPatchInstance {
    const parameters = exposeParameters([
      {
        authorId: 'noop-patch.spinSpeed',
        schemaVersion: 1,
        description: 'Marker rotation speed in radians per second.',
        value: DEFAULT_SPIN_SPEED,
        validate(value: number) {
          return Number.isFinite(value) && value >= 0 && value <= 20
            ? true
            : 'spinSpeed must be a finite number in [0, 20]';
        },
      },
    ]);

    const geometry = new THREE.BoxGeometry(0.5, 0.5, 0.5);
    const material = new THREE.MeshBasicMaterial({ color: 0x88ccff, wireframe: true });
    const marker = new THREE.Mesh(geometry, material);
    marker.name = 'noop-patch.marker';
    marker.userData.authorId = 'noop-patch.marker';
    ctx.scene.add(marker);

    let spinSpeed = DEFAULT_SPIN_SPEED;
    const spinBinding = parameters.get('noop-patch.spinSpeed');
    spinBinding?.onChange((value) => {
      spinSpeed = typeof value === 'number' ? value : spinSpeed;
    });

    return {
      root: marker,
      handles: {
        parameters,
        setSpinSpeed(value: number) {
          parameters.set('noop-patch.spinSpeed', value);
        },
      },
      update(frame) {
        marker.rotation.y += spinSpeed * frame.dt;
      },
      destroy() {
        ctx.scene.remove(marker);
        geometry.dispose();
        material.dispose();
      },
    };
  },
};

export default module;
