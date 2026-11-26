// B7 free spinning asymmetric body, zero g: node b7.mjs <regime> [--flags=N] [--dtdiv=k]
// flags: Bullet btRigidBody flags (2 explicit gyro, 4 implicit world, 8 implicit body). Default = build's default.
import { ammo, World, RHO, f, regimeArg, flag, norm, PKG, cpuTimer } from './lib.mjs';
const A = await ammo();
const reg = regimeArg(), flagsArg = flag('flags', null), dtdiv = flag('dtdiv', 1);
// L-body: beam 5 (5 x .92 x .92) centred at origin + cube (.92^3) centred at (2, .92, 0)
const parts = [{ m: RHO * 5 * 0.92 ** 2, c: [0, 0, 0], d: [5, 0.92, 0.92] }, { m: RHO * 0.92 ** 3, c: [2, 0.92, 0], d: [0.92, 0.92, 0.92] }];
const M = parts.reduce((s, p) => s + p.m, 0);
const com = [0, 1, 2].map((k) => parts.reduce((s, p) => s + p.m * p.c[k], 0) / M);
const I = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
for (const p of parts) {
  const [a, b, c] = p.d; const loc = [(p.m * (b * b + c * c)) / 12, (p.m * (a * a + c * c)) / 12, (p.m * (a * a + b * b)) / 12];
  const r = p.c.map((x, k) => x - com[k]); const r2 = r[0] ** 2 + r[1] ** 2 + r[2] ** 2;
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) I[i][j] += (i === j ? loc[i] + p.m * r2 : 0) - p.m * r[i] * r[j];
}
// Jacobi eigen-decomposition
function jacobi(S) {
  const a = S.map((r) => r.slice()), V = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  for (let sweep = 0; sweep < 50; sweep++) for (const [p, q] of [[0, 1], [0, 2], [1, 2]]) {
    if (Math.abs(a[p][q]) < 1e-18) continue;
    const th = 0.5 * Math.atan2(2 * a[p][q], a[q][q] - a[p][p]), c = Math.cos(th), s = Math.sin(th);
    for (let k = 0; k < 3; k++) { const akp = a[k][p], akq = a[k][q]; a[k][p] = c * akp - s * akq; a[k][q] = s * akp + c * akq; }
    for (let k = 0; k < 3; k++) { const apk = a[p][k], aqk = a[q][k]; a[p][k] = c * apk - s * aqk; a[q][k] = s * apk + c * aqk; }
    for (let k = 0; k < 3; k++) { const vkp = V[k][p], vkq = V[k][q]; V[k][p] = c * vkp - s * vkq; V[k][q] = s * vkp + c * vkq; }
  }
  return { d: [a[0][0], a[1][1], a[2][2]], V };
}
const { d, V } = jacobi(I);
if (V[0][0] * (V[1][1] * V[2][2] - V[1][2] * V[2][1]) - V[0][1] * (V[1][0] * V[2][2] - V[1][2] * V[2][0]) + V[0][2] * (V[1][0] * V[2][1] - V[1][1] * V[2][0]) < 0) for (let k = 0; k < 3; k++) V[k][2] *= -1;
function matToQuat(R) {
  const tr = R[0][0] + R[1][1] + R[2][2];
  if (tr > 0) { const s = Math.sqrt(tr + 1) * 2; return [(R[2][1] - R[1][2]) / s, (R[0][2] - R[2][0]) / s, (R[1][0] - R[0][1]) / s, 0.25 * s]; }
  const i = R[0][0] > R[1][1] && R[0][0] > R[2][2] ? 0 : R[1][1] > R[2][2] ? 1 : 2, j = (i + 1) % 3, k = (i + 2) % 3;
  const s = Math.sqrt(1 + R[i][i] - R[j][j] - R[k][k]) * 2, q = [0, 0, 0, 0];
  q[i] = 0.25 * s; q[j] = (R[j][i] + R[i][j]) / s; q[k] = (R[k][i] + R[i][k]) / s; q[3] = (R[k][j] - R[j][k]) / s; return q;
}
const w = new World({ regime: reg, gravity: 0, dt: 1 / 480 / dtdiv });
const b = w.body(new A.btSphereShape(0.5 * w.S), M, com, matToQuat(V), { inertia: d, mask: 0 });
if (flagsArg !== null) b.setFlags(flagsArg);
const axis = [1, 0.3, 0.2]; const n = norm(axis);
w.setAngvel(b, axis.map((x) => (20 * x) / n));
const E0 = w.rotKE(b), Lv0 = w.angMom(b), L0 = norm(Lv0);
const q0 = w.quat(b);
const Ldev = () => { const L = w.angMom(b); return (100 * norm([L[0] - Lv0[0], L[1] - Lv0[1], L[2] - Lv0[2]])) / L0; };
const t = cpuTimer(); const out = [];
for (let i = 1; i <= 30 * 480 * dtdiv; i++) { w.step(); if (i % (10 * 480 * dtdiv) === 0) out.push(`${i / 480 / dtdiv}s E ${f((100 * (w.rotKE(b) - E0)) / E0, 3)}% |L| ${f((100 * (norm(w.angMom(b)) - L0)) / L0, 3)}% |L-L0|/|L0| ${f(Ldev(), 2)}%`); }
const dE = (100 * (w.rotKE(b) - E0)) / E0, dL = (100 * (norm(w.angMom(b)) - L0)) / L0;
console.log(`B7 pkg=${PKG} regime=${reg} dt=1/${480 * dtdiv} flags=${b.getFlags()} principal I ${d.map((x) => f(x)).join('/')} g*stud^2: ${out.join(' | ')}; per second dE ${f(dE / 30, 4)} %/s d|L| ${f(dL / 30, 4)} %/s, |w| end ${f(norm(w.angvel(b)), 3)} rad/s, w end ${w.angvel(b).map((x) => f(x, 2))}, cpu ${f(t(), 0)} ms`);
process.exit(0);
