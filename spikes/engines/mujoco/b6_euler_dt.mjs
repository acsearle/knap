// How the B6b triple-pendulum energy error of the first-order integrators scales with dt.
// Run: node b6_euler_dt.mjs
import { preset, header, v3, compile, step, energy, STUD, HC } from './lib.mjs';
function xml(p){let o='',c='';for(let i=0;i<3;i++){o+=`<body pos="${i?v3(p,6,0,0):'0 0 0'}"><joint type="hinge" axis="0 1 0"/><geom type="box" size="${v3(p,3.5,HC,HC)}" pos="${v3(p,3,0,0)}" contype="0" conaffinity="0"/>`;c+='</body>';}return `${header(p)}<worldbody>${o}${c}</worldbody></mujoco>`;}
for (const integ of ['Euler','implicitfast','RK4']) for (const k of [1,4,20,100]) {
  const p = preset('default',1,{integrator:integ, dt:1/(480*k)});
  const {m,d}=compile(xml(p)); const E0=energy(m,d); const ref=m.body_mass[1]*9.81*27*STUD;
  let maxOmega=0; const t0=performance.now();
  for(let i=0;i<Math.round(10/p.dt);i++){step(m,d); for(let j=0;j<3;j++) maxOmega=Math.max(maxOmega,Math.abs(d.qvel[j]));}
  console.log(`${integ} dt=1/${480*k}: dE=${(100*(energy(m,d)-E0)/ref).toFixed(3)}% max|qdot|=${maxOmega.toFixed(1)} rad/s cost=${((performance.now()-t0)/10).toFixed(1)} ms/sim-s`);
}
process.exit(0);
