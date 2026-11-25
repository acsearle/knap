// Experiment 1 (friction drive): driver wheel A spins at a fixed ω_A (kinematic, velocity based,
// so it is an ideal motor); wheel B sits on a joint to the fixed world that leaves it free to slide
// along X (toward A) and to rotate about Z — the equivalent of a spring-loaded swing arm with a
// constant pressing force F_N. Gravity is 0 so F_N is the only normal load. A resisting torque on B
// is ramped from 0; Coulomb predicts rolling (slip 0) while τ < μ·F_N·r_B and slip beyond it, so
// μ_eff = τ_crit / (F_N · r_B). Run at 240 substeps (B is jointed).
// Usage: node spikes/wheels/out/drive.mjs
import { DT, RAPIER, addWheel, wheelColliders, fmt, init, makeWorld, now } from './lib';
import type { WheelKind } from './lib';

interface Res {
  muEff: number;
  creep: number;
  fnMeas: number;
  ms: number;
}

function run(kind: WheelKind, rA: number, rB: number, mu: number, fnRel: number): Res {
  const w = makeWorld(240);
  w.gravity = { x: 0, y: 0, z: 0 };
  const omA = 20; // rad/s
  const A = w.createRigidBody(RAPIER.RigidBodyDesc.kinematicVelocityBased());
  for (const cd of wheelColliders(kind, rA)) w.createCollider(cd.setFriction(mu), A);
  const B = addWheel(w, kind, rB, [rA + rB, 0, 0], { softCcd: false });
  B.collider(0).setFriction(mu);
  A.setAngvel({ x: 0, y: 0, z: omA }, true);
  // B: free LinX + AngZ (generic joint, frame X = world X; lock LinY, LinZ, AngX, AngY).
  const fixed = w.createRigidBody(RAPIER.RigidBodyDesc.fixed());
  const M = RAPIER.JointAxesMask;
  w.createImpulseJoint(RAPIER.JointData.generic({ x: rA + rB, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, M.LinY | M.LinZ | M.AngX | M.AngY), fixed, B, true);
  const mB = B.mass();
  const FN = fnRel * mB * 1226.25;
  B.addForce({ x: -FN, y: 0, z: 0 }, true);
  // B starts rolling with A: surface speed ω_A r_A; B turns the other way.
  B.setAngvel({ x: 0, y: 0, z: (-omA * rA) / rB }, true);
  const tauMax = 2 * mu * FN * rB;
  const T = 2;
  const N = Math.round(T / DT);
  let tauCrit = NaN;
  let creep = 0;
  let fnSum = 0;
  let fnN = 0;
  const t0 = now();
  for (let i = 0; i < N; i++) {
    const tau = (tauMax * i) / N;
    B.resetTorques(false);
    B.addTorque({ x: 0, y: 0, z: tau }, true); // resists B's (negative) rotation
    w.step();
    const vs = omA * rA;
    const slip = 1 - (-B.angvel().z * rB) / vs;
    if (tau < 0.5 * mu * FN * rB) {
      creep = Math.max(creep, Math.abs(slip));
      w.contactPair(B.collider(0), A.collider(0), (m) => {
        let s = 0;
        for (let k = 0; k < m.numContacts(); k++) s += m.contactImpulse(k);
        fnSum += s / DT;
        fnN++;
      });
    }
    if (Number.isNaN(tauCrit) && slip > 0.02) tauCrit = tau;
  }
  const ms = now() - t0;
  w.free();
  return { muEff: tauCrit / (FN * rB), creep, fnMeas: fnN ? fnSum / fnN / FN : NaN, ms: ms / T };
}


async function main(): Promise<void> {
  await init();
  console.log('## friction drive: μ_eff = τ_crit/(F_N r_B) (slip > 2 %), creep = max slip at τ < ½ μ F_N r_B, F_N measured / applied');
  console.log('kind\trA\trB\tμ\tF_N/(m_B g)\tμ_eff\tcreep\tF_N meas/appl\tms/sim-s');
  for (const kind of (process.argv[2] ?? 'cyl,b32').split(',') as WheelKind[])
    for (const [rA, rB] of [[1.5, 1.5], [2.5, 1], [1, 2.5], [0.5, 0.5]])
      for (const mu of [0.4, 0.8, 1.2])
        for (const fn of [0.1, 1, 10]) {
          const r = run(kind, rA!, rB!, mu, fn);
          console.log([kind, rA, rB, mu, fn, fmt(r.muEff, 3), fmt(r.creep, 4), fmt(r.fnMeas, 3), fmt(r.ms, 1)].join('\t'));
        }
}

void main();
