/**
 * PS1 render pipeline (creative layer, roadmap S04).
 *
 * Extracted from the engine renderer into a configurable, disposable class.
 * A PS1Preset controls resolution, dither, distance defocus, the optional
 * vignette channel, chromatic aberration, background and — explicitly — fog.
 * The pipeline never recomputes scene.fog from render state; a preset either
 * installs the fog it declares or leaves the scene fog-free. Native shader
 * materials stay untouched via a per-material opt-out flag (the native shader
 * entry point).
 */
import * as THREE from 'three';

export const PS1_WIDTH = 320;
export const PS1_HEIGHT = 240;
/** Scene background / fog color (dark red cold grey, engine CONTRACT §8). */
export const PS1_BG = 0x0d0809;
/** Default explicit fog density (the old myopia-coupled formula is gone). */
export const PS1_DEFAULT_FOG_DENSITY = 0.03;

/**
 * Per-material opt-out for the material patcher. Set
 * `material.userData[PS1_SKIP_PATCH] = true` on a native ShaderMaterial or
 * any custom material to keep it (and its textures) completely untouched.
 */
export const PS1_SKIP_PATCH = 'ps1SkipPatch';

export type PS1QualityTier = 'low' | 'medium' | 'high';

export interface PS1QualitySettings {
  /** Multiplier applied on top of resolution * resolutionScale. */
  renderScale: number;
}

export const QUALITY_TIERS: Record<PS1QualityTier, PS1QualitySettings> = {
  low: { renderScale: 0.5 },
  medium: { renderScale: 1 },
  high: { renderScale: 2 },
};

export interface PS1DefocusSettings {
  enabled: boolean;
  /** Distance (m) that stays fully sharp before defocus kicks in. */
  clearDistance: number;
  linearGain: number;
  quadraticGain: number;
  baseRadiusPx: number;
  maxRadiusPx: number;
}

/**
 * Vignette effect channel (the old squint input channel). Optional and off by
 * default; nothing here is wired to an input action. When enabled, drive it
 * at runtime with PS1RenderPipeline.setVignette().
 */
export interface PS1VignetteSettings {
  enabled: boolean;
  /** Channel strength 0..1. */
  strength: number;
}

/**
 * Explicit fog a preset installs on the scene. `null` renders fog-free.
 * A preset fog is applied as-is at construction and on setPreset(); the
 * pipeline never derives density from anything else.
 */
export type PS1FogSetting = { color: number; density: number } | null;

/** Author-facing partial preset; every field falls back to the defaults. */
export interface PS1Preset {
  resolution?: { width?: number; height?: number };
  resolutionScale?: number;
  quality?: PS1QualityTier;
  dither?: boolean;
  distanceDefocus?: Partial<PS1DefocusSettings>;
  vignette?: Partial<PS1VignetteSettings>;
  /** undefined keeps the current/default fog; null disables fog. */
  fog?: PS1FogSetting;
  background?: number;
  chromaticAberration?: number;
}

export interface ResolvedPS1Preset {
  resolution: { width: number; height: number };
  resolutionScale: number;
  quality: PS1QualityTier;
  dither: boolean;
  distanceDefocus: PS1DefocusSettings;
  vignette: PS1VignetteSettings;
  fog: PS1FogSetting;
  background: number;
  chromaticAberration: number;
}

/** Defaults reproduce the original engine pipeline's look. */
export const PS1_DEFAULT_PRESET: ResolvedPS1Preset = {
  resolution: { width: PS1_WIDTH, height: PS1_HEIGHT },
  resolutionScale: 1,
  quality: 'medium',
  dither: true,
  distanceDefocus: {
    enabled: true,
    clearDistance: 1.0,
    linearGain: 0.6,
    quadraticGain: 0.26,
    baseRadiusPx: 0.5,
    maxRadiusPx: 6.4,
  },
  vignette: { enabled: false, strength: 0 },
  fog: { color: PS1_BG, density: PS1_DEFAULT_FOG_DENSITY },
  background: PS1_BG,
  chromaticAberration: 0.0032,
};

/** Merge a partial preset onto a resolved base (defaults when omitted). */
export function mergePS1Preset(base: ResolvedPS1Preset, preset: PS1Preset): ResolvedPS1Preset {
  return {
    resolution: { ...base.resolution, ...preset.resolution },
    resolutionScale: preset.resolutionScale ?? base.resolutionScale,
    quality: preset.quality ?? base.quality,
    dither: preset.dither ?? base.dither,
    distanceDefocus: { ...base.distanceDefocus, ...preset.distanceDefocus },
    vignette: { ...base.vignette, ...preset.vignette },
    fog: preset.fog === undefined ? base.fog : preset.fog,
    background: preset.background ?? base.background,
    chromaticAberration: preset.chromaticAberration ?? base.chromaticAberration,
  };
}

/** Resolve a partial preset against the defaults. */
export function resolvePS1Preset(preset: PS1Preset = {}): ResolvedPS1Preset {
  return mergePS1Preset(PS1_DEFAULT_PRESET, preset);
}

const snapEven = (value: number): number => Math.max(2, Math.round(value / 2) * 2);

/**
 * Effective low-res render target size: base resolution * resolutionScale *
 * tier renderScale, snapped to even dimensions (Bayer dither and the
 * composite pass assume even sizes).
 */
export function effectiveRenderSize(
  resolution: { width: number; height: number },
  resolutionScale: number,
  tier: PS1QualityTier,
): { width: number; height: number } {
  const scale = Math.max(0, resolutionScale) * QUALITY_TIERS[tier].renderScale;
  return {
    width: snapEven(resolution.width * scale),
    height: snapEven(resolution.height * scale),
  };
}

/**
 * Apply the scene-level parts of a resolved preset: background color and the
 * explicit fog setting. This runs at construction and on setPreset() only —
 * never per frame.
 */
export function applyPresetToScene(scene: THREE.Scene, preset: ResolvedPS1Preset): void {
  scene.background = new THREE.Color(preset.background);
  if (preset.fog === null) {
    scene.fog = null;
  } else {
    scene.fog = new THREE.FogExp2(preset.fog.color, preset.fog.density);
  }
}

/** Patcher decision: Mesh* materials only, honouring the opt-out flag. */
export function shouldPatchMaterial(mat: THREE.Material): boolean {
  if (mat.userData[PS1_SKIP_PATCH] === true) return false;
  return mat.type.startsWith('Mesh');
}

const TEXTURE_SLOTS = [
  'map', 'emissiveMap', 'lightMap', 'aoMap', 'normalMap', 'bumpMap',
  'roughnessMap', 'metalnessMap', 'alphaMap', 'specularMap',
] as const;

/**
 * Force nearest sampling on every texture slot (pure mutation, testable
 * without GL). Callers gate on shouldPatchMaterial(). A texture can opt into
 * stable minification with `texture.userData.ps1StableMinification = true`.
 */
export function applyMaterialPatch(mat: THREE.Material): void {
  const record = mat as unknown as Record<(typeof TEXTURE_SLOTS)[number], THREE.Texture | null>;
  for (const slot of TEXTURE_SLOTS) {
    const tex = record[slot];
    if (tex) {
      // Walls keep pixel blocks up close; stable-minified textures fall back
      // to mip filtering at distance to stop shimmering crawl on repeats.
      const stableMinification = tex.userData.ps1StableMinification === true;
      tex.magFilter = THREE.NearestFilter;
      tex.minFilter = stableMinification ? THREE.LinearMipmapLinearFilter : THREE.NearestFilter;
      tex.generateMipmaps = stableMinification;
      tex.needsUpdate = true;
    }
  }
  mat.needsUpdate = true;
}

export interface PS1CompositeFrame {
  dt: number;
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderTarget: THREE.WebGLRenderTarget;
}

/** Render hook: runs after the low-res pass, before the composite blit. */
export type PS1BeforeComposite = (frame: PS1CompositeFrame) => void;

const COMPOSITE_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
	vUv = uv;
	gl_Position = vec4( position.xy, 0.0, 1.0 );
}
`;

// Verbatim from the engine pipeline except the defocus/CA constants, which are
// uniforms so presets can tune them (defaults equal the old literals).
const COMPOSITE_FRAG = /* glsl */ `
varying vec2 vUv;

uniform sampler2D tDiffuse;
uniform sampler2D tDepth;
uniform vec2 uResolution;
uniform float uNear;
uniform float uFar;
uniform float uMyopia;
uniform float uSquint;
uniform float uFlash;
uniform float uDither;
uniform float uClearDist;
uniform float uDefocusLin;
uniform float uDefocusQuad;
uniform float uDefocusBasePx;
uniform float uDefocusMaxPx;
uniform float uCaBase;

float bayer2( vec2 a ) {
	a = floor( a );
	return fract( a.x * 0.5 + a.y * a.y * 0.75 );
}
float bayer4( vec2 a ) {
	return bayer2( 0.5 * a ) * 0.25 + bayer2( a );
}
float readDist( vec2 uv ) {
	float d = texture2D( tDepth, uv ).x;
	float viewZ = ( uNear * uFar ) / ( ( uFar - uNear ) * d - uFar );
	return clamp( -viewZ, 0.0, uFar );
}
vec3 lin2srgb( vec3 c ) {
	return mix( c * 12.92, 1.055 * pow( c, vec3( 1.0 / 2.4 ) ) - 0.055, step( vec3( 0.0031308 ), c ) );
}
// 带距离失焦的场景采样：uMyopia 越大，远处越糊（近视即渲染）。
// 1m 是清晰安全区；其外用较陡的指数膝点模拟雾的透射衰减与离焦圈随距离扩张，
// 让日常近视在室内也明显，但不把近手的交互物直接磨掉。
vec3 field( vec2 uv ) {
	float dist = readDist( uv );
	float beyondClear = max( dist - uClearDist, 0.0 );
	float distanceDefocus = 1.0 - exp( -uDefocusLin * beyondClear - uDefocusQuad * beyondClear * beyondClear );
	float defocus = uMyopia * distanceDefocus;
	float px = uDefocusBasePx + uDefocusMaxPx * defocus;
	vec2 t = px / uResolution;
	vec3 c = texture2D( tDiffuse, uv ).rgb * 0.36;
	c += texture2D( tDiffuse, uv + vec2( t.x, 0.0 ) ).rgb * 0.16;
	c += texture2D( tDiffuse, uv - vec2( t.x, 0.0 ) ).rgb * 0.16;
	c += texture2D( tDiffuse, uv + vec2( 0.0, t.y ) ).rgb * 0.16;
	c += texture2D( tDiffuse, uv - vec2( 0.0, t.y ) ).rgb * 0.16;
	return c;
}

void main() {
	vec2 c = vUv - 0.5;
	float r = length( c * vec2( 1.0, 1.1 ) );

	// 眯眼视野收窄（轻微向中心 zoom）
	vec2 uv = 0.5 + c * ( 1.0 - 0.09 * uSquint );

	// 轻微色散（近视/眯眼时加重）
	float ca = uCaBase + 0.0035 * uMyopia + 0.0018 * uSquint;
	vec2 off = c * ca;

	vec3 col;
	col.r = field( uv + off ).r;
	col.g = field( uv ).g;
	col.b = field( uv - off ).b;

	// 暗角：常态轻微隧道感，眯眼时大幅收窄 + 上下眼睑压暗
	float vigInner = mix( 0.60, 0.18, uSquint );
	float vigOuter = mix( 1.18, 0.52, uSquint );
	float vig = 1.0 - smoothstep( vigInner, vigOuter, r );
	col *= mix( mix( 0.30, 0.10, uSquint ), 1.0, vig );
	col *= 1.0 - uSquint * 0.5 * smoothstep( 0.15, 0.5, abs( c.y ) );

	col = lin2srgb( max( col, vec3( 0.0 ) ) );

	// Bayer 抖动去色带（PS1 味）
	col += ( bayer4( gl_FragCoord.xy ) - 0.5 ) * ( uDither * 2.5 / 255.0 );

	// 剧情白闪
	col = mix( col, vec3( 1.0 ), clamp( uFlash, 0.0, 1.0 ) );

	gl_FragColor = vec4( col, 1.0 );
}
`;

export class PS1RenderPipeline {
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;

  private resolved: ResolvedPS1Preset;
  private rt!: THREE.WebGLRenderTarget;
  private depthTexture!: THREE.DepthTexture;
  private compScene = new THREE.Scene();
  private compCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private compMat: THREE.ShaderMaterial;
  private quadGeo: THREE.PlaneGeometry;

  /** Materials already evaluated, keyed by material uuid. */
  private readonly patched = new Set<string>();
  private readonly beforeCompositeListeners = new Set<PS1BeforeComposite>();

  private myopia = 0.35;
  private vignetteStrength: number;
  private flashValue = 0;
  private flashDecay = 4;
  private shakeAmp = 0;
  private shakeT = 0;
  private shakeDur = 1;

  private isDisposed = false;

  constructor(renderer: THREE.WebGLRenderer, scene: THREE.Scene, preset: PS1Preset = {}) {
    this.renderer = renderer;
    this.scene = scene;
    this.resolved = resolvePS1Preset(preset);
    this.vignetteStrength = THREE.MathUtils.clamp(this.resolved.vignette.strength, 0, 1);

    this.buildRenderTarget(
      effectiveRenderSize(this.resolved.resolution, this.resolved.resolutionScale, this.resolved.quality),
    );

    this.compMat = new THREE.ShaderMaterial({
      vertexShader: COMPOSITE_VERT,
      fragmentShader: COMPOSITE_FRAG,
      uniforms: {
        tDiffuse: { value: this.rt.texture },
        tDepth: { value: this.depthTexture },
        uResolution: { value: new THREE.Vector2(this.rt.width, this.rt.height) },
        uNear: { value: 0.05 },
        uFar: { value: 60 },
        uMyopia: { value: this.myopia },
        uSquint: { value: 0 },
        uFlash: { value: 0 },
        uDither: { value: 0.8 },
        uClearDist: { value: this.resolved.distanceDefocus.clearDistance },
        uDefocusLin: { value: this.resolved.distanceDefocus.linearGain },
        uDefocusQuad: { value: this.resolved.distanceDefocus.quadraticGain },
        uDefocusBasePx: { value: this.resolved.distanceDefocus.baseRadiusPx },
        uDefocusMaxPx: { value: this.resolved.distanceDefocus.maxRadiusPx },
        uCaBase: { value: this.resolved.chromaticAberration },
      },
      depthTest: false,
      depthWrite: false,
    });
    this.quadGeo = new THREE.PlaneGeometry(2, 2);
    const quad = new THREE.Mesh(this.quadGeo, this.compMat);
    quad.frustumCulled = false;
    this.compScene.add(quad);

    this.syncPresetUniforms();
    applyPresetToScene(this.scene, this.resolved);
  }

  // ------------------------------ state -----------------------------------

  /** Current resolved preset (do not mutate; use setPreset). */
  get preset(): ResolvedPS1Preset {
    return this.resolved;
  }

  get qualityTier(): PS1QualityTier {
    return this.resolved.quality;
  }

  /** Current low-res render target size in pixels. */
  get renderSize(): { width: number; height: number } {
    return { width: this.rt.width, height: this.rt.height };
  }

  /** The active scene render target (changes on quality/preset changes). */
  get renderTarget(): THREE.WebGLRenderTarget {
    return this.rt;
  }

  /** Live composite uniforms (uMyopia, uSquint, uFlash, ...). */
  get uniforms(): Readonly<Record<string, THREE.IUniform>> {
    return this.compMat.uniforms;
  }

  get disposed(): boolean {
    return this.isDisposed;
  }

  /** Number of materials evaluated by the patcher (uuid cache size). */
  get patchedMaterialCount(): number {
    return this.patched.size;
  }

  isMaterialPatched(mat: THREE.Material): boolean {
    return this.patched.has(mat.uuid);
  }

  // ------------------------------ controls --------------------------------

  /** Defocus driver 0..1: 0=sharp, 0.35=everyday, 1=nearly blind. No fog side effects. */
  setMyopia(amount01: number): void {
    this.myopia = THREE.MathUtils.clamp(amount01, 0, 1);
  }

  /** Vignette channel 0..1; only effective when the preset enables vignette. */
  setVignette(strength01: number): void {
    this.vignetteStrength = THREE.MathUtils.clamp(strength01, 0, 1);
  }

  /** White flash, decays over ms. */
  flashWhite(ms = 250): void {
    this.flashValue = 1;
    this.flashDecay = 1000 / Math.max(1, ms);
  }

  /** Camera shake for ms. */
  shake(strength = 0.6, ms = 450): void {
    this.shakeAmp = THREE.MathUtils.clamp(strength, 0, 2);
    this.shakeT = ms;
    this.shakeDur = ms;
  }

  /** Merge a partial preset at runtime; rebuilds the target on size changes. */
  setPreset(preset: PS1Preset): void {
    const prev = this.resolved;
    const next = mergePS1Preset(prev, preset);
    const sizeChanged =
      next.resolution.width !== prev.resolution.width ||
      next.resolution.height !== prev.resolution.height ||
      next.resolutionScale !== prev.resolutionScale ||
      next.quality !== prev.quality;
    this.resolved = next;
    this.vignetteStrength = THREE.MathUtils.clamp(next.vignette.strength, 0, 1);
    this.syncPresetUniforms();
    applyPresetToScene(this.scene, next);
    if (sizeChanged) {
      this.buildRenderTarget(
        effectiveRenderSize(next.resolution, next.resolutionScale, next.quality),
      );
    }
  }

  /** Switch quality tier at runtime (resolution scale of the render target). */
  setQualityTier(tier: PS1QualityTier): void {
    if (tier === this.resolved.quality) return;
    this.setPreset({ quality: tier });
  }

  /** Subscribe a before-composite hook; returns the unsubscribe function. */
  onBeforeComposite(listener: PS1BeforeComposite): () => void {
    this.beforeCompositeListeners.add(listener);
    return () => {
      this.beforeCompositeListeners.delete(listener);
    };
  }

  // ------------------------------ frame -----------------------------------

  /** Per frame: update uniforms, patch new materials, render RT then composite. */
  render(dt: number, camera: THREE.PerspectiveCamera): void {
    if (this.isDisposed) throw new Error('PS1RenderPipeline: render() after dispose()');

    if (this.flashValue > 0) {
      this.flashValue = Math.max(0, this.flashValue - dt * this.flashDecay);
    }

    const u = this.compMat.uniforms;
    // Fog is never derived from myopia here; the preset owns scene.fog.
    u.uMyopia.value = this.resolved.distanceDefocus.enabled ? this.myopia : 0;
    u.uSquint.value = this.resolved.vignette.enabled ? this.vignetteStrength : 0;
    u.uFlash.value = this.flashValue;
    u.uNear.value = camera.near;
    u.uFar.value = camera.far;

    // Camera shake: temporary offset during the scene pass, restored after.
    const savedPos = camera.position.clone();
    const savedRoll = camera.rotation.z;
    if (this.shakeT > 0) {
      this.shakeT = Math.max(0, this.shakeT - dt * 1000);
      const k = this.shakeAmp * 0.05 * Math.pow(this.shakeT / this.shakeDur, 2);
      camera.position.x += (Math.random() * 2 - 1) * k;
      camera.position.y += (Math.random() * 2 - 1) * k;
      camera.position.z += (Math.random() * 2 - 1) * k;
      camera.rotation.z += (Math.random() * 2 - 1) * k * 0.4;
    }

    this.patchScene(this.scene);

    this.renderer.setRenderTarget(this.rt);
    this.renderer.render(this.scene, camera);

    camera.position.copy(savedPos);
    camera.rotation.z = savedRoll;

    const frame: PS1CompositeFrame = {
      dt,
      renderer: this.renderer,
      scene: this.scene,
      camera,
      renderTarget: this.rt,
    };
    for (const listener of this.beforeCompositeListeners) listener(frame);

    this.renderer.setRenderTarget(null);
    this.renderer.render(this.compScene, this.compCam);
  }

  // ------------------------------ teardown --------------------------------

  /**
   * Free the render target, depth texture, composite quad geometry and
   * composite material, and drop patcher/hook state. Idempotent; the
   * pipeline rejects render() afterwards.
   */
  dispose(): void {
    if (this.isDisposed) return;
    this.isDisposed = true;
    this.rt.dispose();
    this.depthTexture.dispose();
    this.quadGeo.dispose();
    this.compMat.dispose();
    this.patched.clear();
    this.beforeCompositeListeners.clear();
  }

  // ------------------------------ internal --------------------------------

  private buildRenderTarget(size: { width: number; height: number }): void {
    const depthTexture = new THREE.DepthTexture(size.width, size.height, THREE.UnsignedIntType);
    depthTexture.magFilter = THREE.NearestFilter;
    depthTexture.minFilter = THREE.NearestFilter;

    const rt = new THREE.WebGLRenderTarget(size.width, size.height, {
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      format: THREE.RGBAFormat,
      type: THREE.UnsignedByteType,
      depthBuffer: true,
      stencilBuffer: false,
      depthTexture,
      generateMipmaps: false,
    });

    const prevRt = this.rt;
    const prevDepth = this.depthTexture;
    this.rt = rt;
    this.depthTexture = depthTexture;
    prevRt?.dispose();
    prevDepth?.dispose();

    if (this.compMat) {
      const u = this.compMat.uniforms;
      u.tDiffuse.value = rt.texture;
      u.tDepth.value = depthTexture;
      (u.uResolution.value as THREE.Vector2).set(size.width, size.height);
    }
  }

  private syncPresetUniforms(): void {
    const u = this.compMat.uniforms;
    const p = this.resolved;
    u.uDither.value = p.dither ? 0.8 : 0;
    u.uCaBase.value = p.chromaticAberration;
    u.uClearDist.value = p.distanceDefocus.clearDistance;
    u.uDefocusLin.value = p.distanceDefocus.linearGain;
    u.uDefocusQuad.value = p.distanceDefocus.quadraticGain;
    u.uDefocusBasePx.value = p.distanceDefocus.baseRadiusPx;
    u.uDefocusMaxPx.value = p.distanceDefocus.maxRadiusPx;
  }

  private patchMaterial(mat: THREE.Material): void {
    if (this.patched.has(mat.uuid)) return;
    // Cache by uuid so opt-outs and non-Mesh materials are decided once.
    this.patched.add(mat.uuid);
    if (!shouldPatchMaterial(mat)) return;
    applyMaterialPatch(mat);
  }

  private patchScene(root: THREE.Object3D): void {
    root.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (!mesh.material) return;
      if (Array.isArray(mesh.material)) mesh.material.forEach((m) => this.patchMaterial(m));
      else this.patchMaterial(mesh.material);
    });
  }
}
