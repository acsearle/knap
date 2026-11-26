// B8 gears: wheels r 1 (small, "16 teeth") and r 2.5 ("40 teeth") on world hinges (axis Z), 3.5 apart, PxGearJoint 2.5:1.
// Constant torque spins the small one from rest to W rad/s, then released; coast 2 s. node b8.mjs [W=100] [ratioSign=+1]
import * as P from './lib.mjs';
const { PX, TL, physics } = P;
const W = +(process.argv[2] ?? 100), sign = +(process.argv[3] ?? 1);
console.log('B8', P.settingsLine(), 'target', W, 'rad/s');
const s = P.makeScene({ g: -P.G });
const qz = P.qAxisAngle([0, 1, 0], -Math.PI / 2);
const cyl = (r) => [{ geom: P.cylCoreGeom(r, 0.46), local: [[0, 0, 0], P.qAxisAngle([0, 1, 0], Math.PI / 2)] }];
const g1 = P.addDynamic(s, cyl(1), [0, 5, 0], undefined, P.bodyOpts({ gyro: true }));
const g2 = P.addDynamic(s, cyl(2.5), [3.5, 5, 0], undefined, P.bodyOpts({ gyro: true }));
P.setGroup(g1, 2); P.setGroup(g2, 2);
const h1 = TL.RevoluteJointCreate(physics, null, P.tf([0, 5 * P.L, 0], qz), g1, P.tf([0, 0, 0], qz));
const h2 = TL.RevoluteJointCreate(physics, null, P.tf([3.5 * P.L, 5 * P.L, 0], qz), g2, P.tf([0, 0, 0], qz));
const gj = TL.GearJointCreate(physics, g1, P.tf([0, 0, 0], qz), g2, P.tf([0, 0, 0], qz));
console.log('setHinges ok:', gj.setHinges(h1, h2));
// measured: setGearRatio(k) gives w(hinge1) = -k... see README; k = 0.4 makes the small gear turn 2.5x the big one, counter-rotating
gj.setGearRatio(sign * 0.4);
const I1 = 0.5 * P.massG(g1) * 1, I2 = 0.5 * P.massG(g2) * 6.25; // axial inertia m r^2/2 (the mass-space tensor's axes are not in shape order)
const Ieff = I1 + I2 / 6.25; const tau = Ieff * W / 1.0; // reach W in about 1 s
console.log(`I1 ${P.f(I1, 4)} I2 ${P.f(I2, 4)} g*stud^2, torque ${P.f(tau, 4)} g*stud^2/s^2`);
let th1 = 0, th2 = 0, a1p = h1.getAngle(), a2p = h2.getAngle();
const unwrap = (a, p) => { let d = a - p; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return d; };
let work = 0, driving = true, tRel = null, maxErr = 0; const rec = [];
const KE = () => P.kinetic(g1) + P.kinetic(g2); // full rigid-body KE from PhysX's own inertia
const dt = 1 / (480 * P.SET.sub); let t = 0;
const T = 6;
const t0 = P.ms();
while (t < T) {
  const w1 = P.av(g1)[2];
  if (driving && w1 >= W) { driving = false; tRel = t; rec.push(`released at t ${t.toFixed(3)} s: KE ${P.f(KE(), 1)} work ${P.f(work, 1)} (KE/work ${P.f(KE() / work, 4)})`); }
  if (driving) { g1.addTorque(P.v3(0, 0, tau * P.MASS * P.L * P.L)); work += tau * w1 * dt; } // work ~ tau*w*dt (rectangle rule)
  s.step(dt); t += dt;
  const a1 = h1.getAngle(), a2 = h2.getAngle(); th1 += unwrap(a1, a1p); th2 += unwrap(a2, a2p); a1p = a1; a2p = a2;
  const err = th1 + 2.5 * th2 * (Math.sign(sign) || 1) * 1; // external gears counter-rotate: th1 = -2.5 th2
  maxErr = Math.max(maxErr, Math.abs(th1 + 2.5 * th2));
  if (Math.abs(t * 2 - Math.round(t * 2)) < dt / 2) rec.push(`t ${t.toFixed(1)} w1 ${P.f(P.av(g1)[2], 2)} w2 ${P.f(P.av(g2)[2], 2)} ratio w1/w2 ${P.f(P.av(g1)[2] / P.av(g2)[2], 4)} phase err ${P.f(th1 + 2.5 * th2, 5)} rad = ${P.f((th1 + 2.5 * th2) / (2 * Math.PI / 16), 4)} teeth; KE ${P.f(KE(), 1)} work ${P.f(work, 1)}`);
}
console.log(rec.join('\n'));
console.log(`max |phase error| ${P.f(maxErr, 5)} rad = ${P.f(maxErr / (2 * Math.PI / 16), 4)} teeth of the 16; KE end / work ${P.f(KE() / work, 4)}; hinge drift g1 ${P.f(P.len(P.pos(g1).map((x, i) => x - [0, 5, 0][i])))} g2 ${P.f(P.len(P.pos(g2).map((x, i) => x - [3.5, 5, 0][i])))} studs; ${P.f((P.ms() - t0) / T, 1)} ms per simulated s`);
process.exit(0);
