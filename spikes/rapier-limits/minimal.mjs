// Supervisor's own minimal check, independent of the agents' lib.mjs: Rapier at its defaults
// (g 9.81, dt 1/60, default iterations, sleeping on). A cylinder (r 0.5 m, 1 m long) lying on its
// side is given a gentle 0.05 m/s roll on (a) a fixed cuboid and (b) a half-space.
//   node spikes/rapier-limits/minimal.mjs
import RAPIER from '@dimforge/rapier3d-compat';
await RAPIER.init();
function run(floor) {
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  const fb = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
  if (floor === 'cuboid') world.createCollider(RAPIER.ColliderDesc.cuboid(50, 0.5, 50).setTranslation(0, -0.5, 0), fb);
  else world.createCollider(new RAPIER.ColliderDesc(new RAPIER.HalfSpace({ x: 0, y: 1, z: 0 })), fb);
  const r = 0.5;
  // Rapier's cylinder axis is Y; turn it onto X so the cylinder rolls along Z.
  const s = Math.SQRT1_2;
  const b = world.createRigidBody(
    RAPIER.RigidBodyDesc.dynamic().setTranslation(0, r, 0).setRotation({ x: 0, y: 0, z: s, w: s })
      .setLinvel(0, 0, 0.05).setAngvel({ x: 0.05 / r, y: 0, z: 0 }),
  );
  world.createCollider(RAPIER.ColliderDesc.cylinder(0.5, r), b);
  const out = [];
  for (let i = 1; i <= 60 * 20; i++) {
    world.step();
    if (i % 300 === 0) out.push(`t ${(i / 60).toFixed(0)} s: vz ${b.linvel().z.toFixed(4)} z ${b.translation().z.toFixed(3)} y ${b.translation().y.toFixed(4)}`);
  }
  console.log(floor, '\n  ' + out.join('\n  '));
}
run('cuboid');
run('halfspace');
console.log('expected plateau r*(pi/180)/dt =', (0.5 * Math.PI / 180 * 60).toFixed(4), 'm/s');
process.exit(0);
