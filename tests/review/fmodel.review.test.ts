// Adversarial review of the joint-friction MODEL (reviewer "fmodel"; DESIGN §5.1 "Joint friction",
// §5.3 "With friction on"). Every test asserts the specified / intended behaviour; the ones marked
// DEFECT fail on the code as reviewed. Measured numbers are in the review report.
// Fixer: all pass after the load-estimate, stiction-hold and energy-guard fixes (DEVIATIONS §5 "Joint friction").
import { describe, expect, it } from 'vitest';
import { ModelBuilder, beam, buildExample, pin } from '../../src/core/examples';
import type { Model } from '../../src/core/types';
import { G, JOINT_FRICTION, Simulation } from '../../src/physics';

type RB = {
  rotation(): { x: number; y: number; z: number; w: number };
  angvel(): { x: number; y: number; z: number };
  setTranslation(v: object, w: boolean): void;
  setRotation(q: object, w: boolean): void;
  setLinvel(v: object, w: boolean): void;
  setAngvel(v: object, w: boolean): void;
};
const rbOf = (s: Simulation, id: number) => (s as unknown as { bodies: { rb: RB; ref: number[] }[] }).bodies[id]!;

/** Rotate a body (from its build pose) by th about +Z through `pivot`, at rest. */
function setAngleZ(s: Simulation, id: number, pivot: [number, number, number], th: number): void {
  const { rb, ref } = rbOf(s, id);
  const c = Math.cos(th);
  const sn = Math.sin(th);
  const dx = ref[0]! - pivot[0];
  const dy = ref[1]! - pivot[1];
  rb.setTranslation({ x: pivot[0] + c * dx - sn * dy, y: pivot[1] + sn * dx + c * dy, z: ref[2] }, true);
  rb.setRotation({ x: 0, y: 0, z: Math.sin(th / 2), w: Math.cos(th / 2) }, true);
  rb.setLinvel({ x: 0, y: 0, z: 0 }, true);
  rb.setAngvel({ x: 0, y: 0, z: 0 }, true);
}
const angZ = (s: Simulation, id: number) => {
  const q = rbOf(s, id).rb.rotation();
  return 2 * Math.atan2(q.z, q.w);
};

/** Serial chain hanging from a fixed beam at the origin: links of `lens` holes along +x, one layer further out each. */
function chain(lens: number[]): Model {
  const b = new ModelBuilder();
  const frame = b.add(beam([-2, 0, 0], [0, 0, 0]));
  let x = 0;
  lens.forEach((L, i) => {
    b.add(beam([x, 0, i + 1], [x + L - 1, 0, i + 1]));
    b.add(pin([x, 0, i], [x, 0, i + 1]));
    x += L - 1;
  });
  return b.root(frame).build();
}

/** Seconds (sampled every 0.5 s) after which no dynamic body turned more than 1e-3 rad per 0.5 s, or `seconds` if it never settled. */
function restTime(s: Simulation, seconds: number): number {
  const dyn = s.graph.bodies.filter((b) => !b.fixed).map((b) => b.id);
  const pose = () => dyn.map((id) => s.bodyTransform(id)!.q);
  let prev = pose();
  let restAt = 0;
  const win = Math.round(0.5 / s.fixedDt);
  for (let i = 1; i <= Math.round(seconds / s.fixedDt); i++) {
    s.stepFixed(1);
    if (i % win) continue;
    const cur = pose();
    let a = 0;
    cur.forEach((q, k) => {
      const d = Math.abs(q.reduce((acc, x, m) => acc + x * prev[k]![m]!, 0));
      a = Math.max(a, 2 * Math.acos(Math.min(1, d)));
    });
    if (a > 1e-3) restAt = s.time;
    prev = cur;
  }
  return restAt;
}

describe('fmodel: stiction', () => {
  // DEFECT: a link released at rest inside its dead zone creeps (linearly, ~0.06°/s for a 2-hole
  // link) when it rests near its build orientation. DESIGN §5.1: "stays at rest without creeping";
  // task: released from inside the dead zone it must not move at all.
  for (const L of [2, 5])
    it(`a ${L}-hole link built hanging, released at rest at 0.9 × the dead zone, does not move in 20 s`, { timeout: 60000 }, async () => {
      const b = new ModelBuilder();
      const frame = b.add(beam([-2, 0, 0], [0, 0, 0]));
      b.add(beam([0, 0, 1], [0, -(L - 1), 1]));
      b.add(pin([0, 0, 0], [0, 0, 1]));
      const s = await Simulation.create(b.root(frame).build());
      const id = s.bodyOf(2)!;
      const mi = s.massInfo(id)!;
      const dz = Math.asin(s.jointStates()[0]!.frictionTorque / (mi.mass * G * Math.hypot(mi.com[0], mi.com[1])));
      setAngleZ(s, id, [0, 0, 0], 0.9 * dz);
      const a0 = angZ(s, id);
      let dev = 0;
      for (let i = 0; i < Math.round(20 / s.fixedDt); i++) {
        s.stepFixed(1);
        dev = Math.max(dev, Math.abs(angZ(s, id) - a0));
      }
      s.dispose();
      expect(dev).toBeLessThan(1e-4);
    });

  it('control: the same link built horizontal and rotated to the same pose does not move (passes)', { timeout: 60000 }, async () => {
    const b = new ModelBuilder();
    const frame = b.add(beam([-2, 0, 0], [0, 0, 0]));
    b.add(beam([0, 0, 1], [1, 0, 1]));
    b.add(pin([0, 0, 0], [0, 0, 1]));
    const s = await Simulation.create(b.root(frame).build());
    const id = s.bodyOf(2)!;
    const mi = s.massInfo(id)!;
    const dz = Math.asin(s.jointStates()[0]!.frictionTorque / (mi.mass * G * Math.hypot(mi.com[0], mi.com[1])));
    setAngleZ(s, id, [0, 0, 0], -Math.PI / 2 + 0.9 * dz);
    const a0 = angZ(s, id);
    let dev = 0;
    for (let i = 0; i < Math.round(20 / s.fixedDt); i++) {
      s.stepFixed(1);
      dev = Math.max(dev, Math.abs(angZ(s, id) - a0));
    }
    s.dispose();
    expect(dev).toBeLessThan(1e-4);
  });
});

describe('fmodel: load estimate m_j', () => {
  // DEFECT (owner intent: "things keep swinging longer than I'd expect"): with m_j = the lighter
  // body, a short link carrying a long one gets ~1/10 of the friction its real load implies, and the
  // pair is still swinging ±15° after 110 s at Realistic.
  it('a 2-hole link carrying a 15-hole link, released horizontal, is at rest by 30 s at Realistic', { timeout: 120000 }, async () => {
    const s = await Simulation.create(chain([2, 15]));
    const t = restTime(s, 40);
    s.dispose();
    expect(t).toBeLessThan(30);
  });
});

describe('fmodel: spin-down', () => {
  // DEFECT: DESIGN §5.3 "a rotor spun up slows at τ_f / I". At Low, the f32 spin gain (∝ ω) eats a
  // large part of τ_f for a long rotor: a 9-hole beam at 50 rad/s decelerates 17 % slower than τ_f/I.
  it('a centred 9-hole beam spun at 50 rad/s at Low decelerates at τ_f / I (±5 %)', { timeout: 60000 }, async () => {
    const b = new ModelBuilder();
    const frame = b.add(beam([-2, 0, 0], [0, 0, 0]));
    b.add(beam([-4, 0, 1], [4, 0, 1]));
    b.add(pin([0, 0, 0], [0, 0, 1]));
    const s = await Simulation.create(b.root(frame).build(), { jointFriction: JOINT_FRICTION.low });
    const id = s.bodyOf(2)!;
    const I = s.massInfo(id)!.inertia[8]!;
    const alpha = s.jointStates()[0]!.frictionTorque / I;
    rbOf(s, id).rb.setAngvel({ x: 0, y: 0, z: 50 }, true);
    s.stepFixed(48);
    const w1 = rbOf(s, id).rb.angvel().z;
    s.stepFixed(Math.round(4 / s.fixedDt));
    const w2 = rbOf(s, id).rb.angvel().z;
    s.dispose();
    const measured = (w1 - w2) / 4;
    expect(Math.abs(measured / alpha - 1)).toBeLessThan(0.05);
  });
});

describe('fmodel: checks that pass (kept as regression guards)', () => {
  it('breakaway torque equals τ_f = μ·m_j·|g|·R_BORE (energy guard off: it caps external work)', async () => {
    for (const k of [0.98, 1.1]) {
      const b = new ModelBuilder();
      const frame = b.add(beam([-2, 0, 0], [0, 0, 0]));
      b.add(beam([-2, 0, 1], [2, 0, 1]));
      b.add(pin([0, 0, 0], [0, 0, 1]));
      const s = await Simulation.create(b.root(frame).build(), { energyGuard: false });
      const id = s.bodyOf(2)!;
      const tf = s.jointStates()[0]!.frictionTorque;
      const I = s.massInfo(id)!.inertia[8]!;
      (rbOf(s, id).rb as unknown as { addTorque(t: object, w: boolean): void }).addTorque({ x: 0, y: 0, z: k * tf }, true);
      s.stepFixed(240);
      const w = rbOf(s, id).rb.angvel().z;
      if (k < 1) expect(Math.abs(w)).toBeLessThan(1e-6);
      else expect(w / (((k - 1) * tf) / I) / 0.5).toBeCloseTo(1, 1);
      s.dispose();
    }
  });

  it('the triple-pendulum example is at rest by 30 s at Realistic', { timeout: 120000 }, async () => {
    const s = await Simulation.create(buildExample('triple-pendulum'));
    const t = restTime(s, 30);
    s.dispose();
    expect(t).toBeLessThan(30);
  });
});
