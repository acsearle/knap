// The ground floor (DESIGN.md §6.1 "Ground", §2.6): drawn the same way in edit and simulate mode —
// an unbounded, barely darker tint plus the contact shadow (shadow.ts), and nothing else on the
// floor (no lines: they competed with the edit grid). Drawn behind everything: parts, their
// outlines and the edit grid are drawn over it.
//
// Technique: one full-screen triangle pair whose fragment shader intersects each pixel's view ray
// (orthographic: parallel rays, from the inverse view-projection) with the plane y = level. So the
// floor reaches every edge of the view at any zoom and pan, is never clipped by the camera's near /
// far planes, and needs no geometry that has to follow the camera. The contact shadow is looked up
// at that floor point in the shadow texture (bilinear) and drawn as a near-black at SHADOW_MAX
// opacity over the tint (two lobes, shadowmath.ts).
// - Seen from above (the view direction points down): tint + shadow.
// - Seen from below: nothing (it must not hide the model).
// - Edge-on (FRONT, …): a plane covers nothing, so the floor is drawn as a line at its level (a
//   separate FatLines segment from the viewport, faded in as the view gets within ≈ 7° of
//   edge-on); tint and shadow fade out over the same range, so orbiting through edge-on is
//   continuous.
// No time-dependent input: it is redrawn only when the view renders (on demand).
import * as THREE from 'three';
import { SHADOW_AMBIENT, SHADOW_CONTACT, SHADOW_EDGE_FADE } from './shadowmath';
import type { ShadowFrame } from './shadowmath';

/** Opacity of the floor's tint (black over the background), seen from above. */
export const FLOOR_TINT = 0.03;
/** The shadow's colour (display space): a near-black neutral. */
export const SHADOW_COLOR: readonly [number, number, number] = [0.08, 0.085, 0.09];

const VERT = /* glsl */ `
varying vec2 vNdc;
void main() {
  vNdc = position.xy;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;

const FRAG = /* glsl */ `
uniform mat4 uInvVP;
uniform float uLevel;
uniform float uFwdY;      // y of the unit view direction (< 0: looking down at the floor's top)
uniform float uTint;
uniform sampler2D uShadow;
uniform float uShadowOn;  // 0: no shadow texture (nothing near the floor)
uniform vec4 uFrame;      // shadow frame on the floor: x0, z0, w, d
uniform vec2 uShadowMax;  // opacity of the contact (R) and ambient (G) lobes
uniform float uEdgeFade;
uniform vec3 uShadowColor;
varying vec2 vNdc;

void main() {
  float above = smoothstep(0.02, 0.12, -uFwdY);   // seen from above, not near edge-on
  if (above <= 0.0) discard;
  float A = uTint * above;                        // tint: black over the background
  float S = 0.0;
  if (uShadowOn > 0.0) {
    vec4 a = uInvVP * vec4(vNdc, -1.0, 1.0);
    vec4 b = uInvVP * vec4(vNdc, 1.0, 1.0);
    a /= a.w;
    b /= b.w;
    vec3 d = b.xyz - a.xyz;
    float t = (uLevel - a.y) / d.y;
    vec2 xz = a.xz + t * d.xz;
    vec2 uv = (xz - uFrame.xy) / uFrame.zw;
    if (all(greaterThan(uv, vec2(0.0))) && all(lessThan(uv, vec2(1.0)))) {
      // bilinear between texel centres (the hardware filter); faded at the frame's edge (shadowmath)
      vec2 e2 = min(xz - uFrame.xy, uFrame.xy + uFrame.zw - xz);
      float e = smoothstep(0.0, 1.0, clamp(min(e2.x, e2.y) / uEdgeFade, 0.0, 1.0));
      S = dot(texture2D(uShadow, uv).rg, uShadowMax) * e * above;
    }
  }
  // premultiplied "over": the shadow on top of the tint
  float alpha = S + A * (1.0 - S);
  if (alpha <= 0.001) discard;
  gl_FragColor = vec4(uShadowColor * S / alpha, alpha);
}`;

export interface FloorState {
  /** World y of the floor plane. */
  y: number;
}

/** View direction within this |y| of horizontal: the floor is (nearly) edge-on and drawn as a line. */
export const FLOOR_EDGE_Y = 0.12;

/** Opacity of the edge-on floor line for a view direction with y component `fwdY`. */
export function floorEdgeAlpha(fwdY: number): number {
  const x = Math.min(1, Math.abs(fwdY) / FLOOR_EDGE_Y);
  return 1 - x * x * (3 - 2 * x);
}

export class Floor extends THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial> {
  private readonly invVP = new THREE.Matrix4();

  constructor() {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, -1, 0, 1, 1, 0, -1, 1, 0]), 3));
    const mat = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: {
        uInvVP: { value: new THREE.Matrix4() },
        uLevel: { value: 0 },
        uFwdY: { value: -1 },
        uTint: { value: FLOOR_TINT },
        uShadow: { value: null },
        uShadowOn: { value: 0 },
        uFrame: { value: new THREE.Vector4(0, 0, 1, 1) },
        uShadowMax: { value: new THREE.Vector2(SHADOW_CONTACT, SHADOW_AMBIENT) },
        uEdgeFade: { value: SHADOW_EDGE_FADE },
        uShadowColor: { value: new THREE.Vector3(...SHADOW_COLOR) },
      },
      transparent: false, // drawn first (renderOrder), blended manually like the grid
      blending: THREE.CustomBlending,
      blendSrc: THREE.SrcAlphaFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
      blendSrcAlpha: THREE.ZeroFactor,
      blendDstAlpha: THREE.OneFactor,
      depthTest: false,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    super(geo, mat);
    this.renderOrder = -110; // before the grid (-100) and every part
    this.frustumCulled = false;
    this.visible = false;
  }

  /**
   * Per-frame uniforms: the camera (matrices up to date), the floor, the view direction's y, and
   * the contact shadow (its texture and frame, or null for none).
   */
  update(camera: THREE.Camera, state: FloorState, fwdY: number, shadow: { texture: THREE.Texture; frame: ShadowFrame } | null): void {
    this.invVP.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse).invert();
    const u = this.material.uniforms;
    (u.uInvVP!.value as THREE.Matrix4).copy(this.invVP);
    u.uLevel!.value = state.y;
    u.uFwdY!.value = fwdY;
    u.uShadowOn!.value = shadow ? 1 : 0;
    u.uShadow!.value = shadow ? shadow.texture : null;
    if (shadow) {
      const f = shadow.frame;
      (u.uFrame!.value as THREE.Vector4).set(f.x0, f.z0, f.w, f.d);
    }
  }

  override dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
  }
}
