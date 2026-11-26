// Reviewer "ux2": Back side (DESIGN §7.3) against an independent ray-marching reference
// (e2e/review-ux2-ref.mjs), and resolveBuild on the picks. None of these tests fail on purpose.
import { describe, expect, it } from 'vitest';
import { emptyModel, makeCell } from '../../src/core';
import type { Cell, Model } from '../../src/core';
import { EXAMPLES, buildExample } from '../../src/core/examples';
import { buildPick, initialToolState, pickBack, pickCell, resolveBuild, selectTool, setBackSide } from '../../src/editor';
import type { Ray } from '../../src/editor';
// @ts-expect-error plain JS module shared with the e2e scripts
import { refBack, transformModel } from '../../e2e/review-ux2-ref.mjs';

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
}

function compare(m: Model, ray: Ray, t: Tally, label: string): void {
  t.n++;
  const ref = refBack(m, ray);
  const got = pickBack(m, ray);
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
    if (f && !f.virtual && !f.tread && !(f.partId === ref.partId && f.pos.join() === ref.pos.join() && (f.dir ^ 1) === ref.dir))
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
    got.pos.join() === ref.pos.join() &&
    got.dir === ref.dir &&
    !!got.tread === !!ref.tread &&
    (got.virtual?.join() ?? '') === (ref.virtual?.join() ?? '') &&
    Math.abs(got.t - ref.t) < 1e-5;
  if (ok) t.agree++;
  else if (t.mism.length < 40)
    t.mism.push(
      `${label} o=${ray.origin.map((v) => v.toFixed(4))} d=${ray.dir.map((v) => v.toFixed(4))}: ref p${ref.partId} ${ref.pos} d${ref.dir} t${ref.t.toFixed(5)}${ref.virtual ? ' v' + ref.virtual : ''}${ref.tread ? ' tread' : ''}; got ${got ? `p${got.partId} ${got.pos} d${got.dir} t${got.t.toFixed(5)}${got.virtual ? ' v' + got.virtual : ''}${got.tread ? ' tread' : ''}` : 'null'}`,
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
    console.log(`templates: ${t.n} rays, ${t.compared} compared, ${t.ambiguous} ambiguous (edge/tie/thin), ${t.agree} agree; ref hits ${t.hits} (virtual ${t.virt}, tread ${t.tread}, shared-cell ties ${t.shared}); old opposite-face rule differs on ${t.oldRuleWouldDiffer}`);
    if (t.mism.length) console.log(t.mism.join('\n'));
    expect(t.n).toBeGreaterThan(2000);
    expect(t.mism).toEqual([]);
  }, 300_000);

  it('the nine examples', () => {
    const rnd = lcg(7);
    const t: Tally = { n: 0, compared: 0, ambiguous: 0, agree: 0, mism: [] };
    for (const ex of EXAMPLES) sampleModel(buildExample(ex.name), rnd, 400, t, ex.name);
    console.log(`examples: ${t.n} rays, ${t.compared} compared, ${t.ambiguous} ambiguous, ${t.agree} agree; ref hits ${t.hits} (virtual ${t.virt}, tread ${t.tread}, shared ${t.shared}); old rule differs on ${t.oldRuleWouldDiffer}`);
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
