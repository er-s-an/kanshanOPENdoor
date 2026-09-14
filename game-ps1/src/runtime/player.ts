import * as THREE from 'three'
import { FPSInput } from '../engine/input'
import { SynthAudio } from '../engine/audio'
import { PS1Pipeline } from '../engine/renderer'
import { RuntimeHUD } from './hud'
import { StoryDirector } from './story-director'
import { WorldAssembler } from './world-assembler'
import type { StoryPackage } from './types'
import './player.css'

const DEFAULT_PACKAGE = './story-packages/bookstall-opening.json'

async function fetchPackage(): Promise<StoryPackage> {
	const requested = new URLSearchParams(location.search).get('package')
	const url = requested || DEFAULT_PACKAGE
	const response = await fetch(url)
	if (!response.ok) throw new Error(`故事包加载失败（${response.status}）：${url}`)
	const value: unknown = await response.json()
	assertPackage(value)
	return value
}

function assertPackage(value: unknown): asserts value is StoryPackage {
	if (!value || typeof value !== 'object') throw new Error('故事包不是 JSON 对象。')
	const pkg = value as Partial<StoryPackage>
	if (pkg.schemaVersion !== '1.0.0' || !pkg.id || !pkg.title || !pkg.runtime || !pkg.source || !Array.isArray(pkg.scenes) || !Array.isArray(pkg.beats)) {
		throw new Error('不支持的故事包：需要 StoryPackage schema 1.0.0。')
	}
	if (pkg.runtime.engineMajor !== 1 || pkg.runtime.templateVersion !== 1) throw new Error('故事包需要不同版本的 PS1 Player。')
	if (!pkg.startBeat || !pkg.beats.some((beat) => beat.id === pkg.startBeat)) throw new Error('故事包的起始 beat 不存在。')
}

async function boot(): Promise<void> {
	const app = document.querySelector<HTMLElement>('#app') ?? document.body
	let pkg: StoryPackage
	try {
		pkg = await fetchPackage()
	} catch (error) {
		const message = error instanceof Error ? error.message : '故事包无法加载。'
		app.innerHTML = `<div class="runtime-load-error"></div>`
		app.querySelector<HTMLElement>('.runtime-load-error')!.textContent = message
		return
	}

	const canvas = document.createElement('canvas')
	canvas.setAttribute('aria-label', 'PS1 故事游戏画面')
	app.appendChild(canvas)
	let renderer: THREE.WebGLRenderer
	try {
		renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' })
	} catch {
		app.textContent = '当前浏览器没有可用的 WebGL，无法打开 PS1 Player。'
		return
	}
	renderer.setPixelRatio(1)
	renderer.setSize(window.innerWidth, window.innerHeight, false)
	const scene = new THREE.Scene()
	scene.background = new THREE.Color(0x0d0809)
	scene.fog = new THREE.FogExp2(0x0d0809, 0.035)
	const camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.05, 60)
	camera.rotation.order = 'YXZ'
	const input = new FPSInput(canvas)
	const audio = new SynthAudio()
	const ps1 = new PS1Pipeline(renderer, scene)
	const hud = new RuntimeHUD(app)
	const world = new WorldAssembler(scene)
	let yaw = 0
	let pitch = 0

	const director = new StoryDirector(pkg, world, hud, {
		getPlayerPosition: () => camera.position.clone(),
		getCamera: () => camera,
		movePlayerToSpawn: (spawn, spawnYaw) => {
			camera.position.copy(spawn)
			yaw = spawnYaw
			pitch = 0
			camera.rotation.set(pitch, yaw, 0, 'YXZ')
		},
	})

	const isBlocked = (position: THREE.Vector3): boolean => {
		const radius = 0.25
		return world.world?.colliders.some((box) =>
			position.x > box.min.x - radius && position.x < box.max.x + radius &&
			position.z > box.min.z - radius && position.z < box.max.z + radius,
		) ?? false
	}

	const move = (dt: number): void => {
		if (director.status !== 'ready' || hud.hasCue) return
		yaw -= input.lookDX * 0.0025
		pitch = THREE.MathUtils.clamp(pitch - input.lookDY * 0.002, -1.25, 1.25)
		camera.rotation.set(pitch, yaw, 0, 'YXZ')
		const speed = 2.35
		const forward = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw))
		const right = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw))
		const delta = forward.multiplyScalar(input.moveZ * speed * dt).add(right.multiplyScalar(input.moveX * speed * dt))
		if (!delta.lengthSq()) return
		const candidateX = camera.position.clone()
		candidateX.x += delta.x
		if (!isBlocked(candidateX)) camera.position.x = candidateX.x
		const candidateZ = camera.position.clone()
		candidateZ.z += delta.z
		if (!isBlocked(candidateZ)) camera.position.z = candidateZ.z
	}

	window.addEventListener('resize', () => {
		camera.aspect = window.innerWidth / window.innerHeight
		camera.updateProjectionMatrix()
		renderer.setSize(window.innerWidth, window.innerHeight, false)
	})
	canvas.addEventListener('pointerdown', () => { audio.unlock(); audio.startAmbience() }, { once: true })
	void director.initialize()

	const clock = new THREE.Clock()
	const frame = (): void => {
		const dt = Math.min(clock.getDelta(), 0.05)
		input.update(dt)
		ps1.setSquint(input.squint)
		move(dt)
		if (input.interactPressed) director.interact()
		ps1.render(dt, camera)
		input.consume()
		requestAnimationFrame(frame)
	}
	requestAnimationFrame(frame)
}

void boot()
