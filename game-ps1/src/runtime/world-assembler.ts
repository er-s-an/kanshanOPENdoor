import * as THREE from 'three'
import type { PrefabName, StoryObject, StoryPackage, StoryScene, StoryState, Vec3Tuple } from './types'

export const PREFABS: readonly PrefabName[] = [
	'table-v1', 'key-v1', 'door-v1', 'note-v1', 'person-v1', 'plant-v1',
]

export interface WorldObjectRef {
	definition: StoryObject
	group: THREE.Group
	visible: boolean
}

export interface AssembledWorld {
	scene: StoryScene
	root: THREE.Group
	colliders: THREE.Box3[]
	objects: Map<string, WorldObjectRef>
	anchors: Map<string, THREE.Vector3>
	spawn: THREE.Vector3
	spawnYaw: number
}

/** Turns bounded scene data into an intentionally small PS1 world. */
export class WorldAssembler {
	private current: AssembledWorld | null = null

	constructor(private readonly threeScene: THREE.Scene) {}

	get world(): AssembledWorld | null { return this.current }

	load(pkg: StoryPackage, sceneId: string, state: StoryState): AssembledWorld {
		this.dispose()
		const scene = pkg.scenes.find((candidate) => candidate.id === sceneId)
		if (!scene) throw new Error(`Scene not found: ${sceneId}`)
		const root = new THREE.Group()
		root.name = `story-scene:${scene.id}`
		const colliders: THREE.Box3[] = []
		this.addTemplate(root, colliders, scene.template)
		const objects = new Map<string, WorldObjectRef>()
		for (const definition of scene.objects) {
			const object = this.createPrefab(definition.prefab)
			object.name = `object:${definition.id}`
			object.position.fromArray(definition.position)
			object.rotation.y = definition.yaw
			object.userData.storyObjectId = definition.id
			object.userData.itemId = definition.itemId
			root.add(object)
			objects.set(definition.id, { definition, group: object, visible: true })
		}
		const anchors = new Map<string, THREE.Vector3>()
		for (const anchor of scene.anchors) anchors.set(anchor.id, new THREE.Vector3(...anchor.position))
		root.userData.colliders = colliders
		this.threeScene.add(root)
		this.current = {
			scene, root, colliders, objects, anchors,
			spawn: new THREE.Vector3(...scene.spawn.position),
			spawnYaw: scene.spawn.yaw,
		}
		this.update(state)
		return this.current
	}

	update(state: StoryState): void {
		if (!this.current) return
		for (const ref of this.current.objects.values()) {
			const byCollected = ref.definition.itemId ? state.collectedItems.includes(ref.definition.itemId) : false
			const condition = ref.definition.visibleWhen
			const byFlag = condition ? state.flags[condition.flagId] === condition.value : true
			ref.visible = !byCollected && byFlag
			ref.group.visible = ref.visible
		}
	}

	getObject(objectId: string): WorldObjectRef | undefined { return this.current?.objects.get(objectId) }

	getAnchor(anchorId: string): THREE.Vector3 | undefined {
		const value = this.current?.anchors.get(anchorId)
		return value?.clone()
	}

	/**
	 * Shared player-facing distance/visibility gate.  It intentionally tests
	 * the target centre from the eye, so a story does not require an exact
	 * crosshair hit to be playable.
	 */
	isReachable(anchorId: string, playerPosition: THREE.Vector3, camera: THREE.Camera): boolean {
		if (!this.current) return false
		const anchor = this.current.scene.anchors.find((value) => value.id === anchorId)
		if (!anchor) return false
		const targetRef = this.current.objects.get(anchor.targetObject)
		if (!targetRef || !targetRef.visible) return false
		const dx = playerPosition.x - anchor.position[0]
		const dz = playerPosition.z - anchor.position[2]
		if (Math.hypot(dx, dz) > anchor.radius) return false
		const targetPoint = targetRef.group.getWorldPosition(new THREE.Vector3())
		const cameraDirection = new THREE.Vector3()
		camera.getWorldDirection(cameraDirection)
		const toTarget = targetPoint.clone().sub(playerPosition).normalize()
		if (cameraDirection.dot(toTarget) < 0.05) return false
		const ray = new THREE.Raycaster(playerPosition, toTarget, 0, playerPosition.distanceTo(targetPoint) + 0.1)
		const hits = ray.intersectObject(this.current.root, true)
		return hits.length === 0 || hits.some((hit) => hit.object === targetRef.group || targetRef.group.getObjectById(hit.object.id) !== undefined)
	}

	dispose(): void {
		if (!this.current) return
		this.threeScene.remove(this.current.root)
		disposeObject(this.current.root)
		this.current = null
	}

	private addTemplate(root: THREE.Group, colliders: THREE.Box3[], template: StoryScene['template']): void {
		const extent = template === 'room-v1' ? { x: 5, z: 4, color: 0x343d3b } : { x: 6, z: 6, color: 0x4c5948 }
		const floor = new THREE.Mesh(
			new THREE.PlaneGeometry(extent.x * 2, extent.z * 2),
			new THREE.MeshLambertMaterial({ color: template === 'room-v1' ? 0x69534d : 0x766443 }),
		)
		floor.name = 'template-floor'
		floor.rotation.x = -Math.PI / 2
		root.add(floor)
		const wallMaterial = new THREE.MeshLambertMaterial({ color: extent.color })
		const wallHeight = 3.2
		const wallThickness = 0.25
		const walls = [
			{ size: [extent.x * 2, wallHeight, wallThickness], pos: [0, wallHeight / 2, -extent.z] },
			{ size: [extent.x * 2, wallHeight, wallThickness], pos: [0, wallHeight / 2, extent.z] },
			{ size: [wallThickness, wallHeight, extent.z * 2], pos: [-extent.x, wallHeight / 2, 0] },
			{ size: [wallThickness, wallHeight, extent.z * 2], pos: [extent.x, wallHeight / 2, 0] },
		] as const
		for (const wall of walls) {
			const mesh = new THREE.Mesh(new THREE.BoxGeometry(wall.size[0], wall.size[1], wall.size[2]), wallMaterial)
			mesh.position.set(wall.pos[0], wall.pos[1], wall.pos[2])
			mesh.name = 'template-wall'
			root.add(mesh)
			colliders.push(new THREE.Box3().setFromObject(mesh))
		}
		const light = new THREE.HemisphereLight(0xadb4a2, 0x201b1f, template === 'room-v1' ? 1.4 : 1.1)
		root.add(light)
		const sun = new THREE.DirectionalLight(template === 'room-v1' ? 0xb2c1bc : 0xd8c793, 1.1)
		sun.position.set(-4, 7, 3)
		root.add(sun)
	}

	private createPrefab(prefab: PrefabName): THREE.Group {
		const group = new THREE.Group()
		const mat = (color: number) => new THREE.MeshLambertMaterial({ color, flatShading: true })
		const add = (geometry: THREE.BufferGeometry, material: THREE.Material, position?: Vec3Tuple): THREE.Mesh => {
			const mesh = new THREE.Mesh(geometry, material)
			if (position) mesh.position.set(...position)
			group.add(mesh)
			return mesh
		}
		switch (prefab) {
			case 'table-v1': {
				add(new THREE.BoxGeometry(1.7, 0.16, 0.9), mat(0x76553e), [0, 1.05, 0])
				for (const x of [-0.68, 0.68]) for (const z of [-0.32, 0.32]) add(new THREE.BoxGeometry(0.12, 1.05, 0.12), mat(0x4b382d), [x, 0.52, z])
				break
			}
			case 'key-v1':
				add(new THREE.TorusGeometry(0.13, 0.04, 5, 8), mat(0xd0a746), [0, 0.1, 0]).rotation.x = Math.PI / 2
				add(new THREE.BoxGeometry(0.34, 0.06, 0.06), mat(0xd0a746), [0.18, 0.1, 0])
				break
			case 'door-v1': {
				add(new THREE.BoxGeometry(0.16, 2.5, 1.2), mat(0x403e48), [0, 1.25, 0])
				add(new THREE.BoxGeometry(0.2, 2.8, 0.12), mat(0x7e6c57), [-0.66, 1.4, 0])
				add(new THREE.BoxGeometry(0.2, 2.8, 0.12), mat(0x7e6c57), [0.66, 1.4, 0])
				add(new THREE.BoxGeometry(0.2, 0.12, 1.45), mat(0x7e6c57), [0, 2.74, 0])
				break
			}
			case 'note-v1':
				add(new THREE.BoxGeometry(0.7, 0.03, 0.5), mat(0xd8cca0), [0, 0.02, 0])
				add(new THREE.BoxGeometry(0.48, 0.012, 0.025), mat(0x66564a), [-0.06, 0.04, -0.1])
				add(new THREE.BoxGeometry(0.4, 0.012, 0.025), mat(0x66564a), [-0.1, 0.04, 0])
				break
			case 'person-v1':
				add(new THREE.CylinderGeometry(0.3, 0.38, 1.15, 6), mat(0x7b5662), [0, 0.72, 0])
				add(new THREE.SphereGeometry(0.28, 6, 4), mat(0xb38f77), [0, 1.48, 0])
				break
			case 'plant-v1':
				add(new THREE.CylinderGeometry(0.28, 0.38, 0.35, 6), mat(0x8d6445), [0, 0.18, 0])
				for (const [x, y, z] of [[-0.18, 0.62, 0], [0.2, 0.73, 0.05], [0, 0.9, -0.05]] as Vec3Tuple[]) add(new THREE.SphereGeometry(0.25, 5, 4), mat(0x55714d), [x, y, z])
				break
		}
		return group
	}
}

function disposeObject(root: THREE.Object3D): void {
	root.traverse((child) => {
		const mesh = child as THREE.Mesh
		if (mesh.geometry) mesh.geometry.dispose()
		const materials = mesh.material ? (Array.isArray(mesh.material) ? mesh.material : [mesh.material]) : []
		for (const material of materials) material.dispose()
	})
}
