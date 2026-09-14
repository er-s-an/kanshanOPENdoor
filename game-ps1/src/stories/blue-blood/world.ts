import * as THREE from 'three';

export type SceneKind = 'training' | 'washroom' | 'office' | 'home' | 'exam' | 'restaurant' | 'street';

export interface World {
  group: THREE.Group;
  spawn: THREE.Vector3;
  target: THREE.Vector3;
  colliders: THREE.Box3[];
  anchors: Record<string, THREE.Vector3>;
  actors: Record<string, THREE.Group>;
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
}

const C = {
  cream: 0xe3dcc2, plaster: 0xc5cebf, teal: 0x417c7c, navy: 0x32475b,
  wood: 0x9b694a, woodLight: 0xc39668, metal: 0x69777b, paper: 0xece6d1,
  blue: 0x548b9d, yellow: 0xe7b95b, white: 0xecece0, skin: 0xc7a38e,
};

const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

/** Entirely procedural PS1-style set dressing. Main owns the camera and global lighting. */
class SetBuilder {
  world: World = {
    group: new THREE.Group(), spawn: v(0, 1.6, 3.65), target: v(0, 1.6, -2),
    colliders: [], anchors: {}, actors: {}, bounds: { minX: -4.75, maxX: 4.75, minZ: -4.75, maxZ: 4.75 },
  };
  private materials = new Map<number, THREE.MeshLambertMaterial>();

  mat(color: number) {
    if (!this.materials.has(color)) this.materials.set(color, new THREE.MeshLambertMaterial({ color, flatShading: true }));
    return this.materials.get(color)!;
  }

  box(x: number, y: number, z: number, w: number, h: number, d: number, color: number, solid = false, parent = this.world.group) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), this.mat(color));
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    parent.add(mesh);
    if (solid) this.world.colliders.push(new THREE.Box3(v(x - w / 2, y - h / 2, z - d / 2), v(x + w / 2, y + h / 2, z + d / 2)));
    return mesh;
  }

  cylinder(x: number, y: number, z: number, r: number, h: number, color: number, parent = this.world.group, sides = 8) {
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, sides), this.mat(color));
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  }

  anchor(name: string, x: number, y: number, z: number) { this.world.anchors[name] = v(x, y, z); }

  sign(text: string, x: number, y: number, z: number, w: number, h: number, background = '#365961', ink = '#f4ecd0', yaw = 0) {
    const canvas = document.createElement('canvas');
    canvas.width = 1024;
    canvas.height = Math.max(192, Math.round(1024 * h / w));
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.fillStyle = background;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.strokeStyle = ink;
      ctx.globalAlpha = 0.35;
      ctx.lineWidth = 8;
      ctx.strokeRect(16, 16, canvas.width - 32, canvas.height - 32);
      ctx.globalAlpha = 1;
      ctx.fillStyle = ink;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const lines = text.split('\n');
      const size = Math.min(canvas.height / (lines.length * 1.8), canvas.width / Math.max(...lines.map(line => [...line].length), 1) * 0.8);
      ctx.font = `600 ${size}px "PingFang SC", "Microsoft YaHei", sans-serif`;
      lines.forEach((line, i) => ctx.fillText(line, canvas.width / 2, canvas.height / 2 + (i - (lines.length - 1) / 2) * size * 1.45));
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    const material = new THREE.MeshLambertMaterial({ map: texture, side: THREE.DoubleSide, emissive: 0xffffff, emissiveIntensity: 0.12 });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), material);
    mesh.position.set(x, y, z);
    mesh.rotation.y = yaw;
    this.world.group.add(mesh);
    return mesh;
  }

  room(floor = 0xb4b29f, wall = C.cream) {
    this.box(0, -0.12, 0, 10, 0.24, 10, floor);
    this.box(0, 1.7, -4.95, 10, 3.4, 0.18, wall, true);
    this.box(0, 1.7, 4.95, 10, 3.4, 0.18, wall, true);
    this.box(-4.95, 1.7, 0, 0.18, 3.4, 10, wall, true);
    this.box(4.95, 1.7, 0, 0.18, 3.4, 10, wall, true);
    for (const z of [-4.83, 4.83]) this.box(0, 0.14, z, 9.8, 0.28, 0.08, C.teal);
    for (const x of [-4.83, 4.83]) this.box(x, 0.14, 0, 0.08, 0.28, 9.8, C.teal);
    for (let i = -4; i <= 4; i++) {
      this.box(i, 0.005, 0, 0.012, 0.008, 9.8, 0x93988d);
      this.box(0, 0.005, i, 9.8, 0.008, 0.012, 0x93988d);
    }
    for (const x of [-2.6, 2.6]) {
      this.box(x, 3.25, 0, 1.5, 0.06, 0.4, C.metal);
      const diffuser = this.box(x, 3.2, 0, 1.32, 0.045, 0.28, C.white);
      diffuser.material = new THREE.MeshLambertMaterial({ color: 0xfff4cb, emissive: 0xfff4cb, emissiveIntensity: 0.8 });
    }
  }

  window(x: number, z: number, yaw = 0, w = 2.6) {
    const group = new THREE.Group();
    group.position.set(x, 1.95, z);
    group.rotation.y = yaw;
    this.world.group.add(group);
    const sky = this.box(0, 0, 0, w, 1.5, 0.06, 0x9bcad0, false, group);
    sky.material = new THREE.MeshLambertMaterial({ color: 0xa3c9ca, emissive: 0x7eacb6, emissiveIntensity: 0.5 });
    this.box(0, -0.42, 0.05, w, 0.62, 0.02, 0x8da5a0, false, group);
    for (const sx of [-1, 1]) this.box(sx * w / 2, 0, 0.08, 0.09, 1.68, 0.12, C.white, false, group);
    for (const sy of [-1, 1]) this.box(0, sy * 0.8, 0.08, w + 0.08, 0.09, 0.12, C.white, false, group);
    this.box(0, 0, 0.08, 0.055, 1.6, 0.12, C.white, false, group);
    this.box(0, -0.79, 0.21, w + 0.16, 0.1, 0.4, C.woodLight, false, group);
  }

  door(x: number, z: number, label: string, yaw = Math.PI) {
    const door = new THREE.Group();
    door.position.set(x, 0, z);
    door.rotation.y = yaw;
    this.world.group.add(door);
    this.box(0, 1.14, 0, 1.25, 2.28, 0.12, C.wood, false, door);
    for (const sx of [-1, 1]) this.box(sx * 0.66, 1.16, 0.05, 0.08, 2.4, 0.18, C.woodLight, false, door);
    this.box(0, 2.32, 0.05, 1.4, 0.1, 0.18, C.woodLight, false, door);
    this.box(0.43, 1.07, 0.1, 0.14, 0.055, 0.09, C.yellow, false, door);
    this.sign(label, x, 2.58, z + Math.cos(yaw) * 0.11, 1.3, 0.35, '#477265', '#f4ecd0', yaw);
  }

  table(x: number, z: number, w = 1.65, d = 1, color = C.woodLight, y = 0.9) {
    this.box(x, y, z, w, 0.12, d, color, true);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) this.box(x + sx * (w / 2 - 0.12), y / 2, z + sz * (d / 2 - 0.12), 0.08, y, 0.08, C.metal);
    return y + 0.06;
  }

  chair(x: number, z: number, yaw = 0, color = C.teal, solid = true) {
    const group = new THREE.Group();
    group.position.set(x, 0, z);
    group.rotation.y = yaw;
    this.world.group.add(group);
    this.box(0, 0.47, 0, 0.52, 0.12, 0.5, color, false, group);
    this.box(0, 0.79, 0.21, 0.52, 0.57, 0.09, color, false, group);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) this.box(sx * 0.2, 0.23, sz * 0.18, 0.05, 0.46, 0.05, C.metal, false, group);
    if (solid) this.world.colliders.push(new THREE.Box3(v(x - 0.29, 0, z - 0.29), v(x + 0.29, 1.08, z + 0.29)));
  }

  person(name: string, x: number, z: number, jacket = C.navy, yaw = 0, solid = true) {
    const actor = new THREE.Group();
    actor.name = name;
    actor.position.set(x, 0, z);
    actor.rotation.y = yaw;
    this.world.group.add(actor);
    this.world.actors[name] = actor;
    for (const sx of [-1, 1]) {
      this.box(sx * 0.14, 0.42, 0, 0.2, 0.76, 0.23, 0x3c4449, false, actor);
      this.box(sx * 0.14, 0.08, 0.07, 0.23, 0.16, 0.36, 0x3e3c39, false, actor);
      this.box(sx * 0.36, 1.04, 0, 0.16, 0.59, 0.22, jacket, false, actor).name = sx < 0 ? 'armLeft' : 'armRight';
      this.box(sx * 0.36, 0.71, 0, 0.14, 0.16, 0.15, C.skin, false, actor).name = sx < 0 ? 'handLeft' : 'handRight';
    }
    this.box(0, 1.11, 0, 0.55, 0.66, 0.32, jacket, false, actor);
    this.box(0, 1.22, 0.172, 0.055, 0.4, 0.013, 0xb9b5a9, false, actor);
    this.cylinder(0, 1.46, 0, 0.09, 0.13, C.skin, actor, 6);
    const head = new THREE.Group();
    head.name = 'head';
    head.position.set(0, 1.6, 0);
    actor.add(head);
    this.box(0, 0, 0, 0.29, 0.34, 0.29, C.skin, false, head);
    this.box(0, 0.14, -0.025, 0.31, 0.12, 0.29, 0x383a3a, false, head);
    this.box(-0.074, 0.017, 0.151, 0.037, 0.023, 0.014, 0x333d42, false, head);
    this.box(0.074, 0.017, 0.151, 0.037, 0.023, 0.014, 0x333d42, false, head);
    this.box(0, -0.035, 0.171, 0.06, 0.065, 0.07, C.skin, false, head);
    if (solid) this.world.colliders.push(new THREE.Box3(v(x - 0.4, 0, z - 0.28), v(x + 0.4, 1.8, z + 0.28)));
    return actor;
  }

  plant(x: number, z: number, scale = 1) {
    this.cylinder(x, 0.22 * scale, z, 0.24 * scale, 0.44 * scale, 0xa4775b);
    this.cylinder(x, 0.58 * scale, z, 0.035 * scale, 0.65 * scale, C.wood);
    for (let i = 0; i < 5; i++) {
      const leaf = new THREE.Mesh(new THREE.IcosahedronGeometry(0.33 * scale, 0), this.mat(i % 2 ? 0x638674 : 0x436d59));
      leaf.position.set(x + Math.sin(i * 2.4) * 0.18 * scale, (0.65 + i * 0.1) * scale, z + Math.cos(i * 2.4) * 0.15 * scale);
      leaf.scale.set(0.9, 1.25, 0.8);
      this.world.group.add(leaf);
    }
  }

  papers(x: number, y: number, z: number, count = 3) {
    for (let i = 0; i < count; i++) {
      const page = this.box(x + i * 0.025, y + i * 0.008, z - i * 0.016, 0.34, 0.007, 0.46, C.paper);
      page.rotation.y = i * 0.06;
    }
    for (let i = 0; i < 5; i++) this.box(x, y + count * 0.008 + 0.001, z - 0.15 + i * 0.055, 0.22, 0.002, 0.008, 0x7c8985);
  }

  computer(x: number, z: number, y = 0.97) {
    this.box(x, y + 0.035, z, 0.78, 0.055, 0.54, C.navy);
    this.box(x, y + 0.29, z - 0.23, 0.76, 0.51, 0.06, C.navy);
    const screen = this.box(x, y + 0.29, z - 0.192, 0.65, 0.39, 0.015, 0x77a8a9);
    screen.material = new THREE.MeshLambertMaterial({ color: 0xb9ded2, emissive: 0x709ca5, emissiveIntensity: 0.55 });
    for (let i = 0; i < 4; i++) this.box(x, y + 0.19 + i * 0.07, z - 0.181, 0.45 - i * 0.035, 0.018, 0.006, 0x54717b);
    this.box(x, y + 0.071, z + 0.015, 0.58, 0.007, 0.2, 0x6b8186);
  }

  shelf(x: number, z: number, width = 1.7, yaw = 0) {
    const group = new THREE.Group();
    group.position.set(x, 0, z);
    group.rotation.y = yaw;
    this.world.group.add(group);
    this.box(0, 1.05, -0.2, width, 2.1, 0.08, C.wood, false, group);
    for (const sx of [-1, 1]) this.box(sx * width / 2, 1.05, 0, 0.1, 2.1, 0.48, C.woodLight, false, group);
    const palette = [0x526f7b, 0x9c614f, 0xc2ae70, 0x778969, 0x9b9d95];
    for (let row = 0; row < 4; row++) {
      this.box(0, 0.1 + row * 0.52, 0, width, 0.07, 0.48, C.woodLight, false, group);
      for (let i = 0; i < 8; i++) {
        const bookX = -width / 2 + 0.14 + i * ((width - 0.24) / 8);
        this.box(bookX, 0.31 + row * 0.52, 0, 0.11, 0.3 + (i % 3) * 0.04, 0.27, palette[(i + row) % palette.length], false, group);
      }
    }
    const halfX = Math.abs(Math.cos(yaw)) * (width / 2 + 0.05) + Math.abs(Math.sin(yaw)) * 0.24;
    const halfZ = Math.abs(Math.sin(yaw)) * (width / 2 + 0.05) + Math.abs(Math.cos(yaw)) * 0.24;
    this.world.colliders.push(new THREE.Box3(v(x - halfX, 0, z - halfZ), v(x + halfX, 2.1, z + halfZ)));
  }
}

function training(b: SetBuilder) {
  b.room(0xb6b3a1, 0xe0decb);
  b.box(0, 1.95, -4.82, 4.8, 1.4, 0.09, 0x386d63);
  b.sign('急 救 培 训\n请认真阅读急救培训教材', 0, 2.02, -4.755, 4.45, 1.03, '#386d63');
  b.table(0, -2.8, 2.15, 0.8, C.wood);
  // A small first-aid demonstration mannequin, the model indicated in L5.
  b.box(0.19, 1.09, -2.8, 0.66, 0.2, 0.35, 0xcbaa91);
  b.box(-0.31, 1.11, -2.8, 0.27, 0.23, 0.25, 0xcbaa91);
  b.box(0.16, 1.05, -2.53, 0.58, 0.13, 0.13, 0xcbaa91);
  b.box(0.16, 1.05, -3.06, 0.58, 0.13, 0.13, 0xcbaa91);
  b.person('teacher', 0, -3.75, 0x5b6c70);
  b.table(-2.65, -1.35, 1.8, 1.15);
  b.box(-2.7, 1.005, -1.4, 0.49, 0.095, 0.65, 0x9b594d);
  b.sign('急救培训教材', -2.69, 1.065, -1.4, 0.4, 0.14, '#9b594d').rotation.x = -Math.PI / 2;
  b.table(2.6, -1.35, 1.8, 1.15);
  // Fang Nuo checks her phone here (L10), not a desktop terminal.
  b.box(2.6, 1.015, -1.35, 0.28, 0.05, 0.47, 0x273b48);
  b.box(2.6, 1.044, -1.35, 0.23, 0.008, 0.36, 0x83b6c5);
  for (const x of [-2.65, 2.6]) b.chair(x, -0.35);
  b.chair(-2.65, 2, 0, 0x8d9e89);
  b.chair(2.6, 2, 0, 0x8d9e89);
  const colleagueA = b.person('colleagueA', -2.65, 1.98, 0x7d8583, Math.PI, false);
  const colleagueB = b.person('zhangWei', 2.6, 1.98, 0xa08b7d, Math.PI, false);
  for (const colleague of [colleagueA, colleagueB]) { colleague.scale.y = 0.84; colleague.position.y = 0.02; }

  b.window(4.82, -1.7, -Math.PI / 2, 3.0);
  b.shelf(-4.1, -3.9, 1.3);
  b.plant(4.1, -3.8);
  b.door(-3.75, 4.82, '走 廊');
  b.anchor('teacher', 0, 1.6, -3.75);
  b.anchor('book', -2.7, 1.05, -1.4);
  b.anchor('search', 2.6, 1.25, -1.35);
  b.anchor('exit', -3.75, 1.4, 4.5);
}

function washroom(b: SetBuilder) {
  b.room(0xb9c9c5, 0xd7e5dd);
  for (let y = 0.55; y < 1.7; y += 0.45) b.box(0, y, -4.83, 9.7, 0.025, 0.02, 0x9eb8b4);
  b.window(4.81, 0.9, -Math.PI / 2, 3.0);

  // Fang Nuo starts INSIDE this stall, north of z=-0.8. The front leaf has
  // a true 0.25 m viewing slit, x=-4.095..-3.845. Thin 4 cm partitions keep
  // the mirror, the colleague's side/front face and her tissue in one sightline.
  b.box(-4.4625, 1.12, -0.8, 0.735, 2.24, 0.04, 0x8fac9f, true).name = 'stallDoorLeft';
  b.box(-2.5475, 1.12, -0.8, 2.595, 2.24, 0.04, 0x9fb5a6, true).name = 'stallDoorRight';
  b.box(-3.69, 1.03, -0.835, 0.075, 0.055, 0.055, C.metal);
  b.box(-3.04, 2.29, -0.8, 3.57, 0.08, 0.08, C.white);
  // A separate full-width side doorway, z=-3.05..-1.95, connects to the
  // shared washroom. Its short privacy return prevents a direct spawn view.
  b.box(-1.25, 1.12, -3.94, 0.07, 2.24, 1.78, 0x8fac9f, true);
  b.box(-1.25, 1.12, -1.375, 0.07, 2.24, 1.15, 0x8fac9f, true);
  b.box(-1.25, 2.29, -2.5, 0.09, 0.08, 1.17, C.white);
  b.box(-0.16, 1.12, -1.76, 2.18, 2.24, 0.07, 0x8fac9f, true);
  b.box(-2.43, 0.23, -3.65, 0.74, 0.44, 1.1, C.white, true);
  b.box(-2.43, 0.79, -4.13, 0.75, 0.9, 0.38, C.white);
  b.box(-2.43, 0.48, -3.62, 0.63, 0.08, 0.83, 0xd9e3d9);
  b.box(-2.43, 0.526, -3.54, 0.38, 0.012, 0.48, 0x8a9c97);
  b.box(-1.63, 0.34, -4.21, 0.34, 0.66, 0.38, 0x7c9387, true);
  b.box(-4.71, 1.0, -2.15, 0.18, 0.3, 0.31, C.white);
  b.sign('隔 间', -2.68, 1.84, -4.8, 1.0, 0.34, '#8caba1');

  // Counter and mirror are OUTSIDE the stall, against the west wall.
  b.box(-4.26, 0.89, 1.85, 1.08, 0.18, 2.7, 0xadc3bc, true);
  for (const z of [1.12, 2.55]) {
    b.box(-4.23, 1.015, z, 0.78, 0.1, 1.02, C.white);
    b.box(-4.16, 1.071, z, 0.55, 0.018, 0.75, 0x7e9998);
    b.box(-4.57, 1.15, z, 0.075, 0.21, 0.085, C.metal);
    b.box(-4.47, 1.26, z, 0.27, 0.075, 0.085, C.metal);
  }
  const mirror = b.box(-4.79, 1.89, 1.85, 0.055, 1.33, 2.65, 0xb3ccd0);
  mirror.name = 'washroomMirror';
  mirror.material = new THREE.MeshLambertMaterial({ color: 0xb3ccd0, emissive: 0x8aadaa, emissiveIntensity: 0.3 });
  for (const z of [0.5, 3.2]) b.box(-4.73, 1.89, z, 0.1, 1.43, 0.07, C.white);
  for (const y of [1.19, 2.59]) b.box(-4.73, y, 1.85, 0.1, 0.07, 2.75, C.white);
  b.box(-4.5, 1.2, 1.84, 0.16, 0.22, 0.17, 0xd7b56e);
  b.sign('请 节 约 用 水', -4.8, 2.95, 1.85, 2.2, 0.36, '#76938c', '#f4ecd0', Math.PI / 2);

  // Facing northwest towards the mirror also exposes her near-side cheek
  // to the camera behind the slit. The tissue is a named Mesh for main.
  const colleague = b.person('colleague', -3.05, 1.6, 0x6b8083, -1.9);
  for (const name of ['armLeft', 'handLeft']) {
    const restingLimb = colleague.getObjectByName(name);
    if (restingLimb) colleague.remove(restingLimb);
  }
  const sleeve = b.box(-0.3, 1.17, 0.09, 0.16, 0.35, 0.2, 0x6b8083, false, colleague);
  sleeve.rotation.x = -0.58;
  const forearm = b.box(-0.235, 1.29, 0.21, 0.13, 0.24, 0.14, 0x6b8083, false, colleague);
  forearm.rotation.z = -0.45;
  b.box(-0.16, 1.33, 0.255, 0.11, 0.1, 0.1, C.skin, false, colleague);
  const tissue = b.box(-0.19, 1.40, 0.29, 0.19, 0.14, 0.022, C.white, false, colleague);
  tissue.name = 'whiteTissue';
  tissue.rotation.z = -0.16;
  b.box(-0.195, 1.405, 0.305, 0.009, 0.11, 0.003, 0xc7d1c6, false, colleague);
  b.box(4.26, 0.35, 3.8, 0.58, 0.7, 0.58, 0x6e8884, true);
  b.door(2.65, 4.82, '办 公 区');
  b.anchor('ownBlood', -3.03, 1.35, -2.85);
  b.anchor('gap', -4.0, 1.6, -1.12);
  b.anchor('gapCamera', -4.0, 1.6, -1.32);
  b.anchor('gapLook', -3.48, 1.59, 1.56);
  b.anchor('exit', 2.65, 1.4, 4.5);
  b.world.spawn.set(-3.45, 1.6, -2.72);
  b.world.target.set(-3.03, 1.35, -2.85);
}

function office(b: SetBuilder) {
  b.room(0x9ba59e, 0xdedbca);
  b.box(-0.6, 0.025, -1.9, 4.6, 0.025, 3.3, 0x687d78);
  b.table(-0.55, -2.55, 2.6, 1.25, C.wood);
  b.computer(-1.22, -2.62);
  b.papers(0.1, 0.975, -2.44);
  b.chair(-0.5, -3.6, Math.PI, C.navy);
  b.chair(-1.1, -1.1);
  b.person('manager', 1.55, -2.55, 0x5b6674, -0.45);
  b.shelf(-3.65, -4.4, 1.6);
  b.shelf(3.3, -4.4, 2.0);
  b.window(4.82, 0.65, -Math.PI / 2, 3.3);
  b.plant(3.85, 3.65, 1.2);
  b.sign('各 尽 其 职', 0, 2.45, -4.82, 2.55, 0.55, '#747e73');
  b.box(-3.65, 0.42, 1.2, 1.5, 0.78, 2.3, 0x728984, true);
  b.box(-4.24, 0.9, 1.2, 0.3, 0.8, 2.3, 0x5d7772);
  b.door(2.1, 4.82, '办 公 区');
  b.anchor('manager', 1.55, 1.6, -2.55);
  b.anchor('exit', 2.1, 1.4, 4.5);
  b.world.target.set(1.55, 1.6, -2.55);
}

function home(b: SetBuilder) {
  b.room(0xb29a7b, 0xd4d8c7);
  b.box(0, 0.02, 0.7, 3.3, 0.025, 3.6, 0x83958d);
  for (let z = -4.5; z < 5; z += 0.45) b.box(0, 0.014, z, 9.7, 0.01, 0.012, 0x927c62);
  b.table(-2.9, -3.2, 2.7, 1.2, C.woodLight);
  b.computer(-3.35, -3.3);
  b.papers(-2.25, 0.975, -3.1, 4);
  b.chair(-3.2, -2.12, 0, 0x738d8e);
  b.box(2.95, 0.32, -0.4, 2.0, 0.56, 3.5, C.wood, true);
  b.box(2.95, 0.67, -0.35, 1.9, 0.2, 3.35, 0xdedbca);
  b.box(2.95, 0.81, 0.2, 1.93, 0.1, 2.28, 0x759a9c);
  b.box(2.95, 0.81, -1.48, 1.2, 0.16, 0.6, 0xece6d1);
  b.box(2.95, 0.82, -2.18, 2.1, 1.35, 0.15, C.woodLight, true);
  b.box(4.28, 0.48, -1.65, 0.64, 0.95, 0.72, C.woodLight, true);
  b.cylinder(4.28, 1.14, -1.65, 0.04, 0.44, C.metal);
  b.cylinder(4.28, 1.39, -1.65, 0.24, 0.24, 0xddb575);
  b.window(0.45, -4.81, 0, 2.7);
  b.box(-1.1, 2.03, -4.65, 0.28, 1.8, 0.23, 0x6e8d87);
  b.box(2.0, 2.03, -4.65, 0.28, 1.8, 0.23, 0x6e8d87);
  b.shelf(-4.45, 1.9, 2.0, Math.PI / 2);
  b.plant(0.35, -4.05, 0.7);
  b.sign('便 签\n把看到的都记下来', -2.6, 1.98, -4.82, 1.65, 0.68, '#c6bc8e', '#4a5a57');
  b.door(-2.4, 4.82, '玄 关');
  b.anchor('computer', -3.35, 1.2, -3.2);
  b.anchor('bed', 2.85, 0.88, 0.75);
  b.anchor('notes', -2.2, 1.05, -3.05);
  b.anchor('window', 0.45, 1.7, -4.45);
  b.world.spawn.set(0, 1.6, 3.3);
  b.world.target.set(-2.6, 1.3, -3.0);
}

function exam(b: SetBuilder) {
  b.room(0xb9b6a0, 0xe3dfcd);
  b.sign('考 试 进 行 中\n请保持安静', 0, 2.18, -4.8, 4.3, 1.05, '#3f6a60');
  b.table(0, -3.48, 1.8, 0.65, C.wood);
  b.person('teacher', 2.2, -3.9, 0x7d867b, -0.2);
  for (const x of [-2.75, 0, 2.75]) for (const z of [-1.5, 1.1]) {
    b.table(x, z, 1.35, 0.92);
    b.papers(x, 0.975, z - 0.02, 1);
    b.chair(x, z + 0.8, 0, C.teal, !(x === 0 && z === 1.1));
  }
  b.person('student', -2.75, 2.22, 0x75878b, Math.PI, false);
  b.person('frontStudent', 2.75, -0.36, 0x9a9380, Math.PI, false);
  b.window(4.82, -0.2, -Math.PI / 2, 3.7);
  b.door(-3.75, 4.82, '考 场');
  b.anchor('otherPaper', -2.75, 1.04, 1.08);
  b.anchor('myPaper', 0, 1.04, 1.08);
  b.anchor('teacher', 2.2, 1.6, -3.9);
  b.world.spawn.set(0, 1.6, 2.32);
  b.world.target.set(0, 1.0, 1.1);
}

function restaurant(b: SetBuilder) {
  b.room(0xb1a98d, 0xe1d9bf);
  b.box(0, 1.04, -3.55, 6.1, 1.16, 1.1, 0x719186, true);
  b.box(0, 1.68, -3.55, 6.35, 0.12, 1.2, C.woodLight);
  b.sign('巷 口 小 馆', 0, 2.68, -4.81, 3.7, 0.61, '#9b6550');
  for (let i = -2; i <= 2; i++) b.sign(['面', '饭', '汤', '茶', '菜'][i + 2], i * 0.85, 2.05, -4.79, 0.56, 0.59, '#d0bf91', '#566760');
  b.table(-1.65, -0.35, 1.6, 1.22);
  b.chair(-1.65, 0.7, 0, 0x9d6c53, false);
  b.chair(-1.65, -1.4, Math.PI, 0x9d6c53);
  b.table(2.45, 2.32, 1.45, 1.2);
  b.chair(2.45, 3.3, 0, 0x9d6c53, false);
  b.person('greyMan', 2.45, 3.15, 0x8c918d, Math.PI, false);
  b.table(2.45, -0.65, 1.45, 1.2);
  b.chair(2.45, 0.37, 0, 0x9d6c53);
  for (const [x, z] of [[-1.65, -0.35], [2.45, -0.65], [2.45, 2.32]]) {
    b.cylinder(x - 0.3, 1.00, z, 0.2, 0.065, C.white);
    b.cylinder(x - 0.3, 1.04, z, 0.15, 0.025, 0xa27a51);
    b.cylinder(x + 0.43, 1.05, z - 0.25, 0.065, 0.19, C.white);
    b.box(x - 0.28, 1.05, z + 0.34, 0.38, 0.015, 0.017, C.wood);
  }
  b.box(-1.34, 1.009, -0.05, 0.19, 0.034, 0.34, 0x33464f);
  const screen = b.box(-1.34, 1.03, -0.05, 0.151, 0.006, 0.27, 0x91bbc0);
  screen.material = new THREE.MeshLambertMaterial({ color: 0xbbd9cb, emissive: 0x8aaec0, emissiveIntensity: 0.6 });
  b.window(-4.82, -0.1, Math.PI / 2, 3.4);
  b.plant(4.0, -3.8, 1.1);
  b.door(-3.6, 4.82, '出 口');
  b.anchor('phone', -1.34, 1.08, -0.05);
  b.anchor('exit', -3.6, 1.4, 4.5);
  b.world.spawn.set(-1.65, 1.6, 1.25);
  b.world.target.set(-1.5, 1.03, -0.35);
}

type Rect = { x0: number; x1: number; z0: number; z1: number };

/** Makes the outside perimeter of a union of rectangles, leaving every junction open. */
function streetPerimeter(b: SetBuilder, paths: Rect[]) {
  const xs = [...new Set(paths.flatMap(r => [r.x0, r.x1]))].sort((a, c) => a - c);
  const zs = [...new Set(paths.flatMap(r => [r.z0, r.z1]))].sort((a, c) => a - c);
  const inside = (i: number, j: number) => {
    if (i < 0 || j < 0 || i >= xs.length - 1 || j >= zs.length - 1) return false;
    const x = (xs[i] + xs[i + 1]) / 2, z = (zs[j] + zs[j + 1]) / 2;
    return paths.some(r => x > r.x0 && x < r.x1 && z > r.z0 && z < r.z1);
  };
  // Merge collinear edges so walls have no visible short-segment seams.
  for (let i = 0; i < xs.length; i++) {
    let start: number | null = null;
    for (let j = 0; j < zs.length; j++) {
      const edge = j < zs.length - 1 && inside(i - 1, j) !== inside(i, j);
      if (edge && start === null) start = zs[j];
      if (!edge && start !== null) {
        const length = zs[j] - start;
        b.box(xs[i], 2.6, (start + zs[j]) / 2, 0.22, 5.2, length, (i % 2 ? 0x929c91 : 0xb0ada1), true);
        b.box(xs[i], 0.19, (start + zs[j]) / 2, 0.25, 0.38, length, 0x78857e);
        start = null;
      }
    }
  }
  for (let j = 0; j < zs.length; j++) {
    let start: number | null = null;
    for (let i = 0; i < xs.length; i++) {
      const edge = i < xs.length - 1 && inside(i, j - 1) !== inside(i, j);
      if (edge && start === null) start = xs[i];
      if (!edge && start !== null) {
        const length = xs[i] - start;
        b.box((start + xs[i]) / 2, 2.6, zs[j], length, 5.2, 0.22, (j % 2 ? 0xacaa98 : 0x99a49d), true);
        b.box((start + xs[i]) / 2, 0.19, zs[j], length, 0.38, 0.25, 0x78857e);
        start = null;
      }
    }
  }
}

function street(b: SetBuilder) {
  const paths: Rect[] = [
    { x0: -10.8, x1: -7.2, z0: -1.8, z1: 10 },
    { x0: -10.8, x1: -0.2, z0: -1.8, z1: 1.8 },
    { x0: -3.8, x1: -0.2, z0: -8.8, z1: 1.8 },
    { x0: -3.8, x1: 15.6, z0: -8.8, z1: -5.2 },
    { x0: 4.5, x1: 10.5, z0: -5.2, z1: 1.2 },
    { x0: 12, x1: 15.6, z0: -8.8, z1: 2.2 },
  ];
  b.world.bounds = { minX: -10.65, maxX: 15.45, minZ: -8.65, maxZ: 9.8 };
  b.box(2.3, -0.18, 0.7, 27.4, 0.35, 20.1, 0x526665);
  for (const r of paths) b.box((r.x0 + r.x1) / 2, -0.045, (r.z0 + r.z1) / 2, r.x1 - r.x0, 0.09, r.z1 - r.z0, 0x8b9992);
  streetPerimeter(b, paths);
  // A continuous pale curb and sparse drains make the three corners legible.
  for (const z of [7.6, 4.8, 2.0]) b.box(-9, 0.007, z, 0.16, 0.012, 0.8, 0xc5bc99);
  for (const x of [-7, -5]) b.box(x, 0.009, 0, 0.8, 0.012, 0.16, 0xc5bc99);
  for (const z of [-2.8, -5]) b.box(-2, 0.009, z, 0.16, 0.012, 0.8, 0xc5bc99);
  for (const x of [0.2, 2.3, 4.4, 6.5, 8.6, 10.7]) b.box(x, 0.009, -7, 0.8, 0.012, 0.16, 0xc5bc99);
  for (const [x, z] of [[-10.36, 4], [-5.3, 1.47], [-0.6, -4.1], [3.3, -8.37]]) {
    b.box(x, 0.013, z, 0.46, 0.015, 0.4, 0x5e7471);
    for (let i = 0; i < 4; i++) b.box(x - 0.16 + i * 0.11, 0.024, z, 0.025, 0.006, 0.32, 0x89978b);
  }
  b.sign('南  巷\n便利店 →', -9, 2.08, -1.66, 1.7, 0.9, '#456d68');
  b.sign('夜 间 便 民\n← 便利店', -0.34, 2.13, -0.1, 1.8, 0.84, '#55786d', '#f4e7bb', -Math.PI / 2);
  b.sign('便利店 →', -2, 2.1, -8.64, 2.1, 0.55, '#55786d');
  b.window(-10.65, 5.7, Math.PI / 2, 2.1);
  b.window(-6.0, 1.65, Math.PI, 1.6);
  b.window(-0.34, -3.6, -Math.PI / 2, 1.9);
  b.box(-10.43, 1.0, 2.7, 0.46, 0.63, 0.9, 0x8e9e97, true);
  b.plant(-7.58, 7.5, 0.8);
  b.plant(-3.35, -3.6, 0.8);
  b.plant(0.7, -8.15, 0.85);

  // Shop faces north across the last street; its window really reveals the street.
  b.box(7.5, 0.005, -2, 5.8, 0.08, 6.25, 0xbfbba2);
  for (let x = 5; x <= 10; x++) b.box(x, 0.051, -2, 0.014, 0.007, 6.2, 0xa0aa99);
  for (let z = -5; z <= 1; z++) b.box(7.5, 0.051, z, 5.8, 0.007, 0.014, 0xa0aa99);
  b.box(7.5, 2.97, -5.18, 6.13, 0.7, 0.25, 0x47776d);
  b.sign('24H  ·  巷 口 便 利', 7.5, 3.0, -5.34, 5.8, 0.57, '#47776d', '#f7e2ab', Math.PI);
  b.box(7.5, 3.43, -5.47, 6.4, 0.13, 0.95, 0xc4ab76);
  // Doorway x=4.7..6.0 is open. Window x=6.1..10.3 has a waist-high counter.
  b.box(4.6, 1.34, -5.2, 0.15, 2.65, 0.16, C.cream, true);
  b.box(6.05, 1.34, -5.2, 0.12, 2.65, 0.16, C.cream, true);
  b.box(10.4, 1.34, -5.2, 0.15, 2.65, 0.16, C.cream, true);
  b.box(8.2, 0.41, -5.2, 4.25, 0.8, 0.16, 0x7d9989, true);
  b.box(8.2, 2.62, -5.2, 4.25, 0.1, 0.16, C.cream);
  b.box(8.2, 1.77, -5.2, 0.065, 1.65, 0.12, C.cream);
  const glass = b.box(8.2, 1.75, -5.2, 4.19, 1.59, 0.028, 0xbedbce);
  glass.material = new THREE.MeshLambertMaterial({ color: 0xc1e0d5, transparent: true, opacity: 0.12, depthWrite: false, side: THREE.DoubleSide });
  b.box(8.13, 0.92, -4.64, 3.8, 0.12, 0.66, C.woodLight, true);
  // Separate checkout and shelf leave a wide entrance-to-window route.
  b.box(5.32, 0.61, -2.67, 1.4, 1.13, 1.1, 0x6e9684, true);
  b.box(5.32, 1.2, -2.67, 1.51, 0.1, 1.2, C.woodLight);
  b.box(5.34, 1.34, -2.76, 0.64, 0.16, 0.55, C.metal);
  for (const x of [5.12, 5.34, 5.56]) for (const z of [-2.91, -2.64]) b.cylinder(x, 1.44, z, 0.072, 0.1, (x > 5.4 ? 0xbcb68f : 0xb58c5e));
  b.sign('关东煮', 5.3, 0.79, -3.24, 0.99, 0.3, '#6e9684', '#f6e7b1', Math.PI);
  b.shelf(7.65, 0.72, 3.5, Math.PI);
  b.chair(7.7, -3.5, 0, 0x9c8161, false);
  b.chair(9.1, -3.5, 0, 0x9c8161);
  b.cylinder(7.68, 1.08, -4.56, 0.13, 0.21, 0xe0d3a4);
  for (let i = 0; i < 3; i++) b.cylinder(7.6 + i * 0.07, 1.29, -4.56, 0.012, 0.28, C.woodLight, b.world.group, 5);
  b.box(7.65, 3.17, -1.9, 4.2, 0.08, 0.32, C.white);
  b.person('clerk', 5.3, -1.45, 0x6f9380, Math.PI, false);
  b.person('greyMan', 2.6, -7, 0x89908b, Math.PI / 2, false);

  // The right-hand alley ends in a continuous wall. No doorway or impossible escape.
  b.box(13.8, 1.55, 2.04, 3.38, 3.1, 0.16, 0x82928b);
  for (let y = 0.4; y < 2.9; y += 0.4) b.box(13.8, y, 1.945, 3.3, 0.018, 0.018, 0xa4afa3);
  b.sign('此 路 不 通', 13.8, 1.84, 1.93, 1.45, 0.43, '#879389', '#e7e0c8');
  b.box(12.42, 0.4, -1.25, 0.55, 0.8, 0.65, 0x688b79, true);
  b.box(12.42, 0.84, -1.25, 0.61, 0.1, 0.7, 0x567663);
  b.box(15.34, 1.6, -1.0, 0.12, 3.2, 0.15, 0x6f8380);
  for (const [x, z] of [[-7.56, 4.5], [-0.57, -5.3], [11.6, -8.33]]) {
    b.cylinder(x, 1.8, z, 0.047, 3.6, 0x586e6e);
    b.box(x, 3.56, z + 0.2, 0.46, 0.16, 0.63, 0xc1b992);
    const bulb = b.box(x, 3.46, z + 0.2, 0.32, 0.045, 0.46, 0xffdf9f);
    bulb.material = new THREE.MeshLambertMaterial({ color: 0xffe3a0, emissive: 0xffd489, emissiveIntensity: 0.9 });
  }
  const streetLamp = new THREE.PointLight(0xffdca0, 1.15, 10, 1.4);
  streetLamp.name = 'streetLamp';
  streetLamp.position.set(11.6, 3.35, -8.1);
  b.world.group.add(streetLamp);
  b.world.spawn.set(-9, 1.6, 8);
  b.world.target.set(-9, 1.6, 0);
  b.anchor('turn1', -9, 1.6, 0);
  b.anchor('turn2', -2, 1.6, 0);
  b.anchor('turn3', -2, 1.6, -7);
  b.anchor('shop', 5.32, 1.4, -2.92);
  b.anchor('seat', 7.7, 1.6, -3.45);
  b.anchor('window', 7.7, 1.65, -5.2);
  b.anchor('greyStart', 2.6, 0, -7);
  b.anchor('greyEnd', 13.8, 0, -7);
  b.anchor('alley', 13.8, 1.6, 0.65);
  b.anchor('exit', 13.8, 1.6, 0.9);
}

export function buildWorld(kind: SceneKind): World {
  const b = new SetBuilder();
  b.world.group.name = `blue-blood-${kind}`;
  const scenes: Record<SceneKind, (builder: SetBuilder) => void> = { training, washroom, office, home, exam, restaurant, street };
  scenes[kind](b);
  b.world.group.updateMatrixWorld(true);
  return b.world;
}
