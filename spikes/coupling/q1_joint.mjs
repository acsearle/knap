// Q1: is the re-anchored single-axis generic joint expressible / a pure one-row constraint?
import { R, makeWorld, xyz, xyzw, v, q, sub, add, dot, cross, len, scl, rot, arc, fmt, now, makeGear, pinGear, Mesh, omega, motor, PITCH } from './lib.mjs';

function freeBody(W, pos, vel, angvel, m = 1) {
  const b = W.w.createRigidBody(R.RigidBodyDesc.dynamic().setTranslation(...pos).setCanSleep(false).setLinvel(...vel).setAngvel(xyz(angvel)));
  // ball radius 0.5, density so mass m; I = 0.4 m r^2 = 0.1 m
  const vol = (4 / 3) * Math.PI * 0.125;
  W.w.createCollider(R.ColliderDesc.ball(0.5).setDensity(m / vol).setCollisionGroups(0x00010000), b);
  return b;
}

console.log('--- (a) which frame defines the locked axis: frame1 X = x, frame2 X = y; body2 v = (1,1,0)');
for (const swap of [false, true]) {
  const W = makeWorld({ gravity: [0, 0, 0] });
  const b1 = freeBody(W, [0, 0, 0], [0, 0, 0], [0, 0, 0]);
  const b2 = freeBody(W, [0, 0, 0], [1, 1, 0], [0, 0, 0]);
  const d = R.JointData.generic({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, R.JointAxesMask.LinX);
  const j = W.w.createImpulseJoint(d, b1, b2, true);
  const fx = [0, 0, 0, 1];
  const fy = arc([1, 0, 0], [0, 1, 0]);
  j.setFrameX1(xyzw(swap ? fy : fx));
  j.setFrameX2(xyzw(swap ? fx : fy));
  W.w.step();
  console.log(`frame1 X=${swap ? 'y' : 'x'} frame2 X=${swap ? 'x' : 'y'}: v1=${v(b1.linvel()).map((x) => fmt(x, 4))} v2=${v(b2.linvel()).map((x) => fmt(x, 4))}  readback frameX1=${q(j.frameX1()).map((x) => fmt(x, 3))}`);
}

console.log('--- (b) one-row purity: offset anchors, random velocities, single step vs analytic single-row impulse');
{
  const W = makeWorld({ gravity: [0, 0, 0] });
  const v1 = [0.3, -0.7, 0.2], w1 = [0.5, 0.1, -0.4], v2 = [-0.6, 0.4, 0.9], w2 = [-0.2, 0.8, 0.3];
  const b1 = freeBody(W, [0, 0, 0], v1, w1, 1);
  const b2 = freeBody(W, [2, 0.3, 0], v2, w2, 3);
  const P = [1, 0.5, 0.2];
  const X = [0.6, 0.8, 0];
  const d = R.JointData.generic(xyz(P), xyz(sub(P, [2, 0.3, 0])), { x: 1, y: 0, z: 0 }, R.JointAxesMask.LinX);
  const j = W.w.createImpulseJoint(d, b1, b2, true);
  const F = arc([1, 0, 0], X);
  j.setFrameX1(xyzw(F));
  j.setFrameX2(xyzw(F));
  // analytic single row with frozen Jacobian: J = [-X, -(r1×X), X, r2×X]
  const r1 = P, r2 = sub(P, [2, 0.3, 0]);
  const m1 = 1, m2 = 3, I1 = 0.1 * m1, I2 = 0.1 * m2;
  const a1 = cross(r1, X), a2 = cross(r2, X);
  const vrel = dot(X, sub(add(v2, cross(w2, r2)), add(v1, cross(w1, r1))));
  const K = 1 / m1 + 1 / m2 + dot(a1, a1) / I1 + dot(a2, a2) / I2;
  const lam = -vrel / K;
  const pv1 = sub(v1, scl(X, lam / m1)), pw1 = sub(w1, scl(a1, lam / I1));
  const pv2 = add(v2, scl(X, lam / m2)), pw2 = add(w2, scl(a2, lam / I2));
  W.w.step();
  const dv = (a, b) => len(sub(a, b));
  console.log(`|v1-pred|=${fmt(dv(v(b1.linvel()), pv1))} |w1-pred|=${fmt(dv(v(b1.angvel()), pw1))} |v2-pred|=${fmt(dv(v(b2.linvel()), pv2))} |w2-pred|=${fmt(dv(v(b2.angvel()), pw2))}  (|v|~1; deviations are the in-step rotation of the Jacobian over 1/480 s)`);
  // momentum conservation
  const p0 = add(scl(v1, m1), scl(v2, m2));
  const p1 = add(scl(v(b1.linvel()), m1), scl(v(b2.linvel()), m2));
  console.log(`linear momentum change |Δp|=${fmt(len(sub(p1, p0)))}`);
  // free-axis drift: run 2 s, relative motion along the locked axis (frame1 X in world) at the anchors vs along the others
  let maxX = 0;
  for (let i = 0; i < 960; i++) {
    W.w.step();
    const q1 = q(b1.rotation()), q2 = q(b2.rotation());
    const p1w = add(v(b1.translation()), rot(q1, r1));
    const p2w = add(v(b2.translation()), rot(q2, r2));
    const Xw = rot(q1, X);
    maxX = Math.max(maxX, Math.abs(dot(sub(p2w, p1w), Xw)));
  }
  const q1 = q(b1.rotation()), q2 = q(b2.rotation());
  const sep = sub(add(v(b2.translation()), rot(q2, r2)), add(v(b1.translation()), rot(q1, r1)));
  console.log(`2 s free tumbling: max |sep·X1| = ${fmt(maxX)}; final |sep| = ${fmt(len(sep))} (free axes keep separating: ${len(sep) > 0.5})`);
}

console.log('--- (c) in-place updates take effect on the next step');
{
  const W = makeWorld({ gravity: [0, 0, 0] });
  const b1 = freeBody(W, [0, 0, 0], [0, 0, 0], [0, 0, 0]);
  const b2 = freeBody(W, [0, 0, 0], [0, 0, 0], [0, 0, 0]);
  const j = W.w.createImpulseJoint(R.JointData.generic({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, R.JointAxesMask.LinX), b1, b2, true);
  W.w.step();
  j.setAnchor1({ x: 0.1, y: 0, z: 0 });
  W.w.step();
  const sx = v(b2.translation())[0] - v(b1.translation())[0];
  console.log(`after setAnchor1(+0.1 x), one step: x2 - x1 = ${fmt(sx, 5)} (target 0.1)`);
  j.setFrameX1(xyzw(arc([1, 0, 0], [0, 1, 0])));
  j.setFrameX2(xyzw(arc([1, 0, 0], [0, 1, 0])));
  j.setAnchor1({ x: 0, y: 0.1, z: 0 });
  j.setAnchor2({ x: 0, y: 0, z: 0 });
  const xb = sub(v(b2.translation()), v(b1.translation()));
  W.w.step();
  const xa = sub(v(b2.translation()), v(b1.translation()));
  console.log(`after setFrameX1/2(X=y) + setAnchor1(+0.1 y): Δx sep = ${fmt(xa[0] - xb[0], 5)} (now free), y sep = ${fmt(xa[1], 5)} (target 0.1)`);
}

console.log('--- (d) cost of in-place re-anchoring vs recreate per step (gear pair, 2 revolutes, 240 substeps)');
function costRun(mode, steps = 2400) {
  const W = makeWorld();
  const g1 = makeGear(W, { centre: [0, 0, 0], axis: [0, 0, 1], r: 1 });
  const g2 = makeGear(W, { centre: [2, 0, 0], axis: [0, 0, 1], r: 1 });
  const j1 = pinGear(W, g1);
  pinGear(W, g2);
  motor(W, j1, 10);
  let m = mode === 'none' ? null : new Mesh(W, g1, g2, {});
  let tUpd = 0;
  const t0 = now();
  for (let i = 0; i < steps; i++) {
    const a = now();
    if (mode === 'reanchor') m.update();
    else if (mode === 'recreate') {
      m.remove();
      const phi0 = m.phi0, s1 = m.s1, s2 = m.s2, sp = m.sp;
      m = new Mesh(W, g1, g2, {});
      // keep phase tracking continuity: re-run with the old reference
      m.s1 = s1; m.s2 = s2; m.sp = sp; m.phi0 = phi0; m.joint && m.remove();
      m.dead = false; m.joint = null;
      m.update(true);
    }
    tUpd += now() - a;
    W.w.step();
  }
  const T = now() - t0;
  const e = m ? m.e : 0;
  return { msPerStep: T / steps, updUs: (1000 * tUpd) / steps, ratio: m ? omega(g2.body, [0, 0, 1]) / omega(g1.body, [0, 0, 1]) : NaN, eTeeth: e / PITCH };
}
for (const mode of ['none', 'reanchor', 'recreate']) {
  costRun(mode, 200);
  const r = costRun(mode);
  console.log(`${mode.padEnd(9)} ${fmt(r.msPerStep, 4)} ms/step (${fmt(r.msPerStep * 480, 1)} ms per simulated s), JS-side update ${fmt(r.updUs, 1)} µs/step, ratio ω2/ω1=${fmt(r.ratio, 5)}, phase err ${fmt(r.eTeeth, 5)} teeth`);
}

// Exit explicitly: at exit Node 20 spins on Rapier wasm-bindgen finalizers (measured: minutes of CPU after the last line).
process.exit(0);
