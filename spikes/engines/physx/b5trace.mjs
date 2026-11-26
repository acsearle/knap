// Trace: native (convex-core) cylinder r 1 rolling on a fixed box at v0. node b5trace.mjs v0 [noPCM]
import * as P from './lib.mjs';
const v0 = +(process.argv[2] ?? 100); const noPCM = process.argv.includes('noPCM');
const kind = process.argv.includes('hull') ? 'hull' : 'core';
const s = P.makeScene({ noPCM, contacts: true });
const fl = process.env.FLOOR ?? 'long';
if (fl === 'long') P.addStatic(s, P.boxGeom(250, 0.5, 20), [240, -0.5, 0]);
else if (fl === 'small') P.addStatic(s, P.boxGeom(20, 0.5, 20), [0, -0.5, 0]);
else if (fl === 'tiles') for (let k = -1; k < 25; k++) P.addStatic(s, P.boxGeom(10, 0.5, 20), [20 * k, -0.5, 0]);
else P.addPlane(s, 0);
const g = kind === 'core' ? [{ geom: P.cylCoreGeom(1, 0.46), local: [[0, 0, 0], P.qAxisAngle([0, 1, 0], Math.PI / 2)] }] : [{ geom: P.convexGeom(P.prismPoints(64, 1, 0.46, 'z')) }];
const b = P.addDynamic(s, g, [0, 1, 0], undefined, P.bodyOpts());
P.setLv(b, [v0, 0, 0]); P.setAv(b, [0, 0, -v0]);
const T = +(process.argv[3] ?? 0.5);
console.log(kind, 'floor', fl, 'v0', v0, noPCM ? 'PCM off' : 'PCM on');
P.stepReal(s, T, (t, i) => {
  if (i % Math.max(1, Math.round(T * 480 / 20)) === 0) {
    const c = P.lastContacts().flat();
    console.log(`t ${t.toFixed(4)} x ${P.f(P.pos(b)[0], 3)} y ${P.f(P.pos(b)[1], 5)} z ${P.f(P.pos(b)[2], 4)} v ${P.lv(b).map((x) => P.f(x, 3)).join(',')} w ${P.av(b).map((x) => P.f(x, 2)).join(',')} contacts ${c.length} sep ${c.map((k) => P.f(k.sep, 5)).join(',')}`);
  }
});
process.exit(0);
