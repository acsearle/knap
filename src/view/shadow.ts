// The ground's contact shadow, GPU side (DESIGN.md §6.1 "Ground"; constants and the frame logic
// in shadowmath.ts). The usual "contact shadows" recipe, without a camera:
// 1. Casters: every visible part mesh (its own geometry, a shared material) is drawn straight
//    "from below" into an RGBA8 texture covering the frame on the floor: the vertex shader maps
//    world (x, z) to the frame, the fragment shader writes strength(h) = (1 − h/SHADOW_H)² for the
//    fragment's height h above the floor, and MAX blending keeps the strongest = the lowest surface
//    over each texel. No depth buffer, no culling (both faces count).
// 2. Two separable Gaussian passes over two channels: R the contact lobe (σ = SHADOW_BLUR), G the
//    ambient lobe (σ = SHADOW_AMBIENT_BLUR, linear-sampled pairs of texels); both a fixed number of
//    texels, since the texel is a fixed world size.
// 3. The floor shader (floor.ts) samples the result at each pixel's floor point and draws
//    SHADOW_CONTACT·R + SHADOW_AMBIENT·G of a near-black over its tint — so it is never in the outline pass's
//    buffers, draws before (under) everything, and parts drawn later cover it.
// Rendered only when asked (the viewport asks when a pose, the model, visibility or the floor
// level changed), never per view change: it does not depend on the camera at all.
import * as THREE from 'three';
import {
  SHADOW_AMBIENT,
  SHADOW_CONTACT,
  SHADOW_H,
  SHADOW_KERNEL_MAX,
  SHADOW_MAX,
  SHADOW_TEXEL,
  ambientKernel,
  fitFrame,
  frameEdgeFade,
  frameTexels,
  gaussianKernel,
} from './shadowmath';
import type { CasterBox, ShadowFrame } from './shadowmath';

const CASTER_VERT = /* glsl */ `
uniform vec4 uFrame;     // x0, z0, w, d
uniform float uFloorY;
varying float vH;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vH = w.y - uFloorY;
  gl_Position = vec4((w.x - uFrame.x) / uFrame.z * 2.0 - 1.0, (w.z - uFrame.y) / uFrame.w * 2.0 - 1.0, 0.0, 1.0);
}`;

const CASTER_FRAG = /* glsl */ `
uniform float uH;
varying float vH;
void main() {
  float t = 1.0 - clamp(vH / uH, 0.0, 1.0);
  float s = t * t;
  if (s <= 0.0) discard;
  gl_FragColor = vec4(s, s, s, 1.0);
}`;

const BLUR_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = position.xy * 0.5 + 0.5;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;

const BLUR_FRAG = /* glsl */ `
#define KMAX ${SHADOW_KERNEL_MAX}
uniform sampler2D uTex;
uniform vec2 uStep;            // one texel along the blur direction, in uv
uniform float uW[KMAX + 1];     // contact lobe (R): per-texel weights, radius uR
uniform int uR;
uniform float uAW0;             // ambient lobe (G): centre weight
uniform float uAO[KMAX];        //   linear-sampled tap offsets (texels) and weights
uniform float uAW[KMAX];
varying vec2 vUv;
void main() {
  vec2 c = texture2D(uTex, vUv).rg;
  float s = c.r * uW[0];
  float g = c.g * uAW0;
  for (int i = 1; i <= KMAX; i++) {
    if (i > uR) break;
    vec2 o = uStep * float(i);
    s += (texture2D(uTex, vUv + o).r + texture2D(uTex, vUv - o).r) * uW[i];
  }
  for (int k = 0; k < KMAX; k++) {
    vec2 o = uStep * uAO[k];
    g += (texture2D(uTex, vUv + o).g + texture2D(uTex, vUv - o).g) * uAW[k];
  }
  gl_FragColor = vec4(s, g, 0.0, 1.0);
}`;

function target(): THREE.WebGLRenderTarget {
  return new THREE.WebGLRenderTarget(1, 1, {
    type: THREE.UnsignedByteType,
    format: THREE.RGBAFormat,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    wrapS: THREE.ClampToEdgeWrapping,
    wrapT: THREE.ClampToEdgeWrapping,
    depthBuffer: false,
    stencilBuffer: false,
    generateMipmaps: false,
  });
}

export class ContactShadow {
  /** The caster meshes (one per part view; the viewport adds / removes them). */
  readonly scene = new THREE.Scene();
  /** Shared by every caster mesh. */
  readonly casterMaterial: THREE.ShaderMaterial;
  /** Times the shadow texture was rendered (tests: it must not render on camera changes). */
  renders = 0;
  /** Wall ms of the last render's CPU side (the GPU work is asynchronous). */
  lastMs = 0;
  /** The frame of the current texture, or null (nothing within SHADOW_H of the floor). */
  frame: ShadowFrame | null = null;
  /** The floor level the texture was rendered for. */
  floorY = 0;

  private readonly a = target();
  private readonly b = target();
  private readonly blurMat: THREE.ShaderMaterial;
  private readonly fsScene = new THREE.Scene();
  private readonly fsCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly dummyCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly clear = new THREE.Color(0, 0, 0);
  private readonly saveClear = new THREE.Color();

  constructor() {
    this.casterMaterial = new THREE.ShaderMaterial({
      vertexShader: CASTER_VERT,
      fragmentShader: CASTER_FRAG,
      uniforms: {
        uFrame: { value: new THREE.Vector4(0, 0, 1, 1) },
        uFloorY: { value: 0 },
        uH: { value: SHADOW_H },
      },
      side: THREE.DoubleSide,
      depthTest: false,
      depthWrite: false,
      blending: THREE.CustomBlending,
      blendEquation: THREE.MaxEquation,
      blendEquationAlpha: THREE.MaxEquation,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneFactor,
    });
    const k = gaussianKernel();
    const w = new Array<number>(SHADOW_KERNEL_MAX + 1).fill(0);
    k.forEach((x, i) => (w[i] = x));
    const ak = ambientKernel();
    this.blurMat = new THREE.ShaderMaterial({
      vertexShader: BLUR_VERT,
      fragmentShader: BLUR_FRAG,
      uniforms: {
        uTex: { value: null },
        uStep: { value: new THREE.Vector2() },
        uW: { value: w },
        uR: { value: k.length - 1 },
        uAW0: { value: ak.w0 },
        uAO: { value: ak.offsets },
        uAW: { value: ak.weights },
      },
      depthTest: false,
      depthWrite: false,
      blending: THREE.NoBlending,
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
    const tri = new THREE.Mesh(geo, this.blurMat);
    tri.frustumCulled = false;
    this.fsScene.add(tri);
  }

  /** A caster mesh for a part's geometry (matrix and visibility are the caller's). */
  createCaster(geometry: THREE.BufferGeometry): THREE.Mesh {
    const m = new THREE.Mesh(geometry, this.casterMaterial);
    m.matrixAutoUpdate = false;
    m.frustumCulled = false;
    this.scene.add(m);
    return m;
  }

  removeCaster(m: THREE.Mesh): void {
    this.scene.remove(m);
  }

  /** The blurred shadow texture (valid while `frame` is non-null). */
  get texture(): THREE.Texture {
    return this.a.texture;
  }

  /**
   * Re-render for the casters' current poses: fit the frame to `boxes` (the visible parts' world
   * boxes), draw the casters, blur. With nothing near the floor only the frame is cleared.
   */
  render(renderer: THREE.WebGLRenderer, floorY: number, boxes: readonly CasterBox[]): void {
    const t0 = performance.now();
    this.renders++;
    this.floorY = floorY;
    this.frame = fitFrame(boxes, floorY, this.frame);
    const f = this.frame;
    if (!f) {
      this.lastMs = performance.now() - t0;
      return;
    }
    const { nx, nz } = frameTexels(f);
    if (this.a.width !== nx || this.a.height !== nz) {
      this.a.setSize(nx, nz);
      this.b.setSize(nx, nz);
    }
    const prevTarget = renderer.getRenderTarget();
    renderer.getClearColor(this.saveClear);
    const prevAlpha = renderer.getClearAlpha();
    const u = this.casterMaterial.uniforms;
    (u.uFrame!.value as THREE.Vector4).set(f.x0, f.z0, f.w, f.d);
    u.uFloorY!.value = floorY;
    renderer.setRenderTarget(this.a);
    renderer.setClearColor(this.clear, 0);
    renderer.clear(true, false, false);
    renderer.render(this.scene, this.dummyCamera);
    // blur: a → b along x, b → a along z
    const bu = this.blurMat.uniforms;
    bu.uTex!.value = this.a.texture;
    (bu.uStep!.value as THREE.Vector2).set(1 / nx, 0);
    renderer.setRenderTarget(this.b);
    renderer.render(this.fsScene, this.fsCamera);
    bu.uTex!.value = this.b.texture;
    (bu.uStep!.value as THREE.Vector2).set(0, 1 / nz);
    renderer.setRenderTarget(this.a);
    renderer.render(this.fsScene, this.fsCamera);
    renderer.setRenderTarget(prevTarget);
    renderer.setClearColor(this.saveClear, prevAlpha);
    this.lastMs = performance.now() - t0;
  }

  /**
   * Strength (0…1, 1 = SHADOW_MAX) at a floor point, read back from the texture with the floor
   * shader's own rule: both lobes bilinear between texel centres, mixed (shadowMix), times the
   * frame's edge fade. 0 outside.
   */
  sample(renderer: THREE.WebGLRenderer, x: number, z: number): number {
    const f = this.frame;
    if (!f) return 0;
    if (x <= f.x0 || x >= f.x0 + f.w || z <= f.z0 || z >= f.z0 + f.d) return 0;
    const { nx, nz } = frameTexels(f);
    const fx = (x - f.x0) / SHADOW_TEXEL - 0.5;
    const fz = (z - f.z0) / SHADOW_TEXEL - 0.5;
    const ix = Math.max(0, Math.min(nx - 2, Math.floor(fx)));
    const iz = Math.max(0, Math.min(nz - 2, Math.floor(fz)));
    const tx = Math.max(0, Math.min(1, fx - ix));
    const tz = Math.max(0, Math.min(1, fz - iz));
    const buf = new Uint8Array(16);
    renderer.readRenderTargetPixels(this.a, ix, iz, 2, 2, buf);
    const v = (i: number, j: number): number =>
      (SHADOW_CONTACT * buf[(j * 2 + i) * 4]! + SHADOW_AMBIENT * buf[(j * 2 + i) * 4 + 1]!) / 255 / SHADOW_MAX;
    const s = (v(0, 0) * (1 - tx) + v(1, 0) * tx) * (1 - tz) + (v(0, 1) * (1 - tx) + v(1, 1) * tx) * tz;
    return s * frameEdgeFade(f, x, z);
  }

  /** GPU bytes held by the two render targets (diagnostics). */
  get bytes(): number {
    return 2 * this.a.width * this.a.height * 4;
  }

  dispose(): void {
    this.a.dispose();
    this.b.dispose();
    this.casterMaterial.dispose();
    this.blurMat.dispose();
    for (const o of this.fsScene.children) (o as THREE.Mesh).geometry.dispose();
  }
}
