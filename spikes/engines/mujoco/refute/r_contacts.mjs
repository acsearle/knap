// Independent re-check of the contact claims (B4a, B5a/B5b, B2) with no shared helpers.
// Real units: metres, kg, s; Z-up. 1 stud = 0.008 m. Results printed in studs.
// Run: node r_contacts.mjs
import load from '@mujoco/mujoco';
const mj = await load();
const S = 0.008, RHO = 0.3e-3 / S ** 3, DT = 1 / 480;

function opt(o = {}) {
  const solref = o.solref ?? '0.02 1', solimp = o.solimp ?? '0.9 0.95 0.001';
  return `<mujoco><compiler angle="radian"/>
  <option timestep="${o.dt ?? DT}" integrator="${o.integ ?? 'Euler'}" cone="${o.cone ?? 'pyramidal'}" impratio="${o.impratio ?? 1}" gravity="0 0 -9.81">
   <flag ${o.flags ?? ''}/></option>
  <default><geom friction="0.5 0.005 0.0001" density="${RHO}" solref="${solref}" solimp="${solimp}"/></default>`;
}
const TUNED = { integ: 'implicitfast', cone: 'elliptic', impratio: 10, solref: '0.005 1', solimp: '0.95 0.99 0.0001' };
const s = (x) => +(x * S).toPrecision(10);
function build(xml) { const m = mj.MjModel.from_xml_string(xml); const d = new mj.MjData(m); mj.mj_forward(m, d); return { m, d }; }
const quatZ = (a) => `${Math.cos(a / 2)} 0 0 ${Math.sin(a / 2)}`;

// ---------- B4a: small box on top face of fixed 32-gon prism (mesh, axis vertical)
function prism(n, r, h) {
  const v = [];
  for (const z of [-h / 2, h / 2]) for (let i = 0; i < n; i++) { const a = 2 * Math.PI * i / n + 0.05; v.push(`${s(r * Math.cos(a))} ${s(r * Math.sin(a))} ${s(z)}`); }
  return v.join(' ');
}
function b4a(o, x, y, yaw) {
  const top = 0; // prism top at z=0
  const xml = `${opt(o)}<asset><mesh name="p" vertex="${prism(32, 0.5, 0.5)}"/></asset><worldbody>
    <geom type="mesh" mesh="p" pos="0 0 ${s(-0.25)}"/>
    <body name="b" pos="${s(x)} ${s(y)} ${s(top + 0.05)}" quat="${quatZ(yaw)}"><freejoint/><geom type="box" size="${s(0.08)} ${s(0.08)} ${s(0.05)}"/></body>
  </worldbody></mujoco>`;
  const { m, d } = build(xml);
  let nmin = 99, nmax = 0;
  for (let i = 0; i < 960; i++) { mj.mj_step(m, d); if (i > 50) { nmin = Math.min(nmin, d.ncon); nmax = Math.max(nmax, d.ncon); } }
  const z = d.xpos[5] / S; const zz = d.xmat[9 + 8];
  return `x=${x} y=${y} yaw=${yaw.toFixed(2)} sink=${(0.05 - z).toExponential(2)} tiltDeg=${(Math.acos(Math.min(1, zz)) * 180 / Math.PI).toExponential(2)} ncon ${nmin}..${nmax} moved=${Math.hypot(d.xpos[3] / S - x, d.xpos[4] / S - y).toExponential(1)}`;
}

// ---------- B5: cylinder r1 len 0.92 rolling; heading angle h; floor box or plane
function wheel(o, floor, v0, T, h) {
  const fl = floor === 'plane' ? `<geom type="plane" size="0 0 1"/>`
    : `<geom type="box" size="${s(300)} ${s(300)} ${s(0.5)}" pos="0 0 ${s(-0.5)}"/>`;
  // cylinder axis = local z. Want axis horizontal, perpendicular to heading h in xy.
  // rotate about x by 90 deg (axis -> -y... ) then about z by h.
  const qx = [Math.cos(Math.PI / 4), Math.sin(Math.PI / 4), 0, 0], qz = [Math.cos(h / 2), 0, 0, Math.sin(h / 2)];
  const mul = (a, b) => [a[0]*b[0]-a[1]*b[1]-a[2]*b[2]-a[3]*b[3], a[0]*b[1]+a[1]*b[0]+a[2]*b[3]-a[3]*b[2], a[0]*b[2]-a[1]*b[3]+a[2]*b[0]+a[3]*b[1], a[0]*b[3]+a[1]*b[2]-a[2]*b[1]+a[3]*b[0]];
  const q = mul(qz, qx);
  const xml = `${opt(o)}<worldbody>${fl}<body name="w" pos="0 0 ${s(1)}" quat="${q.join(' ')}"><freejoint/>
     <geom type="cylinder" size="${s(1)} ${s(0.46)}"/></body></worldbody></mujoco>`;
  const { m, d } = build(xml);
  // linear velocity (world frame) along heading; angular velocity world = axis * (-v/r) for rolling
  // axis world = R[:,2]
  const R = d.xmat; const ax = [R[9 + 2], R[9 + 5], R[9 + 8]];
  const dir = [Math.cos(h), Math.sin(h), 0];
  // rolling: omega x (-r z) = v dir  => omega = (v/r) (z x dir)... z x dir = (-dir_y, dir_x, 0)
  const wv = [-dir[1] * v0, dir[0] * v0, 0]; // rad/s with r = 1 stud, v in studs/s
  d.qvel[0] = v0 * S * dir[0]; d.qvel[1] = v0 * S * dir[1];
  // free joint angular velocity is in local frame: w_local = R^T w_world
  for (let k = 0; k < 3; k++) d.qvel[3 + k] = R[9 + k] * wv[0] + R[9 + 3 + k] * wv[1] + R[9 + 6 + k] * wv[2];
  let vmax = 0, vmin = 1e9, sinkMax = 0, slipMax = 0, nc = new Set(); const samples = [];
  const n = Math.round(T / (o.dt ?? DT));
  for (let i = 1; i <= n; i++) {
    mj.mj_step(m, d);
    const v = Math.hypot(d.qvel[0], d.qvel[1], d.qvel[2]) / S;
    if (i > 24) { vmax = Math.max(vmax, v); vmin = Math.min(vmin, v); }
    sinkMax = Math.max(sinkMax, 1 - d.xpos[5] / S); nc.add(d.ncon);
    // spin about own axis (world) dot axis -> omega magnitude; slip = v - |omega| r
    const Rr = d.xmat; const lw = [d.qvel[3], d.qvel[4], d.qvel[5]];
    const ww = [0, 1, 2].map((r) => Rr[9 + 3 * r] * lw[0] + Rr[9 + 3 * r + 1] * lw[1] + Rr[9 + 3 * r + 2] * lw[2]);
    const wmag = Math.hypot(...ww);
    if (i > 24) slipMax = Math.max(slipMax, Math.abs(v - wmag));
    if (i % Math.round(n / 4) === 0) samples.push(v.toPrecision(6));
  }
  const tilt = Math.asin(Math.min(1, Math.abs(d.xmat[9 + 8]))) * 180 / Math.PI; // axis z-component -> tilt from horizontal
  return `${floor} v0=${v0} h=${h.toFixed(2)} T=${T}: v samples ${samples.join(' ')}  vmin ${vmin.toPrecision(6)} vmax ${vmax.toPrecision(6)} slipMax ${slipMax.toExponential(1)} sinkMax ${sinkMax.toExponential(2)} axisTilt ${tilt.toExponential(1)}deg ncon {${[...nc]}}`;
}

// ---------- B2 drop: cube 0.92 flat onto 1-stud box floor at v (with phase offset)
function drop(o, floor, v, phase) {
  const fl = floor === 'plane' ? `<geom type="plane" size="0 0 1"/>` : `<geom type="box" size="${s(20)} ${s(20)} ${s(0.5)}" pos="0 0 ${s(-0.5)}"/>`;
  const xml = `${opt(o)}<worldbody>${fl}<body name="c" pos="0 0 ${s(0.46 + 0.3 + phase)}"><freejoint/><geom type="box" size="${s(0.46)} ${s(0.46)} ${s(0.46)}"/></body></worldbody></mujoco>`;
  const { m, d } = build(xml);
  d.qvel[2] = -v * S;
  let minz = 9, vup = 0;
  for (let i = 0; i < 480; i++) { mj.mj_step(m, d); minz = Math.min(minz, d.xpos[5] / S); vup = Math.max(vup, d.qvel[2] / S); }
  return `${floor} v=${v} phase=${phase}: deepest ${(0.46 - minz).toFixed(3)} rebound ${vup.toFixed(1)} studs/s (${(100 * vup / v).toFixed(1)} %), end z-0.46 ${(d.xpos[5] / S - 0.46).toExponential(2)}`;
}

console.log('== B4a default settings (prism rotated 0.05 rad, box yaws vary)');
for (const [x, y, yaw] of [[0, 0, 0], [0.2, 0.1, 0.3], [0.37, 0, 0.7], [0, -0.38, 1.1], [-0.27, 0.27, 0.4], [0.4, 0.05, 0.2]]) console.log(b4a({}, x, y, yaw));
console.log('== B4a tuned');
for (const [x, y, yaw] of [[0.37, 0, 0.7], [0.4, 0.05, 0.2]]) console.log(b4a(TUNED, x, y, yaw));

console.log('== B5 default settings');
for (const f of ['box', 'plane']) {
  console.log(wheel({}, f, 0, 5, 0.6)); console.log(wheel({}, f, 1, 5, 0.6)); console.log(wheel({}, f, 0.05, 5, 0.6));
  console.log(wheel({}, f, 100, 2, 0)); console.log(wheel({}, f, 100, 2, 0.6));
}
console.log('== B5 tuned');
for (const f of ['box', 'plane']) { console.log(wheel(TUNED, f, 1, 5, 0.6)); console.log(wheel(TUNED, f, 100, 2, 0.6)); }

console.log('== B2 default / tuned / tuned with overdamped solref 0.005 2 / direct solref -k -b');
for (const [lab, o] of [['default', {}], ['tuned', TUNED], ['tuned d=2', { ...TUNED, solref: '0.005 2' }], ['tuned d=4', { ...TUNED, solref: '0.005 4' }]])
  for (const v of [150, 300]) for (const ph of [0, 0.13]) console.log(lab, drop(o, 'box', v, ph));
process.exit(0);
