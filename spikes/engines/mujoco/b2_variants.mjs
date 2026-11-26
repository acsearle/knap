// B2 variants: speculative contacts (MuJoCo 4.0 flag) and a plane floor. Run: node b2_variants.mjs
import { preset, header, v3, compile, bodyId, pos, freeVel, norm, step, HC, STUD } from './lib.mjs';
function run(p, v, gap, plane) {
  const floor = plane ? `<geom type="plane" size="0 0 1"/>` : `<geom type="box" size="${v3(p,20,20,0.5)}" pos="${v3(p,0,0,-0.5)}"/>`;
  const { m, d } = compile(`${header(p)}<worldbody>${floor}<body name="c" pos="${v3(p,0,0,HC+gap)}"><freejoint/><geom type="box" size="${v3(p,HC,HC,HC)}"/></body></worldbody></mujoco>`);
  const b = bodyId(m,'c'); d.qvel[m.jnt_dofadr[m.body_jntadr[b]]+2] = -v*STUD*p.lam;
  let deep=0, reb=0, side=0, spin=0;
  for (let i=0;i<240;i++){ step(m,d); deep=Math.max(deep,HC-pos(p,d,b)[2]); const q=freeVel(p,m,d,b); reb=Math.max(reb,q.lin[2]); side=Math.max(side,Math.hypot(q.lin[0],q.lin[1])); spin=Math.max(spin,norm(q.ang)); }
  return `deepest=${deep.toFixed(4)} rebound=${reb.toFixed(2)} side=${side.toExponential(1)} spin=${spin.toExponential(1)}`;
}
for (const [label, p, plane] of [
  ['default, plane floor', preset('default',1), true],
  ['tuned + speculative, box floor', preset('tuned',1,{flags:'speculative="enable"'}), false],
  ['default + speculative, box floor', preset('default',1,{flags:'speculative="enable"'}), false],
  ['tuned, dt 1/1920 (x4)', preset('tuned',1,{dt:1/1920}), false],
]) for (const v of [150,300]) for (const g of [0.05,0.15,0.25]) console.log(label, 'v', v, 'gap', g, run(p,v,g,plane));
process.exit(0);
