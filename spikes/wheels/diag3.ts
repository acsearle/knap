// Diagnostic: wheel placed at rest on a cuboid ground; trace until it misbehaves.
import { DT, RAPIER, addWheel, fmt, init, makeWorld } from './lib';
import type { WheelKind } from './lib';
await init();
const [kind, rs, hx, hz, x0] = process.argv.slice(2);
const r = Number(rs);
const w = makeWorld(30);
const g = w.createRigidBody(RAPIER.RigidBodyDesc.fixed());
const gc = w.createCollider(RAPIER.ColliderDesc.cuboid(Number(hx ?? 30), 1, Number(hz ?? 50)).setTranslation(10, -1, 0).setFriction(0.4).setRestitution(0.1), g);
const rb = addWheel(w, kind as WheelKind, r, [Number(x0 ?? 0.3), r, 0]);
for (let i = 0; i < 2400; i++) {
  w.step();
  const t = rb.translation();
  let nc = 0, imp = 0;
  w.contactPair(gc, rb.collider(0), (m) => { nc = m.numContacts(); for (let k = 0; k < nc; k++) imp += m.contactImpulse(k); });
  if (i % 48 === 0) {
    console.log(fmt(i * DT, 4), 'x', fmt(t.x, 5), 'y-r', fmt(t.y - r, 5), 'z', fmt(t.z, 4), 'v', fmt(rb.linvel().x, 3), fmt(rb.linvel().y, 3), 'w', fmt(rb.angvel().x, 3), fmt(rb.angvel().y, 3), fmt(rb.angvel().z, 3), 'nc', nc, 'N', fmt(imp / DT, 1));

  }
}
