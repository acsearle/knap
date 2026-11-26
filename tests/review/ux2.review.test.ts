// Reviewer "ux2": Back side (DESIGN §7.3) against an independent ray-marching reference, and
// resolveBuild on the picks. None of these tests fail on purpose.
//
// The reference (refBackSym below) is e2e/review-ux2-ref.mjs's refBack ported here and updated to
// the rule as DESIGN §7.3 now states it — a male and the hole it stands in are one solid BOTH ways:
// besides a male part being extended by its host's solid, a hole part is extended by the cubes of
// the rod passing through its hole (the male cell in the hole and the same part's male cells
// contiguous with it along its axis), so an exit from the hole part still inside the rod is no
// crossing. It shares no code with src/editor/picking.ts (point-membership ray marching only); the
// e2e module keeps the old rule for the e2e scripts that import it, and only its transformModel
// is used here.
import { describe, expect, it } from 'vitest';
import { emptyModel, makeCell } from '../../src/core';
import type { Cell, Model } from '../../src/core';
import { EXAMPLES, buildExample } from '../../src/core/examples';
import { buildPick, initialToolState, pickBack, pickCell, resolveBuild, selectTool, setBackSide } from '../../src/editor';
import type { Ray } from '../../src/editor';
// @ts-expect-error plain JS module shared with the e2e scripts
import { refBack as refBackOld, transformModel } from '../../e2e/review-ux2-ref.mjs';

type V3 = [number, number, number];

function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** Raw model (no validation: the pick must not depend on it; the shapes are valid anyway). */
function raw(...parts: Cell[][]): Model {
  const m = emptyModel();
  return { ...m, parts: parts.map((cells, i) => ({ id: i + 1, color: '#888888', cells })), nextPartId: parts.length + 1 };
}
const H = (x: number, y: number, z: number, axis: 0 | 1 | 2 = 2, rim?: number) => makeCell(x, y, z, 'pinHole', axis, rim);
const AH = (x: number, y: number, z: number, axis: 0 | 1 | 2 = 2) => makeCell(x, y, z, 'axleHole', axis);
const P = (x: number, y: number, z: number, axis: 0 | 1 | 2 = 2) => makeCell(x, y, z, 'pin', axis);
const A = (x: number, y: number, z: number, axis: 0 | 1 | 2 = 2) => makeCell(x, y, z, 'axle', axis);
const beamX = (n: number, y = 0, z = 0, x0 = 0) => Array.from({ length: n }, (_, i) => H(x0 + i, y, z));

const TEMPLATES: Record<string, Model> = {
  hole: raw([H(0, 0, 0)]),
  pin: raw([P(0, 0, 0)]),
  axle: raw([A(0, 0, 0)]),
  axleHole: raw([AH(0, 0, 0)]),
  frictionPin: raw([makeCell(0, 0, 0, 'frictionPin', 2)]),
  beam7: raw(beamX(7)),
  L: raw([...beamX(5), H(4, 1, 0), H(4, 2, 0), H(4, 3, 0)]),
  U: raw([...beamX(5), H(0, 1, 0), H(0, 2, 0), H(4, 1, 0), H(4, 2, 0)]),
  stacked: raw(beamX(7, 0, 0), beamX(7, 0, 1)),
  crossing: raw(beamX(7, 0, 0), [H(3, -2, 1, 2), H(3, -1, 1), H(3, 0, 1), H(3, 1, 1), H(3, 2, 1)]),
  pinFlush: raw(beamX(5), [P(2, 0, 0)]),
  pinProudBehind: raw(beamX(5), [P(2, 0, 0), P(2, 0, -1)]),
  pinProudFront: raw(beamX(5), [P(2, 0, 0), P(2, 0, 1)]),
  pinBoth: raw(beamX(5), [P(2, 0, -1), P(2, 0, 0), P(2, 0, 1)]),
  pinTwoBeams: raw(beamX(5, 0, 0), beamX(5, 0, 1), [P(2, 0, 0), P(2, 0, 1)]),
  axleThree: raw(
    [H(0, 0, 0), H(1, 0, 0), AH(2, 0, 0), H(3, 0, 0)],
    [H(0, 0, 1), H(1, 0, 1), AH(2, 0, 1), H(3, 0, 1)],
    [H(0, 0, 2), H(1, 0, 2), AH(2, 0, 2), H(3, 0, 2)],
    [A(2, 0, -1), A(2, 0, 0), A(2, 0, 1), A(2, 0, 2), A(2, 0, 3)],
  ),
  wheel: raw([H(0, 0, 0, 2, 2.5)]),
  wheelCrank: raw([H(0, 0, 1, 2, 2.5), H(2, 2, 1, 2)]),
  wheelAxle: raw([AH(0, 0, 0, 2)].map((c) => ({ ...c, rim: 1.5 })), [A(0, 0, -1), A(0, 0, 0), A(0, 0, 1)]),
  wheelOnBeam: raw(beamX(5, 0, 0), [H(4, 0, 1, 2, 2), P(4, 0, 0)]),
};

const PERMS = [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]];

function modelBox(m: Model): { lo: V3; hi: V3 } {
  const lo: V3 = [Infinity, Infinity, Infinity];
  const hi: V3 = [-Infinity, -Infinity, -Infinity];
  for (const p of m.parts)
    for (const c of p.cells) {
      const r = c.rim ?? 0.5;
      const q = [c.x, c.y, c.z];
      for (let a = 0; a < 3; a++) {
        const e = a === c.axis ? 0.5 : Math.max(0.5, r);
        lo[a] = Math.min(lo[a]!, q[a]! - e);
        hi[a] = Math.max(hi[a]!, q[a]! + e);
      }
    }
  return { lo, hi };
}

function viewDirs(rnd: () => number): V3[] {
  const out: V3[] = [];
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) out.push([sx, sy, sz]);
  out.push([1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]);
  for (let i = 0; i < 6; i++) {
    const u = rnd() * 2 - 1;
    const ph = rnd() * 2 * Math.PI;
    const s = Math.sqrt(1 - u * u);
    out.push([s * Math.cos(ph), u, s * Math.sin(ph)]);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Reference: nearest back-face crossing by dense ray marching (rule: one solid both ways).

/* eslint-disable @typescript-eslint/no-explicit-any */
type RefHit = {
  status: 'hit' | 'none' | 'ambiguous';
  why?: string;
  partId?: number;
  cellIndex?: number;
  pos?: number[];
  dir?: number;
  t?: number;
  virtual?: number[];
  tread?: boolean;
  kind?: string;
  axis?: number;
  pe?: number[];
  tieKind?: string;
};
const REF_R_ROD = 0.295;
const REF_STEP = 0.005;
const REF_EDGE_EPS = 2e-4;
const REF_TIE_EPS = 1e-6;
const refIsHole = (k: string) => k.endsWith('Hole');
const refIsMale = (k: string) => k === 'pin' || k === 'axle' || k === 'frictionPin';
function refRim(c: Cell): number | undefined {
  const r = c.rim;
  return r !== undefined && refIsHole(c.kind) && r >= 1 && r <= 4 && Math.abs(r * 2 - Math.round(r * 2)) < 1e-9 ? r : undefined;
}
interface RefPart {
  part: { id: number; cells: Cell[] };
  keys: Map<string, number>;
  hubs: [Cell, number, number][];
  lo: number[];
  hi: number[];
  hosts: RefPart[];
  /** Rod cubes standing in this part's holes ("x,y,z" keys), with their bounding box. */
  rod: Set<string>;
  rodLo: number[];
  rodHi: number[];
}
function refPrep(model: Model): RefPart[] {
  const pps: RefPart[] = model.parts.map((p) => {
    const keys = new Map<string, number>();
    p.cells.forEach((c, i) => keys.set(`${c.x},${c.y},${c.z}`, i));
    const hubs = p.cells.map((c, i) => [c, i, refRim(c)] as [Cell, number, number | undefined]).filter((x): x is [Cell, number, number] => x[2] !== undefined);
    const lo = [Infinity, Infinity, Infinity];
    const hi = [-Infinity, -Infinity, -Infinity];
    for (const c of p.cells) {
      const r = refRim(c) ?? 0.5;
      const q = [c.x, c.y, c.z];
      for (let a = 0; a < 3; a++) {
        const e = a === c.axis ? 0.5 : r;
        lo[a] = Math.min(lo[a]!, q[a]! - e);
        hi[a] = Math.max(hi[a]!, q[a]! + e);
      }
    }
    return { part: p as any, keys, hubs, lo, hi, hosts: [], rod: new Set<string>(), rodLo: [Infinity, Infinity, Infinity], rodHi: [-Infinity, -Infinity, -Infinity] };
  });
  for (const pp of pps) {
    for (const c of pp.part.cells) {
      for (const q of pps) {
        if (q === pp) continue;
        const i = q.keys.get(`${c.x},${c.y},${c.z}`);
        if (i === undefined) continue;
        const other = q.part.cells[i]!;
        // pp's male in q's hole: q is pp's host
        if (refIsMale(c.kind) && refIsHole(other.kind) && !pp.hosts.includes(q)) pp.hosts.push(q);
        // q's male in pp's hole: the rod through it, both ways along the male's axis
        if (refIsHole(c.kind) && refIsMale(other.kind)) {
          const a = other.axis;
          for (const step of [1, -1]) {
            for (let k = step === 1 ? 0 : -1; ; k += step) {
              const pos = [other.x, other.y, other.z];
              pos[a] = pos[a]! + k;
              const j = q.keys.get(pos.join());
              if (j === undefined) break;
              const rc = q.part.cells[j]!;
              if (!refIsMale(rc.kind) || rc.axis !== a) break;
              pp.rod.add(pos.join());
              for (let b = 0; b < 3; b++) {
                pp.rodLo[b] = Math.min(pp.rodLo[b]!, pos[b]! - 0.5);
                pp.rodHi[b] = Math.max(pp.rodHi[b]!, pos[b]! + 0.5);
              }
            }
          }
        }
      }
    }
  }
  return pps;
}
function refCubeAt(pp: RefPart, p: number[]): number {
  const x = Math.round(p[0]!), y = Math.round(p[1]!), z = Math.round(p[2]!);
  if (Math.abs(p[0]! - x) >= 0.5 || Math.abs(p[1]! - y) >= 0.5 || Math.abs(p[2]! - z) >= 0.5) return -1;
  return pp.keys.get(`${x},${y},${z}`) ?? -1;
}
function refDiscAt(pp: RefPart, p: number[]): number {
  for (const [c, i, r] of pp.hubs) {
    const q = [c.x, c.y, c.z];
    const a = c.axis;
    if (Math.abs(p[a]! - q[a]!) >= 0.5) continue;
    let s = 0;
    for (let k = 0; k < 3; k++) if (k !== a) s += (p[k]! - q[k]!) ** 2;
    if (s < r * r) return i;
  }
  return -1;
}
const refInside = (pp: RefPart, p: number[]) => refCubeAt(pp, p) >= 0 || refDiscAt(pp, p) >= 0;
function refInRod(pp: RefPart, p: number[]): boolean {
  if (!pp.rod.size) return false;
  const x = Math.round(p[0]!), y = Math.round(p[1]!), z = Math.round(p[2]!);
  if (Math.abs(p[0]! - x) >= 0.5 || Math.abs(p[1]! - y) >= 0.5 || Math.abs(p[2]! - z) >= 0.5) return false;
  return pp.rod.has(`${x},${y},${z}`);
}
/** The part's solid extended by its hosts (it is a male in their holes) and by the rods in its holes. */
const refInsideM = (pp: RefPart, p: number[]) => refInside(pp, p) || pp.hosts.some((h) => refInside(h, p)) || refInRod(pp, p);
function refSlab(o: readonly number[], d: number[], lo: number[], hi: number[]): [number, number] | null {
  let tn = -Infinity;
  let tf = Infinity;
  for (let a = 0; a < 3; a++) {
    if (Math.abs(d[a]!) < 1e-15) {
      if (o[a]! < lo[a]! || o[a]! > hi[a]!) return null;
      continue;
    }
    let t1 = (lo[a]! - o[a]!) / d[a]!;
    let t2 = (hi[a]! - o[a]!) / d[a]!;
    if (t1 > t2) [t1, t2] = [t2, t1];
    tn = Math.max(tn, t1);
    tf = Math.min(tf, t2);
  }
  return tf > tn ? [tn, tf] : null;
}
function refBackSym(model: Model, ray: Ray): RefHit {
  const L = Math.hypot(...ray.dir);
  const d = ray.dir.map((v) => v / L);
  const o = ray.origin;
  const at = (t: number) => [o[0] + t * d[0]!, o[1] + t * d[1]!, o[2] + t * d[2]!];
  const grow = (v: number[], e: number) => v.map((x) => x + e);
  const parts = refPrep(model)
    .map((pp) => ({ pp, s: refSlab(o, d, grow(pp.lo, -0.01), grow(pp.hi, 0.01)) }))
    .filter((x): x is { pp: RefPart; s: [number, number] } => !!x.s && x.s[1] > 0);
  if (!parts.length) return { status: 'none' };
  let thin = false;
  const exits: { pp: RefPart; t: number }[] = [];
  for (const { pp, s } of parts) {
    let s2: [number, number] = s;
    const ext = (lo: number[], hi: number[]) => {
      if (!(lo[0]! <= hi[0]!)) return;
      const hs = refSlab(o, d, grow(lo, -0.01), grow(hi, 0.01));
      if (hs) s2 = [Math.min(s2[0], hs[0]), Math.max(s2[1], hs[1])];
    };
    for (const h of pp.hosts) ext(h.lo, h.hi);
    ext(pp.rodLo, pp.rodHi);
    const t0 = Math.max(0, s2[0]);
    let prev = refInsideM(pp, at(t0));
    let ownSeen = prev && refInside(pp, at(t0));
    for (let t = t0 + REF_STEP; t <= s2[1] + REF_STEP; t += REF_STEP) {
      const cur = refInsideM(pp, at(t));
      if (cur && refInside(pp, at(t))) ownSeen = true;
      if (prev && !cur) {
        let a = t - REF_STEP, b = t;
        for (let k = 0; k < 60; k++) {
          const m = (a + b) / 2;
          if (refInsideM(pp, at(m))) a = m;
          else b = m;
        }
        const te = (a + b) / 2;
        if (!ownSeen) {
          prev = cur;
          continue;
        }
        // the interval ends in host or rod material: no crossing of this part
        if (refInside(pp, at(te - 1e-5))) exits.push({ pp, t: te });
        break;
      }
      prev = cur;
    }
    for (const c of pp.part.cells) {
      const sp = refSlab(o, d, [c.x - 0.5, c.y - 0.5, c.z - 0.5], [c.x + 0.5, c.y + 0.5, c.z + 0.5]);
      if (sp && sp[1] - sp[0] < 2 * REF_STEP && sp[1] > 0) thin = true;
    }
  }
  if (!exits.length) return { status: thin ? 'ambiguous' : 'none', why: 'thin' };
  exits.sort((a, b) => a.t - b.t);
  const ex = exits[0]!;
  if (thin && ex.t > 0) return { status: 'ambiguous', why: 'thin' };
  const tie = exits.filter((e) => e.t - ex.t < REF_TIE_EPS);
  const describe = (e: { pp: RefPart; t: number }): RefHit => {
    const pp = e.pp;
    const pe = at(e.t);
    const pin = at(e.t - 1e-5);
    const ci = refCubeAt(pp, pin);
    if (ci >= 0) {
      const c = pp.part.cells[ci]!;
      const q = [c.x, c.y, c.z];
      const cand = [0, 1, 2].map((a) => ({ a, g: Math.abs(Math.abs(pe[a]! - q[a]!) - 0.5) })).sort((u, v) => u.g - v.g);
      const amb = cand[1]!.g < REF_EDGE_EPS;
      const a = cand[0]!.a;
      const dir = 2 * a + (d[a]! > 0 ? 0 : 1);
      return { status: amb ? 'ambiguous' : 'hit', why: amb ? 'edge' : undefined, partId: pp.part.id, cellIndex: ci, pos: q, dir, t: e.t, kind: c.kind, axis: c.axis, pe };
    }
    const hi = refDiscAt(pp, pin);
    if (hi < 0) return { status: 'ambiguous', why: 'lost' };
    const h = pp.part.cells[hi]!;
    const q = [h.x, h.y, h.z];
    const a = h.axis;
    const r = refRim(h)!;
    const flatGap = Math.abs(Math.abs(pe[a]! - q[a]!) - 0.5);
    let rad = 0;
    for (let k = 0; k < 3; k++) if (k !== a) rad += (pe[k]! - q[k]!) ** 2;
    const treadGap = Math.abs(Math.sqrt(rad) - r);
    if (Math.abs(flatGap - treadGap) < REF_EDGE_EPS) return { status: 'ambiguous', why: 'rim-edge' };
    if (flatGap < treadGap) {
      const g = [...q];
      for (let k = 0; k < 3; k++) if (k !== a) g[k] = Math.round(pe[k]!);
      for (let k = 0; k < 3; k++) if (k !== a && Math.abs(Math.abs(pe[k]! - g[k]!) - 0.5) < REF_EDGE_EPS) return { status: 'ambiguous', why: 'virtual-edge' };
      return { status: 'hit', partId: pp.part.id, cellIndex: hi, pos: q, dir: 2 * a + (d[a]! > 0 ? 0 : 1), t: e.t, virtual: g, pe };
    }
    const u = (a + 1) % 3;
    const v = (a + 2) % 3;
    const ru = pe[u]! - q[u]!;
    const rv = pe[v]! - q[v]!;
    if (Math.abs(Math.abs(ru) - Math.abs(rv)) < REF_EDGE_EPS) return { status: 'ambiguous', why: 'tread-diag' };
    const k = Math.abs(rv) > Math.abs(ru) ? v : u;
    const comp = k === u ? ru : rv;
    return { status: 'hit', partId: pp.part.id, cellIndex: hi, pos: q, dir: 2 * k + (comp < 0 ? 1 : 0), t: e.t, tread: true, pe };
  };
  if (tie.length > 1) {
    const ds = tie.map(describe);
    if (ds.some((x) => x.status !== 'hit')) return { status: 'ambiguous', why: 'tie-edge' };
    const samePos = ds.every((x) => x.pos && !x.virtual && !x.tread && x.pos.join() === ds[0]!.pos!.join());
    if (ds.length === 2 && samePos && refIsHole(ds[0]!.kind!) !== refIsHole(ds[1]!.kind!)) {
      const hole = refIsHole(ds[0]!.kind!) ? ds[0]! : ds[1]!;
      const male = hole === ds[0] ? ds[1]! : ds[0]!;
      const pe = hole.pe!;
      let rad = 0;
      for (let k = 0; k < 3; k++) if (k !== hole.axis) rad += (pe[k]! - hole.pos![k]!) ** 2;
      const axial = hole.dir! >> 1 === hole.axis;
      if (axial && Math.abs(Math.sqrt(rad) - REF_R_ROD) < REF_EDGE_EPS) return { status: 'ambiguous', why: 'rrod' };
      return { ...(axial && Math.sqrt(rad) < REF_R_ROD ? male : hole), tieKind: 'shared' };
    }
    ds.sort((x, y) => x.partId! - y.partId!);
    return { ...ds[0]!, tieKind: samePos ? 'other' : 'parts' };
  }
  return describe(ex);
}

interface Tally {
  n: number;
  compared: number;
  ambiguous: number;
  agree: number;
  mism: string[];
  hits?: number;
  virt?: number;
  tread?: number;
  shared?: number;
  oldRuleWouldDiffer?: number;
  /** Rays where the reference under the old one-way burial rule gives a different answer. */
  oneWayDiffers?: number;
}

function compare(m: Model, ray: Ray, t: Tally, label: string): void {
  t.n++;
  const ref = refBackSym(m, ray);
  const got = pickBack(m, ray);
  const old = refBackOld(m, ray) as RefHit;
  if (ref.status !== 'ambiguous' && old.status !== 'ambiguous') {
    const key = (h: RefHit) => (h.status === 'hit' ? `${h.partId} ${h.pos} ${h.dir} ${h.virtual ?? ''}` : h.status);
    if (key(old) !== key(ref)) t.oneWayDiffers = (t.oneWayDiffers ?? 0) + 1;
  }
  if (ref.status === 'ambiguous') {
    t.ambiguous++;
    return;
  }
  t.compared++;
  if (ref.status === 'hit') {
    t.hits = (t.hits ?? 0) + 1;
    if (ref.virtual) t.virt = (t.virt ?? 0) + 1;
    if (ref.tread) t.tread = (t.tread ?? 0) + 1;
    if (ref.tieKind === 'shared') t.shared = (t.shared ?? 0) + 1;
    // mutation check: the old rule (face opposite the hovered front face of the same cell)
    const f = pickCell(m, ray);
    if (f && !f.virtual && !f.tread && !(f.partId === ref.partId && f.pos.join() === ref.pos!.join() && (f.dir ^ 1) === ref.dir))
      t.oldRuleWouldDiffer = (t.oldRuleWouldDiffer ?? 0) + 1;
  }
  if (ref.status === 'none') {
    if (got === null) t.agree++;
    else if (t.mism.length < 40) t.mism.push(`${label}: ref none, got part ${got.partId} ${got.pos} dir ${got.dir}`);
    return;
  }
  const ok =
    got !== null &&
    got.partId === ref.partId &&
    got.pos.join() === ref.pos!.join() &&
    got.dir === ref.dir &&
    !!got.tread === !!ref.tread &&
    (got.virtual?.join() ?? '') === (ref.virtual?.join() ?? '') &&
    Math.abs(got.t - ref.t!) < 1e-5;
  if (ok) t.agree++;
  else if (t.mism.length < 40)
    t.mism.push(
      `${label} o=${ray.origin.map((v) => v.toFixed(4))} d=${ray.dir.map((v) => v.toFixed(4))}: ref p${ref.partId} ${ref.pos} d${ref.dir} t${ref.t!.toFixed(5)}${ref.virtual ? ' v' + ref.virtual : ''}${ref.tread ? ' tread' : ''}; got ${got ? `p${got.partId} ${got.pos} d${got.dir} t${got.t.toFixed(5)}${got.virtual ? ' v' + got.virtual : ''}${got.tread ? ' tread' : ''}` : 'null'}`,
    );
}

function sampleModel(m: Model, rnd: () => number, n: number, t: Tally, label: string): void {
  const { lo, hi } = modelBox(m);
  const dirs = viewDirs(rnd);
  for (let i = 0; i < n; i++) {
    const d0 = dirs[i % dirs.length]!;
    const l = Math.hypot(...d0);
    const d: V3 = [d0[0] / l, d0[1] / l, d0[2] / l];
    const p: V3 = [0, 1, 2].map((a) => lo[a]! - 0.3 + rnd() * (hi[a]! - lo[a]! + 0.6)) as V3;
    compare(m, { origin: [p[0] - 40 * d[0], p[1] - 40 * d[1], p[2] - 40 * d[2]], dir: d }, t, label);
  }
}

describe('ux2 review: pickBack against a ray-marching reference', () => {
  it('templates × 48 orientations × 14 axis/octant views + random views', () => {
    const rnd = lcg(20261126);
    const t: Tally = { n: 0, compared: 0, ambiguous: 0, agree: 0, mism: [] };
    for (const [name, m0] of Object.entries(TEMPLATES)) {
      for (const perm of PERMS)
        for (let sm = 0; sm < 8; sm++) {
          const signs = [sm & 1 ? -1 : 1, sm & 2 ? -1 : 1, sm & 4 ? -1 : 1];
          const off = [Math.floor(rnd() * 7) - 3, Math.floor(rnd() * 7) - 3, Math.floor(rnd() * 7) - 3];
          const m = transformModel(m0, perm, signs, off) as Model;
          sampleModel(m, rnd, 20, t, `${name}/${perm}/${signs}`);
        }
    }
    console.log(`templates: ${t.n} rays, ${t.compared} compared, ${t.ambiguous} ambiguous (edge/tie/thin), ${t.agree} agree; ref hits ${t.hits} (virtual ${t.virt}, tread ${t.tread}, shared-cell ties ${t.shared}); old opposite-face rule differs on ${t.oldRuleWouldDiffer}; old one-way burial rule differs on ${t.oneWayDiffers}`);
    if (t.mism.length) console.log(t.mism.join('\n'));
    expect(t.n).toBeGreaterThan(2000);
    // the templates exercise the two-way rule (rays down a rod through a hole)
    expect(t.oneWayDiffers ?? 0).toBeGreaterThan(0);
    expect(t.mism).toEqual([]);
  }, 300_000);

  it('the nine examples', () => {
    const rnd = lcg(7);
    const t: Tally = { n: 0, compared: 0, ambiguous: 0, agree: 0, mism: [] };
    for (const ex of EXAMPLES) sampleModel(buildExample(ex.name), rnd, 400, t, ex.name);
    console.log(`examples: ${t.n} rays, ${t.compared} compared, ${t.ambiguous} ambiguous, ${t.agree} agree; ref hits ${t.hits} (virtual ${t.virt}, tread ${t.tread}, shared ${t.shared}); old rule differs on ${t.oldRuleWouldDiffer}; one-way burial differs on ${t.oneWayDiffers}`);
    if (t.mism.length) console.log(t.mism.join('\n'));
    expect(t.mism).toEqual([]);
  }, 300_000);

  it('a click on a back pick builds at C + n of the highlighted face (or inserts / sleeves at C)', () => {
    const rnd = lcg(99);
    let n = 0;
    let built = 0;
    const bad: string[] = [];
    const tools = ['pinHole', 'axleHole', 'pin', 'axle', 'frictionPin'] as const;
    for (const ex of EXAMPLES) {
      const m = buildExample(ex.name);
      const { lo, hi } = modelBox(m);
      for (let i = 0; i < 120; i++) {
        const u = rnd() * 2 - 1;
        const ph = rnd() * 2 * Math.PI;
        const s = Math.sqrt(1 - u * u);
        const d: V3 = [s * Math.cos(ph), u, s * Math.sin(ph)];
        const p: V3 = [0, 1, 2].map((a) => lo[a]! + rnd() * (hi[a]! - lo[a]!)) as V3;
        const ray: Ray = { origin: [p[0] - 40 * d[0], p[1] - 40 * d[1], p[2] - 40 * d[2]], dir: d };
        const st = setBackSide(selectTool(initialToolState('#3b74c4'), tools[i % 5]!), true);
        const bp = buildPick(m, ray, st, pickCell(m, ray));
        if (!bp) continue;
        n++;
        const pr = resolveBuild(m, bp, null, st);
        if (!pr.backSide) bad.push(`${ex.name}: proposal not marked back side`);
        if (!/back side \((\+|−)[XYZ]\)/.test(pr.description)) bad.push(`${ex.name}: "${pr.description}"`);
        if (!pr.valid || !pr.cell) continue;
        const r = pr.apply(m);
        built++;
        const np = r.model.parts.find((q) => q.id === r.partId)!;
        const nIn = r.model.parts.reduce((a, q) => a + q.cells.length, 0) - m.parts.reduce((a, q) => a + q.cells.length, 0);
        // the ghost cell must be in the result
        if (!np.cells.some((c) => c.x === pr.cell!.x && c.y === pr.cell!.y && c.z === pr.cell!.z))
          bad.push(`${ex.name}: ghost ${[pr.cell.x, pr.cell.y, pr.cell.z]} not in result part ${r.partId}`);
        const C = bp.virtual ?? bp.pos;
        const nn = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]][bp.dir]!;
        const Cn = [C[0] + nn[0]!, C[1] + nn[1]!, C[2] + nn[2]!];
        const at = [pr.cell.x, pr.cell.y, pr.cell.z].join();
        const okPos = pr.action === 'extend' && !bp.virtual ? at === Cn.join() : true;
        if (!okPos) bad.push(`${ex.name}: ${pr.action} ${pr.description}: built ${at}, C+n ${Cn}`);
        if (pr.action === 'insert' || pr.action === 'sleeve') if (at !== C.join() && nIn < 2) bad.push(`${ex.name}: ${pr.action} at ${at} not C ${C}`);
      }
    }
    console.log(`click: ${n} back picks, ${built} valid builds, ${bad.length} bad`);
    if (bad.length) console.log(bad.slice(0, 30).join('\n'));
    expect(bad).toEqual([]);
  }, 300_000);
});

// ---------------------------------------------------------------------------------------------
// Contact shadow truth (DESIGN §6.1): groundShadowAt values recorded in the browser by
// e2e/review-ux2-shadow.mjs (e2e/out/review-ux2-shadow.json) against an independent CPU computation
// from the same part meshes: lowest surface over each texel centre of the recorded frame → the
// spec's (1 − h/SHADOW_H)², two Gaussian lobes (contact σ 0.35, ambient σ 0.9; radius 4σ), bilinear lookup. Skipped
// when the JSON is absent. Tolerance 0.02 (strength units, 1 = SHADOW_MAX): three 8-bit passes give
// ≤ ~0.006, the GPU's 3σ kernel truncation ≤ 0.003, rasterisation of texel centres exactly on a
// triangle edge a few 0.001 after the blur.
import { existsSync, readFileSync } from 'node:fs';
import { buildPartMesh, initGeometry } from '../../src/geometry';
import { SHADOW_AMBIENT, SHADOW_AMBIENT_BLUR, SHADOW_BLUR, SHADOW_CONTACT } from '../../src/view/shadowmath';

const SH_JSON = 'e2e/out/review-ux2-shadow.json';
describe.skipIf(!existsSync(SH_JSON))('ux2 review: contact shadow against a CPU height field + blur', () => {
  it('groundShadowAt matches over all recorded poses', async () => {
    await initGeometry();
    const data = JSON.parse(readFileSync(SH_JSON, 'utf8')) as {
      poses: { label: string; model: Model; transforms: Record<string, { p: V3; q: [number, number, number, number] } | null> | null; floorY: number; frame: { x0: number; z0: number; w: number; d: number } | null; samples: [number, number, number | null][] }[];
    };
    const TEX = 0.125;
    const rot = (q: readonly number[], v: readonly number[]): V3 => {
      const [x, y, z, w] = q as [number, number, number, number];
      const tx = 2 * (y * v[2]! - z * v[1]!);
      const ty = 2 * (z * v[0]! - x * v[2]!);
      const tz = 2 * (x * v[1]! - y * v[0]!);
      return [v[0]! + w * tx + (y * tz - z * ty), v[1]! + w * ty + (z * tx - x * tz), v[2]! + w * tz + (x * ty - y * tx)];
    };
    const rows: string[] = [];
    let worstAll = 0;
    let n = 0;
    for (const pose of data.poses) {
      const f = pose.frame;
      if (!f) {
        const nz = pose.samples.filter((s) => (s[2] ?? 0) > 0.001).length;
        rows.push(`${pose.label}: no frame, ${nz} non-zero samples`);
        continue;
      }
      const nx = Math.round(f.w / TEX);
      const nzT = Math.round(f.d / TEX);
      const S = new Float64Array(nx * nzT);
      for (const part of pose.model.parts) {
        const tr = pose.transforms ? pose.transforms[String(part.id)] : undefined;
        const md = buildPartMesh(part);
        const P = md.positions;
        const W: V3[] = [];
        for (let i = 0; i < P.length / 3; i++) {
          const e: V3 = [P[3 * i]! + md.origin[0], P[3 * i + 1]! + md.origin[1], P[3 * i + 2]! + md.origin[2]];
          if (tr) {
            const r = rot(tr.q, e);
            W.push([r[0] + tr.p[0], r[1] + tr.p[1], r[2] + tr.p[2]]);
          } else W.push(e);
        }
        const I = md.indices;
        for (let k = 0; k < I.length; k += 3) {
          const a = W[I[k]!]!, b = W[I[k + 1]!]!, c = W[I[k + 2]!]!;
          const area = (b[0] - a[0]) * (c[2] - a[2]) - (c[0] - a[0]) * (b[2] - a[2]);
          if (Math.abs(area) < 1e-12) continue;
          const i0 = Math.max(0, Math.floor((Math.min(a[0], b[0], c[0]) - f.x0) / TEX - 0.5));
          const i1 = Math.min(nx - 1, Math.ceil((Math.max(a[0], b[0], c[0]) - f.x0) / TEX - 0.5));
          const j0 = Math.max(0, Math.floor((Math.min(a[2], b[2], c[2]) - f.z0) / TEX - 0.5));
          const j1 = Math.min(nzT - 1, Math.ceil((Math.max(a[2], b[2], c[2]) - f.z0) / TEX - 0.5));
          for (let j = j0; j <= j1; j++)
            for (let i = i0; i <= i1; i++) {
              const px = f.x0 + (i + 0.5) * TEX;
              const pz = f.z0 + (j + 0.5) * TEX;
              const w0 = ((b[0] - px) * (c[2] - pz) - (c[0] - px) * (b[2] - pz)) / area;
              const w1 = ((c[0] - px) * (a[2] - pz) - (a[0] - px) * (c[2] - pz)) / area;
              const w2 = 1 - w0 - w1;
              if (w0 < -1e-9 || w1 < -1e-9 || w2 < -1e-9) continue;
              const y = w0 * a[1] + w1 * b[1] + w2 * c[1];
              const h = Math.min(1, Math.max(0, (y - pose.floorY) / 3));
              const s = (1 - h) * (1 - h);
              if (s > S[j * nx + i]!) S[j * nx + i] = s;
            }
        }
      }
      // Two lobes (fixer, DEVIATIONS §6 "Contact shadow"): the same height field blurred with the
      // contact σ and with the ambient σ, mixed by their opacities (strength 1 = SHADOW_MAX).
      const blurWith = (sigma: number): Float64Array => {
        const sig = sigma / TEX;
        const R = Math.min(32, Math.ceil(4 * sig));
        const wts = Array.from({ length: R + 1 }, (_, i) => Math.exp(-(i * i) / (2 * sig * sig)));
        const tot = wts[0]! + 2 * wts.slice(1).reduce((x, y) => x + y, 0);
        const blur = (src: Float64Array, dx: number, dy: number): Float64Array => {
          const o = new Float64Array(src.length);
          for (let j = 0; j < nzT; j++)
            for (let i = 0; i < nx; i++) {
              let s = 0;
              for (let k = -R; k <= R; k++) {
                const ii = Math.min(nx - 1, Math.max(0, i + k * dx));
                const jj = Math.min(nzT - 1, Math.max(0, j + k * dy));
                s += src[jj * nx + ii]! * wts[Math.abs(k)]!;
              }
              o[j * nx + i] = s / tot;
            }
          return o;
        };
        return blur(blur(S, 1, 0), 0, 1);
      };
      const Bc = blurWith(SHADOW_BLUR);
      const Ba = blurWith(SHADOW_AMBIENT_BLUR);
      const B = Bc.map((c, i) => (SHADOW_CONTACT * c + SHADOW_AMBIENT * Ba[i]!) / (SHADOW_CONTACT + SHADOW_AMBIENT));
      let worst = 0;
      let at = '';
      for (const [x, z, got] of pose.samples) {
        if (got === null) continue;
        if (x < f.x0 + 1.2 || x > f.x0 + f.w - 1.2 || z < f.z0 + 1.2 || z > f.z0 + f.d - 1.2) continue;
        const fx = (x - f.x0) / TEX - 0.5;
        const fz = (z - f.z0) / TEX - 0.5;
        const ix = Math.max(0, Math.min(nx - 2, Math.floor(fx)));
        const iz = Math.max(0, Math.min(nzT - 2, Math.floor(fz)));
        const tx = fx - ix;
        const tz = fz - iz;
        const v = (i: number, j: number) => B[(iz + j) * nx + ix + i]!;
        const exp = (v(0, 0) * (1 - tx) + v(1, 0) * tx) * (1 - tz) + (v(0, 1) * (1 - tx) + v(1, 1) * tx) * tz;
        n++;
        const e = Math.abs(exp - got);
        if (e > worst) {
          worst = e;
          at = `(${x}, ${z}) exp ${exp.toFixed(4)} got ${got.toFixed(4)}`;
        }
      }
      worstAll = Math.max(worstAll, worst);
      rows.push(`${pose.label}: frame ${f.w}×${f.d}, worst |Δ| ${worst.toFixed(4)} ${at}`);
    }
    console.log(`shadow truth: ${data.poses.length} poses, ${n} samples compared, worst ${worstAll.toFixed(4)}\n` + rows.join('\n'));
    expect(worstAll).toBeLessThan(0.02);
  }, 600_000);
});
