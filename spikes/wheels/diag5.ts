// Trace a hull wheel dropped onto a liftarm-track: contacts and depth per step around impact.
import { DT, addGround, addWheel, fmt, init, makeWorld } from './lib';
import type { GroundKind, WheelKind } from './lib';
await init();
const [kind, rs, g, hs, x0s, ccd] = process.argv.slice(2);
const r = Number(rs);
const w = makeWorld(30);
addGround(w, g as GroundKind, -40, 80);
const rb = addWheel(w, kind as WheelKind, r, [Number(x0s ?? 0.2), Number(hs) + r, 0], { softCcd: ccd !== 'noccd' });
for (let i = 0; i < 480; i++) {
  w.step();
  const t = rb.translation();
  let nc = 0;
  let depth = 0;
  w.narrowPhase.contactPairsWith(rb.collider(kind === 'hyb' ? 1 : 0).handle, (h2) => {
    w.contactPair(rb.collider(kind === 'hyb' ? 1 : 0), w.getCollider(h2), (m) => {
      nc += m.numContacts();
      for (let k = 0; k < m.numContacts(); k++) depth = Math.min(depth, m.contactDist(k));
    });
  });
  if (t.y - r < 0.4 && t.y - r > -2) console.log(fmt(i * DT, 4), 'y-r', fmt(t.y - r, 4), 'vy', fmt(rb.linvel().y, 2), 'contacts', nc, 'minDist', fmt(depth, 4));
}
