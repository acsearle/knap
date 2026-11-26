// B4a box on top face of fixed 32-gon prism; B4b dynamic 16/32-gon prism on its flat end.
// Run: node b4_prisms.mjs
import { preset, header, v3, compile, bodyId, pos, tiltZ, step, contacts, prismVerts } from './lib.mjs';

const SPOTS = [[0, 0], [0.2, 0], [0, 0.3], [0.35, 0], [-0.25, 0.25], [0.3, -0.2], [0, -0.38]];

function b4a(p, [x, y]) {
  const xml = `${header(p)}<asset><mesh name="p32" vertex="${prismVerts(p, 32, 0.5, 0.5)}"/></asset>
  <worldbody>
    <geom type="mesh" mesh="p32" pos="${v3(p, 0, 0, -0.25)}"/>
    <body name="b" pos="${v3(p, x, y, 0.05)}"><freejoint/><geom type="box" size="${v3(p, 0.08, 0.08, 0.05)}"/></body>
  </worldbody></mujoco>`;
  const { m, d } = compile(xml);
  const b = bodyId(m, 'b');
  let nmin = 99, nmax = 0;
  for (let i = 0; i < 960; i++) {
    step(m, d);
    const n = d.ncon;
    nmin = Math.min(nmin, n); nmax = Math.max(nmax, n);
  }
  const P = pos(p, d, b);
  return { tiltDeg: (tiltZ(d, b) * 180) / Math.PI, sink: 0.05 - P[2], fell: P[2] < -0.1, nEnd: d.ncon, nmin, nmax, moved: Math.hypot(P[0] - x, P[1] - y) };
}

function b4b(p, n, plane) {
  const floor = plane ? `<geom type="plane" size="0 0 1"/>` : `<geom type="box" size="${v3(p, 20, 20, 0.5)}" pos="${v3(p, 0, 0, -0.5)}"/>`;
  const xml = `${header(p)}<asset><mesh name="pr" vertex="${prismVerts(p, n, 0.5, 0.92)}"/></asset>
  <worldbody>${floor}
    <body name="b" pos="${v3(p, 0, 0, 0.46)}"><freejoint/><geom type="mesh" mesh="pr"/></body>
  </worldbody></mujoco>`;
  const { m, d } = compile(xml);
  const b = bodyId(m, 'b');
  step(m, d, 960);
  const P = pos(p, d, b);
  return { tiltDeg: (tiltZ(d, b) * 180) / Math.PI, sink: 0.46 - P[2], ncon: d.ncon, drift: Math.hypot(P[0], P[1]) };
}

const fmt = (o) => Object.entries(o).map(([k, v]) => `${k}=${typeof v === 'number' && !Number.isInteger(v) ? v.toExponential(2) : v}`).join(' ');
const variants = [
  ['default (multiccd on)', preset('default', 1)],
  ['default, multiccd off', preset('default', 1, { flags: 'multiccd="disable"' })],
  ['tuned', preset('tuned', 1)],
  ['tuned lam=125', preset('tuned', 125)],
  ['default, nativeccd off (libccd)', preset('default', 1, { flags: 'nativeccd="disable"' })],
];
for (const [label, p] of variants) {
  console.log(`--- ${label}`);
  for (const s of SPOTS) console.log(`B4a spot ${s}:`, fmt(b4a(p, s)));
  for (const n of [16, 32]) for (const plane of [true, false]) console.log(`B4b ${n}-gon on ${plane ? 'plane' : 'box'}:`, fmt(b4b(p, n, plane)));
}
process.exit(0);
