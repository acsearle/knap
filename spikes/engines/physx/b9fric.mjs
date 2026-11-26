// Revolute drive used as friction: velocity target 0, force limit k x gravity torque. node b9fric.mjs
import * as P from './lib.mjs';
const { PX, TL, physics } = P;
console.log('b9fric', P.settingsLine());
const qz = P.qAxisAngle([0, 1, 0], -Math.PI / 2), F = PX.PxRevoluteJointFlagEnum;
const IMP = process.env.IMP === "1"; if (IMP) console.log("limit passed as impulse per step: k x tg x dt");
for (const k of [null, 0, 0.5, 0.8, 1.2, 10, 1e6]) {
  const s = P.makeScene();
  const b = P.addDynamic(s, [{ geom: P.boxGeom(3.5, 0.46, 0.46) }], [3, 0, 0], undefined, P.bodyOpts());
  const j = TL.RevoluteJointCreate(physics, null, P.tf([0, 0, 0], qz), b, P.tf([-3 * P.L, 0, 0], qz));
  const tg = P.massG(b) * 1226.25 * 3 * P.MASS * P.L * P.L;
  if (k !== null) { j.setRevoluteJointFlag(F.eDRIVE_ENABLED, true); j.setDriveVelocity(0); j.setDriveForceLimit(k * tg * (IMP ? 1 / (480 * P.SET.sub) : 1)); }
  const rec = []; P.stepReal(s, 2, (t, i) => { if (i % 192 === 0) rec.push(P.f(j.getAngle(), 4)); });
  console.log(`k ${k ?? 'no drive'} (limit read back ${P.f(j.getDriveForceLimit() / tg, 3)} x): angle every 0.4 s ${rec.join(' ')}`);
}
process.exit(0);
