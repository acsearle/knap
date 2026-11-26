// B7 free asymmetric body (beam 5 + cube on one end, at right angles), zero g, 20 rad/s about a non-principal axis, 30 s.
// node b7.mjs   (runs gyroscopic forces off = PhysX default, and on)
import * as P from './lib.mjs';
const { PX } = P;
console.log('B7', P.settingsLine());
for (const gyro of [false, true]) {
  const s = P.makeScene({ g: 0 });
  const b = P.addDynamic(s, [{ geom: P.boxGeom(2.5, 0.46, 0.46) }, { geom: P.boxGeom(0.46, 0.46, 0.46), local: [[2, 0.92, 0], [0, 0, 0, 1]] }], [0, 0, 0], undefined, P.bodyOpts({ gyro }));
  const ax = [0.3, 1, 0.2]; const n = Math.hypot(...ax);
  P.setAv(b, ax.map((x) => 20 * x / n));
  const I = b.getMassSpaceInertiaTensor(), cq = b.getCMassLocalPose().q;
  const E0 = P.kinetic(b), L0 = P.angMom(b);
  const rec = [];
  const t0 = P.ms();
  P.stepReal(s, 30, (t, i) => { if (i % (480 * P.SET.sub * 5) === 0) rec.push(`${t.toFixed(0)}s E ${P.f(100 * (P.kinetic(b) - E0) / E0, 2)}% |L| ${P.f(100 * (P.len(P.angMom(b)) - P.len(L0)) / P.len(L0), 2)}% Ldir ${P.f(P.angleBetween(P.angMom(b), L0) * 180 / Math.PI, 2)}deg`); });
  const E = P.kinetic(b), L = P.angMom(b);
  console.log(`gyroscopic ${gyro ? 'ON (eENABLE_GYROSCOPIC_FORCES)' : 'off (default)'}: principal I ${[I.x, I.y, I.z].map((x) => P.f(x, 3)).join(',')} (CM frame q ${[cq.x, cq.y, cq.z, cq.w].map((x) => P.f(x, 3)).join(',')})`);
  console.log(`  ${rec.join(' | ')}`);
  console.log(`  rate: E ${P.f(100 * (E - E0) / E0 / 30, 3)} %/s, |L| ${P.f(100 * (P.len(L) - P.len(L0)) / P.len(L0) / 30, 3)} %/s, L direction moved ${P.f(P.angleBetween(L, L0) * 180 / Math.PI, 2)} deg in 30 s; |w| end ${P.f(P.len(P.av(b)), 3)}; ${P.f((P.ms() - t0) / 30, 2)} ms per simulated s`);
}
process.exit(0);
