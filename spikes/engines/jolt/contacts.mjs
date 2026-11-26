// B1-B5: contacts. Usage: node contacts.mjs [regime ...]   (default: all regimes)
import { World, REGIME_NAMES, tiltDeg, qAxis, fmt, DENSITY } from './lib.mjs';
const regimes = process.argv.slice(2).filter(a => !a.startsWith('--'));
const RUN = regimes.length ? regimes : REGIME_NAMES;
const S = 480; // steps per real second
const out = (...a) => console.log(...a);
const floorBox = (w, hx = 20, hz = 20) => w.add(w.box(hx, 0.5, hz), { dynamic: false, pos: [0, -0.5, 0] });
const floorPlane = (w) => w.add(w.plane(), { dynamic: false });
const hspeed = v => Math.hypot(v[0], v[2]);
const ROT_AXIS_Z = qAxis([1, 0, 0], Math.PI / 2); // local Y (cylinder axis) -> world Z

for (const R of RUN) {
  out(`\n===== regime ${R} =====`);
  // ---- B1a
  for (const fl of ['box', 'plane']) {
    const w = new World(R, { contacts: true });
    fl === 'box' ? floorBox(w) : floorPlane(w);
    const c = w.add(w.box(0.46, 0.46, 0.46), { pos: [0.3, 0.46, -0.2] });
    w.step(2 * S);
    const p = w.pos(c), v = w.v(c);
    out(`B1a ${fl}: sink ${fmt(0.46 - p[1])} studs, drift |v| ${fmt(Math.hypot(...v))} studs/s, horiz moved ${fmt(Math.hypot(p[0] - 0.3, p[2] + 0.2))}, contacts ${w.contactsOf(c)}`);
    w.destroy();
  }
  // ---- B1b
  {
    const w = new World(R, { contacts: true });
    floorPlane(w);
    const beam = w.add(w.box(4.5, 0.46, 0.46), { pos: [0, 0.46, 0] });
    const c = w.add(w.box(0.46, 0.46, 0.46), { pos: [1.2, 1.38, 0] });
    w.step(2 * S);
    const pb = w.pos(beam), pc = w.pos(c);
    out(`B1b: cube into beam ${fmt(pb[1] + 0.92 - pc[1])}, beam into floor ${fmt(0.46 - pb[1])} studs, beam |v| ${fmt(Math.hypot(...w.v(beam)))}, cube |v| ${fmt(Math.hypot(...w.v(c)))}`);
    w.destroy();
  }
  // ---- B1c
  for (const heavy of [1, 10]) {
    const w = new World(R);
    floorPlane(w);
    const cs = [];
    for (let i = 0; i < 5; i++) cs.push(w.add(w.box(0.46, 0.46, 0.46, i === 4 ? DENSITY * heavy : DENSITY), { pos: [0, 0.46 + 0.92 * i, 0] }));
    w.step(3 * S);
    const top = w.pos(cs[4]);
    const maxTilt = Math.max(...cs.map(c => tiltDeg(w.quat(c))));
    out(`B1c top x${heavy}: total compression ${fmt(0.46 + 0.92 * 4 - top[1])} studs, top horiz offset ${fmt(Math.hypot(top[0], top[2]))}, max tilt ${fmt(maxTilt, 3)} deg, stands ${top[1] > 3.9 && maxTilt < 2}`);
    w.destroy();
  }
  // ---- B2
  for (const fl of ['plane', 'box']) for (const vImp of [150, 300]) {
    const w = new World(R);
    fl === 'box' ? floorBox(w) : floorPlane(w);
    const y0 = 0.46 + 0.5;
    const c = w.add(w.box(0.46, 0.46, 0.46), { pos: [0, y0, 0], linVel: [0, -vImp, 0] });
    let ymin = 1e9, vyMax = -1e9, side = 0, spin = 0;
    for (let i = 0; i < 0.25 * S; i++) {
      w.step();
      const p = w.pos(c), v = w.v(c);
      ymin = Math.min(ymin, p[1]);
      if (i > 2) { vyMax = Math.max(vyMax, v[1]); side = Math.max(side, hspeed(v)); spin = Math.max(spin, Math.hypot(...w.w(c))); }
    }
    out(`B2 ${fl} ${vImp}: deepest pen ${fmt(0.46 - ymin)} studs, max rebound vy ${fmt(vyMax)} studs/s, max sideways ${fmt(side)} studs/s, max spin ${fmt(spin)} rad/s, final y ${fmt(w.pos(c)[1])}`);
    w.destroy();
  }
  // ---- B3
  {
    const w = new World(R);
    const c = w.add(w.box(0.46, 0.46, 0.46), { pos: [0, 0, 0] });
    const r = [];
    for (let i = 1; i <= 1.5 * S; i++) { w.step(); if (i % (S / 2) === 0) r.push(-w.v(c)[1]); }
    out(`B3: speed at 0.5/1.0/1.5 s ${r.map(x => fmt(x, 2)).join(' / ')} (g t: 613.13 / 1226.25 / 1839.38)`);
    w.destroy();
  }
  // ---- B4a
  {
    const spots = [[0, 0], [0.2, 0], [0, 0.3], [0.35, 0.1], [-0.3, -0.2], [0.38, 0], [0.25, 0.25]];
    const rows = [];
    for (const [x, z] of spots) {
      const w = new World(R, { contacts: true });
      w.add(w.prism(32, 0.5, 0.25), { dynamic: false, pos: [0, 0, 0] });
      const b = w.add(w.box(0.08, 0.05, 0.08), { pos: [x, 0.3, z] });
      w.step(2 * S);
      const p = w.pos(b);
      rows.push(`(${x},${z}) tilt ${fmt(tiltDeg(w.quat(b)), 3)}deg sink ${fmt(0.3 - p[1])} fell ${p[1] < 0.2} n=${w.contactsOf(b)}`);
      w.destroy();
    }
    out('B4a 32-gon top: ' + rows.join(' | '));
  }
  // ---- B4b
  for (const fl of ['plane', 'box']) for (const n of [16, 32]) {
    const w = new World(R, { contacts: true });
    fl === 'box' ? floorBox(w) : floorPlane(w);
    const b = w.add(w.prism(n, 0.5, 0.46), { pos: [0.2, 0.46, 0.1] });
    w.step(2 * S);
    const p = w.pos(b);
    out(`B4b ${fl} ${n}-gon: tilt ${fmt(tiltDeg(w.quat(b)), 3)} deg, sink ${fmt(0.46 - p[1])}, contacts ${w.contactsOf(b)}, |v| ${fmt(Math.hypot(...w.v(b)))}`);
    w.destroy();
  }
  // ---- B5a
  for (const fl of ['box', 'plane']) for (const v0 of [0, 1]) {
    const w = new World(R, { contacts: true });
    fl === 'box' ? floorBox(w) : floorPlane(w);
    const b = w.add(w.cylinder(1, 0.46), { pos: [-8, 1, 0], rot: ROT_AXIS_Z, linVel: [v0, 0, 0], angVel: [0, 0, -v0 / 1] });
    const sp = [];
    let ymin = 1e9;
    for (let i = 1; i <= 5 * S; i++) { w.step(); ymin = Math.min(ymin, w.pos(b)[1]); if (i % S === 0) sp.push(w.v(b)[0]); }
    out(`B5a ${fl} v0=${v0}: vx at 1..5 s ${sp.map(x => fmt(x)).join(' ')} studs/s; x moved ${fmt(w.pos(b)[0] + 8)}, max sink ${fmt(1 - ymin)}, contacts ${w.contactsOf(b)}`);
    w.destroy();
  }
  // ---- B5b
  for (const fl of ['plane', 'box']) {
    const w = new World(R);
    fl === 'box' ? w.add(w.box(300, 0.5, 20), { dynamic: false, pos: [0, -0.5, 0] }) : floorPlane(w);
    const b = w.add(w.cylinder(1, 0.46), { pos: [-110, 1, 0], rot: ROT_AXIS_Z, linVel: [100, 0, 0], angVel: [0, 0, -100] });
    let ymin = 1e9, ymax = -1e9;
    for (let i = 1; i <= 2 * S; i++) { w.step(); if (i > S / 10) { const y = w.pos(b)[1]; ymin = Math.min(ymin, y); ymax = Math.max(ymax, y); } }
    const v = w.v(b), om = w.w(b);
    out(`B5b ${fl}: speed kept ${fmt(100 * v[0] / 100, 2)} %, omega*r ${fmt(-om[2], 2)}, max sink ${fmt(1 - ymin)}, max hop ${fmt(ymax - 1)}, lateral vz ${fmt(v[2])}`);
    w.destroy();
  }
  // ---- B5c
  {
    const w = new World(R, { contacts: true });
    floorPlane(w);
    const beam = w.add(w.box(4.5, 0.46, 0.46), { pos: [0, 0.46, 0] });
    const b = w.add(w.cylinder(2.5, 0.46), { pos: [0.7, 0.92 + 2.5, 0], rot: ROT_AXIS_Z });
    let maxSink = -1e9;
    for (let i = 1; i <= 2 * S; i++) { w.step(); maxSink = Math.max(maxSink, w.pos(beam)[1] + 0.46 + 2.5 - w.pos(b)[1]); }
    const p = w.pos(b), pb = w.pos(beam);
    out(`B5c: wheel into beam end ${fmt(pb[1] + 0.46 + 2.5 - p[1])} (max ${fmt(maxSink)}), beam into floor ${fmt(0.46 - pb[1])}, wheel x moved ${fmt(p[0] - 0.7)}, vx ${fmt(w.v(b)[0])}, stays ${Math.abs(p[0] - pb[0]) < 4.5 && p[1] > 3}, contacts ${w.contactsOf(b)}`);
    w.destroy();
  }
}
process.exit(0);
