import * as THREE from 'three'

/**
 * 惊悚值封装（§4）：0..100，clamp；到 100 由 Game.update 判死。
 * reason 仅用于调试日志。
 */
export class FearMeter {
  value = 0

  add(n: number, reason?: string): void {
    if (reason && n !== 0) {
      // eslint-disable-next-line no-console
      console.debug(`[惊悚] ${n > 0 ? '+' : ''}${n}（${reason}）→ ${Math.round(this.value + n)}`)
    }
    this.value = clampFear(this.value + n)
  }

  set(n: number): void {
    this.value = clampFear(n)
  }

  /** 是否已到 100（立即死亡线） */
  get full(): boolean {
    return this.value >= 100
  }
}

const clampFear = (n: number): number => Math.max(0, Math.min(100, n))

// ---------------------------------------------------------------------------
// 恐怖凝视判定（§4 纯函数）
// 眯眼（squinting）时，视野中心 ±10° 内出现「真身目标」→ 惊悚 +3/秒。
// 目标点位由 game 层用 boss/sisi 的 group.position 与 wallStain 锚点实时提供。
// ---------------------------------------------------------------------------

export type GazeTargetKind = 'boss' | 'sisi' | 'stain'

export interface GazeCandidate {
  kind: GazeTargetKind
  position: THREE.Vector3
}

const VIEW_HALF_ANGLE = (10 * Math.PI) / 180

// 复用临时向量，避免每帧分配（单线程逐帧调用，安全）
const _forward = new THREE.Vector3()
const _toTarget = new THREE.Vector3()

/**
 * 纯函数：返回当前被「恐怖凝视」锁定的目标；没有则返回 null。
 * @param squinting 本帧是否眯眼（input.squint > 0.5）
 * @param candidates 候选目标（game 层已按规则筛好：boss 可见、思思血裙态、凑近的血渍）
 */
export function findHorrorGaze(
  camera: THREE.PerspectiveCamera,
  squinting: boolean,
  candidates: readonly GazeCandidate[],
): GazeCandidate | null {
  if (!squinting || candidates.length === 0) return null
  camera.getWorldDirection(_forward)
  for (const c of candidates) {
    _toTarget.copy(c.position).sub(camera.position)
    if (_toTarget.lengthSq() < 1e-8) continue
    if (_forward.angleTo(_toTarget) <= VIEW_HALF_ANGLE) return c
  }
  return null
}
