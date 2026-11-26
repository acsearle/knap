// B2 flat impact of a cube at 150 and 300 studs/s; B3 free fall 1.5 s. node b23.mjs
import * as P from './lib.mjs';
console.log('B2/B3', P.settingsLine(), '(CCD off; PhysX contact offset default 0.02 x length)');
for (const floor of ['plane', 'box']) for (const v of [150, 300]) {
  const s = P.makeScene();
  if (floor === 'box') P.addStatic(s, P.boxGeom(20, 0.5, 20), [0, -0.5, 0]); else P.addPlane(s, 0);
  const b = P.addDynamic(s, [{ geom: P.boxGeom(0.46, 0.46, 0.46) }], [0, 0.46 + 0.6 * v / 480 + 0.01, 0], undefined, P.bodyOpts());
  P.setLv(b, [0, -v, 0]);
  let deep = 0, vyMax = -1e9;
  P.stepReal(s, 0.3, (t) => { deep = Math.max(deep, 0.46 - P.pos(b)[1]); if (t > 0.002) vyMax = Math.max(vyMax, P.lv(b)[1]); });
  console.log(`B2 ${floor} ${v} studs/s: deepest penetration ${P.f(deep)} studs, max rebound vy ${P.f(vyMax, 3)}, sideways ${P.f(Math.hypot(P.lv(b)[0], P.lv(b)[2]))} studs/s, spin ${P.f(P.len(P.av(b)))} rad/s, final y ${P.f(P.pos(b)[1])}`);
}
{
  const s = P.makeScene();
  const b = P.addDynamic(s, [{ geom: P.boxGeom(0.46, 0.46, 0.46) }], [0, 0, 0], undefined, P.bodyOpts());
  const rec = []; P.stepReal(s, 1.5, (t, i) => { if (i % (240 * P.SET.sub) === 0) rec.push(`t ${t.toFixed(1)} v ${P.f(-P.lv(b)[1], 2)} (g t ${P.f(1226.25 * t, 2)})`); });
  console.log('B3 free fall:', rec.join('; '));
  const s2 = P.makeScene(); const d = P.physics.createRigidDynamic(P.tf()); console.log('  default rigid-dynamic max linear velocity', d.getMaxLinearVelocity(), ', max angular', d.getMaxAngularVelocity(), '(the battery scripts set 1e9 for both)');
}
process.exit(0);
