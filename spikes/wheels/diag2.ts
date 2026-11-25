// Diagnostic: cylinder resting / slowly rolling on ONE liftarm-on-edge hull; contact count vs x.
import { RAPIER, addWheel, fmt, init, makeWorld } from './lib';
import { partShapes } from '../../src/physics/shapes';
import { beam } from '../../src/core/examples';
import type { WheelKind } from './lib';
await init();
const kind = (process.argv[2] ?? 'cyl') as WheelKind;
const r = Number(process.argv[3] ?? 1);
const n = Number(process.argv[4] ?? 15);
const axis = Number(process.argv[5] ?? 2) as 0 | 1 | 2;
for (const x of [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14].filter((x) => x < n)) {
  const w = makeWorld(30);
  w.gravity = { x: 0, y: -1226.25, z: 0 };
  const g = w.createRigidBody(RAPIER.RigidBodyDesc.fixed());
  // ROWS beams side by side in z (default 5), so a tipping wheel cannot fall off a narrow rail
  const ROWS = Number(process.env.ARM_ROWS ?? 5);
  let gc = null as unknown as ReturnType<typeof w.createCollider>;
  for (let zr = -Math.floor(ROWS / 2); zr <= Math.floor((ROWS - 1) / 2); zr++) {
    const sh = partShapes({ id: 1, color: '#888888', cells: beam([0, 0, zr], [n - 1, 0, zr], axis) }, 16)[0]!;
    if (sh.kind !== 'hull') throw 0;
    const pts = new Float32Array(sh.points.flatMap((p) => [p[0], p[1] - 0.46, p[2]]));
    const c = w.createCollider(RAPIER.ColliderDesc.convexHull(pts)!, g);
    if (zr === 0) gc = c;
  }
  const rb = addWheel(w, kind, r, [x, r, 0], { softCcd: process.env.CCD !== '0' });
  let nc = 0;
  for (let i = 0; i < 480; i++) w.step();
  w.contactPair(gc, rb.collider(0), (m) => (nc = m.numContacts()));
  console.log('x', x, 'y-r', fmt(rb.translation().y - r, 4), 'z', fmt(rb.translation().z, 3), 'contacts', nc);
  w.free();
}
