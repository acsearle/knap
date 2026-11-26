// Joint friction (DESIGN §5.1 "Joint friction", §5.3 "With friction on"; DEVIATIONS §5 "Joint
// friction"). The 30 s sweep of every example at every level is in friction-examples-*.test.ts.
import { describe, expect, it } from 'vitest';
import { EXAMPLES, ModelBuilder, axle, beam, beamPath, buildExample, cell, holes, pin } from '../../src/core/examples';
import type { Axis, Cell, Model } from '../../src/core/types';
import { R_BORE } from '../../src/geometry/dims';
import { DEFAULT_FRICTION_LEVEL, JOINT_FRICTION, MAX_JOINT_FRICTION, Simulation } from '../../src/physics';
import type { FrictionLevel } from '../../src/physics';
import { RAPIER, initPhysics } from '../../src/physics/rapier';
import { unitAxis } from '../../src/physics/math';
import type { Vec3 } from '../../src/physics/math';
import { G, angleZ, mk, report, unwrap } from './helpers';

const LEVELS = Object.keys(JOINT_FRICTION) as FrictionLevel[];
const REALISTIC = JOINT_FRICTION.realistic;

/** Private Rapier body of a Simulation body (tests set velocities and copy states). */
type RB = {
  translation(): { x: number; y: number; z: number };
  rotation(): { x: number; y: number; z: number; w: number };
  linvel(): { x: number; y: number; z: number };
  angvel(): { x: number; y: number; z: number };
  setTranslation(v: object, w: boolean): void;
  setRotation(q: object, w: boolean): void;
  setLinvel(v: object, w: boolean): void;
  setAngvel(v: object, w: boolean): void;
};
const rbOf = (s: Simulation, id: number) => (s as unknown as { bodies: { rb: RB }[] }).bodies[id]!.rb;

/**
 * Hash of the poses and velocities of every body, every `every` fixed steps for `steps` steps
 * (two 32-bit FNV-style lanes over the f64 bytes).
 */
function trajectoryHash(s: Simulation, steps: number, every: number): string {
  let h = 0x811c9dc5 >>> 0;
  let h2 = 0x12345678 >>> 0;
  const buf = new Float64Array(1);
  const bytes = new Uint8Array(buf.buffer);
  const mix = (x: number) => {
    buf[0] = x;
    for (const b of bytes) {
      h = Math.imul(h ^ b, 0x01000193) >>> 0;
      h2 = Math.imul(h2 ^ b, 0x5bd1e995) >>> 0;
    }
  };
  for (let i = 1; i <= steps; i++) {
    s.stepFixed(1);
    if (i % every) continue;
    for (const b of s.graph.bodies) {
      const t = s.bodyTransform(b.id);
      const v = s.bodyVelocity(b.id);
      if (!t || !v) {
        mix(-1);
        continue;
      }
      for (const x of [...t.p, ...t.q, ...v.v, ...v.w]) mix(x);
    }
  }
  return h.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0');
}

/**
 * trajectoryHash(sim, 1440, 8) (3 simulated seconds, default options) of every example, recorded
 * from the code before joint friction existed (git HEAD at the start of that change).
 */
const FRICTIONLESS_HASHES: Record<string, string> = {
  pendulum: 'be16d0ea302f91af',
  'triple-pendulum': '8045f3612e003414',
  'four-bar': '0ff7acea870a0f1f',
  parallelogram: '707e3d76770f0d85',
  'sliding-axle': '0c9d98094512d78a',
  'weld-test': '8d4f0b236fc9b568',
  collision: '2a1e19a7ce8ac25a',
};

describe('joint friction API', () => {
  it('levels, default and Rapier enum values the construction relies on', async () => {
    expect(JOINT_FRICTION).toEqual({ off: 0, low: 0.05, realistic: 0.2 });
    expect(DEFAULT_FRICTION_LEVEL).toBe('realistic');
    await initPhysics();
    expect(RAPIER.JointAxis.AngX).toBe(3); // sim.ts ANG_X
    expect(RAPIER.JointAxis.LinX).toBe(0); // sim.ts LIN_X
    expect(RAPIER.MotorModel.AccelerationBased).toBe(0); // sim.ts ACCELERATION_BASED
  });

  it('default μ is the realistic level; setJointFriction validates and updates the getter', async () => {
    const s = await Simulation.create(buildExample('pendulum'));
    expect(s.jointFriction).toBe(REALISTIC);
    for (const bad of [-0.1, NaN, Infinity]) expect(() => s.setJointFriction(bad)).toThrow();
    await expect(Simulation.create(buildExample('pendulum'), { jointFriction: -1 })).rejects.toThrow();
    s.setJointFriction(JOINT_FRICTION.low);
    expect(s.jointFriction).toBe(0.05);
    s.dispose();
    expect(() => s.setJointFriction(0)).toThrow();
  });

  it('μ is limited to [0, MAX_JOINT_FRICTION]; −0 is read as 0', async () => {
    const s = await Simulation.create(buildExample('pendulum'), { jointFriction: -0 });
    expect(Object.is(s.jointFriction, 0)).toBe(true);
    s.setJointFriction(MAX_JOINT_FRICTION);
    expect(s.jointFriction).toBe(MAX_JOINT_FRICTION);
    expect(Number.isFinite(s.jointStates()[0]!.frictionTorque)).toBe(true);
    for (const bad of [MAX_JOINT_FRICTION * 1.001, Number.MAX_VALUE, null, '0.2', true]) expect(() => s.setJointFriction(bad as number)).toThrow();
    await expect(Simulation.create(buildExample('pendulum'), { jointFriction: Number.MAX_VALUE })).rejects.toThrow();
    s.setJointFriction(-0);
    expect(Object.is(s.jointFriction, 0)).toBe(true);
    s.dispose();
  });

  // DEVIATIONS §5 "Joint friction: load estimate" (fix after review; DESIGN §5.1 had the lighter body).
  it('m_j is the weight each joint carries toward the fixed body: chains, loops, floating groups', async () => {
    const check = async (model: Model, expected: (mass: (part: number) => number) => Map<string, number>, mu: number = REALISTIC) => {
      const s = await Simulation.create(model, { jointFriction: mu });
      const byBody = new Map<number, number>();
      const mass = (part: number) => {
        byBody.set(s.bodyOf(part)!, part); // the links named by `expected` identify their bodies
        return s.massInfo(s.bodyOf(part)!)!.mass;
      };
      for (const p of model.parts) if (s.graph.bodies[s.bodyOf(p.id)!]!.fixed) byBody.set(s.bodyOf(p.id)!, model.rootPartId ?? p.id);
      const want = expected(mass);
      const states = s.jointStates();
      expect(states.length).toBe(want.size);
      for (const js of states) {
        const key = [byBody.get(js.bodyA)!, byBody.get(js.bodyB)!].sort((a, b) => a - b).join('-');
        const m = want.get(key);
        expect(m, key).toBeDefined();
        expect(js.loadMass, key).toBeCloseTo(m!, 9);
        const F = mu * m! * G;
        expect(js.frictionForce).toBeCloseTo(js.type === 'revolute' ? 0 : F, 6);
        expect(js.frictionTorque).toBeCloseTo(js.type === 'prismatic' ? 0 : F * R_BORE, 6);
      }
      s.dispose();
    };
    // Chain (the triple pendulum): every pivot carries everything below it.
    {
      const b = new ModelBuilder();
      const f = b.add(beam([-2, 0, 0], [0, 0, 0]));
      const l1 = b.add(beam([0, 0, 1], [4, 0, 1]));
      const l2 = b.add(beam([4, 0, 2], [7, 0, 2]));
      const l3 = b.add(beam([7, 0, 3], [9, 0, 3]));
      b.add(pin([0, 0, 0], [0, 0, 1]));
      b.add(pin([4, 0, 1], [4, 0, 2]));
      b.add(pin([7, 0, 2], [7, 0, 3]));
      const k = (a: number, c: number) => [a, c].sort((x, y) => x - y).join('-');
      await check(b.root(f).build(), (m) => new Map([[k(f, l1), m(l1) + m(l2) + m(l3)], [k(l1, l2), m(l2) + m(l3)], [k(l2, l3), m(l3)]]));
      await check(b.root(f).build(), (m) => new Map([[k(f, l1), m(l1) + m(l2) + m(l3)], [k(l1, l2), m(l2) + m(l3)], [k(l2, l3), m(l3)]]), 0.7);
    }
    // Loop (the four-bar): the coupler's weight is shared by the two sides.
    {
      const b = new ModelBuilder();
      const g = b.add(beam([0, 0, 0], [6, 0, 0]));
      const crank = b.add(beam([0, 0, 1], [0, 2, 1]));
      const coupler = b.add(beam([0, 2, 2], [4, 2, 2]));
      const rocker = b.add(beamPath([[4, 2, 1], [4, 0, 1], [6, 0, 1]]));
      b.add(pin([0, 0, 0], [0, 0, 1]));
      b.add(pin([0, 2, 1], [0, 2, 2]));
      b.add(pin([4, 2, 1], [4, 2, 2]));
      b.add(pin([6, 0, 0], [6, 0, 1]));
      const k = (a: number, c: number) => [a, c].sort((x, y) => x - y).join('-');
      await check(b.root(g).build(), (m) => new Map([
        [k(g, crank), m(crank) + m(coupler) / 2],
        [k(crank, coupler), m(coupler) / 2],
        [k(coupler, rocker), m(coupler) / 2],
        [k(g, rocker), m(rocker) + m(coupler) / 2],
      ]));
    }
    // A pinned pair with no path to a fixed body (a loose sub-assembly): the lighter body.
    {
      const b = new ModelBuilder();
      const g = b.add(beam([0, 0, 0], [2, 0, 0]));
      const lone1 = b.add(beam([20, 0, 0], [24, 0, 0]));
      const lone2 = b.add(beam([24, 0, 1], [26, 0, 1]));
      b.add(pin([24, 0, 0], [24, 0, 1]));
      const k = (x: number, y: number) => [x, y].sort((p, q) => p - q).join('-');
      await check(b.root(g).build(), (m) => new Map([[k(lone1, lone2), Math.min(m(lone1), m(lone2))]]));
    }
  });
});

// Coverage after review (mutations of sim.ts that survived this file).
describe('joint friction diagnostics and edge cases', () => {
  it('without gravity there is no joint friction: a spun link keeps exactly the frictionless spin', async () => {
    const model = () => mk([beam([0, 0, 0], [0, -1, 0]), beam([-2, 0, 1], [2, 0, 1]), pin([0, 0, 0], [0, 0, 1])], 1);
    const spin = async (jointFriction?: number) => {
      const s = await Simulation.create(model(), { gravity: [0, 0, 0], jointFriction });
      if (jointFriction === undefined) {
        expect(s.jointFriction).toBe(REALISTIC);
        expect(s.jointStates()[0]!.frictionTorque).toBe(0);
      }
      rbOf(s, 1).setAngvel({ x: 0, y: 0, z: 20 }, true);
      s.stepFixed(240);
      const w = s.bodyVelocity(1)!.w[2];
      s.dispose();
      return w;
    };
    expect(await spin()).toBe(await spin(0));
  });

  it('a joint whose body fell out of the world reports no friction, and level changes still work', async () => {
    const s = await Simulation.create(mk([beam([-50, 0, 0], [-48, 0, 0]), beam([0, 0, 0], [3, 0, 0]), beam([3, 0, 1], [6, 0, 1]), pin([3, 0, 0], [3, 0, 1])], 1), { removeBelowY: -5 });
    expect(s.jointStates()[0]!.frictionTorque).toBeGreaterThan(0);
    s.stepFixed(480);
    expect(s.hasBody(1)).toBe(false);
    expect(() => s.setJointFriction(0.05)).not.toThrow();
    expect(() => s.setJointFriction(0)).not.toThrow();
    s.setJointFriction(REALISTIC);
    s.stepFixed(10);
    const js = s.jointStates()[0]!;
    expect(js.alive).toBe(false);
    expect(js.frictionTorque).toBe(0);
    expect(js.frictionForce).toBe(0);
    s.dispose();
  });

  it('jointStates().omega is B relative to A about the axis, .speed B relative to A along it', async () => {
    const s = await Simulation.create(buildExample('pendulum'), { jointFriction: 0 });
    s.stepFixed(120);
    const js = s.jointStates()[0]!;
    const w = s.bodyVelocity(1)!.w;
    expect(js.omega).toBeCloseTo((js.bodyB === 1 ? 1 : -1) * w[2], 6);
    expect(Math.abs(js.omega)).toBeGreaterThan(1);
    expect(Math.abs(js.speed)).toBeLessThan(1e-3); // a revolute joint does not slide
    s.dispose();
    // A sliding joint: the vertical axle of the sliding-axle example falls (B relative to A, along A's +Y).
    const t = await Simulation.create(buildExample('sliding-axle'), { jointFriction: 0 });
    t.stepFixed(12);
    const vj = t.jointStates().find((j) => j.type === 'cylindrical' && t.graph.joints[j.index]!.axis === 1)!;
    const vb = t.bodyVelocity(vj.bodyB)!.v[1] - t.bodyVelocity(vj.bodyA)!.v[1];
    expect(vj.speed).toBeCloseTo(vb, 3);
    expect(Math.abs(vj.speed)).toBeGreaterThan(5);
    t.dispose();
  });
});

describe('friction off is the frictionless simulation', () => {
  // The recording covers the seven examples that existed then; examples added later (crank wheel,
  // cart) are covered by the next test against their own μ = 0 run.
  it('every example at μ = 0 reproduces the trajectory of the code before joint friction, bit for bit', { timeout: 120000 }, async () => {
    for (const ex of EXAMPLES.filter((e) => e.name in FRICTIONLESS_HASHES)) {
      const s = await Simulation.create(ex.build(), { jointFriction: 0 });
      expect(trajectoryHash(s, 1440, 8), ex.name).toBe(FRICTIONLESS_HASHES[ex.name]);
      s.dispose();
    }
  });

  it('a run switched to off before its first step is the off run (motors at limit 0 apply nothing)', { timeout: 120000 }, async () => {
    for (const ex of EXAMPLES) {
      const s = await Simulation.create(ex.build(), { jointFriction: REALISTIC });
      s.setJointFriction(0);
      let want = FRICTIONLESS_HASHES[ex.name];
      if (want === undefined) {
        // Examples added after the recording: the run created at μ = 0.
        const off = await Simulation.create(ex.build(), { jointFriction: 0 });
        want = trajectoryHash(off, 1440, 8);
        off.dispose();
      }
      expect(trajectoryHash(s, 1440, 8), ex.name).toBe(want);
      s.dispose();
    }
  });

  it('runs are deterministic at the realistic level', { timeout: 60000 }, async () => {
    for (const name of ['four-bar', 'collision']) {
      const hashes: string[] = [];
      for (let k = 0; k < 2; k++) {
        const s = await Simulation.create(buildExample(name), { jointFriction: REALISTIC });
        hashes.push(trajectoryHash(s, 960, 4));
        s.dispose();
      }
      expect(hashes[0]).toBe(hashes[1]);
      expect(hashes[0]).not.toBe(FRICTIONLESS_HASHES[name]);
    }
  });
});

/** Pendulum swing angle from straight down (rad), from the link's centre of mass about the pivot. */
function swing(s: Simulation, body: number, pivot: Vec3): number {
  const c = s.massInfo(body)!.com;
  return Math.atan2(c[0] - pivot[0], -(c[1] - pivot[1]));
}

describe('pendulum decay (built-in pendulum, realistic)', () => {
  it('dry-friction decay per half-swing, rest in 2–6 s within the dead zone, and stays there', { timeout: 60000 }, async () => {
    const s = await Simulation.create(buildExample('pendulum'));
    const pivot: Vec3 = [0, 0, 1];
    const mi = s.massInfo(1)!;
    const m = mi.mass;
    const d = Math.hypot(mi.com[0] - pivot[0], mi.com[1] - pivot[1]);
    const tf = s.jointStates()[0]!.frictionTorque;
    expect(tf).toBeCloseTo(REALISTIC * m * G * R_BORE, 9);
    const mgd = m * G * d;
    const perHalf = (2 * tf) / mgd; // small-angle decrement per half-swing
    const dead = Math.asin(tf / mgd);
    const amps = [Math.abs(swing(s, 1, pivot))];
    let prev = 0;
    let restAt = -1;
    const N = Math.round(10 / s.fixedDt);
    for (let i = 0; i < N; i++) {
      s.stepFixed(1);
      const w = s.bodyVelocity(1)!.w[2];
      if (prev !== 0 && Math.sign(w) !== Math.sign(prev) && Math.abs(prev) > 1e-3) amps.push(Math.abs(swing(s, 1, pivot)));
      prev = w;
      if (Math.abs(w) > 1e-3) restAt = -1;
      else if (restAt < 0) restAt = s.time;
    }
    // Energy per half-swing: m·g·d·(cos θ₂ − cos θ₁) = τ_f·(θ₁ + θ₂) (exact for dry friction).
    const ratios: number[] = [];
    const decrements: number[] = [];
    for (let k = 1; k < amps.length; k++) {
      const [a, b] = [amps[k - 1]!, amps[k]!];
      if (b < 2 * dead) continue; // the last half-swing ends by sticking, not at a turning point
      ratios.push((mgd * (Math.cos(b) - Math.cos(a))) / (tf * (a + b)));
      if (a < (30 * Math.PI) / 180) decrements.push((a - b) / perHalf);
    }
    const rest = Math.abs(swing(s, 1, pivot));
    report(
      `pendulum (realistic): τ_f ${tf.toFixed(1)}, 2τ_f/(mgd) = ${((perHalf * 180) / Math.PI).toFixed(2)}°, ` +
        `${amps.length - 1} half-swings, amplitudes ${amps.map((a) => ((a * 180) / Math.PI).toFixed(1)).join(' ')}°; ` +
        `energy loss / τ_f·(θ₁+θ₂) ${Math.min(...ratios).toFixed(3)}…${Math.max(...ratios).toFixed(3)}, ` +
        `small-angle decrement / 2τ_f/(mgd) ${Math.min(...decrements).toFixed(3)}…${Math.max(...decrements).toFixed(3)}; ` +
        `at rest from ${restAt.toFixed(3)} s, ${((rest * 180) / Math.PI).toFixed(3)}° off vertical (dead zone ${((dead * 180) / Math.PI).toFixed(3)}°)`,
    );
    expect(ratios.length).toBeGreaterThan(10);
    for (const r of ratios) expect(Math.abs(r - 1)).toBeLessThan(0.25);
    expect(decrements.length).toBeGreaterThan(3);
    for (const r of decrements) expect(Math.abs(r - 1)).toBeLessThan(0.25);
    expect(restAt).toBeGreaterThan(2);
    expect(restAt).toBeLessThan(6);
    expect(rest).toBeLessThan(dead + 2e-3);
    // Stays at rest for a further 5 s.
    const before = s.bodyTransform(1)!;
    let wmax = 0;
    for (let i = 0; i < Math.round(5 / s.fixedDt); i++) {
      s.stepFixed(1);
      wmax = Math.max(wmax, Math.abs(s.bodyVelocity(1)!.w[2]));
    }
    expect(Math.abs(angleZ(s.bodyTransform(1)!) - angleZ(before))).toBeLessThan(1e-6);
    expect(wmax).toBeLessThan(1e-3);
    s.dispose();
  });

  it('a hanging link loaded below its stiction limit holds; above it, it slides', { timeout: 60000 }, async () => {
    // Gravity tilted by φ from the link's line: static torque m·g·d·sin φ against τ_f.
    const model = mk([beam([-2, 0, 0], [0, 0, 0]), beam([0, 0, 1], [0, -4, 1]), pin([0, 0, 0], [0, 0, 1])], 1);
    const dead = Math.asin(REALISTIC * R_BORE / 2); // d = 2
    for (const [frac, holds] of [[0.5, true], [0.9, true], [1.2, false]] as const) {
      const phi = frac * dead;
      const s = await Simulation.create(model, { gravity: [G * Math.sin(phi), -G * Math.cos(phi), 0] });
      s.stepFixed(Math.round(2 / s.fixedDt));
      const moved = Math.abs(swing(s, 1, [0, 0, 1]));
      report(`hanging link, static load ${frac} × τ_f: turned ${((moved * 180) / Math.PI).toExponential(2)}° in 2 s`);
      // Below the limit it is held where it stuck (stiction hold, DEVIATIONS §5); above it, it
      // slides most of the way to φ − dead zone.
      if (holds) expect(moved).toBeLessThan(3e-5);
      else expect(moved).toBeGreaterThan(0.5 * (phi - dead));
      s.dispose();
    }
  });
});

// Fix after review: the friction motor alone (one Gauss–Seidel row per substep) let a held joint
// slip slowly wherever the f32 pose resolves small turns (near the build orientation and ≈ 180°
// from it) — 1° in 20 s for a 2-hole link. Stuck joints are now held at the coordinate where they
// stuck (updateFriction in sim.ts).
describe('stiction is exact', () => {
  /** Rotate a body (from its build pose) by th about +Z through `pivot`, at rest. */
  function setAngleZ(s: Simulation, id: number, pivot: Vec3, th: number): void {
    const b = (s as unknown as { bodies: { rb: RB; ref: number[] }[] }).bodies[id]!;
    const c = Math.cos(th);
    const sn = Math.sin(th);
    const dx = b.ref[0]! - pivot[0];
    const dy = b.ref[1]! - pivot[1];
    b.rb.setTranslation({ x: pivot[0] + c * dx - sn * dy, y: pivot[1] + sn * dx + c * dy, z: b.ref[2] }, true);
    b.rb.setRotation({ x: 0, y: 0, z: Math.sin(th / 2), w: Math.cos(th / 2) }, true);
    b.rb.setLinvel({ x: 0, y: 0, z: 0 }, true);
    b.rb.setAngvel({ x: 0, y: 0, z: 0 }, true);
  }
  const angZ = (s: Simulation, id: number) => {
    const q = rbOf(s, id).rotation();
    return 2 * Math.atan2(q.z, q.w);
  };

  for (const L of [2, 5])
    for (const frac of [0.5, 0.97])
      it(`a ${L}-hole link built hanging, left at rest at ${frac} × its dead zone, does not move in 20 s`, { timeout: 60000 }, async () => {
        const s = await Simulation.create(mk([beam([-2, 0, 0], [0, 0, 0]), beam([0, 0, 1], [0, -(L - 1), 1]), pin([0, 0, 0], [0, 0, 1])], 1));
        const id = s.bodyOf(2)!;
        const mi = s.massInfo(id)!;
        const dz = Math.asin(s.jointStates()[0]!.frictionTorque / (mi.mass * G * Math.hypot(mi.com[0], mi.com[1])));
        setAngleZ(s, id, [0, 0, 0], frac * dz);
        const a0 = angZ(s, id);
        let dev = 0;
        for (let i = 0; i < Math.round(20 / s.fixedDt); i++) {
          s.stepFixed(1);
          dev = Math.max(dev, Math.abs(angZ(s, id) - a0));
        }
        report(`${L}-hole link held at ${frac} × dead zone near its build pose: largest deviation ${dev.toExponential(1)} rad in 20 s`);
        expect(dev).toBeLessThan(3e-5); // HOLD_DEADBAND 1e-5 plus one step of slip
        s.dispose();
      });

  it('a link that has stopped ≈ 180° from its build orientation does not creep', { timeout: 120000 }, async () => {
    // 2-hole link built pointing up; gravity tilted 10° so it falls over, swings and sticks.
    const a = (10 * Math.PI) / 180;
    const s = await Simulation.create(mk([beam([-2, 0, 0], [0, 0, 0]), beam([0, 0, 1], [0, 1, 1]), pin([0, 0, 0], [0, 0, 1])], 1), { gravity: [G * Math.sin(a), -G * Math.cos(a), 0] });
    const id = s.bodyOf(2)!;
    s.stepFixed(Math.round(3 / s.fixedDt));
    const a3 = angZ(s, id);
    s.stepFixed(Math.round(27 / s.fixedDt));
    const moved = Math.abs(unwrap(a3, angZ(s, id)) - a3);
    report(`2-hole link stuck ${((Math.abs(a3) * 180) / Math.PI).toFixed(1)}° from its build pose: moves ${moved.toExponential(1)} rad between 3 and 30 s`);
    expect(Math.abs(a3)).toBeGreaterThan(2.5);
    expect(moved).toBeLessThan(3e-5);
    s.dispose();
  });

  it('a closed loop well inside its friction limit holds (four-bar at μ = MAX_JOINT_FRICTION)', { timeout: 60000 }, async () => {
    const s = await Simulation.create(buildExample('four-bar'), { jointFriction: MAX_JOINT_FRICTION });
    const crank = s.bodyOf(2)!;
    s.stepFixed(Math.round(1 / s.fixedDt));
    const a1 = angZ(s, crank);
    s.stepFixed(Math.round(10 / s.fixedDt));
    const moved = Math.abs(angZ(s, crank) - a1);
    report(`four-bar at μ = ${MAX_JOINT_FRICTION}: crank moves ${moved.toExponential(1)} rad between 1 and 11 s`);
    expect(moved).toBeLessThan(3e-5);
    s.dispose();
  });
});

describe('spin', () => {
  const cases: { label: string; model: () => Model; body: number; w0: number; mu?: number }[] = [
    {
      label: 'centred 5-hole link on a pin (revolute)',
      model: () => mk([beam([0, 0, 0], [0, -1, 0]), beam([-2, 0, 1], [2, 0, 1]), pin([0, 0, 0], [0, 0, 1])], 1),
      body: 1,
      w0: 20,
    },
    // Fix after review: at Low the f32 spin gain (≈ 1.15 %/s of ω, DEVIATIONS §5) ate 17–52 % of
    // friction's deceleration for a long fast rotor; the energy guard now expects friction's work.
    {
      label: 'centred 9-hole beam on a pin at "low", 50 rad/s',
      model: () => mk([beam([0, 0, 0], [0, -1, 0]), beam([-4, 0, 1], [4, 0, 1]), pin([0, 0, 0], [0, 0, 1])], 1),
      body: 1,
      w0: 50,
      mu: JOINT_FRICTION.low,
    },
    {
      label: 'centred 9-hole beam on a pin at "low", 200 rad/s',
      model: () => mk([beam([0, 0, 0], [0, -1, 0]), beam([-4, 0, 1], [4, 0, 1]), pin([0, 0, 0], [0, 0, 1])], 1),
      body: 1,
      w0: 200,
      mu: JOINT_FRICTION.low,
    },
    {
      label: 'axle in a pin hole (cylindrical, rotation axis)',
      model: () => mk([holes([0, 0, 0], [1, 0, 0], 2), axle([0, 0, -2], [0, 0, 2])], 1),
      body: 1,
      w0: 300, // light and thin: τ_f/I ≈ 1800 rad/s², so it needs a fast start to spin for a while
    },
  ];
  for (const c of cases)
    it(`${c.label}: slows at τ_f / I, stops and never speeds up`, { timeout: 120000 }, async () => {
      const s = await Simulation.create(c.model(), { jointFriction: c.mu ?? REALISTIC });
      const tf = s.jointStates()[0]!.frictionTorque;
      const I = s.massInfo(c.body)!.inertia[8]!; // I_zz about the centre of mass, which is on the axis
      const alpha = tf / I;
      const rb = rbOf(s, c.body);
      rb.setLinvel({ x: 0, y: 0, z: 0 }, true);
      rb.setAngvel({ x: 0, y: 0, z: c.w0 }, true);
      let prev = c.w0;
      let rise = 0;
      let riseWin = -Infinity; // largest rise of |ω| over any 0.1 s
      const hist: number[] = [];
      let stopAt = -1;
      let wq = NaN;
      const nq = Math.round((0.25 * c.w0) / alpha / s.fixedDt); // a quarter of the predicted spin-down
      const N = Math.round((c.w0 / alpha + 2) / s.fixedDt);
      for (let i = 1; i <= N; i++) {
        s.stepFixed(1);
        const w = s.bodyVelocity(c.body)!.w[2];
        rise = Math.max(rise, Math.abs(w) - Math.abs(prev));
        prev = w;
        hist.push(Math.abs(w));
        if (hist.length > 48 && stopAt < 0) riseWin = Math.max(riseWin, Math.abs(w) - hist[hist.length - 49]!);
        if (i === nq) wq = w;
        if (stopAt < 0 && Math.abs(w) < 1e-3) stopAt = s.time;
        if (stopAt >= 0) expect(Math.abs(w)).toBeLessThan(1e-3);
      }
      const slope = (c.w0 - wq) / (nq * s.fixedDt);
      report(`spin ${c.label}: ω0 ${c.w0} rad/s, τ_f/I = ${alpha.toFixed(2)} rad/s², measured ${slope.toFixed(2)}; stops at ${stopAt.toFixed(3)} s (predicted ${(c.w0 / alpha).toFixed(3)}), largest step-to-step |ω| rise ${rise.toExponential(1)}`);
      expect(Math.abs(slope / alpha - 1)).toBeLessThan(0.03);
      expect(Math.abs(stopAt - c.w0 / alpha)).toBeLessThan(0.03 * (c.w0 / alpha) + 2 * s.fixedDt);
      // Never speeds up. At "low" a long rotor at 200 rad/s shows single-step rises of < 1e-3 rad/s
      // (f32 noise of Rapier's spin gain, DEVIATIONS §5) but never over 0.1 s.
      expect(riseWin).toBeLessThan(0);
      if (c.mu === undefined) expect(rise).toBeLessThan(1e-6);
      else expect(rise).toBeLessThan(1e-3);
      s.dispose();
    });
});

// Cylindrical / prismatic test models as in joints.test.ts.
function at(k: Axis, t: number, extra: Vec3 = [0, 0, 0]): [number, number, number] {
  const p: [number, number, number] = [extra[0], extra[1], extra[2]];
  p[k] += t;
  return p;
}
/** Fixed 2-hole beam (holes along k); axle along k from −2 to +2 with an arm at +2: slides [−1, +2]. */
function cylModel(k: Axis, axleFirst: boolean): { model: Model; body: number } {
  const u = ((k + 1) % 3) as Axis;
  const v = ((k + 2) % 3) as Axis;
  const frame = holes([0, 0, 0], unitAxis(u) as [number, number, number], k);
  const rod = axle(at(k, -2), at(k, 2));
  const arm: Cell[] = [cell(at(k, 2), 'axleHole', k), cell(at(k, 2, unitAxis(v)), 'pinHole', k)];
  const b = new ModelBuilder();
  const parts = axleFirst ? [rod, arm, frame] : [frame, rod, arm];
  const ids = parts.map((p) => b.add(p));
  return { model: b.root(ids[axleFirst ? 2 : 0]!).build(), body: axleFirst ? 0 : 1 };
}
/** Fixed 2-hole beam; slider of 2 axle holes at +3 along k on two axles: prismatic. */
function prisModel(k: Axis, sliderFirst: boolean): { model: Model; body: number } {
  const u = ((k + 1) % 3) as Axis;
  const eu = unitAxis(u);
  const frame = holes([0, 0, 0], eu as [number, number, number], k);
  const slider = holes(at(k, 3), at(k, 3, eu), k, 'axleHole');
  const a1 = axle(at(k, -1), at(k, 3));
  const a2 = axle(at(k, -1, eu), at(k, 3, eu));
  const b = new ModelBuilder();
  const parts = sliderFirst ? [slider, a1, a2, frame] : [frame, slider, a1, a2];
  const ids = parts.map((p) => b.add(p));
  return { model: b.root(ids[sliderFirst ? 3 : 0]!).build(), body: sliderFirst ? 0 : 1 };
}

describe('slides', () => {
  it('sliding-axle example: the vertical axle reaches its stop at every level, at "realistic" in the free-fall time under (1 − μ)·g', async () => {
    for (const level of LEVELS) {
      const mu = JOINT_FRICTION[level];
      const s = await Simulation.create(buildExample('sliding-axle'), { jointFriction: mu });
      const axleBody = s.bodyOf(2)!;
      const y0 = s.massInfo(axleBody)!.com[1];
      let reach = -1;
      for (let i = 0; i < Math.round(1 / s.fixedDt); i++) {
        s.stepFixed(1);
        if (reach < 0 && y0 - s.massInfo(axleBody)!.com[1] > 1.97) reach = s.time;
      }
      const drop = y0 - s.massInfo(axleBody)!.com[1];
      const pred = Math.sqrt((2 * 1.97) / ((1 - mu) * G));
      report(`sliding-axle ${level}: vertical axle reaches 1.97 at ${reach.toFixed(4)} s (free fall under (1−μ)g: ${pred.toFixed(4)} s), rests at ${drop.toFixed(4)}`);
      expect(Math.abs(drop - 2)).toBeLessThan(0.03);
      expect(reach).toBeGreaterThan(pred - s.fixedDt);
      expect(reach).toBeLessThan(pred * 1.03 + s.fixedDt);
      s.dispose();
    }
  });

  for (const kind of ['cylindrical', 'prismatic'] as const)
    for (const k of [0, 1, 2] as Axis[])
      for (const first of [false, true])
        it(`${kind} along ${'XYZ'[k]}, ${first ? 'moving body = A' : 'moving body = B'}: accelerates at (sin φ − μ)·g, holds below μ, reaches its stop`, async () => {
          const { model, body } = kind === 'cylindrical' ? cylModel(k, first) : prisModel(k, first);
          const u = ((k + 1) % 3) as Axis;
          // Gravity at φ from the transverse axis u toward −k: axial component G·sin φ.
          const grav = (sinPhi: number): Vec3 => {
            const g: Vec3 = [0, 0, 0];
            g[k] = -G * sinPhi;
            g[u] = -G * Math.sqrt(1 - sinPhi * sinPhi);
            return g;
          };
          const pos = (s: Simulation) => s.massInfo(body)!.com[k];
          // Holds: axial load half the friction limit → no slide at all (a horizontal axle at rest does not creep).
          for (const sinPhi of [0, 0.5 * REALISTIC]) {
            const s = await Simulation.create(model, { gravity: grav(sinPhi) });
            expect(s.graph.joints[0]!.type).toBe(kind);
            const x0 = pos(s);
            s.stepFixed(Math.round(3 / s.fixedDt));
            expect(Math.abs(pos(s) - x0)).toBeLessThan(1e-6);
            s.dispose();
          }
          // Slides: axial load twice the limit → x = ½·(sin φ − μ)·g·t² until the stop.
          {
            const sinPhi = 2 * REALISTIC;
            const s = await Simulation.create(model, { gravity: grav(sinPhi) });
            const x0 = pos(s);
            const n = Math.round(0.05 / s.fixedDt);
            s.stepFixed(n);
            const pred = 0.5 * (sinPhi - REALISTIC) * G * (n * s.fixedDt) ** 2;
            expect((x0 - pos(s)) / pred).toBeCloseTo(1, 1);
            s.dispose();
          }
          // Straight down the axis: reaches the stop and stays on it (limits hold with the motor).
          {
            const s = await Simulation.create(model, { gravity: grav(1) });
            const lim = s.graph.joints[0]!.limits!;
            const sign = s.graph.joints[0]!.bodyB === body ? 1 : -1; // limits are B relative to A
            const stop = sign > 0 ? lim[0] : -lim[1];
            const x0 = pos(s);
            s.stepFixed(Math.round(0.5 / s.fixedDt));
            expect(pos(s) - x0).toBeCloseTo(stop, 2);
            s.dispose();
          }
        });
});

/** Range (max − min) of a part's rotation about Z over `seconds`, degrees. */
async function crankRange(name: string, part: number, mu: number, seconds: number): Promise<number> {
  const s = await Simulation.create(buildExample(name), { jointFriction: mu });
  let a = 0;
  let lo = 0;
  let hi = 0;
  for (let i = 0; i < Math.round(seconds / s.fixedDt); i += 4) {
    s.stepFixed(4);
    a = unwrap(a, angleZ(s.partTransform(part)!));
    lo = Math.min(lo, a);
    hi = Math.max(hi, a);
  }
  s.dispose();
  return ((hi - lo) * 180) / Math.PI;
}

describe('linkages still move', () => {
  for (const name of ['four-bar', 'parallelogram'])
    it(`${name}: crank range > 20° at every level`, { timeout: 60000 }, async () => {
      const ranges: string[] = [];
      for (const level of LEVELS) {
        const r = await crankRange(name, 2, JOINT_FRICTION[level], 5);
        ranges.push(`${level} ${r.toFixed(0)}°`);
        expect(r).toBeGreaterThan(20);
      }
      report(`${name} crank range over 5 s: ${ranges.join(', ')}`);
    });
});

describe('level changes', () => {
  it('setJointFriction takes effect on the next step', async () => {
    const a = await Simulation.create(buildExample('pendulum'), { jointFriction: 0 });
    const b = await Simulation.create(buildExample('pendulum'), { jointFriction: 0 });
    a.stepFixed(96);
    b.stepFixed(96);
    expect(b.bodyVelocity(1)!.w).toEqual(a.bodyVelocity(1)!.w);
    b.setJointFriction(REALISTIC);
    a.stepFixed(1);
    b.stepFixed(1);
    const mi = b.massInfo(1)!;
    const Ip = mi.inertia[8]! + mi.mass * (mi.com[0] ** 2 + mi.com[1] ** 2); // pivot at x = y = 0
    const tf = b.jointStates()[0]!.frictionTorque;
    const dw = Math.abs(a.bodyVelocity(1)!.w[2]) - Math.abs(b.bodyVelocity(1)!.w[2]);
    expect(dw / ((tf / Ip) * b.fixedDt)).toBeCloseTo(1, 1);
    a.dispose();
    b.dispose();
  });

  it('switched off while running, it continues exactly as a run created with friction off from that state', { timeout: 60000 }, async () => {
    for (const name of ['pendulum', 'four-bar']) {
      // The energy guard keeps a history (its reference energy), which a new run would not have.
      const a = await Simulation.create(buildExample(name), { jointFriction: REALISTIC, energyGuard: false });
      a.stepFixed(Math.round(1 / a.fixedDt));
      a.setJointFriction(0);
      const b = await Simulation.create(buildExample(name), { jointFriction: 0, energyGuard: false });
      for (const body of a.graph.bodies) {
        if (body.fixed) continue;
        const ra = rbOf(a, body.id);
        const rb = rbOf(b, body.id);
        rb.setTranslation(ra.translation(), true);
        rb.setRotation(ra.rotation(), true);
        rb.setLinvel(ra.linvel(), true);
        rb.setAngvel(ra.angvel(), true);
      }
      expect(a.bodyTransform(1)).toEqual(b.bodyTransform(1));
      let maxd = 0;
      for (let i = 0; i < Math.round(2 / a.fixedDt); i++) {
        a.stepFixed(1);
        b.stepFixed(1);
        for (const body of a.graph.bodies) {
          const ta = a.bodyTransform(body.id)!;
          const tb = b.bodyTransform(body.id)!;
          for (let k = 0; k < 3; k++) maxd = Math.max(maxd, Math.abs(ta.p[k]! - tb.p[k]!));
        }
      }
      report(`${name}: switched off after 1 s vs created off from that state: max position difference over 2 s ${maxd}`);
      expect(maxd).toBe(0);
      a.dispose();
      b.dispose();
    }
  });
});

describe('loose bodies are unaffected by the friction level', () => {
  it('the collision example\'s loose beam follows the same trajectory, bit for bit, at every level', { timeout: 60000 }, async () => {
    const tracks: string[] = [];
    for (const level of LEVELS) {
      const s = await Simulation.create(buildExample('collision'), { jointFriction: JOINT_FRICTION[level] });
      const id = s.bodyOf(6)!;
      expect(s.graph.joints.some((j) => j.bodyA === id || j.bodyB === id)).toBe(false);
      const xs: number[] = [];
      for (let i = 0; i < Math.round(3 / s.fixedDt); i++) {
        s.stepFixed(1);
        const t = s.bodyTransform(id)!;
        xs.push(...t.p, ...t.q);
      }
      tracks.push(xs.join(','));
      s.dispose();
    }
    expect(tracks[1]).toBe(tracks[0]);
    expect(tracks[2]).toBe(tracks[0]);
  });
});

describe('grab', () => {
  it('a jointed body is dragged as easily at "realistic", and on release it stops within the dead zone', { timeout: 60000 }, async () => {
    const lags: number[] = [];
    let restOff = 0;
    let dead = 0;
    for (const mu of [0, REALISTIC]) {
      const s = await Simulation.create(buildExample('pendulum'), { jointFriction: mu });
      const tip: Vec3 = [4, 0, 1];
      expect(s.grab(1, tip)).toBe(true);
      // Hold at the release point for 0.5 s, then drag the tip round to 45° below the horizontal in 0.5 s.
      let lag = 0;
      const n = Math.round(0.5 / s.fixedDt);
      for (let i = 0; i < 2 * n; i++) {
        const a = i < n ? 0 : (-(i - n) / n) * (Math.PI / 4);
        s.dragTo([4 * Math.cos(a), 4 * Math.sin(a), 1]);
        s.stepFixed(1);
        const p = s.grabPoint()!;
        lag = Math.max(lag, Math.hypot(p[0] - 4 * Math.cos(a), p[1] - 4 * Math.sin(a)));
      }
      lags.push(lag);
      if (mu > 0) {
        s.setJointFriction(mu); // allowed while grabbed (no change here)
        s.release();
        s.stepFixed(Math.round(6 / s.fixedDt));
        const mi = s.massInfo(1)!;
        const tf = s.jointStates()[0]!.frictionTorque;
        dead = Math.asin(tf / (mi.mass * G * Math.hypot(mi.com[0], mi.com[1])));
        restOff = Math.abs(swing(s, 1, [0, 0, 1]));
        expect(Math.hypot(...s.bodyVelocity(1)!.w)).toBeLessThan(1e-3);
      }
      s.dispose();
    }
    report(`grab pendulum tip: max lag behind the cursor ${lags[0]!.toFixed(4)} (off) / ${lags[1]!.toFixed(4)} (realistic) units; released at 45°, rests ${((restOff * 180) / Math.PI).toFixed(3)}° off vertical (dead zone ${((dead * 180) / Math.PI).toFixed(3)}°)`);
    // The lag is the grab spring's (its sag g/ω² ≈ 0.31 holding the link out, §5 "Grab"); friction adds ≤ 0.02.
    expect(lags[1]! - lags[0]!).toBeLessThan(0.02);
    expect(restOff).toBeLessThan(dead + 2e-3);
  });

  it('released at rest inside the dead zone, it stays where it was left', async () => {
    const s = await Simulation.create(buildExample('pendulum'));
    const mi = s.massInfo(1)!;
    const dead = Math.asin(s.jointStates()[0]!.frictionTorque / (mi.mass * G * 2));
    const target = -(Math.PI / 2) + 0.6 * dead; // tip angle from +x: 0.6 × dead zone right of straight down
    s.grab(1, [4, 0, 1]);
    for (let i = 0; i < Math.round(1.5 / s.fixedDt); i++) {
      const a = Math.max(target, -(i / Math.round(1 / s.fixedDt)) * (Math.PI / 2));
      s.dragTo([4 * Math.cos(a), 4 * Math.sin(a), 1]);
      s.stepFixed(1);
    }
    s.release();
    s.stepFixed(Math.round(0.5 / s.fixedDt));
    const at0 = swing(s, 1, [0, 0, 1]);
    s.stepFixed(Math.round(2 / s.fixedDt));
    const at1 = swing(s, 1, [0, 0, 1]);
    report(`pendulum left at ${((at0 * 180) / Math.PI).toFixed(3)}° (dead zone ${((dead * 180) / Math.PI).toFixed(3)}°): moves ${(((at1 - at0) * 180) / Math.PI).toExponential(1)}° in 2 s`);
    expect(Math.abs(at0)).toBeLessThan(dead);
    expect(Math.abs(at1 - at0)).toBeLessThan((0.03 * Math.PI) / 180);
    s.dispose();
  });
});
