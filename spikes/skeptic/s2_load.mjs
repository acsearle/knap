// S2: static stiffness vs train length; extreme-ratio torque threshold; back-driving a high ratio.
// usage: node spikes/skeptic/s2_load.mjs [stiff] [thresh] [backdrive]
import { R, makeWorld, revolute, Mesh, twist, omega, q, v, DT, G, PITCH, fmt, now, xyzw, arc, weight, motor, revError } from './sk.mjs';
import { inertiaAbout, NO, AXZ } from './sk.mjs';

const which = process.argv.slice(2);
const want = (c) => which.length === 0 || which.includes(c);

/** Shaft body at x with coaxial gear discs [{r, z}] and optional arm weight; pinned to ground. */
function shaft(W, x, discs, { arm, fixed = false, y = 0 } = {}) {
  const d = fixed ? R.RigidBodyDesc.fixed() : R.RigidBodyDesc.dynamic().setCanSleep(false);
  const body = W.w.createRigidBody(d.setTranslation(x, y, 0));
  const cq = xyzw(arc([0, 1, 0], AXZ));
  for (const g of discs) W.w.createCollider(R.ColliderDesc.cylinder(0.5, g.r).setTranslation(0, 0, g.z).setRotation(cq).setDensity(1).setCollisionGroups(NO), body);
  if (arm) W.w.createCollider(weight(arm.at, arm.m).setCollisionGroups(NO), body);
  const joint = fixed ? null : revolute(W, W.ground, body, [x, y, 0], [0, 0, 0], AXZ);
  return { body, joint, g: discs.map((g) => ({ body, lc: [0, 0, g.z], la: AXZ, r: g.r })) };
}
const th = (b, s) => twist(q(b.rotation()), AXZ, s);

if (want('stiff')) {
  console.log('=== static stiffness: gear 0 FIXED, N−1 idlers r=1, last gear carries horizontal arm (m at L). θ_last should stay 0.');
  for (const [m, L] of [[50, 10], [100, 30]]) {
    const tau = m * G * L;
    for (const N of [2, 5, 10, 20, 40]) {
      for (const fb of [true, false]) {
        const W = makeWorld();
        const S = [];
        for (let i = 0; i < N; i++) S.push(shaft(W, 2 * i, [{ r: 1, z: 0 }], { fixed: i === 0, arm: i === N - 1 ? { m, at: [L, 0, 0] } : undefined }));
        const M = [];
        for (let i = 0; i + 1 < N; i++) M.push(new Mesh(W, S[i].g[0], S[i + 1].g[0], { lead: true, feedback: fb }));
        const st = S.map(() => ({}));
        S.forEach((s, i) => th(s.body, st[i]));
        const t0 = now();
        let peak = 0;
        const rec = {};
        const steps = 480 * 10;
        for (let i = 0; i < steps; i++) {
          for (const mm of M) mm.update();
          W.w.step();
          const a = th(S[N - 1].body, st[N - 1]);
          peak = Math.max(peak, Math.abs(a));
          if (i + 1 === 48 || i + 1 === 480 || i + 1 === steps) rec[i + 1] = a;
        }
        const ms = (now() - t0) / 10;
        const maxE = Math.max(...M.map((mm) => mm.maxAbsE));
        // arc displacement at the arm tip
        console.log(`m=${m} L=${L} τ=${fmt(tau, 0)}  N=${String(N).padStart(2)} fb=${fb ? 1 : 0}: θ_last 0.1s ${fmt(rec[48], 3)} 1s ${fmt(rec[480], 3)} 10s ${fmt(rec[steps], 3)} rad (peak ${fmt(peak, 3)}; tip sag ${fmt(peak * L, 3)} units); max phase err ${fmt(maxE / PITCH, 3)} teeth; ${fmt(ms, 0)} ms/sim s`);
      }
    }
  }
}

/** Compound train: stages of 0.5→2.5. Shaft i at x=3i; small gear of shaft i at z=i, big of shaft i at z=i−1. */
function compound(W, stages, arm, { lead = true } = {}) {
  const S = [];
  for (let i = 0; i <= stages; i++) {
    const discs = [];
    if (i > 0) discs.push({ r: 2.5, z: i - 1 });
    if (i < stages) discs.push({ r: 0.5, z: i });
    S.push(shaft(W, 3 * i, discs, { arm: i === stages ? arm : undefined }));
  }
  const M = [];
  for (let i = 0; i < stages; i++) M.push(new Mesh(W, S[i].g[S[i].g.length - 1], S[i + 1].g[0], { lead }));
  return { S, M };
}

if (want('thresh')) {
  console.log('=== torque threshold through a compound 1:5^n train: input motor (target +1 rad/s, i.e. lifting) with max force f·τ_out/5^n; output arm m=20 at L=10 horizontal');
  console.log('    CONTROL n=0 is the motor directly on the arm shaft (calibrates the meaning of max force)');
  const m = 20, L = 10;
  for (const n of [0, 1, 2, 3, 4]) {
    const ratio = 5 ** n;
    const sign = n % 2 === 0 ? 1 : -1; // output direction per input +1
    for (const f of [0.9, 0.98, 1.02, 1.1]) {
      const W = makeWorld();
      // arm on the side such that gravity opposes the output turning in direction `sign`: arm at +x → gravity torque −z; output must turn +z to lift
      const armAt = [sign > 0 ? L : -L, 0, 0];
      const { S, M } = compound(W, n, { m, at: armAt });
      const tauOut = m * G * L;
      const tauIn = (f * tauOut) / ratio;
      motor(W, S[0].joint, 1, 1e9, tauIn);
      const st = S.map(() => ({}));
      S.forEach((s, i) => th(s.body, st[i]));
      const steps = 480;
      let maxIn = 0;
      for (let i = 0; i < steps; i++) {
        for (const mm of M) mm.update();
        W.w.step();
        maxIn = Math.max(maxIn, Math.abs(omega(S[0].body, AXZ)));
        S.forEach((s, j) => th(s.body, st[j]));
      }
      const thOut = th(S[n].body, st[n]);
      const thIn = th(S[0].body, st[0]);
      const maxE = M.length ? Math.max(...M.map((mm) => mm.maxAbsE)) : 0;
      const kin = thIn * sign / ratio;
      console.log(`1:${ratio} f=${f}: after 1 s output θ ${fmt(thOut, 5)} rad (${thOut * sign > 0 ? 'LIFTS' : 'falls'}), input θ ${fmt(thIn, 3)}; kinematic residual θ_out − ±θ_in/ratio = ${fmt(thOut - kin, 3)} rad; peak |ω_in| ${fmt(maxIn, 1)}; max phase err ${fmt(maxE / PITCH, 3)} teeth`);
    }
  }
}

function rk(tau, I, T) {
  let th = 0, w = 0, t = 0;
  const h = 1e-5, a = (x) => (tau * Math.cos(x)) / I;
  while (t < T - 1e-12) {
    const k1a = w, k1b = a(th), k2a = w + (h / 2) * k1b, k2b = a(th + (h / 2) * k1a), k3a = w + (h / 2) * k2b, k3b = a(th + (h / 2) * k2a), k4a = w + h * k3b, k4b = a(th + h * k3a);
    th += (h / 6) * (k1a + 2 * k2a + 2 * k3a + k4a); w += (h / 6) * (k1b + 2 * k2b + 2 * k3b + k4b); t += h;
  }
  return th;
}
if (want('backdrive')) {
  console.log('=== back-driving: release the arm (m=20, L=10, from horizontal) on a 1:5^n train with a free input. Analytic reduced model vs sim.');
  for (const n of [1, 2, 3]) {
    const W = makeWorld();
    const ratio = 5 ** n;
    const { S, M } = compound(W, n, { m: 20, at: [10, 0, 0] });
    const k = S.map((_, i) => (i === n ? 1 : (n - i) % 2 === 0 ? 5 ** (n - i) : -(5 ** (n - i)))); // θ_i = k_i θ_out
    const I = S.map((s) => inertiaAbout(s.body, AXZ));
    const Ieff = k.reduce((a, kk, i) => a + kk * kk * I[i], 0);
    const tau = -20 * G * 10;
    const st = S.map(() => ({}));
    S.forEach((s, i) => th(s.body, st[i]));
    let line = [];
    let hit = null;
    for (let i = 0; i < 480 * 1.5; i++) {
      for (const mm of M) mm.update();
      W.w.step();
      S.forEach((s, j) => th(s.body, st[j]));
      const wIn = omega(S[0].body, AXZ);
      if (hit === null && Math.abs(wIn) > 370) hit = (i + 1) * DT;
      if ([24, 48, 96, 240, 480, 719].includes(i + 1)) {
        const t = (i + 1) * DT;
        const thO = st[n].acc;
        // reduced 1-DOF pendulum: Ieff θ'' = τ cos θ (arm horizontal at θ = 0), RK4
        const an = rk(tau, Ieff, t);
        const kinRes = st[0].acc - k[0] * thO;
        line.push(`t=${fmt(t, 3)} θ_out ${fmt(thO, 4)} (1-DOF RK4 ${fmt(an, 4)}) ω_in ${fmt(wIn, 1)} kin.res ${fmt(kinRes, 3)} rad phase ${M.map((mm) => fmt(mm.e / PITCH, 2)).join('/')} t`);
      }
    }
    console.log(`1:${ratio}: I_eff ${fmt(Ieff, 1)}, α_out analytic ${fmt(tau / Ieff, 2)} rad/s²; input passes 370 rad/s at ${hit === null ? 'never' : fmt(hit, 3) + ' s'} (analytic ${fmt(370 / (ratio * Math.abs(tau / Ieff)), 3)} s)`);
    for (const l of line) console.log('   ' + l);
  }
}
process.exit(0);
