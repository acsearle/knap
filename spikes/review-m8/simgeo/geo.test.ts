// Geometry: random gear parts are closed one-shell manifolds; solid vs collider extents; teeth of
// meshed pairs in the real simulation never intersect (outlines placed by the sim's transforms).
import { beforeAll, it } from 'vitest';
import { appendFileSync, writeFileSync } from 'node:fs';
import { GEAR_RADII, addCell, addPart, canAddCell, canSetGear, emptyModel, gearPlaneBasis, gearTeeth, isHole, makeCell, partById, setGear } from '../../../src/core';
import type { Axis, Kind, Model, Part } from '../../../src/core';
import { exampleByName } from '../../../src/core/examples';
import { buildPartMesh, gearOutline, initGeometry, partColliders } from '../../../src/geometry';
import { Simulation } from '../../../src/physics/sim';
import { applyTransform } from '../../../src/physics/math';
import { edgeProblems, meshShells } from '../../../tests/geometry/helpers';
import { compound25, gearPair } from '../../../tests/physics/gearModels';
import { rng } from '../../review-m7/kgen';
import { chain } from './lib';

const OUT = 'spikes/review-m8/simgeo/geo.out';
const log = (s: string) => {
  console.log(s);
  appendFileSync(OUT, s + '\n');
};
beforeAll(async () => {
  await initGeometry();
  writeFileSync(OUT, '');
});

function randomGearPart(seed: number): Part | null {
  const r = rng(seed * 7 + 3);
  const pick = <T,>(a: readonly T[]): T => a[Math.floor(r() * a.length)]!;
  const kinds: Kind[] = ['pinHole', 'pinHole', 'axleHole', 'pin', 'axle', 'frictionPin'];
  let { model, partId } = addPart(emptyModel(), [makeCell(0, 0, 0, pick(['pinHole', 'axleHole'] as Kind[]), pick([0, 1, 2] as Axis[]))]);
  const D: [number, number, number][] = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
  const size = 2 + Math.floor(r() * 8);
  for (let t = 0; t < 200 && partById(model, partId)!.cells.length < size; t++) {
    const p = partById(model, partId)!;
    if (r() < 0.35) {
      const c = pick(p.cells);
      if (isHole(c.kind)) {
        const g = pick(GEAR_RADII);
        if (canSetGear(model, partId, [c.x, c.y, c.z], g).ok) model = setGear(model, partId, [c.x, c.y, c.z], g);
      }
      continue;
    }
    const from = pick(p.cells);
    const d = pick(D);
    const k = r() < 0.15 ? 2 : 1;
    const cell = makeCell(from.x + d[0] * k, from.y + d[1] * k, from.z + d[2] * k, pick(kinds), pick([0, 1, 2] as Axis[]));
    if (canAddCell(model, partId, cell).ok) model = addCell(model, partId, cell);
  }
  // the part may have split? addCell keeps one part; setGear never splits
  const p = partById(model, partId)!;
  return p.cells.some((c) => c.teeth) ? p : null;
}

it('random gear parts: closed, one shell, collider disc extents', () => {
  let n = 0;
  let bad = 0;
  let gears = 0;
  const fails: string[] = [];
  const t0 = Date.now();
  for (let seed = 1; n < 300; seed++) {
    const p = randomGearPart(seed);
    if (!p) continue;
    n++;
    gears += p.cells.filter((c) => c.teeth).length;
    const m = buildPartMesh(p);
    const ep = edgeProblems(m);
    const shells = meshShells(m);
    if (ep.length || shells !== 1) {
      bad++;
      fails.push(`seed ${seed}: edge problems ${ep.length} (${ep.slice(0, 2).join('; ')}), shells ${shells} ${JSON.stringify(p.cells)}`);
    }
    // collider: each gear has exactly one disc at r + 0.085, half-length 0.46; mesh extent in the gear slab
    const prims = partColliders(p);
    for (const c of p.cells.filter((q) => q.teeth)) {
      const idx = p.cells.indexOf(c);
      const discs = prims.filter((q) => q.shape === 'disc' && q.cell === idx);
      if (discs.length !== 1) fails.push(`seed ${seed}: gear cell ${idx} has ${discs.length} discs`);
      // drawn tip: max radial distance of mesh vertices within the gear slab
      const [u, v] = gearPlaneBasis(c.axis);
      let rmax = 0;
      for (let i = 0; i < m.positions.length; i += 3) {
        const w = [m.positions[i]! + m.origin[0], m.positions[i + 1]! + m.origin[1], m.positions[i + 2]! + m.origin[2]];
        const hub = [c.x, c.y, c.z];
        if (Math.abs(w[c.axis]! - hub[c.axis]!) > 0.47 + 1e-4) continue;
        rmax = Math.max(rmax, Math.hypot(w[u]! - hub[u]!, w[v]! - hub[v]!));
      }
      const want = c.rim! + 3 / 32;
      if (Math.abs(rmax - want) > 2e-3) fails.push(`seed ${seed}: gear ${idx} r ${c.rim} drawn max radius in slab ${rmax.toFixed(4)} vs tip ${want.toFixed(4)}`);
    }
  }
  log(`random gear parts: ${n} parts, ${gears} gears, ${bad} not closed/one-shell, ${fails.length} problems, ${((Date.now() - t0) / 1000).toFixed(0)} s\n  ${fails.slice(0, 20).join('\n  ')}`);
});

/** Signed min distance from the vertices of polygon A to polygon B (negative = a vertex of A inside B). */
function clearance(A: [number, number][], B: [number, number][]): number {
  let best = Infinity;
  for (const p of A) {
    let inside = false;
    let dmin = Infinity;
    for (let i = 0, j = B.length - 1; i < B.length; j = i++) {
      const [xi, yi] = B[i]!;
      const [xj, yj] = B[j]!;
      if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
      const dx = xj - xi;
      const dy = yj - yi;
      const t = Math.max(0, Math.min(1, ((p[0] - xi) * dx + (p[1] - yi) * dy) / (dx * dx + dy * dy)));
      dmin = Math.min(dmin, Math.hypot(p[0] - xi - t * dx, p[1] - yi - t * dy));
    }
    best = Math.min(best, inside ? -dmin : dmin);
  }
  return best;
}

/** Outline of a gear (hub cell c of a part) at the sim's current pose, projected on the gear's plane. */
function worldOutline(s: Simulation, body: number, hub: [number, number, number], ax: Axis, r: number, local: [number, number][]): [number, number][] {
  const [u, v] = gearPlaneBasis(ax);
  const t = s.bodyTransform(body)!;
  return local.map(([x, y]) => {
    const P: [number, number, number] = [...hub];
    P[u] += x;
    P[v] += y;
    const q = applyTransform(t, P);
    return [q[u]!, q[v]!];
  });
}

async function teethRun(label: string, model: Model, steps: number, setup?: (s: Simulation) => void): Promise<void> {
  const s = await Simulation.create(model, { jointFriction: 0 });
  setup?.(s);
  const gears: { body: number; hub: [number, number, number]; ax: Axis; r: number; local: [number, number][] }[] = [];
  for (const p of model.parts)
    for (const c of p.cells)
      if (c.teeth) {
        // the outline from gearOutline: points in (u, v) about the hub at rest (tooth phase included)
        gears.push({ body: s.bodyOf(p.id)!, hub: [c.x, c.y, c.z], ax: c.axis, r: c.rim!, local: gearOutline(c.rim!) });
      }
  const pairs: [number, number][] = [];
  for (let i = 0; i < gears.length; i++)
    for (let j = i + 1; j < gears.length; j++) {
      const a = gears[i]!;
      const b = gears[j]!;
      if (a.ax !== b.ax || a.hub[a.ax] !== b.hub[b.ax] || a.body === b.body) continue;
      const d = Math.hypot(a.hub[0] - b.hub[0], a.hub[1] - b.hub[1], a.hub[2] - b.hub[2]);
      if (Math.abs(d - a.r - b.r) < 1e-9) pairs.push([i, j]);
    }
  let worst = Infinity;
  let worstAt = 0;
  for (let i = 0; i <= steps; i++) {
    if (i) s.stepFixed(1);
    for (const [ia, ib] of pairs) {
      const a = gears[ia]!;
      const b = gears[ib]!;
      const A = worldOutline(s, a.body, a.hub, a.ax, a.r, a.local);
      const B = worldOutline(s, b.body, b.hub, b.ax, b.r, b.local);
      const c = Math.min(clearance(A, B), clearance(B, A));
      if (c < worst) {
        worst = c;
        worstAt = i;
      }
    }
  }
  log(`${label}: ${pairs.length} meshed pairs, ${steps} fixed steps, min outline clearance ${worst.toFixed(4)} at step ${worstAt} (negative = teeth intersect; ideal ≥ 0.0157)`);
  s.dispose();
}

it('teeth of meshed pairs never intersect in the real simulation', async () => {
  // sanity: as built (step 0) every pair clears
  for (const [ra, rb] of [[0.5, 0.5], [0.5, 1.5], [1, 1], [0.5, 2.5], [1.5, 1.5], [1.5, 2.5], [2.5, 2.5]] as [number, number][])
    for (const ax of [2, 0, 1] as Axis[]) {
      const c = chain(ax, [ra, rb]);
      await teethRun(`pair ${gearTeeth(ra)}+${gearTeeth(rb)} axis ${ax} spun at 40 rad/s`, c.model, 480, (s) => {
        const w: [number, number, number] = [0, 0, 0];
        w[ax] = 40;
        s.setBodyVelocity(s.bodyOf(c.parts[0]!)!, [0, 0, 0], w);
        const w2: [number, number, number] = [0, 0, 0];
        w2[ax] = (-40 * ra) / rb;
        s.setBodyVelocity(s.bodyOf(c.parts[1]!)!, [0, 0, 0], w2);
      });
    }
  await teethRun('crane 1:5 drop', gearPair(0.5, 2.5, { armB: 6 }).model, 1440);
  await teethRun('crane 1:25 drop', compound25(6).model, 1440);
  await teethRun('gear-train example', exampleByName('gear-train')!.build(), 2400);
});
