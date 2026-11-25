// Every built-in example runs 10 simulated seconds: no NaN, bounded speeds, joint error < 0.02,
// plus a sanity check of what each example is meant to show (DESIGN.md §8).
import { describe, expect, it } from 'vitest';
import { EXAMPLES } from '../../src/core/examples';
import { Simulation } from '../../src/physics/sim';
import type { Vec3 } from '../../src/physics/math';
import { angleZ, isFiniteTransform, maxSpeeds, report, toEditFrame, where } from './helpers';

type Check = {
  /** Called every 4th fixed step. */
  sample(s: Simulation): void;
  /** Called at the end; returns a one-line summary. */
  finish(s: Simulation): string;
};

function angleOf(s: Simulation, partId: number): number {
  const t = s.partTransform(partId);
  return t ? 2 * Math.acos(Math.min(1, Math.abs(t.q[3]))) : NaN;
}

function swingCheck(partId: number, minDeg: number): Check {
  let max = 0;
  return {
    sample: (s) => void (max = Math.max(max, angleOf(s, partId))),
    finish: () => {
      expect((max * 180) / Math.PI).toBeGreaterThan(minDeg);
      return `part ${partId} swings to ${((max * 180) / Math.PI).toFixed(0)}°`;
    },
  };
}

/** Distance from point p to segment ab in the XY plane. */
function segDist(p: Vec3, a: Vec3, b: Vec3): number {
  const abx = b[0] - a[0];
  const aby = b[1] - a[1];
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * abx + (p[1] - a[1]) * aby) / (abx * abx + aby * aby)));
  return Math.hypot(p[0] - a[0] - t * abx, p[1] - a[1] - t * aby);
}

const CHECKS: Record<string, () => Check> = {
  pendulum: () => swingCheck(2, 90),
  'triple-pendulum': () => swingCheck(4, 90),
  'four-bar': () => swingCheck(2, 20),
  parallelogram: () => {
    // Cranks swing; the coupler only translates (stays parallel to the ground).
    const crank = swingCheck(2, 30);
    let couplerTilt = 0;
    return {
      sample: (s) => {
        crank.sample(s);
        couplerTilt = Math.max(couplerTilt, Math.abs(angleZ(s.partTransform(4)!)));
      },
      finish: (s) => {
        expect(couplerTilt).toBeLessThan(0.02);
        return `${crank.finish(s)}, coupler tilt ≤ ${couplerTilt.toExponential(1)} rad`;
      },
    };
  },
  'sliding-axle': () => {
    // Part 2: vertical axle, arm (part 3) two cells above the beam: drops by exactly its limit 2.
    // Part 4: horizontal axle captured between part 5 (arm) and part 6 (bush): spins, cannot slide.
    let capturedSlide = 0;
    let armSwing = 0;
    return {
      sample: (s) => {
        capturedSlide = Math.max(capturedSlide, Math.abs(where(s, s.bodyOf(4)!, [4, 1, 0])[2]));
        armSwing = Math.max(armSwing, angleOf(s, 5));
      },
      finish: (s) => {
        const g = s.graph;
        const vert = g.joints.find((j) => j.axis === 1)!;
        expect(vert.type).toBe('cylindrical');
        expect(vert.limits![0]).toBe(-2);
        const horiz = g.joints.find((j) => j.axis === 2)!;
        expect(horiz.type).toBe('revolute');
        const drop = where(s, s.bodyOf(2)!, [0, 3, 0])[1] - 3;
        expect(Math.abs(drop + 2)).toBeLessThan(0.03);
        expect(capturedSlide).toBeLessThan(0.01);
        expect((armSwing * 180) / Math.PI).toBeGreaterThan(60);
        // the drop arm does not spin (gravity is along its axis)
        expect(angleOf(s, 3)).toBeLessThan(0.05);
        return `vertical axle displacement ${drop.toFixed(4)}, captured axle slide ≤ ${capturedSlide.toExponential(1)}, its arm swings to ${((armSwing * 180) / Math.PI).toFixed(0)}°`;
      },
    };
  },
  'weld-test': () => {
    const swing = swingCheck(2, 90);
    let rel = 0;
    return {
      sample: (s) => {
        swing.sample(s);
        const a = s.partTransform(2)!;
        const b = s.partTransform(3)!;
        rel = Math.max(rel, ...a.p.map((x, i) => Math.abs(x - b.p[i]!)), ...a.q.map((x, i) => Math.abs(x - b.q[i]!)));
      },
      finish: (s) => {
        expect(s.bodyOf(2)).toBe(s.bodyOf(3));
        expect(rel).toBe(0);
        return `${swing.finish(s)}, welded pair rigid (Δ ${rel})`;
      },
    };
  },
  collision: () => {
    // Peg: axle cells (0,−5, z=1..2) on the frame, radius 0.29. Lower link: part 3, cells
    // (3..6, 0, 2), hole radius 0.46. In the link's own frame the peg centre must stay ≥ 0.75
    // (minus contact tolerance) from the link's centre line, and it must come close (it is hit).
    let minDist = Infinity;
    let upperMin = Infinity;
    let looseMinY = Infinity;
    return {
      sample: (s) => {
        const t = s.partTransform(3)!;
        const peg = toEditFrame(t, [0, -5, 2]);
        minDist = Math.min(minDist, segDist(peg, [3, 0, 2], [6, 0, 2]));
        const tu = s.partTransform(2)!;
        upperMin = Math.min(upperMin, segDist(toEditFrame(tu, [0, -5, 1]), [0, 0, 1], [3, 0, 1]));
        const lt = s.partTransform(6);
        if (lt) looseMinY = Math.min(looseMinY, where(s, s.bodyOf(6)!, [-1, 3, 0])[1]);
      },
      finish: (s) => {
        expect(minDist).toBeGreaterThan(0.75 - 0.05); // never passes through the peg
        expect(minDist).toBeLessThan(0.8); // really struck it
        expect(upperMin).toBeGreaterThan(0.8); // upper link is out of the peg's reach
        // The loose beam lands on the frame's top beam (y = 0) and stays there.
        const lt = s.partTransform(6)!;
        const y = where(s, s.bodyOf(6)!, [-1, 3, 0])[1];
        expect(lt).not.toBeNull();
        expect(y).toBeGreaterThan(0.85);
        expect(y).toBeLessThan(1.0);
        expect(looseMinY).toBeGreaterThan(0.85);
        const v = s.bodyVelocity(s.bodyOf(6)!)!.v;
        expect(Math.hypot(...v)).toBeLessThan(0.5);
        return `lower link–peg min distance ${minDist.toFixed(4)} (contact at 0.75), upper link ≥ ${upperMin.toFixed(2)}, loose beam rests at y ${y.toFixed(4)}`;
      },
    };
  },
};

describe('built-in examples run 10 s', () => {
  it('every example has a sanity check', () => {
    expect(EXAMPLES.map((e) => e.name).sort()).toEqual(Object.keys(CHECKS).sort());
  });

  for (const ex of EXAMPLES) {
    it(ex.name, async () => {
      const s = await Simulation.create(ex.build());
      const check = CHECKS[ex.name]!();
      let jerr = 0;
      let vmax = 0;
      let wmax = 0;
      const e0 = s.energy().kinetic + s.energy().potential;
      let emax = e0;
      let kmax = 0;
      const n = Math.round(10 / s.fixedDt);
      const t0 = performance.now();
      for (let i = 1; i <= n; i++) {
        s.stepFixed(1);
        if (i % 4 !== 0) continue;
        const e = s.jointError();
        expect(Number.isFinite(e)).toBe(true);
        jerr = Math.max(jerr, e);
        const sp = maxSpeeds(s);
        vmax = Math.max(vmax, sp.v);
        wmax = Math.max(wmax, sp.w);
        const en = s.energy();
        emax = Math.max(emax, en.kinetic + en.potential);
        kmax = Math.max(kmax, en.kinetic);
        check.sample(s);
      }
      const ms = performance.now() - t0;
      for (const b of s.graph.bodies) expect(isFiniteTransform(s.bodyTransform(b.id))).toBe(true);
      expect(Number.isFinite(vmax) && Number.isFinite(wmax)).toBe(true);
      // Rapier clamps linear speed at 400 units/s and angular speed at 377 rad/s (DEVIATIONS §5):
      // a runaway body would sit at the clamp, so the bounds sit just below it.
      expect(vmax).toBeLessThan(390);
      expect(wmax).toBeLessThan(370);
      expect(jerr).toBeLessThan(0.02);
      // Energy never rises far above its start. The model is conservative apart from contacts
      // (which only remove energy); the slow rise that remains is Rapier's f32 angular-velocity
      // bias (DEVIATIONS §5), measured ≤ 3.4 % of the peak kinetic energy over 10 s (pendulum).
      const gain = kmax > 0 ? (emax - e0) / kmax : 0;
      expect(gain).toBeLessThan(0.05);
      const summary = check.finish(s);
      report(`example ${ex.name}: joint error ${jerr.toExponential(2)}, max |v| ${vmax.toFixed(0)}, max |ω| ${wmax.toFixed(0)}, energy rise ${(gain * 100).toFixed(2)}% of KE_max, ${(ms / 10).toFixed(0)} ms/sim-s (incl. checks); ${summary}`);
      s.dispose();
    }, 60000);
  }
});
