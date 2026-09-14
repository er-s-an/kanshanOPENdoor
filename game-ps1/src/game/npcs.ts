import * as THREE from 'three'
import type { GameAPI, NPCController } from '../engine/contract'

// ============================================================================
// NPC：思思（血裙鬼萝莉）与大 Boss（高瘦黑影）。
// 全部程序化几何（Lathe/球/柱/锥），状态动画为关键帧插值 + 正弦程序动画。
// 状态名严格对齐 CONTRACT.md §7；gameplay 只调 setState，细节动画在本文件内。
// ============================================================================

// ------------------------------ 小工具 --------------------------------------
const TAU = Math.PI * 2

function clamp(v: number, a: number, b: number): number {
  return v < a ? a : v > b ? b : v
}
function smooth(t: number): number {
  t = clamp(t, 0, 1)
  return t * t * (3 - 2 * t)
}
/** 帧率无关的指数平滑系数 */
function damp(k: number, dt: number): number {
  return 1 - Math.exp(-k * dt)
}
/** 角度插值（处理 ±π 回绕） */
function lerpAngle(a: number, b: number, t: number): number {
  let d = (b - a) % TAU
  if (d > Math.PI) d -= TAU
  if (d < -Math.PI) d += TAU
  return a + d * t
}
/** 锚点世界坐标；锚点缺失时退回原点（world agent 保证齐全，这里兜底防崩） */
function anchorPos(g: GameAPI, name: string, out: THREE.Vector3): THREE.Vector3 {
  const a = g.world.anchors[name]
  if (a) return a.getWorldPosition(out)
  return out.set(0, 0, 0)
}
/** 锚点在世界里的水平朝向（+Z 投影到 XZ），兜底 (0,0,1) */
function anchorYaw(g: GameAPI, name: string): number {
  const a = g.world.anchors[name]
  if (!a) return 0
  const d = a.getWorldDirection(new THREE.Vector3())
  return Math.atan2(d.x, d.z)
}
/** 玩家眼位（相机即眼睛，高约 1.6m） */
function playerPos(g: GameAPI, out: THREE.Vector3): THREE.Vector3 {
  return out.copy(g.engine.camera.position)
}
/** 玩家水平视线方向 */
function playerForward(g: GameAPI, out: THREE.Vector3): THREE.Vector3 {
  g.engine.camera.getWorldDirection(out)
  out.y = 0
  if (out.lengthSq() < 1e-6) out.set(0, 0, -1)
  return out.normalize()
}
/** 让 obj 只偏航指向 target（站立物体不抬头低头） */
function yawTo(obj: THREE.Object3D, target: THREE.Vector3): number {
  return Math.atan2(target.x - obj.position.x, target.z - obj.position.z)
}

// 复用的临时向量，避免每帧分配
const _v1 = new THREE.Vector3()
const _v2 = new THREE.Vector3()
const _v3 = new THREE.Vector3()
const _v4 = new THREE.Vector3()

// ============================================================================
// 思思：~1.1m 双马尾小女孩，红裙（湿漉漉血裙）/白裙双形态 + 血污脸/干净脸。
// 骨架层级：group(位置+偏航) > pose(俯仰/横滚：前扑、躺平、击飞翻转) >
//   头 pivot、双马尾 pivot×2、手臂 pivot×2、腿 pivot×2。
// ============================================================================
class Sisi implements NPCController {
  id = 'sisi'
  group = new THREE.Group()
  state = 'lunge' // 契约状态名；未激活前 group 隐藏

  // 思思从出场到同行始终使用同一套 1.1m 几何。远近造成的透视变化是叙事的一部分，
  // 不能用状态缩放去“补”画面，否则会读成她突然长大。
  private readonly modelScale = 1

  private pose = new THREE.Group()
  private head = new THREE.Group()
  private tailL = new THREE.Group()
  private tailR = new THREE.Group()
  private armL = new THREE.Group()
  private armR = new THREE.Group()
  private legL = new THREE.Group()
  private legR = new THREE.Group()
  private dress!: THREE.Mesh
  private blanket!: THREE.Mesh
  private drips: THREE.Mesh[] = []
  private eyes: THREE.Mesh[] = []
  private faceBlood!: THREE.Group
  private faceCute!: THREE.Group

  private matDressRed = new THREE.MeshLambertMaterial({ color: 0x7a1016, emissive: 0x1c0204 })
  private matDressWhite = new THREE.MeshLambertMaterial({ color: 0xe9e2d6, emissive: 0x141210 })
  private matSkin = new THREE.MeshLambertMaterial({ color: 0xe6e1dc }) // 冷白肤色
  private matHair = new THREE.MeshLambertMaterial({ color: 0x171216 })
  private matEye = new THREE.MeshLambertMaterial({ color: 0xd42438, emissive: 0x5a0a12 }) // 红瞳
  private matBlood = new THREE.MeshLambertMaterial({ color: 0x3f0708 })
  private matBlush = new THREE.MeshLambertMaterial({ color: 0xd98a92, transparent: true, opacity: 0.7 })
  private matShoe = new THREE.MeshLambertMaterial({ color: 0x2a2126 })

  private t = 0 // 当前状态经过时间
  private activated = false // gameplay 首次 setState 前保持隐藏
  private whiteDress = false
  private cleanFace = false
  private lungeSilhouette = false
  /** 门外拍门时记录走廊一侧，避免「扑来」的终点又落回门内。 */
  private lungeHallSide = new THREE.Vector3(0, 0, -1)
  /**
   * 门开瞬间锁定的扑击落点和看向目标。它们不随之后的相机移动更新：
   * 避免玩家在冻结/解冻交界时把小孩带到侧墙里，也保证红影会停在
   * 玩家与门之间，而不是越过玩家落到镜头背后。
   */
  private lungeCatchPos = new THREE.Vector3()
  private lungeLookPos = new THREE.Vector3()
  private holdingAtDoor = false

  // 期望姿态（每帧由状态函数填写，update 统一做平滑逼近）
  private desPos = new THREE.Vector3()
  private desYaw = 0
  private desPitch = 0
  private desRoll = 0
  // 四肢关节目标角度
  private T = { armLx: 0, armLz: 0.08, armRx: 0, armRz: -0.08, legLx: 0, legRx: 0, headYaw: 0, headPitch: 0 }

  // 各状态缓存
  private startPos = new THREE.Vector3() // lunge 起点 / thrown 起点
  private landPos = new THREE.Vector3() // changed/clean 落地点
  private napBed = new THREE.Vector3() // kidsBed 床面中心
  private napYaw = 0
  private glassPos = new THREE.Vector3() // 阳台玻璃目标点
  private flyDur = 0.6
  private phase = 0 // thrown: 0=飞行 1=落地散架 2=静止
  private impactT = 0
  private emitted = false

  constructor(private boss: Boss) {
    this.group.visible = false
    this.group.scale.setScalar(this.modelScale)
    this.buildBody()
    this.setDress(false)
    this.setFace(false)
    this.group.add(this.pose)
  }

  // --------------------------- 程序化建模 -------------------------------
  private buildBody(): void {
    // 连衣裙：Lathe 旋转成型（领口→肩→腰→裙摆），一件式罩住躯干到大腿
    const profile = [
      new THREE.Vector2(0.045, 0.8), // 领口
      new THREE.Vector2(0.1, 0.74), // 肩
      new THREE.Vector2(0.115, 0.62), // 腰
      new THREE.Vector2(0.17, 0.42),
      new THREE.Vector2(0.27, 0.1), // 裙摆
    ]
    this.dress = new THREE.Mesh(new THREE.LatheGeometry(profile, 12), this.matDressRed)
    this.pose.add(this.dress)

    // 裙摆下挂的几滴血（红裙专属，缓慢拉伸模拟滴血感）
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * TAU + 0.5
      const drip = new THREE.Mesh(new THREE.ConeGeometry(0.014, 0.06, 5), this.matBlood)
      drip.rotation.x = Math.PI // 尖端朝下
      drip.position.set(Math.sin(a) * 0.24, 0.06, Math.cos(a) * 0.24)
      this.pose.add(drip)
      this.drips.push(drip)
    }

    // 腿（裙下露出的一小段 + 鞋）
    for (const side of [-1, 1]) {
      const leg = side < 0 ? this.legL : this.legR
      leg.position.set(0.06 * side, 0.4, 0)
      const thigh = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.026, 0.34, 6), this.matSkin)
      thigh.position.y = -0.17
      const shoe = new THREE.Mesh(new THREE.SphereGeometry(0.042, 6, 5), this.matShoe)
      shoe.scale.set(1, 0.7, 1.5)
      shoe.position.set(0, -0.37, 0.02)
      leg.add(thigh, shoe)
      this.pose.add(leg)
    }

    // 手臂（肩 pivot，自然下垂为 0，rotation.x 为负则向前抬）
    for (const side of [-1, 1]) {
      const arm = side < 0 ? this.armL : this.armR
      arm.position.set(0.115 * side, 0.72, 0)
      const upper = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.022, 0.26, 6), this.matSkin)
      upper.position.y = -0.13
      const hand = new THREE.Mesh(new THREE.SphereGeometry(0.032, 6, 5), this.matSkin)
      hand.position.y = -0.28
      arm.add(upper, hand)
      this.pose.add(arm)
    }

    // 头（颈 pivot）：脸朝 +Z
    this.head.position.set(0, 0.8, 0)
    const skull = new THREE.Mesh(new THREE.SphereGeometry(0.135, 8, 6), this.matSkin)
    skull.position.y = 0.13
    const hairCap = new THREE.Mesh(
      new THREE.SphereGeometry(0.145, 8, 5, 0, TAU, 0, Math.PI * 0.6),
      this.matHair,
    )
    hairCap.position.set(0, 0.14, -0.012)
    this.head.add(skull, hairCap)
    // 红瞳（两种脸都保留）
    for (const side of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.02, 6, 5), this.matEye)
      eye.position.set(0.05 * side, 0.125, 0.122)
      this.head.add(eye)
      this.eyes.push(eye)
    }
    // 血污脸斑块（changed 前的默认脸）
    this.faceBlood = new THREE.Group()
    const stains: [number, number, number, number][] = [
      [0.055, 0.05, 0.118, 0.032],
      [-0.06, 0.09, 0.115, 0.024],
      [0.0, 0.215, 0.1, 0.028],
    ]
    for (const [x, y, z, r] of stains) {
      const s = new THREE.Mesh(new THREE.CircleGeometry(r, 6), this.matBlood)
      s.position.set(x, y, z)
      s.rotation.x = -0.25 // 近似贴球面
      this.faceBlood.add(s)
    }
    this.head.add(this.faceBlood)
    // 干净脸：红晕两团（可爱形态）
    this.faceCute = new THREE.Group()
    for (const side of [-1, 1]) {
      const b = new THREE.Mesh(new THREE.CircleGeometry(0.024, 6), this.matBlush)
      b.position.set(0.075 * side, 0.085, 0.112)
      b.rotation.x = -0.2
      this.faceCute.add(b)
    }
    this.head.add(this.faceCute)
    this.pose.add(this.head)

    // 双马尾（发根 pivot，可随动作摇摆）
    for (const side of [-1, 1]) {
      const tail = side < 0 ? this.tailL : this.tailR
      tail.position.set(0.12 * side, 0.2, -0.02)
      const strand = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.012, 0.36, 6), this.matHair)
      strand.position.y = -0.18
      const tip = new THREE.Mesh(new THREE.SphereGeometry(0.018, 5, 4), this.matHair)
      tip.position.y = -0.37
      tail.add(strand, tip)
      this.head.add(tail)
    }

    // 午睡用的小被子（仅 nap 可见）。注意平躺后本地 y→世界 -Z（沿身体），
    // 本地 z→世界 +Y（竖直），所以被子的长边沿本地 y、厚度沿本地 z。
    this.blanket = new THREE.Mesh(
      new THREE.BoxGeometry(0.46, 0.55, 0.09),
      new THREE.MeshLambertMaterial({ color: 0xc9a7b0 }),
    )
    this.blanket.position.set(0, 0.5, 0.12)
    this.blanket.visible = false
    this.pose.add(this.blanket)
  }

  private setDress(white: boolean): void {
    this.whiteDress = white
    this.dress.material = white ? this.matDressWhite : this.matDressRed
    for (const d of this.drips) d.visible = !white
  }
  private setFace(clean: boolean): void {
    this.cleanFace = clean
    this.faceBlood.visible = !clean && !this.lungeSilhouette
    this.faceCute.visible = clean && !this.lungeSilhouette
  }
  /** 门内首现先藏起五官，只留下红裙和双辫的模糊轮廓。 */
  private setLungeSilhouette(on: boolean): void {
    if (this.lungeSilhouette === on) return
    this.lungeSilhouette = on
    // gameplay 只依赖公共 group；用 userData 暴露「尚只是轮廓」而非私有实现细节。
    this.group.userData.lungeSilhouette = on
    this.faceBlood.visible = !on && !this.cleanFace
    this.faceCute.visible = !on && this.cleanFace
    for (const eye of this.eyes) eye.visible = !on
  }

  // --------------------------- setState ---------------------------------
  setState(state: string, g: GameAPI): void {
    const ok = ['lunge', 'held', 'changed', 'clean', 'nap', 'defend', 'thrown']
    if (!ok.includes(state)) {
      console.warn(`[sisi] 未知状态: ${state}`)
      return
    }
    const previousState = this.state
    this.state = state
    this.t = 0
    this.phase = 0
    this.impactT = 0
    this.emitted = false
    this.group.visible = true
    this.activated = true
    this.desRoll = 0
    this.desPitch = 0
    this.holdingAtDoor = state === 'held' && previousState === 'lunge' && g.flags.stage === 1
    if (state !== 'nap') this.blanket.visible = false // 离开 nap 收起被子
    this.setLungeSilhouette(state === 'lunge')

    const p = playerPos(g, _v1)
    const fwd = playerForward(g, _v2)

    switch (state) {
      case 'lunge': {
        // 门一开，先在门内雾光中给走廊侧的高度近视玩家一枚小小红影；
        // 再从同一位置跨过门槛扑近，不能从公主房穿过整套房子。
        const door = anchorPos(g, 'door', _v3)
        const doorToPlayer = _v4.set(p.x - door.x, 0, p.z - door.z)
        const insideDist = doorToPlayer.length()
        if (insideDist < 1e-4) doorToPlayer.set(0, 0, 1)
        else doorToPlayer.multiplyScalar(1 / insideDist)
        // 正常情况下玩家方向和门外走廊方向相同；但玩家可以站在门边斜着看。
        // 优先读取 doorExterior，使路径仍垂直穿过真正的门洞，而非按相机的斜向
        // 直线钻进侧墙。旧世界缺少此锚点时才退回玩家所在方向。
        this.lungeHallSide.copy(doorToPlayer)
        const exterior = g.world.anchors.doorExterior
        if (exterior) {
          exterior.getWorldPosition(_v2)
          _v2.y = 0
          _v2.sub(door)
          _v2.y = 0
          if (_v2.lengthSq() > 1e-4) this.lungeHallSide.copy(_v2.normalize())
        }
        // 起点反向放在门内，且至少离玩家 2.65m；门内冷光仍能勾出红裙轮廓。

        // 门洞只有约一米宽。把相机当下相对门洞的横向位置夹进安全通道，
        // 终点则留在门外一小步、朝门的方向（即玩家视线前方），而不是
        // p + hallSide 那种会越过玩家、跑到镜头后的写法。
        const laneRightX = -this.lungeHallSide.z
        const laneRightZ = this.lungeHallSide.x
        const laneOffset = clamp(
          (p.x - door.x) * laneRightX + (p.z - door.z) * laneRightZ,
          -0.22,
          0.22,
        )
        const catchHallOffset = clamp(insideDist - 0.16, 0.24, 0.82)
        this.lungeCatchPos.set(
          door.x + this.lungeHallSide.x * catchHallOffset + laneRightX * laneOffset,
          1.3,
          door.z + this.lungeHallSide.z * catchHallOffset + laneRightZ * laneOffset,
        )
        this.lungeLookPos.copy(p)

        // 起点与终点使用同一条门洞通道；内侧偏移只取一半，避免红影从侧墙
        // “钻出来”。后续 tick 不再读取实时玩家位置，整个扑击是可复现的。
        const insideOffset = Math.max(1.35, 2.65 - insideDist)
        this.startPos.set(
          door.x - this.lungeHallSide.x * insideOffset + laneRightX * laneOffset * 0.5,
          0,
          door.z - this.lungeHallSide.z * insideOffset + laneRightZ * laneOffset * 0.5,
        )
        this.group.position.copy(this.startPos)
        this.desPos.copy(this.startPos)
        this.desYaw = yawTo(this.group, this.lungeLookPos)
        this.group.rotation.y = this.desYaw
        this.desPitch = 0
        this.desRoll = 0
        break
      }
      case 'held':
        break // 位置每帧跟随相机
      case 'changed':
        this.setDress(true) // 白裙
        // 从怀抱放到玩家脚边
        this.landPos.set(p.x + fwd.x * 0.85, 0, p.z + fwd.z * 0.85)
        this.desPos.copy(this.landPos)
        break
      case 'clean':
        this.setDress(true)
        this.setFace(true) // 血污脸→可爱脸（红瞳保留）
        this.landPos.set(p.x + fwd.x * 0.85, 0, p.z + fwd.z * 0.85)
        this.desPos.copy(this.landPos)
        break
      case 'nap': {
        this.blanket.visible = true
        const bed = anchorPos(g, 'kidsBed', _v3)
        this.napBed.copy(bed)
        this.napYaw = anchorYaw(g, 'kidsBed')
        break
      }
      case 'defend':
        break // 站位每帧算（玩家与 Boss 之间）
      case 'thrown': {
        this.blanket.visible = false
        this.startPos.copy(this.group.position)
        const glass = anchorPos(g, 'balconyGlass', _v3)
        // 撞击点：玻璃锚点的水平位置，高度约胸口（0.95m）
        this.glassPos.set(glass.x, clamp(glass.y + 0.6, 0.8, 1.3), glass.z)
        const dist = Math.hypot(
          this.glassPos.x - this.startPos.x,
          this.glassPos.z - this.startPos.z,
        )
        this.flyDur = clamp(dist / 7.5, 0.45, 1.1) // 约 7.5m/s 的击飞速度
        break
      }
    }
  }

  // --------------------------- update -----------------------------------
  update(dt: number, g: GameAPI): void {
    if (!this.activated) return
    dt = Math.min(dt, 0.05)
    this.t += dt

    switch (this.state) {
      case 'lunge': this.tickLunge(dt, g); break
      case 'held': this.tickHeld(g); break
      case 'changed': this.tickStand(g, false); break
      case 'clean': this.tickStand(g, true); break
      case 'nap': this.tickNap(); break
      case 'defend': this.tickDefend(g); break
      case 'thrown': this.tickThrown(dt, g); break
    }

    // ---- 期望姿态 → 实际（指数平滑，帧率无关）----
    this.group.position.lerp(this.desPos, damp(14, dt))
    this.group.rotation.y = lerpAngle(this.group.rotation.y, this.desYaw, damp(10, dt))
    this.pose.rotation.x = lerpAngle(this.pose.rotation.x, this.desPitch, damp(10, dt))
    this.pose.rotation.z = lerpAngle(this.pose.rotation.z, this.desRoll, damp(10, dt))
    this.armL.rotation.x = lerpAngle(this.armL.rotation.x, this.T.armLx, damp(12, dt))
    this.armL.rotation.z = lerpAngle(this.armL.rotation.z, this.T.armLz, damp(12, dt))
    this.armR.rotation.x = lerpAngle(this.armR.rotation.x, this.T.armRx, damp(12, dt))
    this.armR.rotation.z = lerpAngle(this.armR.rotation.z, this.T.armRz, damp(12, dt))
    this.legL.rotation.x = lerpAngle(this.legL.rotation.x, this.T.legLx, damp(12, dt))
    this.legR.rotation.x = lerpAngle(this.legR.rotation.x, this.T.legRx, damp(12, dt))
    this.head.rotation.y = lerpAngle(this.head.rotation.y, this.T.headYaw, damp(8, dt))
    this.head.rotation.x = lerpAngle(this.head.rotation.x, this.T.headPitch, damp(8, dt))

    // 血滴缓慢拉伸（0.8~1.3 倍，湿裙滴血感）
    if (!this.whiteDress) {
      const s = 1 + 0.3 * Math.sin(this.t * 1.7)
      for (let i = 0; i < this.drips.length; i++) this.drips[i].scale.y = s + i * 0.12
    }
    // 双马尾随动作惯性摇摆
    const sway = clamp(-this.pose.rotation.x * 0.35, -0.5, 0.5)
    this.tailL.rotation.x = lerpAngle(this.tailL.rotation.x, sway + Math.sin(this.t * 3) * 0.08, damp(6, dt))
    this.tailR.rotation.x = this.tailL.rotation.x
    this.tailL.rotation.z = 0.15 + Math.sin(this.t * 2.3) * 0.06
    this.tailR.rotation.z = -0.15 - Math.sin(this.t * 2.3 + 1) * 0.06
  }

  /** lunge：门外模糊红影 → 蓄力下蹲 → 二次贝塞尔扑出 → 悬停掐脖 */
  private tickLunge(dt: number, g: GameAPI): void {
    void dt
    void g
    // setState('lunge') 已在门开启那一帧确定门洞通道和抓取点。绝不从每帧
    // 相机重新算 tx/tz，否则一次转头或移动就会让扑击落到玩家身后或侧墙内。
    const tx = this.lungeCatchPos.x
    const tz = this.lungeCatchPos.z
    const lookAt = this.lungeLookPos
    // 给玩家足够长的一拍，先在雾中辨认红色与双辫，再遭遇近距离扑击。
    // 0.62s 会被门的白闪、震屏和字幕吞掉；约一秒才是可感知的「看不清」。
    const revealDur = 1.05
    const dur = 0.55
    if (this.t < revealDur) {
      // 留出一瞥的时间：远处没有五官，只有湿红裙与双辫在雾里轻晃。
      this.setLungeSilhouette(true)
      this.desPos.set(this.startPos.x, Math.sin(this.t * 5.5) * 0.012, this.startPos.z)
      this.desYaw = yawTo(this.group, lookAt)
      this.desPitch = 0.02
      this.desRoll = Math.sin(this.t * 3.5) * 0.025
      this.T.armLx = this.T.armRx = 0
      this.T.armLz = 0.08
      this.T.armRz = -0.08
      this.T.legLx = this.T.legRx = 0
      this.T.headPitch = 0
      this.T.headYaw = 0
      return
    }
    this.setLungeSilhouette(false)
    const k = (this.t - revealDur) / dur
    if (k < 0.18) {
      // 蓄力：往后下方蹲
      const a = smooth(k / 0.18)
      const by = yawTo(this.group, lookAt)
      this.desPos.set(
        this.startPos.x - Math.sin(by) * 0.12 * a,
        -0.06 * a,
        this.startPos.z - Math.cos(by) * 0.12 * a,
      )
      this.desPitch = 0.22 * a
      this.desRoll = 0
      this.T.armLx = this.T.armRx = -0.5 * a // 手臂后摆
      this.T.armLz = 0.08
      this.T.armRz = -0.08
      this.T.legLx = this.T.legRx = 0.35 * a // 下蹲屈膝
    } else if (k < 1) {
      // 扑击：二次贝塞尔（起点→弧顶→玩家胸口）
      const kk = smooth((k - 0.18) / 0.82)
      const dist = Math.hypot(tx - this.startPos.x, tz - this.startPos.z)
      const arc = clamp(dist * 0.22, 0.3, 0.7)
      const mx = (this.startPos.x + tx) / 2
      const mz = (this.startPos.z + tz) / 2
      const my = Math.max(this.startPos.y, 1.32) / 2 + arc
      const a = 1 - kk
      this.desPos.set(
        a * a * this.startPos.x + 2 * a * kk * mx + kk * kk * tx,
        a * a * this.startPos.y + 2 * a * kk * my + kk * kk * 1.32,
        a * a * this.startPos.z + 2 * a * kk * mz + kk * kk * tz,
      )
      this.desYaw = yawTo(this.group, lookAt)
      this.desPitch = lerpAngle(0.22, -0.12, kk) // 前扑→微微后仰
      this.desRoll = 0
      this.T.armLx = this.T.armRx = lerpAngle(-0.5, -2.35, kk) // 双臂前伸掐脖
      this.T.armLz = 0.25
      this.T.armRz = -0.25
      this.T.legLx = this.T.legRx = 0.5 // 双腿后翘
    } else {
      // 掐住：悬停在她够得着的最高处，手抖 + 蹬腿
      this.desPos.set(tx, 1.3 + Math.sin(this.t * 2.5) * 0.015, tz)
      this.desYaw = yawTo(this.group, lookAt)
      this.desPitch = -0.06
      this.desRoll = 0
      const tremor = Math.sin(this.t * 42) * 0.05
      this.T.armLx = this.T.armRx = -2.35 + tremor
      this.T.armLz = 0.25 + tremor
      this.T.armRz = -0.25 - tremor
      this.T.legLx = 0.5 + Math.sin(this.t * 8) * 0.2
      this.T.legRx = 0.5 + Math.sin(this.t * 8 + Math.PI) * 0.2
    }
    this.T.headPitch = 0.1
    this.T.headYaw = 0
  }

  /**
   * held：门口的一拍过后，思思是地面上的侧跟伙伴，而非贴在镜头前的漂浮娃娃。
   * 在门洞尚未通过时先收在窄门洞一侧，避免斜穿侧墙；进屋后立刻回到
   * 相机左侧约 0.84m、略微靠前的自然同行位置。
   */
  private tickHeld(g: GameAPI): void {
    const cam = playerPos(g, _v1)
    const fwd = playerForward(g, _v2)
    if (this.holdingAtDoor) {
      const door = anchorPos(g, 'door', _v3)
      const side = (cam.x - door.x) * this.lungeHallSide.x + (cam.z - door.z) * this.lungeHallSide.z
      // 玩家已经跨过门槛后，恢复正常的侧跟位置。
      if (side < 0.08) this.holdingAtDoor = false
    }
    const amp = Math.exp(-this.t * 0.9) // 挣动幅度随时间衰减
    // 相机相对左侧：left = (-forward.z, 0, forward.x)。保持固定侧方距离，
    // 而非按状态缩放模型或把她固定在准星前，近视玩家转身时仍像同行的小孩。
    const leftX = -fwd.z
    const leftZ = fwd.x
    // 门洞宽约 1m；还在走廊时保留一个短暂的、偏左的门洞内位置，
    // 通过后才展开为完整 0.84m 侧跟，避免模型横穿门旁实墙。
    const sideDist = this.holdingAtDoor ? 0.34 : 0.84
    const forwardDist = this.holdingAtDoor ? 0.28 : 0.16
    const floorY = Math.max(0.02, cam.y - 1.58)
    this.desPos.set(
      cam.x + leftX * sideDist + fwd.x * forwardDist + Math.sin(this.t * 9) * 0.015 * amp,
      floorY + Math.sin(this.t * 7) * 0.012 * amp,
      cam.z + leftZ * sideDist + fwd.z * forwardDist,
    )
    this.desYaw = yawTo(this.group, cam) // 偏头看向玩家，不再脸贴脸悬空
    this.desRoll = Math.sin(this.t * 12) * 0.09 * amp
    this.desPitch = Math.sin(this.t * 10 + 1) * 0.06 * amp
    // 挣动：手脚小幅度踢打，渐止
    this.T.armLx = -0.3 + Math.sin(this.t * 10) * 0.5 * amp
    this.T.armRx = -0.3 + Math.sin(this.t * 10 + 2) * 0.5 * amp
    this.T.armLz = 0.2
    this.T.armRz = -0.2
    this.T.legLx = Math.sin(this.t * 11 + 1) * 0.6 * amp
    this.T.legRx = Math.sin(this.t * 11 + 3) * 0.6 * amp
    this.T.headYaw = Math.sin(this.t * 3) * 0.25 * amp
    this.T.headPitch = 0
  }

  /** changed/clean：落地站立，扭捏小动作（扯裙角、蹭脚、偷瞄玩家） */
  private tickStand(g: GameAPI, clean: boolean): void {
    const p = playerPos(g, _v1)
    this.desPos.set(this.landPos.x, 0, this.landPos.z)
    this.desYaw = yawTo(this.group, p)
    this.desRoll = Math.sin(this.t * 1.3) * 0.03 // 重心轻摆
    this.desPitch = 0
    if (clean) this.desPos.y = Math.abs(Math.sin(this.t * 2.8)) * 0.02 // 开心小跳
    // 扯裙角：双手垂在身前抓住裙摆，交替轻拽
    this.T.armLx = 0.55 + Math.sin(this.t * 2.1) * 0.08
    this.T.armRx = 0.55 + Math.sin(this.t * 2.1 + Math.PI) * 0.08
    this.T.armLz = 0.14 + Math.sin(this.t * 2.1) * 0.05
    this.T.armRz = -0.14 - Math.sin(this.t * 2.1 + Math.PI) * 0.05
    // 蹭脚：右脚尖周期性地向前轻蹭
    this.T.legRx = Math.max(0, Math.sin(this.t * 2.2)) * 0.28
    this.T.legLx = 0
    // 害羞偷瞄：头周期性偏向一侧
    this.T.headYaw = Math.sin(this.t * 0.55) * (clean ? 0.35 : 0.22)
    this.T.headPitch = 0.12
  }

  /** nap：飘到 kidsBed 上方 → 平躺落下 → 被子随呼吸起伏 */
  private tickNap(): void {
    // 平躺后身体沿锚点 -Z 摊开，脚端原点应放在床头反侧 0.42m 处
    const dirX = Math.sin(this.napYaw)
    const dirZ = Math.cos(this.napYaw)
    const bx = this.napBed.x + dirX * 0.42
    const bz = this.napBed.z + dirZ * 0.42
    const by = this.napBed.y + 0.09 // 床面高度
    if (this.t < 0.9) {
      // 飘着过去：悬在床上方 0.5m（入口位置由状态间平滑过渡过来）
      this.desPos.set(bx, by + 0.5, bz)
      this.desYaw = this.napYaw
      this.desPitch = 0
      this.desRoll = 0
    } else {
      // 落下平躺：身体绕 X 轴 -90°（脸朝上）
      const k = smooth((this.t - 0.9) / 0.6)
      this.desPos.set(bx, by + 0.5 * (1 - k), bz)
      this.desYaw = this.napYaw
      this.desPitch = -Math.PI / 2 * k
      this.desRoll = 0
      this.T.headPitch = -0.15 * k // 微微抬头，脸朝上
    }
    // 躺好后的放松姿态
    this.T.armLx = this.T.armRx = 0.15
    this.T.armLz = 0.3
    this.T.armRz = -0.3
    this.T.legLx = this.T.legRx = 0
    this.T.headYaw = 0
    // 被子呼吸起伏（约 2.4s 一个呼吸周期）：竖直方向是本地 z
    const breath = Math.sin(this.t * 2.6)
    this.blanket.scale.set(1 + 0.03 * breath, 1, 1 + 0.12 * breath)
    this.blanket.position.z = 0.12 + 0.012 * breath
  }

  /** defend：张臂挡在玩家与 Boss 之间，周期性回头看我方玩家 */
  private tickDefend(g: GameAPI): void {
    const p = playerPos(g, _v1)
    const boss = this.boss.group.position
    _v3.set(boss.x - p.x, 0, boss.z - p.z)
    let len = _v3.length()
    if (len < 0.01) {
      playerForward(g, _v3) // Boss 不在时兜底：挡在玩家视线前方
      len = 1
    } else {
      _v3.divideScalar(len)
    }
    const dist = Math.min(1.15, len * 0.4) // 偏玩家一侧
    this.desPos.set(p.x + _v3.x * dist, Math.abs(Math.sin(this.t * 7)) * 0.012, p.z + _v3.z * dist)
    this.desYaw = yawTo(this.group, boss) // 正面朝 Boss
    this.desPitch = 0
    this.desRoll = 0
    // 张臂
    this.T.armLx = this.T.armRx = -0.3
    this.T.armLz = 1.5 + Math.sin(this.t * 3) * 0.08
    this.T.armRz = -1.5 - Math.sin(this.t * 3) * 0.08
    this.T.legLx = this.T.legRx = 0
    // 回头：周期性把头转向玩家方向（相对自身朝向的夹角，限制在 ±1.0rad）
    const rel = clamp(lerpAngle(0, yawTo(this.group, p) - this.desYaw, 1), -1, 1)
    const glance = 0.5 + 0.5 * Math.sin(this.t * 1.6)
    this.T.headYaw = rel * glance
    this.T.headPitch = 0
  }

  /**
   * thrown：从 defend 位置被击飞，抛物线撞向阳台玻璃。
   * 飞行 = 水平匀速插值 + 竖直抛物线拱起；撞击瞬间 emit('sisiThrown')
   * 交给 gameplay 播碎玻璃音效，本类只负责飞行动画 + 落地散架。
   */
  private tickThrown(dt: number, g: GameAPI): void {
    if (this.phase === 0) {
      const k = clamp(this.t / this.flyDur, 0, 1)
      const sx = this.startPos.x
      const sy = this.startPos.y
      const sz = this.startPos.z
      const dist = Math.hypot(this.glassPos.x - sx, this.glassPos.z - sz)
      const arcH = clamp(dist * 0.22, 0.35, 1.1) // 拱起高度
      // 水平：起点→玻璃匀速；竖直：两端高度插值 + 4k(1-k) 抛物线拱起
      this.desPos.set(
        sx + (this.glassPos.x - sx) * k,
        sy + (this.glassPos.y - sy) * k + arcH * 4 * k * (1 - k),
        sz + (this.glassPos.z - sz) * k,
      )
      this.desYaw = Math.atan2(this.glassPos.x - sx, this.glassPos.z - sz)
      this.desPitch = -Math.PI * 1.25 * k // 前空翻
      this.desRoll = Math.sin(this.t * 25) * 0.3 // 惊慌乱转
      // 四肢狂舞
      this.T.armLx = Math.sin(this.t * 31) * 0.9 - 0.5
      this.T.armRx = Math.sin(this.t * 29 + 2) * 0.9 - 0.5
      this.T.legLx = Math.sin(this.t * 33 + 1) * 0.8
      this.T.legRx = Math.sin(this.t * 27 + 3) * 0.8
      if (k >= 1) {
        this.phase = 1
        this.impactT = 0
        if (!this.emitted) {
          this.emitted = true
          g.emit('sisiThrown') // gameplay 负责 play('glass') / play('thud')
        }
      }
    } else if (this.phase === 1) {
      // 落地散架：沿玻璃滑到地面，四肢错位 + 高频抖动后静止
      this.impactT += dt
      const it = this.impactT
      this.desPos.set(this.glassPos.x, Math.max(0.12, this.glassPos.y - it * 2.4), this.glassPos.z)
      this.desPitch = -Math.PI / 2 // 仰面躺下
      this.desRoll = 0.5 // 身体歪斜
      this.T.armLx = -2.6 // 手臂反折（错位感）
      this.T.armRx = -2.2
      this.T.armLz = 0.9
      this.T.armRz = -0.4
      this.T.legLx = -0.6 // 腿劈开
      this.T.legRx = 0.45
      this.T.headYaw = 0.6
      this.T.headPitch = 0.3
      if (it < 0.6) {
        // 撞击后 0.6s 内高频抖动，幅度线性衰减
        const a = (0.6 - it) / 0.6
        this.desRoll += Math.sin(it * 127.3) * 0.15 * a
        this.desPitch += Math.sin(it * 149.1) * 0.1 * a
        this.T.armLx += Math.sin(it * 171.7) * 0.3 * a
        this.T.legRx += Math.sin(it * 193.3) * 0.25 * a
      } else {
        this.phase = 2 // 静止：保持错位姿态不再更新
      }
    }
    // phase 2：完全静止的散架姿态
  }
}

// ============================================================================
// 大 Boss：2.2m 高瘦黑影。常态即无细节剪影——断头缝线（颈环+缝合线）、
// 过长手臂这些真身细节做成常显，但材质极暗，PS1 浓雾里看不清。
// ============================================================================
class Boss implements NPCController {
  id = 'boss'
  group = new THREE.Group()
  state = 'hidden'

  private pose = new THREE.Group()
  private head = new THREE.Group()
  private armL = new THREE.Group()
  private armR = new THREE.Group()
  private cloak!: THREE.Mesh
  private light: THREE.PointLight | null = null

  private matBody = new THREE.MeshLambertMaterial({ color: 0x0a0a10 }) // 近黑的剪影
  private matDetail = new THREE.MeshLambertMaterial({ color: 0x4a3c33 }) // 缝线（暗，凑近才可见）
  private matHead = new THREE.MeshLambertMaterial({ color: 0x07070b })

  private t = 0
  private arriveInit = false
  /** 移动意图点：按真实步速积分，身体再平滑追踪（避免平滑二次衰减步速） */
  private movePos = new THREE.Vector3()
  private desYaw = 0
  private desPitch = 0
  private desRoll = 0
  private T = { armLx: 0, armRx: 0, headYaw: 0, headPitch: 0 }

  constructor() {
    this.group.visible = false
    this.buildBody()
    this.group.add(this.pose)
  }

  private buildBody(): void {
    // 斗篷式躯干：肩窄、摆阔的高瘦轮廓
    const profile = [
      new THREE.Vector2(0.09, 2.16),
      new THREE.Vector2(0.155, 2.06),
      new THREE.Vector2(0.135, 1.75),
      new THREE.Vector2(0.15, 1.35),
      new THREE.Vector2(0.22, 0.72),
      new THREE.Vector2(0.36, 0.02), // 斗篷下摆
    ]
    this.cloak = new THREE.Mesh(new THREE.LatheGeometry(profile, 12), this.matBody)
    this.pose.add(this.cloak)

    // 头（颈 pivot），无面；比例拉长显得病态
    this.head.position.set(0, 2.02, 0)
    const skull = new THREE.Mesh(new THREE.SphereGeometry(0.105, 8, 6), this.matHead)
    skull.scale.set(0.9, 1.2, 0.95)
    skull.position.set(0, 0.13, 0.01)
    this.head.add(skull)
    // 脖子一圈缝线：暗色环 + 六道缝合线（真身细节，平时看不清）
    const seam = new THREE.Mesh(new THREE.TorusGeometry(0.08, 0.012, 5, 12), this.matDetail)
    seam.rotation.x = Math.PI / 2
    this.head.add(seam)
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * TAU
      const stitch = new THREE.Mesh(new THREE.BoxGeometry(0.034, 0.01, 0.014), this.matDetail)
      stitch.position.set(Math.cos(a) * 0.08, 0, Math.sin(a) * 0.08)
      stitch.rotation.y = -a
      stitch.rotation.z = i % 2 === 0 ? 0.35 : -0.35
      this.head.add(stitch)
    }
    this.pose.add(this.head)

    // 过长的手臂：垂到膝盖以下（肩 pivot）
    for (const side of [-1, 1]) {
      const arm = side < 0 ? this.armL : this.armR
      arm.position.set(0.2 * side, 1.98, 0)
      const limb = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.022, 1.0, 6), this.matBody)
      limb.position.y = -0.5
      const hand = new THREE.Mesh(new THREE.SphereGeometry(0.042, 6, 5), this.matBody)
      hand.position.y = -1.0
      arm.add(limb, hand)
      for (let f = 0; f < 2; f++) {
        const finger = new THREE.Mesh(new THREE.ConeGeometry(0.012, 0.08, 4), this.matBody)
        finger.position.set((f - 0.5) * 0.03, -1.06, 0.01)
        finger.rotation.x = Math.PI - 0.3 // 指向前下方
        arm.add(finger)
      }
      this.pose.add(arm)
    }
  }

  /** 压迫感冷色点光：arrive/confront 挂上，hidden 移除 */
  private setLight(on: boolean): void {
    if (on && !this.light) {
      this.light = new THREE.PointLight(0x8fb7ff, 2.2, 7, 2)
      this.light.position.set(0, 1.75, 0.35)
      this.group.add(this.light)
    } else if (!on && this.light) {
      this.group.remove(this.light)
      this.light = null
    }
  }

  setState(state: string, g: GameAPI): void {
    const ok = ['hidden', 'arrive', 'confront']
    if (!ok.includes(state)) {
      console.warn(`[boss] 未知状态: ${state}`)
      return
    }
    this.state = state
    this.t = 0
    switch (state) {
      case 'hidden':
        this.group.visible = false
        this.setLight(false)
        break
      case 'arrive': {
        this.group.visible = true
        this.setLight(true)
        if (!this.arriveInit) {
          // 首次现身：直接落在玄关门口锚点，面向屋内
          this.arriveInit = true
          const door = anchorPos(g, 'door', _v1)
          this.group.position.set(door.x, 0, door.z)
          const p = playerPos(g, _v2)
          this.group.rotation.y = yawTo(this.group, p)
        }
        this.movePos.copy(this.group.position)
        break
      }
      case 'confront':
        this.group.visible = true
        this.setLight(true)
        this.movePos.copy(this.group.position)
        break
    }
  }

  update(dt: number, g: GameAPI): void {
    if (!this.group.visible) return
    dt = Math.min(dt, 0.05)
    this.t += dt
    const p = playerPos(g, _v1)

    if (this.state === 'arrive') {
      // 压迫感步态：慢速逼近，摇晃 + 起伏（斗篷遮腿，整体幽灵式滑动）
      _v2.set(p.x - this.movePos.x, 0, p.z - this.movePos.z)
      const d = _v2.length()
      if (d > 2.55) {
        // 意图点按真实步速积分，身体追踪不会被平滑二次减速
        this.movePos.x += (_v2.x / d) * 0.32 * dt
        this.movePos.z += (_v2.z / d) * 0.32 * dt
      }
      this.desYaw = yawTo(this.group, p)
      this.desRoll = Math.sin(this.t * 2.0) * 0.045 // 摇晃
      this.desPitch = 0.06 // 前倾
      this.T.armLx = Math.sin(this.t * 2.0) * 0.14
      this.T.armRx = -Math.sin(this.t * 2.0) * 0.14
      this.T.headYaw = 0
      this.T.headPitch = 0.08
      if (this.light) this.light.intensity = 2.0 + (Math.sin(this.t * 47) > 0.96 ? -0.9 : 0) // 偶发闪烁
    } else if (this.state === 'confront') {
      // 停在玩家面前 1.5m，低头俯视微晃，斗篷/烟感摆动
      const fwd = playerForward(g, _v3)
      const tx = p.x + fwd.x * 1.5
      const tz = p.z + fwd.z * 1.5
      _v2.set(tx - this.movePos.x, 0, tz - this.movePos.z)
      const d = _v2.length()
      if (d > 0.06) {
        const step = Math.min(0.6 * dt, d)
        this.movePos.x += (_v2.x / d) * step
        this.movePos.z += (_v2.z / d) * step
      }
      this.desYaw = yawTo(this.group, p)
      this.desRoll = Math.sin(this.t * 0.9) * 0.03
      this.desPitch = 0.03
      this.T.armLx = -0.2 + Math.sin(this.t * 0.7) * 0.06 // 缓慢曲张的手
      this.T.armRx = -0.2 + Math.sin(this.t * 0.7 + 1) * 0.06
      this.T.headYaw = Math.sin(this.t * 0.5) * 0.06
      this.T.headPitch = 0.3 + Math.sin(this.t * 0.8) * 0.025 // 低头俯视
      if (this.light) {
        this.light.intensity = 2.2 + 0.5 * Math.sin(this.t * 2.2) + (Math.sin(this.t * 53) > 0.95 ? -1.0 : 0)
      }
    }

    // 期望姿态 → 实际
    this.group.position.lerp(this.movePos, damp(8, dt))
    this.group.rotation.y = lerpAngle(this.group.rotation.y, this.desYaw, damp(4, dt))
    this.pose.rotation.x = lerpAngle(this.pose.rotation.x, this.desPitch, damp(6, dt))
    this.pose.rotation.z = lerpAngle(this.pose.rotation.z, this.desRoll, damp(6, dt))
    this.armL.rotation.x = lerpAngle(this.armL.rotation.x, this.T.armLx, damp(6, dt))
    this.armR.rotation.x = lerpAngle(this.armR.rotation.x, this.T.armRx, damp(6, dt))
    this.head.rotation.y = lerpAngle(this.head.rotation.y, this.T.headYaw, damp(5, dt))
    this.head.rotation.x = lerpAngle(this.head.rotation.x, this.T.headPitch, damp(5, dt))
    // 斗篷烟感摆动
    this.cloak.rotation.z = Math.sin(this.t * 1.3) * 0.02
  }
}

// ============================================================================
export function createNPCs(scene: THREE.Scene): Record<string, NPCController> {
  const boss = new Boss()
  const sisi = new Sisi(boss) // defend 需要读 Boss 的位置
  scene.add(sisi.group)
  scene.add(boss.group)
  return { sisi, boss }
}
