// B2 impact on a box floor, B3 free fall. Run: node b2_b3_impact_fall.mjs
import { preset, header, v3, compile, bodyId, pos, freeVel, norm, step, HC, STUD, G_STUDS } from './lib.mjs';

function b2(p, vImpact, phase = 0) {
  const gap = 0.05 + phase; // studs above touching at start
  const xml = `${header(p)}<worldbody>
    <geom type="box" size="${v3(p, 20, 20, 0.5)}" pos="${v3(p, 0, 0, -0.5)}"/>
    <body name="c" pos="${v3(p, 0, 0, HC + gap)}"><freejoint/><geom type="box" size="${v3(p, HC, HC, HC)}"/></body>
    </worldbody></mujoco>`;
  const { m, d } = compile(xml);
  const b = bodyId(m, 'c');
  const ja = m.jnt_dofadr[m.body_jntadr[b]];
  d.qvel[ja + 2] = -vImpact * STUD * p.lam;
  let deepest = 0, rebound = 0, side = 0, spin = 0;
  for (let i = 0; i < Math.round(0.5 / p.dt); i++) {
    step(m, d);
    const z = pos(p, d, b)[2];
    deepest = Math.max(deepest, HC - z);
    const v = freeVel(p, m, d, b);
    rebound = Math.max(rebound, v.lin[2]);
    side = Math.max(side, Math.hypot(v.lin[0], v.lin[1]));
    spin = Math.max(spin, norm(v.ang));
  }
  const zEnd = pos(p, d, b)[2];
  return { deepest, rebound, side, spin, zEnd };
}

function b3(p) {
  const xml = `${header(p)}<worldbody>
    <body name="c" pos="0 0 0"><freejoint/><geom type="box" size="${v3(p, HC, HC, HC)}" contype="0" conaffinity="0"/></body>
    </worldbody></mujoco>`;
  const { m, d } = compile(xml);
  const b = bodyId(m, 'c');
  const out = [];
  for (const t of [0.5, 1.0, 1.5]) {
    while (d.time < t - 1e-9) step(m, d);
    out.push(`${t}s: ${(-freeVel(p, m, d, b).lin[2]).toFixed(3)} (g t = ${(G_STUDS * t).toFixed(2)})`);
  }
  return out.join(', ');
}

for (const name of ['default', 'tuned']) {
  const p = preset(name, 1);
  for (const v of [150, 300]) {
    for (const ph of [0, 0.1, 0.2]) {
      const r = b2(p, v, ph);
      console.log(`B2 ${name} v=${v} startgap+${ph}: deepest=${r.deepest.toFixed(4)} rebound=${r.rebound.toFixed(3)} sideways=${r.side.toExponential(2)} spin=${r.spin.toExponential(2)} zEnd-HC=${(r.zEnd - HC).toExponential(2)}`);
    }
  }
  console.log(`B3 ${name}:`, b3(p));
}
process.exit(0);
