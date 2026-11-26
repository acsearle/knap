// Independent B8 check: two hinged discs (r1, r2.5 studs), GearConstraint ratio 16:N2, metre regime
// (1 stud = 1 m, g irrelevant: zero g). Spin gear 1 at constant w (set velocity, no torque) and track
// the pose phase  q1 + (N2/16) q2  (unwrapped quaternion angles) every step: size and speed of jumps.
import { J, makeWorld, body } from './jinit.mjs';
const RZ = [Math.SQRT1_2, 0, 0, Math.SQRT1_2];
function run(N2, withPos, wReal, secs) {
  const T = Math.sqrt(125), R = N2 / 16;
  const W = makeWorld({ g: 0 });
  const mk = (r, x) => { const c = new J.CylinderShapeSettings(0.46, r, 0.05); c.mDensity = 586; return body(W, c, [x, 0, 0], { q: RZ, maxW: 1e4 }); };
  const g1 = mk(1, 0), g2 = mk(2.5, 3.5);
  const hinge = (b, x) => { const h = new J.HingeConstraintSettings(); h.mPoint1 = h.mPoint2 = new J.RVec3(x, 0, 0); h.mHingeAxis1 = h.mHingeAxis2 = new J.Vec3(0, 0, 1); h.mNormalAxis1 = h.mNormalAxis2 = new J.Vec3(1, 0, 0); const c = h.Create(W.ji.sGetFixedToWorldBody(), b); W.ps.AddConstraint(c); return J.castObject(c, J.HingeConstraint); };
  const h1 = hinge(g1, 0), h2 = hinge(g2, 3.5);
  const gs = new J.GearConstraintSettings(); gs.mHingeAxis1 = gs.mHingeAxis2 = new J.Vec3(0, 0, 1); gs.SetRatio(16, N2);
  const gc = J.castObject(gs.Create(g1, g2), J.GearConstraint); if (withPos) gc.SetConstraints(h1, h2); W.ps.AddConstraint(gc);
  const ang = b => { const q = b.GetRotation(); const x = q.GetX(), y = q.GetY(), z = q.GetZ(), w = q.GetW(); return Math.atan2(2 * (w * z + x * y), 1 - 2 * (y * y + z * z)); };
  const wI = wReal / T; W.bi.SetAngularVelocity(g1.GetID(), new J.Vec3(0, 0, wI)); W.bi.SetAngularVelocity(g2.GetID(), new J.Vec3(0, 0, -wI / R));
  let p1 = ang(g1), p2 = ang(g2), u1 = 0, u2 = 0, maxErr = 0, maxJump = 0, prev = 0, flips = 0;
  const un = d => d - 2 * Math.PI * Math.round(d / (2 * Math.PI));
  const dt = T / 480;
  for (let i = 1; i <= secs * 480; i++) {
    W.ji.Step(dt, 1);
    const a1 = ang(g1), a2 = ang(g2); u1 += un(a1 - p1); u2 += un(a2 - p2); p1 = a1; p2 = a2;
    const e = u1 + R * u2; maxErr = Math.max(maxErr, Math.abs(e)); maxJump = Math.max(maxJump, Math.abs(e - prev));
    if (Math.abs(e - prev) > 0.01) flips++; prev = e;
  }
  console.log(`16:${N2} posCorr ${withPos} w1 ${wReal} rad/s ${secs} s: worst phase error ${maxErr.toFixed(5)} rad = ${(maxErr * 16 / (2 * Math.PI)).toFixed(4)} teeth of gear 1; largest one-step change ${maxJump.toFixed(4)} rad; steps with change >0.01 rad: ${flips}; final w1 ${(g1.GetAngularVelocity().GetZ() * T).toFixed(4)} ratio ${(-g1.GetAngularVelocity().GetZ() / g2.GetAngularVelocity().GetZ()).toFixed(6)}`);
  J.destroy(W.ji);
}
run(40, true, 10, 3); run(40, true, 100, 3); run(32, true, 100, 3);
run(40, false, 100, 60); run(40, false, 300, 60);
process.exit(0);
