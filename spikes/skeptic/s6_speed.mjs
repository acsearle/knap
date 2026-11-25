// S6: high speed. (a) free-spinning pair 0.5:2.5 released with the small gear at w0, no motor: raw energy
// and ratio over 5 s (must stay constant); (b) "yank": a grab-like spring (10 Hz, scaled by body mass,
// as sim.ts applyGrab) drags the output arm of a 1:5^n train around at 2 rad/s; (c) 120 s free 5-gear train.
// usage: node spikes/skeptic/s6_speed.mjs [free] [yank] [long]
import { R, makeWorld, revolute, Mesh, twist, omega, q, v, DT, G, PITCH, fmt, kinetic, xyzw, arc, weight, add, rot, sub, scl } from './sk.mjs';
import { gearBody, NO, AXZ, inertiaAbout } from './sk.mjs';

const which = process.argv.slice(2);
const want = (c) => which.length === 0 || which.includes(c);

if (want('free')) {
  console.log('=== (a) free pair 0.5 (small) : 2.5, zero gravity, no motor. Released consistent (ω_big = −ω_small/5). K must stay constant.');
  for (const w0 of [50, 100, 200, 300, 370]) {
    for (const lead of [true, false]) {
      const W = makeWorld({ gravity: [0, 0, 0] });
      const a = gearBody(W, [0, 0, 0], 0.5), b = gearBody(W, [3, 0, 0], 2.5);
      revolute(W, W.ground, a.body, [0, 0, 0], [0, 0, 0], AXZ);
      revolute(W, W.ground, b.body, [3, 0, 0], [0, 0, 0], AXZ);
      a.body.setAngvel({ x: 0, y: 0, z: w0 }, true);
      b.body.setAngvel({ x: 0, y: 0, z: -w0 / 5 }, true);
      const M = new Mesh(W, a.g, b.g, { lead });
      const K0 = kinetic(a.body) + kinetic(b.body);
      const tr = [];
      for (let i = 0; i < 480 * 5; i++) {
        M.update();
        W.w.step();
        if ((i + 1) % 480 === 0) tr.push(fmt((kinetic(a.body) + kinetic(b.body)) / K0, 4));
      }
      console.log(`ω0_small=${w0} lead=${lead ? 1 : 0}: K/K0 at 1..5 s: ${tr.join(' ')}; final ω ${fmt(omega(a.body, AXZ), 2)}/${fmt(omega(b.body, AXZ), 3)} (ratio ${fmt(omega(a.body, AXZ) / omega(b.body, AXZ), 4)} vs −5); max phase err ${fmt(M.maxAbsE / PITCH, 3)} teeth`);
    }
  }
  console.log('    CONTROL: single free rotor r=0.5 (no mesh) at the same ω0');
  for (const w0 of [50, 100, 200, 300, 370]) {
    const W = makeWorld({ gravity: [0, 0, 0] });
    const a = gearBody(W, [0, 0, 0], 0.5);
    revolute(W, W.ground, a.body, [0, 0, 0], [0, 0, 0], AXZ);
    a.body.setAngvel({ x: 0, y: 0, z: w0 }, true);
    const K0 = kinetic(a.body);
    for (let i = 0; i < 480 * 5; i++) W.w.step();
    console.log(`   rotor ω0=${w0}: K/K0 after 5 s ${fmt(kinetic(a.body) / K0, 4)}`);
  }
}

function shaft(W, x, discs, arm) {
  const body = W.w.createRigidBody(R.RigidBodyDesc.dynamic().setCanSleep(false).setTranslation(x, 0, 0));
  const cq = xyzw(arc([0, 1, 0], AXZ));
  for (const g of discs) W.w.createCollider(R.ColliderDesc.cylinder(0.5, g.r).setTranslation(0, 0, g.z).setRotation(cq).setDensity(1).setCollisionGroups(NO), body);
  if (arm) W.w.createCollider(weight(arm.at, arm.m).setCollisionGroups(NO), body);
  revolute(W, W.ground, body, [x, 0, 0], [0, 0, 0], AXZ);
  return { body, g: discs.map((g) => ({ body, lc: [0, 0, g.z], la: AXZ, r: g.r })) };
}

if (want('yank')) {
  console.log('=== (b) grab-spring (10 Hz × body mass, damping ζ=1) drags the output arm tip (m=2 at L=5) around at 2 rad/s; zero gravity; 1:5^n train');
  for (const n of [1, 2, 3, 4]) {
    const W = makeWorld({ gravity: [0, 0, 0] });
    const S = [];
    for (let i = 0; i <= n; i++) {
      const d = [];
      if (i > 0) d.push({ r: 2.5, z: i - 1 });
      if (i < n) d.push({ r: 0.5, z: i });
      S.push(shaft(W, 3 * i, d, i === n ? { m: 2, at: [5, 0, 0] } : null));
    }
    const M = [];
    for (let i = 0; i < n; i++) M.push(new Mesh(W, S[i].g.at(-1), S[i + 1].g[0], { lead: true }));
    const out = S[n].body;
    const c = v(out.translation());
    const k = (2 * Math.PI * 10) ** 2 * out.mass(), cdamp = 2 * (2 * Math.PI * 10) * out.mass();
    const so = {}, si = {};
    twist(q(out.rotation()), AXZ, so); twist(q(S[0].body.rotation()), AXZ, si);
    let maxWin = 0, maxLag = 0, maxE = 0;
    for (let i = 0; i < 480 * 2; i++) {
      const t = (i + 1) * DT;
      const tgt = add(c, [5 * Math.cos(2 * t), 5 * Math.sin(2 * t), 0]);
      const tip = add(v(out.translation()), rot(q(out.rotation()), [5, 0, 0]));
      const vt = v(out.velocityAtPoint({ x: tip[0], y: tip[1], z: tip[2] }));
      const F = sub(scl(sub(tgt, tip), k), scl(vt, cdamp));
      out.resetForces(true);
      out.addForceAtPoint({ x: F[0], y: F[1], z: F[2] }, { x: tip[0], y: tip[1], z: tip[2] }, true);
      for (const m of M) m.update();
      W.w.step();
      const tho = twist(q(out.rotation()), AXZ, so), thi = twist(q(S[0].body.rotation()), AXZ, si);
      maxWin = Math.max(maxWin, Math.abs(omega(S[0].body, AXZ)));
      if (t > 0.5) maxLag = Math.max(maxLag, Math.abs(2 * t - tho));
      for (const m of M) maxE = Math.max(maxE, Math.abs(m.e));
      void thi;
    }
    const kin = (-5) ** n * so.acc;
    console.log(`1:${5 ** n}: output θ(2 s) ${fmt(so.acc, 3)} (target 4.0); max lag after 0.5 s ${fmt(maxLag, 3)} rad; peak |ω_in| ${fmt(maxWin, 1)} (kinematic 2·5^n = ${2 * 5 ** n}); input θ ${fmt(si.acc, 1)} vs kinematic ${fmt(kin, 1)} (residual ${fmt(si.acc - kin, 2)} rad = ${fmt(((si.acc - kin) * 0.5) / PITCH, 2)} teeth on the input gear); max phase err ${fmt(maxE / PITCH, 3)} teeth`);
  }
}

if (want('long')) {
  console.log('=== (c) free 5-gear idler train (r = 1, 0.5, 1.5, 1, 2.5) spun at 10 rad/s on gear 0, no motor, zero gravity, 120 s raw. CONTROL: single r=1 rotor.');
  const rs = [1, 0.5, 1.5, 1, 2.5];
  const W = makeWorld({ gravity: [0, 0, 0] });
  let x = 0;
  const gs = [];
  rs.forEach((r, i) => {
    if (i > 0) x += rs[i - 1] + r;
    const g = gearBody(W, [x, 0, 0], r);
    revolute(W, W.ground, g.body, [x, 0, 0], [0, 0, 0], AXZ);
    gs.push(g);
  });
  let w = 10;
  gs.forEach((g, i) => {
    if (i > 0) w = (-w * rs[i - 1]) / rs[i];
    g.body.setAngvel({ x: 0, y: 0, z: w }, true);
  });
  const M = [];
  for (let i = 0; i + 1 < gs.length; i++) M.push(new Mesh(W, gs[i].g, gs[i + 1].g, { lead: true }));
  const W2 = makeWorld({ gravity: [0, 0, 0] });
  const c = gearBody(W2, [0, 0, 0], 1);
  revolute(W2, W2.ground, c.body, [0, 0, 0], [0, 0, 0], AXZ);
  c.body.setAngvel({ x: 0, y: 0, z: 10 }, true);
  const K = () => gs.reduce((s, g) => s + kinetic(g.body), 0);
  const K0 = K(), Kc0 = kinetic(c.body);
  const tr = [];
  for (let i = 0; i < 480 * 120; i++) {
    for (const m of M) m.update();
    W.w.step();
    W2.w.step();
    if ((i + 1) % (480 * 20) === 0) tr.push(`${(i + 1) / 480}s ${fmt(K() / K0, 4)}/${fmt(kinetic(c.body) / Kc0, 4)}`);
  }
  console.log(`   K/K0 train / control rotor: ${tr.join(' | ')}; max phase err ${fmt(Math.max(...M.map((m) => m.maxAbsE)) / PITCH, 4)} teeth`);
}
process.exit(0);
