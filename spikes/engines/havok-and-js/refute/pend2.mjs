// Independent pendulum check on raw Havok (does not use ../hv.mjs).
// Beam 7 x 0.92 x 0.92 studs, pivot 3 studs from COM, released horizontal, g = 9.81 m/s^2.
// Reports energy (KE + PE, from body velocities) and the max COM height reached on each
// half-swing (release height = 0), so damping cannot hide behind an energy formula.
// node pend2.mjs [U]   (U = internal units per stud; 0.008 = metres)
import HavokPhysics from "@babylonjs/havok";
import fs from "node:fs";
const H = await HavokPhysics({ wasmBinary: fs.readFileSync(new URL("../node_modules/@babylonjs/havok/lib/esm/HavokPhysics.wasm", import.meta.url)) });
const U = Number(process.argv[2] ?? 0.008);
const g = 9.81 / 0.008 * U; // 1226.25 studs/s^2 expressed in internal units
const A = H.ConstraintAxis, LM = H.ConstraintAxisLimitMode;
const ok = (r) => { const x = Array.isArray(r) ? r[0] : r; if (x !== H.Result.RESULT_OK) throw new Error("fail"); return Array.isArray(r) ? r[1] : null; };

function setup({ kind = "hinge", sub = 1, baseDynamic = false, axis = "z", zeroG = false, w0 = 0, lockAxis = "ANGULAR_X" } = {}) {
  const w = ok(H.HP_World_Create());
  ok(H.HP_World_SetGravity(w, [0, zeroG ? 0 : -g, 0]));
  ok(H.HP_World_SetIdealStepTime(w, 1 / 480 / sub));
  ok(H.HP_World_SetSpeedLimit(w, 1e6, 1e6));
  const mk = (ext, pos, dyn, dens) => {
    const s = ok(H.HP_Shape_CreateBox([0, 0, 0], [0, 0, 0, 1], ext.map((e) => e * U)));
    ok(H.HP_Shape_SetFilterInfo(s, [0, 0]));
    const b = ok(H.HP_Body_Create());
    ok(H.HP_Body_SetShape(b, s));
    ok(H.HP_Body_SetMotionType(b, dyn ? H.MotionType.DYNAMIC : H.MotionType.STATIC));
    let mp = null;
    if (dyn) { ok(H.HP_Shape_SetDensity(s, dens)); mp = ok(H.HP_Shape_BuildMassProperties(s)); ok(H.HP_Body_SetMassProperties(b, mp)); ok(H.HP_Body_SetLinearDamping(b, 0)); ok(H.HP_Body_SetAngularDamping(b, 0)); }
    ok(H.HP_Body_SetQTransform(b, [pos.map((p) => p * U), [0, 0, 0, 1]]));
    ok(H.HP_World_AddBody(w, b, false));
    if (dyn) ok(H.HP_Body_SetActivationControl(b, H.ActivationControl.ALWAYS_ACTIVE));
    return { b, mp };
  };
  const base = mk([0.1, 0.1, 0.1], [0, 0, 0], baseDynamic, 752e6);
  const link = mk([7, 0.92, 0.92], [3, 0, 0], true, 752);
  const c = ok(H.HP_Constraint_Create());
  ok(H.HP_Constraint_SetParentBody(c, base.b));
  ok(H.HP_Constraint_SetChildBody(c, link.b));
  // hinge axis is world Z. Frame axis X = hinge axis when lockAxis = ANGULAR_X.
  const ax = [0, 0, 1], perp = [1, 0, 0];
  const fx = lockAxis === "ANGULAR_X" ? ax : perp, fy = lockAxis === "ANGULAR_X" ? perp : (lockAxis === "ANGULAR_Y" ? ax : [0, 1, 0]);
  // for ANGULAR_Z free: X=perp(1,0,0), Y=(0,1,0) -> Z = X x Y = (0,0,1) = hinge axis
  ok(H.HP_Constraint_SetAnchorInParent(c, [0, 0, 0], fx, fy));
  ok(H.HP_Constraint_SetAnchorInChild(c, [-3 * U, 0, 0], fx, fy));
  ok(H.HP_Constraint_SetCollisionsEnabled(c, 0));
  const freeAx = kind === "ball" ? ["ANGULAR_X", "ANGULAR_Y", "ANGULAR_Z"] : [lockAxis];
  for (const n of ["LINEAR_X", "LINEAR_Y", "LINEAR_Z", "ANGULAR_X", "ANGULAR_Y", "ANGULAR_Z"]) ok(H.HP_Constraint_SetAxisMode(c, A[n], freeAx.includes(n) ? LM.FREE : LM.LOCKED));
  ok(H.HP_Constraint_SetEnabled(c, 1));
  if (w0) { ok(H.HP_Body_SetAngularVelocity(link.b, [0, 0, w0])); ok(H.HP_Body_SetLinearVelocity(link.b, [0, w0 * 3 * U, 0])); }
  const m = link.mp[1], Ic = link.mp[2].map((x) => x * m); // inertia for mass 1 per d.ts
  const E = () => {
    const v = ok(H.HP_Body_GetLinearVelocity(link.b)), om = ok(H.HP_Body_GetAngularVelocity(link.b));
    const y = ok(H.HP_Body_GetPosition(link.b))[1];
    // box inertia axes are body axes; rotation is about Z only, so world om_z == body om_z
    return 0.5 * m * (v[0] ** 2 + v[1] ** 2 + v[2] ** 2) + 0.5 * (Ic[0] * om[0] ** 2 + Ic[1] * om[1] ** 2 + Ic[2] * om[2] ** 2) + m * g * y;
  };
  return { w, link, m, Ic, E, step: () => { for (let k = 0; k < sub; k++) ok(H.HP_World_Step(w, 1 / 480 / sub)); }, y: () => ok(H.HP_Body_GetPosition(link.b))[1] / U };
}

function swing(label, o) {
  const s = setup(o);
  const E0 = s.E(), ref = s.m * g * 3 * U;
  // sanity: analytic inertia check
  const IzAnalytic = s.m * ((7 * U) ** 2 + (0.92 * U) ** 2) / 12;
  const peaks = []; let prevVy = 0, maxY = -1e9;
  const t0 = process.cpuUsage();
  for (let i = 1; i <= 4800; i++) {
    s.step();
    const vy = ok(H.HP_Body_GetLinearVelocity(s.link.b))[1];
    if (prevVy > 0 && vy <= 0) peaks.push(s.y()); // top of a half swing
    prevVy = vy;
  }
  const u = process.cpuUsage(t0);
  console.log(`${label}: Iz/analytic ${(s.Ic[2] / IzAnalytic).toFixed(4)}; dE 10 s ${(100 * (s.E() - E0) / ref).toFixed(2)} %; COM-height peaks (studs, release 0) first 4: ${peaks.slice(0, 4).map((x) => x.toFixed(3)).join(" ")} ... last: ${peaks.slice(-1).map((x) => x.toFixed(3))}  (${peaks.length} peaks); cpu ${((u.user + u.system) / 1e4).toFixed(1)} ms/real s`);
}
console.log(`# U=${U}`);
swing("hinge, ANGULAR_X free (as original)", {});
swing("hinge, ANGULAR_Z free", { lockAxis: "ANGULAR_Z" });
swing("ball joint (3 linear locks only)", { kind: "ball" });
swing("hinge, base dynamic 1e6x denser", { baseDynamic: true });
swing("hinge, 4 substeps", { sub: 4 });
// zero-g constant spin about the hinge: any decay here is velocity damping, not position error
for (const [lab, o] of [["hinge zero-g spin 5 rad/s", { zeroG: true, w0: 5 }], ["ball zero-g spin 5 rad/s", { zeroG: true, w0: 5, kind: "ball" }]]) {
  const s = setup(o); const E0 = s.E(); for (let i = 0; i < 4800; i++) s.step();
  console.log(`${lab}: KE change in 10 s ${(100 * (s.E() - E0) / E0).toFixed(3)} %, w_z end ${ok(H.HP_Body_GetAngularVelocity(s.link.b))[2].toFixed(4)}`);
}
process.exit(0);
