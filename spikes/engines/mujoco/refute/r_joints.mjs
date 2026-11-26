// Independent check of B6a/B6b (energy; is it damping in disguise?) and B8 (gear equality).
// Run: node r_joints.mjs
import load from '@mujoco/mujoco';
const mj = await load();
const S = 0.008, RHO = 0.3e-3 / S ** 3;
const s = (x) => +(x * S).toPrecision(10);

function chain(n, integ, dt, extra = '') {
  let o = '', c = '';
  for (let i = 0; i < n; i++) {
    // beam 7 along +x, hinge at local origin (hole 0.5 from the end), next hole at +6
    o += `<body pos="${i ? s(6) : 0} 0 0"><joint type="hinge" axis="0 1 0" ${extra}/>
      <geom type="box" size="${s(3.5)} ${s(0.46)} ${s(0.46)}" pos="${s(3)} 0 0" contype="0" conaffinity="0"/>`;
    c += '</body>';
  }
  return `<mujoco><option timestep="${dt}" integrator="${integ}" gravity="0 0 -9.81"><flag energy="enable"/></option>
   <default><geom density="${RHO}"/></default><worldbody>${o}${c}</worldbody></mujoco>`;
}
function E(m, d) { mj.mj_energyPos(m, d); mj.mj_energyVel(m, d); return d.energy[0] + d.energy[1]; }

function pend(n, integ, dt, T = 10) {
  const m = mj.MjModel.from_xml_string(chain(n, integ, dt)); const d = new mj.MjData(m);
  mj.mj_forward(m, d);
  const mass = m.body_mass[1]; const ref = n === 1 ? mass * 9.81 * 3 * S : mass * 9.81 * 27 * S;
  const E0 = E(m, d); const N = Math.round(T / dt);
  let lastPeakHeight = null, maxTipZ = -1e9, maxTipZlate = -1e9;
  const t0 = performance.now();
  for (let i = 0; i < N; i++) {
    mj.mj_step(m, d);
    // COM height of link 1 relative to pivot (z), in studs; release at 0
    const z = d.xipos[5] / S;
    if (d.time > T - 2) maxTipZlate = Math.max(maxTipZlate, z);
  }
  const ms = performance.now() - t0;
  // also an independent energy: sum m g z_com + 0.5 qdot^T M qdot via mj_mulM
  // own planar energy from qpos/qvel only (studs, then x S^2 / S)
  let phi = 0, phid = 0, bx = 0, bz = 0, bvx = 0, bvz = 0, pe = 0, ke = 0;
  for (let k = 0; k < n; k++) {
    phi += d.qpos[k]; phid += d.qvel[k];
    const ex = Math.cos(phi), ez = -Math.sin(phi), dex = -Math.sin(phi) * phid, dez = -Math.cos(phi) * phid;
    const cz = bz + 3 * ez, cvx = bvx + 3 * dex, cvz = bvz + 3 * dez;
    const mk = m.body_mass[k + 1], Ic = mk * (49 + 0.92 * 0.92) / 12;
    pe += mk * 9.81 * cz * S; ke += 0.5 * mk * (cvx * cvx + cvz * cvz) * S * S + 0.5 * Ic * S * S * phid * phid;
    bx += 6 * ex; bz += 6 * ez; bvx += 6 * dex; bvz += 6 * dez;
  }
  const dE = pe + ke;
  return { dEpct: 100 * dE / ref, mjpct: 100 * (E(m, d) - E0) / ref, maxZlate: maxTipZlate, ms: ms / T };
}

console.log('== B6a single pendulum: dE % of m g L, highest link COM z in the last 2 s (release height 0)');
for (const integ of ['Euler', 'implicitfast', 'RK4']) {
  const r = pend(1, integ, 1 / 480);
  console.log(`${integ} 1/480: dE ${r.dEpct.toFixed(4)} % (mj ${r.mjpct.toFixed(4)}), max COM z last 2 s ${r.maxZlate.toExponential(2)} studs, ${r.ms.toFixed(2)} ms/sim s`);
}
console.log('== B6b triple pendulum: dE % of m g (3+9+15) at 10 s');
for (const [integ, dt] of [['Euler', 1 / 480], ['implicitfast', 1 / 480], ['RK4', 1 / 480], ['Euler', 1 / 4800], ['RK4', 1 / 4800]]) {
  const r = pend(3, integ, dt);
  console.log(`${integ} 1/${Math.round(1 / dt)}: dE ${r.dEpct.toFixed(3)} % (mj ${r.mjpct.toFixed(3)}), ${r.ms.toFixed(2)} ms/sim s`);
}
// Energy time series to see whether Euler loss is gradual or a jump
{
  const m = mj.MjModel.from_xml_string(chain(3, 'Euler', 1 / 480)); const d = new mj.MjData(m); mj.mj_forward(m, d);
  const mass = m.body_mass[1], ref = mass * 9.81 * 27 * S, E0 = E(m, d); const row = [];
  for (let i = 1; i <= 4800; i++) { mj.mj_step(m, d); if (i % 480 === 0) row.push((100 * (E(m, d) - E0) / ref).toFixed(1)); }
  console.log('Euler 1/480 dE % per second:', row.join(' '));
  const m2 = mj.MjModel.from_xml_string(chain(3, 'RK4', 1 / 480)); const d2 = new mj.MjData(m2); mj.mj_forward(m2, d2);
  const row2 = []; const E02 = E(m2, d2);
  for (let i = 1; i <= 4800; i++) { mj.mj_step(m2, d2); if (i % 480 === 0) row2.push((100 * (E(m2, d2) - E02) / ref).toFixed(3)); }
  console.log('RK4 1/480 dE % per second:  ', row2.join(' '));
}

// ---------- B8 gears via joint equality, plus a loaded case
function gears(eqsolref, integ, loadFrac) {
  const AX = `euler="1.5707963267948966 0 0"`;
  const xml = `<mujoco><compiler angle="radian"/><option timestep="${1 / 480}" integrator="${integ}" gravity="0 0 -9.81"/>
   <default><geom density="${RHO}" contype="0" conaffinity="0"/></default><worldbody>
   <body><joint name="a" type="hinge" axis="0 1 0"/><geom type="cylinder" size="${s(1)} ${s(0.46)}" ${AX}/></body>
   <body pos="${s(3.5)} 0 0"><joint name="b" type="hinge" axis="0 1 0"/><geom type="cylinder" size="${s(2.5)} ${s(0.46)}" ${AX}/></body>
   </worldbody><equality><joint joint1="a" joint2="b" polycoef="0 -2.5 0 0 0" ${eqsolref ? `solref="${eqsolref}"` : ''}/></equality></mujoco>`;
  const m = mj.MjModel.from_xml_string(xml); const d = new mj.MjData(m); mj.mj_forward(m, d);
  // effective inertia at the small shaft from MuJoCo's own mass matrix diag
  mj.mj_forward(m, d);
  const Ia = m.body_inertia[3 * 1 + 1], Ib = m.body_inertia[3 * 2 + 1]; // about local y? check both
  const Iax = Math.max(...[0, 1, 2].map((k) => m.body_inertia[3 + k])), Ibx = Math.max(...[0, 1, 2].map((k) => m.body_inertia[6 + k]));
  const Ieff = Iax + Ibx / 6.25; const tau = Ieff * 100;
  const tauLoad = loadFrac * tau * 2.5; // load torque on big wheel opposing
  let W = 0, maxErr = 0, rel = null;
  const pitch = 2 * Math.PI / 16;
  while (d.time < 3) {
    const drive = rel === null;
    d.qfrc_applied[0] = drive ? tau : 0;
    d.qfrc_applied[1] = drive ? tauLoad : 0; // big turns negative; positive torque opposes
    const w0 = [d.qvel[0], d.qvel[1]];
    mj.mj_step(m, d);
    if (drive) W += (tau * 0.5 * (w0[0] + d.qvel[0]) + tauLoad * 0.5 * (w0[1] + d.qvel[1])) / 480;
    maxErr = Math.max(maxErr, Math.abs(d.qpos[0] + 2.5 * d.qpos[1]));
    if (!rel && d.qvel[0] >= 100) { const K = 0.5 * (Iax * d.qvel[0] ** 2 + Ibx * d.qvel[1] ** 2); rel = { t: d.time, K, W }; }
  }
  const Kend = 0.5 * (Iax * d.qvel[0] ** 2 + Ibx * d.qvel[1] ** 2);
  return `${integ} eq solref ${eqsolref ?? 'default'} load ${loadFrac}: reach 100 at ${rel ? rel.t.toFixed(3) : 'never'} s, K/W ${rel ? (rel.K / rel.W).toFixed(5) : '-'}, K end/K rel ${rel ? (Kend / rel.K).toFixed(6) : '-'}, max ratio err ${maxErr.toExponential(2)} rad = ${(maxErr / pitch).toExponential(2)} teeth (16T), omega ratio end ${(d.qvel[0] / d.qvel[1]).toFixed(5)}`;
}
console.log('== B8');
for (const [sr, integ, lf] of [[null, 'implicitfast', 0], ['0.005 1', 'implicitfast', 0], [null, 'implicitfast', 0.5], ['0.005 1', 'implicitfast', 0.5], [null, 'Euler', 0]]) console.log(gears(sr, integ, lf));
process.exit(0);
