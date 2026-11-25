// Shared runner for the friction-examples-*.test.ts files (one file per friction level so vitest
// runs the three 30 s sweeps in parallel): every built-in example for 30 simulated seconds at one
// joint-friction level (DESIGN §5.3 "With friction on": monotone energy, at rest by 30 s).
import { expect } from 'vitest';
import { EXAMPLES } from '../../src/core/examples';
import { JOINT_FRICTION, Simulation } from '../../src/physics/sim';
import type { FrictionLevel } from '../../src/physics/sim';
import type { Vec3 } from '../../src/physics/math';
import { G, report, toEditFrame, where } from './helpers';

export const SECONDS = 30;
/**
 * "At rest" is judged by pose, not velocity: a mechanism held by stiction keeps velocity readings of
 * up to ≈ 5e-3 rad/s that are solver noise and do not move it (each substep's rotation is below
 * the f32 resolution of the pose). A window of REST_WINDOW s is "moving" if any dynamic body
 * turned by more than REST_ANGLE rad or its centre of mass moved more than REST_DIST units.
 */
export const REST_WINDOW = 0.5;
export const REST_ANGLE = 1e-3;
export const REST_DIST = 1e-3;

export interface Sweep {
  /** Max joint error over the run, units. */
  jerr: number;
  /** Max over the run of (E − running min of E) / running max of KE. */
  rise: number;
  /** Max over the run of E − (running min of E + 1 % of running max KE), in units of the guard's noise floor. */
  overFloor: number;
  /** End of the last REST_WINDOW in which a dynamic body moved, s (0: never moved; SECONDS: still moving). */
  restAt: number;
  /** After restAt: largest rotation of any jointed body (rad) and displacement of any centre of mass (units) up to SECONDS. */
  creepAngle: number;
  creepDist: number;
  /** Energy removed by the energy guard. */
  guardRemoved: number;
  nan: boolean;
  ms: number;
  extra: string;
}

function segDist(p: Vec3, a: Vec3, b: Vec3): number {
  const abx = b[0] - a[0];
  const aby = b[1] - a[1];
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * abx + (p[1] - a[1]) * aby) / (abx * abx + aby * aby)));
  return Math.hypot(p[0] - a[0] - t * abx, p[1] - a[1] - t * aby);
}

/** Example-specific measurements (sampled every 4th step) with their checks at the end. */
function extraCheck(name: string, level: FrictionLevel): { sample(s: Simulation): void; finish(s: Simulation): string } {
  if (name === 'sliding-axle') {
    // The vertical axle (part 2) drops by its limit 2 onto the bush stop at every level.
    let reach = -1;
    return {
      sample: (s) => {
        const drop = 3 - where(s, s.bodyOf(2)!, [0, 3, 0])[1];
        if (reach < 0 && drop > 1.97) reach = s.time;
      },
      finish: (s) => {
        const drop = 3 - where(s, s.bodyOf(2)!, [0, 3, 0])[1];
        expect(Math.abs(drop - 2)).toBeLessThan(0.03);
        expect(reach).toBeGreaterThan(0);
        return `vertical axle at its stop (${drop.toFixed(4)}) from ${reach.toFixed(3)} s`;
      },
    };
  }
  if (name === 'collision') {
    // The lower link (part 3) strikes the peg and never passes through it (contact at 0.75; a
    // transient step-phase penetration up to 0.29 is documented in DEVIATIONS §5 "Contacts"); the
    // loose beam (part 6) lands on the frame and stays there.
    let minDist = Infinity;
    return {
      sample: (s) => {
        minDist = Math.min(minDist, segDist(toEditFrame(s.partTransform(3)!, [0, -5, 2]), [3, 0, 2], [6, 0, 2]));
      },
      finish: (s) => {
        expect(minDist).toBeLessThan(0.8);
        expect(minDist).toBeGreaterThan(0.75 - 0.29);
        const y = where(s, s.bodyOf(6)!, [-1, 3, 0])[1];
        expect(y).toBeGreaterThan(0.85);
        expect(y).toBeLessThan(1.0);
        return `link–peg min distance ${minDist.toFixed(3)}, loose beam rests at y ${y.toFixed(3)}`;
      },
    };
  }
  void level;
  return { sample: () => {}, finish: () => '' };
}

export async function sweep(name: string, level: FrictionLevel): Promise<Sweep> {
  const ex = EXAMPLES.find((e) => e.name === name)!;
  const s = await Simulation.create(ex.build(), { jointFriction: JOINT_FRICTION[level] });
  const extra = extraCheck(name, level);
  const dyn = s.graph.bodies.filter((b) => !b.fixed).map((b) => b.id);
  // The energy guard's noise floor (sim.ts NOISE = 1e-5 per m·|g|·(1 + |com|)), summed over bodies.
  let floor = 0;
  for (const id of dyn) {
    const mi = s.massInfo(id)!;
    floor += 1e-5 * mi.mass * G * (1 + Math.hypot(...mi.com));
  }
  let eMin = Infinity;
  let kMax = 0;
  let rise = 0;
  let overFloor = -Infinity;
  let jerr = 0;
  let restAt = 0;
  let nan = false;
  type Pose = { q: number[]; c: number[]; jointed: boolean } | null;
  const jointed = new Set(s.graph.joints.flatMap((j) => [j.bodyA, j.bodyB]));
  const pose = (): Pose[] => dyn.map((id) => {
    const t = s.bodyTransform(id);
    return t ? { q: [...t.q], c: s.massInfo(id)!.com, jointed: jointed.has(id) } : null;
  });
  /** Largest rotation angle and centre-of-mass move between two pose sets (`jointedOnly`: bodies with a joint). */
  const moved = (a: Pose[], b: Pose[], jointedOnly = false): [number, number] => {
    let ang = 0;
    let dist = 0;
    a.forEach((pa, i) => {
      const pb = b[i];
      if (!pa || !pb || (jointedOnly && !pa.jointed)) return;
      const d = Math.abs(pa.q.reduce((acc, x, k) => acc + x * pb.q[k]!, 0));
      ang = Math.max(ang, 2 * Math.acos(Math.min(1, d)));
      dist = Math.max(dist, Math.hypot(pa.c[0]! - pb.c[0]!, pa.c[1]! - pb.c[1]!, pa.c[2]! - pb.c[2]!));
    });
    return [ang, dist];
  };
  const win = Math.round(REST_WINDOW / s.fixedDt);
  let prev = pose();
  const history: { t: number; p: Pose[] }[] = [];
  const n = Math.round(SECONDS / s.fixedDt);
  const t0 = performance.now();
  for (let i = 1; i <= n; i++) {
    s.stepFixed(1);
    if (i % 4) continue;
    const je = s.jointError();
    if (!Number.isFinite(je)) nan = true;
    jerr = Math.max(jerr, je);
    const en = s.energy();
    const e = en.kinetic + en.potential;
    if (!Number.isFinite(e)) nan = true;
    kMax = Math.max(kMax, en.kinetic);
    eMin = Math.min(eMin, e);
    if (kMax > 0) rise = Math.max(rise, (e - eMin) / kMax);
    overFloor = Math.max(overFloor, (e - eMin - 0.01 * kMax) / floor);
    if (i % win === 0) {
      const cur = pose();
      const [a, d] = moved(prev, cur);
      if (a > REST_ANGLE || d > REST_DIST) restAt = s.time;
      prev = cur;
      history.push({ t: s.time, p: cur });
    }
    extra.sample(s);
  }
  let creepAngle = 0;
  let creepDist = 0;
  const atRest = history.find((h) => Math.abs(h.t - restAt) < 1e-9);
  if (atRest && restAt < SECONDS - 1e-9) {
    creepAngle = moved(atRest.p, pose(), true)[0];
    creepDist = moved(atRest.p, pose())[1];
  }
  const ms = performance.now() - t0;
  const summary = extra.finish(s);
  const r: Sweep = { jerr, rise, overFloor, restAt, creepAngle, creepDist, guardRemoved: s.guardRemoved, nan, ms, extra: summary };
  report(
    `friction ${level} ${name}: ${SECONDS} s, joint error ≤ ${jerr.toExponential(1)}, energy above running min ≤ ${(rise * 100).toFixed(2)} % of KE_max ` +
      `(${overFloor.toFixed(2)} noise floors beyond the 1 % band), at rest from ${restAt >= SECONDS - 1e-9 ? 'never' : restAt.toFixed(1) + ' s'}` +
      (restAt < SECONDS - 1e-9 ? ` (then moves ≤ ${((creepAngle * 180) / Math.PI).toFixed(4)}°, ${creepDist.toExponential(1)} units)` : '') +
      `, ` +
      `guard removed ${s.guardRemoved.toPrecision(3)}, ${(ms / SECONDS).toFixed(0)} ms/sim-s${summary ? '; ' + summary : ''}`,
  );
  s.dispose();
  return r;
}

/** The checks every level shares; `atRest` additionally requires rest well before 30 s. */
export function checkSweep(r: Sweep, atRest: boolean): void {
  expect(r.nan).toBe(false);
  expect(r.jerr).toBeLessThan(0.02); // the bound of the 10 s example runs (examples.test.ts)
  // Never above the running minimum plus the energy guard's band (1 % of the peak KE, or its
  // noise floor; the floor is per group, so allow it twice for the sum over groups).
  expect(r.overFloor).toBeLessThan(2);
  if (atRest) {
    expect(r.restAt).toBeLessThan(SECONDS - 1);
    // …and stays there. Stuck joints are held where they stuck (DEVIATIONS §5 "Joint friction":
    // within 1e-5 rad plus a step of slip), so no jointed body turns; a loose part may still settle
    // on its contact (≤ 2e-3 units, the same with friction off). Before the stiction hold (review)
    // this allowed 0.1° of turning.
    expect(r.creepAngle).toBeLessThan(1e-4);
    expect(r.creepDist).toBeLessThan(5e-3);
  }
}
