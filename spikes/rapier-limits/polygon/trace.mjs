// Time trace of one box resting on the top face of a fixed n-gon convexHull prism, printing the
// box pose and the full contact manifold (fids, normal, local points) at chosen times.
// Usage: node spikes/rapier-limits/polygon/trace.mjs [SI|KNAP] n x z
import { RAPIER, SCALES, makeWorld, ngonPrism, fidStr, tiltDeg, f3 } from './common.mjs';

const scale = SCALES[process.argv[2] ?? 'SI'];
const n = Number(process.argv[3] ?? 32), x = Number(process.argv[4] ?? 0), z = Number(process.argv[5] ?? 0);
const HX = 0.08, HY = 0.05, HZ = 0.08;
const world = makeWorld(scale);
const fb = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
const pc = world.createCollider(RAPIER.ColliderDesc.convexHull(ngonPrism(n, 0.5, -0.5, 0)).setFriction(0.4), fb);
const bb = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(x, HY + 0.0005, z).setCanSleep(false));
const bc = world.createCollider(RAPIER.ColliderDesc.cuboid(HX, HY, HZ).setFriction(0.4).setDensity(1), bb);
const times = [0, 0.05, 0.1, 0.2, 0.3, 0.5, 1, 2];
let t = 0, ti = 0;
console.log(`scale=${scale.name} n=${n} box at (${x},${z}); box centre rest y=${HY}`);
for (let s = 0; t <= 2 + 1e-9; s++) {
  world.step();
  t = (s + 1) * scale.dt;
  if (t + 1e-9 >= times[ti]) {
    ti++;
    const lines = [];
    world.contactPair(pc, bc, (m, flipped) => {
      const nrm = m.normal();
      for (let i = 0; i < m.numContacts(); i++) {
        const fA = flipped ? m.contactFid2(i) : m.contactFid1(i), fB = flipped ? m.contactFid1(i) : m.contactFid2(i);
        const pA = flipped ? m.localContactPoint2(i) : m.localContactPoint1(i);
        lines.push(`${fidStr(fA)}/${fidStr(fB)} prismLocal${f3(pA)} dist=${m.contactDist(i).toFixed(4)} imp=${m.contactImpulse(i).toExponential(2)}`);
      }
      lines.unshift(`normal(world, from ${flipped ? 'box' : 'prism'})=${f3(nrm)} solverContacts=${m.numSolverContacts()}`);
    });
    const p = bb.translation();
    console.log(`t=${t.toFixed(3)} centre=${f3(p, 4)} tilt=${tiltDeg(bb.rotation()).toFixed(2)}deg  ${lines.join(' | ')}`);
    if (ti >= times.length) break;
  }
}
process.exit(0);
