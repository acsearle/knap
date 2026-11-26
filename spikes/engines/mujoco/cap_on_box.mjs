// Cylinder r1 (len .92) cap-down on a fixed box floor: rest, sliding, sliding+spinning, small tilt.
// Investigates the fall-through seen in b5_yawspin.mjs. Run: node cap_on_box.mjs
import { preset, header, v3, compile, bodyId, pos, freeVel, norm, step, STUD } from './lib.mjs';
function run(p, vx, wz, tilt, floor='box') {
  const fl = floor==='plane' ? `<geom type="plane" size="0 0 1"/>` : `<geom type="box" size="${v3(p,200,20,0.5)}" pos="${v3(p,180,0,-0.5)}"/>`;
  const { m, d } = compile(`${header(p)}<worldbody>${fl}<body name="w" pos="${v3(p,0,0,0.46+Math.sin(tilt))}" euler="${tilt} 0 0"><freejoint/><geom type="cylinder" size="${v3(p,1,0.46,0)}"/></body></worldbody></mujoco>`);
  const b = bodyId(m,'w'); const a = m.jnt_dofadr[m.body_jntadr[b]];
  d.qvel[a] = vx*STUD*p.lam; d.qvel[a+5] = wz;
  let minZ=9, nmin=99; let t=0;
  while (d.time < 2-1e-9) { step(m,d); const z=pos(p,d,b)[2]; minZ=Math.min(minZ,z); if (d.time>0.05) nmin=Math.min(nmin,d.ncon); }
  return `minZ=${minZ.toFixed(4)} (rest 0.46) nconMin=${nmin} endZ=${pos(p,d,b)[2].toFixed(3)}`;
}
for (const [l,p] of [['default',preset('default',1)],['tuned',preset('tuned',1)],['tuned multiccd off',preset('tuned',1,{flags:'multiccd="disable"'})]])
  for (const [vx,wz,tilt] of [[0,0,0],[0,0,0.05],[20,0,0],[0,20,0],[100,0,0],[0,0,0.3]])
    console.log(l, `vx=${vx} wz=${wz} tilt=${tilt}`, 'box:', run(p,vx,wz,tilt), '| plane:', run(p,vx,wz,tilt,'plane'));
process.exit(0);
