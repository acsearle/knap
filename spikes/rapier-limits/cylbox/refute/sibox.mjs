// Strongest counter-case for "DEFECT at SI defaults": all Rapier defaults (g 9.81, dt 1/60,
// default iterations, sleeping on), r 0.5 m half-length 0.23 m cylinder lying on a fixed cuboid of
// ordinary size, at the centre, nudged to v0 along +z. Prints |v_z| (signed) every 2 s.
// Box half-extents 1.5, 3, 5, 10, 20, 200 m; v0 0, 0.05, 0.2. Also the HalfSpace.
// usage: node spikes/rapier-limits/cylbox/refute/sibox.mjs
import RAPIER from '@dimforge/rapier3d-compat';
await RAPIER.init();
const S45 = Math.SQRT1_2;
function run({ fh, v0, T, z0 = 0, x0 = 0 }) {
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  world.timestep = 1 / 60;
  const fb = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(0, fh ? -1 : 0, 0));
  world.createCollider(fh ? RAPIER.ColliderDesc.cuboid(fh, 1, fh) : new RAPIER.ColliderDesc(new RAPIER.HalfSpace({ x: 0, y: 1, z: 0 })), fb);
  const bd = RAPIER.RigidBodyDesc.dynamic().setTranslation(x0, 0.5, z0).setRotation({ x: 0, y: 0, z: S45, w: S45 });
  if (v0) bd.setLinvel(0, 0, v0).setAngvel({ x: v0 / 0.5, y: 0, z: 0 });
  const b = world.createRigidBody(bd);
  world.createCollider(RAPIER.ColliderDesc.cylinder(0.23, 0.5), b);
  const out = [];
  for (let k = 1; k <= T * 60; k++) {
    world.step();
    if (k % 120 === 0) out.push(b.linvel().z.toFixed(3));
  }
  const p = b.translation();
  world.free();
  return `${out.join(' ')} | z ${p.z.toFixed(2)} y ${p.y.toFixed(3)}`;
}
console.log('box half-extent (0 = HalfSpace) | v0 | v_z at 2,4,...,T s | final');
for (const fh of [0, 1.5, 3, 5, 10, 20, 200]) for (const v0 of [0, 0.05, 0.2]) {
  // keep the body on the box: run only as long as v*=0.524 m/s could carry it from -0.8*fh
  const T = fh ? Math.min(20, Math.max(2, Math.floor((1.6 * fh) / 0.6 / 2) * 2)) : 20;
  console.log(`${fh} | ${v0} | ${run({ fh, v0, T, z0: fh ? -0.8 * fh : 0 })}`);
}
process.exit(0);
