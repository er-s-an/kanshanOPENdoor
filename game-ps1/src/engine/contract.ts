// ============================================================================
// SHARED CONTRACT — 所有模块按本文件对接。任何 agent 不得修改本文件；
// 若发现契约缺东西，在自己模块内做兼容处理，并在 PR 备注里说明。
// ============================================================================
import type * as THREE from 'three'

// ------------------------------ World --------------------------------------
export interface Interactable {
  id: string
  /** 交互锚点的世界坐标（与玩家距离判定用） */
  position: THREE.Vector3
  /** 可交互半径（米） */
  radius: number
  /** 靠近时 HUD 显示的提示，如「给她换衣服」 */
  prompt: string
  /** 可选：返回 false 时该交互项不显示、不可触发 */
  available?: (g: GameAPI) => boolean
  onInteract: (g: GameAPI) => void
}

export interface WorldData {
  group: THREE.Group
  /** 静态碰撞盒（玩家不可穿越的 AABB，含墙体、大家具） */
  colliders: THREE.Box3[]
  /** 玩家出生点（当前剧情场景；首章从楼外前庭开始） */
  spawn: THREE.Vector3
  /** 初始朝向（弧度，绕 Y 轴） */
  yaw: number
  /** 命名锚点，见 CONTRACT.md；NPC 摆放与任务脚本都依赖这些名字 */
  anchors: Record<string, THREE.Object3D>
}

// ------------------------------ NPC ----------------------------------------
export interface NPCController {
  id: string
  group: THREE.Group
  /** 当前状态名（语义见 CONTRACT.md 的 NPC 状态表） */
  state: string
  setState(state: string, g: GameAPI): void
  update(dt: number, g: GameAPI): void
}

// ------------------------------ Engine -------------------------------------
export type SoundName =
  | 'doorCreak' | 'step' | 'sting' | 'ui'
  | 'squintOn' | 'squintOff' | 'thud' | 'glass' | 'kiss' | 'bell'

export interface InputAPI {
  /** -1..1，A/D 或左右摇杆 */
  readonly moveX: number
  /** -1..1，W/S；W 为 +1 前进 */
  readonly moveZ: number
  /** 自上一帧以来的视角增量（像素），每帧由引擎消费 */
  readonly lookDX: number
  readonly lookDY: number
  /** E 键 / 触屏点按：边沿触发，每帧消费一次 */
  readonly interactPressed: boolean
  /** 眯眼键（右键或 Q 按住）：0..1 */
  readonly squint: number
  /** 每帧末尾由主循环调用，清边沿状态 */
  consume(): void
}

export interface AudioAPI {
  /** 播放一次性音效 */
  play(name: SoundName): void
  /** 0..1，驱动心跳强度；游戏循环每帧调用 */
  setFear(fear01: number): void
  /** 启动环境音（低频嗡鸣 + 风），只调一次 */
  startAmbience(): void
}

export interface PS1API {
  /**
   * 近视模糊强度 0..1（语义以 CONTRACT §4 为准）：
   * 0 = 眯眼后的短暂清晰；0.35 = 日常高度近视（约 3 米外雾里看花）；
   * 0.55 = 午睡惊醒后加重；1 = 完全眯死（远处几乎不可见）。
   */
  setMyopia(amount01: number): void
  /** 白屏闪烁（穿越/过场用） */
  flashWhite(ms?: number): void
  /** 震屏 */
  shake(strength?: number, ms?: number): void
}

export interface EngineAPI {
  renderer: THREE.WebGLRenderer
  scene: THREE.Scene
  camera: THREE.PerspectiveCamera
  input: InputAPI
  audio: AudioAPI
  ps1: PS1API
}

// ------------------------------ Gameplay -----------------------------------
export interface EndingDef {
  id: string
  title: string
  subtitle: string
  tone: 'good' | 'bad' | 'secret'
}

export interface GameAPI {
  engine: EngineAPI
  world: WorldData
  npcs: Record<string, NPCController>
  /** 主循环每帧调用（引擎负责移动/相机后调用），dt 秒 */
  update(dt: number): void
  /** 启动游戏脚本（开场播报 → 任务链）；由 main.ts 在一切就绪后调用一次 */
  start(): Promise<void>
  /** 惊悚值 0..100；100 即死（gameplay 层负责判死并进入 bad ending） */
  fear: { value: number; add(n: number, reason?: string): void; set(n: number): void }
  /** 任务间共享的标记位 */
  flags: Record<string, number | boolean | string>
  /** 字幕；返回的 Promise 在打满或玩家跳过后 resolve */
  say(speaker: string, text: string, msPerChar?: number): Promise<void>
  /** 系统机械音播报（大字横幅 + 打字机）；resolve 于播完或跳过 */
  sys(lines: string[]): Promise<void>
  /** 分支选项弹窗；resolve 为所选 option 的 id */
  prompt(options: { id: string; label: string }[], title?: string): Promise<string>
  addInteractable(i: Interactable): void
  removeInteractable(id: string): void
  /** 简单事件总线：'nap' | 'bossHome' | 'sisiThrown' | 'confront' 等 */
  on(ev: string, fn: (data?: unknown) => void): void
  emit(ev: string, data?: unknown): void
  /** 进入结局页 */
  end(endingId: string): Promise<void>
}
