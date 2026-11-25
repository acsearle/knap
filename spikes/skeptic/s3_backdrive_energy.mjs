// S3: energy during back-driving of a compound 1:25 train (arm released from horizontal).
// A conservative 1-DOF system: E must stay ≤ E0; the arm can at most reach the opposite horizontal.
// usage: node spikes/skeptic/s3_backdrive_energy.mjs
import { R, makeWorld, revolute, Mesh, twist, omega, q, v, DT, G, PITCH, fmt, xyzw, arc, weight, Guard } from './sk.mjs';
import { NO, AXZ, energy } from './sk.mjs';

function shaft(W, x, discs, arm) {
  const body = W.w.createRigidBody(R.RigidBodyDesc.dynamic().setCanSleep(false).setTranslation(x, 0, 0));
  const cq = xyzw(arc([0, 1, 0], AXZ));
  for (const g of discs) W.w.createCollider(R.ColliderDesc.cylinder(0.5, g.r).setTranslation(0, 0, g.z).setRotation(cq).setDensity(1).setCollisionGroups(NO), body);
  if (arm) W.w.createCollider(weight(arm.at, arm.m).setCollisionGroups(NO), body);
  revolute(W, W.ground, body, [x, 0, 0], [0, 0, 0], AXZ);
  return { body, g: discs.map((g) => ({ body, lc: [0, 0, g.z], la: AXZ, r: g.r })) };
}

function run({ stages = 2, m = 20, L = 10, lead = true, guard = false, label, secs = 3, small = 0.5, big = 2.5 }) {
  const W = makeWorld();
  const S = [];
  for (let i = 0; i <= stages; i++) {
    const d = [];
    if (i > 0) d.push({ r: big, z: i - 1 });
    if (i < stages) d.push({ r: small, z: i });
    S.push(shaft(W, (small + big) * i, d, i === stages ? { m, at: [L, 0, 0] } : null));
  }
  const M = [];
  for (let i = 0; i < stages; i++) M.push(new Mesh(W, S[i].g.at(-1), S[i + 1].g[0], { lead }));
  const bodies = S.map((s) => s.body);
  const gd = guard ? new Guard(bodies, [0, -G, 0]) : null;
  gd?.after();
  const E0 = energy(bodies);
  const mgL = m * G * L;
  const st = {};
  twist(q(S[stages].body.rotation()), AXZ, st);
  let maxE = -Infinity, maxWin = 0;
  const log = [];
  for (let i = 0; i < Math.round(secs / DT); i++) {
    for (const mm of M) mm.update();
    W.w.step();
    gd?.after();
    const th = twist(q(S[stages].body.rotation()), AXZ, st);
    const e = (energy(bodies) - E0) / mgL;
    maxE = Math.max(maxE, e);
    maxWin = Math.max(maxWin, Math.abs(omega(S[0].body, AXZ)));
    if ((i + 1) % 48 === 0 && log.length < 16) log.push(`${fmt((i + 1) * DT, 1)}:${fmt(e, 3)}/${fmt(th, 2)}`);
  }
  console.log(`${label}: peak |ω_in| ${fmt(maxWin, 1)} rad/s; max (E−E0)/mgL ${fmt(maxE, 3)} (must be ≤ 0); guard removed ${gd ? fmt(gd.removed / mgL, 2) + ' mgL' : '-'}; max phase err ${fmt(Math.max(...M.map((x) => x.maxAbsE)) / PITCH, 3)} teeth`);
  console.log(`   t:(E−E0)/mgL/θ_out  ${log.join('  ')}`);
}

run({ label: '1:25 lead raw' });
run({ label: '1:25 NO lead raw', lead: false });
run({ label: '1:25 lead + sim.ts-style guard', guard: true });
run({ label: '1:25 lead raw, arm L=2.5 (¼ speed²)', L: 2.5 });
run({ label: '1:5 single stage raw', stages: 1 });
run({ label: '1:9 single stage (0.5→4.5? no: 0.5→1.5 x2 = 1:9) raw', stages: 2, big: 1.5 });
process.exit(0);
