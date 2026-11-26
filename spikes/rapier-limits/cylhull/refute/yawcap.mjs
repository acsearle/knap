// Unbevelled 32-gon prism hull (same points as ../lib.mjs hull32) on its cap, at x 4, on the original
// agent's NARROW cuboid floor (half-extents 4.46 x 0.46 x 0.46, top y 0) or a WIDE one (50 x 1 x 50),
// turned about Y by `yaw`. parry keeps the hull cap's first 4 vertices (a sliver at angles 5.6..39.4 deg
// in body frame); yaw moves that sliver over or off the narrow floor strip.
// node spikes/rapier-limits/cylhull/refute/yawcap.mjs [scale=knap|si] [r=1] [T=3]
import RAPIER from '@dimforge/rapier3d-compat';
import { prismPoints } from '../lib.mjs';
await RAPIER.init();
const scale = process.argv[2] ?? 'knap', r = +(process.argv[3] ?? 1), T = +(process.argv[4] ?? 3);
const S = scale === 'si' ? { g: 9.81, dt: 1 / 60 } : { g: 1226.25, dt: 1 / 480, iters: 30 };
for (const floorKind of ['narrow', 'wide']) for (const yawDeg of [0, -22.5, 45, 90, 157.5, 180, 270]) {
  const w = new RAPIER.World({ x: 0, y: -S.g, z: 0 }); w.timestep = S.dt; if (S.iters) { w.numSolverIterations = S.iters; w.integrationParameters.maxCcdSubsteps = 0; }
  const fd = floorKind === 'narrow' ? RAPIER.ColliderDesc.cuboid(4.46, 0.46, 0.46).setTranslation(4, -0.46, 0) : RAPIER.ColliderDesc.cuboid(50, 1, 50).setTranslation(0, -1, 0);
  const floor = w.createCollider(fd, w.createRigidBody(RAPIER.RigidBodyDesc.fixed()));
  const h = (yawDeg * Math.PI) / 360;
  const rb = w.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setCanSleep(false).setTranslation(4, 0.46, 0).setRotation({ x: 0, y: Math.sin(h), z: 0, w: Math.cos(h) }));
  const c = w.createCollider(RAPIER.ColliderDesc.convexHull(prismPoints([0, 0, 0], 1, 2, r, 0.46, 32, 0, 0)), rb);
  const hist = {}; let fell = null;
  for (let s = 1; s <= Math.round(T / S.dt); s++) {
    w.step();
    let k = 0; w.contactPair(c, floor, (m) => (k = m.numContacts()));
    if (fell == null) hist[k] = (hist[k] ?? 0) + 1;
    if (fell == null && rb.translation().y < -0.5) fell = s;
  }
  console.log(`${scale} r=${r} ${floorKind.padEnd(6)} yaw ${String(yawDeg).padStart(6)}: pointsPerStep ${JSON.stringify(hist)} sink ${(0.46 - rb.translation().y).toFixed(4)} fellAtStep ${fell}`);
  w.free();
}
process.exit(0);
