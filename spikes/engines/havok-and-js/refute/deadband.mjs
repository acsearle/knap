// Is there a low-speed deadband for any constrained (contact or joint) body, independent of
// scale and friction? Frictionless cube sliding on a box floor, and a zero-g hinged beam
// (pivot 3 studs off COM). Speeds in INTERNAL units/s. Also tries the world settings.
// node deadband.mjs
import HavokPhysics from "@babylonjs/havok";
import fs from "node:fs";
const H = await HavokPhysics({ wasmBinary: fs.readFileSync(new URL("../node_modules/@babylonjs/havok/lib/esm/HavokPhysics.wasm", import.meta.url)) });
const ok = (r) => { const x = Array.isArray(r) ? r[0] : r; if (x !== H.Result.RESULT_OK) throw new Error("fail"); return Array.isArray(r) ? r[1] : null; };
const A = H.ConstraintAxis, LM = H.ConstraintAxisLimitMode;
function W(U, { ideal = 1 / 480, g = 1226.25 * U } = {}) {
  const w = ok(H.HP_World_Create()); ok(H.HP_World_SetGravity(w, [0, -g, 0])); if (ideal !== null) ok(H.HP_World_SetIdealStepTime(w, ideal)); ok(H.HP_World_SetSpeedLimit(w, 1e6, 1e6));
  const add = (s, pos, dyn, act = "ALWAYS_ACTIVE") => {
    ok(H.HP_Shape_SetMaterial(s, [0, 0, 0, H.MaterialCombine.MINIMUM, H.MaterialCombine.MAXIMUM])); ok(H.HP_Shape_SetFilterInfo(s, [1, 1]));
    const b = ok(H.HP_Body_Create()); ok(H.HP_Body_SetShape(b, s)); ok(H.HP_Body_SetMotionType(b, dyn ? H.MotionType.DYNAMIC : H.MotionType.STATIC));
    if (dyn) { ok(H.HP_Shape_SetDensity(s, 752)); ok(H.HP_Body_SetMassProperties(b, ok(H.HP_Shape_BuildMassProperties(s)))); ok(H.HP_Body_SetLinearDamping(b, 0)); ok(H.HP_Body_SetAngularDamping(b, 0)); }
    ok(H.HP_Body_SetQTransform(b, [pos.map((p) => p * U), [0, 0, 0, 1]])); ok(H.HP_World_AddBody(w, b, false));
    if (dyn && act) ok(H.HP_Body_SetActivationControl(b, H.ActivationControl[act]));
    return b;
  };
  return { w, add, U, step: (n) => { for (let i = 0; i < n; i++) ok(H.HP_World_Step(w, 1 / 480)); } };
}
const box = (U, e) => ok(H.HP_Shape_CreateBox([0, 0, 0], [0, 0, 0, 1], e.map((x) => x * U)));
function slide(U, vInt, o = {}) {
  const w = W(U, o); w.add(box(U, [400, 1, 400]), [0, -0.5, 0], false); const c = w.add(box(U, [0.92, 0.92, 0.92]), [0, 0.46, 0], true, o.act);
  ok(H.HP_Body_SetLinearVelocity(c, [vInt, 0, 0])); w.step(480); return ok(H.HP_Body_GetLinearVelocity(c))[0] / vInt;
}
function spin(U, vInt, o = {}) { // COM speed vInt internal units/s on a 3-stud arm, zero g
  const w = W(U, { ...o, g: 0 }); const base = w.add(box(U, [0.1, 0.1, 0.1]), [0, 0, 0], false); const l = w.add(box(U, [7, 0.92, 0.92]), [3, 0, 0], true);
  const c = ok(H.HP_Constraint_Create()); ok(H.HP_Constraint_SetParentBody(c, base)); ok(H.HP_Constraint_SetChildBody(c, l));
  ok(H.HP_Constraint_SetAnchorInParent(c, [0, 0, 0], [0, 0, 1], [1, 0, 0])); ok(H.HP_Constraint_SetAnchorInChild(c, [-3 * U, 0, 0], [0, 0, 1], [1, 0, 0])); ok(H.HP_Constraint_SetCollisionsEnabled(c, 0));
  for (const n of ["LINEAR_X", "LINEAR_Y", "LINEAR_Z", "ANGULAR_Y", "ANGULAR_Z"]) ok(H.HP_Constraint_SetAxisMode(c, A[n], LM.LOCKED)); ok(H.HP_Constraint_SetEnabled(c, 1));
  const om = vInt / (3 * U); ok(H.HP_Body_SetAngularVelocity(l, [0, 0, om])); ok(H.HP_Body_SetLinearVelocity(l, [0, vInt, 0])); w.step(480); return ok(H.HP_Body_GetAngularVelocity(l))[2] / om;
}
const speeds = [0.02, 0.05, 0.1, 0.2, 0.5, 1];
for (const U of [0.008, 0.08, 1]) {
  console.log(`U=${U}: frictionless slide, v(1 s)/v0 at v0 = ${speeds.join(", ")} int.units/s: ${speeds.map((v) => slide(U, v).toFixed(3)).join(" ")}`);
  console.log(`U=${U}: zero-g hinged beam, w(1 s)/w0 at COM speed ${speeds.join(", ")}: ${speeds.map((v) => spin(U, v).toFixed(3)).join(" ")}`);
}
console.log("variants at U=0.08, slide v0 0.08 (1 stud/s):",
  ["ideal 0", { ideal: 0 }], ["ideal 1/60", { ideal: 1 / 60 }], ["ideal not set", { ideal: null }], ["SIMULATION_CONTROLLED", { act: "SIMULATION_CONTROLLED" }], ["no activation call", { act: null }]
    .map ? "" : "");
for (const [lab, o] of [["ideal 0", { ideal: 0 }], ["ideal 1/60", { ideal: 1 / 60 }], ["ideal not set", { ideal: null }], ["SIMULATION_CONTROLLED", { act: "SIMULATION_CONTROLLED" }], ["no activation call", { act: null }]])
  console.log(`  ${lab}: v(1 s)/v0 = ${slide(0.08, 0.08, o).toFixed(3)}`);
process.exit(0);
