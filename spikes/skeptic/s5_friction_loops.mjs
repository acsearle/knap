// S5: sim.ts joint friction through a train; inconsistent and consistent redundant meshes; a revolute
// angle limit on a meshed gear.
// usage: node spikes/skeptic/s5_friction_loops.mjs [friction] [redundant] [limit]
import { R, makeWorld, revolute, Mesh, twist, omega, q, v, DT, G, PITCH, fmt, motor, Friction, groundRel, R_BORE, xyzw, arc, weight } from './sk.mjs';
import { gearBody, NO, AXZ, inertiaAbout } from './sk.mjs';

const which = process.argv.slice(2);
const want = (c) => which.length === 0 || which.includes(c);
const th = (b, s) => twist(q(b.rotation()), AXZ, s);

if (want('friction')) {
  console.log('=== sim.ts joint friction (μ=0.2, stiction hold) on every revolute of an N-gear idler train (r=1); input motor target 1 rad/s, max torque f·Στ_f');
  for (const N of [2, 6, 12]) {
    for (const f of [0.9, 1.1]) {
      const W = makeWorld();
      const gs = [], js = [];
      for (let i = 0; i < N; i++) {
        const g = gearBody(W, [2 * i, 0, 0], 1);
        gs.push(g);
        js.push(revolute(W, W.ground, g.body, [2 * i, 0, 0], [0, 0, 0], AXZ));
      }
      const fr = gs.map((g, i) => new Friction(W, js[i], g.body.mass(), 0.2, groundRel(g.g)));
      // the input joint's own friction motor occupies AngX; drive the input by a torque instead (τ = f·Στ_f), applied each step
      const tauF = fr.reduce((s, x) => s + x.tf, 0);
      const M = [];
      for (let i = 0; i + 1 < N; i++) M.push(new Mesh(W, gs[i].g, gs[i + 1].g, { lead: true }));
      const st = gs.map(() => ({}));
      gs.forEach((g, i) => th(g.body, st[i]));
      const Isum = gs.reduce((s, g) => s + inertiaAbout(g.body, AXZ), 0);
      const steps = 480;
      for (let i = 0; i < steps; i++) {
        gs[0].body.resetTorques(true);
        gs[0].body.addTorque({ x: 0, y: 0, z: f * tauF }, true);
        for (const m of M) m.update();
        W.w.step();
        for (const x of fr) x.after();
        gs.forEach((g, j) => th(g.body, st[j]));
      }
      const th0 = st[0].acc, thN = st[N - 1].acc;
      const expect = f > 1 ? (0.5 * ((f - 1) * tauF)) / Isum : 0; // θ(1 s) = ½ (τ − Στ_f)/ΣI · t²
      const sgn = N % 2 === 1 ? 1 : -1;
      console.log(`N=${N} f=${f}: Στ_f ${fmt(tauF, 1)}; input θ(1 s) ${fmt(th0, 4)} rad (analytic ${fmt(expect, 4)}); last θ ${fmt(thN, 4)} (kinematic ${fmt(sgn * th0, 4)}); max phase err ${fmt(Math.max(...M.map((m) => m.maxAbsE)) / PITCH, 3)} teeth`);
    }
  }
}

function shaft(W, x, discs, arm) {
  const body = W.w.createRigidBody(R.RigidBodyDesc.dynamic().setCanSleep(false).setTranslation(x, 0, 0));
  const cq = xyzw(arc([0, 1, 0], AXZ));
  for (const g of discs) W.w.createCollider(R.ColliderDesc.cylinder(0.5, g.r).setTranslation(0, 0, g.z).setRotation(cq).setDensity(1).setCollisionGroups(NO), body);
  if (arm) W.w.createCollider(weight(arm.at, arm.m).setCollisionGroups(NO), body);
  const j = revolute(W, W.ground, body, [x, 0, 0], [0, 0, 0], AXZ);
  return { body, j, g: discs.map((g) => ({ body, lc: [0, 0, g.z], la: AXZ, r: g.r })) };
}

if (want('redundant')) {
  console.log('=== two shafts 2 apart with TWO meshes each. Inconsistent: A{1, 1.5} vs B{1, 0.5} (ratios 1 and 3) must lock. Consistent: A{1,1} vs B{1,1} must turn 1:1.');
  for (const [name, ra, rb] of [['INCONSISTENT', [1, 1.5], [1, 0.5]], ['consistent  ', [1, 1], [1, 1]]]) {
    for (const [drv, maxF] of [['arm m=10 L=5 on B, no motor', 0], ['motor on A 10 rad/s, max 1e4', 1e4], ['motor on A 10 rad/s, unlimited', Infinity]]) {
      const W = makeWorld();
      const A = shaft(W, 0, [{ r: ra[0], z: 0 }, { r: ra[1], z: 1 }]);
      const B = shaft(W, 2, [{ r: rb[0], z: 0 }, { r: rb[1], z: 1 }], maxF === 0 ? { m: 10, at: [5, 0, 0] } : null);
      if (maxF) motor(W, A.j, 10, 1e9, maxF);
      const M = [new Mesh(W, A.g[0], B.g[0], { lead: true }), new Mesh(W, A.g[1], B.g[1], { lead: true })];
      const sa = {}, sb = {};
      th(A.body, sa); th(B.body, sb);
      let peak = 0;
      for (let i = 0; i < 480 * 5; i++) {
        for (const m of M) m.update();
        W.w.step();
        th(A.body, sa); th(B.body, sb);
        peak = Math.max(peak, Math.abs(omega(A.body, AXZ)), Math.abs(omega(B.body, AXZ)));
      }
      console.log(`${name} ${drv}: θA ${fmt(sa.acc, 4)} θB ${fmt(sb.acc, 4)} rad after 5 s; peak |ω| ${fmt(peak, 2)}; final phase errs ${M.map((m) => fmt(m.e / PITCH, 3)).join(', ')} teeth (max ${fmt(Math.max(...M.map((m) => m.maxAbsE)) / PITCH, 3)})`);
    }
  }
}

if (want('limit')) {
  console.log('=== revolute angle limit on the driven gear: g1 (r1) motor 2 rad/s with max torque τm; g2 (r2) revolute limited to [−0.5, 0.5]. Expect g1 stops at θ1 = 0.5·r2/r1 and holds.');
  for (const [r1, r2, tm] of [[1, 1, 1e3], [0.5, 2.5, 1e3], [0.5, 2.5, 1e5], [2.5, 0.5, 1e3]]) {
    const W = makeWorld({ gravity: [0, 0, 0] });
    const g1 = gearBody(W, [0, 0, 0], r1);
    const g2 = gearBody(W, [r1 + r2, 0, 0], r2);
    const j1 = revolute(W, W.ground, g1.body, [0, 0, 0], [0, 0, 0], AXZ);
    const jd = R.JointData.revolute({ x: r1 + r2, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 });
    const j2 = W.w.createImpulseJoint(jd, W.ground, g2.body, true);
    j2.setContactsEnabled(false);
    j2.setLimits(-0.5, 0.5); // JointData.limits is ignored for revolutes (verified in dbg_limit.mjs)
    motor(W, j1, 2, 1e9, tm);
    const M = new Mesh(W, g1.g, g2.g, { lead: true });
    const s1 = {}, s2 = {};
    th(g1.body, s1); th(g2.body, s2);
    const tr = [];
    for (let i = 0; i < 480 * 3; i++) {
      M.update();
      W.w.step();
      th(g1.body, s1); th(g2.body, s2);
      if ((i + 1) % 240 === 0) tr.push(`${fmt((i + 1) * DT, 1)}s θ1 ${fmt(s1.acc, 4)} θ2 ${fmt(s2.acc, 4)}`);
    }
    console.log(`r1=${r1} r2=${r2} τm=${tm}: expected stop θ1 = ${fmt((0.5 * r2) / r1, 4)}, θ2 = −0.5 | ${tr.join(' | ')} | phase err ${fmt(M.e / PITCH, 4)} teeth (max ${fmt(M.maxAbsE / PITCH, 3)})`);
  }
}
process.exit(0);
