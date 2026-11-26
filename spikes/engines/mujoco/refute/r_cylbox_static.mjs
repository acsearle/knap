// Static narrow-phase probe: cylinder r1 len 0.92 placed overlapping a box floor (top z=0) at a tilt;
// count contacts from mj_forward for box vs plane floor, sweeping tilt and depth. Run: node r_cylbox_static.mjs
import load from '@mujoco/mujoco';
const mj = await load(); const S=0.008, s=x=>+(x*S).toPrecision(10);
function probe(floor, tilt, pen, flags='') {
  // axis tilted 'tilt' rad from vertical, about world x. Lowest point depth = pen below z=0.
  const r=1, hl=0.46; const lowest = r*Math.cos(tilt) + hl*Math.sin(tilt) ; // for axis tilted from vertical: rim lowest point below centre
  // centre height so lowest point is at -pen
  const zc = (hl*Math.cos(tilt) + r*Math.sin(tilt)) - pen;
  const fl = floor==='plane'?`<geom type="plane" size="0 0 1"/>`:`<geom type="box" size="${s(50)} ${s(50)} ${s(0.5)}" pos="0 0 ${s(-0.5)}"/>`;
  const q=[Math.cos(tilt/2), Math.sin(tilt/2),0,0];
  const m=mj.MjModel.from_xml_string(`<mujoco><option><flag ${flags}/></option><worldbody>${fl}<body pos="${s(0.3)} ${s(0.2)} ${s(zc)}" quat="${q.join(' ')}"><freejoint/><geom type="cylinder" size="${s(r)} ${s(hl)}"/></body></worldbody></mujoco>`);
  const d=new mj.MjData(m); mj.mj_forward(m,d);
  let deep=0; for(let i=0;i<d.ncon;i++){deep=Math.max(deep,-d.contact.get(i).dist/S);}
  return `${d.ncon}c/${deep.toFixed(2)}`;
}
const tilts=(process.argv[2]?[0.6,0.96,1.2]:[0,0.2,0.5,0.8,0.98,1.2,1.4,1.5708]); const pens=(process.argv[2]?[0.4,0.6,0.7,0.9]:[0.01,0.1,0.3]);
for (const flags of ['', 'multiccd="disable"', 'nativeccd="disable"']) for (const floor of ['plane','box']) {
  const row=[]; for(const t of tilts) for(const pen of pens) row.push(`t${t}p${pen}:${probe(floor,t,pen,flags)}`);
  console.log(floor.padEnd(5), (flags||'defaults').padEnd(20), row.join(' '));
}
process.exit(0);
