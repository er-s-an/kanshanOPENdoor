// ============================================================================
// world/kit.ts — PS1 风低模「积木」库：共享材质 + 几何小工具 + 程序化家具
// 全部 Box/Cylinder/Sphere/Lathe/Shape 组合，无外部素材。
// ============================================================================
import * as THREE from 'three'

/** 确定性伪随机：每次构建布局一致 */
export function makeRng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * 小尺寸、确定性的调色板纹理：只给大平面一点 PS1 时代的材质辨识度，
 * 不引入文件、加载器或运行时随机性。plaster 用 2×2 像素簇，wood 用竖向纹理。
 */
function makePaletteTexture(
  size: number,
  seed: number,
  palette: readonly number[],
  verticalGrain = false,
): THREE.DataTexture {
  const r = makeRng(seed)
  const data = new Uint8Array(size * size * 4)
  const cellSpan = 2
  const cellCount = Math.ceil(size / cellSpan)
  const cells = Array.from({ length: cellCount * cellCount }, () =>
    palette[Math.floor(r() * palette.length)],
  )
  const bands = Array.from({ length: cellCount }, () => palette[Math.floor(r() * palette.length)])
  const write = (x: number, y: number, color: number) => {
    const i = (y * size + x) * 4
    data[i] = (color >> 16) & 0xff
    data[i + 1] = (color >> 8) & 0xff
    data[i + 2] = color & 0xff
    data[i + 3] = 0xff
  }

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const color = verticalGrain
        ? bands[Math.floor(x / cellSpan)]
        : cells[Math.floor(y / cellSpan) * cellCount + Math.floor(x / cellSpan)]
      write(x, y, color)
    }
  }

  // 墙皮只有极少量细小垂渍，避免在 320×240 输出中读成电视雪花。
  if (!verticalGrain) {
    const dark = palette[0]
    for (let n = 0; n < Math.max(1, Math.floor(size / 20)); n++) {
      const x = Math.floor(r() * size)
      const y = Math.floor(r() * Math.max(1, size - 4))
      const length = 1 + Math.floor(r() * 3)
      for (let dy = 0; dy < length && y + dy < size; dy++) write(x, y + dy, dark)
    }
  }

  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.wrapS = THREE.RepeatWrapping
  tex.wrapT = THREE.RepeatWrapping
  tex.magFilter = THREE.NearestFilter
  tex.minFilter = THREE.NearestFilter
  tex.generateMipmaps = false
  tex.anisotropy = 1
  tex.needsUpdate = true
  return tex
}

const wallPlaster = makePaletteTexture(32, 0x30a7, [
  0x3e3837, 0x4d4542, 0x5a504c, 0x6b5e57, 0x7b6d64, 0x8b7a6f,
])
wallPlaster.repeat.set(2, 1)
// 墙面在远处会被雾和高度近视吞没；允许它使用 mip 级别防止 32px 图案在
// 移动中闪烁，近处仍由 NearestFilter 保持像素块。
wallPlaster.userData.ps1StableMinification = true

const doorGrain = makePaletteTexture(16, 0xd00d, [
  0x34251e, 0x423027, 0x503a2f, 0x604638,
], true)

/** 运行时生成、可复用的低清材质纹理；并非外部资产。 */
export const TEX = { wallPlaster, doorGrain }

// ------------------------------- 材质（暗红/冷灰/霉绿调色板） ---------------
export const MAT = {
  // 普通墙面保持烟灰/暖灰，饱和红只留给血、恐惧提示和思思的裙子。
  wall: new THREE.MeshLambertMaterial({ color: 0xffffff, map: TEX.wallPlaster }),
  wallInner: new THREE.MeshLambertMaterial({ color: 0xc0aeb2, map: TEX.wallPlaster }),
  ceiling: new THREE.MeshLambertMaterial({ color: 0x221a1e }),
  floorBase: new THREE.MeshLambertMaterial({ color: 0x322028 }),
  floorBlood: new THREE.MeshLambertMaterial({ color: 0x5e1719 }), // 血迹红地板（可拖净）
  floorPink: new THREE.MeshLambertMaterial({ color: 0x452b33 }),
  floorBath: new THREE.MeshLambertMaterial({ color: 0x5a5a56 }),
  trim: new THREE.MeshLambertMaterial({ color: 0x241114 }),
  wood: new THREE.MeshLambertMaterial({ color: 0x3c2620 }),
  woodDark: new THREE.MeshLambertMaterial({ color: 0x2b1a15 }),
  door: new THREE.MeshLambertMaterial({ color: 0xffffff, map: TEX.doorGrain }),
  fabric: new THREE.MeshLambertMaterial({ color: 0x5c2f36 }),
  fabric2: new THREE.MeshLambertMaterial({ color: 0x4b2730 }),
  gray: new THREE.MeshLambertMaterial({ color: 0x484850 }),
  metal: new THREE.MeshLambertMaterial({ color: 0x585860 }),
  pink: new THREE.MeshLambertMaterial({ color: 0x7e3c50 }),
  pinkSoft: new THREE.MeshLambertMaterial({ color: 0x8f4c5c }),
  porcelain: new THREE.MeshLambertMaterial({ color: 0xb6bab3 }),
  white: new THREE.MeshLambertMaterial({ color: 0x8e8e88 }),
  blood: new THREE.MeshLambertMaterial({
    color: 0x5f0c11, transparent: true, opacity: 0.96,
    polygonOffset: true, polygonOffsetFactor: -2, side: THREE.DoubleSide,
  }),
  bloodFloor: new THREE.MeshLambertMaterial({
    color: 0x47090d, transparent: true, opacity: 0.95,
    polygonOffset: true, polygonOffsetFactor: -2,
  }),
  mold: new THREE.MeshLambertMaterial({
    color: 0x2e3f31, transparent: true, opacity: 0.9,
    polygonOffset: true, polygonOffsetFactor: -2, side: THREE.DoubleSide,
  }),
  glass: new THREE.MeshLambertMaterial({
    color: 0x9fb4c4, transparent: true, opacity: 0.16, side: THREE.DoubleSide,
  }),
  frame: new THREE.MeshLambertMaterial({ color: 0x393940 }),
  screen: new THREE.MeshBasicMaterial({ color: 0x14251c }), // 旧电视幽绿屏
  phoneScr: new THREE.MeshBasicMaterial({ color: 0x9db89d }),
  bulbWarm: new THREE.MeshBasicMaterial({ color: 0xffd9a2 }),
  bulbCold: new THREE.MeshBasicMaterial({ color: 0xc4d2f0 }),
  bulbPink: new THREE.MeshBasicMaterial({ color: 0xff9fc0 }),
  bulbWhite: new THREE.MeshBasicMaterial({ color: 0xf2f6ef }),
  mirror: new THREE.MeshBasicMaterial({ color: 0x46545a }),
  moon: new THREE.MeshBasicMaterial({ color: 0xdfe8f4, fog: false }),
  city: new THREE.MeshLambertMaterial({ color: 0x0b0a12 }),
  rug: new THREE.MeshLambertMaterial({ color: 0x6a3550 }),
}

// ------------------------------- 几何小工具 --------------------------------
/** 放一个盒子，yBottom = 底面高度（摆放直觉） */
export function bx(
  parent: THREE.Object3D, w: number, h: number, d: number,
  mat: THREE.Material, x: number, yBottom: number, z: number, ry = 0,
): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat)
  m.position.set(x, yBottom + h / 2, z)
  m.rotation.y = ry
  parent.add(m)
  return m
}

/** 放圆柱/圆台，yBottom = 底面高度 */
export function cyl(
  parent: THREE.Object3D, rTop: number, rBot: number, h: number,
  mat: THREE.Material, x: number, yBottom: number, z: number, seg = 8,
): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rTop, rBot, h, seg), mat)
  m.position.set(x, yBottom + h / 2, z)
  parent.add(m)
  return m
}

/** 不规则放射状「渍斑」面片（XY 平面、中心为原点、+z 朝向），血渍/霉斑用 */
export function blobMesh(radius: number, seed: number, mat: THREE.Material): THREE.Mesh {
  const r = makeRng(seed)
  const n = 10 + Math.floor(r() * 4)
  const shape = new THREE.Shape()
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2
    const rad = radius * (0.5 + r() * 0.5)
    const px = Math.cos(a) * rad
    const py = Math.sin(a) * rad
    if (i === 0) shape.moveTo(px, py)
    else shape.lineTo(px, py)
  }
  shape.closePath()
  return new THREE.Mesh(new THREE.ShapeGeometry(shape), mat)
}

/** 平铺地面的渍斑（已旋转到 XZ 平面） */
export function floorBlob(radius: number, seed: number, mat: THREE.Material): THREE.Mesh {
  const m = blobMesh(radius, seed, mat)
  m.rotation.x = -Math.PI / 2
  return m
}

// ------------------------------- 家具构建器 --------------------------------
/** 三人沙发（本地朝向 +z），座面高 ~0.42 */
export function makeSofa(): THREE.Group {
  const g = new THREE.Group()
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    bx(g, 0.08, 0.1, 0.08, MAT.woodDark, sx * 0.98, 0, sz * 0.38)
  }
  bx(g, 2.2, 0.32, 0.95, MAT.fabric, 0, 0.1, 0)
  for (let i = 0; i < 3; i++) {
    bx(g, 0.6, 0.16, 0.8, MAT.fabric2, -0.62 + i * 0.62, 0.42, 0.06)
  }
  bx(g, 2.2, 0.55, 0.2, MAT.fabric, 0, 0.42, -0.38)
  bx(g, 0.2, 0.3, 0.9, MAT.fabric, -1.0, 0.42, 0)
  bx(g, 0.2, 0.3, 0.9, MAT.fabric, 1.0, 0.42, 0)
  return g
}

/** 落地台灯（本地），灯头在 y≈1.55，暖黄光源挂点 */
export function makeFloorLamp(): THREE.Group {
  const g = new THREE.Group()
  cyl(g, 0.16, 0.18, 0.03, MAT.metal, 0, 0, 0, 10)
  cyl(g, 0.022, 0.022, 1.42, MAT.metal, 0, 0.03, 0, 6)
  const pts = [
    new THREE.Vector2(0.2, 0), new THREE.Vector2(0.2, 0.03),
    new THREE.Vector2(0.13, 0.24), new THREE.Vector2(0.12, 0.26),
  ]
  const shade = new THREE.Mesh(new THREE.LatheGeometry(pts, 10), MAT.fabric2)
  shade.position.y = 1.45
  g.add(shade)
  const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 6), MAT.bulbWarm)
  bulb.position.y = 1.56
  g.add(bulb)
  return g
}

/** 茶几 */
export function makeCoffeeTable(): THREE.Group {
  const g = new THREE.Group()
  bx(g, 0.95, 0.06, 0.6, MAT.wood, 0, 0.38, 0)
  bx(g, 0.85, 0.04, 0.5, MAT.woodDark, 0, 0.16, 0)
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    bx(g, 0.06, 0.38, 0.06, MAT.woodDark, sx * 0.4, 0, sz * 0.22)
  }
  // 搪瓷杯与摊开的杂志，添点生活痕迹
  cyl(g, 0.04, 0.035, 0.09, MAT.porcelain, -0.2, 0.44, 0.08, 8)
  bx(g, 0.24, 0.012, 0.17, MAT.gray, 0.18, 0.44, -0.05, 0.4)
  return g
}

/** 电视柜 + 旧 CRT 电视（本地朝向 +z） */
export function makeTVStand(): THREE.Group {
  const g = new THREE.Group()
  bx(g, 1.3, 0.12, 0.5, MAT.wood, 0, 0.32, 0)
  bx(g, 1.3, 0.32, 0.5, MAT.woodDark, 0, 0, 0)
  bx(g, 0.56, 0.02, 0.03, MAT.trim, -0.3, 0.14, 0.26)
  // CRT 机身（上窄下宽）
  bx(g, 0.72, 0.5, 0.5, MAT.gray, 0, 0.44, 0)
  bx(g, 0.74, 0.06, 0.52, MAT.gray, 0, 0.94, 0)
  const scr = new THREE.Mesh(new THREE.PlaneGeometry(0.52, 0.38), MAT.screen)
  scr.position.set(-0.05, 0.72, 0.253)
  g.add(scr)
  cyl(g, 0.008, 0.008, 0.5, MAT.metal, 0.18, 0.98, -0.05, 4).rotation.z = 0.5
  cyl(g, 0.008, 0.008, 0.5, MAT.metal, 0.22, 0.98, -0.05, 4).rotation.z = 0.34
  return g
}

/** 公主房小床（本地：床头在 -z，长轴 z，1.95×0.95） */
export function makeKidsBed(): THREE.Group {
  const g = new THREE.Group()
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    bx(g, 0.07, 0.12, 0.07, MAT.woodDark, sx * 0.9, 0, sz * 0.4)
  }
  bx(g, 0.95, 0.22, 1.95, MAT.wood, 0, 0.12, 0)
  bx(g, 0.08, 0.62, 0.95, MAT.pink, 0, 0.12, -0.94)
  bx(g, 0.85, 0.14, 1.85, MAT.pinkSoft, 0, 0.34, 0)
  bx(g, 0.5, 0.1, 0.36, MAT.white, 0, 0.48, -0.62)
  bx(g, 0.87, 0.06, 1.0, MAT.pink, 0, 0.46, 0.4) // 床尾毯
  return g
}

/** 衣柜（本地朝向 +z） */
export function makeWardrobe(): THREE.Group {
  const g = new THREE.Group()
  bx(g, 1.2, 1.9, 0.55, MAT.wood, 0, 0.08, 0)
  bx(g, 1.26, 0.08, 0.6, MAT.woodDark, 0, 0, 0)
  bx(g, 1.26, 0.08, 0.6, MAT.woodDark, 0, 1.98, 0)
  bx(g, 0.56, 1.78, 0.03, MAT.pink, -0.29, 0.13, 0.28)
  bx(g, 0.56, 1.78, 0.03, MAT.pink, 0.29, 0.13, 0.28)
  cyl(g, 0.015, 0.015, 0.14, MAT.metal, -0.06, 0.95, 0.31, 6)
  cyl(g, 0.015, 0.015, 0.14, MAT.metal, 0.06, 0.95, 0.31, 6)
  return g
}

/** 玩具堆：积木×3 + 球 + 无眼布娃娃（恐怖点） */
export function makeToys(): THREE.Group {
  const g = new THREE.Group()
  bx(g, 0.13, 0.13, 0.13, MAT.pink, 0, 0, 0, 0.4)
  bx(g, 0.11, 0.11, 0.11, MAT.gray, 0.16, 0, 0.1, 0.9)
  bx(g, 0.1, 0.1, 0.1, MAT.mold, 0.05, 0.11, 0.04, 0.2)
  const ball = new THREE.Mesh(new THREE.IcosahedronGeometry(0.1, 0), MAT.pinkSoft)
  ball.position.set(-0.2, 0.1, 0.14)
  g.add(ball)
  // 布娃娃：裙、头、双辫（无五官）
  cyl(g, 0.05, 0.075, 0.2, MAT.pink, 0.32, 0, -0.12, 8)
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.062, 8, 6), MAT.porcelain)
  head.position.set(0.32, 0.26, -0.12)
  g.add(head)
  const t1 = new THREE.Mesh(new THREE.SphereGeometry(0.026, 6, 5), MAT.woodDark)
  t1.position.set(0.26, 0.3, -0.12)
  const t2 = t1.clone()
  t2.position.set(0.38, 0.3, -0.12)
  g.add(t1, t2)
  return g
}

/** 浴室洗手台柜（本地朝向 +z）+ 台盆 + 龙头；镜子单独返回，调用方挂墙 */
export function makeCabinet(): { group: THREE.Group; mirror: THREE.Mesh } {
  const g = new THREE.Group()
  bx(g, 0.9, 0.12, 0.5, MAT.woodDark, 0, 0, 0)
  bx(g, 0.9, 0.68, 0.5, MAT.white, 0, 0.12, 0)
  bx(g, 0.4, 0.6, 0.02, MAT.porcelain, -0.22, 0.16, 0.26)
  bx(g, 0.4, 0.6, 0.02, MAT.porcelain, 0.22, 0.16, 0.26)
  cyl(g, 0.02, 0.02, 0.12, MAT.metal, -0.08, 0.72, 0.18, 6)
  cyl(g, 0.02, 0.02, 0.12, MAT.metal, 0.08, 0.72, 0.18, 6)
  // 台盆（Lathe 旋转面）
  const pts = [
    new THREE.Vector2(0.0, 0.0), new THREE.Vector2(0.15, 0.0),
    new THREE.Vector2(0.18, 0.04), new THREE.Vector2(0.14, 0.1),
    new THREE.Vector2(0.0, 0.1),
  ]
  const basin = new THREE.Mesh(new THREE.LatheGeometry(pts, 10), MAT.porcelain)
  basin.position.set(0, 0.8, 0.02)
  g.add(basin)
  cyl(g, 0.018, 0.018, 0.2, MAT.metal, 0, 0.82, -0.17, 6)
  bx(g, 0.03, 0.03, 0.16, MAT.metal, 0, 0.98, -0.1)
  const mirror = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 0.72), MAT.mirror)
  return { group: g, mirror }
}

/** 拖把（倚墙斜放，本地沿 +y 竖直，调用方转 rotation.x） */
export function makeMop(): THREE.Group {
  const g = new THREE.Group()
  cyl(g, 0.02, 0.02, 1.4, MAT.wood, 0, 0.18, 0, 6)
  bx(g, 0.06, 0.1, 0.06, MAT.metal, 0, 0.14, 0)
  bx(g, 0.22, 0.1, 0.1, MAT.fabric2, 0, 0.04, 0)
  for (let i = 0; i < 3; i++) {
    bx(g, 0.04, 0.12, 0.02, MAT.white, -0.06 + i * 0.06, 0, 0.02, 0.3 * (i - 1))
  }
  return g
}

/** 马桶（本地朝向 +z） */
export function makeToilet(): THREE.Group {
  const g = new THREE.Group()
  bx(g, 0.4, 0.34, 0.52, MAT.porcelain, 0, 0, 0.04)
  cyl(g, 0.2, 0.16, 0.1, MAT.porcelain, 0, 0.34, 0.1, 10)
  bx(g, 0.42, 0.5, 0.18, MAT.porcelain, 0, 0.16, -0.24)
  return g
}

/** 浴缸（空壳） */
export function makeTub(): THREE.Group {
  const g = new THREE.Group()
  bx(g, 1.5, 0.52, 0.75, MAT.porcelain, 0, 0, 0)
  bx(g, 1.34, 0.06, 0.6, MAT.gray, 0, 0.42, 0)
  cyl(g, 0.02, 0.02, 0.3, MAT.metal, 0.6, 0.52, -0.28, 6)
  return g
}

/** 厨房 L 形小吧台（本地：长边沿 +x，短边在西端折向 -z） */
export function makeBarCounter(): THREE.Group {
  const g = new THREE.Group()
  bx(g, 2.4, 0.85, 0.35, MAT.woodDark, 0, 0, 0)
  bx(g, 2.55, 0.06, 0.55, MAT.wood, 0, 0.85, 0)
  bx(g, 0.35, 0.85, 1.4, MAT.woodDark, -1.02, 0, -0.85)
  bx(g, 0.55, 0.06, 1.55, MAT.wood, -1.02, 0.85, -0.85)
  cyl(g, 0.07, 0.07, 0.16, MAT.gray, 0.7, 0.91, 0, 8)
  cyl(g, 0.06, 0.06, 0.13, MAT.mold, 0.45, 0.91, 0.08, 8)
  bx(g, 0.5, 0.04, 0.3, MAT.porcelain, -0.3, 0.91, 0.02, 0.2)
  return g
}

/** 吧台凳 */
export function makeStool(): THREE.Group {
  const g = new THREE.Group()
  cyl(g, 0.14, 0.16, 0.03, MAT.metal, 0, 0, 0, 8)
  cyl(g, 0.028, 0.028, 0.42, MAT.metal, 0, 0.03, 0, 6)
  cyl(g, 0.19, 0.19, 0.05, MAT.fabric, 0, 0.45, 0, 10)
  return g
}

/** 玄关大门：门框 + 门扇。门扇几何原点移到合页侧，gameplay 旋转 leaf.rotation.y 即开门 */
export function makeEntryDoor(): { frame: THREE.Group; leaf: THREE.Mesh } {
  const frame = new THREE.Group()
  bx(frame, 0.1, 2.06, 0.18, MAT.trim, -0.52, 0, 0)
  bx(frame, 0.1, 2.06, 0.18, MAT.trim, 0.52, 0, 0)
  bx(frame, 1.14, 0.72, 0.18, MAT.trim, 0, 2.06, 0)
  const geo = new THREE.BoxGeometry(0.94, 2.02, 0.07)
  geo.translate(0.47, 1.01, 0) // 原点 = 合页（门扇左缘、地面）
  const leaf = new THREE.Mesh(geo, MAT.door)
  // 门芯板与把手（leaf 的子节点，开门时一起转）
  bx(leaf, 0.66, 0.62, 0.02, MAT.wood, 0.47, 1.24, 0.045)
  bx(leaf, 0.66, 0.62, 0.02, MAT.wood, 0.47, 0.4, 0.045)
  const knob = new THREE.Mesh(new THREE.SphereGeometry(0.038, 8, 6), MAT.metal)
  knob.position.set(0.84, 1.02, 0.07)
  leaf.add(knob)
  return { frame, leaf }
}

/** 阳台玻璃推拉门：上轨/下轨/竖框 + 3 块玻璃面板（返回值供碎裂演出） */
export function makeBalconyGlass(width: number): { group: THREE.Group; panels: THREE.Mesh[] } {
  const g = new THREE.Group()
  const w = width
  bx(g, w, 0.08, 0.12, MAT.frame, 0, 2.04, 0)
  bx(g, w, 0.05, 0.16, MAT.frame, 0, 0, 0)
  const panels: THREE.Mesh[] = []
  for (let i = 0; i < 4; i++) {
    const x = -w / 2 + (i * w) / 3
    bx(g, 0.07, 2.04, 0.1, MAT.frame, x, 0.02, 0)
  }
  for (let i = 0; i < 3; i++) {
    const x = -w / 2 + ((i + 0.5) * w) / 3
    const p = new THREE.Mesh(new THREE.PlaneGeometry(w / 3 - 0.09, 1.96), MAT.glass)
    p.position.set(x, 1.03, 0)
    g.add(p)
    panels.push(p)
  }
  return { group: g, panels }
}

/** 吸顶灯具（不同房间不同灯泡色） */
export function makeCeilingFixture(bulb: THREE.Material, dome = false): THREE.Group {
  const g = new THREE.Group()
  if (dome) {
    const pts = [new THREE.Vector2(0.16, 0), new THREE.Vector2(0.16, 0.02), new THREE.Vector2(0.02, 0.1)]
    const d = new THREE.Mesh(new THREE.LatheGeometry(pts, 10), MAT.porcelain)
    d.position.y = 2.68
    g.add(d)
    const b = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 6), bulb)
    b.position.y = 2.66
    g.add(b)
  } else {
    cyl(g, 0.13, 0.16, 0.1, MAT.metal, 0, 2.7, 0, 8)
    const b = new THREE.Mesh(new THREE.SphereGeometry(0.045, 8, 6), bulb)
    b.position.y = 2.68
    g.add(b)
  }
  return g
}

/** 窗外月亮 + 雾中远楼剪影（30 层高楼视角） */
export function makeMoonCity(): THREE.Group {
  const g = new THREE.Group()
  const moon = new THREE.Mesh(new THREE.CircleGeometry(0.72, 14), MAT.moon)
  moon.position.set(3.4, 5.4, 10.6)
  moon.rotation.y = Math.PI
  g.add(moon)
  const r = makeRng(30)
  for (let i = 0; i < 7; i++) {
    const h = 2.5 + r() * 4
    const b = new THREE.Mesh(new THREE.BoxGeometry(1.5 + r() * 2, h, 1.2), MAT.city)
    b.position.set(-9 + i * 3 + r() * 1.5, h / 2 - 0.5, 9 + r() * 4)
    g.add(b)
  }
  return g
}

/** 血渍：不规则主斑 + 下方垂流（drip 为子网格，共享材质，隐藏/透明主网格即整组消失） */
export function makeStain(radius: number, seed: number): THREE.Mesh {
  // 每块血渍独占一份材质：gameplay 淡出其中一块时，不能把另一块一并变透明。
  const bloodMat = MAT.blood.clone()
  const main = blobMesh(radius, seed, bloodMat)
  const r = makeRng(seed + 99)
  for (let i = 0; i < 3; i++) {
    const len = 0.25 + r() * 0.45
    const drip = new THREE.Mesh(new THREE.BoxGeometry(0.045, len, 0.012), bloodMat)
    drip.position.set((r() - 0.5) * radius * 1.2, -radius * 0.75 - len / 2, 0.002)
    main.add(drip)
  }
  return main
}
