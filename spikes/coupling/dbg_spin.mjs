// debug: without any mesh, a planet spinning on an arm (arm free, planet ω_p0) and a lone rotor: per-second drift
import { R, makeWorld, makeGear, revolute, omega, v, DT, fmt } from './lib.mjs';
const axis=[0,1,0];
for (const iters of [60,240]) {
  const W=makeWorld({iters});
  const ab=W.w.createRigidBody(R.RigidBodyDesc.dynamic().setCanSleep(false));
  W.w.createCollider(R.ColliderDesc.cuboid(1,0.1,0.1).setTranslation(1,0,0).setDensity(0.5/0.08).setCollisionGroups(0x10000),ab);
  revolute(W,W.ground,ab,[0,0,0],[0,0,0],axis);
  const planet=makeGear(W,{centre:[2,0,0],axis,r:1});
  revolute(W,ab,planet.body,[2,0,0],[0,0,0],axis);
  ab.setAngvel({x:0,y:1.6,z:0},true); planet.body.setAngvel({x:0,y:-6.8,z:0},true); planet.body.setLinvel({x:0,y:0,z:-3.2},true);
  const rotor=makeGear(W,{centre:[10,0,0],axis,r:1}); revolute(W,W.ground,rotor.body,[10,0,0],[0,0,0],axis); rotor.body.setAngvel({x:0,y:-6.8,z:0},true);
  const IA = v(ab.principalInertia())[1] + ab.mass()*1 + planet.body.mass()*4, Ip=v(planet.body.principalInertia())[1];
  const p=()=>IA*omega(ab,axis)+Ip*omega(planet.body,axis)*2;
  const p0=p(), wr0=omega(rotor.body,axis), wa0=omega(ab,axis), wp0=omega(planet.body,axis);
  for(let i=0;i<480;i++) W.w.step();
  console.log(`iters ${iters}: 1 s: Δ(arm ω) ${fmt(omega(ab,axis)-wa0,4)}, Δ(planet ω) ${fmt(omega(planet.body,axis)-wp0,4)}, Δ(lone rotor ω) ${fmt(omega(rotor.body,axis)-wr0,4)} rad/s; Δ(I_A β' + I_p ω_p R/r_p) ${fmt(p()-p0,4)}`);
}

// Exit explicitly: at exit Node 20 spins on Rapier wasm-bindgen finalizers (measured: minutes of CPU after the last line).
process.exit(0);
