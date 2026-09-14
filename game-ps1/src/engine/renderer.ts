// ============================================================================
// PS1 渲染管线（engine 层）：
//  - 场景 → 320×240 RenderTarget（nearest 纹理）
//  - 全屏合成 pass：近视远距失焦 + 眯眼暗角 + 轻微色散 + Bayer 抖动 + 白闪
//  - 材质补丁：近处点采样、远处 mip 级别稳定；建筑几何与 UV 不随镜头游动
//  - 1m 内保持可辨；1m 外由近视失焦 + FogExp2 迅速吞没到雾中
// ============================================================================
import * as THREE from 'three'
import type { PS1API } from './contract'

export const PS1_WIDTH = 320
export const PS1_HEIGHT = 240
/** 场景背景 / 雾色（暗红冷灰，见 CONTRACT §8） */
export const PS1_BG = 0x0d0809

// 眯眼（myopia=0）时只保留极薄的空气感；日常值 0.35 约为 0.22，
// 惊醒后的 0.55 约为 0.34。这样 1m 内仍看得清，室内远端才被雾吃掉。
const FOG_BASE = 0.03
const FOG_GAIN = 0.62
const FOG_MYOPIA_POWER = 1.15

const COMPOSITE_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
	vUv = uv;
	gl_Position = vec4( position.xy, 0.0, 1.0 );
}
`

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
	float beyondClear = max( dist - 1.0, 0.0 );
	float distanceDefocus = 1.0 - exp( -0.60 * beyondClear - 0.26 * beyondClear * beyondClear );
	float defocus = uMyopia * distanceDefocus;
	float px = 0.5 + 6.4 * defocus;
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
	float ca = 0.0032 + 0.0035 * uMyopia + 0.0018 * uSquint;
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
`

export class PS1Pipeline implements PS1API {
	readonly renderer: THREE.WebGLRenderer
	readonly scene: THREE.Scene

	private rt: THREE.WebGLRenderTarget
	private depthTexture: THREE.DepthTexture
	private compScene = new THREE.Scene()
	private compCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)
	private compMat: THREE.ShaderMaterial

	private patched = new WeakSet<THREE.Material>()

	private myopia = 0.35
	private squint = 0
	private flashValue = 0
	private flashDecay = 4
	private shakeAmp = 0
	private shakeT = 0
	private shakeDur = 1

	constructor(renderer: THREE.WebGLRenderer, scene: THREE.Scene) {
		this.renderer = renderer
		this.scene = scene

		this.depthTexture = new THREE.DepthTexture(PS1_WIDTH, PS1_HEIGHT, THREE.UnsignedIntType)
		this.depthTexture.magFilter = THREE.NearestFilter
		this.depthTexture.minFilter = THREE.NearestFilter

		this.rt = new THREE.WebGLRenderTarget(PS1_WIDTH, PS1_HEIGHT, {
			minFilter: THREE.NearestFilter,
			magFilter: THREE.NearestFilter,
			format: THREE.RGBAFormat,
			type: THREE.UnsignedByteType,
			depthBuffer: true,
			stencilBuffer: false,
			depthTexture: this.depthTexture,
			generateMipmaps: false,
		})

		this.compMat = new THREE.ShaderMaterial({
			vertexShader: COMPOSITE_VERT,
			fragmentShader: COMPOSITE_FRAG,
			uniforms: {
				tDiffuse: { value: this.rt.texture },
				tDepth: { value: this.depthTexture },
				uResolution: { value: new THREE.Vector2(PS1_WIDTH, PS1_HEIGHT) },
				uNear: { value: 0.05 },
				uFar: { value: 60 },
				uMyopia: { value: this.myopia },
				uSquint: { value: 0 },
				uFlash: { value: 0 },
				uDither: { value: 0.8 },
			},
			depthTest: false,
			depthWrite: false,
		})
		const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.compMat)
		quad.frustumCulled = false
		this.compScene.add(quad)
	}

	// ------------------------------ PS1API ----------------------------------

	/** 近视强度 0..1：0=眯眼后清晰，0.35=日常（1m 外渐入雾），1=几乎全盲 */
	setMyopia(amount01: number): void {
		this.myopia = THREE.MathUtils.clamp(amount01, 0, 1)
	}

	/** 白屏闪烁（ms 后消退） */
	flashWhite(ms = 250): void {
		this.flashValue = 1
		this.flashDecay = 1000 / Math.max(1, ms)
	}

	/** 相机震屏 */
	shake(strength = 0.6, ms = 450): void {
		this.shakeAmp = THREE.MathUtils.clamp(strength, 0, 2)
		this.shakeT = ms
		this.shakeDur = ms
	}

	/** 引擎内部：每帧把输入层 squint 量传进来驱动暗角 */
	setSquint(v: number): void {
		this.squint = THREE.MathUtils.clamp(v, 0, 1)
	}

	// ------------------------------ 内部 ------------------------------------

	/** 给场景材质设置低清采样；像素感由低分辨率 RT 而非几何跳格提供。 */
	private patchMaterial(mat: THREE.Material): void {
		if (this.patched.has(mat)) return
		this.patched.add(mat)
		if (!mat.type.startsWith('Mesh')) return

		// 贴图点采样（PS1 无过滤）
		const slots = [
			'map', 'emissiveMap', 'lightMap', 'aoMap', 'normalMap', 'bumpMap',
			'roughnessMap', 'metalnessMap', 'alphaMap', 'specularMap',
		] as const
		for (const s of slots) {
			const tex = (mat as unknown as Record<string, THREE.Texture | null>)[s]
			if (tex) {
				// 墙皮在贴脸时保持像素块；它退到远处/斜视时用 mip 过滤，避免
				// 32px 重复纹理在玩家移动时产生闪烁性的采样爬行。
				const stableMinification = tex.userData.ps1StableMinification === true
				tex.magFilter = THREE.NearestFilter
				tex.minFilter = stableMinification ? THREE.LinearMipmapLinearFilter : THREE.NearestFilter
				tex.generateMipmaps = stableMinification
				tex.needsUpdate = true
			}
		}
		mat.needsUpdate = true
	}

	private patchScene(root: THREE.Object3D): void {
		root.traverse((obj) => {
			const mesh = obj as THREE.Mesh
			if (!mesh.material) return
			if (Array.isArray(mesh.material)) mesh.material.forEach((m) => this.patchMaterial(m))
			else this.patchMaterial(mesh.material)
		})
	}

	/** 每帧：更新 uniforms / 雾密度 / 震屏，先渲染低清 RT 再合成上屏 */
	render(dt: number, camera: THREE.PerspectiveCamera): void {
		if (this.flashValue > 0) {
			this.flashValue = Math.max(0, this.flashValue - dt * this.flashDecay)
		}

		// 雾密度随近视强度：近处没有额外离焦，1m 外才与 shader 的失焦一起渐浓。
		// 次线性响应避免日常/惊醒两个室内状态被直接压成纯黑；眯眼时仅留 FOG_BASE。
		if (this.scene.fog instanceof THREE.FogExp2) {
			this.scene.fog.density = FOG_BASE + FOG_GAIN * Math.pow(this.myopia, FOG_MYOPIA_POWER)
		}

		const u = this.compMat.uniforms
		u.uMyopia.value = this.myopia
		u.uSquint.value = this.squint
		u.uFlash.value = this.flashValue
		u.uNear.value = camera.near
		u.uFar.value = camera.far

		// 震屏（渲染期间临时偏移相机，结束后还原）
		const savedPos = camera.position.clone()
		const savedRoll = camera.rotation.z
		if (this.shakeT > 0) {
			this.shakeT = Math.max(0, this.shakeT - dt * 1000)
			const k = this.shakeAmp * 0.05 * Math.pow(this.shakeT / this.shakeDur, 2)
			camera.position.x += (Math.random() * 2 - 1) * k
			camera.position.y += (Math.random() * 2 - 1) * k
			camera.position.z += (Math.random() * 2 - 1) * k
			camera.rotation.z += (Math.random() * 2 - 1) * k * 0.4
		}

		this.patchScene(this.scene)

		this.renderer.setRenderTarget(this.rt)
		this.renderer.render(this.scene, camera)

		camera.position.copy(savedPos)
		camera.rotation.z = savedRoll

		this.renderer.setRenderTarget(null)
		this.renderer.render(this.compScene, this.compCam)
	}
}
