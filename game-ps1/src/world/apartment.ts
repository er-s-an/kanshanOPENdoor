// ============================================================================
// world/apartment.ts — 30 层「死亡之家」大平层（约 12×9m，净高 2.8m）
//
// 户型（北 -z / 南 +z / 东 +x）：
//   玄关(北, z<-2.8) → 客厅(中央开放区) → 阳台(南, z>3.4, 玻璃推拉门封闭)
//   公主房(西北, x<-3)   浴室(东北, x>3)   厨房角(东南小吧台)
// 锚点见 CONTRACT.md §6；door/wallStain/floorArea 的 userData 供 gameplay 演出。
// ============================================================================
import * as THREE from 'three'
import type { WorldData } from '../engine/contract'
import {
  MAT, bx, cyl, floorBlob, blobMesh,
  makeSofa, makeFloorLamp, makeCoffeeTable, makeTVStand, makeKidsBed,
  makeWardrobe, makeToys, makeCabinet, makeMop, makeToilet, makeTub,
  makeBarCounter, makeStool, makeEntryDoor, makeBalconyGlass,
  makeCeilingFixture, makeMoonCity, makeStain,
} from './kit'

export async function buildWorld(scene: THREE.Scene): Promise<WorldData> {
  const group = new THREE.Group()
  group.name = 'world'
  const colliders: THREE.Box3[] = []
  const anchors: Record<string, THREE.Object3D> = {}

  // ------------------------------ 工具 --------------------------------------
  const solid = (cx: number, cy: number, cz: number, sx: number, sy: number, sz: number): THREE.Box3 => {
    const box = new THREE.Box3(
      new THREE.Vector3(cx - sx / 2, cy - sy / 2, cz - sz / 2),
      new THREE.Vector3(cx + sx / 2, cy + sy / 2, cz + sz / 2),
    )
    colliders.push(box)
    return box
  }
  const addWall = (cx: number, cz: number, sx: number, sz: number, h = 2.8, mat: THREE.Material = MAT.wall) => {
    bx(group, sx, h, sz, mat, cx, 0, cz)
    solid(cx, h / 2, cz, sx, h, sz)
  }
  const anchor = (name: string, x: number, y: number, z: number): THREE.Object3D => {
    const o = new THREE.Object3D()
    o.name = `anchor_${name}`
    o.position.set(x, y, z)
    group.add(o)
    anchors[name] = o
    return o
  }

  // ========================================================================
  // 室外前庭：女主刚进入副本时实际站立的地方。它与 30 层走廊是两个
  // 独立、可由剧情转场连接的安全空间；不把未被原文证实的建筑事件写死在
  // 几何里。远处只有高楼的模糊轮廓，正好让高度近视在开局就有可感知对象。
  // ========================================================================
  bx(group, 12, 0.08, 10, MAT.floorBase, 0, -0.08, -16)

  // 北端是高楼正面。厚实的碰撞面避免玩家在迷雾里穿出可见世界；立面和
  // 后方的低多边形塔楼都只用现有程序化积木生成。
  // 立面直接使用墙皮材质。此前叠放一片零厚度感的装饰板，和实体立面的
  // 正面共面，会在低清深度缓冲里闪烁。
  addWall(0, -20.72, 12, 0.38, 8.4, MAT.wall)
  for (const x of [-3.2, -1.6, 1.6, 3.2]) {
    bx(group, 0.14, 7.2, 0.12, MAT.trim, x, 0.45, -20.42)
  }
  // 不带文字的门厅/电梯凹口；剧情层可把 entryElevator 当成转场触发点。
  bx(group, 2.15, 2.45, 0.16, MAT.metal, 0, 0, -20.34)
  bx(group, 0.08, 2.28, 0.035, MAT.frame, 0, 0.08, -20.22)
  bx(group, 0.46, 0.18, 0.035, MAT.screen, 0, 2.55, -20.22)
  bx(group, 0.14, 0.05, 0.03, MAT.bulbCold, -0.1, 2.615, -20.18)
  bx(group, 0.14, 0.05, 0.03, MAT.bulbCold, 0.1, 2.615, -20.18)

  // 两侧/南侧是低矮的庭院边界，而不是一堵近距离高墙；仍保留 AABB，避免
  // 玩家误走到尚未被剧情接入的中间空白区。
  addWall(-6, -16, 0.12, 10, 1.1, MAT.metal)
  addWall(6, -16, 0.12, 10, 1.1, MAT.metal)
  addWall(0, -11.04, 12, 0.12, 1.1, MAT.metal)
  for (const x of [-5, -3, -1, 1, 3, 5]) {
    cyl(group, 0.025, 0.025, 0.72, MAT.metal, x, 1.1, -11.0, 6)
  }

  // 远景不参与碰撞：它们只是雾后低多边形楼影，不暗示可抵达的第二个场景。
  for (const [x, z, w, h] of [
    [-7.6, -23.4, 2.2, 7.5], [-5.8, -24.5, 1.6, 10.5],
    [5.8, -24.0, 1.8, 8.8], [7.4, -23.0, 2.5, 6.4],
  ] as const) {
    bx(group, w, h, 1.4, MAT.city, x, 0, z)
  }

  // 这些锚点不承载预写叙述，只提供 gameplay 把规则、选层与电梯转场做成
  // 可交互步骤时的稳定世界坐标。
  anchor('entryRules', -1.7, 1.15, -17.35)
  anchor('entrySelect', 1.7, 1.15, -17.35)
  anchor('entryElevator', 0, 1.2, -20.04)

  // 只作为开场中可辨认的人群轮廓，不注册碰撞或交互。两位站得较稳的成人
  // 贴近规则锚点，另两位更远、更缩着身子；玩家靠近后才会从雾里分辨出差异。
  const makeForecourtSilhouette = (
    x: number,
    z: number,
    height: number,
    bodyMat: THREE.Material,
    lean = 0,
    hunch = 0,
  ): void => {
    const figure = new THREE.Group()
    figure.name = 'forecourt_silhouette'
    figure.position.set(x, 0, z)
    figure.rotation.z = lean
    const bodyH = height * 0.58
    cyl(figure, height * 0.1, height * 0.14, bodyH, bodyMat, 0, 0, 0, 6)
    const head = new THREE.Mesh(new THREE.IcosahedronGeometry(height * 0.105, 0), MAT.gray)
    head.position.set(0, bodyH + height * 0.12 - hunch * height * 0.04, 0)
    figure.add(head)
    // 一侧垂下、另一侧略收起的双臂，让四个剪影不读成规则的路桩。
    for (const side of [-1, 1]) {
      const arm = new THREE.Mesh(
        new THREE.CylinderGeometry(height * 0.025, height * 0.03, height * 0.36, 5),
        bodyMat,
      )
      arm.position.set(side * height * 0.12, bodyH * 0.72, 0)
      arm.rotation.z = side * (0.14 + hunch * 0.22)
      figure.add(arm)
    }
    if (hunch > 0) figure.rotation.x = hunch * 0.18
    group.add(figure)
  }
  // 近处两位成人体量和姿态不同，形成可接近的“规则说明者”视觉重心。
  makeForecourtSilhouette(-2.45, -17.72, 1.78, MAT.woodDark, -0.025)
  makeForecourtSilhouette(-0.92, -17.88, 1.62, MAT.fabric2, 0.045, 0.12)
  // 远处两位不安的人群轮廓不承担人物身份，只加强“刚进入副本的人很多”的空间感。
  makeForecourtSilhouette(2.35, -18.62, 1.35, MAT.gray, -0.16, 0.72)
  makeForecourtSilhouette(3.72, -17.62, 1.12, MAT.trim, 0.12, 0.9)

  const forecourtL = new THREE.PointLight(0x667f9c, 5.2, 12, 2)
  forecourtL.position.set(0, 3.2, -16.3)
  group.add(forecourtL)
  const entranceL = new THREE.PointLight(0x8d1e2c, 6.5, 7, 2)
  entranceL.position.set(0, 2.5, -19.6)
  group.add(entranceL)

  // ========================================================================
  // 30 层走廊：一梯一户。这里与室外前庭分离，等待剧情在选层后把玩家送到
  // hallSpawn；既可让玩家用气味/温度/墙面认识走廊，也不会改变室内任务锚点。
  // ========================================================================
  bx(group, 6.4, 0.06, 3.9, MAT.floorBase, 0, -0.06, -6.45)
  // 天花略高于墙顶，避免底面与墙帽共面。
  bx(group, 6.4, 0.06, 3.9, MAT.ceiling, 0, 2.81, -6.45)
  addWall(-3.2, -6.45, 0.12, 3.9, 2.8, MAT.fabric2)
  addWall(3.2, -6.45, 0.12, 3.9, 2.8, MAT.fabric2)
  addWall(0, -8.4, 6.4, 0.12, 2.8, MAT.fabric2)

  // 北端的通用电梯门：没有凭空添加楼号剧情，只把“30”作为空间导向。
  bx(group, 1.82, 2.1, 0.085, MAT.metal, 0, 0, -8.29)
  bx(group, 0.075, 2.0, 0.035, MAT.frame, 0, 0.05, -8.235)
  bx(group, 2.02, 0.11, 0.12, MAT.frame, 0, 2.02, -8.25)
  bx(group, 0.56, 0.23, 0.035, MAT.screen, 0, 2.2, -8.205)
  const digit = (x: number, y: number, horizontal: boolean) =>
    bx(group, horizontal ? 0.15 : 0.028, horizontal ? 0.028 : 0.14, 0.025, MAT.bulbCold, x, y, -8.175)
  // 七段数码“30”，让玩家即使在雾里也能通过靠近/眯眼辨认楼层。
  for (const [x, y, horizontal] of [
    [-0.13, 2.37, true], [-0.045, 2.27, false], [-0.045, 2.10, false],
    [-0.13, 2.08, true], [-0.215, 2.19, false],
    [0.13, 2.37, true], [0.215, 2.27, false], [0.215, 2.10, false],
    [0.13, 2.08, true], [0.045, 2.27, false], [0.045, 2.10, false],
  ] as const) digit(x, y, horizontal)

  const hallSpawn = anchor('hallSpawn', 0, 1.6, -6.9)
  // arrivalSpawn 是转场调用方可读的同位置语义别名，避免把“到达 30 层”写死
  // 在 main/game 中。
  const arrivalSpawn = anchor('arrivalSpawn', 0, 1.6, -6.9)
  arrivalSpawn.userData.sameAs = hallSpawn.name
  anchor('hallAir', 0, 1.2, -6.55)
  anchor('hallWall', -2.92, 1.2, -6.2)
  anchor('doorExterior', 0, 1.2, -4.82)

  const hallRedL = new THREE.PointLight(0x741d2a, 4.8, 6.5, 2)
  hallRedL.position.set(0, 2.28, -6.15)
  group.add(hallRedL)
  const liftColdL = new THREE.PointLight(0x93afd0, 3.4, 4.3, 2)
  liftColdL.position.set(0, 2.15, -7.95)
  group.add(liftColdL)

  // ------------------------------ 地面 / 天花 -------------------------------
  bx(group, 12, 0.06, 7.9, MAT.floorBase, 0, -0.06, -0.55) // 整屋基底 z[-4.5,3.4]
  // 各功能地面离整屋基底抬起 4mm，避免两个大平面共面而产生 z-fighting。
  bx(group, 3.0, 0.03, 4.4, MAT.floorPink, -4.5, 0.004, -0.6) // 公主房
  bx(group, 3.0, 0.03, 3.6, MAT.floorBath, 4.5, 0.004, -1.0) // 浴室
  bx(group, 6.0, 0.03, 6.2, MAT.floorBlood, 0, 0.004, 0.3) // 客厅血迹红地板（可拖净）
  bx(group, 12, 0.06, 7.9, MAT.ceiling, 0, 2.81, -0.55) // 封天花
  bx(group, 12, 0.12, 1.1, MAT.floorBase, 0, -0.12, 3.95) // 阳台板

  // ------------------------------ 墙体 --------------------------------------
  // 外墙（北门留门洞 x[-0.5,0.5]）
  addWall(-3.25, -4.5, 5.5, 0.12)
  addWall(3.25, -4.5, 5.5, 0.12)
  addWall(-6, 0, 0.12, 9)
  addWall(6, 0, 0.12, 9)
  // 南墙：玻璃两侧实体段（x[-6,-4.2] / [4.2,6]）
  addWall(-5.1, 3.4, 1.8, 0.12)
  addWall(5.1, 3.4, 1.8, 0.12)
  // 阳台女儿墙（矮墙，之上有铁栏杆）
  addWall(0, 4.5, 12, 0.12, 1.1)
  // 玄关/客厅分户墙（中央开口 x[-1.4,1.4]）
  addWall(-3.7, -2.8, 4.6, 0.1, 2.8, MAT.wallInner)
  addWall(3.7, -2.8, 4.6, 0.1, 2.8, MAT.wallInner)
  // 公主房东墙（门洞 z[-0.4,0.6]）
  addWall(-3, -1.6, 0.1, 2.4, 2.8, MAT.wallInner)
  addWall(-3, 1.1, 0.1, 1.0, 2.8, MAT.wallInner)
  // 浴室西墙（门洞 z[-1.8,-1.0]）
  addWall(3, -2.3, 0.1, 1.0, 2.8, MAT.wallInner)
  addWall(3, -0.1, 0.1, 1.8, 2.8, MAT.wallInner)
  // 公主房南墙
  addWall(-4.5, 1.6, 3.0, 0.1, 2.8, MAT.wallInner)
  // 浴室南墙：此前这个面缺失，浴缸会直接暴露到厨房角，房间读起来像一块
  // 穿帮的开放式地台。浴室门仍保留在西侧、从客厅进入。
  addWall(4.5, 0.84, 3.0, 0.1, 2.8, MAT.wallInner)
  // 门洞上沿过梁（仅视觉）
  bx(group, 0.14, 0.75, 1.1, MAT.trim, -3, 2.05, 0.1)
  bx(group, 0.14, 0.75, 1.0, MAT.trim, 3, 2.05, -1.4)

  // ------------------------------ 玄关（北） --------------------------------
  const door = makeEntryDoor()
  door.frame.position.set(0, 0, -4.5)
  door.leaf.position.set(-0.47, 0, -4.5)
  group.add(door.frame, door.leaf)
  // 门的阻挡盒须是 colliders 里的同一个对象：开门剧情可在思思扑击完成后
  // 将其移除，让外侧出生的玩家真正穿过门槛，而非被不可见的静态盒卡住。
  const doorCollider = solid(0, 1.05, -4.5, 1.0, 2.1, 0.14) // 门（出生时关着）
  bx(group, 0.9, 0.02, 0.5, MAT.trim, 0, 0.005, -4.05) // 门垫
  const doorA = anchor('door', 0, 1.2, -4.32)
  doorA.userData.doorMesh = door.leaf
  doorA.userData.doorCollider = doorCollider

  // ------------------------------ 客厅（中央） ------------------------------
  const sofa = makeSofa()
  sofa.position.set(-2.1, 0, 1.2)
  sofa.rotation.y = Math.PI / 2 // 面向 +x（电视）
  group.add(sofa)
  solid(-2.1, 0.45, 1.2, 0.95, 0.9, 2.2)

  const table = makeCoffeeTable()
  table.position.set(0.4, 0, 1.3)
  group.add(table)
  solid(0.4, 0.25, 1.3, 0.95, 0.5, 0.6)

  const tv = makeTVStand()
  tv.position.set(2.55, 0, 1.2)
  tv.rotation.y = -Math.PI / 2 // 屏幕面向 -x（沙发）
  group.add(tv)
  solid(2.55, 0.65, 1.2, 0.55, 1.3, 1.35)

  const lamp = makeFloorLamp()
  lamp.position.set(-2.55, 0, 2.32)
  group.add(lamp)
  solid(-2.55, 0.8, 2.32, 0.36, 1.6, 0.36)

  // 沙发上的手机（玩家群消息要点）
  const phoneG = new THREE.Group()
  bx(phoneG, 0.07, 0.012, 0.14, MAT.woodDark, 0, 0, 0)
  bx(phoneG, 0.058, 0.004, 0.12, MAT.phoneScr, 0, 0.012, 0)
  phoneG.position.set(-1.9, 0.565, 1.82)
  phoneG.rotation.y = 0.5
  group.add(phoneG)
  anchor('sofa', -1.5, 0.5, 1.2)
  anchor('phone', -1.9, 0.58, 1.82)

  // 客厅血地板上的深色血斑（gameplay 拖净后可隐藏）
  const bloodDecals: THREE.Mesh[] = []
  const decalDefs: [number, number, number, number][] = [
    [-0.5, 0.6, 0.55, 11], [0.6, 0.1, 0.4, 22], [-1.2, -0.5, 0.5, 33],
  ]
  for (const [dx, dz, r, seed] of decalDefs) {
    const d = floorBlob(r, seed, MAT.bloodFloor)
    d.position.set(dx, 0.038 + bloodDecals.length * 0.001, dz)
    group.add(d)
    bloodDecals.push(d)
  }
  const floorA = anchor('floorArea', 0, 0.034, 0.4)
  floorA.userData.floorMat = MAT.floorBlood
  floorA.userData.bloodDecals = bloodDecals

  // 两面血墙（客厅西墙北段 / 分户墙南面向客厅）
  const stain1 = makeStain(0.5, 7)
  stain1.position.set(-2.91, 1.5, -1.6)
  stain1.rotation.y = Math.PI / 2 // 面向 +x
  group.add(stain1)
  const stain1A = anchor('wallStain1', -2.7, 1.2, -1.6)
  stain1A.userData.mesh = stain1

  const stain2 = makeStain(0.62, 8)
  stain2.position.set(2.2, 1.55, -2.71) // ShapeGeometry 默认面向 +z
  group.add(stain2)
  const stain2A = anchor('wallStain2', 2.2, 1.2, -2.5)
  stain2A.userData.mesh = stain2

  // 霉绿斑（浴室门口墙 / 客厅东墙 / 厨房角）
  const mold1 = blobMesh(0.3, 41, MAT.mold)
  mold1.position.set(3.55, 1.9, -2.71)
  group.add(mold1)
  const mold2 = blobMesh(0.26, 42, MAT.mold)
  mold2.position.set(2.6, 2.05, -2.71)
  group.add(mold2)
  const mold3 = blobMesh(0.32, 43, MAT.mold)
  mold3.position.set(5.55, 1.75, 3.30)
  mold3.rotation.y = Math.PI
  group.add(mold3)

  // ------------------------------ 公主房（西，暗粉） ------------------------
  const bed = makeKidsBed()
  bed.position.set(-5.05, 0, 0.6)
  bed.rotation.y = Math.PI / 2 // 床头抵西墙
  group.add(bed)
  solid(-5.05, 0.3, 0.6, 1.95, 0.6, 0.95)
  anchor('kidsBed', -5.0, 0.5, 0.6)

  const wardrobe = makeWardrobe()
  wardrobe.position.set(-3.9, 0, -2.42)
  group.add(wardrobe)
  solid(-3.9, 1.0, -2.42, 1.2, 2.0, 0.6)

  const toys = makeToys()
  toys.position.set(-4.1, 0, 0.1)
  group.add(toys)

  const rug = floorBlob(0.8, 55, MAT.rug)
  rug.position.set(-4.6, 0.038, -1.1)
  group.add(rug)

  // ------------------------------ 浴室（东，惨白） --------------------------
  const cab = makeCabinet()
  cab.group.position.set(5.55, 0, -1.1)
  cab.group.rotation.y = -Math.PI / 2 // 柜门面向 -x
  group.add(cab.group)
  cab.mirror.position.set(5.93, 1.45, -1.1)
  cab.mirror.rotation.y = -Math.PI / 2
  group.add(cab.mirror)
  solid(5.55, 0.45, -1.1, 0.55, 0.9, 0.95)
  anchor('bathroomCabinet', 5.3, 0.85, -1.1)

  const mop = makeMop()
  mop.position.set(5.72, 0.02, -2.35)
  mop.rotation.x = 0.22 // 倚墙
  group.add(mop)
  anchor('mop', 5.55, 0.65, -2.35)

  const toilet = makeToilet()
  toilet.position.set(3.5, 0, -2.48)
  group.add(toilet)
  solid(3.5, 0.35, -2.48, 0.5, 0.7, 0.7)

  const tub = makeTub()
  tub.position.set(4.3, 0, 0.30)
  group.add(tub)
  solid(4.3, 0.3, 0.30, 1.5, 0.6, 0.8)

  // ------------------------------ 厨房角（东南小吧台） ----------------------
  const bar = makeBarCounter()
  bar.position.set(4.1, 0, 3.08) // 长边贴玻璃线
  group.add(bar)
  solid(4.1, 0.45, 3.08, 2.4, 0.9, 0.35)
  solid(3.08, 0.45, 2.23, 0.35, 0.9, 1.65)
  for (const sx of [3.7, 4.6]) {
    const st = makeStool()
    st.position.set(sx, 0, 2.35)
    group.add(st)
    solid(sx, 0.3, 2.35, 0.4, 0.6, 0.4)
  }

  // ------------------------------ 阳台（玻璃推拉门） ------------------------
  const glass = makeBalconyGlass(8.4)
  glass.group.position.set(0, 0, 3.4)
  group.add(glass.group)
  solid(0, 1.1, 3.4, 8.4, 2.2, 0.12) // 玻璃门关着（思思被撞面）
  const bgA = anchor('balconyGlass', 0, 1.1, 3.38)
  bgA.userData.panels = glass.panels
  // 女儿墙铁栏杆
  for (let i = 0; i < 8; i++) {
    cyl(group, 0.018, 0.018, 0.5, MAT.metal, -5.25 + i * 1.5, 1.1, 4.42, 5)
  }
  bx(group, 12, 0.05, 0.06, MAT.metal, 0, 1.6, 4.42)

  // 窗外月亮与雾中楼影
  group.add(makeMoonCity())

  // ------------------------------ 灯具（视觉） ------------------------------
  const foyerFix = makeCeilingFixture(MAT.bulbCold)
  foyerFix.position.set(0, 0, -3.6)
  group.add(foyerFix)
  const bathFix = makeCeilingFixture(MAT.bulbWhite, true)
  bathFix.position.set(4.5, 0, -1.0)
  group.add(bathFix)
  const pinkFix = makeCeilingFixture(MAT.bulbPink)
  pinkFix.position.set(-4.5, 0, -0.6)
  group.add(pinkFix)
  const kitFix = makeCeilingFixture(MAT.bulbWarm)
  kitFix.position.set(4.2, 0, 2.4)
  group.add(kitFix)

  // ------------------------------ 灯光（§9 分工，整体昏暗） -----------------
  // 将基线保存给 gameplay：午睡惊醒时在黑场中统一压暗，无需扩展 WorldData 契约。
  const houseLighting: { light: THREE.Light; baseIntensity: number }[] = []
  const addHouseLight = <T extends THREE.Light>(light: T): T => {
    group.add(light)
    houseLighting.push({ light, baseIntensity: light.intensity })
    return light
  }
  addHouseLight(new THREE.AmbientLight(0x2b2330, 0.55))

  const foyerL = addHouseLight(new THREE.PointLight(0x86a0d8, 7, 7, 2)) // 玄关冷蓝小灯
  foyerL.position.set(0, 2.4, -3.6)

  const lampL = addHouseLight(new THREE.PointLight(0xffb066, 16, 9, 2)) // 客厅暖黄台灯
  lampL.position.set(-2.5, 1.6, 2.32)

  const moonL = addHouseLight(new THREE.DirectionalLight(0x8ea6cc, 1.1)) // 冷月光（南窗斜入）
  moonL.position.set(3.5, 6.5, 11)
  moonL.target.position.set(-0.5, 0.8, 0)
  group.add(moonL.target)

  const bathL = addHouseLight(new THREE.PointLight(0xeef4f0, 12, 6, 2)) // 浴室惨白
  bathL.position.set(4.5, 2.5, -1.0)

  const pinkL = addHouseLight(new THREE.PointLight(0xff6f9d, 7, 6, 2)) // 公主房暗粉
  pinkL.position.set(-4.5, 2.2, -0.6)

  const kitL = addHouseLight(new THREE.PointLight(0xffc088, 4, 4.5, 2)) // 厨房角一点暖光
  kitL.position.set(4.2, 2.3, 2.4)
  group.userData.houseLighting = houseLighting

  // ------------------------------ 收尾 --------------------------------------
  scene.add(group)
  return {
    group,
    colliders,
    // 第一眼在前庭，yaw=0 朝 -Z 正对远处楼体；剧情层会在选层后使用
    // hallSpawn/arrivalSpawn 把玩家带到 30 层，而不是假装一开始已在门内。
    spawn: new THREE.Vector3(0, 1.6, -15),
    yaw: 0,
    anchors,
  }
}
