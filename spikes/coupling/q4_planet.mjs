// Q4: emergent behaviour with no special cases: planetary (fixed sun / driven sun) and a swing-arm
// selector with proximity-switched meshes and cylinder collisions between gears.
// usage: node q4_planet.mjs [planet] [sunfree] [swing]
import { irot as rotInv, R, makeWorld, makeGear, revolute, pinGear, motor, Mesh, omega, twist, gearFrame, Friction, bodyRel, groundRel, v, q, sub, add, scl, dot, len, cross, xyz, xyzw, arc, PITCH, DT, G, fmt, now, AXES, revError, Guard } from './lib.mjs';

const which = process.argv.slice(2);
const want = (c) => which.length === 0 || which.includes(c);

function arm(W, centre, axis, tip, m = 0.5) {
  // a light bar from centre to tip (no collisions), on a revolute to the ground at centre
  const b = W.w.createRigidBody(R.RigidBodyDesc.dynamic().setTranslation(...centre).setCanSleep(false));
  const d = sub(tip, centre);
  const L = len(d);
  const cq = arc([1, 0, 0], scl(d, 1 / L));
  W.w.createCollider(R.ColliderDesc.cuboid(L / 2, 0.1, 0.1).setTranslation(...scl(d, 0.5)).setRotation(xyzw(cq)).setDensity(m / (L * 0.04)).setCollisionGroups(0x00010000), b);
  const j = revolute(W, W.ground, b, centre, [0, 0, 0], axis);
  return { body: b, joint: j };
}

if (want('planet')) {
  console.log('=== planetary, fixed sun, arm driven by a motor: ω_planet / ω_arm vs 1 + r_s/r_p');
  for (const axisName of ['Z', 'Y']) {
    const axis = AXES[axisName];
    const [e1] = axisName === 'Z' ? [[1, 0, 0]] : [[1, 0, 0]];
    for (const [rs, rp] of [[1, 1], [2.5, 0.5], [0.5, 1.5]]) {
      for (const wa of [1, 10]) {
        const W = makeWorld();
        const sun = makeGear(W, { centre: [0, 0, 0], axis, r: rs, fixed: true });
        const R0 = rs + rp;
        const A = arm(W, [0, 0, 0], axis, scl(e1, R0));
        const planet = makeGear(W, { centre: scl(e1, R0), axis, r: rp });
        const jp = revolute(W, A.body, planet.body, scl(e1, R0), [0, 0, 0], axis);
        motor(W, A.joint, wa);
        const m = new Mesh(W, sun, planet, { lead: true });
        const sa = {}, sp = {};
        const n = Math.round(10 / DT);
        let a0, p0, maxRev = 0;
        for (let i = 0; i < n; i++) {
          m.update();
          W.w.step();
          const ta = twist(q(A.body.rotation()), axis, sa), tp = twist(q(planet.body.rotation()), axis, sp);
          if (i === 0) [a0, p0] = [ta, tp];
          if (i % 11 === 0) maxRev = Math.max(maxRev, revError(jp).lin);
        }
        const ta = twist(q(A.body.rotation()), axis, sa), tp = twist(q(planet.body.rotation()), axis, sp);
        const ratio = (tp - p0) / (ta - a0);
        console.log(`axis ${axisName} rs=${rs} rp=${rp} ω_arm=${wa}: mean ω_p/ω_arm ${fmt(ratio, 6)} vs ${fmt(1 + rs / rp, 6)} (err ${fmt(ratio / (1 + rs / rp) - 1, 3)}); end-of-step ω_p/ω_arm ${fmt(omega(planet.body, axis) / omega(A.body, axis), 5)}; phase err ${fmt(m.e / PITCH, 3)} teeth (max ${fmt(m.maxAbsE / PITCH, 3)}); planet revolute err ${fmt(maxRev, 3)}`);
      }
    }
  }
}

if (want('sunfree')) {
  console.log('=== planetary, sun free and motor-driven, arm free (axis Y, gravity along the axis): arm speed from p_β = 0');
  const axis = [0, 1, 0];
  for (const [rs, rp, ws] of [[1, 1, 10], [0.5, 1.5, 10], [2.5, 0.5, 5]]) {
    const W = makeWorld();
    const sun = makeGear(W, { centre: [0, 0, 0], axis, r: rs });
    const js = pinGear(W, sun);
    const R0 = rs + rp;
    const A = arm(W, [0, 0, 0], axis, [R0, 0, 0], 0.5);
    const planet = makeGear(W, { centre: [R0, 0, 0], axis, r: rp });
    revolute(W, A.body, planet.body, [R0, 0, 0], [0, 0, 0], axis);
    motor(W, js, ws);
    const m = new Mesh(W, sun, planet, { lead: true });
    // analytic: β' = I_p R r_s ω_s / (I_A r_p² + I_p R²), I_A = arm about axis + m_p R², I_p = planet spin
    const Ip = (planet.body.mass() * rp * rp) / 2; // solid cylinder
    // engine values: arm inertia about the pivot axis (principal + parallel axis) + planet mass at R
    const ab = A.body;
    const Iab = v(ab.principalInertia());
    const fr = q(ab.principalInertiaLocalFrame());
    const al = [0, 1, 0].map((_, i) => 0);
    const axl = rotInv(fr, axis);
    const comA = sub(v(ab.worldCom()), v(ab.translation()));
    const comPerp = sub(comA, scl(axis, dot(comA, axis)));
    const IA = Iab[0] * axl[0] ** 2 + Iab[1] * axl[1] ** 2 + Iab[2] * axl[2] ** 2 + ab.mass() * dot(comPerp, comPerp) + planet.body.mass() * R0 * R0;
    void al;
    const IpEng = v(planet.body.principalInertia())[1];
    const betaDot = (IpEng * R0 * rs * ws) / (IA * rp * rp + IpEng * R0 * R0);
    let wsum = 0, nn = 0;
    const sa = {};
    let b1 = 0;
    for (let i = 0; i < Math.round(5 / DT); i++) {
      m.update();
      W.w.step();
      const b = twist(q(A.body.rotation()), axis, sa);
      if (i === 480) b1 = b;
      if (i === Math.round(5 / DT) - 1) { wsum = b - b1; nn = (i - 480) * DT; }
    }
    console.log(`rs=${rs} rp=${rp} ω_s=${ws}: arm ω mean ${fmt(wsum / nn, 5)} vs analytic ${fmt(betaDot, 5)} rad/s (err ${fmt(wsum / nn / betaDot - 1, 3)}); I_p eng ${fmt(IpEng, 4)} vs πr⁴/2 ${fmt(Ip, 4)}; phase err ${fmt(m.e / PITCH, 3)} teeth`);
  }
}

if (want('swing')) {
  console.log('=== swing-arm selector (axis Y, horizontal plane): driver D r1 at origin (motor), arm on D\'s axis carrying planet P r1 at R=2, outputs O1/O2 r1');
  const axis = [0, 1, 0];
  // swing angle γ at which P meets O: put O at polar (ρ, ±a) with |O − P(γ)| = 2
  const rho = 3.2, gamma = 0.5;
  const aAng = gamma + Math.acos((rho * rho + 4 - 4) / (2 * rho * 2));
  const polar = (r, ang) => [r * Math.cos(ang), 0, -r * Math.sin(ang)]; // +ang = +rotation about +Y
  const variants = [
    { name: 'snap+full', snap: true, maxCorr: Infinity, eps: 0.02, band: 0.03 },
    { name: 'snap+rate', snap: true, maxCorr: 0.002, eps: 0.02, band: 0.03 },
    { name: 'nosnap   ', snap: false, maxCorr: Infinity, eps: 0.02, band: 0.03 },
    { name: 'snap+rate eps0.05', snap: true, maxCorr: 0.002, eps: 0.05, band: 0.03 },
    { name: 'snap+rate +sep20', snap: true, maxCorr: 0.002, eps: 0.02, band: 0.03, sep: true },
    { name: 'snap+rate μ0.2', snap: true, maxCorr: 0.002, eps: 0.02, band: 0.03, mu: 0.2 },
    { name: 'snap+rate +sep20 μ0.2', snap: true, maxCorr: 0.002, eps: 0.02, band: 0.03, mu: 0.2, sep: true },
  ];
  const vs = process.env.VARIANTS ? JSON.parse(process.env.VARIANTS) : variants;
  for (const V of vs) {
    const W = makeWorld();
    const GEAR = (0x0002 << 16) | 0x0002;
    const mk = (c, fixedOnly) => {
      const g = makeGear(W, { centre: c, axis, r: 1, colR: 1 - V.eps, collide: true });
      g.body.collider(0).setCollisionGroups(GEAR);
      return g;
    };
    const D = mk([0, 0, 0]);
    const jD = pinGear(W, D);
    const A = arm(W, [0, 0, 0], axis, [2, 0, 0], 0.5);
    const P = mk([2, 0, 0]);
    const jP = revolute(W, A.body, P.body, [2, 0, 0], [0, 0, 0], axis);
    const O1 = mk(polar(rho, aAng));
    const O2 = mk(polar(rho, -aAng));
    pinGear(W, O1);
    pinGear(W, O2);
    // load on the outputs: angular damping 2/s (τ = I·2·ω)
    O1.body.setAngularDamping(2);
    O2.body.setAngularDamping(2);
    const fr = V.mu ? [new Friction(W, jP, P.body.mass(), V.mu, bodyRel(A.body, P.body, axis)), ...(V.armMu === 0 ? [] : [new Friction(W, A.joint, A.body.mass() + P.body.mass(), V.armMu ?? V.mu, groundRel({ body: A.body, lc: [0, 0, 0], la: axis }))])] : [];
    const mDP = new Mesh(W, D, P, { lead: true, stop: V.stop });
    const out = [O1, O2].map((O) => ({ O, mesh: null, engagedAt: [], releasedAt: [], maxJerk: 0, snapErr: [] }));
    const ws = 5;
    motor(W, jD, ws);
    const log = [];
    let prevW = out.map((o) => omega(o.O.body, axis));
    let minGap = Infinity;
    const phases = [[0, 3, ws], [3, 6, -ws], [6, 9, ws]];
    let dir = ws;
    const t0 = now();
    const N = Math.round(9 / DT);
    let maxPen = 0;
    const ratios = [];
    for (let i = 0; i < N; i++) {
      const t = i * DT;
      const d = phases.find(([a, b]) => t >= a && t < b)[2];
      if (d !== dir) { motor(W, jD, d); dir = d; }
      // proximity rule
      for (const o of out) {
        const dist = len(sub(v(o.O.body.translation()), v(P.body.translation())));
        minGap = Math.min(minGap, dist);
        if (!o.mesh && dist < 2 + V.band) {
          o.mesh = new Mesh(W, P, o.O, { lead: true, snap: V.snap, maxCorr: V.maxCorr, stop: V.stop });
          o.engagedAt.push(t);
          o.snapErr.push(o.mesh.e / PITCH);
        } else if (o.mesh && dist > 2 + V.band + (V.hyst ?? 0.03)) {
          o.mesh.remove();
          o.mesh = null;
          o.releasedAt.push(t);
        }
      }
      mDP.update();
      for (const o of out) o.mesh?.update();
      // optional separating force: F_t·tan20° along the line of centres, from the output's dynamics
      if (V.sep) {
        for (const [k, o] of out.entries()) {
          if (!o.mesh) continue;
          const w = omega(o.O.body, axis);
          const I = v(o.O.body.principalInertia())[1];
          const Ft = Math.abs((I * ((w - prevW[k]) / DT + 2 * w)) / 1); // r_o = 1
          const nn = sub(v(P.body.translation()), v(o.O.body.translation()));
          const nd = scl(nn, 1 / len(nn));
          P.body.applyImpulse(xyz(scl(nd, Ft * Math.tan((20 * Math.PI) / 180) * DT)), true);
        }
      }
      W.w.step();
      for (const f of fr) f.after();
      const wNow = out.map((o) => omega(o.O.body, axis));
      for (const [k, o] of out.entries()) {
        const acc = Math.abs(wNow[k] - prevW[k]) / DT;
        if (o.engagedAt.length && t - o.engagedAt.at(-1) < 0.2) o.maxJerk = Math.max(o.maxJerk, acc);
        if (o.mesh) maxPen = Math.max(maxPen, 2 - len(sub(v(o.O.body.translation()), v(P.body.translation()))));
      }
      prevW = wNow;
      if (i % 240 === 0) {
        const beta = Math.atan2(-v(P.body.translation())[2], v(P.body.translation())[0]);
        log.push(`${fmt(t, 1)}s β${fmt(beta, 3)} ω_O1 ${fmt(wNow[0], 2)} ω_O2 ${fmt(wNow[1], 2)}${out[0].mesh ? ' [O1]' : ''}${out[1].mesh ? ' [O2]' : ''}`);
      }
      // transmitted ratio once engaged and settled
      for (const [k, o] of out.entries()) if (o.mesh && t - o.engagedAt.at(-1) > 0.5 && i % 48 === 0) ratios.push([k, omega(o.O.body, axis) / omega(D.body, axis)]);
    }
    const ms = now() - t0;
    console.log(`-- ${V.name}: ${fmt(ms / 9, 1)} ms per sim s`);
    for (const [k, o] of out.entries())
      console.log(`   O${k + 1}: engaged at [${o.engagedAt.map((x) => fmt(x, 3))}] s, released at [${o.releasedAt.map((x) => fmt(x, 3))}] s, snap error at engagement [${o.snapErr.map((x) => fmt(x, 3))}] teeth, peak |α_O| within 0.2 s of engagement ${fmt(o.maxJerk, 1)} rad/s²`);
    const rr = ratios.map((x) => x[1]);
    console.log(`   engaged ω_O/ω_D: min ${fmt(Math.min(...rr), 4)} max ${fmt(Math.max(...rr), 4)} (ideal +1 with arm at rest); max overlap past pitch contact ${fmt(maxPen, 4)} units; min P–O distance ${fmt(minGap, 4)}`);
    console.log('   ' + log.join(' | '));
  }
}

// Exit explicitly: at exit Node 20 spins on Rapier wasm-bindgen finalizers (measured: minutes of CPU after the last line).
process.exit(0);
