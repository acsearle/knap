// Repro of an accidental case: wheel r1 lying on its side (axis horizontal), sliding at 100 studs/s
// while spinning at 100 rad/s about its OWN axis' body-frame Y (which is world vertical, i.e. it
// spins about the contact normal). Run: node b5_yawspin.mjs
import { preset, header, v3, compile, bodyId, pos, freeVel, norm, step, STUD } from './lib.mjs';
function run(p, floor) {
  const fl = floor==='plane' ? `<geom type="plane" size="0 0 1"/>` : `<geom type="box" size="${v3(p,200,20,0.5)}" pos="${v3(p,180,0,-0.5)}"/>`;
  const { m, d } = compile(`${header(p)}<worldbody>${fl}<body name="w" pos="${v3(p,0,0,1)}" euler="1.5707963267948966 0 0"><freejoint/><geom type="cylinder" size="${v3(p,1,0.46,0)}"/></body></worldbody></mujoco>`);
  const b = bodyId(m,'w'); const a = m.jnt_dofadr[m.body_jntadr[b]];
  d.qvel[a] = 100*STUD*p.lam; d.qvel[a+4] = 100; // body-frame y = world vertical
  let maxV=0, minZ=9, tBad=null;
  while (d.time < 2-1e-9) { step(m,d); const v=norm(freeVel(p,m,d,b).lin); maxV=Math.max(maxV,v); const z=pos(p,d,b)[2]; minZ=Math.min(minZ,z); if(tBad===null && (z<0.5||v>150)) tBad=d.time; }
  return `maxSpeed=${maxV.toFixed(1)} minZ=${minZ.toFixed(3)} firstBad=${tBad===null?'none':tBad.toFixed(3)+'s'} end v=${norm(freeVel(p,m,d,b).lin).toFixed(2)}`;
}
for (const [l,p] of [['default',preset('default',1)],['tuned',preset('tuned',1)],['tuned but pyramidal',preset('tuned',1,{cone:'pyramidal'})],['tuned but impratio 1',preset('tuned',1,{impratio:1})],['tuned but Euler',preset('tuned',1,{integrator:'Euler'})],['tuned, dt/4',preset('tuned',1,{dt:1/1920})]])
  for (const f of ['box','plane']) console.log(l, f, run(p,f));
process.exit(0);
