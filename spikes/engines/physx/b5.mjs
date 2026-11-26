// B5 wheel tests. node b5.mjs [core|hull64|hull32]   (wheel = cylinder r, length 0.92, axis along Z, rolls along X)
import * as P from './lib.mjs';
const kind = process.argv[2] ?? 'core';
console.log('B5', kind, P.settingsLine());
const HL = 0.46;
// orientation that puts the shape's own axis onto world Z
// convex core cylinder: axis is the shape's X (checked with axisCheck below); convex hull built along z directly
function wheel(r) {
  if (kind === 'core') return [{ geom: P.cylCoreGeom(r, HL), local: [[0, 0, 0], P.qAxisAngle([0, 1, 0], Math.PI / 2)] }];
  const n = kind === 'hull32' ? 32 : 64;
  return [{ geom: P.convexGeom(P.prismPoints(n, r / Math.cos(Math.PI / n), HL, 'z', Math.PI / n)) }]; // circumscribed, resting on a flat
}
{ // axis check: drop a core cylinder upright (axis Y) on the plane and see whether it rests at h/2 or r
  const s = P.makeScene(); P.addPlane(s, 0);
  const b = P.addDynamic(s, [{ geom: P.cylCoreGeom(1, HL) }], [0, 3, 0], undefined, P.bodyOpts());
  P.stepReal(s, 1);
  console.log(`axis check: core cylinder (r 1, h 0.92), identity pose, rests at y ${P.f(P.pos(b)[1])} (0.46 => shape axis Y? 1.0 => axis not Y); I = ${JSON.stringify(b.getMassSpaceInertiaTensor())}`);
}
function floorOf(s, floor) { if (floor === 'box') P.addStatic(s, P.boxGeom(20, 0.5, 20), [0, -0.5, 0]); else P.addPlane(s, 0); }
for (const floor of ['box', 'plane']) for (const v0 of [0, 1]) {
  const s = P.makeScene(); floorOf(s, floor);
  const b = P.addDynamic(s, wheel(1), [0, 1, 0], undefined, P.bodyOpts());
  P.setLv(b, [v0, 0, 0]); P.setAv(b, [0, 0, -v0 / 1]);
  const rec = [];
  P.stepReal(s, 5, (t, i) => { if ([24, 48, 120, 240].includes(i) || i % 480 === 0) rec.push(`${P.f(P.lv(b)[0], 4)}`); });
  console.log(`B5a r1 ${floor} v0 ${v0}: vx at 0.05 0.1 0.25 0.5 1 2 3 4 5 s = ${rec.join(' ')} studs/s; sink ${P.f(1 - P.pos(b)[1])}; x ${P.f(P.pos(b)[0])}; z drift ${P.f(P.pos(b)[2])}`);
}
for (const floor of ['box', 'plane']) {
  const s = P.makeScene();
  if (floor === 'box') P.addStatic(s, P.boxGeom(250, 0.5, 20), [240, -0.5, 0]); else P.addPlane(s, 0); // long box: 200 studs of travel
  const b = P.addDynamic(s, wheel(1), [0, 1, 0], undefined, P.bodyOpts());
  P.setLv(b, [100, 0, 0]); P.setAv(b, [0, 0, -100]);
  let maxSink = 0;
  P.stepReal(s, 2, (t) => { if (t > 0.05) maxSink = Math.max(maxSink, 1 - P.pos(b)[1]); });
  console.log(`B5b r1 ${floor} 100 studs/s: speed kept ${P.f(P.lv(b)[0], 2)}% , max sink while rolling ${P.f(maxSink)}, y wobble, z drift ${P.f(P.pos(b)[2])}, tilt ${P.f(P.angleBetween(P.rotVec(P.quat(b), [0, 0, 1]), [0, 0, 1]) * 180 / Math.PI, 3)} deg`);
}
for (const floor of ['box', 'plane']) {
  const s = P.makeScene(); floorOf(s, floor);
  const beam = P.addDynamic(s, [{ geom: P.boxGeom(4.5, 0.46, 0.46) }], [0, 0.46, 0], undefined, P.bodyOpts());
  const b = P.addDynamic(s, wheel(2.5), [0, 0.92 + 2.5, 0], undefined, P.bodyOpts());
  const xs = []; P.stepReal(s, 2, (t, i) => { if (i % 240 === 0) xs.push(P.f(P.pos(b)[0], 3)); });
  console.log('   wheel x every 0.5 s:', xs.join(' '));
  const p = P.pos(b);
  console.log(`B5c r2.5 on loose beam (${floor}): sink into beam ${P.f(0.92 + 2.5 - (p[1] - (P.pos(beam)[1] - 0.46)))}, beam into floor ${P.f(0.46 - P.pos(beam)[1])}, wheel x ${P.f(p[0])} vx ${P.f(P.lv(b)[0])}, ${Math.abs(p[0]) < 0.05 ? 'stays' : 'MOVES'}`);
}
process.exit(0);
