// Q3: torque transmission through mesh constraints, compared with the analytic reduced
// (one-DOF) model: θ_j = k_j·θ_1, Q(θ1) = Σ k_j τ_j(θ_j), I_eff = Σ k_j² I_j.
// usage: node q3_torque.mjs [case ...]   (cases: static dynamic r5 r25 idler mass100 friction hold)
import { R, makeWorld, weight, revolute, Mesh, omega, gearFrame, twist, Friction, groundRel, revError, xyz, xyzw, v, q, rot, irot, qmul, sub, add, scl, dot, cross, len, arc, PITCH, DT, G, R_BORE, fmt, now } from './lib.mjs';

const AX = [0, 0, 1];
const NO = 0x00010000;

/** Body with gear cylinders [{lc, r}] (axis Z) and an optional arm weight {m, at:[x,y]}. */
function makeBody(W, centre, gears, arm, angDamp = 0) {
  const body = W.w.createRigidBody(R.RigidBodyDesc.dynamic().setTranslation(...centre).setCanSleep(false).setAngularDamping(angDamp));
  const cq = arc([0, 1, 0], AX);
  for (const g of gears) W.w.createCollider(R.ColliderDesc.cylinder(0.5, g.r).setTranslation(...g.lc).setRotation(xyzw(cq)).setDensity(1).setCollisionGroups(NO), body);
  if (arm) W.w.createCollider(weight([arm.at[0], arm.at[1], 0], arm.m).setCollisionGroups(NO), body);
  revolute(W, W.ground, body, centre, [0, 0, 0], AX);
  return { body, gears: gears.map((g) => ({ body, lc: g.lc, la: AX, r: g.r })), joint: null };
}
function inertiaAbout(b, a) {
  // I about the body's origin (the pivot) around world axis a, from engine mass properties.
  const I = v(b.principalInertia());
  const fr = qmul(q(b.rotation()), q(b.principalInertiaLocalFrame()));
  const al = irot(fr, a);
  const com = sub(v(b.worldCom()), v(b.translation()));
  const perp = sub(com, scl(a, dot(com, a)));
  return I[0] * al[0] ** 2 + I[1] * al[1] ** 2 + I[2] * al[2] ** 2 + b.mass() * dot(perp, perp);
}

/**
 * Build a train: specs = [{c:[x,y,z], gears:[{lc, r}], arm}] ; meshes = [[bodyIdx, gearIdx, bodyIdx, gearIdx]].
 * Returns the bodies, meshes and kinematic factors k_j (θ_j = k_j θ_0).
 */
function build(specs, meshes, { angDamp = 0, meshOpts = {}, mu = 0 } = {}) {
  const W = makeWorld();
  const bodies = specs.map((s) => makeBody(W, s.c, s.gears, s.arm, angDamp));
  bodies.forEach((b) => (b.joint = null));
  // revolutes were created inside makeBody; collect them in creation order
  const joints = [];
  W.w.impulseJoints.forEach((j) => joints.push(j));
  const M = meshes.map(([a, ga, b, gb]) => new Mesh(W, bodies[a].gears[ga], bodies[b].gears[gb], meshOpts));
  const k = specs.map(() => null);
  k[0] = 1;
  for (let pass = 0; pass < specs.length; pass++)
    for (const [a, ga, b, gb] of meshes) {
      const ra = bodies[a].gears[ga].r, rb = bodies[b].gears[gb].r;
      if (k[a] !== null && k[b] === null) k[b] = (-k[a] * ra) / rb;
      if (k[b] !== null && k[a] === null) k[a] = (-k[b] * rb) / ra;
    }
  const fr = mu > 0 ? bodies.map((b, i) => new Friction(W, joints[i], b.body.mass(), mu, groundRel({ body: b.body, lc: [0, 0, 0], la: AX }))) : [];
  // analytic model
  const mass = bodies.map((b) => b.body.mass());
  const com0 = bodies.map((b) => sub(v(b.body.worldCom()), v(b.body.translation())));
  const I = bodies.map((b) => inertiaAbout(b.body, AX));
  const Ieff = k.reduce((s, kj, j) => s + kj * kj * I[j], 0);
  const grav = [0, -G, 0];
  const tauG = (j, th) => {
    const c = rot([0, 0, Math.sin(th / 2), Math.cos(th / 2)], com0[j]);
    return dot(cross(c, scl(grav, mass[j])), AX);
  };
  const tauF = bodies.reduce((s, b, j) => s + Math.abs(k[j]) * mu * mass[j] * G * R_BORE, 0);
  const Q = (th) => k.reduce((s, kj, j) => s + kj * tauG(j, kj * th), 0);
  return { W, bodies, joints, M, k, Ieff, Q, tauF, fr, mass };
}

function run(T, n, { record } = {}) {
  const s = T.bodies.map(() => ({}));
  const th = () => T.bodies.map((b, j) => twist(q(b.body.rotation()), AX, s[j]));
  th();
  let maxRev = 0, maxE = 0;
  for (let i = 0; i < n; i++) {
    for (const m of T.M) m.update();
    T.W.w.step();
    for (const f of T.fr) f.after();
    if (record) record(i + 1, th());
    if (i % 7 === 0) for (const j of T.joints) maxRev = Math.max(maxRev, revError(j).lin);
  }
  for (const m of T.M) maxE = Math.max(maxE, m.maxAbsE);
  return { th: th(), maxRev, maxE };
}

/** RK4 of θ'' = (Q(θ) − sign(θ')·τF)/Ieff from rest. Returns θ(t) at given times. */
function ode(T, times, th0 = 0) {
  let th = th0, w = 0, t = 0;
  const h = 1e-5;
  const out = [];
  const acc = (a, b) => (T.Q(a) - (Math.abs(b) > 1e-9 ? Math.sign(b) * T.tauF : Math.sign(T.Q(a)) * Math.min(Math.abs(T.Q(a)), T.tauF))) / T.Ieff;
  for (const tt of times) {
    while (t < tt - 1e-12) {
      const k1a = w, k1b = acc(th, w);
      const k2a = w + (h / 2) * k1b, k2b = acc(th + (h / 2) * k1a, w + (h / 2) * k1b);
      const k3a = w + (h / 2) * k2b, k3b = acc(th + (h / 2) * k2a, w + (h / 2) * k2b);
      const k4a = w + h * k3b, k4b = acc(th + h * k3a, w + h * k3b);
      th += (h / 6) * (k1a + 2 * k2a + 2 * k3a + k4a);
      w += (h / 6) * (k1b + 2 * k2b + 2 * k3b + k4b);
      t += h;
    }
    out.push(th);
  }
  return out;
}
function root(Q, lo, hi) {
  let qa = Q(lo);
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    const qm = Q(mid);
    if (Math.sign(qm) === Math.sign(qa)) [lo, qa] = [mid, qm];
    else hi = mid;
  }
  return (lo + hi) / 2;
}

const pair = (r1, r2, arm1, arm2) => [
  [{ c: [0, 0, 0], gears: [{ lc: [0, 0, 0], r: r1 }], arm: arm1 }, { c: [r1 + r2, 0, 0], gears: [{ lc: [0, 0, 0], r: r2 }], arm: arm2 }],
  [[0, 0, 1, 0]],
];

function dynamicCase(name, specs, meshes, secsList, opts = {}) {
  const T = build(specs, meshes, opts);
  const steps = Math.round(secsList.at(-1) / DT);
  const want = new Map(secsList.map((t) => [Math.round(t / DT), t]));
  const got = [];
  let w1 = [];
  const t0 = now();
  const r = run(T, steps, { record: (i, th) => { if (want.has(i)) got.push(th[0]); if (i <= 5) w1.push(omega(T.bodies[0].body, AX)); } });
  const ms = now() - t0;
  const ref = ode(T, secsList);
  const alphaMeas = w1[4] / (5 * DT);
  const alphaAn = (T.Q(0) - Math.sign(T.Q(0)) * Math.min(Math.abs(T.Q(0)), T.tauF)) / T.Ieff;
  console.log(`${name}: k=[${T.k.map((x) => fmt(x, 4))}] Ieff=${fmt(T.Ieff, 4)} Q(0)=${fmt(T.Q(0), 2)} α0 meas ${fmt(alphaMeas, 3)} vs analytic ${fmt(alphaAn, 3)} rad/s² (err ${fmt(alphaMeas / alphaAn - 1, 4)})`);
  console.log(`   θ1(t) sim vs ODE: ${secsList.map((t, i) => `t=${t}s ${fmt(got[i], 4)}/${fmt(ref[i], 4)}`).join('; ')}`);
  const thAll = r.th;
  const kin = T.k.map((kj, j) => fmt(thAll[j] - kj * thAll[0], 6));
  console.log(`   kinematic residual θ_j − k_j θ_1 (rad) at end: [${kin}] ; max mesh phase err ${fmt(r.maxE / PITCH, 6)} teeth; max revolute anchor err ${fmt(r.maxRev, 3)} units; ${fmt(ms / (steps * DT), 1)} ms per sim s`);
  return T;
}

function staticCase(name, specs, meshes, opts = {}) {
  const T = build(specs, meshes, { angDamp: 3, ...opts });
  const r = run(T, Math.round(8 / DT));
  // walk from θ=0 to the root of Q in the direction Q(0) pushes (the reachable equilibrium)
  const dir = Math.sign(T.Q(0));
  let a = 0, b = 0;
  for (let i = 1; i < 3000; i++) { b = dir * i * 0.002; if (Math.sign(T.Q(b)) !== dir) break; a = b; }
  const thEq = root(T.Q, a, b);
  // transmitted mesh force at equilibrium = τ_g1 / r1 (gear 1 has one mesh)
  const F = Math.abs(T.Q(thEq) - (T.Q(thEq) - 0)) ; // placeholder
  const tau1 = Math.abs(T.Q(thEq) - T.k.slice(1).reduce((s, kj, j) => s, 0));
  const e = T.M.map((m) => m.e / PITCH);
  // residual motion after settling: 2 s more without damping change
  let wmax = 0;
  run(T, 960, { record: () => (wmax = Math.max(wmax, Math.abs(omega(T.bodies[0].body, AX)))) });
  console.log(`${name}: equilibrium θ1 sim ${fmt(r.th[0], 5)} vs analytic ${fmt(thEq, 5)} rad (Δ ${fmt(r.th[0] - thEq, 3)} rad); phase err [${e.map((x) => fmt(x, 3))}] teeth; |ω1| max over next 1 s ${fmt(wmax, 3)} rad/s; max revolute err ${fmt(r.maxRev, 3)}`);
  void F; void tau1;
  return T;
}

/** Balanced hold (no damping): Q(0) = 0 exactly by construction; drift / buzz / compliance. */
function holdCase(name, r1, r2, m1, meshOpts = {}, secs = 10) {
  // arm1 horizontal at +x with mass m1 at L=3 (τ1 = −m1·G·3); arm2 horizontal at −x with mass m2 at L=3:
  // τ2 = +m2·G·3; Q = τ1 − (r1/r2)... use k2 = −r1/r2: Q = τ1 + k2 τ2 = −3G(m1 + (r1/r2) m2) ≠ 0 → put arm2 at +x:
  // τ2 = −3G m2, Q = −3G m1 + (r1/r2) 3G m2 = 0 ⇔ m2 = m1 r2/r1.
  const m2 = (m1 * r2) / r1;
  const [specs, meshes] = pair(r1, r2, { m: m1, at: [3, 0] }, { m: m2, at: [3, 0] });
  const T = build(specs, meshes, { meshOpts });
  const F = (m1 * G * 3) / r1; // tangential mesh force carried, units of force
  let wmax = 0, w2 = 0, n = 0;
  const r = run(T, Math.round(secs / DT), { record: (i) => { const w = omega(T.bodies[0].body, AX); wmax = Math.max(wmax, Math.abs(w)); w2 += w * w; n++; } });
  const e = T.M[0].e;
  console.log(`${name} ${r1}:${r2} m1=${m1} m2=${fmt(m2, 3)} F_mesh=${fmt(F, 1)}: after ${secs}s θ1 ${fmt(r.th[0], 3)} rad, θ2 ${fmt(r.th[1], 3)} rad; ω1 rms ${fmt(Math.sqrt(w2 / n), 3)} max ${fmt(wmax, 3)} rad/s; phase err ${fmt(e, 3)} units (${fmt(e / PITCH, 3)} teeth) → compliance ${fmt(Math.abs(e) / F, 3)} units per unit force; max revolute err ${fmt(r.maxRev, 3)}`);
}

const cases = process.argv.slice(2);
const want = (c) => cases.length === 0 || cases.includes(c);
const lead = { meshOpts: { lead: true } };

if (want('hold')) {
  console.log('=== balanced static hold (no damping, no friction), 10 s: buzz / creep / compliance');
  for (const [r1, r2] of [[1, 1], [0.5, 1.5], [0.5, 2.5]]) {
    holdCase('fb+lead  ', r1, r2, 1, { lead: true });
    holdCase('nofb+lead', r1, r2, 1, { lead: true, feedback: false });
  }
  holdCase('fb+lead heavy', 0.5, 2.5, 20, { lead: true });
}
if (want('recreate')) {
  console.log('=== warm start: re-anchor in place vs remove+recreate the mesh joint every step (balanced hold, 10 s)');
  for (const [r1, r2, m1] of [[0.5, 2.5, 1], [0.5, 2.5, 20]]) {
    holdCase('reanchor', r1, r2, m1, { lead: true });
    holdCase('recreate', r1, r2, m1, { lead: true, recreate: true });
  }
  const [s, m] = pair(0.5, 2.5, { m: 1, at: [3, 0] }, { m: 4, at: [3, 0] });
  dynamicCase('1:5 recreate', s, m, [0.1, 0.2, 0.4, 0.8], { meshOpts: { lead: true, recreate: true } });
}
if (want('static')) {
  console.log('=== static balance point (angular damping 3/s to settle, 8 s)');
  // arm1 horizontal (+x) mass m1 at L=3 drives; arm2 hangs down (−y) mass m2 at L=3: a pendulum lifted by the gear.
  for (const [r1, r2, m1, m2] of [[1, 1, 1, 3], [0.5, 1.5, 1, 1], [1, 2.5, 1, 4]]) {
    const [s, m] = pair(r1, r2, { m: m1, at: [3, 0] }, { m: m2, at: [0, -3] });
    staticCase(`${r1}:${r2} m1=${m1} m2=${m2}`, s, m, lead);
  }
}
if (want('dynamic')) {
  console.log('=== dynamic from rest vs RK4 of the reduced model');
  for (const [r1, r2, m1, m2] of [[1, 1, 3, 1], [0.5, 1.5, 1, 1], [1, 2.5, 3, 1]]) {
    const [s, m] = pair(r1, r2, { m: m1, at: [3, 0] }, { m: m2, at: [0, -3] });
    dynamicCase(`${r1}:${r2} m1=${m1} m2=${m2}`, s, m, [0.05, 0.1, 0.2, 0.4], lead);
  }
}
if (want('r5')) {
  console.log('=== 1:5 reduction lifting a heavy arm (input m=1 at L=3 on r0.5; output m=4 at L=3 on r2.5)');
  const [s, m] = pair(0.5, 2.5, { m: 1, at: [3, 0] }, { m: 4, at: [3, 0] });
  dynamicCase('1:5 fb+lead', s, m, [0.1, 0.2, 0.4, 0.8], lead);
  dynamicCase('1:5 fb     ', s, m, [0.1, 0.2, 0.4, 0.8]);
}
if (want('r25')) {
  console.log('=== compound 1:25 (A r0.5 → B r2.5 ≡ C r0.5 → D r2.5); input m=1 at L=3, output m=20 at L=3');
  const specs = [
    { c: [0, 0, 0], gears: [{ lc: [0, 0, 0], r: 0.5 }], arm: { m: 1, at: [3, 0] } },
    { c: [3, 0, 0], gears: [{ lc: [0, 0, 0], r: 2.5 }, { lc: [0, 0, 1], r: 0.5 }] },
    { c: [6, 0, 1], gears: [{ lc: [0, 0, 0], r: 2.5 }], arm: { m: 20, at: [3, 0] } },
  ];
  dynamicCase('1:25 fb+lead', specs, [[0, 0, 1, 0], [1, 1, 2, 0]], [0.2, 0.5, 1, 1.5], lead);
}
if (want('idler')) {
  console.log('=== idler chain of 5 gears r=1 (4 meshes); weight m=2 on gear 1 (+x, L=3), pendulum m=3 on gear 5');
  const specs = [0, 1, 2, 3, 4].map((i) => ({ c: [2 * i, 0, 0], gears: [{ lc: [0, 0, 0], r: 1 }], arm: i === 0 ? { m: 2, at: [0, 3] } : i === 4 ? { m: 3, at: [0, -3] } : undefined }));
  // arm1 placed up (+y): it falls; arm5 hangs down; k5 = +1
  specs[0].arm = { m: 2, at: [3, 0] };
  const meshes = [[0, 0, 1, 0], [1, 0, 2, 0], [2, 0, 3, 0], [3, 0, 4, 0]];
  dynamicCase('idler5 dyn', specs, meshes, [0.05, 0.1, 0.2, 0.4], lead);
  staticCase('idler5 static', specs, meshes, lead);
}
if (want('chain')) {
  for (const N of [6, 11, 21]) {
    console.log(`=== idler chain of ${N} gears r=1 (${N - 1} meshes); weight m=2 at L=3 (+x) on gear 1, pendulum m=3 on gear ${N}`);
    const specs = Array.from({ length: N }, (_, i) => ({ c: [2 * i, 0, 0], gears: [{ lc: [0, 0, 0], r: 1 }], arm: i === 0 ? { m: 2, at: [3, 0] } : i === N - 1 ? { m: 3, at: [0, -3] } : undefined }));
    const meshes = Array.from({ length: N - 1 }, (_, i) => [i, 0, i + 1, 0]);
    dynamicCase(`chain${N}`, specs, meshes, [0.0104, 0.05, 0.1, 0.2, 0.4], lead);
  }
}
if (want('mass100')) {
  console.log('=== mass ratio ~100: r0.5 gear with 0.2 arm weight driving r2.5 gear with 80 arm weight (pendulum)');
  const [s, m] = pair(0.5, 2.5, { m: 0.2, at: [3, 0] }, { m: 1.2, at: [0, -3] });
  const T = dynamicCase('m100-ish (light both)', s, m, [0.05, 0.1, 0.2], lead);
  console.log(`   masses ${T.mass.map((x) => fmt(x, 3))}`);
  const [s2, m2] = pair(0.5, 2.5, { m: 0.2, at: [3, 0] }, { m: 98, at: [0, -3] });
  const T2 = dynamicCase('m100 heavy output   ', s2, m2, [0.05, 0.1, 0.2, 0.4], lead);
  console.log(`   masses ${T2.mass.map((x) => fmt(x, 3))} (ratio ${fmt(T2.mass[1] / T2.mass[0], 1)})`);
  
}
if (want('friction')) {
  console.log('=== joint friction motors (μ = 0.2, m_j = own body mass) on the revolutes');
  const [s, m] = pair(0.5, 2.5, { m: 1, at: [3, 0] }, { m: 4, at: [3, 0] });
  dynamicCase('1:5 μ=0.2', s, m, [0.1, 0.2, 0.4, 0.8], { ...lead, mu: 0.2 });
  for (const m1 of [1, 1.02, 1.1]) {
    // balanced hold except m1 scaled: below the friction band it must hold still
    const [s2, mm] = pair(1, 2.5, { m: m1, at: [3, 0] }, { m: 2.5, at: [3, 0] });
    const T = build(s2, mm, { ...lead, mu: 0.2 });
    const r = run(T, Math.round(5 / DT));
    console.log(`  hold 1:2.5 m1=${m1} (Q(0)=${fmt(T.Q(0), 2)}, friction band ±${fmt(T.tauF, 2)}): θ1 after 5 s ${fmt(r.th[0], 5)} rad; phase err ${fmt(T.M[0].e / PITCH, 4)} teeth`);
  }
}

// Exit explicitly: at exit Node 20 spins on Rapier wasm-bindgen finalizers (measured: minutes of CPU after the last line).
process.exit(0);
