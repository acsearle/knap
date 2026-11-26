// The view cube (DESIGN.md §6.2): a labelled cube in the top-right corner of the viewport that
// turns with the camera. Faces, edges (outer 20 % strips) and corners are hoverable/clickable;
// each region is one of the 26 named views (math.VIEW_DIRS). Rendered by the viewport's renderer
// into a scissored square after the main image, so it is as crisp as the scene at any DPR.
import * as THREE from 'three';
import { FatLines, SegmentBuilder, createLineUniforms, rgba } from './lines';
import { cameraBasis, viewName } from './math';
import type { Vec3, ViewDir } from './math';

/** Fraction of the half-face (from the centre) that belongs to the face region; beyond = edge/corner. */
export const CUBE_FACE_FRACTION = 0.6;
const FRUSTUM = 1.9;

interface FaceDef {
  label: string;
  n: Vec3;
  right: Vec3;
  up: Vec3;
}

const FACES: FaceDef[] = [
  { label: 'FRONT', n: [0, 0, 1], right: [1, 0, 0], up: [0, 1, 0] },
  { label: 'BACK', n: [0, 0, -1], right: [-1, 0, 0], up: [0, 1, 0] },
  { label: 'RIGHT', n: [1, 0, 0], right: [0, 0, -1], up: [0, 1, 0] },
  { label: 'LEFT', n: [-1, 0, 0], right: [0, 0, 1], up: [0, 1, 0] },
  { label: 'TOP', n: [0, 1, 0], right: [1, 0, 0], up: [0, 0, -1] },
  { label: 'BOTTOM', n: [0, -1, 0], right: [1, 0, 0], up: [0, 0, 1] },
];

const FACE_VERT = /* glsl */ `
varying vec2 vUv;
varying vec3 vN;
void main() {
  vUv = uv;
  vN = normalize(normalMatrix * normal);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const FACE_FRAG = /* glsl */ `
uniform sampler2D map;
varying vec2 vUv;
varying vec3 vN;
void main() {
  vec3 L = normalize(vec3(-0.42, 0.62, 0.66));
  float shade = 0.86 + 0.14 * max(dot(normalize(vN), L), 0.0);
  vec4 t = texture2D(map, vUv);
  gl_FragColor = vec4(t.rgb * shade, 1.0);
}`;

function labelTexture(label: string): THREE.CanvasTexture {
  const S = 256;
  const c = document.createElement('canvas');
  c.width = S;
  c.height = S;
  const g = c.getContext('2d')!;
  g.fillStyle = '#f4f5f6';
  g.fillRect(0, 0, S, S);
  g.fillStyle = '#30353b';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  let px = 64;
  const font = (p: number): string => `700 ${p}px system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif`;
  g.font = font(px);
  while (g.measureText(label).width > S * 0.86 && px > 20) g.font = font(--px);
  g.fillText(label, S / 2, S / 2 + px * 0.04);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.NoColorSpace;
  tex.anisotropy = 4;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  return tex;
}

/** Ray/box [-1,1]^3 intersection; returns the entry point or null. */
function hitCube(o: Vec3, d: Vec3): Vec3 | null {
  let t0 = -Infinity;
  let t1 = Infinity;
  for (let k = 0; k < 3; k++) {
    if (Math.abs(d[k]!) < 1e-12) {
      if (Math.abs(o[k]!) > 1) return null;
      continue;
    }
    const a = (-1 - o[k]!) / d[k]!;
    const b = (1 - o[k]!) / d[k]!;
    t0 = Math.max(t0, Math.min(a, b));
    t1 = Math.min(t1, Math.max(a, b));
  }
  if (t0 > t1 || t1 < 0) return null;
  return [o[0] + d[0] * t0, o[1] + d[1] * t0, o[2] + d[2] * t0];
}

/** Which of the 26 regions a point on the cube surface belongs to. */
export function cubeRegionAt(h: Vec3, faceFraction = CUBE_FACE_FRACTION): ViewDir {
  let k = 0;
  for (let j = 1; j < 3; j++) if (Math.abs(h[j]!) > Math.abs(h[k]!)) k = j;
  const dir: [number, number, number] = [0, 0, 0];
  for (let j = 0; j < 3; j++) {
    if (j === k) dir[j] = Math.sign(h[j]!) || 1;
    else if (Math.abs(h[j]!) > faceFraction) dir[j] = Math.sign(h[j]!);
  }
  return dir;
}

export interface ViewCubeLayout {
  /** Side of the square widget region in CSS px. */
  size: number;
  /** Distance from the viewport's top and right edges in CSS px. */
  margin: number;
}

export class ViewCube {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.OrthographicCamera(-FRUSTUM, FRUSTUM, FRUSTUM, -FRUSTUM, 0.1, 20);
  readonly layout: ViewCubeLayout = { size: 112, margin: 10 };
  private readonly faces: THREE.Mesh[] = [];
  private readonly edges: FatLines;
  private readonly hoverMesh: THREE.Mesh;
  private readonly hoverEdges: FatLines;
  private hoverDir: ViewDir | null = null;
  private yaw = 0;
  private pitch = 0;
  /** The cube draws into its own square, so its lines get their own resolution. */
  private readonly lineUniforms = createLineUniforms();

  constructor() {
    const lineUniforms = this.lineUniforms;
    for (const f of FACES) {
      const geo = new THREE.BufferGeometry();
      const P = (sr: number, su: number): number[] => [0, 1, 2].map((k) => f.n[k]! + sr * f.right[k]! + su * f.up[k]!);
      geo.setAttribute('position', new THREE.Float32BufferAttribute([...P(-1, -1), ...P(1, -1), ...P(1, 1), ...P(-1, 1)], 3));
      geo.setAttribute('normal', new THREE.Float32BufferAttribute([...f.n, ...f.n, ...f.n, ...f.n], 3));
      geo.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
      geo.setIndex([0, 1, 2, 0, 2, 3]);
      const mat = new THREE.ShaderMaterial({
        vertexShader: FACE_VERT,
        fragmentShader: FACE_FRAG,
        uniforms: { map: { value: labelTexture(f.label) } },
        polygonOffset: true,
        polygonOffsetFactor: 1,
        polygonOffsetUnits: 1,
      });
      const m = new THREE.Mesh(geo, mat);
      m.name = f.label;
      this.faces.push(m);
      this.scene.add(m);
    }
    this.edges = new FatLines(lineUniforms, { width: 1.25, depthTest: true, depthBias: 0.004 });
    const sb = new SegmentBuilder();
    const col = rgba('#596067');
    for (let k = 0; k < 3; k++)
      for (const s1 of [-1, 1])
        for (const s2 of [-1, 1]) {
          const a: number[] = [0, 0, 0];
          const b: number[] = [0, 0, 0];
          a[k] = -1;
          b[k] = 1;
          a[(k + 1) % 3] = b[(k + 1) % 3] = s1;
          a[(k + 2) % 3] = b[(k + 2) % 3] = s2;
          sb.seg(a, b, col);
        }
    sb.apply(this.edges);
    this.scene.add(this.edges);

    this.hoverMesh = new THREE.Mesh(
      new THREE.BufferGeometry(),
      new THREE.MeshBasicMaterial({ color: '#2f8cff', transparent: true, opacity: 0.38, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }),
    );
    this.hoverMesh.visible = false;
    this.scene.add(this.hoverMesh);
    this.hoverEdges = new FatLines(lineUniforms, { width: 1.5, depthTest: true, depthBias: 0.006 });
    this.scene.add(this.hoverEdges);
  }

  /** Follow the main camera orientation. */
  setOrientation(yaw: number, pitch: number): void {
    this.yaw = yaw;
    this.pitch = pitch;
    const { right, up, back } = cameraBasis(yaw, pitch);
    const m = new THREE.Matrix4().makeBasis(new THREE.Vector3(...right), new THREE.Vector3(...up), new THREE.Vector3(...back));
    this.camera.quaternion.setFromRotationMatrix(m);
    this.camera.position.set(back[0] * 6, back[1] * 6, back[2] * 6);
    this.camera.updateMatrixWorld(true);
  }

  /** Region rectangle in CSS px relative to the viewport's top-left. */
  rect(viewportWidth: number): { x: number; y: number; size: number } {
    const { size, margin } = this.layout;
    return { x: viewportWidth - margin - size, y: margin, size };
  }

  /** The view region under a point (CSS px relative to the viewport), or null. */
  pick(x: number, y: number, viewportWidth: number): ViewDir | null {
    const r = this.rect(viewportWidth);
    const u = (x - r.x) / r.size;
    const v = (y - r.y) / r.size;
    if (u < 0 || u > 1 || v < 0 || v > 1) return null;
    const nx = (u * 2 - 1) * FRUSTUM;
    const ny = (1 - v * 2) * FRUSTUM;
    const { right, up, back } = cameraBasis(this.yaw, this.pitch);
    const o: Vec3 = [0, 1, 2].map((k) => right[k]! * nx + up[k]! * ny + back[k]! * 6) as Vec3;
    const d: Vec3 = [-back[0], -back[1], -back[2]];
    const h = hitCube(o, d);
    return h ? cubeRegionAt(h) : null;
  }

  /** True if the point is inside the widget square (even if it misses the cube). */
  contains(x: number, y: number, viewportWidth: number): boolean {
    const r = this.rect(viewportWidth);
    return x >= r.x && x <= r.x + r.size && y >= r.y && y <= r.y + r.size;
  }

  /**
   * A visible point (CSS px relative to the viewport) inside the region for `dir`, or null if the
   * region is not visible from the current orientation. Used by tests to click regions.
   */
  regionPoint(dir: ViewDir, viewportWidth: number): [number, number] | null {
    const { right, up, back } = cameraBasis(this.yaw, this.pitch);
    const r = this.rect(viewportWidth);
    let best: [number, number] | null = null;
    let bestFacing = 0.05;
    for (let k = 0; k < 3; k++) {
      if (dir[k] === 0) continue;
      const p: number[] = [0, 0, 0];
      for (let j = 0; j < 3; j++) p[j] = j === k ? dir[j]! : dir[j]! * (1 + CUBE_FACE_FRACTION) / 2;
      const facing = dir[k]! * back[k]!;
      if (facing <= bestFacing) continue;
      const sx = (p[0]! * right[0] + p[1]! * right[1] + p[2]! * right[2]) / FRUSTUM;
      const sy = (p[0]! * up[0] + p[1]! * up[1] + p[2]! * up[2]) / FRUSTUM;
      const pt: [number, number] = [r.x + ((sx + 1) / 2) * r.size, r.y + ((1 - sy) / 2) * r.size];
      // must actually pick back to this region (not hidden behind another face)
      const got = this.pick(pt[0], pt[1], viewportWidth);
      if (got && viewName(got) === viewName(dir)) {
        best = pt;
        bestFacing = facing;
      }
    }
    return best;
  }

  /** Set the hovered region; returns true if it changed. */
  setHover(dir: ViewDir | null): boolean {
    const same = (dir === null && this.hoverDir === null) || (dir && this.hoverDir && viewName(dir) === viewName(this.hoverDir));
    if (same) return false;
    this.hoverDir = dir;
    if (!dir) {
      this.hoverMesh.visible = false;
      this.hoverEdges.visible = false;
      return true;
    }
    const pos: number[] = [];
    const idx: number[] = [];
    const sb = new SegmentBuilder();
    const col = rgba('#1f6fd6');
    const f = CUBE_FACE_FRACTION;
    for (let k = 0; k < 3; k++) {
      if (dir[k] === 0) continue;
      const a = (k + 1) % 3;
      const b = (k + 2) % 3;
      const range = (s: number): [number, number] => (s === 0 ? [-f, f] : s > 0 ? [f, 1] : [-1, -f]);
      const [a0, a1] = range(dir[a]!);
      const [b0, b1] = range(dir[b]!);
      const base = pos.length / 3;
      const corners: number[][] = [];
      for (const [ua, ub] of [[a0, b0], [a1, b0], [a1, b1], [a0, b1]] as const) {
        const p: number[] = [0, 0, 0];
        p[k] = dir[k]!;
        p[a] = ua;
        p[b] = ub;
        pos.push(p[0]!, p[1]!, p[2]!);
        corners.push(p);
      }
      idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
      sb.polyline(corners, col, true);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    // both windings so every quad is front-facing from outside
    const both = [...idx];
    for (let i = 0; i < idx.length; i += 3) both.push(idx[i]!, idx[i + 2]!, idx[i + 1]!);
    geo.setIndex(both);
    this.hoverMesh.geometry.dispose();
    this.hoverMesh.geometry = geo;
    this.hoverMesh.visible = true;
    sb.apply(this.hoverEdges);
    return true;
  }

  get hovered(): ViewDir | null {
    return this.hoverDir;
  }

  /** Draw into the top-right square of the current canvas. Leaves viewport/scissor reset. */
  render(renderer: THREE.WebGLRenderer, viewportWidth: number, viewportHeight: number, pixelRatio: number): void {
    const r = this.rect(viewportWidth);
    this.lineUniforms.uResolution.value.set(r.size * pixelRatio, r.size * pixelRatio);
    this.edges.width = 1.25 * pixelRatio;
    this.hoverEdges.width = 1.6 * pixelRatio;
    const yGl = viewportHeight - r.y - r.size;
    renderer.setScissorTest(true);
    renderer.setScissor(r.x, yGl, r.size, r.size);
    renderer.setViewport(r.x, yGl, r.size, r.size);
    renderer.clearDepth();
    renderer.render(this.scene, this.camera);
    renderer.setScissorTest(false);
    renderer.setViewport(0, 0, viewportWidth, viewportHeight);
  }

  dispose(): void {
    for (const f of this.faces) {
      f.geometry.dispose();
      const m = f.material as THREE.ShaderMaterial;
      (m.uniforms.map!.value as THREE.Texture).dispose();
      m.dispose();
    }
    this.edges.dispose();
    this.hoverEdges.dispose();
    this.hoverMesh.geometry.dispose();
    (this.hoverMesh.material as THREE.Material).dispose();
  }
}
