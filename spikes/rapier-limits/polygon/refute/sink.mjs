// (1) Does the witness-only sink depend on starting in contact vs dropping? Trace the dropped case.
// (2) How does the sink depth scale with gravity, dt, box size? (3) Can it fall through at SI defaults?
// Usage: node spikes/rapier-limits/polygon/refute/sink.mjs
import RAPIER from '@dimforge/rapier3d-compat';
await RAPIER.init();
function ngon(n, R, y0, y1) {
  const p = [];
  for (const y of [y0, y1]) for (let k = 0; k < n; k++) { const a = 2 * Math.PI * k / n; p.push(R * Math.cos(a), y, R * Math.sin(a)); }
  return new Float32Array(p);
}
const tilt = (q) => Math.acos(Math.max(-1, Math.min(1, 1 - 2 * (q.x * q.x + q.z * q.z)))) * 180 / Math.PI;
function run(o) {
  const { n = 32, R = 0.5, thick = 0.5, g = 9.81, dt = 1 / 60, half = [0.08, 0.05, 0.08], drop = 0.0005, T = 3, trace = false, x = 0, z = 0 } = o;
  const world = new RAPIER.World({ x: 0, y: -g, z: 0 });
  world.timestep = dt;
  const fb = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
  const pc = world.createCollider(RAPIER.ColliderDesc.convexHull(ngon(n, R, -thick, 0)).setFriction(0.4), fb);
  const bb = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(x, half[1] + drop, z).setCanSleep(false));
  const bc = world.createCollider(RAPIER.ColliderDesc.cuboid(...half).setFriction(0.4), bb);
  const steps = Math.round(T / dt);
  let firstContact = -1;
  for (let s = 0; s < steps; s++) {
    world.step();
    let np = 0, info = '';
    world.contactPair(pc, bc, (m, fl) => {
      np += m.numContacts();
      const pts = [];
      for (let i = 0; i < m.numContacts(); i++) { const p = fl ? m.localContactPoint1(i) : m.localContactPoint2(i); pts.push(`(${p.x.toFixed(3)},${p.z.toFixed(3)})d=${m.contactDist(i).toFixed(4)}`); }
      info = pts.join(' ');
    });
    if (np && firstContact < 0) firstContact = s;
    if (trace && np && (s - firstContact < 4 || s === steps - 1))
      console.log(`    step ${s + 1} y=${bb.translation().y.toFixed(4)} vy=${bb.linvel().y.toFixed(3)} tilt=${tilt(bb.rotation()).toFixed(2)} pts=${np} ${info}`);
  }
  const y = bb.translation().y, t = tilt(bb.rotation());
  world.free();
  return { y, sink: half[1] - y, t, fell: y < -thick - half[1] };
}
const fmt = (r) => `yEnd=${r.y.toFixed(4)} sink=${r.sink.toFixed(4)} tilt=${r.t.toFixed(2)}${r.fell ? ' FELL THROUGH' : ''}`;

console.log('(1) start gap sweep, SI, n=32 centre, box half (0.08,0.05,0.08)');
for (const drop of [0, 0.0005, 0.001, 0.002, 0.005, 0.01, 0.02, 0.05, 0.2, 0.5]) console.log(`  gap ${String(drop).padEnd(6)} ${fmt(run({ drop }))}`);
console.log('  trace gap 0.2:'); run({ drop: 0.2, trace: true });
console.log('  trace gap 0.0005:'); run({ drop: 0.0005, trace: true });
console.log('  gap 0.2 at other spots:');
for (const [x, z] of [[0.2, 0], [0, 0.2], [-0.25, 0.1], [0.1, -0.3]]) console.log(`    (${x},${z}) ${fmt(run({ drop: 0.2, x, z }))}`);

console.log('\n(2) sink vs gravity (gap 0.0005, dt 1/60)');
for (const g of [2.45, 4.9, 9.81, 19.62, 39.24, 78.5, 157]) console.log(`  g ${String(g).padEnd(6)} ${fmt(run({ g }))}`);
console.log('  sink vs dt (g 9.81)');
for (const dt of [1 / 30, 1 / 60, 1 / 120, 1 / 240, 1 / 480]) console.log(`  dt 1/${Math.round(1 / dt)} ${fmt(run({ dt }))}`);
console.log('  sink vs box size (g 9.81), R=6*box half');
for (const h of [0.02, 0.05, 0.1, 0.3, 1]) console.log(`  box half ${h} ${fmt(run({ half: [h * 1.6, h, h * 1.6], R: 10 * h, thick: 10 * h }))}`);

console.log('\n(3) fall-through at SI defaults? thin tile on thin 32-gon plate');
for (const [hy, th] of [[0.05, 0.02], [0.02, 0.02], [0.01, 0.01], [0.02, 0.05]]) console.log(`  box half-height ${hy}, plate ${th}: ${fmt(run({ half: [0.08, hy, 0.08], thick: th }))}`);
process.exit(0);
