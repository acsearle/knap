// (1) Does RK4 (needed for joint energy, B6/B7) still give good contacts? Key B1/B4/B5 cases.
// (2) A closed four-bar: tree of 3 hinged links + a `connect` equality closing the loop. 10 s.
// Run: node rk4_contacts_fourbar.mjs
import { mj, preset, header, v3, compile, bodyId, pos, freeVel, norm, step, energy, prismVerts, STUD, HC } from './lib.mjs';

const AX = 'euler="1.5707963267948966 0 0"';
for (const [label, p] of [['tuned+RK4', preset('tuned', 1, { integrator: 'RK4' })], ['tuned+RK4+noslip', preset('tuned', 1, { integrator: 'RK4', extraOption: 'noslip_iterations="20"' })]]) {
  // B1a
  {
    const { m, d } = compile(`${header(p)}<worldbody><geom type="box" size="${v3(p, 20, 20, 0.5)}" pos="${v3(p, 0, 0, -0.5)}"/><body name="c" pos="${v3(p, 0, 0, HC)}"><freejoint/><geom type="box" size="${v3(p, HC, HC, HC)}"/></body></worldbody></mujoco>`);
    step(m, d, 960);
    const b = bodyId(m, 'c');
    console.log(`${label} B1a sink ${(HC - pos(p, d, b)[2]).toExponential(2)} drift ${norm(freeVel(p, m, d, b).lin).toExponential(2)}`);
  }
  // B4a off-centre
  {
    const { m, d } = compile(`${header(p)}<asset><mesh name="p" vertex="${prismVerts(p, 32, 0.5, 0.5)}"/></asset><worldbody><geom type="mesh" mesh="p" pos="${v3(p, 0, 0, -0.25)}"/><body name="b" pos="${v3(p, 0.35, 0, 0.05)}"><freejoint/><geom type="box" size="${v3(p, 0.08, 0.08, 0.05)}"/></body></worldbody></mujoco>`);
    step(m, d, 960);
    console.log(`${label} B4a spot 0.35: sink ${(0.05 - pos(p, d, bodyId(m, 'b'))[2]).toExponential(2)} ncon ${d.ncon}`);
  }
  // B5a/B5b
  for (const v0 of [1, 100]) {
    const { m, d } = compile(`${header(p)}<worldbody><geom type="box" size="${v3(p, 200, 20, 0.5)}" pos="${v3(p, 180, 0, -0.5)}"/><body name="w" pos="${v3(p, 0, 0, 1)}" ${AX}><freejoint/><geom type="cylinder" size="${v3(p, 1, 0.46, 0)}"/></body></worldbody></mujoco>`);
    const b = bodyId(m, 'w'), a = m.jnt_dofadr[m.body_jntadr[b]], R = d.xmat, o = 9 * b;
    d.qvel[a] = v0 * STUD; d.qvel[a + 3] = R[o + 3] * v0; d.qvel[a + 4] = R[o + 4] * v0; d.qvel[a + 5] = R[o + 5] * v0;
    step(m, d, 960);
    console.log(`${label} wheel r1 roll ${v0} studs/s on box, after 2 s: ${(100 * norm(freeVel(p, m, d, b).lin) / v0).toFixed(3)} % kept, sink ${(1 - pos(p, d, b)[2]).toExponential(2)}`);
  }
}

// Four-bar: ground pivots at x=0 and x=6; crank 3, coupler 6, rocker 3 (parallelogram would be
// singular; use crank 3, coupler 7, rocker 5, ground 6). Links are beams in the XZ plane.
function fourbar(p, eq = 'solref="0.005 1"') {
  // initial pose: crank angle 90deg (up). Solve rocker angle numerically for coupler length.
  const a = 3, b = 7, c = 5, g = 6;
  const A = [0, a];
  // find rocker angle phi so that |B - A| = b, B = (g + c cos phi, c sin phi)
  let phi = 1.2;
  for (let i = 0; i < 60; i++) {
    const Bx = g + c * Math.cos(phi), Bz = c * Math.sin(phi);
    const f = Math.hypot(Bx - A[0], Bz - A[1]) - b;
    const h = 1e-7;
    const f2 = Math.hypot(g + c * Math.cos(phi + h) - A[0], c * Math.sin(phi + h) - A[1]) - b;
    phi -= f / ((f2 - f) / h);
  }
  const B = [g + c * Math.cos(phi), c * Math.sin(phi)];
  const cpl = Math.atan2(B[1] - A[1], B[0] - A[0]);
  // MuJoCo hinge about +Y: positive angle rotates +X toward -Z, so a beam along +X at angle th
  // in XZ means euler "0 -th 0".
  const beam = (len) => `<geom type="box" size="${v3(p, len / 2 + 0.5, HC, HC)}" pos="${v3(p, len / 2, 0, 0)}" contype="0" conaffinity="0"/>`;
  const xml = `${header(p)}<worldbody>
    <body name="crank" pos="0 0 0" euler="0 ${-Math.PI / 2} 0"><joint type="hinge" axis="0 1 0"/>${beam(a)}
      <body name="coupler" pos="${v3(p, a, 0, 0)}" euler="0 ${-(cpl - Math.PI / 2)} 0"><joint type="hinge" axis="0 1 0"/>${beam(b)}
        <site name="cend" pos="${v3(p, b, 0, 0)}"/></body></body>
    <body name="rocker" pos="${v3(p, g, 0, 0)}" euler="0 ${-phi} 0"><joint type="hinge" axis="0 1 0"/>${beam(c)}<site name="rend" pos="${v3(p, c, 0, 0)}"/></body>
  </worldbody>
  <equality><connect site1="cend" site2="rend" ${eq}/></equality></mujoco>`;
  const { m, d } = compile(xml);
  const E0 = energy(m, d);
  const mg = m.body_mass[1] * 9.81 * STUD; // weight of crank x 1 stud, as a scale
  let worst = 0;
  const t0 = performance.now();
  while (d.time < 10 - 1e-9) {
    step(m, d);
    const s = d.site_xpos;
    worst = Math.max(worst, Math.hypot(s[0] - s[3], s[1] - s[4], s[2] - s[5]) / STUD);
  }
  const ms = (performance.now() - t0) / 10;
  const Etot = m.body_mass[1] * 9.81 * a * STUD + m.body_mass[2] * 9.81 * b * STUD + m.body_mass[3] * 9.81 * c * STUD;
  return `energy change ${((100 * (energy(m, d) - E0)) / Etot).toFixed(3)} % of sum(m g L), worst loop gap ${worst.toExponential(2)} studs, crank angle end ${d.qpos[0].toFixed(3)}, cost ${ms.toFixed(1)} ms/sim-s`;
}
for (const integ of ['implicitfast', 'RK4']) console.log(`four-bar (connect equality) ${integ}:`, fourbar(preset('tuned', 1, { integrator: integ })));
console.log('four-bar RK4 dt 1/960:', fourbar(preset('tuned', 1, { integrator: 'RK4', dt: 1 / 960 })));
console.log('four-bar RK4, eq solimp 0.99 0.9999:', fourbar(preset('tuned', 1, { integrator: 'RK4' }), 'solref="0.005 1" solimp="0.99 0.9999 0.001"'));
console.log('four-bar RK4, eq solref 0.005 0.2 (underdamped):', fourbar(preset('tuned', 1, { integrator: 'RK4' }), 'solref="0.005 0.2" solimp="0.99 0.9999 0.001"'));
console.log('four-bar RK4 dt 1/1920, eq solref 0.00105 1 solimp 0.99 0.9999:', fourbar(preset('tuned', 1, { integrator: 'RK4', dt: 1 / 1920 }), 'solref="0.00105 1" solimp="0.99 0.9999 0.001"'));
process.exit(0);
