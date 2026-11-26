// Independent B8 check: PxGearJoint between two world revolutes (axis Z, 3.5 studs apart), r 1 and r 2.5 discs
// (any shape works: they never touch). Spin up the small one to W rad/s with a constant torque, then coast for a
// long time; track the integrated phase error th1 + 2.5 th2 (external gears counter-rotate) over 30 s.
// node gear.mjs [W=100] [coast=30] [gyro=1] [sub=1]
import { PX, TL, phys, S, T, V, aa, scene, dyn, ms } from './px.mjs';
const W = +(process.argv[2] ?? 100), COAST = +(process.argv[3] ?? 30), GYRO = (process.argv[4] ?? '1') === '1', SUB = +(process.argv[5] ?? 1);
const s = scene();
const disc = (r) => [[PX.PxConvexCoreGeometryFactory.prototype.createFromCylinder(new PX.PxConvexCoreCylinder(0.92 * S, r * S), 0), T([0, 0, 0], aa([0, 1, 0], Math.PI / 2)), { group: 2, mask: 0 }]];
const a = dyn(s, disc(1), [0, 0, 0], undefined, { gyro: GYRO });
const b = dyn(s, disc(2.5), [3.5 * S, 0, 0], undefined, { gyro: GYRO });
const q = aa([0, 1, 0], -Math.PI / 2);
const h1 = TL.RevoluteJointCreate(phys, null, T([0, 0, 0], q), a, T([0, 0, 0], q));
const h2 = TL.RevoluteJointCreate(phys, null, T([3.5 * S, 0, 0], q), b, T([0, 0, 0], q));
const gj = TL.GearJointCreate(phys, a, T([0, 0, 0], q), b, T([0, 0, 0], q));
gj.setHinges(h1, h2); gj.setGearRatio(0.4);
// axial inertias straight from PhysX (largest/smallest components ambiguous: use I about world Z via m r^2/2 check)
const Ia = a.getMass() * (S * 1) ** 2 / 2, Ib = b.getMass() * (S * 2.5) ** 2 / 2;
const tau = (Ia + Ib / 6.25) * W; // reaches W in ~1 s
const dt = 1 / (480 * SUB);
const qa = (x) => { const q = x.getGlobalPose().q; return 2 * Math.atan2(q.z, q.w); };
const unw = (d) => { while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return d; };
let pa = qa(a), pb = qa(b), ph1 = 0, ph2 = 0, maxPErr = 0;
let t = 0, th1 = 0, th2 = 0, work = 0, released = false, maxErr = 0; const rec = [];
const KE = () => 0.5 * Ia * a.getAngularVelocity().z ** 2 + 0.5 * Ib * b.getAngularVelocity().z ** 2;
const t0 = ms();
while (t < 1.5 + COAST) {
  const w1 = a.getAngularVelocity().z, w2 = b.getAngularVelocity().z;
  if (!released && w1 >= W) { released = true; rec.push(`released t ${t.toFixed(3)}`); }
  if (!released) a.addTorque(V(0, 0, tau));
  s.step(dt); t += dt;
  const w1n = a.getAngularVelocity().z, w2n = b.getAngularVelocity().z;
  if (!released) work += tau * 0.5 * (w1 + w1n) * dt; // trapezoid on the applied torque
  th1 += 0.5 * (w1 + w1n) * dt; th2 += 0.5 * (w2 + w2n) * dt; // integrated angles from body velocities (independent of joint angle readout)
  const na = qa(a), nb = qa(b); ph1 += unw(na - pa); ph2 += unw(nb - pb); pa = na; pb = nb; maxPErr = Math.max(maxPErr, Math.abs(ph1 + 2.5 * ph2));
  const err = th1 + 2.5 * th2; maxErr = Math.max(maxErr, Math.abs(err));
  if (Math.abs(t - Math.round(t / 5) * 5) < dt / 2 && t > 1) rec.push(`t ${t.toFixed(0)} w1 ${w1n.toFixed(3)} w2 ${w2n.toFixed(3)} err ${(err / (2 * Math.PI / 16)).toFixed(4)} poseErr ${((ph1 + 2.5 * ph2) / (2 * Math.PI / 16)).toFixed(4)} teeth KE/work ${(KE() / work).toFixed(4)}`);
}
console.log(`gear W ${W} gyro ${GYRO} dt 1/${480 * SUB}: ${rec.join(' | ')}\n  max |err| from velocities ${(maxErr / (2 * Math.PI / 16)).toFixed(4)} teeth, from body poses ${(maxPErr / (2 * Math.PI / 16)).toFixed(4)} teeth (end ${((ph1 + 2.5 * ph2) / (2 * Math.PI / 16)).toFixed(4)}); hinge drift ${Math.hypot(a.getGlobalPose().p.x, a.getGlobalPose().p.y) / S} studs; ${((ms() - t0) / t).toFixed(1)} ms/sim s`);
process.exit(0);
