// Scale sweep for the two scale-sensitive findings: B2 (flat drop) and B5a (gentle roll).
// node sweep.mjs
import { World, fmt, len, tilt, DT } from "./hv.mjs";
const hs=(v)=>Math.hypot(v[0],v[2]);
function b2(U, v0, o={}) {
  const w = new World({U, ...o}); w.body(w.box([40,1,40]),{pos:[0,-0.5,0],dynamic:false});
  const c=w.body(w.box([0.92,0.92,0.92]),{pos:[0,0.46+v0*DT*0.5,0]}); w.setVel(c,[0,-v0,0]);
  let up=0, side=0, spin=0, yaw=0;
  for(let i=1;i<=480;i++){ w.step(); const v=w.vel(c), a=w.ang(c); up=Math.max(up,v[1]); side=Math.max(side,hs(v));
    if(i<=48) spin=Math.max(spin,len(a)); else yaw=Math.max(yaw,len(a)); }
  return `rebound ${fmt(up,2)} side ${fmt(side,2)} spin(<0.1s) ${fmt(spin,2)} spin(0.1-1s) ${fmt(yaw,2)} tilt ${fmt(tilt(w.pose(c).q),3)}`;
}
function b5(U, v0, o={}) {
  const w = new World({U, ...o}); w.body(w.box([400,1,400]),{pos:[0,-0.5,0],dynamic:false});
  const c=w.body(w.cyl([0,0,-0.46],[0,0,0.46],1),{pos:[0,1,0]}); w.setVel(c,[v0,0,0]); w.setAng(c,[0,0,-v0]);
  let mx=0, mn=1e9, sink=0; for(let i=1;i<=480*3;i++){w.step(); const vx=w.vel(c)[0]; if(i>48){mx=Math.max(mx,vx);mn=Math.min(mn,vx);} sink=Math.max(sink,1-w.pose(c).p[1]);}
  return `vx 0.1-3s min ${fmt(mn,4)} max ${fmt(mx,4)} final ${fmt(w.vel(c)[0],4)} max sink ${fmt(sink,4)}`;
}
for (const U of [0.008, 0.08, 0.25, 1]) {
  console.log(`U=${U} (${U===0.008?"metres":U===1?"studs":"int.units/stud"}) cube mass ~${fmt(752*(0.92*U)**3,4)}`);
  for (const v of [10,150,300]) console.log(`  B2 v=${v}: ${b2(U,v)}`);
  for (const v of [0.1,1,10]) console.log(`  B5a v=${v}: ${b5(U,v)}`);
}
console.log("variants at metres:");
console.log("  B2 150, ideal step time 0 (no auto adjust):", b2(0.008,150,{ideal:0}));
console.log("  B2 150, density x1000:", b2(0.008,150,{density:752000}));
console.log("  B5a 1, ideal 0:", b5(0.008,1,{ideal:0}));
console.log("  B5a 1, density x1000:", b5(0.008,1,{density:752000}));
console.log("  B2 150, 1/60 s steps:", b2(0.008,150,{dt:1/60, ideal:1/60}));
process.exit(0);
