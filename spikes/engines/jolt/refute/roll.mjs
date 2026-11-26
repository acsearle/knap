// Independent B5a: wheel r1 (length 0.92) rolling on an infinite plane, cache on/off.
// Regimes: 'real' = 1 stud 8 mm, real g, dt 1/480, Jolt default tolerances, max w raised;
// 'metre' = 1 stud 1 m, g 9.81, dt = sqrt(125)/480. Speeds reported in studs per real second.
import { J, makeWorld, body, P } from './jinit.mjs';
const RZ = [Math.SQRT1_2, 0, 0, Math.SQRT1_2];
function run(reg, cache, v0, secs = 5) {
  const L = reg === 'real' ? 0.008 : 1, T = reg === 'real' ? 1 : Math.sqrt(125);
  const W = makeWorld({ cache });
  W.bi.CreateAndAddBody(new J.BodyCreationSettings(new J.PlaneShapeSettings(new J.Plane(new J.Vec3(0, 1, 0), 0), null, 1000 * L).Create().Get(), new J.RVec3(0, 0, 0), new J.Quat(0, 0, 0, 1), J.EMotionType_Static, 0), J.EActivation_DontActivate);
  const cyl = new J.CylinderShapeSettings(0.46 * L, 1 * L, 0.05 * L); cyl.mDensity = 586;
  const vI = v0 * L / T;
  const b = body(W, cyl, [0, L, 0], { q: RZ, lv: [vI, 0, 0], av: [0, 0, -vI / L], maxW: 1e4 });
  const out = []; const dt = T / 480; let act = true;
  for (let i = 1; i <= secs * 480; i++) { W.ji.Step(dt, 1); act &&= b.IsActive(); if (i % 480 === 0) out.push((b.GetLinearVelocity().GetX() * T / L).toPrecision(4)); }
  const y = P(b.GetPosition())[1] / L;
  console.log(`${reg.padEnd(5)} cache ${String(cache).padEnd(5)} v0 ${v0}: vx (studs/s) each second ${out.join(' ')}; centre height ${y.toFixed(6)}; active throughout ${act}`);
  J.destroy(W.ji);
}
for (const reg of ['real', 'metre']) for (const cache of [true, false]) for (const v0 of [0.1, 0.3, 1, 3]) run(reg, cache, v0);
process.exit(0);
