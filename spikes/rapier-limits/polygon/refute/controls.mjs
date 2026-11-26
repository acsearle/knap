// Controls: (a) thin-plate fall-through at SI defaults with n=4 (no truncation) vs n=32;
// (b) dropped instead of started in contact; (c) which knap setting flips the 16-gon side7 case.
// Usage: node spikes/rapier-limits/polygon/refute/controls.mjs
import RAPIER from '@dimforge/rapier3d-compat';
await RAPIER.init();
function ngon(n, R, y0, y1) {
  const p = [];
  for (const y of [y0, y1]) for (let k = 0; k < n; k++) { const a = 2 * Math.PI * k / n; p.push(R * Math.cos(a), y, R * Math.sin(a)); }
  return new Float32Array(p);
}
function run({ n = 32, thick = 0.5, g = 9.81, dt = 1 / 60, iters, half = [0.08, 0.05, 0.08], drop = 0.0005, x = 0, z = 0, T = 2 }) {
  const world = new RAPIER.World({ x: 0, y: -g, z: 0 });
  world.timestep = dt;
  if (iters) world.integrationParameters.numSolverIterations = iters;
  const fb = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
  const pc = world.createCollider(RAPIER.ColliderDesc.convexHull(ngon(n, 0.5, -thick, 0)).setFriction(0.4), fb);
  const bb = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(x, half[1] + drop, z).setCanSleep(false));
  const bc = world.createCollider(RAPIER.ColliderDesc.cuboid(...half).setFriction(0.4), bb);
  world.step();
  let np1 = 0; world.contactPair(pc, bc, (m) => { np1 += m.numContacts(); });
  for (let s = 1; s < Math.round(T / dt); s++) world.step();
  const y = bb.translation().y;
  world.free();
  return `step1pts=${np1} yEnd=${y.toFixed(4)} ${y < -thick - half[1] ? 'FELL THROUGH' : y < half[1] - 0.02 ? 'SUNK' : 'resting'}`;
}
console.log('(a) SI defaults, box half (0.08,0.05,0.08) at centre on a 32-gon/4-gon plate (R 0.5)');
for (const th of [0.05, 0.03, 0.02, 0.01]) console.log(`  plate ${th}: n=32 ${run({ thick: th })} | n=4 ${run({ n: 4, thick: th })}`);
console.log('  tile half-height 0.02 on plate 0.05:', 'n=32', run({ thick: 0.05, half: [0.08, 0.02, 0.08] }), '| n=4', run({ n: 4, thick: 0.05, half: [0.08, 0.02, 0.08] }));
console.log('(b) dropped from 0.2, SI, plate 0.02');
for (const [x, z] of [[0, 0], [0.2, 0], [-0.1, 0.25]]) console.log(`  (${x},${z}) n=32 ${run({ thick: 0.02, drop: 0.2, x, z })} | n=4 ${run({ n: 4, thick: 0.02, drop: 0.2, x, z })}`);
console.log('(c) 16-gon side7 (-0.334,0.066), prism 0.5 deep');
const c = { n: 16, x: -0.334, z: 0.066 };
for (const [nm, o] of [['SI', {}], ['dt 1/480', { dt: 1 / 480 }], ['iters 30', { iters: 30 }], ['g 1226.25', { g: 1226.25 }], ['g 1226.25 dt 1/480', { g: 1226.25, dt: 1 / 480 }], ['knap', { g: 1226.25, dt: 1 / 480, iters: 30 }]])
  console.log(`  ${nm.padEnd(20)} ${run({ ...c, ...o })}`);
process.exit(0);
