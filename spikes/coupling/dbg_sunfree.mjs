// debug: generalized momentum p_β = I_A β' + I_p ω_p R/r_p of the free-arm planetary (should stay 0)
import { R, makeWorld, makeGear, revolute, pinGear, motor, Mesh, omega, v, q, sub, scl, dot, irot, arc, xyzw, DT, fmt } from './lib.mjs';
const axis=[0,1,0];
for (const [lead, ws, ramp, iters] of [[true,10,false,240],[true,10,false,60],[true,10,false,960]]) {
  const rs=1, rp=1, R0=2;
  const W=makeWorld({iters});
  const sun=makeGear(W,{centre:[0,0,0],axis,r:rs}); const js=pinGear(W,sun);
  const ab=W.w.createRigidBody(R.RigidBodyDesc.dynamic().setCanSleep(false));
  W.w.createCollider(R.ColliderDesc.cuboid(1,0.1,0.1).setTranslation(1,0,0).setDensity(0.5/0.08).setCollisionGroups(0x10000),ab);
  revolute(W,W.ground,ab,[0,0,0],[0,0,0],axis);
  const planet=makeGear(W,{centre:[R0,0,0],axis,r:rp});
  revolute(W,ab,planet.body,[R0,0,0],[0,0,0],axis);
  const m=new Mesh(W,sun,planet,{lead});
  const IA = v(ab.principalInertia())[1] + ab.mass()*1 + planet.body.mass()*R0*R0;
  const Ip = v(planet.body.principalInertia())[1];
  const out=[];
  for(let i=0;i<480*3;i++){
    if(!ramp) motor(W,js,ws); else motor(W,js,Math.min(1,i/480)*ws);
    m.update(); W.w.step();
    const p = IA*omega(ab,axis) + Ip*omega(planet.body,axis)*R0/rp;
    // also: Lin momentum-ish check: planet centre velocity vs arm
    if (i===0||i===1||i===10||i===479||i===1439) out.push(`step${i+1} p_β=${fmt(p,4)} β'=${fmt(omega(ab,axis),4)} ω_s=${fmt(omega(sun.body,axis),3)}`);
  }
  const an = Ip*R0*rs*ws/(IA*rp*rp+Ip*R0*R0);
  console.log(`iters=${iters} lead=${lead} ws=${ws} ramp=${ramp} IA=${fmt(IA,4)} Ip=${fmt(Ip,4)} analytic β'=${fmt(an,4)} :: ${out.join(' | ')}`);
}

// Exit explicitly: at exit Node 20 spins on Rapier wasm-bindgen finalizers (measured: minutes of CPU after the last line).
process.exit(0);
