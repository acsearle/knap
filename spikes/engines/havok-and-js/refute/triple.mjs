// Independent B6a/B6b substep sweep on raw Havok (no ../hv.mjs). Beam-7 links, holes at +-3,
// hinged end to end (axis world Z), released horizontal, 10 s, g = 9.81 m/s^2 in the chosen units.
// Energy = sum KE + PE from body state; ref = m g L (single) or sum m g depth (27 m g, triple).
// Also reports the max COM height on the first swings for the single pendulum.
// node triple.mjs [U] [n links] [substeps per 1/480 s ...]
import HavokPhysics from "@babylonjs/havok";
import fs from "node:fs";
const H = await HavokPhysics({ wasmBinary: fs.readFileSync(new URL("../node_modules/@babylonjs/havok/lib/esm/HavokPhysics.wasm", import.meta.url)) });
const U = Number(process.argv[2] ?? 0.008), N = Number(process.argv[3] ?? 3);
const SUBS = process.argv.slice(4).map(Number); if (!SUBS.length) SUBS.push(1, 16, 64);
const g = 1226.25 * U;
const A = H.ConstraintAxis, LM = H.ConstraintAxisLimitMode;
const ok = (r) => { const x = Array.isArray(r) ? r[0] : r; if (x !== H.Result.RESULT_OK) throw new Error("fail"); return Array.isArray(r) ? r[1] : null; };
function run(sub) {
  const w = ok(H.HP_World_Create());
  ok(H.HP_World_SetGravity(w, [0, -g, 0])); ok(H.HP_World_SetIdealStepTime(w, 1 / 480 / sub)); ok(H.HP_World_SetSpeedLimit(w, 1e6, 1e6));
  const body = (ext, pos, dyn) => {
    const s = ok(H.HP_Shape_CreateBox([0, 0, 0], [0, 0, 0, 1], ext.map((e) => e * U))); ok(H.HP_Shape_SetFilterInfo(s, [0, 0]));
    const b = ok(H.HP_Body_Create()); ok(H.HP_Body_SetShape(b, s)); ok(H.HP_Body_SetMotionType(b, dyn ? H.MotionType.DYNAMIC : H.MotionType.STATIC));
    let mp = null;
    if (dyn) { ok(H.HP_Shape_SetDensity(s, 752)); mp = ok(H.HP_Shape_BuildMassProperties(s)); ok(H.HP_Body_SetMassProperties(b, mp)); ok(H.HP_Body_SetLinearDamping(b, 0)); ok(H.HP_Body_SetAngularDamping(b, 0)); }
    ok(H.HP_Body_SetQTransform(b, [pos.map((p) => p * U), [0, 0, 0, 1]])); ok(H.HP_World_AddBody(w, b, false));
    if (dyn) ok(H.HP_Body_SetActivationControl(b, H.ActivationControl.ALWAYS_ACTIVE));
    return { b, mp };
  };
  const base = body([0.1, 0.1, 0.1], [0, 0, 0], false); const links = []; const joints = [];
  for (let i = 0; i < N; i++) {
    const l = body([7, 0.92, 0.92], [3 + 6 * i, 0, 0], true); const par = i ? links[i - 1] : base;
    const c = ok(H.HP_Constraint_Create()); ok(H.HP_Constraint_SetParentBody(c, par.b)); ok(H.HP_Constraint_SetChildBody(c, l.b));
    const pp = i ? [3 * U, 0, 0] : [0, 0, 0];
    ok(H.HP_Constraint_SetAnchorInParent(c, pp, [0, 0, 1], [1, 0, 0])); ok(H.HP_Constraint_SetAnchorInChild(c, [-3 * U, 0, 0], [0, 0, 1], [1, 0, 0]));
    ok(H.HP_Constraint_SetCollisionsEnabled(c, 0));
    for (const n of ["LINEAR_X", "LINEAR_Y", "LINEAR_Z", "ANGULAR_Y", "ANGULAR_Z"]) ok(H.HP_Constraint_SetAxisMode(c, A[n], LM.LOCKED));
    ok(H.HP_Constraint_SetAxisMode(c, A.ANGULAR_X, LM.FREE)); ok(H.HP_Constraint_SetEnabled(c, 1));
    links.push(l); joints.push({ par, l, pp: pp.map((x) => x / U) });
  }
  const m = links[0].mp[1], I = links[0].mp[2].map((x) => x * m);
  // planar motion about Z: world w_z is body w_z, so KE_rot = 0.5 Iz wz^2 (+ small x,y terms, included via world w)
  const E = () => links.reduce((s, l) => { const v = ok(H.HP_Body_GetLinearVelocity(l.b)), o = ok(H.HP_Body_GetAngularVelocity(l.b)), y = ok(H.HP_Body_GetPosition(l.b))[1];
    return s + 0.5 * m * (v[0] ** 2 + v[1] ** 2 + v[2] ** 2) + 0.5 * (I[0] * o[0] ** 2 + I[1] * o[1] ** 2 + I[2] * o[2] ** 2) + m * g * y; }, 0);
  const ref = N === 1 ? m * g * 3 * U : m * g * U * (3 + 9 + 15);
  const wp = (b, loc) => { const [[p, q]] = [ok(H.HP_Body_GetQTransform(b))]; const [x, y, z, ww] = q; const c = Math.cos(2 * Math.atan2(z, ww)), s = Math.sin(2 * Math.atan2(z, ww)); return [p[0] / U + c * loc[0] - s * loc[1], p[1] / U + s * loc[0] + c * loc[1]]; };
  const E0 = E(); let worst = 0; const marks = [];
  const t0 = process.cpuUsage();
  for (let i = 1; i <= 4800; i++) {
    for (let k = 0; k < sub; k++) ok(H.HP_World_Step(w, 1 / 480 / sub));
    if (i % 48 === 0) for (const j of joints) { const a = j.par === base ? [0, 0] : wp(j.par.b, j.pp), b = wp(j.l.b, [-3, 0]); worst = Math.max(worst, Math.hypot(a[0] - b[0], a[1] - b[1])); }
    if (i % 960 === 0) marks.push((100 * (E() - E0)) / ref);
  }
  const u = process.cpuUsage(t0);
  console.log(`U=${U} N=${N} sub=${sub}: dE at 2/4/6/8/10 s ${marks.map((x) => x.toFixed(2)).join(" / ")} %; worst sep ${worst.toExponential(2)} studs; cpu ${((u.user + u.system) / 1e4).toFixed(1)} ms/real s = ${((u.user + u.system) / 1e3 / 4800).toFixed(3)} ms per 1/480 s step`);
}
for (const s of SUBS) run(s);
process.exit(0);
