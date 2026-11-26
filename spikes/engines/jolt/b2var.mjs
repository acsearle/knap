// B2 variants: LinearCast motion quality and larger speculative contact distance. node b2var.mjs
import { World, fmt } from './lib.mjs';
for (const [label, R, o, ccd] of [['metre default', 'metre', {}, false], ['metre LinearCast', 'metre', {}, true],
  ['metre spec 0.35 studs', 'metre', { settings: s => { s.mSpeculativeContactDistance = 0.35; } }, false],
  ['metre spec 0.7 studs', 'metre', { settings: s => { s.mSpeculativeContactDistance = 0.7; } }, false],
  ['si-scaled LinearCast', 'si-scaled', {}, true]]) {
  for (const vImp of [150, 300]) {
    const w = new World(R, o);
    w.add(w.plane(), { dynamic: false });
    const c = w.add(w.box(0.46, 0.46, 0.46), { pos: [0, 0.96, 0], linVel: [0, -vImp, 0], ccd });
    let ymin = 9, vyMax = -9, side = 0, spin = 0;
    for (let i = 0; i < 120; i++) { w.step(); const p = w.pos(c), v = w.v(c); ymin = Math.min(ymin, p[1]); if (i > 2) { vyMax = Math.max(vyMax, v[1]); side = Math.max(side, Math.hypot(v[0], v[2])); spin = Math.max(spin, Math.hypot(...w.w(c))); } }
    console.log(`${label} ${vImp}: deepest pen ${fmt(0.46 - ymin)} studs, rebound ${fmt(vyMax)} studs/s, sideways ${fmt(side)} studs/s, spin ${fmt(spin)} rad/s, rest y ${fmt(w.pos(c)[1])}`);
    w.destroy();
  }
}
process.exit(0);
