// B6a single and B6b triple pendulum of beam-7 links hinged at the end holes (pivot 0.5 from
// the beam end, holes 6 apart, COM 3 from its pivot). Hinge axis world Y (horizontal).
// Released from horizontal (links along +X). No friction. 10 s.
// Run: node b6_pendulum.mjs
import { mj, preset, header, v3, compile, step, energy, STUD, HC } from './lib.mjs';

function chainXml(p, nLinks) {
  let open = '', close = '';
  for (let i = 0; i < nLinks; i++) {
    const at = i === 0 ? v3(p, 0, 0, 0) : v3(p, 6, 0, 0);
    open += `<body name="l${i}" pos="${at}"><joint name="h${i}" type="hinge" axis="0 1 0"/>
      <geom type="box" size="${v3(p, 3.5, HC, HC)}" pos="${v3(p, 3, 0, 0)}" contype="0" conaffinity="0"/>
      <site name="tip${i}" pos="${v3(p, 6, 0, 0)}"/>`;
    close += '</body>';
  }
  return `${header(p)}<worldbody>${open}${close}</worldbody></mujoco>`;
}

function run(p, nLinks, T = 10) {
  const { m, d } = compile(chainXml(p, nLinks));
  const E0 = energy(m, d);
  const mass = m.body_mass[1];
  const g = 9.81 * p.gscale, u = STUD * p.lam;
  const ref = nLinks === 1 ? mass * g * 3 * u : mass * g * (3 + 9 + 15) * u; // full drop to hanging
  const n = Math.round(T / p.dt);
  let worstSep = 0, Emax = -Infinity, Emin = Infinity;
  const t0 = performance.now();
  for (let i = 0; i < n; i++) {
    step(m, d);
    // separation: site tip(i) of link i vs origin of link i+1 (the joint anchor); world xanchor vs parent site.
    for (let k = 0; k + 1 < nLinks; k++) {
      const s = d.site_xpos, a = d.xanchor; // xanchor per joint
      const dx = s[3 * k] - a[3 * (k + 1)], dy = s[3 * k + 1] - a[3 * (k + 1) + 1], dz = s[3 * k + 2] - a[3 * (k + 1) + 2];
      worstSep = Math.max(worstSep, Math.hypot(dx, dy, dz) / u);
    }
    if (i % 48 === 0) { const E = energy(m, d) - E0; Emax = Math.max(Emax, E); Emin = Math.min(Emin, E); }
  }
  const ms = performance.now() - t0;
  const dE = energy(m, d) - E0;
  return `dE(10s)=${((100 * dE) / ref).toFixed(4)}% of ref, range [${((100 * Emin) / ref).toFixed(3)}, ${((100 * Emax) / ref).toFixed(3)}]%, worst hinge sep=${worstSep.toExponential(2)} studs, cost=${((ms / T)).toFixed(1)} ms per sim s`;
}

for (const integ of ['Euler', 'implicitfast', 'implicit', 'RK4']) {
  const p = preset('default', 1, { integrator: integ });
  console.log(`B6a ${integ} dt=1/480:`, run(p, 1));
  console.log(`B6b ${integ} dt=1/480:`, run(p, 3));
}
for (const dt of [1 / 960, 1 / 1920]) {
  const p = preset('default', 1, { integrator: 'RK4', dt });
  console.log(`B6b RK4 dt=1/${Math.round(1 / dt)}:`, run(p, 3));
  const q = preset('default', 1, { integrator: 'implicitfast', dt });
  console.log(`B6b implicitfast dt=1/${Math.round(1 / dt)}:`, run(q, 3));
}
console.log('B6b RK4 lam=125:', run(preset('default', 125, { integrator: 'RK4' }), 3));
process.exit(0);
