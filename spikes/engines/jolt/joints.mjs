// B6 pendulums, B7 free spin, B8 gears. Usage: node joints.mjs [regime ...] [--vsteps=N] [--csteps=N]
import { World, Jolt, REGIME_NAMES, qRot, fmt, G_REAL, DT_REAL, LAYER_GHOST } from './lib.mjs';
const args = process.argv.slice(2);
const regimes = args.filter(a => !a.startsWith('--'));
const opt = Object.fromEntries(args.filter(a => a.startsWith('--')).map(a => a.slice(2).split('=')).map(([k, v]) => [k, +v]));
const RUN = regimes.length ? regimes : REGIME_NAMES;
const S = 480;
const wopts = { velocitySteps: opt.vsteps ?? 10, positionSteps: opt.psteps ?? 2, collisionSteps: opt.csteps ?? 1 };
const out = (...a) => console.log(...a);
const sub = (a, b) => a.map((x, i) => x - b[i]);
const add = (a, b) => a.map((x, i) => x + b[i]);

function anchorTracker(w, b, worldPt) { // returns fn giving world anchor of body b (studs)
  const c0 = w.pos(b), q0 = w.quat(b);
  const qi = [-q0[0], -q0[1], -q0[2], q0[3]];
  const local = qRot(qi, sub(worldPt, c0));
  return () => add(w.pos(b), qRot(w.quat(b), local));
}

for (const R of RUN) {
  out(`\n===== regime ${R} (vsteps ${wopts.velocitySteps}, psteps ${wopts.positionSteps}, csteps ${wopts.collisionSteps}) =====`);
  // ---- B6a
  {
    const w = new World(R, wopts);
    const b = w.add(w.box(3.5, 0.46, 0.46), { pos: [3, 0, 0] });
    w.hinge(null, b, [0, 0, 0], [0, 0, 1]);
    const anc = anchorTracker(w, b, [0, 0, 0]);
    const E = () => w.ke(b) + w.pe(b);
    const E0 = E(), scale = w.mass(b) * G_REAL * w.L / w.T ** 2 * w.len(3);
    let sep = 0, minE = 0, maxE = 0;
    const t0 = performance.now();
    for (let i = 1; i <= 10 * S; i++) {
      w.step(); sep = Math.max(sep, Math.hypot(...anc()));
      const d = (E() - E0) / scale; minE = Math.min(minE, d); maxE = Math.max(maxE, d);
    }
    const ms = performance.now() - t0;
    out(`B6a: energy change after 10 s ${fmt(100 * (E() - E0) / scale, 3)} % of mgL (range ${fmt(100 * minE, 3)} .. ${fmt(100 * maxE, 3)}), worst hinge separation ${fmt(sep)} studs, cost ${fmt(ms / 10, 2)} ms per sim s`);
    w.destroy();
  }
  // ---- B6b
  {
    const w = new World(R, wopts);
    const links = [0, 1, 2].map(i => w.add(w.box(3.5, 0.46, 0.46), { pos: [3 + 6 * i, 0, i] }));
    const anc = [];
    w.hinge(null, links[0], [0, 0, 0], [0, 0, 1]);
    anc.push([anchorTracker(w, links[0], [0, 0, 0]), () => [0, 0, 0]]);
    for (let i = 1; i < 3; i++) {
      const p = [6 * i, 0, i - 0.5];
      w.hinge(links[i - 1], links[i], p, [0, 0, 1]);
      anc.push([anchorTracker(w, links[i - 1], p), anchorTracker(w, links[i], p)]);
    }
    const E = () => links.reduce((s, b) => s + w.ke(b) + w.pe(b), 0);
    const g = G_REAL * w.L / w.T ** 2;
    const scale = links.reduce((s, b, i) => s + w.mass(b) * g * w.len(3 + 6 * i), 0);
    const E0 = E();
    let sep = 0; const trace = [];
    const t0 = performance.now();
    for (let i = 1; i <= 10 * S; i++) {
      w.step();
      for (const [a, c] of anc) { const d = Math.hypot(...sub(a(), c()).map((x, k) => k === 2 ? 0 : x)); sep = Math.max(sep, d); }
      if (i % (2 * S) === 0) trace.push(fmt(100 * (E() - E0) / scale, 2));
    }
    const ms = performance.now() - t0;
    out(`B6b: energy change at 2/4/6/8/10 s ${trace.join(' / ')} % of swing energy; worst in-plane hinge separation ${fmt(sep)} studs; cost ${fmt(ms / 10, 2)} ms per sim s`);
    w.destroy();
  }
  // ---- B7
  for (const gyro of [false, true]) {
    const w = new World(R, { ...wopts, gravity: false });
    const shape = w.compound([{ shape: w.box(2.5, 0.46, 0.46), pos: [0, 0, 0] }, { shape: w.box(0.46, 0.46, 0.46), pos: [2.04, 0.92, 0] }]);
    const n = Math.sqrt(3);
    const b = w.add(shape, { pos: [0, 5, 0], angVel: [20 / n, 20 / n, 20 / n], gyro });
    const meas = () => { const om = w.w(b).map(x => x / w.T); const L = w.Iw(b, om); return [0.5 * (om[0] * L[0] + om[1] * L[1] + om[2] * L[2]), Math.hypot(...L)]; };
    const [E0, L0] = meas();
    const Lvec = () => w.Iw(b, w.w(b).map(x => x / w.T)); const Lv0 = Lvec();
    let eMin = 1, eMax = 1, lMin = 1, lMax = 1;
    for (let i = 1; i <= 30 * S; i++) {
      w.step();
      const [e, l] = meas();
      eMin = Math.min(eMin, e / E0); eMax = Math.max(eMax, e / E0); lMin = Math.min(lMin, l / L0); lMax = Math.max(lMax, l / L0);
    }
    const [E1, L1] = meas();
    const Lv1 = Lvec(); const cosA = (Lv0[0] * Lv1[0] + Lv0[1] * Lv1[1] + Lv0[2] * Lv1[2]) / (Math.hypot(...Lv0) * Math.hypot(...Lv1));
    out(`B7 gyro=${gyro}: after 30 s E ${fmt(100 * (E1 / E0 - 1), 3)} % (${fmt(100 * (E1 / E0 - 1) / 30, 4)} %/s), |L| ${fmt(100 * (L1 / L0 - 1), 3)} % (${fmt(100 * (L1 / L0 - 1) / 30, 4)} %/s); range E ${fmt(100 * (eMin - 1), 2)}..${fmt(100 * (eMax - 1), 2)} %, |L| ${fmt(100 * (lMin - 1), 2)}..${fmt(100 * (lMax - 1), 2)} %; |w| end ${fmt(Math.hypot(...w.w(b)), 3)} rad/s; L direction turned ${fmt(Math.acos(Math.min(1, cosA)) * 180 / Math.PI, 3)} deg`);
    w.destroy();
  }
  // ---- B8
  for (const target of [100, 300]) {
    const w = new World(R, { ...wopts, gravity: false });
    const g1 = w.add(w.cylinder(1, 0.46), { pos: [0, 0, 0], rot: [Math.SQRT1_2, 0, 0, Math.SQRT1_2], layer: LAYER_GHOST });
    const g2 = w.add(w.cylinder(2.5, 0.46), { pos: [3.5, 0, 0], rot: [Math.SQRT1_2, 0, 0, Math.SQRT1_2], layer: LAYER_GHOST });
    const h1 = w.hinge(null, g1, [0, 0, 0], [0, 0, 1]);
    const h2 = w.hinge(null, g2, [3.5, 0, 0], [0, 0, 1]);
    const gs = new Jolt.GearConstraintSettings();
    gs.mHingeAxis1 = new Jolt.Vec3(0, 0, 1); gs.mHingeAxis2 = new Jolt.Vec3(0, 0, 1);
    const N2 = opt.teeth2 ?? 40, RT = N2 / 16; gs.SetRatio(16, N2);
    const gc = Jolt.castObject(gs.Create(g1, g2), Jolt.GearConstraint);
    if (!opt.nogearpos) gc.SetConstraints(h1, h2); // gives the gear a position (drift) correction from the hinge angles
    w.ps.AddConstraint(gc);
    const I1 = w.Iw(g1, [0, 0, 1])[2], I2 = w.Iw(g2, [0, 0, 1])[2];
    const alpha = target / 0.5; // reach target in 0.5 s (real)
    const tauInt = (I1 + I2 / (RT * RT)) * alpha / (w.T * w.T);
    let th1 = 0, th2 = 0, q1 = 0, q2 = 0, a1p = 0, a2p = 0;
    const unwrap = d => d - 2 * Math.PI * Math.round(d / (2 * Math.PI));
    let hingeErr = 0, work = 0, on = true, worst = 0, released = -1, Krel = 0;
    const rows = [];
    const KE = () => w.ke(g1) + w.ke(g2);
    for (let i = 1; i <= 3 * S; i++) {
      const wb = w.w(g1)[2];
      if (on) w.bi.AddTorque(g1.GetID(), new Jolt.Vec3(0, 0, tauInt), Jolt.EActivation_Activate);
      w.step();
      const wa = w.w(g1)[2];
      if (on) work += tauInt * 0.5 * (wa + wb) / w.T * w.dtInt;
      // Jolt integrates rotation with the end-of-step angular velocity, so theta += w*dt is exact
      th1 += wa * DT_REAL; th2 += w.w(g2)[2] * DT_REAL;
      // independent pose check: rotation angle about world Z from the quaternions, unwrapped per gear
      const zAng = q => { const r = qRot(q, [1, 0, 0]); return Math.atan2(r[1], r[0]); };
      const a1 = zAng(w.quat(g1)), a2 = zAng(w.quat(g2));
      q1 += unwrap(a1 - a1p); q2 += unwrap(a2 - a2p); a1p = a1; a2p = a2;
      const perr = q1 + RT * q2; hingeErr = Math.max(hingeErr, Math.abs(perr));
      const err = th1 + RT * th2; // rad of small gear
      worst = Math.max(worst, Math.abs(err));
      if (on && wa >= target) { on = false; released = i; Krel = KE(); rows.push(`released at t=${fmt(i / S, 3)} s, KE/work ${fmt(Krel / work, 5)}`); }
      if (i % (S / 2) === 0) rows.push(`t=${fmt(i / S, 1)} w1 ${fmt(w.w(g1)[2], 2)} w2 ${fmt(w.w(g2)[2], 3)} ratio ${fmt(-w.w(g1)[2] / w.w(g2)[2], 6)} phase err (int. w) ${fmt(err)} rad, (pose) ${fmt(perr)} rad = ${fmt(perr * 16 / (2 * Math.PI))} teeth`);
    }
    const tAfter = (3 * S - released) / S;
    out(`B8 target ${target} rad/s: I1 ${fmt(I1)} I2 ${fmt(I2)} (internal); 16:${N2}${opt.nogearpos ? ' no gear position correction' : ''}; worst phase err from integrated w ${fmt(worst)} rad; from body poses ${fmt(hingeErr)} rad (${fmt(hingeErr * 16 / (2 * Math.PI))} teeth of the 16); KE drift after release ${released > 0 ? fmt(100 * (KE() / Krel - 1) / tAfter, 4) + ' %/s' : 'never released'}`);
    for (const r of rows) out('   ' + r);
    w.destroy();
  }
}
process.exit(0);
