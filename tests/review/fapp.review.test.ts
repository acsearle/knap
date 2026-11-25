// Review "fapp" (joint friction as the owner meets it). Tests marked DEFECT fail by design: they
// assert the behaviour the owner asked for ("swings a believable number of times and then STOPS";
// the UI's own Realistic tooltip/status: "a swing dies down within seconds").
// Fixer: the DEFECT test passes after the load-estimate fix (triple pendulum at rest from 6.5 s).
import { describe, expect, it } from 'vitest';
import { EXAMPLES } from '../../src/core/examples';
import { JOINT_FRICTION, Simulation } from '../../src/physics/sim';
import { R_BORE } from '../../src/geometry/dims';

const G = 1226.25;

/** Time (s) after which no dynamic body turns > 1e-3 rad or moves > 1e-3 units per 0.5 s window. */
async function restTime(name: string, mu: number, seconds: number): Promise<number> {
  const s = await Simulation.create(EXAMPLES.find((e) => e.name === name)!.build(), { jointFriction: mu });
  const dyn = s.graph.bodies.filter((b) => !b.fixed).map((b) => b.id);
  const pose = () => dyn.map((id) => s.bodyTransform(id));
  let prev = pose();
  let lastMove = 0;
  const win = Math.round(0.5 / s.fixedDt);
  for (let t = 0.5; t <= seconds + 1e-9; t += 0.5) {
    s.stepFixed(win);
    const cur = pose();
    const moved = cur.some((c, i) => {
      const p = prev[i];
      if (!c || !p) return false;
      const d = Math.abs(c.q[0] * p.q[0] + c.q[1] * p.q[1] + c.q[2] * p.q[2] + c.q[3] * p.q[3]);
      return 2 * Math.acos(Math.min(1, d)) > 1e-3 || Math.hypot(c.p[0] - p.p[0], c.p[1] - p.p[1], c.p[2] - p.p[2]) > 1e-3;
    });
    if (moved) lastMove = t;
    prev = cur;
  }
  s.dispose();
  return lastMove;
}

describe('fapp: what the owner sees at the default level', () => {
  it('DEFECT: the triple-pendulum example at Realistic is at rest within 8 simulated s (pendulum: 4 s)', { timeout: 120000 }, async () => {
    const t = await restTime('triple-pendulum', JOINT_FRICTION.realistic, 30);
    // Measured: 17.0 s (= 68 s of wall time at the default ¼× speed).
    expect(t).toBeLessThanOrEqual(8);
  });

  it('dead zone asin(τ_f/(m·g·d)) of single-pivot examples (informational; passes)', async () => {
    const out: string[] = [];
    for (const [name, pivot] of [['pendulum', [0, 0, 1]], ['weld-test', [0, 0, 1]], ['sliding-axle', [4, 1, 0]]] as const) {
      const s = await Simulation.create(EXAMPLES.find((e) => e.name === name)!.build(), { jointFriction: JOINT_FRICTION.realistic });
      for (const st of s.jointStates()) {
        if (!(st.frictionTorque > 0)) continue;
        // the jointed dynamic body
        const b = s.graph.bodies.find((x) => !x.fixed && (x.id === st.bodyA || x.id === st.bodyB));
        if (!b) continue;
        const mi = s.massInfo(b.id)!;
        const axis = s.graph.joints[st.index]!.axis;
        const r = [0, 1, 2].filter((k) => k !== axis).map((k) => mi.com[k]! - pivot[k]!);
        const d = Math.hypot(r[0]!, r[1]!);
        const dz = (Math.asin(Math.min(1, st.frictionTorque / (mi.mass * G * d))) * 180) / Math.PI;
        out.push(`${name} body ${b.id}: m ${mi.mass.toFixed(2)} d ${d.toFixed(3)} τ_f ${st.frictionTorque.toFixed(1)} dead zone ${dz.toFixed(2)}° (μ·R_BORE/d = ${((0.2 * R_BORE) / d).toFixed(4)})`);
      }
      s.dispose();
    }
    console.log(out.join('\n'));
    expect(out.length).toBeGreaterThan(0);
  });
});
