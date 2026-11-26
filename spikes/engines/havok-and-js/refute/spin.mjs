// Zero-g hinged spinner: beam 7 studs pinned 3 studs from its COM to a static anchor, spun at
// 5 rad/s about the hinge. With no gravity, any loss of |w| is velocity damping by the joint.
// Tries every constraint knob in the d.ts to see whether any removes it. node spin.mjs [U]
import HavokPhysics from "@babylonjs/havok";
import fs from "node:fs";
const H = await HavokPhysics({ wasmBinary: fs.readFileSync(new URL("../node_modules/@babylonjs/havok/lib/esm/HavokPhysics.wasm", import.meta.url)) });
const U = Number(process.argv[2] ?? 0.008);
const A = H.ConstraintAxis, LM = H.ConstraintAxisLimitMode;
const ok = (r) => { const x = Array.isArray(r) ? r[0] : r; if (x !== H.Result.RESULT_OK) throw new Error("fail " + JSON.stringify(r)); return Array.isArray(r) ? r[1] : null; };
const LIN = ["LINEAR_X", "LINEAR_Y", "LINEAR_Z"], ANG = ["ANGULAR_X", "ANGULAR_Y", "ANGULAR_Z"];
function run(label, cfg, { sub = 1, w0 = 5, arm = 3, dumpDefaults = false } = {}) {
  const w = ok(H.HP_World_Create());
  ok(H.HP_World_SetGravity(w, [0, 0, 0]));
  ok(H.HP_World_SetIdealStepTime(w, 1 / 480 / sub));
  ok(H.HP_World_SetSpeedLimit(w, 1e6, 1e6));
  const body = (ext, pos, dyn) => {
    const s = ok(H.HP_Shape_CreateBox([0, 0, 0], [0, 0, 0, 1], ext.map((e) => e * U)));
    ok(H.HP_Shape_SetFilterInfo(s, [0, 0]));
    const b = ok(H.HP_Body_Create()); ok(H.HP_Body_SetShape(b, s));
    ok(H.HP_Body_SetMotionType(b, dyn ? H.MotionType.DYNAMIC : H.MotionType.STATIC));
    if (dyn) { ok(H.HP_Shape_SetDensity(s, 752)); ok(H.HP_Body_SetMassProperties(b, ok(H.HP_Shape_BuildMassProperties(s)))); ok(H.HP_Body_SetLinearDamping(b, 0)); ok(H.HP_Body_SetAngularDamping(b, 0)); }
    ok(H.HP_Body_SetQTransform(b, [pos.map((p) => p * U), [0, 0, 0, 1]]));
    ok(H.HP_World_AddBody(w, b, false));
    if (dyn) ok(H.HP_Body_SetActivationControl(b, H.ActivationControl.ALWAYS_ACTIVE));
    return b;
  };
  const base = body([0.1, 0.1, 0.1], [0, 0, 0], false), link = body([7, 0.92, 0.92], [arm, 0, 0], true);
  const c = ok(H.HP_Constraint_Create());
  ok(H.HP_Constraint_SetParentBody(c, base)); ok(H.HP_Constraint_SetChildBody(c, link));
  ok(H.HP_Constraint_SetAnchorInParent(c, [0, 0, 0], [0, 0, 1], [1, 0, 0]));
  ok(H.HP_Constraint_SetAnchorInChild(c, [-arm * U, 0, 0], [0, 0, 1], [1, 0, 0]));
  ok(H.HP_Constraint_SetCollisionsEnabled(c, 0));
  cfg(c);
  ok(H.HP_Constraint_SetEnabled(c, 1));
  if (dumpDefaults) {
    const d = {};
    for (const n of [...LIN, ...ANG]) d[n] = { mode: H.HP_Constraint_GetAxisMode(c, A[n])[1], fric: H.HP_Constraint_GetAxisFriction(c, A[n])[1], motor: H.HP_Constraint_GetAxisMotorType(c, A[n])[1], mf: H.HP_Constraint_GetAxisMotorMaxForce(c, A[n])[1] };
    console.log("defaults:", JSON.stringify(d, (k, v) => (typeof v === "bigint" ? Number(v) : v)));
    console.log("body angular damping read back:", H.HP_Body_GetAngularDamping(link)[1], "linear:", H.HP_Body_GetLinearDamping(link)[1]);
  }
  ok(H.HP_Body_SetAngularVelocity(link, [0, 0, w0])); ok(H.HP_Body_SetLinearVelocity(link, [0, w0 * arm * U, 0]));
  const t0 = process.cpuUsage();
  for (let i = 0; i < 4800; i++) for (let k = 0; k < sub; k++) ok(H.HP_World_Step(w, 1 / 480 / sub));
  const u = process.cpuUsage(t0);
  const wz = ok(H.HP_Body_GetAngularVelocity(link))[2];
  const p = ok(H.HP_Body_GetPosition(link)).map((x) => x / U);
  console.log(`${label}: w_z 5 -> ${wz.toFixed(4)} after 10 s (KE ${(100 * ((wz / w0) ** 2 - 1)).toFixed(2)} %), COM radius ${Math.hypot(p[0], p[1]).toFixed(5)} studs; cpu ${((u.user + u.system) / 1e4).toFixed(1)} ms/real s`);
}
const lock = (c, names) => { for (const n of [...LIN, ...ANG]) ok(H.HP_Constraint_SetAxisMode(c, A[n], names.includes(n) ? LM.LOCKED : LM.FREE)); };
console.log(`# U=${U}`);
run("hinge (LIN + ANG_Y,Z locked)", (c) => lock(c, [...LIN, "ANGULAR_Y", "ANGULAR_Z"]), { dumpDefaults: true });
run("ball (LIN locked only)", (c) => lock(c, LIN));
run("nothing locked (free body)", (c) => lock(c, []));
run("hinge, motor type NONE + friction 0 on free axis", (c) => { lock(c, [...LIN, "ANGULAR_Y", "ANGULAR_Z"]); H.HP_Constraint_SetAxisMotorType(c, A.ANGULAR_X, H.ConstraintMotorType.NONE); H.HP_Constraint_SetAxisFriction(c, A.ANGULAR_X, 0); });
run("ball via LIMITED [0,0] linear", (c) => { lock(c, []); for (const n of LIN) { H.HP_Constraint_SetAxisMode(c, A[n], LM.LIMITED); H.HP_Constraint_SetAxisMinLimit(c, A[n], 0); H.HP_Constraint_SetAxisMaxLimit(c, A[n], 0); } });
run("ball via LINEAR_DISTANCE LIMITED [0,0]", (c) => { lock(c, []); H.HP_Constraint_SetAxisMode(c, A.LINEAR_DISTANCE, LM.LIMITED); H.HP_Constraint_SetAxisMinLimit(c, A.LINEAR_DISTANCE, 0); H.HP_Constraint_SetAxisMaxLimit(c, A.LINEAR_DISTANCE, 0); });
run("ball LIMITED [0,0], stiffness 1e9 damping 0", (c) => { lock(c, []); for (const n of LIN) { H.HP_Constraint_SetAxisMode(c, A[n], LM.LIMITED); H.HP_Constraint_SetAxisMinLimit(c, A[n], 0); H.HP_Constraint_SetAxisMaxLimit(c, A[n], 0); H.HP_Constraint_SetAxisStiffness(c, A[n], 1e9); H.HP_Constraint_SetAxisDamping(c, A[n], 0); } });
run("ball LIMITED [0,0], stiffness 1e3 damping 0", (c) => { lock(c, []); for (const n of LIN) { H.HP_Constraint_SetAxisMode(c, A[n], LM.LIMITED); H.HP_Constraint_SetAxisMinLimit(c, A[n], 0); H.HP_Constraint_SetAxisMaxLimit(c, A[n], 0); H.HP_Constraint_SetAxisStiffness(c, A[n], 1e3); H.HP_Constraint_SetAxisDamping(c, A[n], 0); } });
run("hinge, pivot at COM (arm 0)", (c) => lock(c, [...LIN, "ANGULAR_Y", "ANGULAR_Z"]), { arm: 0 });
run("hinge, 16 substeps", (c) => lock(c, [...LIN, "ANGULAR_Y", "ANGULAR_Z"]), { sub: 16 });
run("hinge, w0 0.5 rad/s", (c) => lock(c, [...LIN, "ANGULAR_Y", "ANGULAR_Z"]), { w0: 0.5 });
process.exit(0);
