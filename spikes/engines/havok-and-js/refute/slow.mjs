// Independent checks of the two SI-scale contact failures (no ../hv.mjs):
//  (1) resting cube 0.92 studs on a box floor, given a 1e-3 rad/s yaw nudge -> self-spin?
//  (2) slow motion on contact: wheel r1 rolling, sphere r1 rolling, cube sliding with mu 0,
//      at 1 stud/s. Does it stop?
// Variants: box vs convex-hull cube, floor as box vs hull, mu, nudge or none.
// node slow.mjs [U ...]
import HavokPhysics from "@babylonjs/havok";
import fs from "node:fs";
const H = await HavokPhysics({ wasmBinary: fs.readFileSync(new URL("../node_modules/@babylonjs/havok/lib/esm/HavokPhysics.wasm", import.meta.url)) });
const ok = (r) => { const x = Array.isArray(r) ? r[0] : r; if (x !== H.Result.RESULT_OK) throw new Error("fail"); return Array.isArray(r) ? r[1] : null; };
const Us = process.argv.slice(2).map(Number); if (!Us.length) Us.push(0.008, 0.08, 1);
function hull(pts, U) { const p = H._malloc(pts.length * 12); const f = new Float32Array(H.HEAPU8.buffer, p, pts.length * 3); pts.flat().forEach((v, i) => (f[i] = v * U)); const s = ok(H.HP_Shape_CreateConvexHull(p, pts.length)); H._free(p); return s; }
const boxPts = (h) => { const o = []; for (const x of [-h[0], h[0]]) for (const y of [-h[1], h[1]]) for (const z of [-h[2], h[2]]) o.push([x, y, z]); return o; };
function world(U, { ideal = 1 / 480 } = {}) {
  const w = ok(H.HP_World_Create()); ok(H.HP_World_SetGravity(w, [0, -1226.25 * U, 0])); ok(H.HP_World_SetIdealStepTime(w, ideal)); ok(H.HP_World_SetSpeedLimit(w, 1e6, 1e6));
  const add = (s, pos, dyn, mu = 0.5) => {
    ok(H.HP_Shape_SetMaterial(s, [mu, mu, 0, H.MaterialCombine.MINIMUM, H.MaterialCombine.MAXIMUM]));
    const b = ok(H.HP_Body_Create()); ok(H.HP_Body_SetShape(b, s)); ok(H.HP_Body_SetMotionType(b, dyn ? H.MotionType.DYNAMIC : H.MotionType.STATIC));
    if (dyn) { ok(H.HP_Shape_SetDensity(s, 752)); ok(H.HP_Body_SetMassProperties(b, ok(H.HP_Shape_BuildMassProperties(s)))); ok(H.HP_Body_SetLinearDamping(b, 0)); ok(H.HP_Body_SetAngularDamping(b, 0)); }
    ok(H.HP_Body_SetQTransform(b, [pos.map((p) => p * U), [0, 0, 0, 1]])); ok(H.HP_World_AddBody(w, b, false));
    if (dyn) ok(H.HP_Body_SetActivationControl(b, H.ActivationControl.ALWAYS_ACTIVE));
    return b;
  };
  return { w, add, step: (n) => { for (let i = 0; i < n; i++) ok(H.HP_World_Step(w, 1 / 480)); } };
}
const L = (v) => Math.hypot(...v);
for (const U of Us) {
  console.log(`# U=${U}`);
  for (const [lab, cubeHull, floorHull, mu, nudge] of [["box cube, box floor, mu .5, nudge", 0, 0, 0.5, 1e-3], ["box cube, no nudge", 0, 0, 0.5, 0], ["hull cube, box floor, nudge", 1, 0, 0.5, 1e-3], ["box cube, hull floor, nudge", 0, 1, 0.5, 1e-3], ["box cube, mu 1.0, nudge", 0, 0, 1.0, 1e-3], ["box cube, mu 0.2, nudge", 0, 0, 0.2, 1e-3]]) {
    const W = world(U);
    W.add(floorHull ? hull(boxPts([20, 0.5, 20]), U) : ok(H.HP_Shape_CreateBox([0, 0, 0], [0, 0, 0, 1], [40 * U, U, 40 * U])), [0, -0.5, 0], false, mu);
    const c = W.add(cubeHull ? hull(boxPts([0.46, 0.46, 0.46]), U) : ok(H.HP_Shape_CreateBox([0, 0, 0], [0, 0, 0, 1], [0.92 * U, 0.92 * U, 0.92 * U])), [0, 0.46, 0], true, mu);
    if (nudge) ok(H.HP_Body_SetAngularVelocity(c, [0, nudge, 0]));
    let mx = 0, mxv = 0; for (let i = 0; i < 960; i++) { W.step(1); mx = Math.max(mx, L(ok(H.HP_Body_GetAngularVelocity(c)))); mxv = Math.max(mxv, L(ok(H.HP_Body_GetLinearVelocity(c))) / U); }
    console.log(`  yaw ${lab}: max |w| in 2 s ${mx.toExponential(2)} rad/s, max |v| ${mxv.toExponential(2)} studs/s`);
  }
  for (const v0 of [1, 10]) {
    for (const kind of ["wheel", "sphere", "slide mu0", "slide mu0 hull"]) {
      const W = world(U);
      W.add(ok(H.HP_Shape_CreateBox([0, 0, 0], [0, 0, 0, 1], [400 * U, U, 400 * U])), [0, -0.5, 0], false, kind.startsWith("slide") ? 0 : 0.5);
      let b;
      if (kind === "wheel") b = W.add(ok(H.HP_Shape_CreateCylinder([0, 0, -0.46 * U], [0, 0, 0.46 * U], U)), [0, 1, 0], true);
      else if (kind === "sphere") b = W.add(ok(H.HP_Shape_CreateSphere([0, 0, 0], U)), [0, 1, 0], true);
      else b = W.add(kind.endsWith("hull") ? hull(boxPts([0.46, 0.46, 0.46]), U) : ok(H.HP_Shape_CreateBox([0, 0, 0], [0, 0, 0, 1], [0.92 * U, 0.92 * U, 0.92 * U])), [0, 0.46, 0], true, 0);
      ok(H.HP_Body_SetLinearVelocity(b, [v0 * U, 0, 0])); if (!kind.startsWith("slide")) ok(H.HP_Body_SetAngularVelocity(b, [0, 0, -v0]));
      const tr = []; for (let i = 1; i <= 960; i++) { W.step(1); if ([1, 10, 48, 480, 960].includes(i)) tr.push((ok(H.HP_Body_GetLinearVelocity(b))[0] / U).toFixed(4)); }
      console.log(`  ${kind} v0 ${v0} studs/s: vx at steps 1/10/48/480/960 = ${tr.join(" ")}`);
    }
  }
}
process.exit(0);
