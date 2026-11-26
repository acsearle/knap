// Gear fuzz (DESIGN.md §2.7):
// 1. random small models with gears, wheels and cells (all axes, negative coordinates): every
//    canAddCell / canSetGear / canSetRim / canRemoveCell / movePart / rotatePart answer must equal
//    validateModel of the raw result (split into components the way the operations split);
// 2. the exact disc tests against an independent float computation (closed form with sqrt/hypot,
//    disagreement allowed only within 1e-9 of a boundary — counted and listed) and a one-sided
//    point sampler (a point found strictly inside both solids ⇒ the exact test must say overlap).
import { describe, expect, it } from 'vitest';
import {
  GEAR_RADII,
  addCell,
  addPart,
  canAddCell,
  canRemoveCell,
  canSetGear,
  canSetRim,
  components,
  deserialize,
  emptyModel,
  fineDiscDiscContact,
  gearContact,
  gearMeshes,
  gearPlaneBasis,
  isHole,
  makeCell,
  movePart,
  removeCell,
  rotatePart,
  serialize,
  setGear,
  setRim,
  tipOverlapsCell,
  tipOverlapsWheel,
  tipRadius,
  validateModel,
} from '../../src/core';
import type { Axis, CanResult, Cell, Kind, Model, Part, Vec3i } from '../../src/core';

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const reason = (r: CanResult) => (r.ok ? 'ok' : r.reason);

/** Replace a part's cells without any checks, splitting into components (as the ops do). */
function rawReplace(m: Model, part: Part, cells: Cell[]): Model {
  if (cells.length === 0) return { ...m, version: 3, parts: m.parts.filter((p) => p.id !== part.id) };
  const comps = components(cells).sort((a, b) => b.length - a.length);
  let next = Math.max(m.nextPartId, ...m.parts.map((p) => p.id + 1));
  const pieces = comps.map((comp, k) => ({ ...part, id: k === 0 ? part.id : next++, cells: comp.map((i) => cells[i]!) }));
  const parts: Part[] = [];
  for (const p of m.parts) parts.push(...(p.id === part.id ? pieces : [p]));
  return { ...m, version: 3, parts, nextPartId: next };
}

describe('fuzz: gear edits — canX / ops agree exactly with validateModel', () => {
  const SEEDS = Number(process.env.GEAR_FUZZ_SEEDS ?? 200);
  const STEPS = 110;
  it(`${SEEDS} seeds × ${STEPS} random edits (≥ 20 000 models)`, () => {
    const KINDS: Kind[] = ['pinHole', 'pinHole', 'pinHole', 'axleHole', 'axle', 'pin', 'frictionPin'];
    const stats: Record<string, number> = { models: 0, add: 0, gear: 0, rim: 0, move: 0, rot: 0, remove: 0, rejected: 0, gearReasons: 0, meshes: 0, maxGears: 0 };
    const reasons = new Map<string, number>();
    const note = (r: CanResult) => {
      if (r.ok) return;
      stats.rejected!++;
      const k = r.reason.replace(/-?\d+/g, '#');
      if (/gear|teeth|mesh/.test(k)) stats.gearReasons!++;
      reasons.set(k, (reasons.get(k) ?? 0) + 1);
    };
    for (let seed = 1; seed <= SEEDS; seed++) {
      const r = rng(seed * 7919);
      const pick = <T,>(a: readonly T[]): T => a[Math.floor(r() * a.length)]!;
      const rnd = (n: number) => Math.floor(r() * (2 * n + 1)) - n;
      let m = emptyModel();
      for (let step = 0; step < STEPS; step++) {
        const op = m.parts.length === 0 ? 0 : Math.floor(r() * 14);
        const part = m.parts.length ? pick(m.parts) : null;
        const at = `seed ${seed} step ${step}`;
        let raw: Model | null = null;
        if (op <= 3) {
          const kind = pick(KINDS);
          let pos: [number, number, number] = [rnd(4) - 1, rnd(3), rnd(3) - 1];
          if (part && r() < 0.75) {
            const from = pick(part.cells);
            pos = [from.x + rnd(2), from.y + rnd(1), from.z + rnd(1)];
          }
          const x = r();
          const gear = isHole(kind) && x < 0.3;
          const rim = gear ? pick(GEAR_RADII) : isHole(kind) && x < 0.4 ? pick([1, 1.5, 2]) : undefined;
          const cell = makeCell(pos[0], pos[1], pos[2], kind, pick([0, 1, 2] as Axis[]), rim, gear);
          const target = part && r() < 0.75 ? part.id : null;
          const can = canAddCell(m, target, cell);
          raw =
            target === null
              ? { ...m, version: 3, parts: [...m.parts, { id: m.nextPartId, color: '#808080', cells: [cell] }], nextPartId: m.nextPartId + 1 }
              : { ...m, version: 3, parts: m.parts.map((p) => (p.id === target ? { ...p, cells: [...p.cells, cell] } : p)) };
          const errs = validateModel(raw);
          expect(can.ok, `${at} addCell ${JSON.stringify(cell)} → ${target}: ${reason(can)} / ${JSON.stringify(errs.slice(0, 2))}`).toBe(errs.length === 0);
          note(can);
          if (can.ok) {
            m = target === null ? addPart(m, [cell]).model : addCell(m, target, cell);
            stats.add!++;
          }
        } else if (op <= 5) {
          const c = pick(part!.cells);
          const g = pick([undefined, ...GEAR_RADII, 2, 3]);
          const can = canSetGear(m, part!.id, [c.x, c.y, c.z], g);
          const ok = g === undefined || (isHole(c.kind) && GEAR_RADII.includes(g));
          if (ok) {
            raw = rawReplace(m, part!, part!.cells.map((q) => (q === c ? makeCell(q.x, q.y, q.z, q.kind, q.axis, g, g !== undefined) : q)));
            const errs = validateModel(raw);
            expect(can.ok, `${at} setGear ${g} on ${JSON.stringify(c)}: ${reason(can)} / ${JSON.stringify(errs.slice(0, 2))}`).toBe(errs.length === 0);
          } else expect(can.ok, `${at} setGear ${g} on ${JSON.stringify(c)}`).toBe(false);
          note(can);
          if (can.ok) {
            m = setGear(m, part!.id, [c.x, c.y, c.z], g);
            expect(m.parts).toEqual(raw!.parts);
            stats.gear!++;
          }
        } else if (op === 6) {
          const c = pick(part!.cells);
          const rim = pick([undefined, 1, 1.5, 2, 2.5, 3, 0.5]);
          const can = canSetRim(m, part!.id, [c.x, c.y, c.z], rim);
          const ok = rim === undefined || (isHole(c.kind) && rim >= 1);
          if (ok) {
            raw = rawReplace(m, part!, part!.cells.map((q) => (q === c ? makeCell(q.x, q.y, q.z, q.kind, q.axis, rim) : q)));
            const errs = validateModel(raw);
            expect(can.ok, `${at} setRim ${rim} on ${JSON.stringify(c)}: ${reason(can)} / ${JSON.stringify(errs.slice(0, 2))}`).toBe(errs.length === 0);
          } else expect(can.ok).toBe(false);
          note(can);
          if (can.ok) {
            m = setRim(m, part!.id, [c.x, c.y, c.z], rim);
            stats.rim!++;
          }
        } else if (op <= 8) {
          const d = pick<Vec3i>([[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1], [2, 0, 0], [0, -2, 0], [1, 0, -1]]);
          const res = movePart(m, part!.id, d);
          raw = rawReplace(m, part!, part!.cells.map((q) => makeCell(q.x + d[0], q.y + d[1], q.z + d[2], q.kind, q.axis, q.rim, q.teeth)));
          expect(res !== null, `${at} movePart ${d}: ${JSON.stringify(validateModel(raw).slice(0, 2))}`).toBe(validateModel(raw).length === 0);
          if (res) {
            m = res;
            stats.move!++;
          } else stats.rejected!++;
        } else if (op <= 10) {
          const axis = pick([0, 1, 2] as Axis[]);
          const k = pick([1, 2, 3]);
          const c0 = pick(part!.cells);
          const res = rotatePart(m, part!.id, axis, k, [c0.x, c0.y, c0.z]);
          const alone = rotatePart({ ...m, parts: [part!] }, part!.id, axis, k, [c0.x, c0.y, c0.z])!;
          raw = rawReplace(m, part!, alone.parts[0]!.cells);
          expect(res !== null, `${at} rotatePart: ${JSON.stringify(validateModel(raw).slice(0, 2))}`).toBe(validateModel(raw).length === 0);
          if (res) {
            m = res;
            stats.rot!++;
          } else stats.rejected!++;
        } else if (op >= 12) {
          // a one-gear part placed in the layer of an existing gear, near mesh distance (or anywhere)
          const gs = m.parts.flatMap((p) => p.cells.filter((c) => c.teeth));
          const g0 = gs.length ? pick(gs) : pick(part!.cells);
          const r2 = pick(GEAR_RADII);
          const s = (g0.rim ?? 0.5) + r2;
          const [u, v] = gearPlaneBasis(g0.axis);
          const q: [number, number, number] = [g0.x, g0.y, g0.z];
          if (r() < 0.5) {
            const a = Math.round(s) + rnd(1);
            const bb = rnd(Math.min(a, 5));
            const [du, dv] = r() < 0.5 ? [a, bb] : [bb, a];
            q[u] += r() < 0.5 ? du : -du;
            q[v] += r() < 0.5 ? dv : -dv;
          } else {
            q[u] += rnd(6);
            q[v] += rnd(6);
          }
          const axis = r() < 0.85 ? g0.axis : pick([0, 1, 2] as Axis[]);
          const cell = makeCell(q[0], q[1], q[2], pick(['pinHole', 'axleHole'] as Kind[]), axis, r2, true);
          const can = canAddCell(m, null, cell);
          raw = { ...m, version: 3, parts: [...m.parts, { id: m.nextPartId, color: '#808080', cells: [cell] }], nextPartId: m.nextPartId + 1 };
          const errs = validateModel(raw);
          expect(can.ok, `${at} gearNear ${JSON.stringify(cell)}: ${reason(can)} / ${JSON.stringify(errs.slice(0, 2))}`).toBe(errs.length === 0);
          note(can);
          if (can.ok) {
            m = addPart(m, [cell]).model;
            stats.add!++;
          }
        } else {
          const c = pick(part!.cells);
          const can = canRemoveCell(m, part!.id, [c.x, c.y, c.z]);
          raw = rawReplace(m, part!, part!.cells.filter((q) => q !== c));
          expect(can.ok, `${at} removeCell ${JSON.stringify(c)}`).toBe(validateModel(raw).length === 0);
          note(can);
          if (can.ok) {
            m = removeCell(m, part!.id, [c.x, c.y, c.z]);
            stats.remove!++;
          }
        }
        stats.models!++;
        expect(validateModel(m), at).toEqual([]);
        expect(deserialize(serialize(m))).toEqual(m);
        const gears = m.parts.reduce((a, p) => a + p.cells.filter((c) => c.teeth).length, 0);
        stats.maxGears = Math.max(stats.maxGears!, gears);
        stats.meshes! += gearMeshes(m).length;
      }
    }
    console.log(`gear core fuzz: ${JSON.stringify(stats)}`);
    console.log(
      `gear core fuzz rejection reasons (top 25):\n${[...reasons]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 25)
        .map(([k, n]) => `  ${n} ${k}`)
        .join('\n')}`,
    );
    expect(stats.models).toBeGreaterThanOrEqual(20000);
    expect(stats.gear).toBeGreaterThan(SEEDS * 3);
    expect(stats.gearReasons).toBeGreaterThan(SEEDS * 3);
    expect(stats.meshes).toBeGreaterThan(SEEDS);
    for (const re of [/would clash with the gear of part # \(hub \(#, #, #\)\)$/, /crossed axes/, /cut into the teeth/, /gear teeth would hit/, /inside the gear/, /straight line/, /gears would overlap/, /gear teeth of part/])
      expect([...reasons.keys()].some((k) => re.test(k)), String(re)).toBe(true);
  }, 600000);
});

// ---------------------------------------------------------------------------------------------
// 2. exact tests vs float

const EPS = 1e-9;

/** Float half-thickness/extent of a disc solid along each world axis. */
function inDiscF(hub: Vec3i, axis: Axis, r: number, q: number[], margin: number): boolean {
  const [u, v] = gearPlaneBasis(axis);
  return Math.abs(q[axis]! - hub[axis]) < 0.5 - margin && Math.hypot(q[u]! - hub[u], q[v]! - hub[v]) < r - margin;
}

describe('fuzz: exact disc tests vs an independent float computation and a point sampler', () => {
  const N = 60000;
  it(`${N} random tip × cell, tip × wheel, gear × gear (parallel and crossed)`, () => {
    const r = rng(4242);
    const pick = <T,>(a: readonly T[]): T => a[Math.floor(r() * a.length)]!;
    const ri = (n: number) => Math.floor(r() * (2 * n + 1)) - n;
    const boundary: string[] = [];
    const stats = { cell: 0, cellOverlap: 0, wheel: 0, wheelOverlap: 0, par: 0, perp: 0, perpOverlap: 0, sampled: 0, sampledInside: 0, boundary: 0, exactTouch: 0 };
    const four: Record<string, number> = {};
    for (let i = 0; i < N; i++) {
      const axis = pick([0, 1, 2] as Axis[]);
      const hub: Vec3i = [ri(6), ri(6), ri(6)];
      const rg = pick(GEAR_RADII);
      const rt = tipRadius(rg);
      const kind = i % 3;
      if (kind === 0) {
        // tip × cell
        const p: [number, number, number] = [hub[0] + ri(4), hub[1] + ri(4), hub[2] + ri(4)];
        if (r() < 0.6) p[axis] = hub[axis];
        const [u, v] = gearPlaneBasis(axis);
        const near = Math.hypot(Math.max(0, Math.abs(p[u] - hub[u]) - 0.5), Math.max(0, Math.abs(p[v] - hub[v]) - 0.5));
        const same = p[axis] === hub[axis];
        const exact = tipOverlapsCell(hub, axis, rg, p);
        stats.cell++;
        if (exact) stats.cellOverlap++;
        if (same && Math.abs(near - rt) < EPS) {
          stats.boundary++;
          boundary.push(`tip×cell r ${rg} hub ${hub} pos ${p}`);
          continue;
        }
        expect(exact, `tip×cell r ${rg} ${hub} ${p}`).toBe(same && near < rt);
        continue;
      }
      // a second disc: plain wheel (kind 1) or gear (kind 2), parallel or crossed
      const b: Axis = r() < 0.5 ? axis : pick(([0, 1, 2] as Axis[]).filter((x) => x !== axis));
      const hb: [number, number, number] = [hub[0] + ri(6), hub[1] + ri(6), hub[2] + ri(6)];
      if (b === axis && r() < 0.7) hb[axis] = hub[axis];
      const r2 = kind === 1 ? pick([1, 1.5, 2, 2.5, 3, 3.5, 4]) : pick(GEAR_RADII);
      const R2 = kind === 1 ? r2 : tipRadius(r2);
      // float closed form for the overlap of solid discs (rt, R2)
      let overlapF: boolean;
      let gap: number; // distance of the decision from its boundary
      if (b === axis) {
        const [u, v] = gearPlaneBasis(axis);
        const d = Math.hypot(hb[u] - hub[u], hb[v] - hub[v]);
        const same = hb[axis] === hub[axis];
        overlapF = same && d < rt + R2;
        gap = same ? Math.abs(d - rt - R2) : Infinity;
      } else {
        const k = (3 - axis - b) as Axis;
        const mb = Math.max(0, Math.abs(hb[b] - hub[b]) - 0.5);
        const ma = Math.max(0, Math.abs(hb[axis] - hub[axis]) - 0.5);
        const dk = Math.abs(hb[k] - hub[k]);
        if (mb >= rt || ma >= R2) {
          // mb, ma, rt, R2 are dyadic: equality here is an exact touch (a face in the other's layer face)
          overlapF = false;
          gap = Infinity;
          if (mb === rt || ma === R2) stats.exactTouch++;
        } else {
          const sum = Math.sqrt(rt * rt - mb * mb) + Math.sqrt(R2 * R2 - ma * ma);
          overlapF = dk < sum;
          gap = Math.abs(dk - sum);
        }
      }
      const exactSolid = fineDiscDiscContact(hub, axis, rt, hb, b, R2) === 'overlap';
      if (kind === 1) {
        stats.wheel++;
        const e = tipOverlapsWheel(hub, axis, rg, hb, b, r2);
        expect(e).toBe(exactSolid);
        if (e) stats.wheelOverlap++;
      } else if (b === axis) {
        stats.par++;
        const c = gearContact(hub, axis, rg, hb, b, r2);
        four[c] = (four[c] ?? 0) + 1;
        // four-way against float d and s
        const [u, v] = gearPlaneBasis(axis);
        const du = hb[u] - hub[u];
        const dv = hb[v] - hub[v];
        const d = Math.hypot(du, dv);
        const s = rg + r2;
        const same = hb[axis] === hub[axis];
        let want: string;
        if (!same) want = 'clear';
        else if (Math.abs(d - s) < EPS) {
          // a genuine tie: d = s exactly (integer Pythagorean distance); decided by in-line-ness
          want = du === 0 || dv === 0 ? 'mesh' : 'diagonal';
          expect(du * du + dv * dv).toBe(s * s);
        } else if (d < s) want = 'overlap';
        else if (Math.abs(d - s - 3 / 16) < EPS) {
          stats.boundary++;
          boundary.push(`gear four-way at s + 3/16: ${rg}+${r2} (${du},${dv})`);
          continue;
        } else want = d < s + 3 / 16 ? 'clash' : 'clear';
        expect(c, `${rg}+${r2} (${du},${dv}) layer ${same}`).toBe(want);
        // the four-way is the tip-disc overlap except at the exact pitch touch
        if (c !== 'mesh' && c !== 'diagonal') expect(c !== 'clear').toBe(exactSolid);
      } else {
        stats.perp++;
        const c = gearContact(hub, axis, rg, hb, b, r2);
        expect(c === 'crossed').toBe(exactSolid);
        if (c === 'crossed') stats.perpOverlap++;
      }
      if (gap < EPS) {
        stats.boundary++;
        boundary.push(`disc×disc ${kind === 1 ? 'tip×wheel' : 'tip×tip'} axes ${axis}/${b} r ${rt}/${R2} d ${[hb[0] - hub[0], hb[1] - hub[1], hb[2] - hub[2]]}`);
      } else expect(exactSolid, `float disagrees: axes ${axis}/${b} r ${rt}/${R2} hubs ${hub} ${hb}`).toBe(overlapF);
      // one-sided point sampler on the overlap of the bounding boxes
      if (overlapF || r() < 0.1) {
        stats.sampled++;
        const lo: number[] = [];
        const hi: number[] = [];
        for (let j = 0; j < 3; j++) {
          const ea = j === axis ? 0.5 : rt;
          const eb = j === b ? 0.5 : R2;
          lo.push(Math.max(hub[j]! - ea, hb[j]! - eb));
          hi.push(Math.min(hub[j]! + ea, hb[j]! + eb));
        }
        if (lo.every((x, j) => x < hi[j]!)) {
          for (let t = 0; t < 400; t++) {
            const q = lo.map((x, j) => x + r() * (hi[j]! - x));
            if (inDiscF(hub, axis, rt, q, EPS) && inDiscF(hb, b, R2, q, EPS)) {
              stats.sampledInside++;
              expect(exactSolid, `sampler found a common point ${q}: axes ${axis}/${b} hubs ${hub} ${hb}`).toBe(true);
              break;
            }
          }
        }
      }
    }
    console.log(`gear disc fuzz: ${JSON.stringify(stats)} four-way ${JSON.stringify(four)}`);
    console.log(`gear disc fuzz boundary cases (within ${EPS}): ${boundary.length}${boundary.length ? '\n  ' + boundary.slice(0, 40).join('\n  ') : ''}`);
    expect(stats.exactTouch).toBeGreaterThan(100);
    expect(stats.boundary).toBe(0);
    expect(stats.cellOverlap).toBeGreaterThan(1000);
    expect(stats.perpOverlap).toBeGreaterThan(200);
    expect(stats.sampledInside).toBeGreaterThan(1000);
    for (const k of ['mesh', 'clash', 'overlap', 'clear']) expect(four[k] ?? 0, k).toBeGreaterThan(0);
  }, 300000);
});
