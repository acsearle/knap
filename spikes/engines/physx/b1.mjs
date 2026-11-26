// B1a/B1b/B1c resting contact. node b1.mjs   (env POS, VEL, SUB, PXU=m)
import * as P from './lib.mjs';
const H = 0.46, out = [];
console.log('B1', P.settingsLine());
const cube = () => [{ geom: P.boxGeom(H, H, H) }];
const hspeed = (b) => Math.hypot(P.lv(b)[0], P.lv(b)[2]);
for (const floor of ['box', 'plane']) {
  const s = P.makeScene();
  if (floor === 'box') P.addStatic(s, P.boxGeom(20, 0.5, 20), [0, -0.5, 0]); else P.addPlane(s, 0);
  const b = P.addDynamic(s, cube(), [0, H, 0], undefined, P.bodyOpts());
  let maxV = 0; P.stepReal(s, 2, (t) => { if (t > 0.1) maxV = Math.max(maxV, P.len(P.lv(b))); });
  console.log(`B1a ${floor}: sink ${P.f(H - P.pos(b)[1])} studs, drift at end ${P.f(hspeed(b))} studs/s (|v| max after 0.1s ${P.f(maxV)}), xz moved ${P.f(Math.hypot(P.pos(b)[0], P.pos(b)[2]))}`);
}
for (const floor of ['box', 'plane']) {
  const s = P.makeScene();
  if (floor === 'box') P.addStatic(s, P.boxGeom(20, 0.5, 20), [0, -0.5, 0]); else P.addPlane(s, 0);
  const beam = P.addDynamic(s, [{ geom: P.boxGeom(4.5, H, H) }], [0, H, 0], undefined, P.bodyOpts());
  const b = P.addDynamic(s, cube(), [0, 3 * H, 0], undefined, P.bodyOpts());
  P.stepReal(s, 2);
  console.log(`B1b ${floor}: cube into beam ${P.f(0.92 - (P.pos(b)[1] - P.pos(beam)[1]))}, beam into floor ${P.f(H - P.pos(beam)[1])}, cube drift ${P.f(hspeed(b))} studs/s, beam drift ${P.f(hspeed(beam))}`);
}
for (const heavy of [1, 10]) for (const floor of ['box', 'plane']) {
  const s = P.makeScene();
  if (floor === 'box') P.addStatic(s, P.boxGeom(20, 0.5, 20), [0, -0.5, 0]); else P.addPlane(s, 0);
  const cs = [];
  for (let i = 0; i < 5; i++) cs.push(P.addDynamic(s, cube(), [0, H + 0.92 * i, 0], undefined, P.bodyOpts({ density: P.DENS * (i === 4 ? heavy : 1) })));
  P.stepReal(s, 3);
  const top = P.pos(cs[4]);
  const comp = 0.92 * 4 + H - top[1];
  const off = Math.hypot(top[0], top[2]);
  console.log(`B1c ${floor} top x${heavy}: total compression ${P.f(comp)} studs, top offset ${P.f(off)}, ${off < 0.1 && comp < 0.2 ? 'stands' : 'FALLS'}`);
}
process.exit(0);
