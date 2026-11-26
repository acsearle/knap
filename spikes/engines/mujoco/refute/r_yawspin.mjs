// Probe the tuned-settings fall-through of a spinning, sliding wheel (r 1, len 0.92) on a 1-stud box floor.
// Run: node r_yawspin.mjs
import load from '@mujoco/mujoco';
const mj = await load(); const S=0.008, RHO=0.3e-3/S**3, s=x=>+(x*S).toPrecision(10);
function run(lab, {solref='0.005 1', solimp='0.95 0.99 0.0001', flags='', integ='implicitfast', cone='elliptic', imp=10, thick=0.5, margin=0}) {
  const xml=`<mujoco><compiler angle="radian"/><option timestep="${1/480}" integrator="${integ}" cone="${cone}" impratio="${imp}" gravity="0 0 -9.81"><flag ${flags}/></option>
  <default><geom density="${RHO}" friction="0.5 0.005 0.0001" solref="${solref}" solimp="${solimp}" margin="${margin}"/></default><worldbody>
  <geom type="box" size="${s(200)} ${s(20)} ${s(thick)}" pos="${s(180)} 0 ${s(-thick)}"/>
  <body pos="0 0 ${s(1)}" euler="1.5707963267948966 0 0"><freejoint/><geom type="cylinder" size="${s(1)} ${s(0.46)}"/></body></worldbody></mujoco>`;
  const m=mj.MjModel.from_xml_string(xml), d=new mj.MjData(m); mj.mj_forward(m,d);
  d.qvel[0]=100*S; d.qvel[4]=100;
  let tBad=null, info='';
  let prev='';
  while(d.time<2){ mj.mj_step(m,d); const z=d.xpos[5]/S; const axz=d.xmat[9+8];
    if(tBad===null && z<0.3){ tBad=d.time; info=prev; }
    prev=`t=${d.time.toFixed(3)} x=${(d.xpos[3]/S).toFixed(1)} y=${(d.xpos[4]/S).toFixed(1)} z=${z.toFixed(3)} axisZ=${axz.toFixed(3)} ncon=${d.ncon} pen=${d.ncon? (-d.contact.get(0).dist/S).toFixed(3):'-'}`;
  }
  console.log(lab.padEnd(34), tBad===null?`held, end z ${(d.xpos[5]/S).toFixed(3)} axisZ ${d.xmat[17].toFixed(3)}`:`FELL at ${tBad.toFixed(3)} s; step before: ${info}`);
}
run('tuned', {});
run('tuned, default solimp', {solimp:'0.9 0.95 0.001'});
run('tuned, solref 0.01', {solref:'0.01 1'});
run('tuned, multiccd off', {flags:'multiccd="disable"'});
run('tuned, nativeccd off', {flags:'nativeccd="disable"'});
run('tuned, floor 4 thick', {thick:2});
run('tuned, margin 0.05 stud', {margin:s(0.05)});
run('default all', {solref:'0.02 1', solimp:'0.9 0.95 0.001', integ:'Euler', cone:'pyramidal', imp:1});
run('default but solref 0.005', {integ:'Euler', cone:'pyramidal', imp:1, solimp:'0.9 0.95 0.001'});
process.exit(0);
