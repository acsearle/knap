// "Show colliders" (DESIGN §7.4): draws what the simulation collides with instead of what the parts
// look like. The list of colliders comes from physics/shapes colliderSpecs — the function the
// Simulation's colliders are checked against (tests/physics/colliderspecs.test.ts) — and nothing
// else, so the picture cannot drift from the physics.
//
//  - Geometry (pure, unit-tested in tests/view/colliders.test.ts): per collider its faces and its
//    true polyhedron edges — a convex hull's faces from three's ConvexHull with coplanar triangles
//    merged (no triangulation diagonals), a box's 12 edges, a native cylinder as a smooth cylinder
//    with its two rim circles. Built once per part signature + ground flag (the ground adds a
//    wheel's guard) and cached; part-local coordinates (world = local + partOrigin), like the
//    part meshes, so a part's colliders take the part's own matrix.
//  - Look: flat translucent fills (headlight-shaded so faces read, no shadows of their own) in a
//    light tint of the role colour, then every edge in the role colour; edges behind any collider
//    are drawn too, fainter (a wheel's round cylinder and guard sit inside its hull). Roles differ
//    in hue and in lightness (L* ≈ 25 / 42 / 54 / 70), so they stay apart for colour-blind viewers.
//  - ColliderLayer: the three.js objects of every part (a depth pre-pass, the fill, the visible and
//    the hidden edges), sharing GPU geometry per cache key; the viewport sets their matrices and
//    visibility with the part's.
import * as THREE from 'three';
import { ConvexHull } from 'three/examples/jsm/math/ConvexHull.js';
import { groundLevel } from '../core/model';
import type { Model, Part } from '../core/types';
import { partOrigin, partSignature } from '../geometry';
import { DEFAULT_CYLINDER_SEGMENTS, colliderSpecs } from '../physics/shapes';
import type { ColliderRole, ColliderSpec } from '../physics/shapes';
import { createLineMaterial, createSegmentGeometry, rgba } from './lines';
import type { LineUniforms } from './lines';
import { LIGHT } from './materials';

type V3 = [number, number, number];

/** The roles in legend order. */
export const COLLIDER_ROLES: readonly ColliderRole[] = ['part', 'hull', 'round', 'guard'];

/**
 * Colours per role: `line` for the edges (CIE L* 42 part, 65 hull, 25 round, 54 guard), `fill` a
 * light tint (L* 76, 87, 51, 65): apart in lightness as well as hue, so they read for colour-blind
 * viewers too (tests/view/colliders.test.ts checks ≥ 10 between any two). The legend's words, which
 * depend on what the model holds, are in ui/colliderlegend.ts.
 */
export const COLLIDER_STYLE: Readonly<Record<ColliderRole, { line: string; fill: string }>> = {
  part: { line: '#2166ac', fill: '#9ec0e3' },
  hull: { line: '#e08a00', fill: '#f9d796' },
  round: { line: '#6b1d4f', fill: '#a8648f' },
  guard: { line: '#179463', fill: '#4fb084' },
};

/** Fill opacity of the nearest collider surface; strength of the edges hidden behind colliders. */
export const COLLIDER_FILL_OPACITY = 0.42;
export const COLLIDER_HIDDEN_OPACITY = 0.3;
/**
 * Part solids while the view is on: a faint flat ghost (no outlines, no shading), neutral grey so
 * that every role's fill reads the same over every part colour (Show kinematics tints it by body).
 */
export const COLLIDER_GHOST_OPACITY = 0.3;
export const COLLIDER_GHOST_COLOR = '#8f959c';
/** Edge widths, CSS px. */
export const COLLIDER_LINE_PX = 1.1;
export const COLLIDER_HIDDEN_LINE_PX = 1;

/**
 * Two face normals closer than this (1 − cos) are one plane. Measured on the prisms, the stadium
 * runs and the wheel guards: coplanar triangles give exactly 0 (≤ 1e-14), the flattest real edge
 * (a 7-hole run's bevel facets) 3.7e-4 — so the 0.01 bevels stay edges.
 */
const COPLANAR = 1e-9;

export interface ColliderEdges {
  /** Faces as triangles (9 floats each) with one flat normal per triangle (3 floats). */
  triangles: number[];
  normals: number[];
  /** Edges, 6 floats each. */
  edges: number[];
  /** Planar faces (coplanar triangles merged) and distinct vertices, for hulls (tests: Euler). */
  faces?: number;
  vertices?: number;
}

/**
 * Faces and true edges of the convex hull of `points` (an edge is kept only between two faces of
 * different planes, so a flat face split into triangles shows no diagonals).
 */
export function hullGeometry(points: readonly (readonly number[])[]): ColliderEdges {
  const hull = new ConvexHull().setFromPoints(points.map((p) => new THREE.Vector3(p[0], p[1], p[2])));
  // Planar faces: triangles joined across coplanar edges (union-find), for the face count.
  const idx = new Map(hull.faces.map((f, i) => [f, i]));
  const parent = hull.faces.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i]!)));
  const verts = new Set<THREE.Vector3>();
  const triangles: number[] = [];
  const normals: number[] = [];
  const edges: number[] = [];
  for (const f of hull.faces) {
    let e = f.edge;
    const pts: THREE.Vector3[] = [];
    do {
      pts.push(e.head().point);
      const tw = e.twin;
      // Each edge once (the half-edge whose tail sorts first; its twin runs the other way), and
      // only between two different planes.
      verts.add(e.head().point);
      if (tw && 1 - f.normal.dot(tw.face.normal) > COPLANAR) {
        const a = e.tail().point;
        const b = e.head().point;
        if (a.x < b.x || (a.x === b.x && (a.y < b.y || (a.y === b.y && a.z < b.z)))) edges.push(a.x, a.y, a.z, b.x, b.y, b.z);
      } else if (tw) parent[find(idx.get(f)!)] = find(idx.get(tw.face)!);
      e = e.next;
    } while (e !== f.edge);
    // Fan (three's faces are triangles; kept general).
    for (let i = 1; i + 1 < pts.length; i++) {
      triangles.push(pts[0]!.x, pts[0]!.y, pts[0]!.z, pts[i]!.x, pts[i]!.y, pts[i]!.z, pts[i + 1]!.x, pts[i + 1]!.y, pts[i + 1]!.z);
      normals.push(f.normal.x, f.normal.y, f.normal.z);
    }
  }
  const faces = new Set(hull.faces.map((_, i) => find(i))).size;
  return { triangles, normals, edges, faces, vertices: verts.size };
}

/** An axis-aligned box: 12 triangles, 12 edges. */
export function boxGeometry(center: readonly number[], half: readonly number[]): ColliderEdges {
  const pts: V3[] = [];
  for (let i = 0; i < 8; i++) pts.push([center[0]! + (i & 1 ? 1 : -1) * half[0]!, center[1]! + (i & 2 ? 1 : -1) * half[1]!, center[2]! + (i & 4 ? 1 : -1) * half[2]!]);
  return hullGeometry(pts);
}

/** Sides of a drawn native cylinder (smooth shading; the rim circles use the same count). */
export function cylinderSides(radius: number): number {
  return Math.max(48, Math.min(192, Math.ceil(radius * 32)));
}

/**
 * A native cylinder: smooth side (per-vertex normals: the `normals` array then holds 3 per vertex,
 * see `smooth`), flat caps, and its two rim circles as edges.
 */
export function cylinderGeometry(center: readonly number[], axis: 0 | 1 | 2, radius: number, halfLength: number): ColliderEdges & { vertexNormals: number[] } {
  const n = cylinderSides(radius);
  const u = ((axis + 1) % 3) as 0 | 1 | 2;
  const v = ((axis + 2) % 3) as 0 | 1 | 2;
  const at = (ang: number, s: number, r = radius): V3 => {
    const p: V3 = [center[0]!, center[1]!, center[2]!];
    p[u] += r * Math.cos(ang);
    p[v] += r * Math.sin(ang);
    p[axis] += s * halfLength;
    return p;
  };
  const dirOf = (ang: number): V3 => {
    const d: V3 = [0, 0, 0];
    d[u] = Math.cos(ang);
    d[v] = Math.sin(ang);
    return d;
  };
  const triangles: number[] = [];
  const vertexNormals: number[] = [];
  const normals: number[] = [];
  const edges: number[] = [];
  const cap = (s: number): V3 => {
    const d: V3 = [0, 0, 0];
    d[axis] = s;
    return d;
  };
  const tri = (a: V3, b: V3, c: V3, na: V3, nb: V3, nc: V3) => {
    triangles.push(...a, ...b, ...c);
    vertexNormals.push(...na, ...nb, ...nc);
    const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const nx = e1[1]! * e2[2]! - e1[2]! * e2[1]!;
    const ny = e1[2]! * e2[0]! - e1[0]! * e2[2]!;
    const nz = e1[0]! * e2[1]! - e1[1]! * e2[0]!;
    const l = Math.hypot(nx, ny, nz) || 1;
    normals.push(nx / l, ny / l, nz / l);
  };
  // Winding: CCW seen from outside, with (u, v, axis) right-handed.
  for (let i = 0; i < n; i++) {
    const a0 = (i / n) * 2 * Math.PI;
    const a1 = ((i + 1) / n) * 2 * Math.PI;
    const d0 = dirOf(a0);
    const d1 = dirOf(a1);
    tri(at(a0, -1), at(a1, -1), at(a1, 1), d0, d1, d1);
    tri(at(a0, -1), at(a1, 1), at(a0, 1), d0, d1, d0);
    const c1 = at(0, 1, 0);
    const c0 = at(0, -1, 0);
    tri(c1, at(a0, 1), at(a1, 1), cap(1), cap(1), cap(1));
    tri(c0, at(a1, -1), at(a0, -1), cap(-1), cap(-1), cap(-1));
    for (const s of [-1, 1]) edges.push(...at(a0, s), ...at(a1, s));
  }
  return { triangles, normals, edges, vertexNormals };
}

/** Everything drawn for one part: fill triangles (with per-vertex role colour), edges per role, counts. */
export interface ColliderMeshData {
  /** Part-local positions / normals / fill colours (linear-agnostic display RGB), 3 floats per vertex. */
  positions: Float32Array;
  normals: Float32Array;
  colors: Float32Array;
  /** Edges (6 floats each) and their display RGBA (4 floats each); duplicates within a role removed. */
  ends: Float32Array;
  edgeColors: Float32Array;
  counts: Record<ColliderRole, number>;
  /** Of those, the colliders of gears (their round and hull use the gear collision groups: a gear's disc never meets another gear's). */
  gear: { round: number; hull: number };
  /** Number of colliders. */
  colliders: number;
  /** Fill vertex ranges per role (vertices are sorted by role in COLLIDER_ROLES order). */
  groups: { role: ColliderRole; start: number; count: number }[];
}

/** Fill / edge data of a list of collider specs, translated by −origin (part-local). */
export function colliderMeshData(specs: readonly ColliderSpec[], origin: readonly number[] = [0, 0, 0]): ColliderMeshData {
  const per = new Map<ColliderRole, { pos: number[]; nrm: number[]; col: number[] }>(COLLIDER_ROLES.map((r) => [r, { pos: [], nrm: [], col: [] }]));
  const ends: number[] = [];
  const ecol: number[] = [];
  const counts: Record<ColliderRole, number> = { part: 0, round: 0, hull: 0, guard: 0 };
  const gear = { round: 0, hull: 0 };
  const seen = new Set<string>();
  const key = (x: number) => Math.round(x * 1e6);
  const [ox, oy, oz] = [origin[0]!, origin[1]!, origin[2]!];
  // Edges are drawn in this order (later on top): the many hull edges first, so a wheel's round
  // cylinder and guard, which sit just inside its hull, stay readable over them.
  const EDGE_ORDER: Record<ColliderRole, number> = { hull: 0, part: 1, round: 2, guard: 3 };
  const ordered = [...specs].sort((x, y) => EDGE_ORDER[x.role] - EDGE_ORDER[y.role]);
  for (const s of ordered) {
    counts[s.role]++;
    if (s.gear && (s.role === 'round' || s.role === 'hull')) gear[s.role]++;
    const st = COLLIDER_STYLE[s.role];
    const fc = rgba(st.fill);
    const lc = rgba(st.line);
    const sh = s.shape;
    let g: ColliderEdges & { vertexNormals?: number[] };
    if (sh.type === 'hull') g = hullGeometry(sh.points);
    else if (sh.type === 'box') g = boxGeometry(sh.center, sh.halfExtents);
    else g = cylinderGeometry(sh.center, sh.axis, sh.radius, sh.halfLength);
    const { pos, nrm, col } = per.get(s.role)!;
    for (let i = 0; i < g.triangles.length; i += 3) {
      pos.push(g.triangles[i]! - ox, g.triangles[i + 1]! - oy, g.triangles[i + 2]! - oz);
      col.push(fc[0], fc[1], fc[2]);
    }
    if (g.vertexNormals) for (const x of g.vertexNormals) nrm.push(x);
    else for (let t = 0; t < g.normals.length; t += 3) for (let k = 0; k < 3; k++) nrm.push(g.normals[t]!, g.normals[t + 1]!, g.normals[t + 2]!);
    for (let i = 0; i < g.edges.length; i += 6) {
      const a = [g.edges[i]! - ox, g.edges[i + 1]! - oy, g.edges[i + 2]! - oz];
      const b = [g.edges[i + 3]! - ox, g.edges[i + 4]! - oy, g.edges[i + 5]! - oz];
      const ka = `${key(a[0]!)},${key(a[1]!)},${key(a[2]!)}`;
      const kb = `${key(b[0]!)},${key(b[1]!)},${key(b[2]!)}`;
      const k = `${s.role}|${ka < kb ? ka + '|' + kb : kb + '|' + ka}`;
      if (seen.has(k)) continue; // wedges of a wheel share their radial edges
      seen.add(k);
      ends.push(...a, ...b);
      ecol.push(lc[0], lc[1], lc[2], 1);
    }
  }
  const pos: number[] = [];
  const nrm: number[] = [];
  const col: number[] = [];
  const groups: ColliderMeshData['groups'] = [];
  for (const r of COLLIDER_ROLES) {
    const g = per.get(r)!;
    if (g.pos.length) groups.push({ role: r, start: pos.length / 3, count: g.pos.length / 3 });
    for (const x of g.pos) pos.push(x);
    for (const x of g.nrm) nrm.push(x);
    for (const x of g.col) col.push(x);
  }
  return {
    groups,
    positions: new Float32Array(pos),
    normals: new Float32Array(nrm),
    colors: new Float32Array(col),
    ends: new Float32Array(ends),
    edgeColors: new Float32Array(ecol),
    counts,
    gear,
    colliders: specs.length,
  };
}

/** Does the model have a ground (then every wheel and gear has a guard; sim.ts tests the same)? */
export function modelHasGround(model: Model): boolean {
  return groundLevel(model) !== null;
}

/** Cache key of a part's collider drawing: its signature and the ground flag. */
export function colliderKey(part: Part, ground: boolean): string {
  return `${partSignature(part)}|${ground ? 'g' : '-'}`;
}

const dataCache = new Map<string, ColliderMeshData>();
const DATA_CACHE_LIMIT = 512;
let dataBuilds = 0;

/**
 * The drawing data of a part's colliders (part-local), built once per colliderKey and cached (LRU,
 * 512 entries). colliderSpecs is translation-equivariant, so identical parts anywhere share it.
 */
export function partColliderData(part: Part, ground: boolean): ColliderMeshData {
  const k = colliderKey(part, ground);
  let d = dataCache.get(k);
  if (d) {
    dataCache.delete(k);
    dataCache.set(k, d);
    return d;
  }
  dataBuilds++;
  d = colliderMeshData(colliderSpecs(part, DEFAULT_CYLINDER_SEGMENTS, ground), partOrigin(part));
  dataCache.set(k, d);
  if (dataCache.size > DATA_CACHE_LIMIT) dataCache.delete(dataCache.keys().next().value!);
  return d;
}

/** Diagnostics / tests: data builds so far and the cache size. */
export function colliderDataStats(): { builds: number; cached: number } {
  return { builds: dataBuilds, cached: dataCache.size };
}

// ------------------------------------------------------------------------------------------
// three.js objects

const FILL_VERT = /* glsl */ `
attribute vec3 color;
varying vec3 vNormal;
varying vec3 vColor;
void main() {
  vNormal = normalize(normalMatrix * normal);
  vColor = color;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

// Headlight-shaded flat fill (the part material's light, softened): faces read as faces.
const FILL_FRAG = /* glsl */ `
uniform vec3 uKey;
uniform float uOpacity;
varying vec3 vNormal;
varying vec3 vColor;
void main() {
  vec3 n = normalize(vNormal);
  if (!gl_FrontFacing) n = -n;
  float diff = max(dot(n, uKey), 0.0);
  vec3 c = vColor * (0.78 + 0.3 * diff);
  gl_FragColor = vec4(c, uOpacity);
}`;

interface GpuEntry {
  data: ColliderMeshData;
  fill: THREE.BufferGeometry;
  lines: THREE.InstancedBufferGeometry;
  refs: number;
}

/** One part's collider objects. */
interface PartColliders {
  key: string;
  entry: GpuEntry;
  prepass: THREE.Mesh;
  /** One fill mesh per role present (each draws only its role's group). */
  fills: THREE.Mesh[];
  lines: THREE.Mesh;
  hidden: THREE.Mesh;
}

/**
 * The collider objects of every part (DESIGN §7.4). `fillScene` gets a depth pre-pass and the
 * fills per part (transparent queue, render orders COLLIDER_ORDER, after the ghosted part solids),
 * `lineScene` the visible and hidden edges. GPU geometry is shared per colliderKey.
 *
 * Fill: only the nearest collider surface, blended once per pixel. The pre-pass writes the nearest
 * depth; each fill is pulled toward the viewer by a small polygon offset so every face at that
 * depth passes (coplanar faces of two colliders: a beam's box and prism, two wedges, a wheel's hub
 * prism, hull and round cylinder, which share their end planes), and the stencil lets only the
 * first one blend (else they z-fight into stripes). Fills are drawn role by role — part, hull,
 * round, guard — so that one wins where two roles' faces coincide. The viewport clears the stencil
 * every frame.
 */
export class ColliderLayer {
  private readonly gpu = new Map<string, GpuEntry>();
  private readonly parts = new Map<number, PartColliders>();
  private readonly prepassMat: THREE.ShaderMaterial;
  /** Per role (COLLIDER_ROLES order): a material array drawing that role's group only. */
  private readonly fillMats: THREE.Material[][];
  private readonly fillMat: THREE.ShaderMaterial;
  private readonly skipMat: THREE.Material;
  readonly lineMat: THREE.ShaderMaterial;
  readonly hiddenMat: THREE.ShaderMaterial;

  constructor(
    private readonly fillScene: THREE.Scene,
    private readonly lineScene: THREE.Scene,
    lineUniforms: LineUniforms,
  ) {
    // Depth only, in the transparent queue so it runs after the (depth-less) part ghosts. The same
    // vertex shader as the fill, so the fill's depth matches it (another shader's rounding left the
    // fill failing its depth test in a checkerboard).
    this.prepassMat = new THREE.ShaderMaterial({
      vertexShader: FILL_VERT,
      fragmentShader: FILL_FRAG,
      uniforms: { uKey: { value: LIGHT.key }, uOpacity: { value: 1 } },
      colorWrite: false,
      transparent: true,
      depthWrite: true,
      depthTest: true,
      side: THREE.FrontSide,
    });
    this.fillMat = new THREE.ShaderMaterial({
      vertexShader: FILL_VERT,
      fragmentShader: FILL_FRAG,
      uniforms: { uKey: { value: LIGHT.key }, uOpacity: { value: COLLIDER_FILL_OPACITY } },
      transparent: true,
      depthWrite: false,
      depthTest: true,
      depthFunc: THREE.LessEqualDepth,
      side: THREE.FrontSide,
      stencilWrite: true,
      stencilRef: 1,
      stencilFuncMask: 1,
      stencilWriteMask: 1,
      stencilFunc: THREE.NotEqualStencilFunc,
      stencilZPass: THREE.ReplaceStencilOp,
      stencilFail: THREE.KeepStencilOp,
      stencilZFail: THREE.KeepStencilOp,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -64,
    });
    this.skipMat = new THREE.MeshBasicMaterial({ visible: false });
    this.fillMats = COLLIDER_ROLES.map((_, k) => COLLIDER_ROLES.map((__, j) => (j === k ? this.fillMat : this.skipMat)));
    this.lineMat = createLineMaterial(lineUniforms, { depthTest: true });
    this.hiddenMat = createLineMaterial(lineUniforms, { depthTest: true, opacity: COLLIDER_HIDDEN_OPACITY });
    this.hiddenMat.depthFunc = THREE.GreaterDepth;
  }

  /** Line widths (device px) and the depth bias (NDC) that keeps edges on a surface visible. */
  setLineParams(width: number, hiddenWidth: number, depthBias: number): void {
    this.lineMat.uniforms.uWidth!.value = width;
    this.hiddenMat.uniforms.uWidth!.value = hiddenWidth;
    this.lineMat.uniforms.uDepthBias!.value = depthBias;
    this.hiddenMat.uniforms.uDepthBias!.value = depthBias;
  }

  private acquire(part: Part, key: string, ground: boolean): GpuEntry {
    let e = this.gpu.get(key);
    if (!e) {
      const data = partColliderData(part, ground);
      const fill = new THREE.BufferGeometry();
      fill.setAttribute('position', new THREE.BufferAttribute(data.positions, 3));
      fill.setAttribute('normal', new THREE.BufferAttribute(data.normals, 3));
      fill.setAttribute('color', new THREE.BufferAttribute(data.colors, 3));
      for (const g of data.groups) fill.addGroup(g.start, g.count, COLLIDER_ROLES.indexOf(g.role));
      fill.computeBoundingSphere();
      e = { data, fill, lines: createSegmentGeometry(data.ends, data.edgeColors), refs: 0 };
      this.gpu.set(key, e);
    }
    e.refs++;
    return e;
  }

  private release(key: string): void {
    const e = this.gpu.get(key);
    if (!e) return;
    if (--e.refs > 0) return;
    e.fill.dispose();
    e.lines.dispose();
    this.gpu.delete(key);
  }

  /** Make the layer show exactly `parts` (diffed by id and key); returns nothing. */
  sync(parts: readonly Part[], ground: boolean): void {
    const seen = new Set<number>();
    for (const p of parts) {
      seen.add(p.id);
      const key = colliderKey(p, ground);
      const cur = this.parts.get(p.id);
      if (cur && cur.key === key) continue;
      if (cur) this.remove(p.id);
      const entry = this.acquire(p, key, ground);
      const prepass = new THREE.Mesh(entry.fill, this.prepassMat);
      const fills = entry.data.groups.map((g) => {
        const k = COLLIDER_ROLES.indexOf(g.role);
        const m = new THREE.Mesh(entry.fill, this.fillMats[k]!);
        m.renderOrder = COLLIDER_ORDER.fill + 0.01 * k;
        return m;
      });
      const lines = new THREE.Mesh(entry.lines, this.lineMat);
      const hidden = new THREE.Mesh(entry.lines, this.hiddenMat);
      prepass.renderOrder = COLLIDER_ORDER.prepass;
      hidden.renderOrder = COLLIDER_ORDER.hidden;
      lines.renderOrder = COLLIDER_ORDER.lines;
      for (const m of [prepass, ...fills, lines, hidden]) {
        m.matrixAutoUpdate = false;
        m.frustumCulled = m !== lines && m !== hidden;
        m.userData.partId = p.id;
      }
      this.fillScene.add(prepass, ...fills);
      this.lineScene.add(hidden, lines);
      this.parts.set(p.id, { key, entry, prepass, fills, lines, hidden });
    }
    for (const id of [...this.parts.keys()]) if (!seen.has(id)) this.remove(id);
  }

  private remove(id: number): void {
    const pc = this.parts.get(id);
    if (!pc) return;
    this.fillScene.remove(pc.prepass, ...pc.fills);
    this.lineScene.remove(pc.hidden, pc.lines);
    this.release(pc.key);
    this.parts.delete(id);
  }

  /** A part's pose (the same matrix as its solid) and visibility. */
  setPart(id: number, matrix: THREE.Matrix4, visible: boolean): void {
    const pc = this.parts.get(id);
    if (!pc) return;
    for (const m of [pc.prepass, ...pc.fills, pc.lines, pc.hidden]) {
      m.matrix.copy(matrix);
      m.matrixWorldNeedsUpdate = true;
      m.visible = visible;
    }
  }

  /** Test hook: a part's collider counts, its drawn matrix (column-major) and visibility; null if unknown. */
  partInfo(id: number): { counts: Record<ColliderRole, number>; gear: { round: number; hull: number }; matrix: number[]; visible: boolean } | null {
    const pc = this.parts.get(id);
    if (!pc) return null;
    return { counts: { ...pc.entry.data.counts }, gear: { ...pc.entry.data.gear }, matrix: [...pc.prepass.matrix.elements], visible: pc.prepass.visible };
  }

  /** Distinct GPU geometries held (diagnostics). */
  get geometries(): number {
    return this.gpu.size;
  }

  clear(): void {
    for (const id of [...this.parts.keys()]) this.remove(id);
  }

  dispose(): void {
    this.clear();
    for (const m of [this.prepassMat, this.fillMat, this.skipMat]) m.dispose();
    this.lineMat.dispose();
    this.hiddenMat.dispose();
  }
}

/**
 * Render orders in the colour scene's transparent queue: ghosted part solids, depth pre-pass, fills
 * (+ 0.01 × role index), hidden edges, edges — all before the outline composite, so the selection
 * outline and every overlay are drawn over the colliders.
 */
export const COLLIDER_ORDER = { ghost: 1, prepass: 2, fill: 3, hidden: 4, lines: 5 } as const;
