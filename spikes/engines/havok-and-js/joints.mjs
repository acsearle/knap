// B6-B10 on raw Havok. Usage: node joints.mjs [U] [substeps]
import { World, H, DT, G, sub, len, dot, rot, qconj, fmt, cpu, add } from "./hv.mjs";
const U = Number(process.argv[2] ?? 0.008);
const SUB = Number(process.argv[3] ?? 1);
const dt = DT / SUB;
const mk = (o = {}) => new World({ U, dt, ideal: dt, ...o });
const out = (...a) => console.log(...a);
const NOCOL = [0, 0];
out(`# Havok joints, U=${U}, ${SUB} step(s) per 1/480 s`);
const A = H.ConstraintAxis, M = H.ConstraintAxisLimitMode;
const anchor = (w) => w.body(w.box([0.1, 0.1, 0.1]), { dynamic: false, filter: NOCOL });
const beam = (w, n, pos, o = {}) => w.body(w.box([n, 0.92, 0.92]), { pos, filter: NOCOL, ...o });
const Z = [0, 0, 1], X = [1, 0, 0];

function chain(w, nLinks) {
  const base = anchor(w); const links = []; const joints = [];
  for (let i = 0; i < nLinks; i++) {
    const l = beam(w, 7, [3 + 6 * i, 0, 0]);
    const par = i === 0 ? base : links[i - 1];
    const pivP = i === 0 ? [0, 0, 0] : [3, 0, 0];
    joints.push({ c: w.hinge(par, l, pivP, Z, X, [-3, 0, 0], Z, X), par, ch: l, pivP, pivC: [-3, 0, 0] });
    links.push(l);
  }
  return { links, joints };
}
const sep = (w, j) => len(sub(w.worldPoint(j.par, j.pivP), w.worldPoint(j.ch, j.pivC)));
const energy = (w, ls) => ls.reduce((s, l) => s + w.ke(l) + w.pe(l), 0);

// ---- B6a / B6b ----
const b6 = {};
for (const n of [1, 3]) {
  const w = mk(); const { links, joints } = chain(w, n);
  const m = w.mass(links[0]);
  const ref = n === 1 ? m * G * 3 : m * G * (3 + 9 + 15);
  const E0 = energy(w, links); let worst = 0; const trace = [];
  const steps = 480 * 10;
  const t = cpu(() => { for (let i = 1; i <= steps; i++) { w.step(SUB); for (const j of joints) worst = Math.max(worst, sep(w, j)); if (i % 960 === 0) trace.push((100 * (energy(w, links) - E0)) / ref); } });
  b6[n] = links.map((l) => w.pose(l).p.join(",")).join(";");
  out(`B6${n === 1 ? "a" : "b"} ${n === 1 ? "pendulum" : "triple pendulum"} 10 s: energy change at 2/4/6/8/10 s = ${trace.map((x) => fmt(x, 2)).join(" / ")} % of ${n === 1 ? "m·g·L (L=3)" : "Σ m·g·depth (27 m·g)"}; worst hinge separation ${fmt(worst, 5)} studs; cpu ${fmt(t.cpuMs / 10, 1)} ms per real s`);
}
// determinism: rerun triple pendulum
{
  const w = mk(); const { links } = chain(w, 3); w.step(480 * 10 * SUB);
  out(`  determinism: triple pendulum rerun in same process bit-identical = ${links.map((l) => w.pose(l).p.join(",")).join(";") === b6[3]}`);
}
// ---- B7 free asymmetric body, non-principal spin ----
{
  const w = mk({ gravity: false });
  const shape = w.container([[w.box([5, 0.92, 0.92]), [0, 0, 0]], [w.box([0.92, 0.92, 0.92]), [2.04, 0.92, 0]]]);
  const b = w.body(shape, { pos: [0, 0, 0], filter: NOCOL });
  const ax = [0.6, 0.64, 0.48]; const n = len(ax);
  w.setAng(b, ax.map((x) => (20 * x) / n));
  // remove the linear velocity the COM offset would otherwise not have (we set angular only; Havok velocities are about COM)
  const K0 = w.rotKE(b), L0 = len(w.angMom(b)); const tr = [];
  for (let s = 1; s <= 30; s++) { w.step(480 * SUB); if (s % 5 === 0) tr.push([s, w.rotKE(b), len(w.angMom(b))]); }
  const [, K, L] = tr[tr.length - 1];
  out(`B7 non-principal spin 20 rad/s, 30 s: rot KE change ${fmt((100 * (K - K0)) / K0 / 30, 4)} %/s (total ${fmt((100 * (K - K0)) / K0, 3)} %), |L| change ${fmt((100 * (L - L0)) / L0 / 30, 4)} %/s (total ${fmt((100 * (L - L0)) / L0, 3)} %); |w| end ${fmt(len(w.ang(b)), 3)}; KE% at 5..30 s: ${tr.map((r) => fmt((100 * (r[1] - K0)) / K0, 3)).join(" ")}`);
  out(`  principal inertia per unit mass (int.units): ${b.mp[2].map((x) => fmt(x, 6)).join(",")} orientation ${b.mp[3].map((x) => fmt(x, 4)).join(",")}`);
}
// ---- B8 gears by a re-anchored LINEAR_X lock (Havok has no gear constraint) ----
function gearRun({ reanchor = true, label }) {
  const w = mk({ gravity: true });
  const base = anchor(w);
  const r1 = 1, r2 = 2.5;
  const g1 = w.body(w.cyl([0, 0, -0.46], [0, 0, 0.46], r1), { pos: [0, 0, 0], filter: NOCOL });
  const g2 = w.body(w.cyl([0, 0, -0.46], [0, 0, 0.46], r2), { pos: [3.5, 0, 0], filter: NOCOL });
  w.hinge(base, g1, [0, 0, 0], Z, X, [0, 0, 0], Z, X);
  w.hinge(base, g2, [3.5, 0, 0], Z, X, [0, 0, 0], Z, X);
  const c = w.joint(g1, g2, [r1, 0, 0], [0, 1, 0], [1, 0, 0], [-r2, 0, 0], [0, 1, 0], [1, 0, 0], [1, 0, 0, 0, 0, 0]);
  const P = [r1, 0, 0], t = [0, 1, 0], nrm = [1, 0, 0];
  function re() {
    for (const [g, cen, setter] of [[g1, [0, 0, 0], H.HP_Constraint_SetAnchorInParent], [g2, [3.5, 0, 0], H.HP_Constraint_SetAnchorInChild]]) {
      const { q } = w.pose(g); const qi = qconj(q);
      chkOK(setter(c, w.s(rot(qi, sub(P, cen))), rot(qi, t), rot(qi, nrm)));
    }
  }
  const angZ = (g) => { const { q } = w.pose(g); return 2 * Math.atan2(q[2], q[3]); };
  const th = [0, 0], last = [0, 0];
  const unwrap = () => [g1, g2].forEach((g, i) => { const a = angZ(g); let d = a - last[i]; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; th[i] += d; last[i] = a; });
  const I1 = w.ke1 = null;
  const Iz = (g) => g.mp[2][2] * g.mp[1] / (U * U);
  const Ieff = Iz(g1) + Iz(g2) * (r1 / r2) ** 2;
  const tau = Ieff * 100; // reaches 100 rad/s in ~1 s
  let W = 0; const KE = () => w.ke(g1) + w.ke(g2);
  const pitch = (2 * Math.PI * r1) / 16; // tooth pitch of a 16-tooth gear of radius 1
  const phaseTeeth = () => (th[0] * r1 + th[1] * r2) / pitch;
  let maxPh = 0; const log = [];
  let i = 0, phase = "spin100";
  let coastStart = null, coastK0 = null, out300 = null;
  const ti = cpu(() => {
    while (i < 480 * 8) {
      i++;
      const w1 = w.ang(g1)[2];
      let drive = 0;
      if (phase === "spin100" && w1 < 100) drive = tau;
      else if (phase === "spin100") { phase = "coast100"; coastStart = i; coastK0 = KE(); log.push(`reached 100 rad/s at ${fmt(i / 480, 3)} s, KE/W=${fmt(KE() / W, 4)}, phase err ${fmt(phaseTeeth(), 4)} teeth`); }
      if (phase === "coast100" && i - coastStart >= 960) { log.push(`coast 2 s at 100: KE change ${fmt((100 * (KE() - coastK0)) / coastK0, 3)} %, w1 ${fmt(w.ang(g1)[2], 3)}, w2/w1 ${fmt(w.ang(g2)[2] / w.ang(g1)[2], 5)} (ideal -0.4), phase err ${fmt(phaseTeeth(), 4)} teeth`); phase = "spin300"; }
      if (phase === "spin300" && w1 < 300) drive = 3 * tau;
      else if (phase === "spin300") { phase = "coast300"; coastStart = i; coastK0 = KE(); log.push(`reached 300 rad/s at ${fmt(i / 480, 3)} s, KE/W=${fmt(KE() / W, 4)}`); }
      if (phase === "coast300" && i - coastStart >= 480) { log.push(`coast 1 s at 300: KE change ${fmt((100 * (KE() - coastK0)) / coastK0, 3)} %, w1 ${fmt(w.ang(g1)[2], 3)}, w2/w1 ${fmt(w.ang(g2)[2] / w.ang(g1)[2], 5)}, phase err ${fmt(phaseTeeth(), 4)} teeth`); break; }
      if (drive) w.angImpulse(g1, [0, 0, drive * dt * SUB]);
      for (let k = 0; k < SUB; k++) { if (reanchor) re(); w.step(1); }
      unwrap();
      if (drive) W += drive * 0.5 * (w1 + w.ang(g1)[2]) * dt * SUB;
      maxPh = Math.max(maxPh, Math.abs(phaseTeeth()));
    }
  });
  out(`B8 gear (${label}): ${log.join("; ")}; max |phase err| ${fmt(maxPh, 4)} teeth of a 16-tooth gear; cpu ${fmt(ti.cpuMs / (i / 480), 1)} ms per real s`);
}
function chkOK(r) { if (r !== H.Result.RESULT_OK) throw new Error("fail " + r); }
gearRun({ reanchor: true, label: "LINEAR_X lock re-anchored every step" });

// ---- B9 hinge extras, measured quickly on the B6a pendulum ----
{
  const res = [];
  // joint friction
  for (const f of [1.2, 0.8]) {
    const w = mk(); const { links, joints } = chain(w, 1); const m = w.mass(links[0]);
    H.HP_Constraint_SetAxisFriction(joints[0].c, A.ANGULAR_X, f * m * G * 3 * U * U);
    w.step(480 * 10 * SUB);
    const p = w.pose(links[0]).p; res.push(`friction ${f} m·g·L: COM y after 10 s ${fmt(p[1], 5)} (0 = held)`);
  }
  // limits
  {
    const w = mk(); const { links, joints } = chain(w, 1); const c = joints[0].c;
    H.HP_Constraint_SetAxisMode(c, A.ANGULAR_X, M.LIMITED); H.HP_Constraint_SetAxisMinLimit(c, A.ANGULAR_X, -0.5); H.HP_Constraint_SetAxisMaxLimit(c, A.ANGULAR_X, 0.5);
    let mn = 9; for (let i = 0; i < 480 * 3; i++) { w.step(SUB); const p = w.pose(links[0]).p; mn = Math.min(mn, Math.atan2(p[1], p[0])); }
    res.push(`angle limit ±0.5: lowest angle reached ${fmt(mn, 4)} rad`);
    // one-sided: min only
    const w2 = mk(); const ch = chain(w2, 1); const c2 = ch.joints[0].c;
    H.HP_Constraint_SetAxisMode(c2, A.ANGULAR_X, M.LIMITED); H.HP_Constraint_SetAxisMinLimit(c2, A.ANGULAR_X, -0.5); H.HP_Constraint_SetAxisMaxLimit(c2, A.ANGULAR_X, 1e9);
    let mn2 = 9; for (let i = 0; i < 480 * 3; i++) { w2.step(SUB); const p = w2.pose(ch.links[0]).p; mn2 = Math.min(mn2, Math.atan2(p[1], p[0])); }
    res.push(`one-sided limit (min -0.5, max 1e9): lowest ${fmt(mn2, 4)} rad`);
  }
  // velocity motor with max torque on a free hinge, zero g
  {
    const w = mk({ gravity: false }); const { links, joints } = chain(w, 1); const c = joints[0].c;
    const l = links[0]; const Ipiv = (l.mp[2][2] * l.mp[1]) / (U * U) + l.mp[1] * 9;
    const tmax = Ipiv * 10; // should give 10 rad/s^2
    H.HP_Constraint_SetAxisMotorType(c, A.ANGULAR_X, H.ConstraintMotorType.VELOCITY);
    H.HP_Constraint_SetAxisMotorTarget(c, A.ANGULAR_X, 5);
    H.HP_Constraint_SetAxisMotorMaxForce(c, A.ANGULAR_X, tmax * U * U);
    const sp = []; for (let i = 1; i <= 480; i++) { w.step(SUB); if (i % 96 === 0) sp.push(w.ang(l)[2]); }
    res.push(`velocity motor target 5, max torque for 10 rad/s²: w at 0.2..1.0 s = ${sp.map((x) => fmt(x, 3)).join(",")} (ideal 2,4,5,5,5 if sign matches)`);
  }
  // reaction impulse on a hanging pendulum at rest
  {
    const w = mk(); const base = anchor(w); const l = beam(w, 7, [0, -3, 0]);
    const c = w.hinge(base, l, [0, 0, 0], Z, X, [0, 3, 0], Z, X);
    w.step(480 * SUB);
    const r = H.HP_Constraint_GetAppliedImpulses(c);
    const lin = r[1], expected = l.mp[1] * G * U * dt;
    res.push(`GetAppliedImpulses on hanging pendulum: linear ${r[1].map((x) => fmt(x / expected, 4)).join(",")} × m·g·dt, angular ${r[2].map((x) => fmt(x, 3)).join(",")}`);
  }
  out(`B9: ${res.join("; ")}`);
}
// ---- B10 cost: triple pendulum + 20-cube pile ----
{
  const w = mk();
  const fl = w.body(w.box([40, 1, 40]), { pos: [10, -30.5, 0], dynamic: false });
  chain(w, 3);
  for (let i = 0; i < 20; i++) w.body(w.box([0.92, 0.92, 0.92]), { pos: [20 + (i % 3) * 0.95 + (Math.floor(i / 3) % 2) * 0.3, -30 + 0.46 + Math.floor(i / 3) * 0.95, (i % 2) * 0.2] });
  w.step(48 * SUB);
  const t = cpu(() => w.step(480 * 5 * SUB));
  out(`B10 triple pendulum + 20-cube pile: ${fmt(t.cpuMs / 5, 1)} ms CPU (${fmt(t.wallMs / 5, 1)} ms wall) per real second, ${SUB} step(s) per 1/480 s`);
}
// f32 check
{
  const w = mk(); const b = w.body(w.box([1, 1, 1]), { pos: [0, 0, 0] });
  H.HP_Body_SetPosition(b.id, [0.1, 1000.1, 1 / 3]);
  out(`precision: set position (0.1, 1000.1, 1/3) int.units, read back ${H.HP_Body_GetPosition(b.id)[1].map((x) => x.toPrecision(17)).join(", ")}`);
}
process.exit(0);
