// B9 follow-up: noslip solver with frictionloss below the gravity torque (must still fall,
// and the friction work must be right). Run: node b9_noslip.mjs
import { preset, header, v3, compile, step, energy, STUD, HC } from './lib.mjs';
const P = preset('default',1,{integrator:'implicitfast'});
for (const k of [0, 0.5, 0.9, 1.0, 1.01]) {
  const xml0 = `${header(P,{extraOption:'noslip_iterations="20"'})}<worldbody><body><joint type="hinge" axis="0 1 0" frictionloss="FL"/><geom type="box" size="${v3(P,3.5,HC,HC)}" pos="${v3(P,3,0,0)}" contype="0" conaffinity="0"/></body></worldbody></mujoco>`;
  const {m:m0} = compile(xml0.replace('FL','0')); const tauG = m0.body_mass[1]*9.81*3*STUD;
  const {m,d} = compile(xml0.replace('FL', String(k*tauG)));
  const E0 = energy(m,d); let fw = 0; const t0=performance.now();
  while (d.time < 2-1e-9) { const q0=d.qpos[0]; step(m,d); fw += k*tauG*Math.abs(d.qpos[0]-q0); }
  const dE = energy(m,d)-E0;
  console.log(`frictionloss ${k} tauG + noslip: q(2s)=${d.qpos[0].toFixed(4)} qdot=${d.qvel[0].toFixed(3)}  -dE/frictionWork=${fw>0?(-dE/fw).toFixed(4):'-'}  cost ${((performance.now()-t0)/2).toFixed(2)} ms/sim-s`);
}
process.exit(0);
