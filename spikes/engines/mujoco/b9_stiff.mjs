// B9 follow-up: how soft are frictionloss and limits, and what stiffer solref/solimp buys.
// Run: node b9_stiff.mjs
import { mj, preset, header, v3, compile, step, STUD, HC } from './lib.mjs';
function pend(P, attrs) {
  const r = compile(`${header(P)}<worldbody><body><joint type="hinge" axis="0 1 0" ${attrs}/><geom type="box" size="${v3(P,3.5,HC,HC)}" pos="${v3(P,3,0,0)}" contype="0" conaffinity="0"/></body></worldbody></mujoco>`);
  return r;
}
const P0 = preset('default',1,{integrator:'implicitfast'});
const tauG = pend(P0,'').m.body_mass[1]*9.81*3*STUD;
for (const [lab, P, a] of [
  ['default', P0, ''],
  ['solreffriction 0.005 1', P0, 'solreffriction="0.005 1"'],
  ['solreffriction 0.005 1 + solimpfriction 0.99 0.9999 0.001', P0, 'solreffriction="0.005 1" solimpfriction="0.99 0.9999 0.001"'],
  ['same, dt 1/1920', preset('default',1,{integrator:'implicitfast',dt:1/1920}), 'solreffriction="0.001 1" solimpfriction="0.99 0.9999 0.001"'],
  ['noslip_iterations 20 (default solref)', preset('default',1,{integrator:'implicitfast'}), ''],
]) {
  const extraOpt = lab.startsWith('noslip') ? 'noslip_iterations="20"' : '';
  for (const k of [2, 1.2]) {
    const xml = `${header(P,{extraOption:extraOpt})}<worldbody><body><joint type="hinge" axis="0 1 0" frictionloss="${k*tauG}" ${a}/><geom type="box" size="${v3(P,3.5,HC,HC)}" pos="${v3(P,3,0,0)}" contype="0" conaffinity="0"/></body></worldbody></mujoco>`;
    const {m,d} = compile(xml);
    const q = [];
    for (const t of [0.1,1,10,60]) { while (d.time < t-1e-9) step(m,d); q.push(`${t}s:${d.qpos[0].toExponential(2)}`); }
    console.log(`frictionloss ${k} tauG, ${lab}: q ${q.join(' ')} rad`);
  }
}
for (const [lab, a] of [['default',''],['solreflimit 0.005 1','solreflimit="0.005 1"'],['solreflimit 0.005 1 solimplimit 0.99 0.9999 0.001','solreflimit="0.005 1" solimplimit="0.99 0.9999 0.001"']]) {
  const {m,d} = pend(P0, `range="-0.5 0.5" ${a}`);
  let mx=0; for (let i=0;i<4800;i++){step(m,d); mx=Math.max(mx,d.qpos[0]);}
  console.log(`limit, ${lab}: overshoot ${(mx-0.5).toExponential(2)} rad, rest error ${(d.qpos[0]-0.5).toExponential(2)} rad`);
}
process.exit(0);
