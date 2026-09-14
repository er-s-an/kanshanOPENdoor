import * as THREE from 'three'
import { WorldAssembler } from './world-assembler'

/** Shared player-facing interaction gate for keyboard, pointer and touch. */
export class InteractionSystem {
	constructor(private readonly world: WorldAssembler) {}

	canInteract(anchorId: string, playerPosition: THREE.Vector3, camera: THREE.Camera): boolean {
		return this.world.isReachable(anchorId, playerPosition, camera)
	}
}
