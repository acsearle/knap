// S1: two pendulums geared together. Period vs analytic coupled value; energy over 120 s (raw, no guard).
// usage: node spikes/skeptic/s1_pendulum.mjs [secs=120]
import { R, makeWorld, revolute, Mesh, twist, omega, q, v, DT, G, PITCH, fmt, now, axisAngle, xyzw } from './sk.mjs';
import { gearBody, inertiaAbout, energy, AXZ } from './sk.mjs';

const SECS = Number(process.argv[2] ?? 120);
const m = 2, L = 3;

function reducedPeriod(I1, I2, k, M1, M2, th0) {
  // θ2 = kθ1. V = M1(1−cos θ1) + M2(1−cos kθ1) with Mi = m_i g d_i. RK4, release from th0 at rest.
  const acc = (th) => -(M1 * Math.sin(th) + k * M2 * Math.sin(k * th)) / (I1 + k * k * I2);
  let th = th0, w = 0, t = 0;
  const h = 2e-6;
  let prev = th, crossings = [];
  while (crossings.length < 3) {
    const k1a = w, k1b = acc(th);
    const k2a = w + (h / 2) * k1b, k2b = acc(th + (h / 2) * k1a);
    const k3a = w + (h / 2) * k2b, k3b = acc(th + (h / 2) * k2a);
    const k4a = w + h * k3b, k4b = acc(th + h * k3a);
    th += (h / 6) * (k1a + 2 * k2a + 2 * k3a + k4a);
    w += (h / 6) * (k1b + 2 * k2b + 2 * k3b + k4b);
    t += h;
    if (prev < 0 && th >= 0) crossings.push(t - (th / (th - prev)) * h);
    prev = th;
  }
  return crossings[2] - crossings[1];
}

function run({ r1, r2, th0, mesh = true, label }) {
  const W = makeWorld();
  const k = -r1 / r2;
  const A = gearBody(W, [0, 0, 0], r1, { arm: { m, at: [0, -L, 0] } });
  const B = mesh ? gearBody(W, [r1 + r2, 0, 0], r2, { arm: { m, at: [0, -L, 0] } }) : null;
  A.body.setRotation(xyzw(axisAngle(AXZ, th0)), true);
  if (B) B.body.setRotation(xyzw(axisAngle(AXZ, k * th0)), true);
  revolute(W, W.ground, A.body, [0, 0, 0], [0, 0, 0], AXZ);
  if (B) revolute(W, W.ground, B.body, [r1 + r2, 0, 0], [0, 0, 0], AXZ);
  const I1 = inertiaAbout(A.body, AXZ), I2 = B ? inertiaAbout(B.body, AXZ) : 0;
  const M1 = A.body.mass() * G * (L * m) / A.body.mass(); // m·g·L of the bob (gear COM on axis)
  const M2 = B ? M1 : 0;
  const Tan = reducedPeriod(I1, I2, k, M1, M2, th0);
  const Tsmall = 2 * Math.PI * Math.sqrt((I1 + k * k * I2) / (M1 + k * k * M2));
  const M = B ? new Mesh(W, A.g, B.g, { lead: true }) : null;
  const bodies = B ? [A.body, B.body] : [A.body];
  const Erest = -bodies.length * 0; // potential is measured from COM height; compute rest energy explicitly
  const bob = (b) => v(b.worldCom());
  const E0 = energy(bodies);
  // oscillation energy scale: E0 − E(at rest, bottom)
  const Ebottom = E0 - (M1 * (1 - Math.cos(th0)) + M2 * (1 - Math.cos(k * th0)));
  const osc = E0 - Ebottom;
  void Erest; void bob;
  const s1 = {}, s2 = {};
  let prev = twist(q(A.body.rotation()), AXZ, s1);
  const cross = [];
  const N = Math.round(SECS / DT);
  let maxE = 0, minE = 0, maxPh = 0;
  const t0 = now();
  const samples = [];
  for (let i = 0; i < N; i++) {
    M?.update();
    W.w.step();
    const th = twist(q(A.body.rotation()), AXZ, s1);
    if (prev < 0 && th >= 0) cross.push((i + 1) * DT - (th / (th - prev)) * DT);
    prev = th;
    if (M) maxPh = Math.max(maxPh, Math.abs(M.e));
    if (i % 48 === 0) {
      const e = (energy(bodies) - Ebottom) / osc;
      maxE = Math.max(maxE, e - 1);
      minE = Math.min(minE, e - 1);
    }
    if ((i + 1) % (480 * 20) === 0) samples.push(`${(i + 1) / 480}s:${fmt((energy(bodies) - Ebottom) / osc, 4)}`);
  }
  const ms = now() - t0;
  const per = (a, b) => (cross[b] - cross[a]) / (b - a);
  const Tearly = per(1, 6), Tlate = per(cross.length - 6, cross.length - 1);
  const Ef = (energy(bodies) - Ebottom) / osc;
  console.log(`${label}: r1=${r1} r2=${r2} θ0=${th0}  I1=${fmt(I1, 4)} I2=${fmt(I2, 4)}`);
  console.log(`   period: sim early ${fmt(Tearly, 5)} late ${fmt(Tlate, 5)} s; analytic (RK4 reduced, nonlinear) ${fmt(Tan, 5)} s (small-angle ${fmt(Tsmall, 5)}); err early ${fmt(Tearly / Tan - 1, 3)} late ${fmt(Tlate / Tan - 1, 3)}`);
  console.log(`   oscillation energy E/E0 at ${SECS}s: ${fmt(Ef, 4)}  (range ${fmt(1 + minE, 4)}..${fmt(1 + maxE, 4)}); per 20 s: ${samples.join(' ')}`);
  if (M) console.log(`   max |phase err| ${fmt(maxPh / PITCH, 3)} teeth; ${fmt(ms / SECS, 1)} ms per sim s`);
}

for (const th0 of [0.2, 1.2]) {
  run({ r1: 1, r2: 1, th0, mesh: false, label: 'CONTROL single pendulum (no mesh)' });
  run({ r1: 1, r2: 1, th0, label: '1:1 geared pair' });
  run({ r1: 0.5, r2: 1.5, th0, label: '1:3 geared pair (small drives big)' });
  run({ r1: 1.5, r2: 0.5, th0: th0 / 3, label: '3:1 geared pair (big gear θ0/3, small swings θ0)' });
}
process.exit(0);
