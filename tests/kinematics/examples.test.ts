import { describe, expect, it } from 'vitest';
import {
  EXAMPLES,
  ModelBuilder,
  axle,
  beam,
  beamPath,
  buildExample,
  bush,
  exampleByName,
  pin,
  runBetween,
} from '../../src/core/examples';
import { analyze, type Joint, type KinematicGraph } from '../../src/core/kinematics';
import { validateModel } from '../../src/core/model';
import { isHole } from '../../src/core/rules';
import type { Model } from '../../src/core/types';

const rev = (bodyA: number, bodyB: number, origin: [number, number, number], axis: 0 | 1 | 2 = 2): Joint => ({
  bodyA,
  bodyB,
  type: 'revolute',
  origin,
  axis,
});

function graphOf(name: string): { m: Model; g: KinematicGraph } {
  const m = buildExample(name);
  return { m, g: analyze(m) };
}

/** Planar degrees of freedom (Grübler) for a graph whose joints are all revolute about Z. */
function planarDof(g: KinematicGraph): number {
  return 3 * (g.bodies.length - 1) - 2 * g.joints.length;
}

describe('registry', () => {
  it('has the seven §8 examples with unique names, titles and descriptions', () => {
    expect(EXAMPLES.map((e) => e.name)).toEqual([
      'pendulum',
      'triple-pendulum',
      'four-bar',
      'parallelogram',
      'sliding-axle',
      'weld-test',
      'collision',
    ]);
    for (const e of EXAMPLES) {
      expect(e.title.length).toBeGreaterThan(0);
      expect(e.description.length).toBeGreaterThan(10);
      expect(e.title + e.description).not.toMatch(/lego|technic/i);
    }
  });
  it('every example builds a valid model, freshly each time', () => {
    for (const e of EXAMPLES) {
      const a = e.build();
      const b = e.build();
      expect(validateModel(a), e.name).toEqual([]);
      expect(a).not.toBe(b);
      expect(a).toEqual(b);
      expect(a.rootPartId).toBe(1);
    }
  });
  it('lookup by name', () => {
    expect(exampleByName('four-bar')?.title).toBe('Four-bar linkage');
    expect(exampleByName('nope')).toBeUndefined();
    expect(() => buildExample('nope')).toThrow(/unknown example/);
  });
});

describe('helpers', () => {
  it('runBetween / beam / beamPath / rods', () => {
    expect(runBetween([0, 0, 0], [0, 0, 0])).toEqual([[0, 0, 0]]);
    expect(runBetween([2, 1, 0], [0, 1, 0])).toEqual([
      [2, 1, 0],
      [1, 1, 0],
      [0, 1, 0],
    ]);
    expect(() => runBetween([0, 0, 0], [1, 1, 0])).toThrow();
    expect(beam([0, 0, 0], [1, 0, 0])).toEqual([
      { x: 0, y: 0, z: 0, kind: 'pinHole', axis: 2 },
      { x: 1, y: 0, z: 0, kind: 'pinHole', axis: 2 },
    ]);
    expect(beamPath([[0, 1, 0], [0, 0, 0], [1, 0, 0]]).map((c) => [c.x, c.y])).toEqual([
      [0, 1],
      [0, 0],
      [1, 0],
    ]);
    expect(pin([0, 0, 0], [0, 0, 1]).map((c) => [c.kind, c.axis, c.z])).toEqual([
      ['pin', 2, 0],
      ['pin', 2, 1],
    ]);
    expect(axle([0, 0, 0], [0, 0, 0], 1)).toEqual([{ x: 0, y: 0, z: 0, kind: 'axle', axis: 1 }]);
    expect(() => axle([0, 0, 0], [0, 0, 0])).toThrow(/explicit axis/);
    expect(() => axle([0, 0, 0], [0, 0, 2], 0)).toThrow(/does not match/);
    expect(bush([1, 2, 3], 0)).toEqual([{ x: 1, y: 2, z: 3, kind: 'axleHole', axis: 0 }]);
  });
  it('ModelBuilder validates each part', () => {
    const b = new ModelBuilder();
    b.add(beam([0, 0, 0], [2, 0, 0]));
    expect(() => b.add(beam([0, 0, 0], [0, 2, 0]))).toThrow(); // overlaps hole-on-hole
  });
});

describe('pendulum', () => {
  it('2 bodies, 1 revolute at the beam end; link starts horizontal', () => {
    const { g } = graphOf('pendulum');
    expect(g.bodies).toEqual([
      { id: 0, partIds: [1, 3], fixed: true },
      { id: 1, partIds: [2], fixed: false },
    ]);
    expect(g.joints).toEqual([rev(0, 1, [0, 0, 1])]);
  });
});

describe('triple-pendulum', () => {
  it('4 bodies, 3 revolute, chained', () => {
    const { g } = graphOf('triple-pendulum');
    expect(g.bodies).toEqual([
      { id: 0, partIds: [1, 5], fixed: true },
      { id: 1, partIds: [2, 6], fixed: false },
      { id: 2, partIds: [3, 7], fixed: false },
      { id: 3, partIds: [4], fixed: false },
    ]);
    expect(g.joints).toEqual([rev(0, 1, [0, 0, 1]), rev(1, 2, [4, 0, 2]), rev(2, 3, [7, 0, 3])]);
  });
  it('links of 5, 4, 3 holes, each in its own layer (they can pass each other)', () => {
    const m = buildExample('triple-pendulum');
    const links = [2, 3, 4].map((id) => m.parts.find((p) => p.id === id)!);
    expect(links.map((p) => p.cells.length)).toEqual([5, 4, 3]);
    const layers = links.map((p) => new Set(p.cells.map((c) => c.z)));
    for (const l of layers) expect(l.size).toBe(1);
    const zs = layers.map((l) => [...l][0]);
    expect(new Set([0, ...zs]).size).toBe(4);
  });
});

/**
 * Generic planar four-bar check: ground body g, crank (jointed to ground, lower id), rocker (the
 * other one jointed to ground), coupler. Returns dV/dθ (crank angle) of gravity potential with
 * mass ∝ cell count, from loop closure, plus link lengths.
 */
function fourBarStatics(m: Model, g: KinematicGraph) {
  const ground = g.bodies.find((b) => b.fixed)!.id;
  const groundJoints = g.joints.filter((j) => j.bodyA === ground || j.bodyB === ground);
  expect(groundJoints.length).toBe(2);
  const other = (j: Joint, b: number) => (j.bodyA === b ? j.bodyB : j.bodyA);
  const crank = other(groundJoints[0]!, ground);
  const rocker = other(groundJoints[1]!, ground);
  const coupler = g.bodies.map((b) => b.id).find((id) => id !== ground && id !== crank && id !== rocker)!;
  const jointBetween = (a: number, b: number) =>
    g.joints.find((j) => (j.bodyA === a && j.bodyB === b) || (j.bodyA === b && j.bodyB === a))!;
  const xy = (j: Joint) => [j.origin[0], j.origin[1]] as [number, number];
  const O1 = xy(groundJoints[0]!);
  const O2 = xy(groundJoints[1]!);
  const B0 = xy(jointBetween(crank, coupler));
  const C0 = xy(jointBetween(coupler, rocker));
  const dist = (p: [number, number], q: [number, number]) => Math.hypot(p[0] - q[0], p[1] - q[1]);
  const lens = { crank: dist(O1, B0), coupler: dist(B0, C0), rocker: dist(C0, O2), ground: dist(O1, O2) };

  const cellsOf = (bodyId: number) =>
    g.bodies[bodyId]!.partIds.flatMap((pid) => m.parts.find((p) => p.id === pid)!.cells.map((c) => [c.x, c.y] as [number, number]));
  // rigid 2D transform taking (p0,q0) to (p,q)
  const frame = (p0: [number, number], q0: [number, number], p: [number, number], q: [number, number]) => {
    const a = Math.atan2(q[1] - p[1], q[0] - p[0]) - Math.atan2(q0[1] - p0[1], q0[0] - p0[0]);
    const [cs, sn] = [Math.cos(a), Math.sin(a)];
    return (v: [number, number]): [number, number] => {
      const dx = v[0] - p0[0];
      const dy = v[1] - p0[1];
      return [p[0] + cs * dx - sn * dy, p[1] + sn * dx + cs * dy];
    };
  };
  const theta0 = Math.atan2(B0[1] - O1[1], B0[0] - O1[0]);
  const potential = (theta: number) => {
    const B: [number, number] = [O1[0] + lens.crank * Math.cos(theta), O1[1] + lens.crank * Math.sin(theta)];
    // C: intersection of circle(B, coupler) and circle(O2, rocker), branch nearest C0
    const d = dist(B, O2);
    const a = (lens.coupler ** 2 - lens.rocker ** 2 + d * d) / (2 * d);
    const h = Math.sqrt(Math.max(0, lens.coupler ** 2 - a * a));
    const ex = [(O2[0] - B[0]) / d, (O2[1] - B[1]) / d];
    const base = [B[0] + a * ex[0]!, B[1] + a * ex[1]!];
    const cands: [number, number][] = [
      [base[0]! - h * ex[1]!, base[1]! + h * ex[0]!],
      [base[0]! + h * ex[1]!, base[1]! - h * ex[0]!],
    ];
    const C = cands.sort((u, v) => dist(u, C0) - dist(v, C0))[0]!;
    let V = 0;
    const add = (bodyId: number, T: (v: [number, number]) => [number, number]) => {
      for (const c of cellsOf(bodyId)) V += T(c)[1];
    };
    add(crank, frame(O1, B0, O1, B));
    add(coupler, frame(B0, C0, B, C));
    add(rocker, frame(O2, C0, O2, C));
    return V;
  };
  const hstep = 1e-4;
  const dV = (potential(theta0 + hstep) - potential(theta0 - hstep)) / (2 * hstep);
  return { lens, dV, crank, coupler, rocker };
}

describe('four-bar', () => {
  it('4 bodies, 4 revolute, exactly 1 fixed', () => {
    const { g } = graphOf('four-bar');
    expect(g.bodies).toEqual([
      { id: 0, partIds: [1, 5, 8], fixed: true },
      { id: 1, partIds: [2], fixed: false },
      { id: 2, partIds: [3, 6, 7], fixed: false },
      { id: 3, partIds: [4], fixed: false },
    ]);
    expect(g.joints).toEqual([rev(0, 1, [0, 0, 1]), rev(0, 3, [6, 0, 1]), rev(1, 2, [0, 2, 1]), rev(2, 3, [4, 2, 1])]);
  });
  it('is a genuine 1-DOF linkage, not a parallelogram, and not in static equilibrium at t=0', () => {
    const { m, g } = graphOf('four-bar');
    expect(planarDof(g)).toBe(1);
    const { lens, dV } = fourBarStatics(m, g);
    expect(lens.crank).toBeCloseTo(2);
    expect(lens.coupler).toBeCloseTo(4);
    expect(lens.rocker).toBeCloseTo(Math.SQRT2 * 2);
    expect(lens.ground).toBeCloseTo(6);
    expect(Math.abs(lens.crank - lens.rocker)).toBeGreaterThan(0.5);
    expect(Math.abs(lens.coupler - lens.ground)).toBeGreaterThan(0.5);
    // gravity has a substantial moment about the single DOF (units: cell·studs per radian)
    expect(Math.abs(dV)).toBeGreaterThan(5);
  });
  it('the rocker is L-shaped', () => {
    const rocker = buildExample('four-bar').parts.find((p) => p.id === 4)!;
    expect(new Set(rocker.cells.map((c) => c.x)).size).toBeGreaterThan(1);
    expect(new Set(rocker.cells.map((c) => c.y)).size).toBeGreaterThan(1);
  });
});

describe('parallelogram', () => {
  it('4 bodies, 4 revolute; opposite sides equal; 1 DOF; released out of equilibrium', () => {
    const { m, g } = graphOf('parallelogram');
    expect(g.bodies).toEqual([
      { id: 0, partIds: [1, 5, 6], fixed: true },
      { id: 1, partIds: [2, 7], fixed: false },
      { id: 2, partIds: [3, 8], fixed: false },
      { id: 3, partIds: [4], fixed: false },
    ]);
    expect(g.joints).toEqual([rev(0, 1, [0, 0, 1]), rev(0, 2, [3, 0, -1]), rev(1, 3, [2, -2, 0]), rev(2, 3, [5, -2, 0])]);
    expect(planarDof(g)).toBe(1);
    const { lens, dV } = fourBarStatics(m, g);
    expect(lens.crank).toBeCloseTo(lens.rocker);
    expect(lens.coupler).toBeCloseTo(lens.ground);
    expect(lens.crank).toBeCloseTo(2 * Math.SQRT2);
    expect(Math.abs(dV)).toBeGreaterThan(5);
  });
  it('the energy-reachable swing never reaches the change point (cranks parallel to the ground)', () => {
    // On the parallel branch the potential depends only on the crank angle φ from hanging
    // (V ∝ −cos φ), so released from rest at φ0 = 45° it stays in |φ| <= 45°. The change point is
    // where the crank is parallel to the (horizontal) ground: |φ| = 90°.
    const { g } = graphOf('parallelogram');
    const o = (a: number, b: number) => g.joints.find((j) => j.bodyA === a && j.bodyB === b)!.origin;
    const crank = [o(1, 3)[0] - o(0, 1)[0], o(1, 3)[1] - o(0, 1)[1]];
    const ground = [o(0, 2)[0] - o(0, 1)[0], o(0, 2)[1] - o(0, 1)[1]];
    expect(ground[1]).toBe(0); // horizontal ground
    const phi0 = Math.abs(Math.atan2(crank[0]!, -crank[1]!));
    expect(phi0).toBeCloseTo(Math.PI / 4);
    expect(Math.PI / 2 - phi0).toBeGreaterThan(0.5); // ~45° of margin
  });
  it('the two cranks are in different layers; ground and coupler share one but stay apart', () => {
    const m = buildExample('parallelogram');
    const z = (id: number) => new Set(m.parts.find((p) => p.id === id)!.cells.map((c) => c.z));
    expect([...z(2)]).toEqual([1]);
    expect([...z(3)]).toEqual([-1]);
    expect([...z(1)]).toEqual([0]);
    expect([...z(4)]).toEqual([0]);
    // coupler = ground translated by the crank vector (length 2√2, |φ| <= 45°): its height below
    // the ground is >= 2√2·cos45° = 2, far more than the 0.92 sum of hole collider radii.
    expect(2 * Math.SQRT2 * Math.cos(Math.PI / 4) - 2 * 0.46).toBeGreaterThan(1);
  });
});

describe('sliding-axle', () => {
  it('one axle slides with a 2-cell drop, the other only spins', () => {
    const { g } = graphOf('sliding-axle');
    expect(g.bodies).toEqual([
      { id: 0, partIds: [1], fixed: true },
      { id: 1, partIds: [2, 3], fixed: false },
      { id: 2, partIds: [4, 5, 6], fixed: false },
    ]);
    expect(g.joints).toEqual([
      { bodyA: 0, bodyB: 1, type: 'cylindrical', origin: [0, 0, 0], axis: 1, limits: [-2, 2] },
      rev(0, 2, [4, 1, 0], 2),
    ]);
  });
  it('each axle carries an off-centre arm; the spinning one is horizontal so gravity turns it', () => {
    const m = buildExample('sliding-axle');
    for (const id of [3, 5]) {
      const arm = m.parts.find((p) => p.id === id)!;
      expect(arm.cells.length).toBe(2);
      expect(arm.cells.every((c) => isHole(c.kind))).toBe(true);
    }
    const g = analyze(m);
    const spin = g.joints.find((j) => j.type === 'revolute')!;
    expect(spin.axis).not.toBe(1); // not parallel to gravity
    const arm = m.parts.find((p) => p.id === 5)!;
    const off = arm.cells.filter((c) => c.kind === 'pinHole')[0]!;
    expect(off.y).toBe(spin.origin[1]); // arm starts horizontal: maximal gravity moment
    expect(off.x).not.toBe(spin.origin[0]);
  });
});

describe('weld-test', () => {
  it('two pinned-twice beams form one body on one revolute', () => {
    const { g } = graphOf('weld-test');
    expect(g.bodies).toEqual([
      { id: 0, partIds: [1, 4], fixed: true },
      { id: 1, partIds: [2, 3, 5, 6], fixed: false },
    ]);
    expect(g.joints).toEqual([rev(0, 1, [0, 0, 1])]);
  });
});

describe('collision', () => {
  it('double pendulum + loose part', () => {
    const { g } = graphOf('collision');
    expect(g.bodies).toEqual([
      { id: 0, partIds: [1, 4], fixed: true },
      { id: 1, partIds: [2, 5], fixed: false },
      { id: 2, partIds: [3], fixed: false },
      { id: 3, partIds: [6], fixed: false },
    ]);
    expect(g.joints).toEqual([rev(0, 1, [0, 0, 1]), rev(1, 2, [3, 0, 2])]);
  });
  it('the peg is out of the upper link’s reach but in the lower link’s', () => {
    const m = buildExample('collision');
    const frame = m.parts.find((p) => p.id === 1)!;
    const peg = frame.cells.filter((c) => c.kind === 'axle');
    expect(peg.map((c) => c.z).sort()).toEqual([1, 2]);
    const pegXY = [peg[0]!.x, peg[0]!.y];
    const pegDist = Math.hypot(pegXY[0]!, pegXY[1]!); // from pivot (0,0)
    const reach = (id: number, from: [number, number]) =>
      Math.max(...m.parts.find((p) => p.id === id)!.cells.map((c) => Math.hypot(c.x - from[0], c.y - from[1])));
    // upper link (layer 1) + half a cell + peg radius stays clear of the peg
    expect(reach(2, [0, 0]) + 0.5 + 0.3).toBeLessThan(pegDist);
    // lower link (layer 2) reaches past the peg when hanging: |pivot→knee| + knee→tip
    expect(3 + reach(3, [3, 0])).toBeGreaterThan(pegDist + 0.5);
    const lower = m.parts.find((p) => p.id === 3)!;
    expect(lower.cells.every((c) => c.z === 2)).toBe(true);
  });
  it('the loose part starts above the frame, in the frame’s layer', () => {
    const m = buildExample('collision');
    const loose = m.parts.find((p) => p.id === 6)!;
    const frame = m.parts.find((p) => p.id === 1)!;
    for (const c of loose.cells) {
      const below = frame.cells.filter((f) => f.x === c.x && f.z === c.z && f.y < c.y);
      expect(below.length).toBeGreaterThan(0);
    }
  });
});
