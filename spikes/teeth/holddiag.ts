// Why does a lock that survives a fast ramp give way under a steady load? Hold at several torques,
// report the time to failure and the deepest contact penetration seen.
//   sh spikes/teeth/build.sh holddiag <set> <prof> <r> <kind> <l> <px> <py> <sigma> <sLock> [seconds] [torques τ0 csv]
import { RAPIER, DT, G, Unwrap, angleZ, gearSpec, fmt } from './lib';
import type { PawlKind } from './lib';
import { buildScene, candidates, settle } from './ratchet';

await RAPIER.init();
const [set, prof, r, kind, l, px, py, sg, sl, secs, list] = process.argv.slice(2);
const g = gearSpec(Number(r), set as any, prof as any);
const c = candidates(g, kind as PawlKind, Number(l)).find((q) => q.l === Number(l) && q.p[0] === Number(px) && q.p[1] === Number(py) && q.sigma === Number(sg))!;
const sLock = Number(sl);
const seconds = Number(secs ?? 60);
const D = (2 * Math.PI) / g.T;
const tau0 = c.mass * G;
for (const k of (list ?? '1,2,3.5,5,10,19').split(',').map(Number)) {
  const sc = buildScene(c);
  if (process.env.ERR) sc.w.integrationParameters.normalizedAllowedLinearError = Number(process.env.ERR);
  settle(sc, c);
  const marks: string[] = [];
  const u = new Unwrap(angleZ(sc.gear));
  const g0 = u.v;
  const up = new Unwrap(angleZ(sc.pawl));
  const p0 = up.v;
  let tFail = NaN, pen = 0, liftAtFail = 0;
  const pawlCol = sc.pawl.collider(0);
  const n = Math.round(seconds / DT);
  let gAt1 = 0;
  for (let i = 0; i < n; i++) {
    sc.gear.resetTorques(false);
    sc.gear.addTorque({ x: 0, y: 0, z: sLock * k * tau0 }, true);
    sc.w.step();
    const th = u.push(angleZ(sc.gear));
    const pa = up.push(angleZ(sc.pawl));
    if (i === 480) gAt1 = th;
    if ([479, 2399, 4799, 9599, 19199, 28799].includes(i)) marks.push(`t${Math.round((i + 1) * DT)}s:${fmt(pen, 2)}/${fmt((th - g0) / D, 2)}p`);
    for (let ci = 0; ci < sc.pawl.numColliders(); ci++)
      sc.w.contactPairsWith(sc.pawl.collider(ci), (c2: any) =>
        sc.w.contactPair(sc.pawl.collider(ci), c2, (m: any) => {
          for (let j = 0; j < m.numContacts(); j++) pen = Math.max(pen, -m.contactDist(j));
        }),
      );
    if (sLock * (th - g0) > D) {
      tFail = (i + 1) * DT;
      liftAtFail = -c.sigma * (pa - p0);
      break;
    }
  }
  void pawlCol;
  console.log(`τ = ${k} τ0 (${fmt(k * tau0)}): ${Number.isNaN(tFail) ? `held ${seconds} s, creep after 1 s ${fmt((u.v - gAt1) / D)} pitch` : `failed at ${fmt(tFail)} s, pawl lift then ${fmt(liftAtFail)} rad`}; max penetration ${fmt(pen)} u  [${marks.join(' ')}]`);
  sc.w.free();
}
