import { describe, expect, it } from 'vitest';
import { EXAMPLES, axle, beam, bush, cell, frictionPin, holes, pin } from '../../src/core/examples';
import { analyze, describeGraph, findMates, lineKey, type Joint } from '../../src/core/kinematics';
import { setRoot, validateModel } from '../../src/core/model';
import type { Model } from '../../src/core/types';
import { mk, partition, plain, rng, shuffleModel } from './helpers';

function analyzeValid(m: Model) {
  expect(validateModel(m)).toEqual([]);
  return analyze(m);
}

/** Every joint's origin lies on the line of at least one mate between its two bodies, along its axis. */
function expectOriginsOnMateLines(m: Model) {
  const g = analyze(m);
  for (const j of g.joints) {
    const between = g.mates.filter((mt) => {
      const a = g.bodyOfPart.get(mt.malePart);
      const b = g.bodyOfPart.get(mt.holePart);
      return (a === j.bodyA && b === j.bodyB) || (a === j.bodyB && b === j.bodyA);
    });
    expect(between.length).toBeGreaterThan(0);
    expect(between.some((mt) => mt.pos.every((v, i) => v === j.origin[i]))).toBe(true);
    expect(between.every((mt) => mt.axis === j.axis)).toBe(true);
    if (j.type !== 'prismatic') {
      expect(between.every((mt) => lineKey(mt.pos, mt.axis) === lineKey(j.origin, j.axis))).toBe(true);
    }
  }
}

const rev = (bodyA: number, bodyB: number, origin: [number, number, number], axis: 0 | 1 | 2 = 2): Joint => ({
  bodyA,
  bodyB,
  type: 'revolute',
  origin,
  axis,
});

// ---------------------------------------------------------------------------------------------

describe('findMates', () => {
  it('lists every male+hole position with its type, sorted by position', () => {
    const m = mk([
      [cell([0, 0, 0], 'axleHole', 2), ...beam([1, 0, 0], [2, 0, 0])], // 1
      beam([0, 0, 1], [2, 0, 1]), // 2
      axle([0, 0, 0], [0, 0, 1]), // 3: weld in 1, cylindrical in 2
      frictionPin([2, 0, 0], [2, 0, 1]), // 4: welds
      pin([1, 0, 1], [1, 0, 2]), // 5: revolute in 2, free end
    ]);
    expect(validateModel(m)).toEqual([]);
    expect(findMates(m)).toEqual([
      { pos: [0, 0, 0], axis: 2, malePart: 3, holePart: 1, type: 'weld' },
      { pos: [0, 0, 1], axis: 2, malePart: 3, holePart: 2, type: 'cylindrical' },
      { pos: [1, 0, 1], axis: 2, malePart: 5, holePart: 2, type: 'revolute' },
      { pos: [2, 0, 0], axis: 2, malePart: 4, holePart: 1, type: 'weld' },
      { pos: [2, 0, 1], axis: 2, malePart: 4, holePart: 2, type: 'weld' },
    ]);
  });

  it('empty model → empty graph', () => {
    const g = analyze({ version: 1, parts: [], rootPartId: null, nextPartId: 1 });
    expect(plain(g)).toEqual({ mates: [], bodies: [], joints: [], bodyOfPart: [] });
    expect(describeGraph(g)).toBe('0 bodies · no joints');
  });
});

describe('§3.3 required cases', () => {
  it('two liftarms + one 2-long smooth pin → 2 bodies, 1 revolute, pin absorbed', () => {
    const m = mk([beam([0, 0, 0], [2, 0, 0]), beam([0, 0, 1], [2, 0, 1]), pin([0, 0, 0], [0, 0, 1])]);
    const g = analyzeValid(m);
    expect(g.bodies).toEqual([
      { id: 0, partIds: [1, 3], fixed: true },
      { id: 1, partIds: [2], fixed: false },
    ]);
    expect(g.joints).toEqual([rev(0, 1, [0, 0, 1])]);
    expect(g.joints[0]).not.toHaveProperty('limits');
    expect([...g.bodyOfPart]).toEqual([
      [1, 0],
      [2, 1],
      [3, 0],
    ]);
  });

  it('two liftarms + two smooth pins at different holes → 1 body, 0 joints', () => {
    const m = mk([
      beam([0, 0, 0], [2, 0, 0]),
      beam([0, 0, 1], [2, 0, 1]),
      pin([0, 0, 0], [0, 0, 1]),
      pin([2, 0, 0], [2, 0, 1]),
    ]);
    const g = analyzeValid(m);
    expect(g.bodies).toEqual([{ id: 0, partIds: [1, 2, 3, 4], fixed: true }]);
    expect(g.joints).toEqual([]);
  });

  it('two liftarms + one friction pin → 1 body (welded)', () => {
    const m = mk([beam([0, 0, 0], [2, 0, 0]), beam([0, 0, 1], [2, 0, 1]), frictionPin([0, 0, 0], [0, 0, 1])]);
    const g = analyzeValid(m);
    expect(g.mates.map((x) => x.type)).toEqual(['weld', 'weld']);
    expect(g.bodies).toEqual([{ id: 0, partIds: [1, 2, 3], fixed: true }]);
    expect(g.joints).toEqual([]);
  });

  it('triple pendulum → 4 bodies, 3 revolute', () => {
    const g = analyzeValid(EXAMPLES.find((e) => e.name === 'triple-pendulum')!.build());
    expect(g.bodies.length).toBe(4);
    expect(g.joints.map((j) => j.type)).toEqual(['revolute', 'revolute', 'revolute']);
  });

  it('four-bar → 4 bodies, 4 revolute, exactly 1 fixed', () => {
    const g = analyzeValid(EXAMPLES.find((e) => e.name === 'four-bar')!.build());
    expect(g.bodies.length).toBe(4);
    expect(g.bodies.filter((b) => b.fixed).length).toBe(1);
    expect(g.joints.map((j) => j.type)).toEqual(['revolute', 'revolute', 'revolute', 'revolute']);
  });

  describe('axle through one pinHole, nothing else → cylindrical, limits by engagement', () => {
    it('beam first (beam = body A): limits are the axle’s displacement', () => {
      // axle z = −1..2 through the hole at z = 0: it can move +1 or −2 and stay engaged
      const m = mk([beam([0, 0, 0], [2, 0, 0]), axle([0, 0, -1], [0, 0, 2])]);
      const g = analyzeValid(m);
      expect(partition(g)).toEqual([[1], [2]]);
      expect(g.joints).toEqual([{ bodyA: 0, bodyB: 1, type: 'cylindrical', origin: [0, 0, 0], axis: 2, limits: [-2, 1] }]);
    });
    it('axle first (axle = body A): limits are the beam’s displacement (sign flips)', () => {
      const m = mk([axle([0, 0, -1], [0, 0, 2]), beam([0, 0, 0], [2, 0, 0])]);
      const g = analyzeValid(m);
      expect(g.bodies[0]).toEqual({ id: 0, partIds: [1], fixed: true });
      expect(g.joints).toEqual([{ bodyA: 0, bodyB: 1, type: 'cylindrical', origin: [0, 0, 0], axis: 2, limits: [-1, 2] }]);
    });
    it('along X and Y too', () => {
      const mx = mk([beam([0, 0, 0], [0, 2, 0], 0), axle([-3, 0, 0], [1, 0, 0])]);
      expect(analyzeValid(mx).joints).toEqual([
        { bodyA: 0, bodyB: 1, type: 'cylindrical', origin: [0, 0, 0], axis: 0, limits: [-1, 3] },
      ]);
      const my = mk([beam([0, 0, 0], [2, 0, 0], 1), axle([0, 0, 0], [0, 4, 0])]);
      expect(analyzeValid(my).joints).toEqual([
        { bodyA: 0, bodyB: 1, type: 'cylindrical', origin: [0, 0, 0], axis: 1, limits: [-4, 0] },
      ]);
    });
    it('a 1-long axle in a 1-hole beam cannot slide either way → revolute', () => {
      const m = mk([beam([0, 0, 0], [0, 0, 0]), axle([0, 0, 0], [0, 0, 0], 2)]);
      expect(analyzeValid(m).joints).toEqual([rev(0, 1, [0, 0, 0])]);
    });
  });

  describe('bush welded on the axle touching one side → one limit is 0', () => {
    it('bush above (+Z side), beam first', () => {
      const m = mk([beam([0, 0, 0], [2, 0, 0]), axle([0, 0, -2], [0, 0, 2]), bush([0, 0, 1], 2)]);
      const g = analyzeValid(m);
      expect(partition(g)).toEqual([[1], [2, 3]]);
      expect(g.joints).toEqual([{ bodyA: 0, bodyB: 1, type: 'cylindrical', origin: [0, 0, 0], axis: 2, limits: [0, 2] }]);
    });
    it('bush below (−Z side), beam first', () => {
      const m = mk([beam([0, 0, 0], [2, 0, 0]), axle([0, 0, -2], [0, 0, 2]), bush([0, 0, -1], 2)]);
      expect(analyzeValid(m).joints[0]!.limits).toEqual([-2, 0]);
    });
    it('bush above, axle body first: beam may only move down', () => {
      const m = mk([axle([0, 0, -2], [0, 0, 2]), bush([0, 0, 1], 2), beam([0, 0, 0], [2, 0, 0])]);
      const g = analyzeValid(m);
      expect(partition(g)).toEqual([[1, 2], [3]]);
      expect(g.joints).toEqual([{ bodyA: 0, bodyB: 1, type: 'cylindrical', origin: [0, 0, 0], axis: 2, limits: [-2, 0] }]);
    });
  });

  it('bushes touching both sides → revolute', () => {
    const m = mk([beam([0, 0, 0], [2, 0, 0]), axle([0, 0, -2], [0, 0, 2]), bush([0, 0, 1], 2), bush([0, 0, -1], 2)]);
    const g = analyzeValid(m);
    expect(partition(g)).toEqual([[1], [2, 3, 4]]);
    expect(g.joints).toEqual([rev(0, 1, [0, 0, 0])]);
  });

  describe('axle through axleHole of one liftarm and pinHole of another', () => {
    const arm1 = [cell([0, 0, 0], 'axleHole', 2), ...beam([1, 0, 0], [2, 0, 0])];
    it('2-long axle: welded to the first, no room to slide → revolute', () => {
      const m = mk([arm1, beam([0, 0, 1], [2, 0, 1]), axle([0, 0, 0], [0, 0, 1])]);
      const g = analyzeValid(m);
      expect(partition(g)).toEqual([[1, 3], [2]]);
      expect(g.joints).toEqual([rev(0, 1, [0, 0, 1])]);
    });
    it('longer axle: the second liftarm can slide off upward → cylindrical [0, 2]', () => {
      const m = mk([arm1, beam([0, 0, 1], [2, 0, 1]), axle([0, 0, 0], [0, 0, 3])]);
      const g = analyzeValid(m);
      expect(partition(g)).toEqual([[1, 3], [2]]);
      expect(g.joints).toEqual([{ bodyA: 0, bodyB: 1, type: 'cylindrical', origin: [0, 0, 1], axis: 2, limits: [0, 2] }]);
    });
    it('gap between the liftarms: slides both ways → cylindrical [−1, 1]', () => {
      const m = mk([arm1, beam([0, 0, 2], [2, 0, 2]), axle([0, 0, 0], [0, 0, 3])]);
      expect(analyzeValid(m).joints[0]).toEqual({
        bodyA: 0,
        bodyB: 1,
        type: 'cylindrical',
        origin: [0, 0, 2],
        axis: 2,
        limits: [-1, 1],
      });
    });
  });

  describe('two parallel axles through pinHoles of the same two bodies → prismatic', () => {
    // body A: liftarm of pin holes at z = 2. body B: liftarm of axle holes at z = 0 + two axles.
    const build = (axleTop: number, secondTop = axleTop, beamZ = 2) =>
      mk([
        beam([0, 0, beamZ], [2, 0, beamZ]),
        holes([0, 0, 0], [2, 0, 0], 2, 'axleHole'),
        axle([0, 0, 0], [0, 0, axleTop]),
        axle([2, 0, 0], [2, 0, secondTop]),
      ]);
    it('limits by engagement and by the holes colliding', () => {
      const g = analyzeValid(build(3));
      expect(partition(g)).toEqual([[1], [2, 3, 4]]);
      expect(g.joints).toEqual([{ bodyA: 0, bodyB: 1, type: 'prismatic', origin: [0, 0, 2], axis: 2, limits: [-1, 1] }]);
    });
    it('longer axles → longer travel', () => {
      expect(analyzeValid(build(4)).joints[0]!.limits).toEqual([-2, 1]);
    });
    it('both lines must stay engaged (shorter second axle)', () => {
      expect(analyzeValid(build(3, 2)).joints[0]!.limits).toEqual([0, 1]);
    });
    it('no room either way → [0,0] → rigid (one body)', () => {
      const g = analyzeValid(build(1, 1, 1));
      expect(partition(g)).toEqual([[1, 2, 3, 4]]);
      expect(g.joints).toEqual([]);
    });
    it('reversed body order flips the limits', () => {
      const m = mk([
        holes([0, 0, 0], [2, 0, 0], 2, 'axleHole'),
        axle([0, 0, 0], [0, 0, 4]),
        axle([2, 0, 0], [2, 0, 4]),
        beam([0, 0, 2], [2, 0, 2]),
      ]);
      expect(analyzeValid(m).joints).toEqual([
        { bodyA: 0, bodyB: 1, type: 'prismatic', origin: [0, 0, 2], axis: 2, limits: [-1, 2] },
      ]);
    });
    it('an off-line obstacle counts for prismatic (no rotation possible)', () => {
      // A also has a hole at (1,0,1), between the two axle lines: B's middle axle hole hits it at +1.
      const m = mk([
        [...beam([0, 0, 2], [2, 0, 2]), cell([1, 0, 1], 'pinHole', 2)],
        holes([0, 0, 0], [2, 0, 0], 2, 'axleHole'),
        axle([0, 0, 0], [0, 0, 5]),
        axle([2, 0, 0], [2, 0, 5]),
      ]);
      expect(analyzeValid(m).joints).toEqual([
        { bodyA: 0, bodyB: 1, type: 'prismatic', origin: [0, 0, 2], axis: 2, limits: [-3, 0] },
      ]);
      // control: without it, up by 1 is fine (the beams collide at +2)
      const m0 = mk([
        beam([0, 0, 2], [2, 0, 2]),
        holes([0, 0, 0], [2, 0, 0], 2, 'axleHole'),
        axle([0, 0, 0], [0, 0, 5]),
        axle([2, 0, 0], [2, 0, 5]),
      ]);
      expect(analyzeValid(m0).joints[0]!.limits).toEqual([-3, 1]);
    });
  });

  describe('two perpendicular mates between the same pair → 1 body', () => {
    it('two pins, one along Z and one along Y', () => {
      const m = mk([
        [cell([0, 0, 0], 'pinHole', 2), cell([1, 0, 0], 'pinHole', 1)], // A
        [cell([0, 0, 1], 'pinHole', 2), cell([0, 1, 1], 'pinHole', 2), cell([1, 1, 1], 'pinHole', 2), cell([1, 1, 0], 'pinHole', 1)], // B
        pin([0, 0, 0], [0, 0, 1]),
        pin([1, 0, 0], [1, 1, 0]),
      ]);
      const g = analyzeValid(m);
      expect(partition(g)).toEqual([[1, 2, 3, 4]]);
      expect(g.joints).toEqual([]);
    });
    it('two axles (cylindrical), one along Z and one along X', () => {
      const m = mk([
        [cell([0, 0, 0], 'pinHole', 2), cell([1, 0, 0], 'pinHole', 2), cell([1, 1, 0], 'pinHole', 0)], // A
        [cell([0, 0, 1], 'axleHole', 2), cell([0, 1, 1], 'pinHole', 2), cell([0, 1, 0], 'axleHole', 0)], // B
        axle([0, 0, 0], [0, 0, 1]),
        axle([0, 1, 0], [1, 1, 0]),
      ]);
      const g = analyzeValid(m);
      expect(partition(g)).toEqual([[1, 2, 3, 4]]);
    });
  });
});

describe('pin absorption', () => {
  it('3-long pin through three beams → 3 bodies, 2 revolute (pin absorbed into the root body)', () => {
    const m = mk([beam([0, 0, 0], [2, 0, 0]), beam([0, 0, 1], [2, 0, 1]), beam([0, 0, 2], [2, 0, 2]), pin([0, 0, 0], [0, 0, 2])]);
    const g = analyzeValid(m);
    expect(partition(g)).toEqual([[1, 4], [2], [3]]);
    expect(g.joints).toEqual([rev(0, 1, [0, 0, 1]), rev(0, 2, [0, 0, 2])]);
  });

  it('same with the middle beam as root → pin joins the middle body', () => {
    const base = mk([beam([0, 0, 0], [2, 0, 0]), beam([0, 0, 1], [2, 0, 1]), beam([0, 0, 2], [2, 0, 2]), pin([0, 0, 0], [0, 0, 2])]);
    const g = analyzeValid(setRoot(base, 2));
    expect(g.bodies).toEqual([
      { id: 0, partIds: [1], fixed: false },
      { id: 1, partIds: [2, 4], fixed: true },
      { id: 2, partIds: [3], fixed: false },
    ]);
    expect(g.joints).toEqual([rev(0, 1, [0, 0, 0]), rev(1, 2, [0, 0, 2])]);
  });

  it('no root among the candidates → the body with most cells', () => {
    const m = mk([
      beam([10, 0, 0], [10, 0, 0]), // 1: root, unrelated
      beam([0, 0, 0], [2, 0, 0]), // 2: 3 cells
      beam([0, 0, 1], [4, 0, 1]), // 3: 5 cells
      pin([0, 0, 0], [0, 0, 1]), // 4
    ]);
    const g = analyzeValid(m);
    expect(partition(g)).toEqual([[1], [2], [3, 4]]);
    expect(g.joints).toEqual([rev(1, 2, [0, 0, 0])]);
  });

  it('cell counts are whole-body counts after welding', () => {
    const m = mk([
      beam([10, 0, 0], [10, 0, 0]), // 1: root, unrelated
      beam([0, 0, 0], [4, 0, 0]), // 2: 5 cells alone
      beam([0, 0, 1], [2, 0, 1]), // 3: 3 cells …
      beam([0, 0, 2], [2, 0, 2]), // 4: … welded to 3 cells by
      frictionPin([2, 0, 1], [2, 0, 2]), // 5: … 2 more = 8 cells
      pin([0, 0, 0], [0, 0, 1]), // 6: between 2 and the welded 3+4+5
    ]);
    const g = analyzeValid(m);
    expect(partition(g)).toEqual([[1], [2], [3, 4, 5, 6]]);
  });

  it('tie in cell count → lowest part id', () => {
    const m = mk([beam([10, 0, 0], [10, 0, 0]), beam([0, 0, 0], [2, 0, 0]), beam([0, 0, 1], [2, 0, 1]), pin([0, 0, 0], [0, 0, 1])]);
    expect(partition(analyzeValid(m))).toEqual([[1], [2, 4], [3]]);
  });

  it('root is the pin itself → not absorbed: it stays fixed and each beam turns on it', () => {
    const m = mk([pin([0, 0, 0], [0, 0, 1]), beam([0, 0, 0], [2, 0, 0]), beam([0, 0, 1], [2, 0, 1])]);
    const g = analyzeValid(m);
    expect(g.bodies).toEqual([
      { id: 0, partIds: [1], fixed: true },
      { id: 1, partIds: [2], fixed: false },
      { id: 2, partIds: [3], fixed: false },
    ]);
    // no beam–beam joint: it would be implied by the two joints to the pin (redundant)
    expect(g.joints).toEqual([rev(0, 1, [0, 0, 0]), rev(0, 2, [0, 0, 1])]);
  });

  it('root pin in a single beam → the beam turns on it', () => {
    const g = analyzeValid(mk([pin([0, 0, 0], [0, 0, 1]), beam([0, 0, 0], [4, 0, 0])]));
    expect(partition(g)).toEqual([[1], [2]]);
    expect(g.joints).toEqual([rev(0, 1, [0, 0, 0])]);
  });

  it('root pin through two beams that share a second pin → the beams weld and turn as one', () => {
    const m = mk([
      pin([0, 0, 0], [0, 0, 1]), // 1 root pin
      beam([0, 0, 0], [2, 0, 0]), // 2
      beam([0, 0, 1], [2, 0, 1]), // 3
      pin([2, 0, 0], [2, 0, 1]), // 4
    ]);
    const g = analyzeValid(m);
    expect(partition(g)).toEqual([[1], [2, 3, 4]]);
    expect(g.joints).toEqual([rev(0, 1, [0, 0, 0])]);
  });

  it('pin with a free end behaves like a 2-long pin', () => {
    const m = mk([beam([0, 0, 0], [2, 0, 0]), beam([0, 0, 1], [2, 0, 1]), pin([0, 0, 0], [0, 0, 2])]);
    const g = analyzeValid(m);
    expect(partition(g)).toEqual([[1, 3], [2]]);
    expect(g.joints).toEqual([rev(0, 1, [0, 0, 1])]);
  });

  it('pin in a single beam with both ends free is absorbed into it', () => {
    const m = mk([beam([0, 0, 0], [2, 0, 0]), pin([1, 0, -1], [1, 0, 1])]);
    expect(partition(analyzeValid(m))).toEqual([[1, 2]]);
  });

  it('a loose pin with no mates stays its own (free) body', () => {
    const m = mk([beam([0, 0, 0], [2, 0, 0]), pin([5, 0, 0], [5, 0, 1])]);
    const g = analyzeValid(m);
    expect(g.bodies).toEqual([
      { id: 0, partIds: [1], fixed: true },
      { id: 1, partIds: [2], fixed: false },
    ]);
    expect(g.joints).toEqual([]);
  });

  it('axle-pin with its axle end in an axle hole: welded there, revolute in the other liftarm', () => {
    const m = mk([
      [cell([0, 0, 0], 'axleHole', 2), cell([1, 0, 0], 'pinHole', 2)],
      beam([0, 0, 1], [1, 0, 1]),
      [cell([0, 0, 0], 'axle', 2), cell([0, 0, 1], 'pin', 2)],
    ]);
    const g = analyzeValid(m);
    expect(partition(g)).toEqual([[1, 3], [2]]);
    expect(g.joints).toEqual([rev(0, 1, [0, 0, 1])]);
  });

  it('axle-pin with its axle end in a pin hole is not absorbed (cylindrical mate) → 3 bodies', () => {
    const m = mk([beam([0, 0, 0], [1, 0, 0]), beam([0, 0, 1], [1, 0, 1]), [cell([0, 0, 0], 'axle', 2), cell([0, 0, 1], 'pin', 2)]]);
    const g = analyzeValid(m);
    expect(partition(g)).toEqual([[1], [2], [3]]);
    // 1–3: axle in pin hole; the pin cell blocks sliding down, disengagement blocks sliding up → revolute
    expect(g.joints).toEqual([rev(0, 2, [0, 0, 0]), rev(1, 2, [0, 0, 1])]);
  });

  it('axle-pin with a longer axle can slide (together with the pinned liftarm) in the first one', () => {
    const m = mk([
      beam([0, 0, 0], [1, 0, 0]),
      beam([0, 0, 1], [1, 0, 1]),
      [cell([0, 0, -1], 'axle', 2), cell([0, 0, 0], 'axle', 2), cell([0, 0, 1], 'pin', 2)],
    ]);
    const g = analyzeValid(m);
    expect(g.joints).toEqual([
      { bodyA: 0, bodyB: 2, type: 'cylindrical', origin: [0, 0, 0], axis: 2, limits: [0, 1] },
      rev(1, 2, [0, 0, 1]),
    ]);
  });
});

describe('fixpoint', () => {
  it('absorbing pins makes a two-line pair, which welds (§3.3 case 2 is the minimal form)', () => {
    const m = mk([beam([0, 0, 0], [4, 0, 0]), beam([0, 0, 1], [4, 0, 1]), pin([0, 0, 0], [0, 0, 1]), pin([4, 0, 0], [4, 0, 1])]);
    expect(partition(analyzeValid(m))).toEqual([[1, 2, 3, 4]]);
  });

  it('a weld from pairwise reduction turns two single-line pairs into one two-line pair (cascade)', () => {
    // A–B: two pins → rigid. C is pinned once to B (x=1) and once to A (x=3, a 3-long pin through
    // all three). Only after A and B merge does C have two lines to the same body.
    const m = mk([
      beam([0, 0, 0], [4, 0, 0]), // 1 A
      beam([0, 0, 1], [4, 0, 1]), // 2 B
      beam([0, 0, 2], [4, 0, 2]), // 3 C
      pin([0, 0, 0], [0, 0, 1]), // 4 A–B
      pin([4, 0, 0], [4, 0, 1]), // 5 A–B
      pin([1, 0, 1], [1, 0, 2]), // 6 B–C
      pin([3, 0, 0], [3, 0, 2]), // 7 A–B–C
    ]);
    const g = analyzeValid(m);
    expect(partition(g)).toEqual([[1, 2, 3, 4, 5, 6, 7]]);
    expect(g.joints).toEqual([]);
  });

  it('cascade over several passes (each weld enables the next)', () => {
    // A (z=0) and C (z=2) are long; B and D sit in layer 1 at either end, between them.
    // A–B two lines → pass 1 weld. C has one line to B (x=3) and one to A (x=7) → pass 2 weld.
    // D has one line to C (x=11) and one to A (x=12) → pass 3 weld.
    const m = mk([
      beam([0, 0, 0], [15, 0, 0]), // 1 A (root)
      beam([0, 0, 1], [5, 0, 1]), // 2 B
      beam([0, 0, 2], [15, 0, 2]), // 3 C
      beam([10, 0, 1], [15, 0, 1]), // 4 D
      pin([0, 0, 0], [0, 0, 1]), // A–B
      pin([1, 0, 0], [1, 0, 1]), // A–B
      pin([3, 0, 1], [3, 0, 2]), // B–C
      pin([7, 0, 0], [7, 0, 2]), // A–C (middle cell in empty space)
      pin([11, 0, 1], [11, 0, 2]), // D–C
      pin([12, 0, 0], [12, 0, 1]), // D–A
    ]);
    const g = analyzeValid(m);
    expect(partition(g)).toEqual([[1, 2, 3, 4, 5, 6, 7, 8, 9, 10]]);
    expect(g.joints).toEqual([]);
    // control: drop D–A and D stays revolute on C
    const m2 = mk(m.parts.filter((p) => p.id !== 10).map((p) => p.cells));
    const g2 = analyzeValid(m2);
    expect(partition(g2)).toEqual([[1, 2, 3, 5, 6, 7, 8, 9], [4]]);
    expect(g2.joints).toEqual([rev(0, 1, [11, 0, 1])]);
  });

  it('without the second line the chain stays jointed (control)', () => {
    const m = mk([
      beam([0, 0, 0], [5, 0, 0]),
      beam([0, 0, 1], [5, 0, 1]),
      beam([0, 0, 2], [5, 0, 2]),
      pin([0, 0, 0], [0, 0, 2]),
      pin([2, 0, 0], [2, 0, 1]),
    ]);
    const g = analyzeValid(m);
    expect(partition(g)).toEqual([[1, 2, 4, 5], [3]]);
    expect(g.joints).toEqual([rev(0, 1, [0, 0, 2])]);
  });

  it('parallel lines mixing revolute and cylindrical → rigid', () => {
    const m = mk([
      beam([0, 0, 0], [2, 0, 0]),
      beam([0, 0, 1], [2, 0, 1]),
      pin([0, 0, 0], [0, 0, 1]),
      axle([2, 0, -1], [2, 0, 2]),
    ]);
    // control: a free axle is its own body; pairs 1–axle and 2–axle are single-line cylindrical
    // and 1–2 is a single revolute line (pin). Nothing welds.
    const g = analyzeValid(m);
    expect(partition(g)).toEqual([[1, 3], [2], [4]]);
    // now weld the axle to beam 2 through an axle hole: 1–(2+axle) has a pin line and an axle line
    const m2 = mk([
      beam([0, 0, 0], [2, 0, 0]),
      [...beam([0, 0, 1], [1, 0, 1]), cell([2, 0, 1], 'axleHole', 2)],
      pin([0, 0, 0], [0, 0, 1]),
      axle([2, 0, -1], [2, 0, 2]),
    ]);
    const g2 = analyzeValid(m2);
    expect(partition(g2)).toEqual([[1, 2, 3, 4]]);
  });
});

describe('cylindrical slide limits (§3.2)', () => {
  for (const reversed of [false, true]) {
    describe(reversed ? 'axle body first (beam = B)' : 'beam first (axle = B)', () => {
      const build = (stops: number[]) => {
        const beamCells = beam([0, 0, 0], [2, 0, 0]);
        const axleParts = [axle([0, 0, -5], [0, 0, 5]), ...stops.map((z) => bush([0, 0, z], 2))];
        return mk(reversed ? [...axleParts, beamCells] : [beamCells, ...axleParts]);
      };
      // limits as displacement of the axle relative to the beam; flipped when the beam is B.
      const expectLimits = (stops: number[], axleLimits: [number, number] | null) => {
        const g = analyzeValid(build(stops));
        expect(g.bodies.length).toBe(2);
        expect(g.joints.length).toBe(1);
        const j = g.joints[0]!;
        if (axleLimits === null) {
          expect(j.type).toBe('revolute');
          expect(j).not.toHaveProperty('limits');
        } else {
          expect(j.type).toBe('cylindrical');
          const want: [number, number] = reversed ? [0 - axleLimits[1] || 0, 0 - axleLimits[0] || 0] : axleLimits;
          expect(j.limits).toEqual(want);
        }
      };
      it('no bushes: engagement only', () => expectLimits([], [-5, 5]));
      for (const d of [1, 2, 3]) {
        it(`bush at distance ${d} above`, () => expectLimits([d], [1 - d, 5]));
        it(`bush at distance ${d} below`, () => expectLimits([-d], [-5, d - 1]));
      }
      for (const d1 of [1, 2, 3]) {
        for (const d2 of [1, 2, 3]) {
          it(`bushes at ${d1} above and ${d2} below`, () =>
            expectLimits([d1, -d2], d1 === 1 && d2 === 1 ? null : [1 - d1, d2 - 1]));
        }
      }
    });
  }

  describe('obstacles on and off the line', () => {
    // A: pin hole at (0,0,0) plus a hook (1,0,0..3) ending in a cell at (0,0,3) on the axle line.
    const withEnd = (kind: 'axleHole' | 'pinHole', axis: 0 | 1 | 2) =>
      mk([
        [cell([0, 0, 0], 'pinHole', 2), ...beam([1, 0, 0], [1, 0, 3], 0), cell([0, 0, 3], kind, axis)],
        axle([0, 0, -1], [0, 0, 1]),
      ]);
    it('an unengaged coaxial axle hole on the line blocks', () => {
      expect(analyzeValid(withEnd('axleHole', 2)).joints[0]).toEqual({
        bodyA: 0,
        bodyB: 1,
        type: 'cylindrical',
        origin: [0, 0, 0],
        axis: 2,
        limits: [-1, 1],
      });
    });
    it('a perpendicular hole on the line blocks', () => {
      expect(analyzeValid(withEnd('pinHole', 0)).joints[0]!.limits).toEqual([-1, 1]);
    });
    it('a coaxial pin hole on the line does not block (the axle can pass into it)', () => {
      expect(analyzeValid(withEnd('pinHole', 2)).joints[0]!.limits).toEqual([-1, 4]);
    });
    it('cells off the line do not count (rotation-invariant)', () => {
      // the hook cells at x=1 are right beside the axle path: no effect
      const m = mk([[cell([0, 0, 0], 'pinHole', 2), ...beam([1, 0, 0], [1, 0, 3], 0)], axle([0, 0, -1], [0, 0, 1])]);
      expect(analyzeValid(m).joints[0]!.limits).toEqual([-1, 1]);
    });
    it('the axle body’s own off-line cells do not count either', () => {
      // a 2-hole arm welded on the axle at z=2 overhangs the beam's second hole column
      const m = mk([
        beam([0, 0, 0], [1, 0, 0]),
        axle([0, 0, -1], [0, 0, 2]),
        [cell([0, 0, 2], 'axleHole', 2), cell([1, 0, 2], 'pinHole', 2)],
      ]);
      // on the line, only the bush at z=2 matters: down by 1 is fine, down by 2 puts it in the beam
      expect(analyzeValid(m).joints[0]!.limits).toEqual([-1, 1]);
    });
    it('two coaxial pin holes of the same body engaged at once', () => {
      // tube of two coaxial holes; axle z = −1..2
      const m = mk([beam([0, 0, 0], [0, 0, 1], 2), axle([0, 0, -1], [0, 0, 2])]);
      expect(analyzeValid(m).joints[0]!.limits).toEqual([-2, 2]);
    });
  });
});

describe('joint geometry', () => {
  it('origins lie on mate lines for all examples and test models', () => {
    for (const e of EXAMPLES) expectOriginsOnMateLines(e.build());
    expectOriginsOnMateLines(mk([beam([0, 0, 0], [0, 2, 0], 0), axle([-3, 2, 0], [1, 2, 0])]));
  });
});

describe('determinism', () => {
  const extra: Model[] = [
    mk([beam([0, 0, 0], [2, 0, 0]), beam([0, 0, 1], [2, 0, 1]), beam([0, 0, 2], [2, 0, 2]), pin([0, 0, 0], [0, 0, 2])]),
    mk([beam([10, 0, 0], [10, 0, 0]), beam([0, 0, 0], [2, 0, 0]), beam([0, 0, 1], [2, 0, 1]), pin([0, 0, 0], [0, 0, 1])]),
    mk([
      beam([0, 0, 2], [2, 0, 2]),
      holes([0, 0, 0], [2, 0, 0], 2, 'axleHole'),
      axle([0, 0, 0], [0, 0, 4]),
      axle([2, 0, 0], [2, 0, 4]),
    ]),
    mk([
      beam([0, 0, 0], [4, 0, 0]),
      beam([0, 0, 1], [4, 0, 1]),
      beam([0, 0, 2], [4, 0, 2]),
      pin([0, 0, 0], [0, 0, 1]),
      pin([4, 0, 0], [4, 0, 1]),
      pin([1, 0, 1], [1, 0, 2]),
      pin([3, 0, 0], [3, 0, 2]),
    ]),
  ];
  const models: [string, Model][] = [
    ...EXAMPLES.map((e) => [e.name, e.build()] as [string, Model]),
    ...extra.map((m, i) => [`extra ${i}`, m] as [string, Model]),
  ];
  for (const [name, m] of models) {
    it(`${name}: shuffling parts and cells gives an identical graph`, () => {
      const ref = plain(analyze(m));
      const r = rng(name.length * 7919 + 17);
      for (let i = 0; i < 25; i++) {
        const sm = shuffleModel(m, r);
        expect(validateModel(sm)).toEqual([]);
        expect(plain(analyze(sm))).toEqual(ref);
      }
    });
  }
  it('repeated calls give equal results and do not mutate the model', () => {
    const m = EXAMPLES[2]!.build();
    const snapshot = JSON.stringify(m);
    expect(plain(analyze(m))).toEqual(plain(analyze(m)));
    expect(JSON.stringify(m)).toBe(snapshot);
  });
});

describe('describeGraph', () => {
  it('compact summary', () => {
    const g = analyze(EXAMPLES.find((e) => e.name === 'sliding-axle')!.build());
    expect(describeGraph(g)).toBe('3 bodies (1 fixed) · 2 joints: 1 revolute, 1 cylindrical');
    expect(describeGraph(analyze(mk([beam([0, 0, 0], [1, 0, 0])])))).toBe('1 body (1 fixed) · no joints');
  });
  it('detail lists bodies and joints', () => {
    const g = analyze(EXAMPLES.find((e) => e.name === 'sliding-axle')!.build());
    expect(describeGraph(g, { detail: true })).toBe(
      [
        '3 bodies (1 fixed) · 2 joints: 1 revolute, 1 cylindrical',
        'body 0 fixed: part 1',
        'body 1: parts 2, 3',
        'body 2: parts 4, 5, 6',
        'joint 0–1 cylindrical ∥ Y through (0, 0, 0), slide [-2, +2]',
        'joint 0–2 revolute ∥ Z through (4, 1, 0)',
      ].join('\n'),
    );
  });
  it('prismatic and singular joint', () => {
    const m = mk([
      beam([0, 0, 2], [2, 0, 2]),
      holes([0, 0, 0], [2, 0, 0], 2, 'axleHole'),
      axle([0, 0, 0], [0, 0, 3]),
      axle([2, 0, 0], [2, 0, 3]),
    ]);
    expect(describeGraph(analyze(m))).toBe('2 bodies (1 fixed) · 1 joint: 1 prismatic');
  });
});

// ---------------------------------------------------------------------------------------------

describe('free pins through several bodies (independent of where the pin is absorbed)', () => {
  // A(z0) B(z1) C(z2); P: 3-long pin through all three at x=0; Q: 2-long pin through B, C at x=2.
  // B and C share two pin lines → rigid; A turns about P.
  const build = (root: number | null) =>
    mk([
      beam([0, 0, 0], [2, 0, 0]), // 1 A
      beam([0, 0, 1], [2, 0, 1]), // 2 B
      beam([0, 0, 2], [2, 0, 2]), // 3 C
      pin([0, 0, 0], [0, 0, 2]), // 4 P
      pin([2, 0, 1], [2, 0, 2]), // 5 Q
    ], root ?? undefined);
  for (const root of [1, 2, 3, 4, 5]) {
    it(`root ${root}: B and C weld, A turns about P`, () => {
      const g = analyzeValid(build(root));
      const bA = g.bodyOfPart.get(1)!;
      const bBC = g.bodyOfPart.get(2)!;
      expect(g.bodyOfPart.get(3)).toBe(bBC);
      if (root !== 5) expect(g.bodyOfPart.get(5)).toBe(bBC);
      expect(bA).not.toBe(bBC);
      if (root === 4 || root === 5) {
        // the root pin is a fixed body of its own, with one revolute to each body it holds
        expect(g.bodies.length).toBe(3);
        expect(g.joints.map((j) => j.type)).toEqual(['revolute', 'revolute']);
      } else {
        expect(g.bodies.length).toBe(2);
        expect(g.joints).toEqual([{ bodyA: 0, bodyB: 1, type: 'revolute', origin: g.joints[0]!.origin, axis: 2 }]);
        expect(lineKey(g.joints[0]!.origin, 2)).toBe(lineKey([0, 0, 0], 2));
      }
    });
  }

  it('two virtual lines alone make a pair rigid (root pin + pin absorbed into a third body)', () => {
    const m = mk([
      pin([0, 0, 0], [0, 0, 1]), // 1 root pin through A, B
      beam([0, 0, 0], [3, 0, 0]), // 2 A
      beam([0, 0, 1], [3, 0, 1]), // 3 B
      beam([3, 0, 2], [9, 0, 2]), // 4 C (largest) — Q is absorbed into C
      pin([3, 0, 0], [3, 0, 2]), // 5 Q through A, B, C
    ]);
    const g = analyzeValid(m);
    expect(partition(g)).toEqual([[1], [2, 3], [4, 5]]);
    expect(g.joints).toEqual([rev(0, 1, [0, 0, 0]), rev(1, 2, [3, 0, 0])]);
  });
});

describe('slide limits: a hole already holding a third body\'s pin blocks', () => {
  // R (beam z0) — P (pin z0..1) — X (tube of pin holes z1..2) — Y (axle z2..3).
  const parts = [beam([0, 0, 0], [2, 0, 0]), pin([0, 0, 0], [0, 0, 1]), holes([0, 0, 1], [0, 0, 2], 2), axle([0, 0, 2], [0, 0, 3])];
  for (const root of [1, 2, 3, 4]) {
    it(`root ${root}: X–Y is revolute (down blocked by P, up disengages)`, () => {
      const g = analyzeValid(mk(parts, root));
      const a = g.bodyOfPart.get(3)!;
      const b = g.bodyOfPart.get(4)!;
      const j = g.joints.find((jj) => jj.bodyA === Math.min(a, b) && jj.bodyB === Math.max(a, b));
      expect(j).toMatchObject({ type: 'revolute', origin: [0, 0, 2] });
    });
  }

  it('control: a third body\'s *axle* in the hole does not block (it can slide away; contacts handle it)', () => {
    // R beam z0, axle Z z0..1 (cylindrical in R and X), X tube z1..2, Y axle z2..3
    const g = analyzeValid(mk([beam([0, 0, 0], [2, 0, 0]), axle([0, 0, 0], [0, 0, 1]), holes([0, 0, 1], [0, 0, 2], 2), axle([0, 0, 2], [0, 0, 3])]));
    const j = g.joints.find((jj) => jj.bodyA === g.bodyOfPart.get(3) && jj.bodyB === g.bodyOfPart.get(4));
    expect(j).toMatchObject({ type: 'cylindrical', limits: [-2, 0] });
  });

  it('prismatic: a third body\'s pin in one of the holes blocks that direction', () => {
    // A: 2×2 block of Z pin holes at z0..1. B: axle-hole bar at z3 welding two axles z1..3.
    const A = [...holes([0, 0, 0], [1, 0, 0], 2), ...holes([0, 0, 1], [1, 0, 1], 2)];
    const B = holes([0, 0, 3], [1, 0, 3], 2, 'axleHole');
    const ax = [axle([0, 0, 1], [0, 0, 3]), axle([1, 0, 1], [1, 0, 3])];
    const free = analyzeValid(mk([A, B, ...ax]));
    expect(free.joints).toEqual([{ bodyA: 0, bodyB: 1, type: 'prismatic', origin: [0, 0, 1], axis: 2, limits: [-1, 0] }]);
    // D: beam at z=-1 with a pin (0,0,-1..0) filling A's hole at (0,0,0) → B cannot go down →
    // [0,0] → A and B weld, whichever body the pin is absorbed into.
    const D = beam([0, 0, -1], [3, 0, -1]);
    const P = pin([0, 0, -1], [0, 0, 0]);
    const rootD = analyzeValid(mk([A, B, ...ax, D, P], 5));
    expect(partition(rootD)).toEqual([[1, 2, 3, 4], [5, 6]]);
    expect(rootD.joints).toEqual([rev(0, 1, [0, 0, 0])]);
    const rootA = analyzeValid(mk([A, B, ...ax, D, P], 1));
    expect(partition(rootA)).toEqual([[1, 2, 3, 4, 6], [5]]);
    expect(rootA.joints).toEqual([rev(0, 1, [0, 0, -1])]);
  });
});
