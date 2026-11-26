import load from '@mujoco/mujoco';
const mj = await load();
const m = mj.MjModel.from_xml_string(`<mujoco><worldbody><body><freejoint/><geom type="box" size=".1 .1 .1"/></body></worldbody></mujoco>`);
const o=m.opt; const out={};
for (const k of Object.keys(Object.getPrototypeOf(o))) { try{ const v=o[k]; if(typeof v!=='function') out[k]= (v&&v.length!==undefined)? Array.from(v):v;}catch(e){} }
console.log(out);
console.log('geom_solref', Array.from(m.geom_solref), 'solimp', Array.from(m.geom_solimp), 'margin', Array.from(m.geom_margin));
process.exit(0);
