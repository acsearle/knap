// B6a pendulum energy loss vs Havok settings. node pend.mjs
import { World, H, G, fmt, sub, len } from "./hv.mjs";
const A = H.ConstraintAxis;
function run(label, { U = 0.008, sub: S = 1, ideal, stiff = null, angDampSet = true }) {
  const dt = 1 / 480 / S;
  const w = new World({ U, dt, ideal: ideal === undefined ? dt : ideal });
  const base = w.body(w.box([0.1, 0.1, 0.1]), { dynamic: false, filter: [0, 0] });
  const l = w.body(w.box([7, 0.92, 0.92]), { pos: [3, 0, 0], filter: [0, 0] });
  const c = w.hinge(base, l, [0, 0, 0], [0, 0, 1], [1, 0, 0], [-3, 0, 0], [0, 0, 1], [1, 0, 0]);
  if (stiff) for (const ax of ["LINEAR_X", "LINEAR_Y", "LINEAR_Z", "ANGULAR_Y", "ANGULAR_Z"]) { H.HP_Constraint_SetAxisStiffness(c, A[ax], stiff[0]); H.HP_Constraint_SetAxisDamping(c, A[ax], stiff[1]); }
  const E = () => w.ke(l) + w.pe(l); const E0 = E(), ref = w.mass(l) * G * 3;
  const tr = []; for (let i = 1; i <= 4800; i++) { w.step(S); if (i % 960 === 0) tr.push((100 * (E() - E0)) / ref); }
  console.log(`${label}: dE at 2/4/6/8/10 s = ${tr.map((x) => fmt(x, 2)).join(" / ")} %`);
}
run("default (ideal = dt = 1/480)", {});
run("ideal step time 1/60 (Havok default)", { ideal: 1 / 60 });
run("ideal step time 0 (no auto adjust)", { ideal: 0 });
run("axis stiffness 1e9, damping 0", { stiff: [1e9, 0] });
run("axis stiffness 1e4, damping 0", { stiff: [1e4, 0] });
run("4 steps per 1/480", { sub: 4 });
run("64 steps per 1/480", { sub: 64 });
process.exit(0);
