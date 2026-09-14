import type * as THREE from 'three'
import type { GameAPI, Interactable } from '../engine/contract'

/**
 * XZ 平面距离（米）。世界锚点多在地表/家具高度，与相机眼高（1.6m）无关，
 * 交互与「凑近」判定统一用水平距离，避免 y 轴抬高误差。
 */
export function distanceXZ(a: THREE.Vector3, b: THREE.Vector3): number {
  const dx = a.x - b.x
  const dz = a.z - b.z
  return Math.sqrt(dx * dx + dz * dz)
}

/**
 * 每帧调用：在 interactables 中找离 from（相机）最近、半径内、且 available 通过的一项。
 * 无可用项返回 null。available 返回 false 时该交互既不显示也不可触发（§3 顺序门控）。
 */
export function findNearestInteractable(
  g: GameAPI,
  items: Iterable<Interactable>,
  from: THREE.Vector3,
): Interactable | null {
  let best: Interactable | null = null
  let bestDist = Infinity
  for (const it of items) {
    if (it.available && !it.available(g)) continue
    const d = distanceXZ(from, it.position)
    if (d <= it.radius && d < bestDist) {
      best = it
      bestDist = d
    }
  }
  return best
}
