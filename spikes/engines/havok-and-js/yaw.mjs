// Resting cube (0.92 studs) on a fixed box floor, mu 0.5, given a 1e-3 rad/s yaw kick; also a beam 9.
// Reports the largest |w| reached in 2 s at several internal scales. node yaw.mjs
import { World, H, fmt, len } from "./hv.mjs";
for (const U of [0.008, 0.02, 0.04, 0.08, 0.25, 1]) for (const [nm, ext] of [["cube", [0.92,0.92,0.92]], ["beam9", [9,0.92,0.92]]]) {
  const w = new World({U}); w.body(w.box([40,1,40]),{pos:[0,-0.5,0],dynamic:false});
  const c=w.body(w.box(ext),{pos:[0,0.46,0]}); w.setAng(c,[0,1e-3,0]);
  let mx=0, act=0; for(let i=1;i<=960;i++){w.step(); mx=Math.max(mx,len(w.ang(c)));}
  const a = H.HP_Body_GetActivationState(c.id)[1] === H.ActivationState.ACTIVE;
  console.log(`U=${U} ${nm}: max |w| in 2 s = ${fmt(mx,4)} rad/s, final ${fmt(len(w.ang(c)),4)}, active=${a}`);
}
process.exit(0)
