// B7 free body in zero gravity: beam 5 (along X) with a cube on one end at right angles (+Y),
// spinning at 20 rad/s about world (1,1,1)/sqrt3 (not principal). 30 s.
// Run: node b7_freespin.mjs
import { mj, preset, header, v3, compile, step, STUD, HC } from './lib.mjs';

function run(p, T = 30) {
  const xml = `${header(p, { gravity: false })}<worldbody>
    <body name="b" pos="0 0 0"><freejoint/>
      <geom type="box" size="${v3(p, 2.5, HC, HC)}" contype="0" conaffinity="0"/>
      <geom type="box" size="${v3(p, HC, HC, HC)}" pos="${v3(p, 2, 2 * HC, 0)}" contype="0" conaffinity="0"/>
    </body></worldbody></mujoco>`;
  const { m, d } = compile(xml);
  const s = 20 / Math.sqrt(3);
  // free joint angular velocity is in the body frame; body frame = world at t=0
  d.qvel[3] = s; d.qvel[4] = s; d.qvel[5] = s;
  mj.mj_forward(m, d);
  const meas = () => {
    mj.mj_energyVel(m, d);
    mj.mj_subtreeVel(m, d);
    const L = d.subtree_angmom; // body 1, about subtree COM, world frame
    return { K: d.energy[1], L: Math.hypot(L[3], L[4], L[5]) };
  };
  const a = meas();
  const t0 = performance.now();
  let Kmax = a.K, Kmin = a.K;
  for (let i = 0; i < Math.round(T / p.dt); i++) {
    step(m, d);
    if (i % 480 === 0) { const q = meas(); Kmax = Math.max(Kmax, q.K); Kmin = Math.min(Kmin, q.K); }
  }
  const ms = performance.now() - t0;
  const b = meas();
  return `K: ${(100 * (b.K / a.K - 1) / T).toExponential(3)} %/s (range ${(100 * (Kmin / a.K - 1)).toFixed(4)}..${(100 * (Kmax / a.K - 1)).toFixed(4)} %), |L|: ${(100 * (b.L / a.L - 1) / T).toExponential(3)} %/s, cost ${(ms / T).toFixed(2)} ms/sim-s`;
}
for (const integ of ['Euler', 'implicitfast', 'implicit', 'RK4']) console.log(`B7 ${integ} dt=1/480:`, run(preset('default', 1, { integrator: integ })));
console.log('B7 Euler dt=1/1920:', run(preset('default', 1, { integrator: 'Euler', dt: 1 / 1920 })));
console.log('B7 RK4 lam=125:', run(preset('default', 125, { integrator: 'RK4' })));
process.exit(0);
