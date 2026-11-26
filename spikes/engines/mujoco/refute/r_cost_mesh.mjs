// Cost with convex-MESH parts (what knap would really use for liftarms/gears), not box primitives.
// 20 dynamic 16-gon prisms (r 0.5, len 0.92) plus 20 beam-5 hulls with rounded ends (24-vertex hulls) piled on a plane,
// and the same pile as box primitives, default MuJoCo settings except dt 1/480. Also tuned settings.
// Run: node r_cost_mesh.mjs
import load from '@mujoco/mujoco';
const mj = await load();
const S = 0.008, RHO = 0.3e-3 / S ** 3; const s = (x) => +(x * S).toPrecision(10);
function prismV(n, r, len) { const v = []; for (const z of [-len / 2, len / 2]) for (let i = 0; i < n; i++) { const a = 2 * Math.PI * i / n; v.push(`${s(r * Math.cos(a))} ${s(r * Math.sin(a))} ${s(z)}`); } return v.join(' '); }
function beamV(n, half, r, w) { // stadium: two half-circles of n segs
  const v = []; for (const z of [-w / 2, w / 2]) { for (let i = 0; i <= n; i++) { const a = -Math.PI / 2 + Math.PI * i / n; v.push(`${s(half + r * Math.cos(a))} ${s(r * Math.sin(a))} ${s(z)}`); } for (let i = 0; i <= n; i++) { const a = Math.PI / 2 + Math.PI * i / n; v.push(`${s(-half + r * Math.cos(a))} ${s(r * Math.sin(a))} ${s(z)}`); } } return v.join(' ');
}
function scene(kind, tuned) {
  const o = tuned ? `integrator="implicitfast" cone="elliptic" impratio="10"` : '';
  const sr = tuned ? `solref="0.005 1" solimp="0.95 0.99 0.0001"` : '';
  let bodies = ''; let k = 0;
  for (let z = 0; z < 4; z++) for (let i = 0; i < 10; i++) {
    const x = (i % 5) * 5.5 - 11 + (z % 2) * 0.3, y = Math.floor(i / 5) * 2.2, h = 0.5 + z * 1.0;
    const g = kind === 'box' ? (k % 2 ? `<geom type="box" size="${s(2.5)} ${s(0.46)} ${s(0.46)}"/>` : `<geom type="box" size="${s(0.46)} ${s(0.46)} ${s(0.46)}"/>`)
      : (k % 2 ? `<geom type="mesh" mesh="beam"/>` : `<geom type="mesh" mesh="prism"/>`);
    bodies += `<body pos="${s(x)} ${s(y)} ${s(h)}"><freejoint/>${g}</body>`; k++;
  }
  return `<mujoco><option timestep="${1 / 480}" ${o} gravity="0 0 -9.81"/>
  <default><geom density="${RHO}" friction="0.5 0.005 0.0001" ${sr}/></default>
  <asset><mesh name="prism" vertex="${prismV(16, 0.5, 0.92)}"/><mesh name="beam" vertex="${beamV(8, 2, 0.46, 0.92)}"/></asset>
  <worldbody><geom type="plane" size="0 0 1"/>${bodies}</worldbody></mujoco>`;
}
for (const tuned of [false, true]) for (const kind of ['box', 'mesh']) {
  const m = mj.MjModel.from_xml_string(scene(kind, tuned)); const d = new mj.MjData(m);
  for (let i = 0; i < 480; i++) mj.mj_step(m, d); // settle 1 s
  const t0 = performance.now(); let nc = 0;
  for (let i = 0; i < 960; i++) { mj.mj_step(m, d); nc = Math.max(nc, d.ncon); }
  const ms = (performance.now() - t0) / 2;
  let minz = 1e9; for (let b = 1; b < m.nbody; b++) minz = Math.min(minz, d.xpos[3 * b + 2] / S);
  console.log(`${tuned ? 'tuned' : 'default'} 40 bodies ${kind}: ${ms.toFixed(1)} ms per sim s (${(ms / 480 * 1000).toFixed(0)} us/step), max ncon ${nc}, lowest body z ${minz.toFixed(3)} studs`);
}
process.exit(0);
