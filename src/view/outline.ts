// Instruction-style outlines as a post-process (DESIGN.md §6.1).
//
// 1. ID pass (no MSAA, `ss`× the drawing buffer): every part is drawn into two targets —
//      A  RG32F  (view depth in world units, signed id)   id = slot·4096 + smoothPatch + 1,
//                                                         negative when the part is selected
//      B  RGBA8  (flat face normal in view space, xy)
//    Background stays (0, 0).
// 2. Edge pass (same resolution): for each texel, is there a line between it and its +x / +y
//    neighbour? A line separates two texels when
//      - their ids differ: silhouettes, boundaries between parts, and every crease (the patch
//        number changes across a crease — see patches.ts), exact at any angle and zoom;
//      - same id but the depth jumps by more than `depthTol` *after* linear extrapolation from
//        either side (self-occlusion of one non-convex patch; extrapolation keeps steep, grazing
//        surfaces from producing false lines);
//      - same id, both faces well facing the camera, and flat face normals differ by more than
//        `creaseDeg` (fallback for the rare patch that meets itself across a crease, e.g. the
//        inner corner of an L-shaped beam's wall).
//    Output RGBA8: r = line to +x, g = line to +y, b/a = the same for the selection boundary.
//    Soft patches (a gear's tooth band, patches.ts meshPatches: negative patch number; the ID pass
//    writes the flag into B.z): inside one, the crease fallback is off, and its depth-jump contours
//    (each tooth occluding the root behind it) are SOFT lines, r/g = ½ instead of 1. A boundary
//    between a soft patch and another patch of the same part (the gear's faces) is soft too unless
//    the depth jumps there (the band occluding something of its own part is a real contour).
//    Silhouettes against the background or other parts stay hard.
// 3. Composite (drawing-buffer resolution, blended over the shaded colour image): the boundary
//    between two texels is a unit segment of the texel grid; the midpoints of these segments,
//    joined around each texel corner, give a polyline that follows the true boundary to within
//    ~¼ texel (a plain staircase would make diagonals ~30 % heavier). Coverage of each output
//    pixel = clamp(w/2 + ½ − distance to that polyline, 0, 1): uniform width w, 1-px
//    anti-aliasing ramp, round joins. Selection outlines are the same with their own width/colour.
//    Soft lines are drawn at strength `softFade` (patches.ts softContourFade: 1 while a tooth pitch
//    covers ≥ 6 device px, 0 at 3): coverage = max(hard polyline, softFade × all-lines polyline),
//    so a soft line never darkens a hard one and with softFade = 1 (or no soft lines) the result
//    is exactly the plain pass.
import * as THREE from 'three';

export interface OutlineParams {
  /** Ink line width in device px. */
  inkWidth: number;
  /** Selection outline width in device px. */
  selWidth: number;
  /** Ink colour, display space rgb 0..1. */
  ink: [number, number, number];
  /** Selection colour, display space rgb 0..1. */
  sel: [number, number, number];
  /** Same-patch depth-jump threshold in world units. */
  depthTol: number;
  /** Same-patch crease fallback angle (degrees). */
  creaseDeg: number;
  /** Strength of the lines inside soft patches, 0…1 (default 1; see patches.ts softContourFade). */
  softFade?: number;
}

export const DEFAULT_OUTLINE: OutlineParams = {
  inkWidth: 1.25,
  selWidth: 3,
  ink: [0.12, 0.125, 0.135],
  sel: [0.06, 0.45, 1.0],
  depthTol: 0.06,
  creaseDeg: 30,
};

/**
 * Depth tolerance inside a soft patch, as a fraction of the ordinary one. The residual along a real
 * tooth-occludes-root contour still varies about 2:1 with sub-texel phase; with the full tolerance
 * the low end fell under it (dashes). See sideResidual in the edge shader.
 */
export const SOFT_TOL = 0.5;

// ------------------------------------------------------------------------------------------
// ID material (one per part view; the id/selection uniforms are per part)

const ID_VERT = /* glsl */ `
precision highp float;
in vec3 position;
in float surfacePatch;
uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;
out vec3 vViewPos;
flat out float vPatch;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vViewPos = mv.xyz;
  vPatch = surfacePatch;
  gl_Position = projectionMatrix * mv;
}`;

const ID_FRAG = /* glsl */ `
precision highp float;
in vec3 vViewPos;
flat in float vPatch;
uniform float uSlot;
uniform float uSelected;
layout(location = 0) out vec4 outDepthId;
layout(location = 1) out vec4 outNormal;
void main() {
  vec3 n = normalize(cross(dFdx(vViewPos), dFdy(vViewPos)));
  if (n.z < 0.0) n = -n;
  // A negative patch number marks a soft patch (patches.ts meshPatches); flagged in outNormal.z.
  float id = uSlot * 4096.0 + mod(abs(vPatch), 4096.0) + 1.0;
  outDepthId = vec4(-vViewPos.z, uSelected > 0.5 ? -id : id, 0.0, 1.0);
  outNormal = vec4(n.xy * 0.5 + 0.5, vPatch < 0.0 ? 1.0 : 0.0, 1.0);
}`;

export function createIdMaterial(slot: number): THREE.RawShaderMaterial {
  return new THREE.RawShaderMaterial({
    glslVersion: THREE.GLSL3,
    vertexShader: ID_VERT,
    fragmentShader: ID_FRAG,
    uniforms: { uSlot: { value: slot }, uSelected: { value: 0 } },
    side: THREE.FrontSide,
  });
}

// ------------------------------------------------------------------------------------------
// Fullscreen passes

const FS_VERT = /* glsl */ `
precision highp float;
in vec3 position;
void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }`;

const EDGE_FRAG = /* glsl */ `
precision highp float;
precision highp sampler2D;
uniform sampler2D tDepthId;
uniform sampler2D tNormal;
uniform float uDepthTol;
uniform float uCreaseCos;
uniform float uMinNz;
uniform float uSoftTol;
layout(location = 0) out vec4 outEdge;

ivec2 gSize;
vec2 G(ivec2 p) { return texelFetch(tDepthId, clamp(p, ivec2(0), gSize - 1), 0).xy; }
vec3 N(ivec2 p) {
  vec2 e = texelFetch(tNormal, clamp(p, ivec2(0), gSize - 1), 0).xy * 2.0 - 1.0;
  return vec3(e, sqrt(max(0.0, 1.0 - dot(e, e))));
}
bool S(ivec2 p) { return texelFetch(tNormal, clamp(p, ivec2(0), gSize - 1), 0).z > 0.5; }

// Same-patch depth residual inside a soft patch: the jump between p and p+d that the surface on
// either side cannot explain by linear extrapolation, using on each side the smaller of its two
// nearest slopes. A tooth flank that occludes the root behind it is seen near grazing and steepens
// toward its silhouette, so its nearest slope alone explains away much of the jump, by an amount
// that depends on where the contour falls within the texel: such a contour slightly off the texel
// grid was drawn dashed and shimmered as the gear turned (review m8 look; measured residual ramping
// 0.53…1.09 × tol along one contour). A planar flank meeting the root (a crease, no line wanted)
// has equal slopes and gives the same residual as before.
float sideResidual(ivec2 p, ivec2 d, float t) {
  vec2 n0 = G(p);
  vec2 n1 = G(p + d);
  float jump = abs(t - n0.x);
  if (abs(n1.y) != abs(n0.y)) return jump;
  float s = n0.x - n1.x;
  vec2 n2 = G(p + 2 * d);
  if (abs(n2.y) == abs(n0.y) && abs(n1.x - n2.x) < abs(s)) s = n1.x - n2.x;
  return abs(t - (n0.x + s));
}

// The soft residual between p and p+d when both lie in one soft patch, else -1.
float softRes(ivec2 p, ivec2 d) {
  vec2 a = G(p);
  vec2 b = G(p + d);
  if (a.y == 0.0 || abs(a.y) != abs(b.y) || !S(p)) return -1.0;
  return min(sideResidual(p, -d, b.x), sideResidual(p + d, d, a.x));
}

// Hysteresis along a soft contour. Even with sideResidual the residual along one contour varies
// about 2:1 with sub-texel phase, so any single threshold still dashes the contours whose strength
// straddles it. A residual above SOFT_LO·tol counts when, walking along the contour (perpendicular
// to d, following the strongest of the three texels across it at each step) through residuals above
// SOFT_LO·tol, a residual above uSoftTol·tol is reached within SOFT_REACH texels.
const float SOFT_LO = 0.25;
const int SOFT_REACH = 32;
bool softChain(ivec2 p, ivec2 d, ivec2 t) {
  ivec2 q = p;
  float hi = uSoftTol * uDepthTol;
  for (int i = 0; i < SOFT_REACH; i++) {
    q += t;
    float best = -1.0;
    ivec2 bq = q;
    for (int k = -1; k <= 1; k++) {
      float r = softRes(q + k * d, d);
      if (r > best) { best = r; bq = q + k * d; }
    }
    if (best > hi) return true;
    if (best <= SOFT_LO * uDepthTol) return false;
    q = bq;
  }
  return false;
}

// x: ink line between p and p+d (1 = hard, 0.5 = soft); y: selection boundary between them.
vec2 between(ivec2 p, ivec2 d, vec2 a) {
  vec2 b = G(p + d);
  float ia = abs(a.y);
  float ib = abs(b.y);
  float selA = a.y < 0.0 ? 1.0 : 0.0;
  float selB = b.y < 0.0 ? 1.0 : 0.0;
  float sel = selA != selB ? 1.0 : 0.0;
  if (ia != ib) {
    // Soft patch against another patch of the same part: soft where the surfaces meet (no depth
    // jump after extrapolation), hard where one occludes the other.
    if (ia == 0.0 || ib == 0.0 || floor((ia - 1.0) / 4096.0) != floor((ib - 1.0) / 4096.0)) return vec2(1.0, sel);
    if (!S(p) && !S(p + d)) return vec2(1.0, sel);
    vec2 a0 = G(p - d);
    vec2 b1 = G(p + 2 * d);
    float jump = abs(b.x - a.x);
    float e1 = abs(a0.y) == ia ? abs(b.x - (2.0 * a.x - a0.x)) : jump;
    float e2 = abs(b1.y) == ib ? abs(a.x - (2.0 * b.x - b1.x)) : jump;
    return vec2(min(e1, e2) > uDepthTol ? 1.0 : 0.5, sel);
  }
  if (ia == 0.0) return vec2(0.0, sel);
  vec2 a0 = G(p - d);
  vec2 b1 = G(p + 2 * d);
  float jump = abs(b.x - a.x);
  float e1 = abs(a0.y) == ia ? abs(b.x - (2.0 * a.x - a0.x)) : jump;
  float e2 = abs(b1.y) == ib ? abs(a.x - (2.0 * b.x - b1.x)) : jump;
  bool soft = S(p);
  if (soft) {
    float r = min(sideResidual(p, -d, b.x), sideResidual(p + d, d, a.x));
    if (r > uSoftTol * uDepthTol) return vec2(0.5, sel);
    if (r <= SOFT_LO * uDepthTol) return vec2(0.0, sel);
    ivec2 t = ivec2(d.y, d.x);
    return vec2(softChain(p, d, t) || softChain(p, d, -t) ? 0.5 : 0.0, sel);
  }
  if (min(e1, e2) > uDepthTol) return vec2(soft ? 0.5 : 1.0, sel);
  if (soft) return vec2(0.0, sel);
  vec3 na = N(p);
  vec3 nb = N(p + d);
  if (na.z > uMinNz && nb.z > uMinNz && dot(na, nb) < uCreaseCos) return vec2(1.0, sel);
  return vec2(0.0, sel);
}

void main() {
  gSize = textureSize(tDepthId, 0);
  ivec2 p = ivec2(gl_FragCoord.xy);
  vec2 a = G(p);
  vec2 ex = between(p, ivec2(1, 0), a);
  vec2 ey = between(p, ivec2(0, 1), a);
  outEdge = vec4(ex.x, ey.x, ex.y, ey.y);
}`;

const COMPOSITE_FRAG = /* glsl */ `
precision highp float;
precision highp sampler2D;
uniform sampler2D tEdge;
uniform float uSS;
uniform float uInkW;
uniform float uSelW;
uniform vec3 uInk;
uniform vec3 uSel;
uniform float uSelOn;
uniform float uSoftFade;
layout(location = 0) out vec4 outColor;

ivec2 eSize;
vec4 E(int i, int j) {
  ivec2 q = ivec2(i, j);
  if (q.x < 0 || q.y < 0 || q.x >= eSize.x || q.y >= eSize.y) return vec4(0.0);
  return texelFetch(tEdge, q, 0);
}
float segDist(vec2 p, vec2 a, vec2 b) {
  vec2 pa = p - a, ba = b - a;
  float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-8), 0.0, 1.0);
  return length(pa - ba * h);
}
// Distance (texel units) from o to the midpoint polyline around corner c, using the 4 incident
// boundary flags f (down, up, left, right) and their midpoints m.
float cornerDist(vec2 o, vec2 c, bvec4 f, vec2 m0, vec2 m1, vec2 m2, vec2 m3) {
  int n = int(f.x) + int(f.y) + int(f.z) + int(f.w);
  if (n == 0) return 1e9;
  if (n == 1) {
    vec2 m = f.x ? m0 : f.y ? m1 : f.z ? m2 : m3;
    return segDist(o, m, c);
  }
  float d = 1e9;
  if (f.x && f.y) d = min(d, segDist(o, m0, m1));
  if (f.z && f.w) d = min(d, segDist(o, m2, m3));
  if (f.x && f.z) d = min(d, segDist(o, m0, m2));
  if (f.x && f.w) d = min(d, segDist(o, m0, m3));
  if (f.y && f.z) d = min(d, segDist(o, m1, m2));
  if (f.y && f.w) d = min(d, segDist(o, m1, m3));
  return d;
}

void main() {
  eSize = textureSize(tEdge, 0);
  vec2 o = gl_FragCoord.xy * uSS;           // edge-texel space; texel (i,j) covers [i,i+1)x[j,j+1)
  float wMax = max(uInkW, uSelOn > 0.5 ? uSelW : 0.0);
  float reach = (wMax * 0.5 + 0.5) * uSS + 0.75;
  int i0 = int(floor(o.x - reach)) - 1;
  int i1 = int(floor(o.x + reach));
  int j0 = int(floor(o.y - reach)) - 1;
  int j1 = int(floor(o.y + reach));
  float dInk = 1e9;
  float dHard = 1e9;
  float dSel = 1e9;
  bool fading = uSoftFade < 1.0;
  for (int j = j0; j <= j1; j++) {
    for (int i = i0; i <= i1; i++) {
      // corner at (i+1, j+1); incident boundaries:
      vec4 e00 = E(i, j);       // r: between (i,j)-(i+1,j)  = segment below the corner
      vec4 e01 = E(i, j + 1);   // r: between (i,j+1)-(i+1,j+1) = segment above
      vec4 e10 = E(i + 1, j);   // g: between (i+1,j)-(i+1,j+1) = segment right
      if (e00.r + e00.g + e01.r + e10.g + e00.b + e00.a + e01.b + e10.a == 0.0) continue;
      vec2 c = vec2(float(i + 1), float(j + 1));
      vec2 m0 = c + vec2(0.0, -0.5);
      vec2 m1 = c + vec2(0.0, 0.5);
      vec2 m2 = c + vec2(-0.5, 0.0);
      vec2 m3 = c + vec2(0.5, 0.0);
      // all lines (hard 1, soft ½); with fading also the hard ones alone
      dInk = min(dInk, cornerDist(o, c, bvec4(e00.r > 0.25, e01.r > 0.25, e00.g > 0.25, e10.g > 0.25), m0, m1, m2, m3));
      if (fading)
        dHard = min(dHard, cornerDist(o, c, bvec4(e00.r > 0.75, e01.r > 0.75, e00.g > 0.75, e10.g > 0.75), m0, m1, m2, m3));
      if (uSelOn > 0.5)
        dSel = min(dSel, cornerDist(o, c, bvec4(e00.b > 0.5, e01.b > 0.5, e00.a > 0.5, e10.a > 0.5), m0, m1, m2, m3));
    }
  }
  float ci = clamp(uInkW * 0.5 + 0.5 - dInk / uSS, 0.0, 1.0);
  if (fading) ci = max(clamp(uInkW * 0.5 + 0.5 - dHard / uSS, 0.0, 1.0), uSoftFade * ci);
  float cs = uSelOn > 0.5 ? clamp(uSelW * 0.5 + 0.5 - dSel / uSS, 0.0, 1.0) : 0.0;
  float a = cs + ci * (1.0 - cs);
  if (a <= 0.0) discard;
  // premultiplied
  outColor = vec4(uSel * cs + uInk * ci * (1.0 - cs), a);
}`;

/** Owns the ID / edge targets and the two fullscreen passes. */
export class OutlinePass {
  readonly idTarget: THREE.WebGLRenderTarget;
  readonly edgeTarget: THREE.WebGLRenderTarget;
  private readonly fsScene = new THREE.Scene();
  private readonly fsCamera = new THREE.Camera();
  private readonly fsMesh: THREE.Mesh;
  private readonly edgeMat: THREE.RawShaderMaterial;
  private readonly compositeMat: THREE.RawShaderMaterial;
  /** ID/edge texels per drawing-buffer pixel. */
  ss = 1;

  constructor() {
    const mk = (count: number): THREE.WebGLRenderTarget =>
      new THREE.WebGLRenderTarget(1, 1, {
        count,
        depthBuffer: count === 2,
        stencilBuffer: false,
        minFilter: THREE.NearestFilter,
        magFilter: THREE.NearestFilter,
        generateMipmaps: false,
      });
    this.idTarget = mk(2);
    const t0 = this.idTarget.textures[0]!;
    t0.format = THREE.RGFormat;
    t0.type = THREE.FloatType;
    t0.name = 'outline.depthId';
    const t1 = this.idTarget.textures[1]!;
    t1.format = THREE.RGBAFormat;
    t1.type = THREE.UnsignedByteType;
    t1.name = 'outline.normal';
    this.edgeTarget = mk(1);
    this.edgeTarget.texture.name = 'outline.edges';

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
    this.edgeMat = new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: FS_VERT,
      fragmentShader: EDGE_FRAG,
      uniforms: {
        tDepthId: { value: t0 },
        tNormal: { value: t1 },
        uDepthTol: { value: DEFAULT_OUTLINE.depthTol },
        uCreaseCos: { value: Math.cos((DEFAULT_OUTLINE.creaseDeg * Math.PI) / 180) },
        uMinNz: { value: 0.3 },
        uSoftTol: { value: SOFT_TOL },
      },
      depthTest: false,
      depthWrite: false,
    });
    this.compositeMat = new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: FS_VERT,
      fragmentShader: COMPOSITE_FRAG,
      uniforms: {
        tEdge: { value: this.edgeTarget.texture },
        uSS: { value: 1 },
        uInkW: { value: 1.25 },
        uSelW: { value: 3 },
        uInk: { value: new THREE.Vector3(...DEFAULT_OUTLINE.ink) },
        uSel: { value: new THREE.Vector3(...DEFAULT_OUTLINE.sel) },
        uSelOn: { value: 0 },
        uSoftFade: { value: 1 },
      },
      depthTest: false,
      depthWrite: false,
      transparent: true,
      blending: THREE.CustomBlending,
      blendEquation: THREE.AddEquation,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
      blendSrcAlpha: THREE.ZeroFactor,
      blendDstAlpha: THREE.OneFactor,
    });
    this.fsMesh = new THREE.Mesh(geo, this.edgeMat);
    this.fsMesh.frustumCulled = false;
    this.fsScene.add(this.fsMesh);
  }

  /** Size the targets for a drawing buffer of w×h device px at `ss` texels per pixel. */
  setSize(w: number, h: number, ss: number): void {
    this.ss = ss;
    const W = Math.max(1, Math.round(w * ss));
    const H = Math.max(1, Math.round(h * ss));
    if (this.idTarget.width !== W || this.idTarget.height !== H) {
      this.idTarget.setSize(W, H);
      this.edgeTarget.setSize(W, H);
    }
  }

  /**
   * Render the ID buffer of `scene` and detect edges. `worldPerTexel` is the world size of one
   * ID texel (used to scale the depth tolerance).
   */
  renderEdges(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera, p: OutlineParams, worldPerTexel: number): void {
    const prevTarget = renderer.getRenderTarget();
    const prevColor = renderer.getClearColor(new THREE.Color());
    const prevAlpha = renderer.getClearAlpha();
    renderer.setRenderTarget(this.idTarget);
    renderer.setClearColor(0x000000, 0);
    renderer.clear(true, true, false);
    renderer.render(scene, camera);
    const u = this.edgeMat.uniforms;
    u.uDepthTol!.value = p.depthTol + 1.5 * worldPerTexel;
    u.uCreaseCos!.value = Math.cos((p.creaseDeg * Math.PI) / 180);
    this.fsMesh.material = this.edgeMat;
    renderer.setRenderTarget(this.edgeTarget);
    renderer.render(this.fsScene, this.fsCamera);
    renderer.setRenderTarget(prevTarget);
    renderer.setClearColor(prevColor, prevAlpha);
  }

  /** Blend the lines over whatever is bound (normally the canvas). */
  composite(renderer: THREE.WebGLRenderer, p: OutlineParams, selectionOn: boolean): void {
    const u = this.compositeMat.uniforms;
    u.uSS!.value = this.ss;
    u.uInkW!.value = p.inkWidth;
    u.uSelW!.value = p.selWidth;
    (u.uInk!.value as THREE.Vector3).set(...p.ink);
    (u.uSel!.value as THREE.Vector3).set(...p.sel);
    u.uSelOn!.value = selectionOn ? 1 : 0;
    u.uSoftFade!.value = Math.min(1, Math.max(0, p.softFade ?? 1));
    this.fsMesh.material = this.compositeMat;
    renderer.render(this.fsScene, this.fsCamera);
  }

  dispose(): void {
    this.idTarget.dispose();
    this.edgeTarget.dispose();
    this.edgeMat.dispose();
    this.compositeMat.dispose();
    this.fsMesh.geometry.dispose();
  }
}
