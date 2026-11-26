// The ground plane (DESIGN §5.1 "Ground"): tangent to the lowest ground-touching collider of the
// whole model, shared by the Simulation and the edit-mode view floor (shapes.ts groundPlane).
import { describe, expect, it } from 'vitest';
import { ModelBuilder, axle, beam, buildExample, pin } from '../../src/core/examples';
import { groundLevel, makeCell, setFixRoot, setGround } from '../../src/core/model';
import type { Model, Part } from '../../src/core/types';
import { E_FREE, HC, R_COLL_ROD } from '../../src/geometry/dims';
import { Simulation } from '../../src/physics/sim';
import { groundPlane, lowestGroundPoint, partShapes } from '../../src/physics/shapes';
import type { Vec3 } from '../../src/physics/math';

function model(f: (b: ModelBuilder) => void): Model {
  const b = new ModelBuilder();
  f(b);
  return setFixRoot(setGround(b.build(), true), false);
}

/** Brute force: every ground-touching collider point of every part (no margin filter). */
function brute(parts: readonly Part[], n: Vec3): number {
  const dot = (q: Vec3) => q[0] * n[0] + q[1] * n[1] + q[2] * n[2];
  let low = Infinity;
  for (const p of parts)
    for (const sh of partShapes(p, 16)) {
      if (sh.kind === 'hull') for (const q of sh.points) low = Math.min(low, dot(q));
      else if (sh.kind === 'box') {
        for (const sx of [-1, 1])
          for (const sy of [-1, 1])
            for (const sz of [-1, 1]) low = Math.min(low, dot([sh.center[0] + sx * sh.halfExtents[0], sh.center[1] + sy * sh.halfExtents[1], sh.center[2] + sz * sh.halfExtents[2]]));
      } else {
        // the round collider sampled finely (a native cylinder: its support is exact in groundPlane)
        const u = ((sh.axis + 1) % 3) as 0 | 1 | 2;
        const v = ((sh.axis + 2) % 3) as 0 | 1 | 2;
        for (let i = 0; i < 4096; i++)
          for (const s of [-1, 1]) {
            const q: Vec3 = [...sh.center];
            q[u] += sh.radius * Math.cos((i / 4096) * 2 * Math.PI);
            q[v] += sh.radius * Math.sin((i / 4096) * 2 * Math.PI);
            q[sh.axis] += s * sh.halfLength;
            low = Math.min(low, dot(q));
          }
      }
    }
  return low;
}

describe('ground plane (shapes.ts groundPlane)', () => {
  it('no ground: null', () => {
    expect(groundPlane(buildExample('four-bar'))).toBeNull();
  });

  it('a hole or a rim lowest: exactly groundLevel + (½ − HC), bit for bit (the first construction)', () => {
    const cases: Model[] = [
      model((b) => void b.add(beam([0, 0, 0], [4, 0, 0], 1))),
      model((b) => void b.add(beam([0, 0, 0], [4, 0, 0], 2))),
      model((b) => void b.add([makeCell(3, 2, -1, 'pinHole', 2, 2.5)])),
      model((b) => void b.add([makeCell(0, 0, 0, 'axleHole', 0, 1.5)])),
      buildExample('cart'),
    ];
    for (const m of cases) expect(groundPlane(m)!.d).toBe(groundLevel(m)! + (0.5 - HC));
  });

  it('a male end standing on the floor: E_FREE below its cell centre (0.02 below groundLevel + 0.04)', () => {
    const m = model((b) => void b.add(pin([0, 0, 0], [0, 1, 0])));
    expect(groundPlane(m)!.d).toBeCloseTo(-E_FREE, 12);
  });

  it('a rod lying on its side lowest: the plane rises to its prism face, R_COLL_ROD below the axis', () => {
    expect(groundPlane(model((b) => void b.add(pin([0, 0, 0], [1, 0, 0]))))!.d).toBeCloseTo(-R_COLL_ROD, 12);
    // an axle under a beam it is not mated with: the axle is lowest
    const m = model((b) => {
      b.add(axle([0, 0, 0], [3, 0, 0]));
      b.add(beam([0, 1, 0], [4, 1, 0], 2));
    });
    expect(groundPlane(m)!.d).toBeCloseTo(-R_COLL_ROD, 12);
  });

  it('agrees with a brute force over every collider point (no margin filter), level and tilted', () => {
    const models: Model[] = [
      buildExample('cart'),
      model((b) => {
        b.add(beam([0, 0, 0], [6, 0, 0], 1));
        b.add(pin([2, -1, 0], [2, 0, 0], 1));
        b.add([makeCell(9, 3, 0, 'pinHole', 2, 3)]);
      }),
      model((b) => {
        b.add([makeCell(0, 0, 0, 'pinHole', 1, 2.5)]);
        b.add(axle([5, -1, 0], [5, -1, 3]));
        b.add(beam([-6, 4, 0], [-6, 4, 5], 0));
      }),
    ];
    for (const m of models)
      for (const deg of [0, 5, 15, -30]) {
        const th = (deg * Math.PI) / 180;
        const n: Vec3 = [Math.sin(th), Math.cos(th), 0];
        const want = brute(m.parts, n);
        const got = lowestGroundPoint(m.parts, n);
        expect(got).toBeLessThanOrEqual(want + 1e-12);
        expect(want - got).toBeLessThan(1e-6); // the brute force samples the round collider
        if (deg !== 0) expect(groundPlane(m, deg)!.d).toBe(got);
      }
  });

  it('the Simulation uses it: groundY is the plane at θ = 0, and the tilted plane touches the same point', async () => {
    const m = model((b) => {
      b.add(pin([0, 0, 0], [1, 0, 0]));
      b.add(beam([3, 1, 0], [7, 1, 0], 1));
    });
    const s = await Simulation.create(m);
    expect(s.groundY).toBe(groundPlane(m)!.d);
    s.dispose();
    const t = await Simulation.create(m, { groundSlopeDeg: 15 });
    const pl = groundPlane(m, 15)!;
    // groundY is the tilted plane's height under the mean cell centre
    let cx = 0;
    let k = 0;
    for (const p of m.parts)
      for (const c of p.cells) {
        cx += c.x;
        k++;
      }
    expect(t.groundY!).toBeCloseTo((pl.d - pl.normal[0] * (cx / k)) / pl.normal[1], 12);
    t.dispose();
  });
});
