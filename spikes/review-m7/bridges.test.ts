// Item 3: crank holes (and male cells) near a rim's edge vs rimBridges.
// Run: npx vitest run --config spikes/review-m7/vitest.config.ts bridges
import { it } from 'vitest';
import { discOverlapsCell } from '../../src/core/disc';
import { addPart, emptyModel, makeCell, validateModel } from '../../src/core/model';
import type { Axis, Cell, Kind } from '../../src/core/types';
import { buildPartMesh, initGeometry, partSolidStats } from '../../src/geometry';
import type { MeshData } from '../../src/geometry';
import { edgeProblems, meshShells, meshVolume } from '../../tests/geometry/helpers';
import { logger } from './lib';
import { checkMesh } from './meshcheck';

const log = logger('bridges');
const H = 0.47;

function inPlane(axis: Axis, du: number, dv: number, base: [number, number, number] = [0, 0, 0]): [number, number, number] {
  const u = ((axis + 1) % 3) as Axis;
  const v = ((axis + 2) % 3) as Axis;
  const p: [number, number, number] = [...base];
  p[u] += du;
  p[v] += dv;
  return p;
}

function valid(cells: Cell[]): string | null {
  try {
    const m = addPart(emptyModel(), cells).model;
    const e = validateModel(m);
    return e.length ? e[0]!.message : null;
  } catch (e) {
    return (e as Error).message;
  }
}

it('single crank cell sweep: hub kind × r × axis × position × crank kind', async () => {
  await initGeometry();
  const stats = new Map<string, { n: number; bad: number; ex: string[] }>();
  const note = (k: string, bad: string | null) => {
    const s = stats.get(k) ?? { n: 0, bad: 0, ex: [] };
    s.n++;
    if (bad) {
      s.bad++;
      if (s.ex.length < 6) s.ex.push(bad);
    }
    stats.set(k, s);
  };
  let invalid = 0;
  const typeCount = new Map<string, number>();
  for (const hubKind of ['pinHole', 'axleHole'] as Kind[])
    for (let r = 1; r <= 4; r += 0.5)
      for (const axis of [0, 1, 2] as Axis[]) {
        const R = r - 0.03;
        for (let du = 0; du <= 5; du++)
          for (let dv = 0; dv <= du; dv++) {
            if (du === 0 && dv === 0) continue;
            const pos = inPlane(axis, du, dv);
            if (!discOverlapsCell([0, 0, 0], axis, r, pos)) continue;
            const d = Math.hypot(du, dv);
            const edge = d - H >= R - 0.3; // near the drawn edge (the bridged band and a margin)
            if (!edge) continue;
            const u = ((axis + 1) % 3) as Axis;
            const kinds: [Kind, Axis][] = [
              ['pinHole', axis], ['axleHole', axis], ['pinHole', u], ['axleHole', ((axis + 2) % 3) as Axis],
              ['pin', axis], ['axle', axis], ['frictionPin', u], ['axle', ((axis + 2) % 3) as Axis],
            ];
            for (const [k, ka] of kinds) {
              const cells = [makeCell(0, 0, 0, hubKind, axis, r), makeCell(pos[0], pos[1], pos[2], k, ka)];
              const why = valid(cells);
              if (why) {
                invalid++;
                continue;
              }
              const res = checkMesh(cells);
              for (const pr of res.problems) {
                const kind = pr.replace(/[0-9.]+/g, '#').slice(0, 40);
                typeCount.set(kind, (typeCount.get(kind) ?? 0) + 1);
              }
              const male = k === 'pin' || k === 'axle' || k === 'frictionPin';
              note(`${male ? 'male' : 'hole'} crank ${ka === axis ? 'parallel' : 'perpendicular'}`, res.problems.length ? `${hubKind} r ${r} axis ${axis} (${du},${dv}) ${k}/${ka} d−H−R=${(d - H - R).toFixed(3)}: ${res.problems.join('; ')}` : null);
            }
          }
      }
  log(`invalid (skipped) ${invalid}`);
  log(`problem types (no mid-plane sampling): ${JSON.stringify([...typeCount])}`);
  for (const [k, s] of stats) {
    log(`${k}: ${s.n} solids, ${s.bad} with problems`);
    for (const e of s.ex) log('   ', e);
  }
});

it('several holes at once, holes behind other cells, two wheels in one part', async () => {
  await initGeometry();
  let n = 0;
  let bad = 0;
  const ex: string[] = [];
  const run = (label: string, cells: Cell[]) => {
    const why = valid(cells);
    if (why) {
      log(`skip ${label}: ${why}`);
      return;
    }
    n++;
    const res = checkMesh(cells);
    if (res.problems.length) {
      bad++;
      if (ex.length < 20) ex.push(`${label}: ${res.problems.join('; ')}`);
    }
  };
  for (const axis of [0, 1, 2] as Axis[]) {
    const P = (du: number, dv: number, k: Kind = 'pinHole', a: Axis = axis, rim?: number) => {
      const p = inPlane(axis, du, dv);
      return makeCell(p[0], p[1], p[2], k, a, rim);
    };
    // r 3: all eight (2,3)-type holes at once
    run(`axis ${axis} r3 eight (±2,±3)/(±3,±2)`, [P(0, 0, 'pinHole', axis, 3), ...[[2, 3], [3, 2], [-2, 3], [-3, 2], [2, -3], [3, -2], [-2, -3], [-3, -2]].map(([a, b]) => P(a!, b!))]);
    // r 4: (2,4)-type all at once, axle holes
    run(`axis ${axis} r4 eight (±2,±4) axleHoles`, [P(0, 0, 'axleHole', axis, 4), ...[[2, 4], [4, 2], [-2, 4], [-4, 2], [2, -4], [4, -2], [-2, -4], [-4, -2]].map(([a, b]) => P(a!, b!, 'axleHole'))]);
    // r 3 hole at (2,3) behind an own beam cell at (1,3) and (2,2)
    run(`axis ${axis} r3 (2,3) next to own (1,3),(2,2)`, [P(0, 0, 'pinHole', axis, 3), P(2, 3), P(1, 3), P(2, 2)]);
    // r 3 hole at (2,3) with a beam leaving it outward (3,3),(4,3)
    run(`axis ${axis} r3 (2,3) + beam outward`, [P(0, 0, 'pinHole', axis, 3), P(2, 3), P(3, 3), P(4, 3)]);
    // two wheels in one part sharing a crank hole near both edges
    run(`axis ${axis} two r3 wheels 5 apart (overlapping), cranks (2,3),(3,3),(-2,-3)`, [P(0, 0, 'pinHole', axis, 3), P(5, 0, 'pinHole', axis, 3), P(2, 3), P(3, 3), P(-2, -3)]);
    run(`axis ${axis} two r3 wheels 6 apart joined by a beam, crank (2,3) and (8,-3)`, [P(0, 0, 'pinHole', axis, 3), P(6, 0, 'pinHole', axis, 3), P(1, 0), P(2, 0), P(3, 0), P(4, 0), P(5, 0), P(2, 3), P(8, -3)]);
    // two coaxial-layer wheels overlapping, crank near edge of the union
    run(`axis ${axis} r3 + r2 overlapping, crank (2,3) and (5,2)`, [P(0, 0, 'pinHole', axis, 3), P(4, 0, 'pinHole', axis, 2), P(2, 3), P(5, 2)]);
    // a perpendicular wheel in the same part whose disc reaches a crank of the first
    run(`axis ${axis} r3 + perpendicular r1 at crank (2,3)`, [P(0, 0, 'pinHole', axis, 3), P(2, 3, 'pinHole', ((axis + 1) % 3) as Axis, 1)]);
    // crank hole on a wheel of radius 1 at (1,1) and all four corners
    run(`axis ${axis} r1 four corners`, [P(0, 0, 'pinHole', axis, 1), P(1, 1), P(-1, 1), P(1, -1), P(-1, -1)]);
    // r 2.5 crank (2,2) used in the crank example plus far side (−2,−2)
    run(`axis ${axis} r2.5 (2,2),(−2,−2)`, [P(0, 0, 'pinHole', axis, 2.5), P(2, 2), P(-2, -2)]);
    // a male crank pin at (2,2) of r 2.5 (natural build: pin in the wheel instead of hole + pin)
    run(`axis ${axis} r2.5 male pin (2,2)`, [P(0, 0, 'pinHole', axis, 2.5), P(2, 2, 'pin')]);
    // a 2-long male crank pin sticking out of the wheel's face: (2,2) in layer and the next layer
    {
      const p0 = inPlane(axis, 2, 2);
      const p1: [number, number, number] = [...p0];
      p1[axis] += 1;
      run(`axis ${axis} r2.5 2-long crank pin (2,2)`, [P(0, 0, 'pinHole', axis, 2.5), makeCell(p0[0], p0[1], p0[2], 'pin', axis), makeCell(p1[0], p1[1], p1[2], 'pin', axis)]);
    }
  }
  log(`multi: ${n} solids, ${bad} with problems`);
  for (const e of ex) log('   ', e);
});

export {};
void meshShells; void edgeProblems; void meshVolume; void partSolidStats; void (null as unknown as MeshData);
