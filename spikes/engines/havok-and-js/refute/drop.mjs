// B2 flat drop, independent: cube 0.92 studs hits a box floor flat at v studs/s.
// Box shape vs convex-hull cube. Reports rebound, max sideways speed and spin after impact,
// and the spin in 0.1-1 s (self-spin). node drop.mjs
import HavokPhysics from "@babylonjs/havok";
import fs from "node:fs";
const H = await HavokPhysics({ wasmBinary: fs.readFileSync(new URL("../node_modules/@babylonjs/havok/lib/esm/HavokPhysics.wasm", import.meta.url)) });
const ok = (r) => { const x = Array.isArray(r) ? r[0] : r; if (x !== H.Result.RESULT_OK) throw new Error("fail"); return Array.isArray(r) ? r[1] : null; };
function hull(pts, U) { const p = H._malloc(pts.length * 12); const f = new Float32Array(H.HEAPU8.buffer, p, pts.length * 3); pts.flat().forEach((v, i) => (f[i] = v * U)); const s = ok(H.HP_Shape_CreateConvexHull(p, pts.length)); H._free(p); return s; }
const cubePts = []; for (const x of [-0.46, 0.46]) for (const y of [-0.46, 0.46]) for (const z of [-0.46, 0.46]) cubePts.push([x, y, z]);
function drop(U, v, useHull, sub = 1) {
  const w = ok(H.HP_World_Create()); ok(H.HP_World_SetGravity(w, [0, -1226.25 * U, 0])); ok(H.HP_World_SetIdealStepTime(w, 1 / 480 / sub)); ok(H.HP_World_SetSpeedLimit(w, 1e6, 1e6));
  const add = (s, pos, dyn) => { ok(H.HP_Shape_SetMaterial(s, [0.5, 0.5, 0, H.MaterialCombine.MINIMUM, H.MaterialCombine.MAXIMUM]));
    const b = ok(H.HP_Body_Create()); ok(H.HP_Body_SetShape(b, s)); ok(H.HP_Body_SetMotionType(b, dyn ? H.MotionType.DYNAMIC : H.MotionType.STATIC));
    if (dyn) { ok(H.HP_Shape_SetDensity(s, 752)); ok(H.HP_Body_SetMassProperties(b, ok(H.HP_Shape_BuildMassProperties(s)))); ok(H.HP_Body_SetLinearDamping(b, 0)); ok(H.HP_Body_SetAngularDamping(b, 0)); }
    ok(H.HP_Body_SetQTransform(b, [pos.map((p) => p * U), [0, 0, 0, 1]])); ok(H.HP_World_AddBody(w, b, false)); if (dyn) ok(H.HP_Body_SetActivationControl(b, H.ActivationControl.ALWAYS_ACTIVE)); return b; };
  add(ok(H.HP_Shape_CreateBox([0, 0, 0], [0, 0, 0, 1], [40 * U, U, 40 * U])), [0, -0.5, 0], false);
  const c = add(useHull ? hull(cubePts, U) : ok(H.HP_Shape_CreateBox([0, 0, 0], [0, 0, 0, 1], [0.92 * U, 0.92 * U, 0.92 * U])), [0, 0.46 + v / 960, 0], true);
  ok(H.HP_Body_SetLinearVelocity(c, [0, -v * U, 0]));
  let up = 0, side = 0, spin = 0, late = 0, pen = 0;
  for (let i = 1; i <= 480; i++) { for (let k = 0; k < sub; k++) ok(H.HP_World_Step(w, 1 / 480 / sub));
    const vv = ok(H.HP_Body_GetLinearVelocity(c)).map((x) => x / U), a = Math.hypot(...ok(H.HP_Body_GetAngularVelocity(c))), y = ok(H.HP_Body_GetPosition(c))[1] / U;
    up = Math.max(up, vv[1]); side = Math.max(side, Math.hypot(vv[0], vv[2])); pen = Math.max(pen, 0.46 - y); if (i <= 48) spin = Math.max(spin, a); else late = Math.max(late, a); }
  const q = ok(H.HP_Body_GetOrientation(c));
  return `rebound ${up.toFixed(3)} side ${side.toFixed(3)} studs/s, spin ${spin.toFixed(2)} rad/s (<0.1 s), ${late.toFixed(3)} (0.1-1 s), pen ${pen.toExponential(1)}, |q_xz| ${Math.hypot(q[0], q[2]).toFixed(3)}`;
}
for (const U of [0.008, 0.08, 1]) for (const hullC of [0, 1]) for (const v of [150, 300]) console.log(`U=${U} ${hullC ? "hull" : "box "} v=${v}: ${drop(U, v, hullC)}`);
console.log(`U=1 box v=150, 4 steps/480: ${drop(1, 150, 0, 4)}`);
console.log(`U=1 box v=150, 16 steps/480: ${drop(1, 150, 0, 16)}`);
process.exit(0);
