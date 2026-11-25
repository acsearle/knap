// S4: (a) gear 2 on a carrier moving relative to gear 1 (centre distance and line-of-centres angle
// changing while meshed); (b) gear 2 on an axial slider pushed out of plane while meshed, incl. hitting
// the slide limit; (c) engaging two gears that are already spinning (mesh created mid-run).
// usage: node spikes/skeptic/s4_carriers.mjs [carrier] [axial] [engage]
import { R, makeWorld, revolute, Mesh, twist, omega, q, v, DT, G, PITCH, fmt, motor, revError, kinetic } from './sk.mjs';
import { gearBody, inertiaAbout, AXZ } from './sk.mjs';

const which = process.argv.slice(2);
const want = (c) => which.length === 0 || which.includes(c);
const th = (b, s) => twist(q(b.rotation()), AXZ, s);

if (want('carrier')) {
  console.log('=== (a) gear 1 r1 at origin (fixed or motor 5 rad/s), gear 2 r2 on a revolute to a KINEMATIC carrier moving on D(t)=r1+r2+dA·sin(2π1.5t), ψ(t)=0.3·sin(2π0.7t)');
  console.log('    expected θ2(t) = θ2(0) − (r1/r2)(θ1−θ1(0)) + ((r1+r2)/r2)(ψ−ψ0)  (rolling at the nominal pitch radii)');
  for (const [r1, r2] of [[1, 1], [0.5, 2.5], [2.5, 0.5]]) {
    for (const dA of [0, 0.03, 0.1]) {
      for (const drive of [false, true]) {
        const W = makeWorld({ gravity: [0, 0, 0] });
        const g1 = gearBody(W, [0, 0, 0], r1, { fixed: !drive });
        const j1 = drive ? revolute(W, W.ground, g1.body, [0, 0, 0], [0, 0, 0], AXZ) : null;
        if (drive) motor(W, j1, 5);
        const pos = (t) => {
          const D = r1 + r2 + dA * Math.sin(2 * Math.PI * 1.5 * t);
          const psi = 0.3 * Math.sin(2 * Math.PI * 0.7 * t);
          return [D * Math.cos(psi), D * Math.sin(psi), 0, psi];
        };
        const p0 = pos(0);
        const K = W.w.createRigidBody(R.RigidBodyDesc.kinematicPositionBased().setTranslation(p0[0], p0[1], 0));
        const g2 = gearBody(W, [p0[0], p0[1], 0], r2);
        const j2 = revolute(W, K, g2.body, [0, 0, 0], [0, 0, 0], AXZ);
        const M = new Mesh(W, g1.g, g2.g, { lead: true });
        const s1 = {}, s2 = {};
        const a1 = th(g1.body, s1), a2 = th(g2.body, s2);
        let maxDev = 0, maxRev = 0;
        for (let i = 0; i < 480 * 5; i++) {
          const p = pos((i + 1) * DT);
          K.setNextKinematicTranslation({ x: p[0], y: p[1], z: 0 });
          M.update();
          W.w.step();
          const t1 = th(g1.body, s1), t2 = th(g2.body, s2);
          const exp = a2 - (r1 / r2) * (t1 - a1) + ((r1 + r2) / r2) * (p[3] - p0[3]);
          maxDev = Math.max(maxDev, Math.abs(t2 - exp));
          if (i % 7 === 0) maxRev = Math.max(maxRev, revError(j2).lin);
        }
        console.log(`r1=${r1} r2=${r2} dA=${dA} ${drive ? 'g1 driven 5 rad/s' : 'g1 fixed       '}: max |θ2 − expected| ${fmt(maxDev, 3)} rad = ${fmt((maxDev * r2) / PITCH, 3)} teeth; max phase err ${fmt(M.maxAbsE / PITCH, 3)} teeth; carrier revolute err ${fmt(maxRev, 3)} units`);
      }
    }
  }
}

if (want('axial')) {
  console.log('=== (b) gear 2 (r=1) on a slider (prismatic along the axis, limits [−0.2, 1.5]) pushed by a constant axial force F; gear 1 (r=1) motor 10 rad/s; gear 2 load: angular damping 1/s');
  for (const F of [0, 50, 500]) {
    const W = makeWorld({ gravity: [0, 0, 0] });
    const g1 = gearBody(W, [0, 0, 0], 1);
    const j1 = revolute(W, W.ground, g1.body, [0, 0, 0], [0, 0, 0], AXZ);
    motor(W, j1, 10);
    const S = W.w.createRigidBody(R.RigidBodyDesc.dynamic().setCanSleep(false).setTranslation(2, 0, 0));
    W.w.createCollider(R.ColliderDesc.ball(0.3).setDensity(1).setCollisionGroups(0x00010000), S);
    const jd = R.JointData.prismatic({ x: 2, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 });
    jd.limitsEnabled = true;
    jd.limits = [-0.2, 1.5];
    const jp = W.w.createImpulseJoint(jd, W.ground, S, true);
    jp.setContactsEnabled(false);
    const g2 = gearBody(W, [2, 0, 0], 1, { angDamp: 1 });
    const j2 = revolute(W, S, g2.body, [0, 0, 0], [0, 0, 0], AXZ);
    const M = new Mesh(W, g1.g, g2.g, { lead: true });
    const mTot = S.mass() + g2.body.mass();
    const s1 = {}, s2 = {};
    const a1 = th(g1.body, s1), a2 = th(g2.body, s2);
    let maxRev = 0, zAt = {}, maxRes = 0, maxResAfterLimit = 0, limitT = null;
    for (let i = 0; i < 480 * 2; i++) {
      S.resetForces(true);
      S.addForce({ x: 0, y: 0, z: F }, true);
      M.update();
      W.w.step();
      const t1 = th(g1.body, s1), t2 = th(g2.body, s2);
      const res = Math.abs(t2 - a2 + (t1 - a1));
      maxRes = Math.max(maxRes, res);
      const z = S.translation().z;
      if (limitT === null && z > 1.499) limitT = (i + 1) * DT;
      if (limitT !== null) maxResAfterLimit = Math.max(maxResAfterLimit, res);
      if ([48, 96, 240].includes(i + 1)) zAt[i + 1] = z;
      if (i % 7 === 0) maxRev = Math.max(maxRev, revError(j2).lin);
    }
    const az = (t) => (0.5 * F * t * t) / mTot;
    console.log(`F=${F}: z(0.1s) ${fmt(zAt[48], 4)} vs ½(F/m)t² ${fmt(az(0.1), 4)}; z(0.2s) ${fmt(zAt[96], 4)} vs ${fmt(az(0.2), 4)}; limit reached at ${limitT === null ? '-' : fmt(limitT, 3) + ' s'} (analytic ${F ? fmt(Math.sqrt((2 * 1.5 * mTot) / F), 3) : '-'}); max |θ2+θ1| ${fmt(maxRes, 3)} rad (after limit hit ${fmt(maxResAfterLimit, 3)}); gear2 revolute err ${fmt(maxRev, 3)}; final axial offset ${fmt(S.translation().z, 3)} (gear is ${S.translation().z > 1 ? 'fully OUT of plane but still meshed — Mesh has no coplanarity test' : 'in plane'})`);
  }
}

if (want('engage')) {
  console.log('=== (c) engagement of two spinning free gears on fixed revolutes: mesh created at t=0.5 s; analytic plastic impact at the pitch point');
  for (const [r1, r2, w1, w2] of [[1, 1, 20, 20], [1, 1, 20, -20], [0.5, 2.5, 100, 0], [2.5, 0.5, 0, 100], [1, 1, 50, 50]]) {
    for (const opt of [{ snap: true, maxCorr: 0.002 }, { snap: true, maxCorr: Infinity }, { snap: false }]) {
      const W = makeWorld({ gravity: [0, 0, 0] });
      const g1 = gearBody(W, [0, 0, 0], r1);
      const g2 = gearBody(W, [r1 + r2, 0, 0], r2);
      revolute(W, W.ground, g1.body, [0, 0, 0], [0, 0, 0], AXZ);
      revolute(W, W.ground, g2.body, [r1 + r2, 0, 0], [0, 0, 0], AXZ);
      for (let i = 0; i < 240; i++) {
        g1.body.setAngvel({ x: 0, y: 0, z: w1 }, true);
        g2.body.setAngvel({ x: 0, y: 0, z: w2 }, true);
        W.w.step();
      }
      const I1 = inertiaAbout(g1.body, AXZ), I2 = inertiaAbout(g2.body, AXZ);
      const o1 = omega(g1.body, AXZ), o2 = omega(g2.body, AXZ);
      const u = r1 * o1 + r2 * o2; // tangential velocity mismatch at the pitch point
      const J = u / ((r1 * r1) / I1 + (r2 * r2) / I2);
      const e1 = o1 - (J * r1) / I1, e2 = o2 - (J * r2) / I2;
      const K0 = kinetic(g1.body) + kinetic(g2.body);
      const Kexp = 0.5 * I1 * e1 * e1 + 0.5 * I2 * e2 * e2;
      const M = new Mesh(W, g1.g, g2.g, { lead: true, ...opt });
      const snapE = M.e / PITCH;
      let peakF = 0;
      let p1 = o1;
      const trace = [];
      for (let i = 0; i < 480; i++) {
        M.update();
        W.w.step();
        const n1 = omega(g1.body, AXZ);
        peakF = Math.max(peakF, Math.abs((I1 * (n1 - p1)) / DT / r1));
        p1 = n1;
        if (i < 2 || i === 47 || i === 479) trace.push(`${i + 1}:${fmt(n1, 3)}/${fmt(omega(g2.body, AXZ), 3)}`);
      }
      const K1 = kinetic(g1.body) + kinetic(g2.body);
      const name = opt.maxCorr === 0.002 ? 'snap+rate' : opt.snap ? 'snap+full' : 'nosnap   ';
      console.log(`r=${r1}/${r2} ω0=${w1}/${w2} ${name}: snap err ${fmt(snapE, 3)} teeth; analytic post-impact ω ${fmt(e1, 3)}/${fmt(e2, 3)}, K ${fmt(Kexp, 1)} of ${fmt(K0, 1)}; sim after step n: ${trace.join(' ')}; K(1 s) ${fmt(K1, 1)}; peak tangential force ${fmt(peakF, 0)} (= J/dt ${fmt(Math.abs(J) / DT, 0)}); final phase err ${fmt(M.e / PITCH, 3)} teeth`);
    }
  }
}
process.exit(0);
