// check the LinY limit sign/behaviour of Mesh{stop}: push gear 2 (free on a prismatic toward gear 1) and see where it stops
import { R, makeWorld, makeGear, pinGear, Mesh, v, len, sub, DT, fmt } from './lib.mjs';
for (const stopMin of [0, -1e6, 'none', -0.5]) {
  const W = makeWorld({ gravity: [-2000, 0, 0] }); // pulls gear 2 toward gear 1 along −x
  const g1 = makeGear(W, { centre: [0, 0, 0], axis: [0, 0, 1], r: 1 });
  pinGear(W, g1);
  const g2 = makeGear(W, { centre: [2.05, 0, 0], axis: [0, 0, 1], r: 1 });
  // gear 2 on a prismatic along x to the ground (so it can approach), free to spin? use generic: lock LinY, LinZ, AngX, AngY
  const d = R.JointData.generic({ x: 2.05, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, R.JointAxesMask.LinY | R.JointAxesMask.LinZ | R.JointAxesMask.AngX | R.JointAxesMask.AngY);
  W.w.createImpulseJoint(d, W.ground, g2.body, true);
  const m = stopMin === null ? { update() {} } : new Mesh(W, g1, g2, { stop: true, stopMin, lead: true });
  const tr = [];
  for (let i = 0; i < 480; i++) { m.update(); W.w.step(); if (i % 60 === 0) tr.push(fmt(v(g2.body.translation())[0], 4)); }
  console.log(tr.join(' '));
  console.log(`stopMin=${stopMin}: centre distance after 1 s: ${fmt(len(sub(v(g2.body.translation()), v(g1.body.translation()))), 5)} (pitch 2; colliders off)`);
}

// Exit explicitly: at exit Node 20 spins on Rapier wasm-bindgen finalizers (measured: minutes of CPU after the last line).
process.exit(0);
