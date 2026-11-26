// B5a/B5b/B5c native cylinder wheels. Run: node b5_wheels.mjs
import { preset, header, v3, compile, bodyId, pos, freeVel, norm, step, STUD, HC } from './lib.mjs';

const AX = 'euler="1.5707963267948966 0 0"'; // cylinder axis (local Z) -> world Y
function floorXml(p, kind, len = 20) {
  return kind === 'plane' ? `<geom type="plane" size="0 0 1"/>` : `<geom type="box" size="${v3(p, len, 20, 0.5)}" pos="${v3(p, len - 20, 0, -0.5)}"/>`;
}
function setRoll(p, m, d, b, v, r) {
  const a = m.jnt_dofadr[m.body_jntadr[b]];
  d.qvel[a] = v * STUD * p.lam;
  // free-joint angular velocity is in the BODY frame: convert world (0, v/r, 0) with R^T
  const R = d.xmat, o = 9 * b, wy = v / r;
  d.qvel[a + 3] = R[o + 3] * wy; d.qvel[a + 4] = R[o + 4] * wy; d.qvel[a + 5] = R[o + 5] * wy;
}

function b5a(p, kind, v0) {
  const { m, d } = compile(`${header(p)}<worldbody>${floorXml(p, kind)}
    <body name="w" pos="${v3(p, 0, 0, 1)}" ${AX}><freejoint/><geom type="cylinder" size="${v3(p, 1, 0.46, 0)}"/></body></worldbody></mujoco>`);
  const b = bodyId(m, 'w');
  setRoll(p, m, d, b, v0, 1);
  const samples = [];
  for (const t of [0.5, 1, 2, 3, 4, 5]) {
    while (d.time < t - 1e-9) step(m, d);
    samples.push(`${t}s:${norm(freeVel(p, m, d, b).lin).toExponential(2)}`);
  }
  const P = pos(p, d, b);
  return `v ${samples.join(' ')} | x=${P[0].toFixed(3)} sink=${(1 - P[2]).toExponential(2)} ncon=${d.ncon}`;
}

function b5b(p, kind) {
  const { m, d } = compile(`${header(p)}<worldbody>${floorXml(p, kind, 200)}
    <body name="w" pos="${v3(p, 0, 0, 1)}" ${AX}><freejoint/><geom type="cylinder" size="${v3(p, 1, 0.46, 0)}"/></body></worldbody></mujoco>`);
  const b = bodyId(m, 'w');
  setRoll(p, m, d, b, 100, 1);
  let maxSink = 0, sumSink = 0, n = 0, maxLift = 0;
  while (d.time < 2 - 1e-9) {
    step(m, d);
    const z = pos(p, d, b)[2];
    maxSink = Math.max(maxSink, 1 - z); maxLift = Math.max(maxLift, z - 1); sumSink += 1 - z; n++;
  }
  const v = norm(freeVel(p, m, d, b).lin);
  return `speed kept ${(v).toFixed(3)} (${((v / 100) * 100).toFixed(3)} %) meanSink=${(sumSink / n).toExponential(2)} maxSink=${maxSink.toExponential(2)} maxLift=${maxLift.toExponential(2)}`;
}

function b5c(p) {
  const { m, d } = compile(`${header(p)}<worldbody>${floorXml(p, 'box')}
    <body name="beam" pos="${v3(p, 0, 0, HC)}"><freejoint/><geom type="box" size="${v3(p, 4.5, HC, HC)}"/></body>
    <body name="w" pos="${v3(p, 0, 0, 2 * HC + 2.5)}" ${AX}><freejoint/><geom type="cylinder" size="${v3(p, 2.5, 0.46, 0)}"/></body>
    </worldbody></mujoco>`);
  const bw = bodyId(m, 'w'), bb = bodyId(m, 'beam');
  step(m, d, 960);
  const W = pos(p, d, bw), B = pos(p, d, bb);
  return `wheel into beam=${(B[2] + HC + 2.5 - W[2]).toExponential(2)} beam into floor=${(HC - B[2]).toExponential(2)} wheel x=${W[0].toExponential(2)} v=${norm(freeVel(p, m, d, bw).lin).toExponential(2)} ncon=${d.ncon}`;
}

for (const [label, p] of [['default', preset('default', 1)], ['tuned', preset('tuned', 1)], ['tuned lam=125', preset('tuned', 125)]]) {
  console.log(`--- ${label}`);
  for (const kind of ['box', 'plane']) for (const v0 of [0, 1]) console.log(`B5a ${kind} v0=${v0}:`, b5a(p, kind, v0));
  for (const kind of ['box', 'plane']) console.log(`B5b ${kind}:`, b5b(p, kind));
  console.log('B5c:', b5c(p));
}
process.exit(0);
