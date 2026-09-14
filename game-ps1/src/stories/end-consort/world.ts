import * as THREE from 'three'

/** 景华宫：北为 -Z，所有位置单位为米；地面 Y=0。 */
export interface ConsortWorld {
  group: THREE.Group
  colliders: THREE.Box3[]
  spawn: THREE.Vector3
  anchors: Record<string, THREE.Vector3>
  actors: Record<string, THREE.Group>
  plots: THREE.Group[]
  setPlot(index: number, phase: 0 | 1 | 2 | 3): void
  setActorVisible(id: string, visible: boolean): void
  /** Reposition an actor at a named anchor or explicit ground-level point. */
  moveActor(id: string, destination: string | THREE.Vector3): void
  /** Move the single readable gold destination marker to a story anchor. */
  setGoalMarker(id: string | null): void
  /** Swing both south-gate leaves open and remove the matching walking collider. */
  setGateOpen(open: boolean): void
}

type Palette = Record<string, THREE.MeshLambertMaterial>

function random(seed: number) {
  let s = seed >>> 0
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296 }
}

function texture(colors: number[], seed: number, kind: 'stone' | 'wood' | 'plaster') {
  const rng = random(seed)
  const size = 32
  const data = new Uint8Array(size * size * 4)
  const bands = Array.from({ length: 16 }, () => colors[Math.floor(rng() * colors.length)])
  for (let y = 0; y < size; y += 2) for (let x = 0; x < size; x += 2) {
    let color = kind === 'wood' ? bands[x / 2] : colors[Math.floor(rng() * colors.length)]
    if (kind === 'stone' && (y % 16 === 0 || (x + (y < 16 ? 0 : 8)) % 16 === 0)) color = colors[0]
    for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) {
      const i = ((y + dy) * size + x + dx) * 4
      data[i] = color >> 16 & 255; data[i + 1] = color >> 8 & 255
      data[i + 2] = color & 255; data[i + 3] = 255
    }
  }
  const map = new THREE.DataTexture(data, size, size, THREE.RGBAFormat)
  map.colorSpace = THREE.SRGBColorSpace
  map.magFilter = THREE.NearestFilter
  map.minFilter = THREE.NearestFilter
  map.wrapS = map.wrapT = THREE.RepeatWrapping
  map.generateMipmaps = false
  map.needsUpdate = true
  return map
}

function palette(): Palette {
  const colors = {
    plaster: 0xd6b994, stone: 0xa99d86, stoneLight: 0xc1b29b,
    timber: 0x79513d, darkWood: 0x4d3830, redWood: 0x985641,
    roof: 0x4c6260, roofLight: 0x667874, gold: 0xb39452,
    earth: 0xa8936e, dirt: 0x8f7354, turned: 0x6d513a, furrow: 0x4f3d2c,
    grass: 0x7f8848, grassDry: 0xa5a269, leaf: 0x7c9159,
    cream: 0xe5d3ac, paper: 0xd9c8a3, black: 0x302d2a,
    porcelain: 0xa8b6a8, water: 0x739fa1, seed: 0xc7aa71,
    skin: 0xcb9872, skinLight: 0xe1b28e, hair: 0x34312e,
    teal: 0x4c7773, blue: 0x536d80, plum: 0x855c6a, ochre: 0xb69b5c,
  }
  const mats: Palette = {}
  for (const [key, color] of Object.entries(colors)) mats[key] = new THREE.MeshLambertMaterial({ color, flatShading: true })
  mats.plaster = new THREE.MeshLambertMaterial({ map: texture([0xc7ad8e, 0xd5ba98, 0xddc3a2, 0xd8bd9d], 4, 'plaster') })
  mats.timber = new THREE.MeshLambertMaterial({ map: texture([0x73503e, 0x805b44, 0x8a6148], 7, 'wood') })
  mats.stone = new THREE.MeshLambertMaterial({ map: texture([0x928b7a, 0xb0a68f, 0xb7ad96, 0xaba18d], 9, 'stone') })
  return mats
}

function box(parent: THREE.Object3D, m: THREE.Material, x: number, y: number, z: number, w: number, h: number, d: number, yaw = 0) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m)
  mesh.position.set(x, y + h / 2, z)
  mesh.rotation.y = yaw
  parent.add(mesh)
  return mesh
}

function cylinder(parent: THREE.Object3D, m: THREE.Material, x: number, y: number, z: number, top: number, bottom: number, h: number, sides = 8) {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(top, bottom, h, sides), m)
  mesh.position.set(x, y + h / 2, z)
  parent.add(mesh)
  return mesh
}

function sphere(parent: THREE.Object3D, m: THREE.Material, x: number, y: number, z: number, r: number, sx = 1, sy = 1, sz = 1) {
  const mesh = new THREE.Mesh(new THREE.IcosahedronGeometry(r, 0), m)
  mesh.position.set(x, y, z)
  mesh.scale.set(sx, sy, sz)
  parent.add(mesh)
  return mesh
}

/** Flat, gently flared eaves; broad silhouettes survive 320×240 rendering. */
function roof(parent: THREE.Object3D, m: Palette, x: number, y: number, z: number, w: number, d: number, rise: number) {
  const g = new THREE.Group()
  g.position.set(x, y, z)
  parent.add(g)
  const half = d / 2
  const verts: number[] = []
  const quad = (a: number[], b: number[], c: number[], e: number[]) => verts.push(...a, ...b, ...c, ...a, ...c, ...e)
  // Two pitches on each side produce a subtle upturn, rather than a fantasy pagoda.
  for (const side of [-1, 1]) {
    const rows = [[0, rise], [half * .72, .15], [half, .04]]
    for (let i = 0; i < 2; i++) {
      const [z1, h1] = rows[i]; const [z2, h2] = rows[i + 1]
      quad([-w / 2, h1, side * z1], [w / 2, h1, side * z1], [w / 2, h2, side * z2], [-w / 2, h2, side * z2])
    }
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3))
  geo.computeVertexNormals()
  const mat = m.roof.clone(); mat.side = THREE.DoubleSide
  g.add(new THREE.Mesh(geo, mat))
  box(g, m.roofLight, 0, rise - .025, 0, w + .18, .13, .18)
  for (const side of [-1, 1]) {
    box(g, m.darkWood, 0, -.1, side * (half - .05), w, .13, .13)
    box(g, m.roofLight, 0, .035, side * half, w + .08, .06, .13)
  }
  // Tile ribs are instanced, so detailed roof rhythm stays inexpensive.
  const count = Math.max(4, Math.floor(w / .28))
  const ribs = new THREE.InstancedMesh(new THREE.BoxGeometry(.042, .045, 1), m.roofLight, count * 4)
  const dummy = new THREE.Object3D()
  let n = 0
  for (let i = 0; i < count; i++) for (const side of [-1, 1]) {
    const rows = [[0, rise], [half * .72, .15], [half, .04]]
    for (let k = 0; k < 2; k++) {
      const [z1, h1] = rows[k]; const [z2, h2] = rows[k + 1]
      dummy.position.set(-w / 2 + .13 + i * (w - .26) / (count - 1), (h1 + h2) / 2 + .022, side * (z1 + z2) / 2)
      dummy.rotation.set(side * Math.atan2(h1 - h2, z2 - z1), 0, 0)
      dummy.scale.set(1, 1, Math.hypot(z2 - z1, h1 - h2))
      dummy.updateMatrix(); ribs.setMatrixAt(n++, dummy.matrix)
    }
  }
  g.add(ribs)
  return g
}

/** Normal human proportions, closed broad sleeves, readable court dress. */
type CourtActor = 'fushun' | 'qingxing' | 'defei' | 'emperor'

function person(m: Palette, robe: string, kind: 'servant' | 'maid' | 'consort' | 'emperor', identity: CourtActor) {
  const g = new THREE.Group()
  const cloth = m[robe]
  const isMan = kind === 'servant' || kind === 'emperor'
  const skin = isMan ? m.skin : m.skinLight
  for (const x of [-.13, .13]) {
    const foot = box(g, m.black, x, 0, .07, .19, .12, .34)
    // 福顺的腿脚不便只保留在站姿重心里，不添加原文未写的病具。
    if (identity === 'fushun' && x < 0) { foot.position.y += .022; foot.position.z += .045 }
  }
  cylinder(g, cloth, 0, .1, 0, .24, .39, .88)
  cylinder(g, cloth, 0, .93, 0, .29, .24, .46)
  box(g, m.darkWood, 0, .94, .005, .53, .09, .37)
  box(g, m.gold, 0, .965, .201, .105, .055, .025)
  for (const side of [-1, 1]) {
    const sleeve = cylinder(g, cloth, side * .34, .76, 0, .15, .19, .48)
    sleeve.rotation.z = side * .22
    sphere(g, skin, side * .3, .78, .12, .082, .8, 1, .85)
  }
  // Overlapping collar, hem, and cuffs read as weight, not a modern shirt.
  const collarLeft = box(g, m.cream, -.075, 1.14, .228, .065, .25, .025)
  collarLeft.rotation.z = .42
  const collarRight = box(g, m.cream, .065, 1.14, .238, .06, .25, .025)
  collarRight.rotation.z = -.42
  cylinder(g, m.gold, 0, .105, 0, .38, .39, .045)
  cylinder(g, skin, 0, 1.37, 0, .09, .09, .12)
  sphere(g, skin, 0, 1.62, .018, .225, .8, 1.05, .79)
  sphere(g, m.hair, 0, 1.715, -.045, .218, .84, .73, .83)
  // Small eyes and nose, without enlarged eyes or horror facial treatment.
  for (const x of [-.063, .063]) box(g, m.hair, x, 1.629, .173, .027, .019, .018)
  box(g, skin, 0, 1.562, .188, .038, .069, .047)
  box(g, m.timber, 0, 1.524, .175, .055, .014, .016)
  if (kind === 'servant') {
    cylinder(g, m.darkWood, 0, 1.82, -.01, .145, .19, .16)
    box(g, m.black, 0, 1.785, -.17, .36, .10, .08)
  } else if (kind === 'emperor') {
    cylinder(g, m.black, 0, 1.8, -.01, .16, .195, .20)
    box(g, m.gold, 0, 1.805, .18, .28, .045, .035)
    box(g, m.black, 0, 1.84, -.06, .76, .06, .15)
    box(g, m.gold, 0, 1.05, .245, .12, .13, .04)
  } else {
    sphere(g, m.hair, 0, 1.9, -.085, .13, 1.2, .8, 1)
    if (kind === 'consort') {
      box(g, m.gold, 0, 1.875, -.04, .47, .045, .05)
      for (const x of [-.21, .21]) sphere(g, m.gold, x, 1.79, -.03, .039)
      box(g, m.cream, 0, .98, .238, .12, .29, .025)
    } else {
      box(g, m.cream, 0, 1.89, -.08, .24, .045, .04)
    }
  }
  // 角色的识别来自原文可见信息：福顺的跛腿与账库职责、青杏的宫女装束、
  // 德妃捂鼻的帕子。它们只是远景轮廓，不增加额外人物设定。
  if (identity === 'fushun') {
    const ledger = new THREE.Group(); ledger.name = '账簿'
    ledger.position.set(.31, .68, .20); ledger.rotation.set(.06, -.24, .14)
    box(ledger, m.darkWood, 0, 0, 0, .22, .38, .045)
    box(ledger, m.paper, 0, .035, .027, .175, .30, .012)
    for (const y of [.08, .16, .24]) box(ledger, m.timber, 0, y, .035, .135, .010, .008)
    g.add(ledger)
    const keys = new THREE.Mesh(new THREE.TorusGeometry(.052, .011, 4, 8), m.gold)
    keys.rotation.x = Math.PI / 2; keys.position.set(-.23, .87, .18); g.add(keys)
    g.rotation.z = -.018
    g.userData.silhouette = '福顺 · 微跛站姿、账簿、库钥匙'
  }
  if (identity === 'qingxing') {
    // 一条浅色发带和收拢的袖口，让她在庭院远景里和福顺、德妃清楚分开。
    box(g, m.cream, 0, 1.875, -.075, .29, .042, .055)
    for (const x of [-.11, .11]) box(g, m.cream, x, 1.77, -.08, .055, .22, .035)
    const foldedCloth = box(g, m.cream, -.33, .64, .16, .16, .13, .055, -.16)
    foldedCloth.rotation.z = -.12
    g.scale.set(.93, .96, .93)
    g.userData.silhouette = '青杏 · 浅色发带、收拢衣袖'
  }
  if (identity === 'defei') {
    // 原文直接写到她用帕子捂鼻；用一小片浅帕提示，而不把她做成夸张反派。
    const handkerchief = box(g, m.paper, -.25, 1.34, .23, .15, .20, .018, -.18)
    handkerchief.rotation.z = -.30
    box(g, m.gold, 0, 1.965, -.06, .54, .032, .048)
    g.userData.silhouette = '德妃 · 梅色礼服、帕子'
  }
  if (identity === 'emperor') g.userData.silhouette = '萧寻 · 明黄常服、冠饰'
  g.userData.kind = kind
  return g
}

function grassGeometry() {
  const points: number[] = []
  for (let i = 0; i < 5; i++) {
    const angle = i * Math.PI * .73
    const x = Math.cos(angle), z = Math.sin(angle)
    points.push(-x * .055, 0, -z * .055, x * .055, 0, z * .055, x * .13, .27 + i * .028, z * .13)
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(points, 3))
  geo.computeVertexNormals()
  return geo
}

export function buildConsortWorld(scene: THREE.Scene): ConsortWorld {
  const group = new THREE.Group()
  group.name = '景华宫 · 春日庭院'
  const m = palette()
  const colliders: THREE.Box3[] = []
  const anchors: Record<string, THREE.Vector3> = {}
  const actors: Record<string, THREE.Group> = {}
  const plots: THREE.Group[] = []
  const phases: { soil: THREE.Mesh; weeds: THREE.Object3D; tilled: THREE.Group; seeds: THREE.Object3D }[] = []
  const solid = (x: number, z: number, w: number, d: number, h = 3) => {
    const collider = new THREE.Box3(new THREE.Vector3(x - w / 2, 0, z - d / 2), new THREE.Vector3(x + w / 2, h, z + d / 2))
    colliders.push(collider)
    return collider
  }
  const anchor = (id: string, x: number, y: number, z: number) => { anchors[id] = new THREE.Vector3(x, y, z) }
  const shadowMat = new THREE.MeshLambertMaterial({ color: 0x5f503e, transparent: true, opacity: .16, depthWrite: false })
  const shadow = (x: number, z: number, w: number, d: number) => {
    const s = new THREE.Mesh(new THREE.CircleGeometry(1, 10), shadowMat)
    s.rotation.x = -Math.PI / 2; s.scale.set(w, d, 1); s.position.set(x, .026, z)
    group.add(s)
  }

  // Broad warm ground plane, inset paving and slightly irregular stone joints.
  box(group, m.earth, 0, -.18, 0, 18.3, .18, 20.3)
  const pavingGeo = new THREE.BoxGeometry(.91, .025, .91)
  const pavingPositions: [number, number][] = []
  for (let x = -8; x <= 8; x++) for (let z = -9; z <= 9; z++) {
    if (Math.abs(x) <= 1 || z >= 6 || z <= -6 || x >= 2 || x <= -7) pavingPositions.push([x, z])
  }
  const pavers = new THREE.InstancedMesh(pavingGeo, m.stoneLight, pavingPositions.length)
  const dummy = new THREE.Object3D(); const rng = random(171)
  pavingPositions.forEach(([x, z], i) => {
    dummy.position.set(x, -.006 + rng() * .008, z); dummy.rotation.set(0, (rng() - .5) * .028, 0)
    dummy.scale.set(1, 1, 1); dummy.updateMatrix(); pavers.setMatrixAt(i, dummy.matrix)
    pavers.setColorAt(i, new THREE.Color().setHSL(.11, .16, .75 + rng() * .14))
  })
  group.add(pavers)

  // Enclosing walls; no unreachable courtyard exits.
  for (const x of [-9, 9]) {
    box(group, m.plaster, x, 0, 0, .35, 2.85, 20)
    box(group, m.stone, x, 0, 0, .40, .5, 20)
    box(group, m.roof, x, 2.85, 0, .62, .18, 20.3)
    solid(x, 0, .42, 20.4)
  }
  box(group, m.plaster, 0, 0, -10, 18, 3.4, .36)
  solid(0, -10, 18, .42, 4)
  for (const x of [-5.25, 5.25]) {
    box(group, m.plaster, x, 0, 10, 7.5, 2.85, .36)
    box(group, m.stone, x, 0, 10, 7.5, .5, .4)
    box(group, m.roof, x, 2.85, 10, 7.7, .18, .65)
    solid(x, 10, 7.5, .42)
  }
  // South gate: two real leaves pivot on their hinges. Main.ts can open this before
  // revealing 萧寻, so "the gate was pushed open" is visible instead of being a line only.
  const gateLeaves = new THREE.Group(); gateLeaves.name = '景华宫 · 南门双扇'; group.add(gateLeaves)
  const buildGateLeaf = (side: -1 | 1) => {
    const pivot = new THREE.Group()
    pivot.name = side < 0 ? '南门 · 左扇' : '南门 · 右扇'
    pivot.position.set(side * 1.40, 0, 9.67)
    gateLeaves.add(pivot)
    const center = -side * .675
    box(pivot, m.redWood, center, .08, 0, 1.35, 2.54, .13)
    for (const y of [.53, 1.38, 2.22]) box(pivot, m.timber, center, y, -.11, 1.30, .11, .10)
    const ring = new THREE.Mesh(new THREE.TorusGeometry(.102, .021, 4, 8), m.gold)
    ring.rotation.y = Math.PI
    ring.position.set(-side * 1.16, 1.30, -.20)
    pivot.add(ring)
    // A dark inner frame keeps the opened silhouette legible against the pale sky.
    box(pivot, m.darkWood, center, .13, .075, 1.42, .08, .048)
    return pivot
  }
  const leftGateLeaf = buildGateLeaf(-1)
  const rightGateLeaf = buildGateLeaf(1)
  // Header and threshold stay in place, but there is deliberately no opaque back wall.
  box(group, m.darkWood, 0, 2.62, 9.86, 3.12, .25, .32)
  box(group, m.stone, 0, -.01, 9.70, 3.16, .11, .56)
  for (const x of [-1.65, 1.65]) box(group, m.redWood, x, 0, 9.85, .26, 3.08, .48)
  roof(group, m, 0, 3.02, 9.86, 4.1, 2.2, .66)
  // A small paved strip beyond the threshold becomes visible when the leaves swing in.
  box(group, m.stoneLight, 0, -.11, 10.86, 3.05, .05, 1.55)
  const gateCollider = solid(0, 9.85, 3.5, .45, 3.2)
  const shutGateCollider = gateCollider.clone()
  let gateOpen = false
  anchor('gate', 0, 1.25, 9.42)
  anchor('gateThreshold', 0, .12, 9.60)
  anchor('gateOutside', 0, .12, 10.82)

  // Main hall and storeroom front. Architecture is a backdrop; props face the open court.
  box(group, m.plaster, 0, 0, -8.8, 15.6, 3.15, 2.2)
  solid(0, -8.8, 15.6, 2.2, 4)
  box(group, m.stone, 0, 0, -7.78, 16, .19, .6)
  roof(group, m, 0, 3.17, -8.55, 17.0, 4.05, 1.14)
  box(group, m.timber, 0, 2.76, -7.64, 15.7, .2, .23)
  for (const x of [-7.35, -4.9, -2.45, 0, 2.45, 4.9, 7.35]) {
    cylinder(group, m.redWood, x, .12, -7.46, .105, .13, 2.75)
    cylinder(group, m.stone, x, 0, -7.46, .23, .26, .18)
    solid(x, -7.46, .31, .31)
  }
  for (const x of [-6.15, -3.68, 3.68, 6.15]) {
    box(group, m.darkWood, x, .8, -7.64, 1.65, 1.39, .06)
    box(group, m.paper, x, .87, -7.595, 1.49, 1.2, .025)
    for (let i = -2; i <= 2; i++) box(group, m.timber, x + i * .28, .86, -7.56, .04, 1.23, .03)
    for (let i = 0; i < 3; i++) box(group, m.timber, x, 1.04 + i * .40, -7.55, 1.52, .035, .04)
  }
  for (const x of [-.63, .63]) {
    box(group, m.redWood, x, .15, -7.62, 1.15, 2.26, .12)
    box(group, m.gold, x < 0 ? -.17 : .17, 1.13, -7.53, .055, .17, .025)
  }
  box(group, m.darkWood, 0, 2.44, -7.41, 2.15, .5, .1)
  if (typeof document !== 'undefined') {
    const canvas = document.createElement('canvas'); canvas.width = 256; canvas.height = 64
    const ctx = canvas.getContext('2d')
    if (ctx) {
      ctx.fillStyle = '#43382e'; ctx.fillRect(0, 0, 256, 64)
      ctx.fillStyle = '#d4bb80'; ctx.font = 'bold 42px "Songti SC", "SimSun", serif'
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('景华宫', 128, 34)
      const map = new THREE.CanvasTexture(canvas); map.colorSpace = THREE.SRGBColorSpace
      map.magFilter = map.minFilter = THREE.NearestFilter
      const sign = new THREE.Mesh(new THREE.PlaneGeometry(1.97, .43), new THREE.MeshLambertMaterial({ map }))
      sign.position.set(0, 2.71, -7.348); group.add(sign)
    }
  }

  // Side verandas frame the sky and garden without enclosing the walking route.
  for (const side of [-1, 1]) {
    const veranda = new THREE.Group(); veranda.position.set(side * 8.1, 0, -.4)
    veranda.rotation.y = Math.PI / 2; group.add(veranda)
    roof(veranda, m, 0, 2.8, 0, 13.6, 2.05, .53)
    box(group, m.timber, side * 7.18, 2.55, -.4, .15, .24, 13.4)
    for (const z of [-6.6, -3.5, -.4, 2.7, 5.8]) {
      cylinder(group, m.redWood, side * 7.18, .10, z, .1, .12, 2.52)
      cylinder(group, m.stone, side * 7.18, 0, z, .20, .23, .14)
      solid(side * 7.18, z, .30, .30)
    }
  }

  // Three distinct, completely walkable beds. Phase 3 shows seed marks, never grown produce.
  for (let i = 0; i < 3; i++) {
    const plot = new THREE.Group(); plot.position.set(-4.4, 0, 3.2 - i * 3.2)
    plot.name = `菜地 ${i + 1}`; plots.push(plot); group.add(plot)
    const soil = box(plot, m.dirt.clone(), 0, .004, 0, 3.65, .035, 2.42)
    for (const x of [-1.91, 1.91]) box(plot, m.stone, x, .01, 0, .15, .10, 2.66)
    for (const z of [-1.30, 1.30]) box(plot, m.stone, 0, .01, z, 3.98, .10, .15)
    const grassMat = m.grass.clone(); grassMat.side = THREE.DoubleSide
    const weeds = new THREE.InstancedMesh(grassGeometry(), grassMat, 56)
    const prng = random(813 + i)
    for (let n = 0; n < 56; n++) {
      dummy.position.set((prng() - .5) * 3.46, .044, (prng() - .5) * 2.18)
      dummy.rotation.set(0, prng() * Math.PI * 2, 0)
      const scale = .72 + prng() * .9; dummy.scale.set(scale, scale, scale)
      dummy.updateMatrix(); weeds.setMatrixAt(n, dummy.matrix)
      weeds.setColorAt(n, new THREE.Color().setHSL(.17 + prng() * .05, .23, .65 + prng() * .20))
    }
    plot.add(weeds)
    const tilled = new THREE.Group(); plot.add(tilled)
    for (let row = 0; row < 4; row++) box(tilled, m.furrow, 0, .043, -.84 + row * .56, 3.35, .014, .065)
    const clods = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(.085, 0), m.turned, 48)
    for (let n = 0; n < 48; n++) {
      dummy.position.set((prng() - .5) * 3.35, .057, (prng() - .5) * 2.11)
      dummy.rotation.set(0, prng() * 5, 0); dummy.scale.set(1 + prng(), .44, .65 + prng())
      dummy.updateMatrix(); clods.setMatrixAt(n, dummy.matrix)
    }
    tilled.add(clods)
    // The source ends at sowing: these are deliberately large, dry seed points and
    // low mounds, never leaves or grown radishes. They remain readable at PS1 range.
    const seeds = new THREE.Group(); seeds.name = '已播下的萝卜种子 · 未发芽'
    const seedMounds = new THREE.InstancedMesh(new THREE.ConeGeometry(.098, .052, 5), m.turned, 28)
    const seedDots = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(.052, 0), m.seed, 28)
    for (let n = 0; n < 28; n++) {
      const x = -1.38 + (n % 7) * .46
      const z = -.84 + Math.floor(n / 7) * .56
      dummy.position.set(x, .070, z)
      dummy.rotation.set(0, n * .57, 0); dummy.scale.set(1, 1, .82); dummy.updateMatrix(); seedMounds.setMatrixAt(n, dummy.matrix)
      dummy.position.set(x, .112, z)
      dummy.rotation.set(n * .21, n * .43, 0); dummy.scale.set(1, .62, 1); dummy.updateMatrix(); seedDots.setMatrixAt(n, dummy.matrix)
    }
    seeds.add(seedMounds, seedDots)
    plot.add(seeds); phases.push({ soil, weeds, tilled, seeds })
    anchor(`plot${i}`, -4.4, .55, 3.2 - i * 3.2)
  }

  // The book trunk: exactly two copies of Sunzi and the seed packet.
  const trunk = new THREE.Group(); trunk.position.set(-5.45, 0, 6.45); group.add(trunk)
  box(trunk, m.darkWood, 0, .07, 0, 1.42, .58, .76)
  box(trunk, m.timber, 0, .10, .40, 1.47, .54, .045)
  for (const x of [-.53, .53]) box(trunk, m.gold, x, .08, .43, .055, .59, .032)
  const lid = box(trunk, m.timber, 0, .67, -.37, 1.47, .64, .065)
  lid.rotation.x = -.17
  box(trunk, m.gold, 0, .30, .443, .13, .13, .03)
  for (let i = 0; i < 2; i++) {
    const volume = box(trunk, i ? m.blue : m.teal, -.25, .65 + i * .09, .035, .4, .085, .5, .035 * i)
    volume.name = `孙子兵法 · 第 ${i + 1} 册`
    box(trunk, m.paper, -.25, .67 + i * .09, .285, .35, .043, .012)
  }
  const seedPacket = box(trunk, m.paper, .30, .655, .035, .32, .07, .36, -.12)
  seedPacket.name = '萝卜种子包'
  box(seedPacket, m.timber, 0, .035, 0, .018, .005, .36)
  box(seedPacket, m.timber, 0, .035, 0, .32, .005, .018)
  solid(-5.45, 6.45, 1.45, .82, 1.4); anchor('trunk', -5.45, .94, 6.51); shadow(-5.4, 6.45, .94, .61)

  // Tools are beside the beds. A short hoe and straw basket read clearly in first person.
  const tool = new THREE.Group(); tool.position.set(-5.7, 0, -5.45); group.add(tool)
  const shaft = cylinder(tool, m.timber, 0, .12, 0, .027, .032, 1.38, 6); shaft.rotation.z = -.16
  box(tool, m.black, -.12, .06, .08, .34, .10, .28)
  cylinder(tool, m.ochre, .52, .015, .12, .28, .20, .31)
  cylinder(tool, m.darkWood, .52, .30, .12, .23, .23, .016)
  anchor('tool', -5.7, .75, -5.38)

  // Washing basin with a polygonal lip, still water and folded cloth.
  const basin = new THREE.Group(); basin.position.set(5.75, 0, 1.0); group.add(basin)
  cylinder(basin, m.stone, 0, 0, 0, .40, .44, .17)
  cylinder(basin, m.porcelain, 0, .17, 0, .55, .37, .44, 10)
  const rim = new THREE.Mesh(new THREE.TorusGeometry(.515, .06, 4, 10), m.porcelain)
  rim.rotation.x = Math.PI / 2; rim.position.y = .61; basin.add(rim)
  cylinder(basin, m.water, 0, .594, 0, .476, .476, .012, 10)
  box(basin, m.cream, .42, .58, .13, .25, .038, .31, .3)
  solid(5.75, 1, 1.02, 1.02, .7); anchor('basin', 5.75, .8, 1.0); shadow(5.75, 1, .74, .70)

  // Stone table with a simplified Go-like prop matching the game's 7×7 study diagram.
  const table = new THREE.Group(); table.position.set(4.3, 0, -3.7); group.add(table)
  cylinder(table, m.stone, 0, .05, 0, .23, .38, .70)
  cylinder(table, m.stoneLight, 0, .75, 0, 1.0, 1.04, .17, 8)
  box(table, m.ochre, 0, .925, 0, 1.17, .045, 1.17)
  // Added game visualization: neither an original-source record nor complete Go rules.
  table.userData.chessRepresentation = '游戏新增 7×7 棋势示意；非原作棋谱，非完整围棋规则'
  for (let i = 0; i < 7; i++) {
    const p = -.51 + i * 1.02 / 6
    box(table, m.darkWood, p, .973, 0, .004, .003, 1.025)
    box(table, m.darkWood, 0, .973, p, 1.025, .003, .004)
  }
  // Initial positions match main.ts: the 3 white stones and 5 surrounding black stones.
  const stones = [[2, 3, 1], [3, 3, 1], [4, 3, 1], [3, 2, 0], [4, 2, 0], [2, 4, 0], [4, 4, 0], [1, 3, 0]]
  for (const [x, z, white] of stones) cylinder(table, white ? m.cream : m.black, -.51 + x * 1.02 / 6, .981, -.51 + z * 1.02 / 6, .063, .065, .023, 8)
  for (const x of [-.80, .80]) {
    cylinder(table, m.darkWood, x, .925, .14, .12, .08, .13)
    cylinder(table, x < 0 ? m.black : m.cream, x, 1.043, .14, .095, .095, .006)
  }
  for (const [x, z] of [[4.3, -5.13], [4.3, -2.26]]) {
    cylinder(group, m.stone, x, 0, z, .20, .25, .40)
    cylinder(group, m.stoneLight, x, .40, z, .33, .30, .10)
    solid(x, z, .55, .55, .53)
  }
  solid(4.3, -3.7, 1.85, 1.85, 1.05); anchor('chess', 3.56, 1.1, -3.7); shadow(4.3, -3.7, 1.26, 1.15)

  // A restrained old tree beyond the garden gives the abandoned court a living silhouette.
  const tree = new THREE.Group(); tree.position.set(-7.98, 0, -5.03); group.add(tree)
  cylinder(tree, m.timber, 0, 0, 0, .13, .22, 2.6, 6)
  const branch = cylinder(tree, m.timber, .25, 1.65, 0, .06, .12, 1.25, 5); branch.rotation.z = -.52
  sphere(tree, m.leaf, .25, 3.05, -.15, .91, 1.5, .63, 1.05)
  sphere(tree, m.grass, -.48, 2.75, .22, .72, 1.25, .73, 1.0)
  solid(-7.98, -5.03, .42, .42, 3)

  const actorDefs: [string, string, 'servant' | 'maid' | 'consort' | 'emperor', number, number, number][] = [
    ['fushun', 'blue', 'servant', 2.15, 5.55, -.35],
    ['qingxing', 'teal', 'maid', -2.05, 4.75, .65],
    ['defei', 'plum', 'consort', 2.7, .10, -.25],
    ['emperor', 'ochre', 'emperor', 5.55, -5.22, -.45],
  ]
  for (const [id, cloth, kind, x, z, yaw] of actorDefs) {
    const actor = person(m, cloth, kind, id as CourtActor); actor.name = id; actor.position.set(x, 0, z); actor.rotation.y = yaw
    actors[id] = actor; group.add(actor); anchor(id, x, 1.1, z)
    // Actor shadows are children so hiding a story visitor also hides their shadow.
    const s = new THREE.Mesh(new THREE.CircleGeometry(.43, 8), shadowMat)
    s.rotation.x = -Math.PI / 2; s.position.y = .026; s.scale.y = .72; actor.add(s)
  }
  actors.defei.visible = false; actors.emperor.visible = false
  // After the listening scene Qingxing can stand by the east veranda, away from plot 1.
  // The main flow chooses when to call moveActor; this is only a safe destination.
  anchor('qingxingRest', 5.95, 1.1, 5.45)

  // One world-owned marker has enough height and contrast to survive 320×240 output.
  // It stays single-target so the courtyard does not turn into a field of quest icons.
  const goalMarker = new THREE.Group(); goalMarker.name = '金色引导标记'
  const guideMat = new THREE.MeshBasicMaterial({ color: 0xf4d98a, transparent: true, opacity: .92, depthWrite: false })
  const guideHaloMat = new THREE.MeshBasicMaterial({ color: 0xffedac, transparent: true, opacity: .54, depthWrite: false })
  const guideRing = new THREE.Mesh(new THREE.TorusGeometry(.43, .023, 4, 16), guideMat)
  guideRing.rotation.x = Math.PI / 2; guideRing.position.y = .058; goalMarker.add(guideRing)
  const guideHalo = new THREE.Mesh(new THREE.TorusGeometry(.31, .012, 4, 12), guideHaloMat)
  guideHalo.rotation.x = Math.PI / 2; guideHalo.position.y = .076; goalMarker.add(guideHalo)
  const guideStem = new THREE.Mesh(new THREE.CylinderGeometry(.018, .027, .72, 4), guideMat)
  guideStem.position.y = .47; goalMarker.add(guideStem)
  const guideDiamond = new THREE.Mesh(new THREE.OctahedronGeometry(.145, 0), guideMat)
  guideDiamond.position.y = .99; goalMarker.add(guideDiamond)
  const guideCap = new THREE.Mesh(new THREE.OctahedronGeometry(.052, 0), guideHaloMat)
  guideCap.position.y = 1.22; goalMarker.add(guideCap)
  guideDiamond.onBeforeRender = () => {
    const t = performance.now() * .001
    guideDiamond.position.y = .99 + Math.sin(t * 2.2) * .055
    guideDiamond.rotation.y = t * .75
    const pulse = 1 + Math.sin(t * 2.2) * .10
    guideHalo.scale.setScalar(pulse)
  }
  group.add(goalMarker)

  const setGoalMarker = (id: string | null) => {
    const point = id ? anchors[id] : undefined
    goalMarker.visible = !!point
    if (!point || !id) return
    goalMarker.position.set(point.x, .01, point.z)
    goalMarker.userData.target = id
  }
  // The cover's first playable target is the trunk. Later phases can move this by API.
  setGoalMarker('trunk')

  // Clear spring daylight. The caller owns renderer and camera; no fear/myopia state lives here.
  const ambient = new THREE.HemisphereLight(0xe4f0ec, 0xb79564, 2.05)
  const sun = new THREE.DirectionalLight(0xffdfa9, 2.45)
  sun.position.set(-8, 15, 9); sun.target.position.set(1, 0, -2)
  group.add(ambient, sun, sun.target)
  scene.background = new THREE.Color(0xbecfca)
  scene.fog = new THREE.Fog(0xbecfca, 34, 70)
  scene.add(group)

  const setPlot = (index: number, phase: 0 | 1 | 2 | 3) => {
    const parts = phases[index]
    if (!parts) return
    parts.weeds.visible = phase === 0
    parts.tilled.visible = phase >= 2
    parts.seeds.visible = phase === 3
    ;(parts.soil.material as THREE.MeshLambertMaterial).color.setHex(phase >= 2 ? 0x76563d : 0x9c825e)
    plots[index].userData.phase = phase
  }
  for (let i = 0; i < 3; i++) setPlot(i, 0)

  const setGateOpen = (open: boolean) => {
    if (gateOpen === open) return
    gateOpen = open
    // Each leaf swings toward the courtyard from its outer hinge, leaving the
    // threshold visibly clear while the emperor remains outside until main reveals him.
    leftGateLeaf.rotation.y = open ? Math.PI * .62 : 0
    rightGateLeaf.rotation.y = open ? -Math.PI * .62 : 0
    if (open) gateCollider.makeEmpty()
    else gateCollider.copy(shutGateCollider)
    group.userData.gateOpen = open
  }
  group.userData.gateOpen = false

  const moveActor = (id: string, destination: string | THREE.Vector3) => {
    const actor = actors[id]
    const point = typeof destination === 'string' ? anchors[destination] : destination
    if (!actor || !point) return
    actor.position.set(point.x, 0, point.z)
    if (anchors[id]) anchors[id].set(point.x, anchors[id].y, point.z)
    actor.userData.currentAnchor = typeof destination === 'string' ? destination : 'custom'
  }

  group.userData.courtyardBounds = { minX: -8.75, maxX: 8.75, minZ: -7.6, maxZ: 9.4 }
  group.userData.facing = 'spawn faces north (-Z), yaw=0'
  return {
    group, colliders, spawn: new THREE.Vector3(0, 1.6, 7.8), anchors, actors, plots,
    setPlot,
    setActorVisible(id, visible) { if (actors[id]) actors[id].visible = visible },
    moveActor,
    setGoalMarker,
    setGateOpen,
  }
}
