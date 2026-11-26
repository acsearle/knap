// Reviewer "ux2": an independent reference for Back side (DESIGN §7.3) — "the nearest back face along
// the ray", by dense ray marching with point-membership tests (no slab maths shared with
// src/editor/picking.ts). Plain JS so both tests/review/ux2.review.test.ts (vitest) and the e2e
// scripts (Node) use the same code.
//
// refBack(model, ray) -> { status: 'hit' | 'none' | 'ambiguous', partId, pos, dir, t, virtual?, tread? }
//   'ambiguous': the exit is within EDGE_EPS of an edge / corner, or two parts leave within TIE_EPS of
//   each other at different places, or a part's span is shorter than the march step (corner clips)
//   — such samples are counted, not compared.

const R_ROD = 0.295;
const STEP = 0.005;
const EDGE_EPS = 2e-4;
const TIE_EPS = 1e-6;

const isHole = (k) => k.endsWith('Hole');
export function rimOf(c) {
  const r = c.rim;
  return r !== undefined && isHole(c.kind) && r >= 1 && r <= 4 && Math.abs(r * 2 - Math.round(r * 2)) < 1e-9 ? r : undefined;
}

function prep(model) {
  return model.parts.map((p) => {
    const keys = new Map();
    p.cells.forEach((c, i) => keys.set(`${c.x},${c.y},${c.z}`, i));
    const hubs = p.cells.map((c, i) => [c, i, rimOf(c)]).filter((x) => x[2] !== undefined);
    let lo = [Infinity, Infinity, Infinity];
    let hi = [-Infinity, -Infinity, -Infinity];
    for (const c of p.cells) {
      const r = rimOf(c) ?? 0.5;
      const q = [c.x, c.y, c.z];
      for (let a = 0; a < 3; a++) {
        const e = a === c.axis ? 0.5 : r;
        lo[a] = Math.min(lo[a], q[a] - e);
        hi[a] = Math.max(hi[a], q[a] + e);
      }
    }
    return { part: p, keys, hubs, lo, hi };
  });
}

/** Cube index of the part strictly containing p, else -1. */
function cubeAt(pp, p) {
  const x = Math.round(p[0]);
  const y = Math.round(p[1]);
  const z = Math.round(p[2]);
  if (Math.abs(p[0] - x) >= 0.5 || Math.abs(p[1] - y) >= 0.5 || Math.abs(p[2] - z) >= 0.5) return -1;
  const i = pp.keys.get(`${x},${y},${z}`);
  return i === undefined ? -1 : i;
}
/** Hub index whose disc strictly contains p, else -1. */
function discAt(pp, p) {
  for (const [c, i, r] of pp.hubs) {
    const q = [c.x, c.y, c.z];
    const a = c.axis;
    if (Math.abs(p[a] - q[a]) >= 0.5) continue;
    let s = 0;
    for (let k = 0; k < 3; k++) if (k !== a) s += (p[k] - q[k]) ** 2;
    if (s < r * r) return i;
  }
  return -1;
}
const inside = (pp, p) => cubeAt(pp, p) >= 0 || discAt(pp, p) >= 0;
/**
 * Fixer's ruling (DEVIATIONS §7): a male cell inside another part's hole is buried in that part
 * (its host), so for a male part the host's solid counts as its own when finding where the ray
 * leaves it; an exit out of host material is not the male's (the host has its own there).
 */
const insideM = (pp, p) => inside(pp, p) || pp.hosts.some((h) => inside(h, p));
function linkHosts(pps) {
  const isMaleK = (k) => k === 'pin' || k === 'axle' || k === 'frictionPin';
  for (const pp of pps) {
    pp.hosts = [];
    for (const c of pp.part.cells) {
      if (!isMaleK(c.kind)) continue;
      for (const q of pps) {
        if (q === pp || pp.hosts.includes(q)) continue;
        const i = q.keys.get(`${c.x},${c.y},${c.z}`);
        if (i !== undefined && isHole(q.part.cells[i].kind)) pp.hosts.push(q);
      }
    }
  }
  return pps;
}

function slab(o, d, lo, hi) {
  let tn = -Infinity;
  let tf = Infinity;
  for (let a = 0; a < 3; a++) {
    if (Math.abs(d[a]) < 1e-15) {
      if (o[a] < lo[a] || o[a] > hi[a]) return null;
      continue;
    }
    let t1 = (lo[a] - o[a]) / d[a];
    let t2 = (hi[a] - o[a]) / d[a];
    if (t1 > t2) [t1, t2] = [t2, t1];
    tn = Math.max(tn, t1);
    tf = Math.min(tf, t2);
  }
  return tf > tn ? [tn, tf] : null;
}

export function refBack(model, ray) {
  const L = Math.hypot(...ray.dir);
  const d = ray.dir.map((v) => v / L);
  const o = ray.origin;
  const at = (t) => [o[0] + t * d[0], o[1] + t * d[1], o[2] + t * d[2]];
  const parts = linkHosts(prep(model))
    .map((pp) => ({ pp, s: slab(o, d, pp.lo.map((v) => v - 0.01), pp.hi.map((v) => v + 0.01)) }))
    .filter((x) => x.s && x.s[1] > 0);
  if (!parts.length) return { status: 'none' };
  let thin = false;
  const exits = [];
  for (const { pp, s } of parts) {
    // (a male's hosts may extend it beyond its own box)
    const s2 = pp.hosts.reduce((acc, h) => {
      const hs = slab(o, d, h.lo.map((v) => v - 0.01), h.hi.map((v) => v + 0.01));
      return hs ? [Math.min(acc[0], hs[0]), Math.max(acc[1], hs[1])] : acc;
    }, s);
    const t0 = Math.max(0, s2[0]);
    let prev = insideM(pp, at(t0));
    let tEntry = prev ? t0 : null;
    let ownSeen = prev && inside(pp, at(t0));
    for (let t = t0 + STEP; t <= s2[1] + STEP; t += STEP) {
      const cur = insideM(pp, at(t));
      if (cur && inside(pp, at(t))) ownSeen = true;
      if (cur && !prev) {
        // refine entry (for thin-span detection)
        let a = t - STEP, b = t;
        for (let k = 0; k < 50; k++) { const m = (a + b) / 2; if (insideM(pp, at(m))) b = m; else a = m; }
        tEntry = b;
      }
      if (prev && !cur) {
        let a = t - STEP, b = t;
        for (let k = 0; k < 60; k++) { const m = (a + b) / 2; if (insideM(pp, at(m))) a = m; else b = m; }
        const te = (a + b) / 2;
        // an interval with none of the part's own material (only its host): look further
        if (!ownSeen) {
          prev = cur;
          continue;
        }
        // the interval ends in host material: no crossing of this part
        if (inside(pp, at(te - 1e-5))) exits.push({ pp, t: te, tEntry });
        break;
      }
      prev = cur;
    }
    // A corner clip shorter than the step can be missed entirely: detect parts whose exact slab
    // span through some cube is < 2·STEP and flag.
    for (const c of pp.part.cells) {
      const sp = slab(o, d, [c.x - 0.5, c.y - 0.5, c.z - 0.5], [c.x + 0.5, c.y + 0.5, c.z + 0.5]);
      if (sp && sp[1] - sp[0] < 2 * STEP && sp[1] > 0) thin = true;
    }
  }
  if (!exits.length) return { status: thin ? 'ambiguous' : 'none', why: 'thin' };
  exits.sort((a, b) => a.t - b.t);
  let ex = exits[0];
  if (thin && exits.length && exits[0].t > 0) {
    // a missed thin span could be nearer than the found exit
    return { status: 'ambiguous', why: 'thin' };
  }
  const tie = exits.filter((e) => e.t - ex.t < TIE_EPS);
  const describe = (e) => {
    const pp = e.pp;
    const pe = at(e.t);
    const pin = at(e.t - 1e-5);
    const ci = cubeAt(pp, pin);
    if (ci >= 0) {
      const c = pp.part.cells[ci];
      const q = [c.x, c.y, c.z];
      // faces whose plane the exit point lies on
      const cand = [0, 1, 2].map((a) => ({ a, g: Math.abs(Math.abs(pe[a] - q[a]) - 0.5) })).sort((u, v) => u.g - v.g);
      const amb = cand[1].g < EDGE_EPS;
      const a = cand[0].a;
      const dir = 2 * a + (d[a] > 0 ? 0 : 1);
      return { status: amb ? 'ambiguous' : 'hit', why: amb ? 'edge' : undefined, partId: pp.part.id, cellIndex: ci, pos: q, dir, t: e.t, kind: c.kind, axis: c.axis, pe };
    }
    const hi = discAt(pp, pin);
    if (hi < 0) return { status: 'ambiguous', why: 'lost' };
    const h = pp.part.cells[hi];
    const q = [h.x, h.y, h.z];
    const a = h.axis;
    const r = rimOf(h);
    const flatGap = Math.abs(Math.abs(pe[a] - q[a]) - 0.5);
    let rad = 0;
    for (let k = 0; k < 3; k++) if (k !== a) rad += (pe[k] - q[k]) ** 2;
    const treadGap = Math.abs(Math.sqrt(rad) - r);
    if (Math.abs(flatGap - treadGap) < EDGE_EPS) return { status: 'ambiguous', why: 'rim-edge' };
    if (flatGap < treadGap) {
      const g = [...q];
      for (let k = 0; k < 3; k++) if (k !== a) g[k] = Math.round(pe[k]);
      // the virtual cell sits on a cell boundary?
      for (let k = 0; k < 3; k++) if (k !== a && Math.abs(Math.abs(pe[k] - g[k]) - 0.5) < EDGE_EPS) return { status: 'ambiguous', why: 'virtual-edge' };
      return { status: 'hit', partId: pp.part.id, cellIndex: hi, pos: q, dir: 2 * a + (d[a] > 0 ? 0 : 1), t: e.t, virtual: g, pe };
    }
    const u = (a + 1) % 3;
    const v = (a + 2) % 3;
    const ru = pe[u] - q[u];
    const rv = pe[v] - q[v];
    if (Math.abs(Math.abs(ru) - Math.abs(rv)) < EDGE_EPS) return { status: 'ambiguous', why: 'tread-diag' };
    const k = Math.abs(rv) > Math.abs(ru) ? v : u;
    const comp = k === u ? ru : rv;
    return { status: 'hit', partId: pp.part.id, cellIndex: hi, pos: q, dir: 2 * k + (comp < 0 ? 1 : 0), t: e.t, tread: true, pe };
  };
  if (tie.length > 1) {
    const ds = tie.map(describe);
    if (ds.some((x) => x.status !== 'hit')) return { status: 'ambiguous', why: 'tie-edge' };
    // shared cell: male in a hole of another part, both leaving the same cube
    const samePos = ds.every((x) => x.pos && !x.virtual && !x.tread && x.pos.join() === ds[0].pos.join());
    if (ds.length === 2 && samePos && isHole(ds[0].kind) !== isHole(ds[1].kind)) {
      const hole = isHole(ds[0].kind) ? ds[0] : ds[1];
      const male = hole === ds[0] ? ds[1] : ds[0];
      const pe = hole.pe;
      let rad = 0;
      for (let k = 0; k < 3; k++) if (k !== hole.axis) rad += (pe[k] - hole.pos[k]) ** 2;
      const axial = hole.dir >> 1 === hole.axis;
      if (axial && Math.abs(Math.sqrt(rad) - R_ROD) < EDGE_EPS) return { status: 'ambiguous', why: 'rrod' };
      return { ...(axial && Math.sqrt(rad) < R_ROD ? male : hole), tieKind: 'shared' };
    }
    if (!samePos) {
      // two different parts leave at the same t at different places (touching parts): lower id
      ds.sort((x, y) => x.partId - y.partId);
      return { ...ds[0], tieKind: 'parts' };
    }
    ds.sort((x, y) => x.partId - y.partId);
    return { ...ds[0], tieKind: 'other' };
  }
  return describe(ex);
}

/** Signed axis permutation: returns a function mapping a model to its rotated copy (+ offset). */
export function transformModel(model, perm, signs, off) {
  const map = (c) => {
    const p = [c.x, c.y, c.z];
    const q = [0, 1, 2].map((i) => signs[i] * p[perm[i]] + off[i]);
    const axis = perm.indexOf(c.axis);
    const out = { ...c, x: q[0], y: q[1], z: q[2], axis };
    return out;
  };
  return { ...model, parts: model.parts.map((p) => ({ ...p, cells: p.cells.map(map) })) };
}
