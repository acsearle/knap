// S7: (a) free-floating gearbox, internal torque: total angular momentum must stay 0;
// (b) band-edge engage/release with the recipe's proximity rule on a kinematically vibrating carrier;
// (c) cost per mesh vs per revolute body, measured interleaved.
// usage: node spikes/skeptic/s7_misc.mjs [float] [band] [cost]
import { R, makeWorld, revolute, Mesh, twist, omega, q, v, DT, G, PITCH, fmt, motor, now, len, sub } from './sk.mjs';
import { gearBody, AXZ, angMom, inertiaAbout } from './sk.mjs';

const which = process.argv.slice(2);
const want = (c) => which.length === 0 || which.includes(c);

if (want('float')) {
  console.log('=== (a) free-floating frame (box 4×1×1, density 1) carrying gear A r1 at x=0 and gear B r2 at x=r1+r2 on revolutes; zero gravity.');
  console.log('    internal torque τ=50 on A (−τ on the frame) for 0.5 s, then coast 4.5 s. |L_total| must stay 0; compare with |L| scale I_A·ω_A.');
  for (const [r1, r2, mesh] of [[1, 1, false], [1, 1, true], [0.5, 2.5, true], [2.5, 0.5, true]]) {
    const W = makeWorld({ gravity: [0, 0, 0] });
    const F = W.w.createRigidBody(R.RigidBodyDesc.dynamic().setCanSleep(false).setTranslation(1, 0, -1));
    W.w.createCollider(R.ColliderDesc.cuboid(2, 0.5, 0.5).setDensity(1).setCollisionGroups(0x00010000), F);
    const A = gearBody(W, [0, 0, 0], r1);
    const B = gearBody(W, [r1 + r2, 0, 0], r2);
    revolute(W, F, A.body, [-1, 0, 1], [0, 0, 0], AXZ);
    revolute(W, F, B.body, [r1 + r2 - 1, 0, 1], [0, 0, 0], AXZ);
    const M = mesh ? new Mesh(W, A.g, B.g, { lead: true }) : null;
    const bodies = [F, A.body, B.body];
    let maxL = 0, scale = 0;
    const sF = {};
    twist(q(F.rotation()), AXZ, sF);
    for (let i = 0; i < 480 * 5; i++) {
      const on = i < 240;
      A.body.resetTorques(true);
      F.resetTorques(true);
      if (on) {
        A.body.addTorque({ x: 0, y: 0, z: 50 }, true);
        F.addTorque({ x: 0, y: 0, z: -50 }, true);
      }
      M?.update();
      W.w.step();
      twist(q(F.rotation()), AXZ, sF);
      const L = angMom(bodies);
      maxL = Math.max(maxL, len(L));
      scale = Math.max(scale, Math.abs(inertiaAbout(A.body, AXZ) * omega(A.body, AXZ)));
    }
    const L = angMom(bodies);
    console.log(`r1=${r1} r2=${r2} mesh=${mesh}: |L| max ${fmt(maxL, 3)}, final ${fmt(len(L), 3)} vs scale I_A·ω_A ${fmt(scale, 1)} (rel ${fmt(maxL / scale, 3)}); frame ω_z ${fmt(omega(F, AXZ), 4)}, θ_frame(5 s) ${fmt(sF.acc, 3)}; ω_A ${fmt(omega(A.body, AXZ), 3)} ω_B ${fmt(omega(B.body, AXZ), 3)}${M ? `; phase err ${fmt(M.maxAbsE / PITCH, 3)} teeth` : ''}`);
  }
}

if (want('band')) {
  console.log('=== (b) recipe proximity rule (engage < D+0.03, release > D+0.13, stop row, snap φ0, correction ≤ 0.002/step); O (r=1) motor 5 rad/s max 1e4;');
  console.log('    P (r=1) on a revolute to a kinematic carrier at distance D(t) = 2 + c + A·sin(2π·5t); P load: angular damping 0.5/s');
  for (const [c, A] of [[0.03, 0.05], [0.08, 0.06], [0.08, 0.2], [0.13, 0.01]]) {
    const W = makeWorld({ gravity: [0, 0, 0] });
    const O = gearBody(W, [0, 0, 0], 1);
    motor(W, revolute(W, W.ground, O.body, [0, 0, 0], [0, 0, 0], AXZ), 5, 1e9, 1e4);
    const D = (t) => 2 + c + A * Math.sin(2 * Math.PI * 5 * t);
    const K = W.w.createRigidBody(R.RigidBodyDesc.kinematicPositionBased().setTranslation(D(0), 0, 0));
    const P = gearBody(W, [D(0), 0, 0], 1, { angDamp: 0.5 });
    revolute(W, K, P.body, [0, 0, 0], [0, 0, 0], AXZ);
    let mesh = null, eng = 0, rel = 0, peakA = 0, maxSnap = 0, prevW = 0;
    const snaps = [];
    for (let i = 0; i < 480 * 2; i++) {
      const t = (i + 1) * DT;
      K.setNextKinematicTranslation({ x: D(t), y: 0, z: 0 });
      const dist = len(sub(v(P.body.translation()), v(O.body.translation())));
      if (!mesh && dist < 2.03) {
        mesh = new Mesh(W, O.g, P.g, { lead: true, stop: true, stopMin: 0, snap: true, maxCorr: 0.002 });
        eng++;
        snaps.push(mesh.e / PITCH);
        maxSnap = Math.max(maxSnap, Math.abs(mesh.e / PITCH));
      } else if (mesh && dist > 2.13) {
        mesh.remove();
        mesh = null;
        rel++;
      }
      mesh?.update();
      W.w.step();
      const w = omega(P.body, AXZ);
      peakA = Math.max(peakA, Math.abs(w - prevW) / DT);
      prevW = w;
    }
    console.log(`c=${c} A=${A} (D range ${fmt(2 + c - A, 3)}..${fmt(2 + c + A, 3)}): ${eng} engagements, ${rel} releases in 2 s (10 carrier cycles); max |snap| ${fmt(maxSnap, 3)} teeth; peak |α_P| ${fmt(peakA, 0)} rad/s²; final ω_P ${fmt(omega(P.body, AXZ), 3)} (engaged: −5)`);
  }
}

if (want('cost')) {
  console.log('=== (c) cost: N gears r=1 on revolutes, with and without the N−1 meshes; 2 s each, interleaved, ms per simulated second');
  const res = {};
  for (let rep = 0; rep < 2; rep++)
    for (const N of [2, 6, 11])
      for (const withMesh of [false, true]) {
        const W = makeWorld();
        const gs = [];
        for (let i = 0; i < N; i++) {
          const g = gearBody(W, [2 * i, 0, 0], 1);
          const j = revolute(W, W.ground, g.body, [2 * i, 0, 0], [0, 0, 0], AXZ);
          if (i === 0) motor(W, j, 10);
          gs.push(g);
        }
        const M = withMesh ? gs.slice(1).map((g, i) => new Mesh(W, gs[i].g, g.g, { lead: true })) : [];
        for (let i = 0; i < 48; i++) { for (const m of M) m.update(); W.w.step(); }
        const t0 = now();
        for (let i = 0; i < 960; i++) { for (const m of M) m.update(); W.w.step(); }
        const ms = (now() - t0) / 2;
        const key = `${N}/${withMesh}`;
        res[key] = Math.min(res[key] ?? Infinity, ms);
      }
  for (const N of [2, 6, 11]) {
    const a = res[`${N}/false`], b = res[`${N}/true`];
    console.log(`N=${N}: revolutes only ${fmt(a, 0)} ms/sim s (${fmt(a / N, 1)} per body); + ${N - 1} meshes ${fmt(b, 0)} (${fmt((b - a) / (N - 1), 1)} per mesh)`);
  }
}
process.exit(0);
