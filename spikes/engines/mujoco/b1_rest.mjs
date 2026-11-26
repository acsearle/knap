// B1a/B1b/B1c resting contact. Run: node b1_rest.mjs
import { preset, header, v3, compile, bodyId, pos, freeVel, norm, step, contacts, HC } from './lib.mjs';

const floor = (p) => `<geom name="floor" type="box" size="${v3(p, 20, 20, 0.5)}" pos="${v3(p, 0, 0, -0.5)}"/>`;
const cube = (p, name, z, extra = '') =>
  `<body name="${name}" pos="${v3(p, 0, 0, z)}"><freejoint/><geom type="box" size="${v3(p, HC, HC, HC)}" ${extra}/></body>`;

function b1a(p) {
  const { m, d } = compile(`${header(p)}<worldbody>${floor(p)}${cube(p, 'c', HC)}</worldbody></mujoco>`);
  const b = bodyId(m, 'c');
  step(m, d, Math.round(2 / p.dt));
  const z = pos(p, d, b)[2];
  return { sink: HC - z, drift: norm(freeVel(p, m, d, b).lin), ncon: contacts(p, d).n };
}
function b1b(p) {
  const xml = `${header(p)}<worldbody>${floor(p)}
    <body name="beam" pos="${v3(p, 0, 0, HC)}"><freejoint/><geom type="box" size="${v3(p, 4.5, HC, HC)}"/></body>
    ${cube(p, 'c', 3 * HC)}</worldbody></mujoco>`;
  const { m, d } = compile(xml);
  const bb = bodyId(m, 'beam'), bc = bodyId(m, 'c');
  step(m, d, Math.round(2 / p.dt));
  const zb = pos(p, d, bb)[2], zc = pos(p, d, bc)[2];
  return { cubeIntoBeam: zb + 2 * HC - zc, beamIntoFloor: HC - zb, drift: norm(freeVel(p, m, d, bc).lin) };
}
function b1c(p, heavyTop) {
  let bodies = '';
  for (let i = 0; i < 5; i++)
    bodies += cube(p, `c${i}`, HC + 2 * HC * i, heavyTop && i === 4 ? `density="${10 * 585.9375}"` : '');
  const { m, d } = compile(`${header(p)}<worldbody>${floor(p)}${bodies}</worldbody></mujoco>`);
  step(m, d, Math.round(3 / p.dt));
  const top = pos(p, d, bodyId(m, 'c4'));
  const compression = HC + 8 * HC - top[2];
  const lateral = Math.hypot(top[0], top[1]);
  return { compression, lateral, stands: lateral < 0.1 && compression < 0.2 };
}

const fmt = (o) => Object.entries(o).map(([k, v]) => `${k}=${typeof v === 'number' ? v.toExponential(3) : v}`).join(' ');
for (const name of ['default', 'tuned']) {
  for (const lam of [1, 125]) {
    const p = preset(name, lam);
    console.log(`--- ${name} lam=${lam} (units studs, studs/s)`);
    console.log('B1a', fmt(b1a(p)));
    console.log('B1b', fmt(b1b(p)));
    console.log('B1c uniform', fmt(b1c(p, false)));
    console.log('B1c top10x', fmt(b1c(p, true)));
  }
}
// mass independence check: density x1000 at lam=1 default
{
  const p = preset('default', 1);
  const { m, d } = compile(`${header(p).replace(/density="[^"]+"/, 'density="585937.5"')}<worldbody>${floor(p)}${cube(p, 'c', HC)}</worldbody></mujoco>`);
  step(m, d, 960);
  console.log('B1a default lam=1 density x1000: sink', (HC - pos(p, d, bodyId(m, 'c'))[2]).toExponential(3));
}
process.exit(0);
