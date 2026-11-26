// B8 gears: wheel r1 and wheel r2.5 on parallel world hinges 3.5 apart, coupled 2.5:1 by a
// MuJoCo joint equality (q_small = -2.5 q_big, polycoef "0 -2.5 0 0 0").
// Constant torque on the small one from rest to 100 rad/s (or 300), then released, run to 3 s.
// Run: node b8_gears.mjs
import { mj, preset, header, v3, compile, step, energy } from './lib.mjs';

const AX = 'euler="1.5707963267948966 0 0"';
function run(p, target, eqsolref, T = 3) {
  const xml = `${header(p, { gravity: true })}<worldbody>
    <body name="s" pos="0 0 0"><joint name="js" type="hinge" axis="0 1 0"/><geom type="cylinder" size="${v3(p, 1, 0.46, 0)}" ${AX} contype="0" conaffinity="0"/></body>
    <body name="b" pos="${v3(p, 3.5, 0, 0)}"><joint name="jb" type="hinge" axis="0 1 0"/><geom type="cylinder" size="${v3(p, 2.5, 0.46, 0)}" ${AX} contype="0" conaffinity="0"/></body>
  </worldbody>
  <equality><joint joint1="js" joint2="jb" polycoef="0 -2.5 0 0 0" ${eqsolref ? `solref="${eqsolref}"` : ''}/></equality>
  </mujoco>`;
  const { m, d } = compile(xml);
  const u = 0.008 * p.lam; // cylinder about its axis: 0.5 m r^2
  const Is = 0.5 * m.body_mass[1] * u * u, Ib = 0.5 * m.body_mass[2] * (2.5 * u) ** 2;
  const Ieff = Is + Ib / 6.25;
  const tau = Ieff * 100; // 100 rad/s per s if rigid
  const E0 = energy(m, d);
  let work = 0, released = null, maxErr = 0, maxErrAfter = 0, maxRateErr = 0;
  const pitch = (2 * Math.PI) / 16;
  while (d.time < T - 1e-12) {
    const drive = released === null;
    d.qfrc_applied[0] = drive ? tau : 0;
    const w0 = d.qvel[0];
    step(m, d);
    if (drive) work += tau * 0.5 * (w0 + d.qvel[0]) * p.dt;
    const err = Math.abs(d.qpos[0] + 2.5 * d.qpos[1]);
    maxErr = Math.max(maxErr, err);
    if (released !== null) { maxErrAfter = Math.max(maxErrAfter, err); maxRateErr = Math.max(maxRateErr, Math.abs(d.qvel[0] + 2.5 * d.qvel[1]) / Math.abs(d.qvel[0])); }
    if (released === null && d.qvel[0] >= target) released = { t: d.time, K: energy(m, d) - E0, work };
  }
  const Kend = energy(m, d) - E0;
  const err = d.qpos[0] + 2.5 * d.qpos[1];
  return `to ${target}: reached at ${released ? released.t.toFixed(3) + ' s' : 'never'}; ` +
    `K/work at release ${released ? (released.K / released.work).toFixed(5) : '-'}; K change after release ${released ? ((100 * (Kend - released.K)) / released.K).toFixed(3) + ' %' : '-'}; ` +
    `ratio error max ${maxErr.toExponential(2)} rad (${(maxErr / pitch).toExponential(2)} teeth), after release max ${maxErrAfter.toExponential(2)} rad, end ${err.toExponential(2)} rad; ` +
    `speed ratio err after release ${maxRateErr.toExponential(2)}; omega_s end ${d.qvel[0].toFixed(2)}`;
}
for (const [label, p, sr] of [
  ['implicitfast, eq solref default 0.02', preset('default', 1, { integrator: 'implicitfast' }), null],
  ['implicitfast, eq solref 0.005', preset('default', 1, { integrator: 'implicitfast' }), '0.005 1'],
  ['RK4, eq solref default', preset('default', 1, { integrator: 'RK4' }), null],
  ['RK4, eq solref 0.005', preset('default', 1, { integrator: 'RK4' }), '0.005 1'],
  ['Euler, eq solref 0.005', preset('default', 1, { integrator: 'Euler' }), '0.005 1'],
]) for (const target of [100, 300]) console.log(`B8 ${label}:`, run(p, target, sr, target === 300 ? 5 : 3));
process.exit(0);
