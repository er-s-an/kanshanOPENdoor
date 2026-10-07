/**
 * engine-promo — 引擎宣传片段：从空白虚空把一座迷你门厅搭出来。
 *
 * 一块 60s 的确定性搭建时间线（PROMO_DURATION）：地面亮起 → 立柱升起 →
 * 水晶点亮 → 三扇门拱落下并点亮门光 → 《蓝血》场景图展板飞入悬浮环 →
 * 人格卡落位 → 刘看山入场站定。相机全程由 CameraDirector 驱动：
 * 推近（dolly）→ 环绕（orbit）→ 上升拉远（crane），结尾不停顿，
 * 方便录制加速后作为素材剪辑。
 *
 * 全部摆放动作用引擎 animation/timeline DSL（tween/parallel/sequence/
 * cameraBlend/cameraCut）编排；素材经本地 assets/ 贴图加载。无玩家输入、
 * 无音频、无 HUD，纯画面。录制侧用 controlled host 逐帧 step 驱动。
 */
import * as THREE from 'three';
import type { SceneContext, SceneInstance, SceneModule } from '../../../src/creative/core/context.ts';
import { CameraDirector, PathRig } from '../../../src/creative/camera/rigs.ts';
import {
  cameraBlend,
  cameraCut,
  parallel,
  sequence,
  timeline,
  tween,
  wait,
} from '../../../src/creative/animation/timeline.ts';
import type { PlanNode, TimelineHandle } from '../../../src/creative/animation/timeline.ts';
import { createKanshan } from '../../kanshan-hall/src/kanshan.ts';
import type { Kanshan } from '../../kanshan-hall/src/kanshan.ts';

/** 原始时间线时长（秒）；录制以 2x 播放得到 30s 成片。 */
export const PROMO_DURATION = 60;

export interface EnginePromoHandles {
  readonly camera: THREE.PerspectiveCamera;
  readonly duration: number;
}

const asset = (file: string): string => new URL(`../assets/${file}`, import.meta.url).href;

/** 摆放弹跳感：轻微过冲。 */
const backOut = (t: number): number => {
  const c = 1.70158;
  const u = t - 1;
  return 1 + (c + 1) * u * u * u + c * u * u;
};

const at = (t: number, node: PlanNode): PlanNode => sequence(wait(t), node);

const FLOOR_R = 12;
const COLUMN_R = 10.5;
const DOOR_R = 9.8;
const PANEL_R = 6.2;
const PERSONA_R = 4.6;

const DOOR_COLORS = [0xd4a24e, 0x5a8fd4, 0x58c9c0] as const;
const DOOR_ANGLES = [Math.PI / 2, (7 * Math.PI) / 6, (11 * Math.PI) / 6] as const;

const PANEL_IMAGES = [
  'blue-cover.jpg',
  'blue-training-hall.jpg',
  'blue-office-night.jpg',
  'blue-exam.jpg',
  'blue-evidence-desk.jpg',
  'blue-alley.jpg',
  'blue-boss-post.jpg',
  'blue-ending-hot.jpg',
] as const;

const PERSONA_IMAGES = [
  'persona-fire-v1.png',
  'persona-echo-v1.png',
  'persona-askr-v1.png',
  'persona-fair-v1.png',
] as const;

const ringPos = (angle: number, r: number, y: number): THREE.Vector3 =>
  new THREE.Vector3(Math.sin(angle) * r, y, Math.cos(angle) * r);

async function loadTexture(loader: THREE.TextureLoader, file: string): Promise<THREE.Texture> {
  const tex = await loader.loadAsync(asset(file));
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export interface EnginePromoOptions {
  /** 测试/离线环境注入的贴图加载桩；默认走 assets/ URL。 */
  textureLoader?: (file: string) => Promise<THREE.Texture>;
}

export function createEnginePromoModule(options: EnginePromoOptions = {}): SceneModule & { handles?: EnginePromoHandles } {
  const load = options.textureLoader ?? ((file: string) => loadTexture(new THREE.TextureLoader(), file));
  const module: SceneModule & { handles?: EnginePromoHandles } = {
    async create(ctx: SceneContext): Promise<SceneInstance> {
      const root = new THREE.Group();
      root.name = 'engine-promo/root';

      const [doorCardTex, ...panelTex] = await Promise.all([
        load('door-card-closed.jpg'),
        ...PANEL_IMAGES.map((f) => load(f)),
      ]);
      const personaTex = await Promise.all(PERSONA_IMAGES.map((f) => load(f)));

      // ---------------- 灯光（初始压暗，搭建尾声亮起） ----------------
      const ambient = new THREE.AmbientLight(0x8fa8c8, 0.55);
      const hemi = new THREE.HemisphereLight(0xcfdcef, 0x22303f, 0.65);
      const centerGlow = new THREE.PointLight(0xffe8c0, 0, 22, 1.5);
      centerGlow.position.set(0, 5, 0);
      root.add(ambient, hemi, centerGlow);

      // ---------------- 地面与环形镶嵌 ----------------
      const floorMat = new THREE.MeshStandardMaterial({ color: 0xe8edf2, roughness: 0.38, metalness: 0.05 });
      const floor = new THREE.Mesh(new THREE.CylinderGeometry(FLOOR_R, FLOOR_R, 0.18, 56), floorMat);
      floor.name = 'engine-promo/floor';
      floor.position.y = -0.09;
      floor.scale.set(0.001, 1, 0.001);
      root.add(floor);

      const rings: THREE.Mesh[] = [];
      [4, 7.5, 11].forEach((r, i) => {
        const ring = new THREE.Mesh(
          new THREE.TorusGeometry(r, 0.035, 8, 72),
          new THREE.MeshBasicMaterial({ color: 0x4e8fd9 }),
        );
        ring.name = `engine-promo/ring-${i}`;
        ring.rotation.x = -Math.PI / 2;
        ring.position.y = 0.012;
        ring.scale.setScalar(0.001);
        rings.push(ring);
        root.add(ring);
      });

      // ---------------- 立柱（8 根，底部 anchored 生长） ----------------
      const columns: THREE.Group[] = [];
      for (let i = 0; i < 8; i += 1) {
        const g = new THREE.Group();
        g.name = `engine-promo/column-${i}`;
        const shaft = new THREE.Mesh(
          new THREE.CylinderGeometry(0.26, 0.3, 4.4, 12).translate(0, 2.2, 0),
          new THREE.MeshStandardMaterial({ color: 0xf4f6f8, roughness: 0.5 }),
        );
        const band = new THREE.Mesh(
          new THREE.TorusGeometry(0.36, 0.07, 8, 24).rotateX(Math.PI / 2).translate(0, 4.4, 0),
          new THREE.MeshBasicMaterial({ color: 0x4e8fd9 }),
        );
        g.add(shaft, band);
        g.position.copy(ringPos((i * Math.PI) / 4 + Math.PI / 8, COLUMN_R, 0));
        g.scale.y = 0.001;
        columns.push(g);
        root.add(g);
      }

      // ---------------- 悬浮水晶 ----------------
      const crystals: THREE.Mesh[] = [];
      for (let i = 0; i < 6; i += 1) {
        const c = new THREE.Mesh(
          new THREE.OctahedronGeometry(0.32),
          new THREE.MeshStandardMaterial({
            color: 0x7fb2e8,
            transparent: true,
            opacity: 0,
            roughness: 0.15,
            emissive: 0x3d6aa8,
          }),
        );
        c.name = `engine-promo/crystal-${i}`;
        c.position.copy(ringPos((i * Math.PI) / 3 + Math.PI / 6, 5.5, 2.6));
        c.scale.setScalar(0.001);
        crystals.push(c);
        root.add(c);
      }

      // ---------------- 门拱 ×3 + 入口拱 ----------------
      interface DoorRig {
        group: THREE.Group;
        card: THREE.Mesh | null;
        glow: THREE.PointLight;
      }
      const doors: DoorRig[] = [];
      const makeArch = (withCard: boolean): DoorRig => {
        const g = new THREE.Group();
        const white = new THREE.MeshStandardMaterial({ color: 0xf4f6f8, roughness: 0.5 });
        const pillarGeo = new THREE.BoxGeometry(0.32, 3.6, 0.32);
        const lintel = new THREE.Mesh(new THREE.BoxGeometry(2.9, 0.42, 0.36), white);
        lintel.position.y = 3.75;
        const pl = new THREE.Mesh(pillarGeo, white);
        pl.position.set(-1.25, 1.8, 0);
        const pr = new THREE.Mesh(pillarGeo, white);
        pr.position.set(1.25, 1.8, 0);
        g.add(pl, pr, lintel);
        let card: THREE.Mesh | null = null;
        if (withCard) {
          const cardMat = new THREE.MeshBasicMaterial({ map: doorCardTex, transparent: true, opacity: 0 });
          card = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 3.1), cardMat);
          card.position.y = 1.72;
          g.add(card);
        }
        const glow = new THREE.PointLight(0xffffff, 0, 7, 1.6);
        glow.position.set(0, 2, 0.8);
        g.add(glow);
        return { group: g, card, glow };
      };
      DOOR_ANGLES.forEach((angle, i) => {
        const d = makeArch(true);
        d.group.name = `engine-promo/door-${i}`;
        d.group.position.copy(ringPos(angle, DOOR_R, 0));
        d.group.lookAt(0, 0, 0);
        d.glow.color.setHex(DOOR_COLORS[i] ?? 0xffffff);
        d.group.scale.setScalar(0.001);
        doors.push(d);
        root.add(d.group);
      });
      const entry = makeArch(false);
      entry.group.name = 'engine-promo/entry-arch';
      entry.group.position.copy(ringPos(0, DOOR_R, 0));
      entry.group.lookAt(0, 0, 0);
      entry.glow.color.setHex(0xbfd9ff);
      entry.group.scale.setScalar(0.001);
      root.add(entry.group);

      // ---------------- 《蓝血》展板悬浮环 ----------------
      const panels: { g: THREE.Group; art: THREE.Mesh; frameM: THREE.Mesh; finalY: number; landAt: number }[] = [];
      panelTex.forEach((tex, i) => {
        const g = new THREE.Group();
        g.name = `engine-promo/panel-${i}`;
        const frameM = new THREE.Mesh(
          new THREE.PlaneGeometry(2.42, 1.66),
          new THREE.MeshBasicMaterial({ color: 0xf2f5f8, transparent: true, opacity: 0 }),
        );
        const art = new THREE.Mesh(
          new THREE.PlaneGeometry(2.25, 1.5),
          new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0 }),
        );
        art.position.z = 0.012;
        g.add(frameM, art);
        const angle = (i * Math.PI) / 4;
        const finalPos = ringPos(angle, PANEL_R, 2.3);
        g.position.copy(finalPos);
        g.lookAt(0, 2.3, 0);
        // 起手：径向远处 + 上方 + 侧转 + 全透明，飞入时同步淡入
        g.userData.finalPos = finalPos;
        g.userData.finalRotY = g.rotation.y;
        g.position.copy(ringPos(angle, PANEL_R * 2.6, 5.2));
        g.rotation.y += i % 2 === 0 ? 1.1 : -1.1;
        panels.push({ g, art, frameM, finalY: 2.3, landAt: 25.7 + i * 1.9 });
        root.add(g);
      });

      // ---------------- 人格卡（透明 PNG，前方弧排） ----------------
      const personas: THREE.Mesh[] = [];
      personaTex.forEach((tex, i) => {
        const m = new THREE.Mesh(
          new THREE.PlaneGeometry(0.95, 0.95),
          new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0, depthWrite: false }),
        );
        m.name = `engine-promo/persona-${i}`;
        const angle = ((i - 1.5) * 18 * Math.PI) / 180;
        m.position.copy(ringPos(angle, PERSONA_R, 6));
        m.userData.finalY = 1.55;
        m.lookAt(0, 1.55, 0);
        m.rotateX(-0.42);
        personas.push(m);
        root.add(m);
      });

      // ---------------- 刘看山（程序化 mascot，复用 kanshan-hall） ----------------
      const kanshan: Kanshan = createKanshan({ name: 'promo-kanshan' });
      kanshan.setPosition(0, 0, 10.2);
      kanshan.object.scale.setScalar(0.001);
      kanshan.play('idle');
      root.add(kanshan.object);

      // ---------------- 相机：推近 → 环绕 → 上升拉远 ----------------
      const camera = new THREE.PerspectiveCamera(58, 16 / 9, 0.05, 200);
      const dolly = new PathRig('dolly', {
        points: [
          [0, 1.3, 24],
          [0, 1.6, 17],
          [0, 1.9, 13.5],
        ],
        duration: 10,
        lookAt: [0, 1.5, 0],
        easing: 'easeInOut',
      });
      const orbit = new PathRig('orbit', {
        points: [
          [9, 3.6, 0],
          [0, 3.6, -9],
          [-9, 3.6, 0],
          [0, 3.6, 9],
          [9, 3.6, 0],
        ],
        duration: 36,
        lookAt: [0, 1.4, 0],
      });
      const crane = new PathRig('crane', {
        points: [
          [4.5, 3.2, 7.4],
          [7, 5.5, 7],
          [3.5, 8.5, 12],
          [0, 10.5, 15.5],
        ],
        duration: 14,
        lookAt: [0, 1.2, 0],
        easing: 'easeInOut',
      });
      const director = new CameraDirector(camera, dolly);
      director.attach(ctx);

      // ---------------- 搭建时间线 ----------------
      const steps: PlanNode[] = [
        at(0.4, tween({ target: floor, props: { scale: new THREE.Vector3(1, 1, 1) }, duration: 2.2, easing: 'easeOut' })),
        ...rings.map((r, i) => at(1.2 + i * 0.35, tween({ target: r, props: { scale: new THREE.Vector3(1, 1, 1) }, duration: 1.0, easing: backOut }))),
        ...columns.map((c, i) => at(4 + i * 1.1, tween({ target: c, props: { 'scale.y': 1 }, duration: 0.9, easing: backOut }))),
        ...crystals.map((c, i) =>
          at(
            12 + i * 0.8,
            tween({
              target: c,
              props: { scale: new THREE.Vector3(1, 1, 1), 'material.opacity': 0.8 },
              duration: 0.9,
              easing: backOut,
            }),
          ),
        ),
        at(15, parallel(
          tween({ target: entry.group, props: { scale: new THREE.Vector3(1, 1, 1) }, duration: 1.2, easing: backOut }),
          tween({ target: entry.glow, props: { intensity: 5 }, duration: 1.8, easing: 'easeOut' }),
        )),
        ...doors.map((d, i) =>
          at(
            16 + i * 3,
            parallel(
              tween({ target: d.group, props: { scale: new THREE.Vector3(1, 1, 1) }, duration: 1.2, easing: backOut }),
              ...(d.card
                ? [tween({ target: d.card, props: { 'material.opacity': 1 }, duration: 1.5, easing: 'easeOut' })]
                : []),
              tween({ target: d.glow, props: { intensity: 5.5 }, duration: 1.8, easing: 'easeOut' }),
            ),
          ),
        ),
        ...panels.map((p, i) =>
          at(
            24 + i * 1.9,
            parallel(
              tween({
                target: p.g,
                props: {
                  position: p.g.userData.finalPos as THREE.Vector3,
                  'rotation.y': p.g.userData.finalRotY as number,
                },
                duration: 1.7,
                easing: 'easeOut',
              }),
              tween({ target: p.art, props: { 'material.opacity': 1 }, duration: 1.2, easing: 'easeOut' }),
              tween({ target: p.frameM, props: { 'material.opacity': 1 }, duration: 1.2, easing: 'easeOut' }),
            ),
          ),
        ),
        ...personas.map((m, i) =>
          at(
            38 + i * 0.7,
            parallel(
              tween({ target: m, props: { 'position.y': m.userData.finalY as number }, duration: 1.0, easing: backOut }),
              tween({ target: m, props: { 'material.opacity': 1 }, duration: 0.8, easing: 'easeOut' }),
            ),
          ),
        ),
        at(43, tween({ target: centerGlow, props: { intensity: 15 }, duration: 4, easing: 'easeInOut' })),
        at(44, tween({ target: ambient, props: { intensity: 1.0 }, duration: 4, easing: 'easeInOut' })),
        at(46, tween({ target: kanshan.object, props: { scale: new THREE.Vector3(1, 1, 1) }, duration: 0.8, easing: backOut })),
        at(46.8, tween({ target: kanshan.object, props: { position: new THREE.Vector3(0, 0, 6.8) }, duration: 3.2, easing: 'easeInOut' })),
        // 运镜脚本
        at(10, cameraBlend(orbit, 2.5, { easing: 'easeInOut' })),
        at(46, cameraBlend(crane, 3, { easing: 'easeInOut' })),
        at(PROMO_DURATION - 0.1, wait(0.1)),
      ];

      const master = timeline('engine-promo-build', {
        endState: { natural: '场景搭建完成，相机仍在运动', skip: 'same end state as natural completion' },
      });
      master.add(cameraCut(dolly), parallel(...steps));
      const masterHandle: TimelineHandle = master.run(ctx, { camera: director });

      let kanshanWalking = false;
      let kanshanSettled = false;

      module.handles = { camera, duration: PROMO_DURATION };

      return {
        root,
        update(frame) {
          const dt = frame.dt;
          const t = ctx.clock.time;
          kanshan.update(dt);
          if (!kanshanWalking && t >= 46.8) {
            kanshan.play('walk');
            kanshanWalking = true;
          }
          if (kanshanWalking && !kanshanSettled && t >= 50.2) {
            kanshan.play('idle');
            kanshanSettled = true;
          }
          if (kanshanSettled) kanshan.setYawToward(0, 100, dt);
          crystals.forEach((c, i) => {
            c.position.y = 2.6 + Math.sin(t * 1.3 + i * 1.7) * 0.12;
            c.rotation.y += dt * 0.6;
          });
          panels.forEach((p, i) => {
            if (t > p.landAt) p.g.position.y = p.finalY + Math.sin(t * 0.9 + i * 1.3) * 0.05;
          });
          if (masterHandle.state === 'completed' && !kanshanSettled) {
            kanshan.play('idle');
            kanshanSettled = true;
          }
        },
        destroy() {
          kanshan.dispose();
        },
      };
    },
  };
  return module;
}
