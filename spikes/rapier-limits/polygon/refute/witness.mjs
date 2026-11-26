// Refutation probes for the "box on a fixed n-gon hull top gets one witness point and sinks" claim.
// Native Rapier only. Usage: node spikes/rapier-limits/polygon/refute/witness.mjs
import RAPIER from '@dimforge/rapier3d-compat';
await RAPIER.init();

function ngon(n, R, y0, y1) {
  const p = [];
  for (const y of [y0, y1]) for (let k = 0; k < n; k++) { const a = 2 * Math.PI * k / n; p.push(R * Math.cos(a), y, R * Math.sin(a)); }
  return new Float32Array(p);
}
const tilt = (q) => Math.acos(Math.max(-1, Math.min(1, 1 - 2 * (q.x * q.x + q.z * q.z)))) * 180 / Math.PI;

// opts: n, R, thick (prism depth below y=0), g, dt, iters, half [hx,hy,hz], drop (gap), T, noRecycle, x, z, density
function run(o) {
  const { n = 32, R = 0.5, thick = 0.5, g = 9.81, dt = 1 / 60, iters, half = [0.08, 0.05, 0.08], drop = 0.0005, T = 2,
    noRecycle = false, x = 0, z = 0, density = 1, trace = false } = o;
  const world = new RAPIER.World({ x: 0, y: -g, z: 0 });
  world.timestep = dt;
  if (iters) world.integrationParameters.numSolverIterations = iters;
  const fb = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
  const pd = RAPIER.ColliderDesc.convexHull(ngon(n, R, -thick, 0)).setFriction(0.4);
  if (noRecycle) pd.setActiveHooks(RAPIER.ActiveHooks.FILTER_CONTACT_PAIRS);
  const pc = world.createCollider(pd, fb);
  const bb = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(x, half[1] + drop, z).setCanSleep(false));
  const bc = world.createCollider(RAPIER.ColliderDesc.cuboid(...half).setFriction(0.4).setDensity(density), bb);
  const hooks = { filterContactPair: () => RAPIER.SolverFlags.COMPUTE_IMPULSE, filterIntersectionPair: () => true };
  const steps = Math.round(T / dt);
  let minY = Infinity, maxPts = 0;
  for (let s = 0; s < steps; s++) {
    world.step(undefined, noRecycle ? hooks : undefined);
    const y = bb.translation().y; minY = Math.min(minY, y);
    let np = 0, info = '';
    world.contactPair(pc, bc, (m, fl) => {
      np += m.numContacts();
      if (trace && m.numContacts()) {
        const nn = m.normal();
        const pts = [];
        for (let i = 0; i < m.numContacts(); i++) { const p = fl ? m.localContactPoint1(i) : m.localContactPoint2(i); pts.push(`boxLocal(${p.x.toFixed(3)},${p.y.toFixed(3)},${p.z.toFixed(3)}) d=${m.contactDist(i).toFixed(4)}`); }
        info = `n=(${nn.x.toFixed(3)},${nn.y.toFixed(3)},${nn.z.toFixed(3)}) solver=${m.numSolverContacts()} ${pts.join(' ')}`;
      }
    });
    maxPts = Math.max(maxPts, np);
    if (trace && ([1, 2, 3, 5, 10, 20, 30, 60, 120].includes(s + 1) || s === steps - 1))
      console.log(`    t=${((s + 1) * dt).toFixed(3)} y=${y.toFixed(4)} tilt=${tilt(bb.rotation()).toFixed(2)} pts=${np} ${info}`);
  }
  const y = bb.translation().y, t = tilt(bb.rotation());
  world.free();
  const fell = y < -thick - half[1];
  return `yEnd=${y.toFixed(4)} yMin=${minY.toFixed(4)} tilt=${t.toFixed(2)} rest=${half[1].toFixed(4)} ${fell ? 'FELL THROUGH' : (y < half[1] - 0.02 * Math.max(1, half[1] / 0.05) ? 'SUNK' : 'resting')}`;
}

const cases = [
  ['A baseline SI n=32 centre (their case)', {}],
  ['A2 same, n=4 control', { n: 4 }],
  ['B recycling OFF (contact-filter hook) n=32', { noRecycle: true }],
  ['B2 recycling OFF, n=4 control', { n: 4, noRecycle: true }],
  ['C dropped from 0.2 above', { drop: 0.2 }],
  ['D 20 s', { T: 20 }],
  ['E density 100', { density: 100 }],
  ['F THIN 32-gon plate 0.05 thick, SI', { thick: 0.05 }],
  ['F2 THIN plate 0.05, n=4 control', { thick: 0.05, n: 4 }],
  ['F3 THIN plate 0.03, SI', { thick: 0.03 }],
  ['G big: box half 0.5,0.3,0.5 on 32-gon R 3, SI', { R: 3, thick: 3, half: [0.5, 0.3, 0.5] }],
  ['G2 big box on thin plate R 3 thick 0.3, SI', { R: 3, thick: 0.3, half: [0.5, 0.3, 0.5] }],
  ['H g 1226 dt 1/60, n=4 control (confound check)', { g: 1226.25, n: 4 }],
  ['H2 g 1226 dt 1/60, n=32', { g: 1226.25 }],
  ['I knap n=32 recycling OFF', { g: 1226.25, dt: 1 / 480, iters: 30, noRecycle: true }],
  ['I2 knap n=32 recycling ON', { g: 1226.25, dt: 1 / 480, iters: 30 }],
];
for (const [name, o] of cases) console.log(`${name.padEnd(50)} ${run(o)}`);
console.log('\nTrace baseline SI n=32 (recycling on):'); run({ trace: true });
console.log('\nTrace SI n=32 recycling OFF:'); run({ trace: true, noRecycle: true });
process.exit(0);
