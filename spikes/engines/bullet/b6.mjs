// B6 pendulums: node b6.mjs <regime> [--iters=N] [--dtdiv=k]  (rigid btHingeConstraint and btMultiBody)
import { ammo, World, RHO, G_REAL, f, regimeArg, flag, norm, sub, cpuTimer } from './lib.mjs';
const A = await ammo();
const reg = regimeArg(), dtdiv = flag('dtdiv', 1);
const m = RHO * 7 * 0.92 * 0.92, Iz = (m * (49 + 0.92 * 0.92)) / 12, Ix = (m * 2 * 0.92 * 0.92) / 12;
const SECONDS = 10, N = Math.round(SECONDS * 480 * dtdiv);
function rigid(nLinks) {
  const w = new World({ regime: reg, dt: 1 / 480 / dtdiv });
  const links = [];
  for (let i = 0; i < nLinks; i++) links.push(w.body(w.boxShape(3.5, 0.46, 0.46), m, [3 + 6 * i, 0, 0], [0, 0, 0, 1], { mask: 0 }));
  const hinges = [];
  const fr = (x) => w.transform([x, 0, 0]); // hinge axis = frame Z = world Z
  const h0 = new A.btHingeConstraint(links[0], fr(-3), false); w.w.addConstraint(h0, true);
  hinges.push([null, [0, 0, 0], links[0], [-3, 0, 0]]);
  for (let i = 1; i < nLinks; i++) {
    const h = new A.btHingeConstraint(links[i - 1], links[i], fr(3), fr(-3), false); w.w.addConstraint(h, true);
    hinges.push([links[i - 1], [3, 0, 0], links[i], [-3, 0, 0]]);
  }
  const sepErr = () => Math.max(...hinges.map(([a, pa, b, pb]) => norm(sub(a ? w.toWorld(a, pa) : pa, w.toWorld(b, pb)))));
  const E0 = w.energy(); let worst = 0;
  const t = cpuTimer();
  for (let i = 0; i < N; i++) { w.step(); if (i % 8 === 0) worst = Math.max(worst, sepErr()); }
  const ms = t();
  return { dE: w.energy() - E0, worst, ms, iters: w.iterations };
}
function featherstone(nLinks) {
  const w = new World({ regime: reg, dt: 1 / 480 / dtdiv, multibody: true });
  const { S, M, T } = w;
  const inertia = new A.btVector3(Ix * M * S * S, Ix * M * S * S, Iz * M * S * S);
  const mb = new A.btMultiBody(nLinks, 0, new A.btVector3(0, 0, 0), true, false);
  const q0 = new A.btQuaternion(0, 0, 0, 1), axis = new A.btVector3(0, 0, 1);
  for (let i = 0; i < nLinks; i++) mb.setupRevolute(i, m * M, inertia, i - 1, q0, axis, w.L(i === 0 ? 0 : 3, 0, 0), w.L(3, 0, 0), true);
  mb.finalizeMultiDof();
  mb.setLinearDamping(0); mb.setAngularDamping(0); mb.setCanSleep(false);
  mb.setMaxCoordinateVelocity(1e30);
  mb.setBasePos(w.L(0, 0, 0));
  w.w.addMultiBody(mb, 1, 0);
  // planar energy from joint coordinates (real units)
  const energy = () => {
    let th = 0, om = 0, px = 0, py = 0, vx = 0, vy = 0, E = 0;
    for (let i = 0; i < nLinks; i++) {
      th += mb.getJointPos(i); om += mb.getJointVel(i) / T;
      const cx = px + 3 * Math.cos(th), cy = py + 3 * Math.sin(th);
      const cvx = vx - 3 * om * Math.sin(th), cvy = vy + 3 * om * Math.cos(th);
      E += 0.5 * m * (cvx * cvx + cvy * cvy) + 0.5 * Iz * om * om + m * G_REAL * cy;
      px += 6 * Math.cos(th); py += 6 * Math.sin(th); vx -= 6 * om * Math.sin(th); vy += 6 * om * Math.cos(th);
    }
    return E;
  };
  const E0 = energy();
  const t = cpuTimer();
  for (let i = 0; i < N; i++) w.step();
  return { dE: energy() - E0, worst: 0, ms: t(), iters: w.iterations, gyro: mb.getUseGyroTerm() };
}
console.log(`B6 regime=${reg} dt=1/${480 * dtdiv}`);
for (const n of [1, 3]) {
  const ref = m * G_REAL * (n === 1 ? 3 : 3 + 9 + 15);
  const r = rigid(n), fs = featherstone(n);
  console.log(`B6${n === 1 ? 'a' : 'b'} ${n}-link, rigid btHingeConstraint (iters ${r.iters}): dE ${f((100 * r.dE) / ref, 2)} % of swing energy, worst hinge separation ${f(r.worst)} studs, cpu ${f(r.ms / SECONDS, 1)} ms per sim s`);
  console.log(`B6${n === 1 ? 'a' : 'b'} ${n}-link, btMultiBody revolute: dE ${f((100 * fs.dE) / ref, 2)} %, separation 0 by construction, cpu ${f(fs.ms / SECONDS, 1)} ms per sim s`);
}
process.exit(0);
