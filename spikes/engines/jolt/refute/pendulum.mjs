// Independent B6a: beam 7 (7 x 0.92 x 0.92 studs) hinged at one end, released horizontal.
// Real units: 1 stud = 8 mm, g = 9.81. Release-height check: highest COM height reached after each
// half swing (should stay at 0 = release height if energy is conserved). node pendulum.mjs
import { J, makeWorld, body, P } from './jinit.mjs';
const st = 0.008;
function run(hz, { psteps = 2, vsteps = 10, label = '' } = {}) {
  const W = makeWorld({ psteps, vsteps });
  const box = new J.BoxShapeSettings(new J.Vec3(3.5 * st, 0.46 * st, 0.46 * st), 0.05 * st); box.mDensity = 586;
  const b = body(W, box, [3 * st, 0, 0]); // pivot at x=0, 0.5 stud in from beam end
  const mp = b.GetMotionProperties();
  const hs = new J.HingeConstraintSettings();
  hs.mPoint1 = hs.mPoint2 = new J.RVec3(0, 0, 0);
  hs.mHingeAxis1 = hs.mHingeAxis2 = new J.Vec3(0, 0, 1); hs.mNormalAxis1 = hs.mNormalAxis2 = new J.Vec3(1, 0, 0);
  W.ps.AddConstraint(hs.Create(W.ji.sGetFixedToWorldBody(), b));
  const dt = 1 / hz; const peaks = []; let prevVy = 0, maxY = -1e9;
  const t0 = performance.now();
  for (let i = 1; i <= 10 * hz; i++) {
    W.ji.Step(dt, 1);
    const y = P(b.GetCenterOfMassPosition())[1] / st, vy = b.GetLinearVelocity().GetY();
    if (i > 5 && prevVy > 0 && vy <= 0) peaks.push(y); // top of a swing
    prevVy = vy;
  }
  const ms = performance.now() - t0;
  // energy: release height 0, COM radius 3 studs => fraction lost at peak = -y/3
  const loss = peaks.map(y => (100 * -y / 3).toFixed(1));
  console.log(`${label} ${hz} Hz psteps ${psteps} vsteps ${vsteps}: damping lin ${mp.GetLinearDamping()} ang ${mp.GetAngularDamping()}; swing peaks (% of mgL lost): first ${loss.slice(0, 3).join(', ')} ... last ${loss.slice(-2).join(', ')} (${peaks.length} peaks); ${(ms / 10).toFixed(1)} ms CPU per real s`);
  J.destroy(W.ji);
}
for (const hz of [480, 960, 1920, 3840, 7680, 30720]) run(hz);
run(480, { psteps: 0, label: 'no position correction' });
run(480, { vsteps: 1, label: 'vsteps 1' });
process.exit(0);
