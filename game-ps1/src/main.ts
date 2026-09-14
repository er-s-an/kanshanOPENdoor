// ============================================================================
// 主循环（engine 层）：渲染器/PS1 管线/相机/输入/音频组装 + 第一人称移动。
//  固定眼高 1.6m；world.colliders AABB 逐轴滑动碰撞（圆柱近似 r=0.3）；
//  每帧：input.update → 移动/相机 → npc.update → game.update(dt) → 渲染 → input.consume()
// ============================================================================
import * as THREE from 'three'
import { buildWorld } from './world/apartment'
import { createNPCs } from './game/npcs'
import { Game } from './game/game'
import type { EngineAPI } from './engine/contract'
import { PS1Pipeline, PS1_BG } from './engine/renderer'
import { FPSInput } from './engine/input'
import { SynthAudio } from './engine/audio'

const EYE = 1.6
const PLAYER_R = 0.3
const WALK_SPEED = 2.3
const LOOK_SENS = 0.0026
const STEP_STRIDE = 1.75
/**
 * 开发期剧情巡检开关。它只消除“必须指针锁定才能走到交互点”的验收障碍：
 * 正常玩家路径仍使用 FPSInput、WASD 和鼠标；生产构建不会安装该句柄。
 */
const viteEnv = (import.meta as ImportMeta & { env?: { DEV?: boolean } }).env
const STORY_TEST = viteEnv?.DEV === true && new URLSearchParams(window.location.search).has('story-test')

type StoryChoice = 'defend' | 'soothe' | 'retreat'

interface StorySnapshot {
	stage: number
	fear: number
	ended: boolean
	flags: Record<string, number | boolean | string>
	npcStates: Record<string, string>
	prompt: string | null
	choices: string[]
	ending: string | null
	events: Record<string, number>
}

interface StoryRunReport {
	choice: StoryChoice
	expectedFear: number
	expectedEnding: string
	final: StorySnapshot
	checks: { name: string; pass: boolean; expected: unknown; actual: unknown }[]
}

const app = document.getElementById('app')!

const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' })
renderer.setPixelRatio(1)
renderer.setSize(window.innerWidth, window.innerHeight)
renderer.toneMapping = THREE.NoToneMapping
app.appendChild(renderer.domElement)
renderer.domElement.setAttribute('aria-label', '近视眼勇闯恐怖游戏。手机上左下按住移动，右侧拖动看向，右下点按行动，按住眯眼可短暂看清远处。')
renderer.domElement.tabIndex = 0

const scene = new THREE.Scene()
scene.background = new THREE.Color(PS1_BG)
scene.fog = new THREE.FogExp2(PS1_BG, 0.06)

const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.05, 60)
camera.rotation.order = 'YXZ'

// 兜底灯光：全局方向微光 + 昏暗环境光（world agent 会布主灯光，见 CONTRACT §9）
const ambient = new THREE.AmbientLight(0x453a40, 0.5)
scene.add(ambient)
const dirLight = new THREE.DirectionalLight(0x8ea2bd, 0.3)
dirLight.position.set(3, 8, 2)
scene.add(dirLight)

window.addEventListener('resize', () => {
	camera.aspect = window.innerWidth / window.innerHeight
	camera.updateProjectionMatrix()
	renderer.setSize(window.innerWidth, window.innerHeight)
})

function showLockHint(canvas: HTMLCanvasElement): void {
	const isTouch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window
	if (isTouch) return
	const hint = document.createElement('div')
	hint.textContent = '点击画面锁定视角 · WASD 移动 · E 交互 · Q/右键眯眼：短暂看清远处；直视真身会涨惊悚'
	hint.style.cssText =
		'position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);' +
		'color:#cdbfc4;font:14px/1.8 monospace;text-align:center;' +
		'text-shadow:0 1px 3px #000;background:rgba(10,6,8,.55);padding:12px 20px;' +
		'border:1px solid rgba(205,191,196,.25);z-index:25;pointer-events:none;max-width:80vw'
	document.body.appendChild(hint)
	document.addEventListener('pointerlockchange', () => {
		if (document.pointerLockElement === canvas) hint.remove()
	})
}

async function main(): Promise<void> {
	const world = await buildWorld(scene)
	const npcs = createNPCs(scene)

	const pipeline = new PS1Pipeline(renderer, scene)
	const input = new FPSInput(renderer.domElement)
	const audio = new SynthAudio()
	// 首次手势解锁音频（浏览器自动播放策略）
	const unlock = () => audio.unlock()
	window.addEventListener('pointerdown', unlock, { once: true })
	window.addEventListener('keydown', unlock, { once: true })
	window.addEventListener('touchstart', unlock, { once: true })

	const engine: EngineAPI = { renderer, scene, camera, input, audio, ps1: pipeline }
	const game = new Game(engine, world, npcs)
	if (!STORY_TEST) showLockHint(renderer.domElement)

	const player = { x: world.spawn.x, z: world.spawn.z, yaw: world.yaw, pitch: 0 }
	// 开场从楼外开始。剧情明确发出 openingFreeMove 后才放行 WASD，避免
	// 引擎再依据某个具体 door 交互猜测剧情进度；转场同样由 gameplay 通过
	// openingRelocate 指向 world 锚点，main 只负责同步第一人称相机。
	let movementEnabled = false
	type OpeningRelocation = { anchor: string; yaw?: number; pitch?: number }
	game.on('openingFreeMove', () => {
		movementEnabled = true
	})
	// 拍门后的红影/扑击是一个固定门洞内的空间演出：保留鼠标转头，临时
	// 冻结 WASD；思思被抱住、门碰撞解除后由 gameplay 再放行。
	game.on('openingMovement', (data) => {
		movementEnabled = data !== false
	})
	game.on('openingRelocate', (data) => {
		const relocation = data as Partial<OpeningRelocation> | undefined
		if (!relocation?.anchor) return
		const anchor = world.anchors[relocation.anchor]
		if (!anchor) {
			console.warn(`[opening] unknown relocation anchor: ${relocation.anchor}`)
			return
		}
		const p = anchor.getWorldPosition(new THREE.Vector3())
		player.x = p.x
		player.z = p.z
		player.yaw = relocation.yaw ?? player.yaw
		player.pitch = relocation.pitch ?? 0
		camera.position.set(player.x, EYE, player.z)
		camera.rotation.set(player.pitch, player.yaw, 0)
	})

	// AABB 逐轴滑动碰撞：只挡与玩家高度带 [0.35, 1.6] 重叠的盒子
	function resolveAxis(axis: 'x' | 'z', delta: number): void {
		if (delta === 0) return
		for (const b of world.colliders) {
			if (b.max.y <= 0.35 || b.min.y >= EYE) continue
			if (
				player.x > b.min.x - PLAYER_R && player.x < b.max.x + PLAYER_R &&
				player.z > b.min.z - PLAYER_R && player.z < b.max.z + PLAYER_R
			) {
				if (axis === 'x') player.x = delta > 0 ? b.min.x - PLAYER_R : b.max.x + PLAYER_R
				else player.z = delta > 0 ? b.min.z - PLAYER_R : b.max.z + PLAYER_R
			}
		}
	}

	pipeline.setMyopia(0.35) // 常态近视（§4）
	void game.start().catch((err) => console.error('[game.start]', err))

	// 集成自测句柄（ego-browser / 冒烟脚本用；不影响游戏逻辑）
	const debugWindow = window as unknown as {
		__kanshan: unknown
		__kanshanStoryTest?: unknown
	}
	debugWindow.__kanshan = {
		camera, player, input, ps1: pipeline, audio, engine,
	}

	const clock = new THREE.Clock()
	let bobPhase = 0
	let bobAmt = 0
	let stepAcc = 0
	let wasSquinting = false

	if (STORY_TEST) {
		// 只在 Vite 开发服务器 + ?story-test=1 下暴露。这里不改 Game 的私有状态：
		// 所有推进仍经过真实的 FPSInput、最近可用 Interactable 与主循环。
		const eventCounts: Record<string, number> = {}
		for (const eventName of ['doorOpen', 'sisiNap', 'choresDone', 'bossHome', 'sisiThrown']) {
			eventCounts[eventName] = 0
			game.on(eventName, () => { eventCounts[eventName] += 1 })
		}

		const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
		const wait = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms))
		const promptText = () => document.querySelector<HTMLElement>('.hud-interact.on')?.textContent ?? null
		const endingText = () => document.querySelector<HTMLElement>('.hud-ending .etitle')?.textContent ?? null
		const snapshot = (): StorySnapshot => ({
			stage: Number(game.flags.stage ?? -1),
			fear: game.fear.value,
			ended: game.ended,
			flags: { ...game.flags },
			npcStates: Object.fromEntries(Object.entries(npcs).map(([id, npc]) => [id, npc.state])),
			prompt: promptText(),
			choices: Array.from(document.querySelectorAll<HTMLElement>('.hud-pmask .opt')).map((el) => el.textContent ?? ''),
			ending: endingText(),
			events: { ...eventCounts },
		})
		const skipNarration = () => {
			const nodes = document.querySelectorAll<HTMLElement>('.hud-sub.on, .hud-sys.on')
			nodes.forEach((node) => node.click())
			return nodes.length
		}
		const waitFor = async (
			label: string,
			ready: () => boolean,
			timeoutMs = 16000,
			autoSkip = true,
		): Promise<StorySnapshot> => {
			const deadline = performance.now() + timeoutMs
			while (performance.now() < deadline) {
				if (ready()) return snapshot()
				if (autoSkip) skipNarration()
				await nextFrame()
			}
			throw new Error(`[story-test] timed out waiting for ${label}: ${JSON.stringify(snapshot())}`)
		}
		const anchorPosition = (name: string): THREE.Vector3 => {
			const anchor = world.anchors[name]
			if (!anchor) throw new Error(`[story-test] unknown anchor: ${name}`)
			return anchor.getWorldPosition(new THREE.Vector3())
		}
		const teleport = (anchorName: string, offsetX = 0, offsetZ = 0): StorySnapshot => {
			const p = anchorPosition(anchorName)
			player.x = p.x + offsetX
			player.z = p.z + offsetZ
			camera.position.set(player.x, EYE, player.z)
			return snapshot()
		}
		const waitForPrompt = (fragment: string, timeoutMs?: number) =>
			waitFor(`prompt “${fragment}”`, () => (promptText() ?? '').includes(fragment), timeoutMs)
		const interact = async (): Promise<StorySnapshot> => {
			input.interactPressed = true
			// 两帧确保 setAnimationLoop 已消费边沿；随后越过 Game 的 0.35s 防重入。
			await nextFrame()
			await nextFrame()
			await wait(390)
			return snapshot()
		}
		const use = async (anchorName: string, promptFragment: string): Promise<StorySnapshot> => {
			teleport(anchorName)
			await waitForPrompt(promptFragment)
			return interact()
		}
		/**
		 * 原文开场的实际动作链：楼外问规则 → 选房 → 30 层门外双观察 → 拍门。
		 * entrySelect 的剧情会发 openingRelocate，之后才注册 hall 两个观察锚点；
		 * waitFor 的自动跳字幕机制会等待该真实交互边界，而不会直接改 flags。
		 */
		const completeOpening = async (): Promise<StorySnapshot> => {
			await use('entryRules', '向红姐和俊哥问规则')
			await use('entrySelect', '跟上选房的人群')
			await use('hallAir', '停下来感受冷空气')
			await use('hallWall', '靠近看暗红的墙和灯')
			return use('doorExterior', '用回家的口吻拍门')
		}
		const choose = async (choice: StoryChoice): Promise<StorySnapshot> => {
			const index = ({ defend: 1, soothe: 2, retreat: 3 } as const)[choice]
			await waitFor('confront choice', () => document.querySelector('.hud-pmask') !== null)
			window.dispatchEvent(new KeyboardEvent('keydown', { key: String(index), code: `Digit${index}`, bubbles: true }))
			await nextFrame()
			await nextFrame()
			return snapshot()
		}
		const gaze = async (targetName: string, ms: number): Promise<StorySnapshot> => {
			const target = npcs[targetName]?.group ?? world.anchors[targetName]
			if (!target) throw new Error(`[story-test] unknown gaze target: ${targetName}`)
			const p = target.getWorldPosition(new THREE.Vector3())
			const dx = p.x - player.x
			const dy = p.y - EYE
			const dz = p.z - player.z
			player.yaw = Math.atan2(-dx, -dz)
			player.pitch = THREE.MathUtils.clamp(Math.atan2(dy, Math.hypot(dx, dz)), -1.45, 1.45)
			window.dispatchEvent(new KeyboardEvent('keydown', { key: 'q', code: 'KeyQ', bubbles: true }))
			const deadline = performance.now() + ms
			while (performance.now() < deadline && !game.ended) await nextFrame()
			window.dispatchEvent(new KeyboardEvent('keyup', { key: 'q', code: 'KeyQ', bubbles: true }))
			await nextFrame()
			return snapshot()
		}
		const waitForEnding = () => waitFor('ending page', () => game.ended && endingText() !== null)
		const runMainline = async ({
			choice = 'defend' as StoryChoice,
		}: { choice?: StoryChoice } = {}): Promise<StoryRunReport> => {
			// 主线每一步都等真实可见 prompt，再触发真实 E 边沿；故脚本不会因 UI/计时差异跳关。
			// 先走完楼外到 30 层门口的所有可交互剧情，不能再用门内转身绕过它。
			await completeOpening()
			await use('bathroomCabinet', '打开浴室柜')
			await use('kidsBed', '给她换上白裙')
			await use('bathroomCabinet', '浸湿一条热毛巾')
			await use('kidsBed', '用热毛巾给她擦脸')
			await use('kidsBed', '哄她午睡')
			// 原文中的 30 → 20 播报紧接着就是贴近手机读群消息；
			// 新主线将其设为必经剧情，巡检也不能再跳过。
			await use('phone', '看手机')
			await use('mop', '拿起拖把')
			await use('floorArea', '拖地')
			await use('floorArea', '拖地')
			await use('floorArea', '拖地')
			await use('wallStain1', '铲掉这块血渍')
			await use('wallStain1', '铲掉这块血渍')
			await use('wallStain1', '铲掉这块血渍')
			await use('wallStain2', '铲掉这块血渍')
			await use('wallStain2', '铲掉这块血渍')
			await use('wallStain2', '铲掉这块血渍')
			await use('sofa', '在沙发上眯一会儿')
			await choose(choice)
			const final = await waitForEnding()
			const expectedFear = 40 + ({ defend: 10, soothe: 5, retreat: 15 } as const)[choice]
			const expectedEnding = ({
				defend: '第一章记录 · 向她走去',
				soothe: '第一章记录 · 先让她停下',
				retreat: '第一章记录 · 留出距离',
			} as const)[choice]
			const checks = [
				{ name: '楼外开场完成', pass: final.flags.entryRules === true && final.flags.entrySelect === true && final.flags.hallAir === true && final.flags.hallWall === true, expected: 'entryRules/select/hallAir/hallWall=true', actual: final.flags },
				{ name: '主线恐惧值', pass: final.fear === expectedFear, expected: expectedFear, actual: final.fear },
				{ name: '结局页', pass: final.ending === expectedEnding, expected: expectedEnding, actual: final.ending },
				{ name: '家务完成', pass: final.flags.floorSeg === 3 && final.flags.stain1 === true && final.flags.stain2 === true, expected: 'floor=3, stains=true', actual: final.flags },
				{ name: '思思撞玻璃事件恰好一次', pass: final.events.sisiThrown === 1, expected: 1, actual: final.events.sisiThrown },
			]
			return { choice, expectedFear, expectedEnding, final, checks }
		}

		debugWindow.__kanshan = { camera, player, input, ps1: pipeline, audio, engine, game, world, npcs }
		debugWindow.__kanshanStoryTest = {
			help: '仅开发环境：snapshot(), teleport(anchor), completeOpening(), skipNarration(), use(anchor,prompt), choose(defend|soothe|retreat), gaze(sisi|boss|wallStain1|wallStain2, ms), runMainline({ choice })。completeOpening 会依次走楼外问规则、选房、30 层门外双观察和拍门；手机群聊是主线必经；每次路线请刷新页面后单独运行。',
			anchors: () => Object.keys(world.anchors),
			snapshot,
			teleport,
			completeOpening,
			skipNarration,
			waitForStage: (stage: number, timeoutMs?: number) => waitFor(`stage ${stage}`, () => Number(game.flags.stage) === stage, timeoutMs),
			waitForEnding,
			interact,
			use,
			choose,
			gaze,
			runMainline,
		}
		console.info('[story-test] ready. Run window.__kanshanStoryTest.help in DevTools.')
	}

	renderer.setAnimationLoop(() => {
		const dt = Math.min(clock.getDelta(), 0.05)
		input.update(dt)

		// ---- 视角 ----
		player.yaw -= input.lookDX * LOOK_SENS
		player.pitch = THREE.MathUtils.clamp(player.pitch - input.lookDY * LOOK_SENS, -1.45, 1.45)

		// ---- 移动（相机相对）----
		const mx = movementEnabled ? input.moveX : 0
		const mz = movementEnabled ? input.moveZ : 0
		const mag = Math.hypot(mx, mz)
		const moving = mag > 0.1
		let dx = 0
		let dz = 0
		if (moving) {
			const s = Math.min(mag, 1) * WALK_SPEED * dt * (1 - 0.25 * input.squint)
			const sin = Math.sin(player.yaw)
			const cos = Math.cos(player.yaw)
			dx = (cos * mx - sin * mz) * s
			dz = (-sin * mx - cos * mz) * s
		}
		player.x += dx
		resolveAxis('x', dx)
		player.z += dz
		resolveAxis('z', dz)

		// ---- 头部微晃 + 脚步（按移动距离计步频）----
		if (moving) {
			bobPhase += dt * 7.2 * Math.min(mag, 1)
			stepAcc += Math.hypot(dx, dz)
			if (stepAcc >= STEP_STRIDE) {
				stepAcc = 0
				audio.play('step')
			}
		}
		bobAmt += ((moving ? 1 : 0) - bobAmt) * Math.min(1, dt * 8)
		const bobY = Math.sin(bobPhase * 2) * 0.03 * bobAmt

		camera.position.set(player.x, EYE + bobY, player.z)
		camera.rotation.set(player.pitch, player.yaw, 0)

		// ---- 眯眼：引擎侧驱动暗角，edge 触发 squintOn/Off 音效 ----
		pipeline.setSquint(input.squint)
		const squinting = input.squint > 0.5
		if (squinting !== wasSquinting) {
			audio.play(squinting ? 'squintOn' : 'squintOff')
			wasSquinting = squinting
		}

		// ---- NPC 动画 + 游戏逻辑（§9：game.update 后 input.consume）----
		for (const id of Object.keys(npcs)) npcs[id].update(dt, game)
		game.update(dt)

		pipeline.render(dt, camera)
		input.consume()
	})
}

void main()
