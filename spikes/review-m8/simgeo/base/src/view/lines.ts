// Anti-aliased screen-space line segments of constant pixel width (overlays, glyphs, view cube).
// Each segment is an instanced quad expanded in screen space; the fragment shader computes the
// exact distance to the segment (round caps) and a 1-px coverage ramp. Colours are display-space
// (sRGB) values written straight to the framebuffer.
import * as THREE from 'three';

export interface LineUniforms {
  /** Drawing-buffer size in device pixels. */
  uResolution: { value: THREE.Vector2 };
}

export function createLineUniforms(): LineUniforms {
  return { uResolution: { value: new THREE.Vector2(1, 1) } };
}

const VERT = /* glsl */ `
uniform vec2 uResolution;
uniform float uWidth;
uniform float uDepthBias;
attribute vec3 iA;
attribute vec3 iB;
attribute vec4 iColor;
varying vec2 vP;
flat varying vec2 vA;
flat varying vec2 vB;
flat varying vec4 vColor;
#ifdef ID_FADE
varying float vViewDepth;
#endif
void main() {
  vec4 ca = projectionMatrix * modelViewMatrix * vec4(iA, 1.0);
  vec4 cb = projectionMatrix * modelViewMatrix * vec4(iB, 1.0);
  vec2 sa = (ca.xy / ca.w * 0.5 + 0.5) * uResolution;
  vec2 sb = (cb.xy / cb.w * 0.5 + 0.5) * uResolution;
#ifdef ID_FADE
  vViewDepth = -(modelViewMatrix * vec4(position.x < 0.0 ? iA : iB, 1.0)).z;
#endif
  vec2 d = sb - sa;
  float L = length(d);
  vec2 dir = L > 1e-4 ? d / L : vec2(1.0, 0.0);
  vec2 nrm = vec2(-dir.y, dir.x);
  float hw = uWidth * 0.5 + 1.0;
  bool atA = position.x < 0.0;
  vec2 sp = (atA ? sa : sb) + dir * position.x * hw + nrm * position.y * hw;
  float z = (atA ? ca.z / ca.w : cb.z / cb.w) - uDepthBias;
  gl_Position = vec4(sp / uResolution * 2.0 - 1.0, z, 1.0);
  vP = sp;
  vA = sa;
  vB = sb;
  vColor = iColor;
}`;

const FRAG = /* glsl */ `
uniform float uWidth;
uniform float uOpacity;
varying vec2 vP;
flat varying vec2 vA;
flat varying vec2 vB;
flat varying vec4 vColor;
#ifdef ID_FADE
// Fainter where another part is in front (root marker): the outline ID buffer (outline.ts) holds
// the nearest surface's view depth and id per texel; a texel of a part other than slot uFadeSlot
// nearer than this fragment by more than uFadeEps multiplies its alpha by uFadeAlpha.
uniform highp sampler2D uFadeTex;
uniform float uFadeSlot;
uniform float uFadeSS;
uniform float uFadeAlpha;
uniform float uFadeEps;
varying float vViewDepth;
#endif
void main() {
  vec2 pa = vP - vA;
  vec2 ba = vB - vA;
  float bb = dot(ba, ba);
  float h = bb > 1e-8 ? clamp(dot(pa, ba) / bb, 0.0, 1.0) : 0.0;
  float d = length(pa - ba * h);
  float a = clamp(uWidth * 0.5 + 0.5 - d, 0.0, 1.0) * vColor.a * uOpacity;
#ifdef ID_FADE
  if (uFadeSS > 0.0) {
    ivec2 sz = textureSize(uFadeTex, 0);
    ivec2 q = clamp(ivec2(gl_FragCoord.xy * uFadeSS), ivec2(0), sz - 1);
    vec2 di = texelFetch(uFadeTex, q, 0).xy;
    float id = abs(di.y);
    if (id > 0.5 && floor((id - 1.0) / 4096.0) != uFadeSlot && di.x < vViewDepth - uFadeEps) a *= uFadeAlpha;
  }
#endif
  if (a <= 0.002) discard;
  gl_FragColor = vec4(vColor.rgb, a);
}`;

export interface FatLinesOptions {
  /** Line width in device pixels (multiply CSS px by the pixel ratio). */
  width?: number;
  depthTest?: boolean;
  /** Pull the line toward the camera by this much NDC depth (0..2 range) when depth testing. */
  depthBias?: number;
  opacity?: number;
  /**
   * Outline ID texture (root marker): fragments where a part other than the fade slot is in front
   * are drawn fainter. See setFade().
   */
  idFade?: THREE.Texture;
}

/** A set of independent segments drawn as one instanced mesh. */
export class FatLines extends THREE.Mesh<THREE.InstancedBufferGeometry, THREE.ShaderMaterial> {
  private capacity = 0;

  constructor(uniforms: LineUniforms, opts: FatLinesOptions = {}) {
    const uni: Record<string, THREE.IUniform> = {
      uResolution: uniforms.uResolution,
      uWidth: { value: opts.width ?? 2 },
      uDepthBias: { value: opts.depthBias ?? 0 },
      uOpacity: { value: opts.opacity ?? 1 },
    };
    if (opts.idFade) {
      uni.uFadeTex = { value: opts.idFade };
      uni.uFadeSlot = { value: -1 };
      uni.uFadeSS = { value: 0 };
      uni.uFadeAlpha = { value: 1 };
      uni.uFadeEps = { value: 0 };
    }
    const mat = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: uni,
      defines: opts.idFade ? { ID_FADE: '' } : {},
      transparent: true,
      depthTest: opts.depthTest ?? false,
      depthWrite: false,
    });
    super(FatLines.makeGeometry(0), mat);
    this.frustumCulled = false;
    this.setSegments(new Float32Array(0));
  }

  /** A fresh instanced quad geometry with room for `capacity` segments. */
  private static makeGeometry(capacity: number): THREE.InstancedBufferGeometry {
    const geo = new THREE.InstancedBufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3));
    geo.setIndex([0, 1, 2, 0, 2, 3]);
    geo.setAttribute('iA', new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3));
    geo.setAttribute('iB', new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3));
    geo.setAttribute('iColor', new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4));
    geo.instanceCount = 0;
    return geo;
  }

  /**
   * ID-fade mode only. `slot` = the outline-ID slot that never fades the set (the part it belongs
   * to); `ss` = ID texels per drawing-buffer pixel (0 disables fading); `alpha` = the factor where
   * another part is nearer than the fragment by more than `eps` world units.
   */
  setFade(slot: number, ss: number, alpha: number, eps: number): void {
    const u = this.material.uniforms;
    if (!u.uFadeTex) return;
    u.uFadeSlot!.value = slot;
    u.uFadeSS!.value = ss;
    u.uFadeAlpha!.value = alpha;
    u.uFadeEps!.value = eps;
  }

  set width(px: number) {
    this.material.uniforms.uWidth!.value = px;
  }
  get width(): number {
    return this.material.uniforms.uWidth!.value as number;
  }

  /**
   * Replace the segments: `ends` holds 6 floats per segment (ax ay az bx by bz); `colors` 4 floats
   * per segment (r g b a, display space 0..1) or one RGBA for all.
   */
  setSegments(ends: Float32Array, colors: Float32Array | readonly [number, number, number, number] = [0.13, 0.13, 0.13, 1]): void {
    const n = Math.floor(ends.length / 6);
    if (n > this.capacity) {
      // Grow by replacing the whole geometry: three.js caches an instanced geometry's maximum
      // instance count at its first draw (WebGLBindingStates `_maxInstanceCount`) and caps later
      // draws at it, so swapping larger attributes into the same geometry would truncate.
      // Disposing the old geometry also frees its GPU buffers.
      this.capacity = Math.max(n, 4, this.capacity * 2);
      this.geometry.dispose();
      this.geometry = FatLines.makeGeometry(this.capacity);
    }
    const geo = this.geometry;
    const a = geo.getAttribute('iA') as THREE.InstancedBufferAttribute;
    const b = geo.getAttribute('iB') as THREE.InstancedBufferAttribute;
    const c = geo.getAttribute('iColor') as THREE.InstancedBufferAttribute;
    const aa = a.array as Float32Array;
    const ba = b.array as Float32Array;
    const ca = c.array as Float32Array;
    for (let i = 0; i < n; i++) {
      aa[3 * i] = ends[6 * i]!;
      aa[3 * i + 1] = ends[6 * i + 1]!;
      aa[3 * i + 2] = ends[6 * i + 2]!;
      ba[3 * i] = ends[6 * i + 3]!;
      ba[3 * i + 1] = ends[6 * i + 4]!;
      ba[3 * i + 2] = ends[6 * i + 5]!;
      const per = colors.length >= 4 * n && colors.length !== 4 ? 4 * i : 0;
      ca[4 * i] = colors[per]!;
      ca[4 * i + 1] = colors[per + 1]!;
      ca[4 * i + 2] = colors[per + 2]!;
      ca[4 * i + 3] = colors[per + 3]!;
    }
    a.needsUpdate = true;
    b.needsUpdate = true;
    c.needsUpdate = true;
    geo.instanceCount = n;
    this.visible = n > 0;
  }

  override dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
  }
}

/** '#rrggbb' → [r, g, b, a] in display space 0..1. */
export function rgba(hex: string, alpha = 1): [number, number, number, number] {
  const v = parseInt(hex.replace('#', ''), 16);
  return [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255, alpha];
}

/** Collects segments for FatLines.setSegments. */
export class SegmentBuilder {
  readonly ends: number[] = [];
  readonly colors: number[] = [];
  seg(a: readonly number[], b: readonly number[], color: readonly number[]): void {
    this.ends.push(a[0]!, a[1]!, a[2]!, b[0]!, b[1]!, b[2]!);
    this.colors.push(color[0]!, color[1]!, color[2]!, color[3]!);
  }
  polyline(points: readonly (readonly number[])[], color: readonly number[], closed = false): void {
    for (let i = 0; i + 1 < points.length; i++) this.seg(points[i]!, points[i + 1]!, color);
    if (closed && points.length > 2) this.seg(points[points.length - 1]!, points[0]!, color);
  }
  apply(lines: FatLines): void {
    lines.setSegments(new Float32Array(this.ends), new Float32Array(this.colors));
  }
}
