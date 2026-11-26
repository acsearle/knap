// Independent checks: (1) B6b triple pendulum with PxRevoluteJoint at 4 and 32 TGS position iterations: energy and the
// height link 1 reaches; (2) B9 drive-as-friction creep with more velocity iterations, PGS, and a D6 velocity drive.
// node joints.mjs
import { PX, TL, phys, S, g, T, V, aa, scene, dyn, ms } from './px.mjs';
const qz = aa([0, 1, 0], -Math.PI / 2);
const box = () => [[new PX.PxBoxGeometry(3.5 * S, 0.46 * S, 0.46 * S), undefined, { group: 2, mask: 0 }]];
function triple(pos, vel = 1) {
  const s = scene(); const L = []; let prev = null;
  for (let i = 0; i < 3; i++) {
    const b = dyn(s, box(), [(3 + 6 * i) * S, 0, 0], undefined, { pos, vel });
    TL.RevoluteJointCreate(phys, prev, T(prev ? [3 * S, 0, 0] : [0, 0, 0], qz), b, T([-3 * S, 0, 0], qz));
    L.push(b); prev = b;
  }
  const E = () => L.reduce((a, b) => { const v = b.getLinearVelocity(), w = b.getAngularVelocity(), I = b.getMassSpaceInertiaTensor(); return a + 0.5 * b.getMass() * (v.x ** 2 + v.y ** 2 + v.z ** 2) + 0.5 * (I.x * w.x ** 2 + I.y * w.y ** 2 + I.z * w.z ** 2) + b.getMass() * g * b.getGlobalPose().p.y; }, 0);
  const swing = L.reduce((a, b, i) => a + b.getMass() * g * (3 + 6 * i) * S, 0);
  const E0 = E(); const rec = []; let maxY = -9; const t0 = ms();
  for (let i = 1; i <= 4800; i++) { s.step(1 / 480); if (i > 2400) maxY = Math.max(maxY, L[2].getGlobalPose().p.y / S); if (i % 960 === 0) rec.push((100 * (E() - E0) / swing).toFixed(2)); }
  console.log(`B6b PxRevoluteJoint TGS ${pos}/${vel}: dE every 2 s (% swing) ${rec.join(' ')}; link 3 highest COM in 5-10 s ${maxY.toFixed(2)} studs (release 0); ${((ms() - t0) / 10).toFixed(1)} ms/sim s incl readout`);
}
triple(4); triple(32); triple(8, 4);
function fric(kind, k, { pgs = false, vel = 1, pos = 4 } = {}) {
  const s = scene({ pgs });
  const b = dyn(s, box(), [3 * S, 0, 0], undefined, { pos, vel });
  const tg = b.getMass() * g * 3 * S; // gravity torque at horizontal (N m)
  let ang;
  if (kind === 'rev') {
    const j = TL.RevoluteJointCreate(phys, null, T([0, 0, 0], qz), b, T([-3 * S, 0, 0], qz));
    j.setRevoluteJointFlag(PX.PxRevoluteJointFlagEnum.eDRIVE_ENABLED, true); j.setDriveVelocity(0); j.setDriveForceLimit(k * tg);
    ang = () => j.getAngle();
  } else { // D6: free twist, velocity drive = pure damping drive with force limit (a viscous-capped approximation of friction)
    const j = TL.D6JointCreate(phys, null, T([0, 0, 0], qz), b, T([-3 * S, 0, 0], qz));
    j.setMotion(PX.PxD6AxisEnum.eTWIST, PX.PxD6MotionEnum.eFREE);
    j.setDrive(PX.PxD6DriveEnum.eTWIST, new PX.PxD6JointDrive(0, 1e3, k * tg, false));
    j.setDriveVelocity(V(0, 0, 0), V(0, 0, 0));
    ang = () => j.getTwistAngle();
  }
  const rec = []; for (let i = 1; i <= 960; i++) { s.step(1 / 480); if (i % 192 === 0) rec.push(ang().toFixed(4)); }
  console.log(`B9 ${kind} drive v=0 limit ${k} x gravity torque ${pgs ? 'PGS' : 'TGS'} ${pos}/${vel}: angle every 0.4 s ${rec.join(' ')}`);
}
for (const k of [1.2, 0.8]) fric('rev', k);
fric('rev', 1.2, { vel: 8 }); fric('rev', 1.2, { pos: 32 }); fric('rev', 1.2, { pgs: true, vel: 8 });
for (const k of [1.2, 0.8, 1e-3]) fric('d6', k);
process.exit(0);
