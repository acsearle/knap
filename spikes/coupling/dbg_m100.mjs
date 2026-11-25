// debug: heavy-output static settle (mass ratio 26 and 100): ω1 history
import { R, makeWorld, weight, revolute, Mesh, omega, twist, q, arc, xyzw, DT, PITCH, fmt } from './lib.mjs';
const AX=[0,0,1];
for (const [m1,m2,damp,lead] of [[3,80,3,true],[3,80,3,false],[0.2,98,3,true],[3,80,0,true]]) {
  const W = makeWorld();
  const mk=(c,r,arm)=>{const b=W.w.createRigidBody(R.RigidBodyDesc.dynamic().setTranslation(...c).setCanSleep(false).setAngularDamping(damp));
    W.w.createCollider(R.ColliderDesc.cylinder(0.5,r).setRotation(xyzw(arc([0,1,0],AX))).setCollisionGroups(0x10000),b);
    W.w.createCollider(weight([arm[0],arm[1],0],arm[2]).setCollisionGroups(0x10000),b); revolute(W,W.ground,b,c,[0,0,0],AX); return {body:b,lc:[0,0,0],la:AX,r};};
  const g1=mk([0,0,0],0.5,[3,0,m1]), g2=mk([3,0,0],2.5,[0,-3,m2]);
  const m=new Mesh(W,g1,g2,{lead});
  const s={}; let line=[];
  for(let i=1;i<=480*12;i++){m.update();W.w.step(); const th=twist(q(g1.body.rotation()),AX,s); if(i%480===0) line.push(`${i/480}s θ${fmt(th,4)} ω${fmt(omega(g1.body,AX),3)}`);}
  console.log(`m1=${m1} m2=${m2} damp=${damp} lead=${lead} masses ${fmt(g1.body.mass(),3)}/${fmt(g2.body.mass(),3)}: ${line.join(' | ')}`);
}

// Exit explicitly: at exit Node 20 spins on Rapier wasm-bindgen finalizers (measured: minutes of CPU after the last line).
process.exit(0);
