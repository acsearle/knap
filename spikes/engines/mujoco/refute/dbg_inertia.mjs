import load from '@mujoco/mujoco';
const mj = await load(); const S=0.008, RHO=0.3e-3/S**3, s=x=>+(x*S).toPrecision(10);
const AX=`euler="1.5707963267948966 0 0"`;
const m = mj.MjModel.from_xml_string(`<mujoco><default><geom density="${RHO}"/></default><worldbody><body><joint type="hinge" axis="0 1 0"/><geom type="cylinder" size="${s(1)} ${s(0.46)}" ${AX}/></body></worldbody></mujoco>`);
const d = new mj.MjData(m); mj.mj_forward(m,d);
const mass=m.body_mass[1]; console.log('mass', mass, 'expected', RHO*Math.PI*S*S*0.92*S, 'body_inertia', Array.from(m.body_inertia).slice(3), '0.5 m r^2', 0.5*mass*S*S, 'M', Array.from(d.M ?? []));
const res = new Float64Array(1); d.qvel[0]=2; mj.mj_mulM(m,d,res,d.qvel); console.log('mulM res', Array.from(res));
process.exit(0);
