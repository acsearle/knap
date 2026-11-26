// B9 hinge extras (functional checks) and B10 cost. Usage: node api.mjs [regime ...] [--csteps=N]
import { World, Jolt, REGIME_NAMES, fmt, G_REAL, LAYER_GHOST } from './lib.mjs';
const args = process.argv.slice(2);
const regimes = args.filter(a => !a.startsWith('--'));
const opt = Object.fromEntries(args.filter(a => a.startsWith('--')).map(a => a.slice(2).split('=')).map(([k, v]) => [k, +v]));
const RUN = regimes.length ? regimes : REGIME_NAMES;
const S = 480;
const out = (...a) => console.log(...a);

function pendulum(R, setup) {
  const w = new World(R, { collisionSteps: opt.csteps ?? 1 });
  const b = w.add(w.box(3.5, 0.46, 0.46), { pos: [3, 0, 0] });
  const h = w.hinge(null, b, [0, 0, 0], [0, 0, 1]);
  const g = G_REAL * w.L / w.T ** 2;
  const mgL = w.mass(b) * g * w.len(3); // internal N m
  setup?.(h, mgL, w, b);
  return { w, b, h, mgL };
}

for (const R of RUN) {
  out(`\n===== regime ${R} =====`);
  // friction
  for (const f of [1.2, 0.8]) {
    const { w, h } = pendulum(R, (h, mgL) => h.SetMaxFrictionTorque(f * mgL));
    w.step(S);
    out(`B9 friction (HingeConstraint.SetMaxFrictionTorque = ${f} mgL): angle after 1 s ${fmt(h.GetCurrentAngle())} rad`);
    w.destroy();
  }
  // motor with max torque: velocity motor lifting the pendulum at 2 rad/s
  for (const f of [0.7, 1.5]) {
    const { w, h, mgL } = pendulum(R, (h, mgL, w) => {
      const ms = h.GetMotorSettings(); ms.mMinTorqueLimit = -f * mgL; ms.mMaxTorqueLimit = f * mgL;
      h.SetMotorState(Jolt.EMotorState_Velocity); h.SetTargetAngularVelocity(w.ang(2));
    });
    w.step(S / 4);
    out(`B9 motor (EMotorState_Velocity, MotorSettings.mMaxTorqueLimit = ${f} mgL, target +2 rad/s): angle after 0.25 s ${fmt(h.GetCurrentAngle())} rad (unloaded would be +0.5), motor lambda/dt ${fmt(h.GetTotalLambdaMotor() / w.dtInt / mgL)} mgL (limit ${fmt(f)} mgL)`);
    w.destroy();
  }
  // limits
  {
    const { w, h, mgL } = pendulum(R, h => h.SetLimits(-0.3, 0.3));
    let mn = 9; for (let i = 0; i < 2 * S; i++) { w.step(); mn = Math.min(mn, h.GetCurrentAngle()); }
    out(`B9 limits (SetLimits(-0.3, 0.3)): lowest angle ${fmt(mn)} rad, final ${fmt(h.GetCurrentAngle())}, limit lambda/dt ${fmt(h.GetTotalLambdaRotationLimits() / w.dtInt / mgL)} mgL`);
    w.destroy();
  }
  // reaction force on a hanging pendulum at rest: start hanging straight down
  {
    const w = new World(R);
    const b = w.add(w.box(0.46, 3.5, 0.46), { pos: [0, -3, 0] });
    const h = w.hinge(null, b, [0, 0, 0], [0, 0, 1]);
    w.step(S);
    const lam = h.GetTotalLambdaPosition(); // impulse over the last step, internal N s
    const F = [lam.GetX(), lam.GetY(), lam.GetZ()].map(x => x / w.dtInt);
    const mg = w.mass(b) * G_REAL * w.L / w.T ** 2;
    out(`B9 reaction (GetTotalLambdaPosition()/dt): F = [${F.map(x => fmt(x / mg)).join(', ')}] x m g (expect magnitude 1)`);
    w.destroy();
  }
  // B10 cost
  {
    const w = new World(R, { collisionSteps: opt.csteps ?? 1, velocitySteps: opt.vsteps ?? 10 });
    w.add(w.plane(), { dynamic: false });
    const links = [0, 1, 2].map(i => w.add(w.box(3.5, 0.46, 0.46), { pos: [3 + 6 * i, 30, i], layer: LAYER_GHOST }));
    w.hinge(null, links[0], [0, 30, 0], [0, 0, 1]);
    for (let i = 1; i < 3; i++) w.hinge(links[i - 1], links[i], [6 * i, 30, i - 0.5], [0, 0, 1]);
    const cubes = [];
    for (let i = 0; i < 20; i++) cubes.push(w.add(w.box(0.46, 0.46, 0.46), { pos: [-10 + (i % 3) * 0.95, 0.46 + Math.floor(i / 3) * 0.93, (i % 2) * 0.3] }));
    w.step(S / 4); // warm up
    const t0 = performance.now();
    w.step(2 * S);
    const ms = (performance.now() - t0) / 2;
    const top = Math.max(...cubes.map(c => w.pos(c)[1]));
    out(`B10 cost (triple pendulum + 20-cube pile, csteps ${w.cSteps}, vsteps ${w.vSteps}): ${fmt(ms, 1)} ms CPU per real second simulated = ${fmt(ms / S * 1000, 1)} us per 1/480 s step; pile top y ${fmt(top, 2)}`);
    w.destroy();
  }
}
process.exit(0);
