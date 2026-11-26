import load from '@mujoco/mujoco';
const mj = await load(); const S=0.008, s=x=>+(x*S).toPrecision(10);
const v=[]; for (const z of [-0.25,0.25]) for(let i=0;i<32;i++){const a=2*Math.PI*i/32+0.05; v.push(`${s(0.5*Math.cos(a))} ${s(0.5*Math.sin(a))} ${s(z)}`);}
const m = mj.MjModel.from_xml_string(`<mujoco><asset><mesh name="p" vertex="${v.join(' ')}"/></asset><worldbody><geom type="mesh" mesh="p" pos="0 0 ${s(-0.25)}"/><body pos="0 0 ${s(0.05)}"><freejoint/><geom type="box" size="${s(0.08)} ${s(0.05)} ${s(0.08)}"/></body></worldbody></mujoco>`);
const d = new mj.MjData(m); mj.mj_forward(m,d);
console.log('geom_pos', Array.from(m.geom_pos).map(x=>x/S), 'geom_quat', Array.from(m.geom_quat), 'mesh_vertnum', Array.from(m.mesh_vertnum));
console.log('mesh vert z', Array.from(m.mesh_vert).filter((_,i)=>i%3==2).slice(0,4).map(x=>x/S), 'x', Array.from(m.mesh_vert).filter((_,i)=>i%3==0).slice(0,4).map(x=>x/S));
console.log('geom_xpos', Array.from(d.geom_xpos).map(x=>x/S));
for (let i=0;i<d.ncon;i++){const c=d.contact.get(i); console.log('contact dist', c.dist/S, 'pos', Array.from(c.pos).map(x=>x/S));}
console.log('mesh_pos', Array.from(m.mesh_pos??[]).map(x=>x/S), 'mesh_quat', Array.from(m.mesh_quat??[]));
process.exit(0);
