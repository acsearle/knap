// Q5: robustness — closed loops, centre-distance error, 20-mesh train, determinism, cost, body removal.
// usage: node q5_robust.mjs [loop3] [loop4] [offset] [train] [determinism] [cost] [remove]
import { R, makeWorld, makeGear, pinGear, motor, Mesh, omega, twist, weight, revError, kinetic, v, q, sub, len, PITCH, DT, G, fmt, now } from './lib.mjs';

const which = process.argv.slice(2);
const want = (c) => which.length === 0 || which.includes(c);
const AX = [0, 0, 1];

function chain(W, centres, radii, extras = []) {
  const gears = centres.map((c, i) => makeGear(W, { centre: c, axis: AX, r: radii[i], extras: extras[i] ?? [] }));
  const joints = gears.map((g) => pinGear(W, g));
  return { gears, joints };
}
function stats(gears, joints, meshes) {
  let maxRev = 0;
  for (const j of joints) if (j.isValid()) maxRev = Math.max(maxRev, revError(j).lin);
  const maxW = Math.max(...gears.map((g) => Math.abs(omega(g.body, AX))));
  const maxE = Math.max(...meshes.map((m) => m.maxAbsE));
  return { maxRev, maxW, maxE };
}
function step(W, meshes, n, cb) {
  for (let i = 0; i < n; i++) {
    for (const m of meshes) m.update();
    W.w.step();
    cb?.(i);
  }
}

if (want('loop3')) {
  console.log('=== odd loop: 3 gears r=1 on an equilateral triangle (side 2), all three pairs meshed: must lock');
  for (const [label, maxF, lead, fb] of [['motor 10 rad/s, max 1e3', 1e3, true, true], ['motor 10 rad/s, max 1e6', 1e6, true, true], ['motor 10 rad/s, max 1e6, no feedback', 1e6, true, false], ['motor ∞ gain unlimited', Infinity, true, true]]) {
    const W = makeWorld();
    const cs = [[0, 0, 0], [2, 0, 0], [1, Math.sqrt(3), 0]];
    const { gears, joints } = chain(W, cs, [1, 1, 1]);
    motor(W, joints[0], 10, 1e9, maxF);
    const meshes = [[0, 1], [1, 2], [2, 0]].map(([a, b]) => new Mesh(W, gears[a], gears[b], { lead, feedback: fb }));
    let peakW = 0;
    step(W, meshes, 480 * 5, () => (peakW = Math.max(peakW, ...gears.map((g) => Math.abs(omega(g.body, AX))))));
    const s = stats(gears, joints, meshes);
    const th = gears.map((g) => twist(q(g.body.rotation()), AX, {}));
    console.log(`${label}: after 5 s θ = [${th.map((x) => fmt(x, 4))}] rad; peak |ω| ${fmt(peakW, 3)} rad/s; max phase err ${fmt(s.maxE / PITCH, 3)} teeth; final phase errs [${meshes.map((m) => fmt(m.e / PITCH, 3))}]; max revolute err ${fmt(s.maxRev, 3)} units`);
  }
}

if (want('loop4')) {
  console.log('=== even loop: 4 gears r=1 on a square (side 2), 4 meshes (one redundant): must turn');
  for (const fb of [true, false]) {
    const W = makeWorld();
    const cs = [[0, 0, 0], [2, 0, 0], [2, 2, 0], [0, 2, 0]];
    const { gears, joints } = chain(W, cs, [1, 1, 1, 1]);
    motor(W, joints[0], 10);
    const meshes = [[0, 1], [1, 2], [2, 3], [3, 0]].map(([a, b]) => new Mesh(W, gears[a], gears[b], { lead: true, feedback: fb }));
    const st = gears.map(() => ({}));
    const th0 = gears.map((g, i) => twist(q(g.body.rotation()), AX, st[i]));
    step(W, meshes, 480 * 10, () => gears.forEach((g, i) => twist(q(g.body.rotation()), AX, st[i])));
    const th = gears.map((g, i) => twist(q(g.body.rotation()), AX, st[i]) - th0[i]);
    const s = stats(gears, joints, meshes);
    console.log(`feedback=${fb}: θ after 10 s [${th.map((x) => fmt(x, 4))}] (ideal ±${fmt(100, 1)}); ω [${gears.map((g) => fmt(omega(g.body, AX), 4))}]; max phase err ${fmt(s.maxE / PITCH, 4)} teeth; max revolute err ${fmt(s.maxRev, 3)}`);
  }
}

if (want('offset')) {
  console.log('=== centre distance off by ±0.02 (pair r=1:r=1.5, motor 10 rad/s; and a loaded hold)');
  for (const dd of [-0.02, 0, 0.02]) {
    const W = makeWorld();
    const { gears, joints } = chain(W, [[0, 0, 0], [2.5 + dd, 0, 0]], [1, 1.5]);
    motor(W, joints[0], 10);
    const m = new Mesh(W, gears[0], gears[1], { lead: true });
    const s1 = {}, s2 = {};
    const a0 = twist(q(gears[0].body.rotation()), AX, s1), b0 = twist(q(gears[1].body.rotation()), AX, s2);
    step(W, [m], 480 * 10, () => { twist(q(gears[0].body.rotation()), AX, s1); twist(q(gears[1].body.rotation()), AX, s2); });
    const ratio = (twist(q(gears[1].body.rotation()), AX, s2) - b0) / (twist(q(gears[0].body.rotation()), AX, s1) - a0);
    console.log(`Δd=${dd}: mean ratio ${fmt(ratio, 6)} vs ${fmt(-1 / 1.5, 6)}; max phase err ${fmt(m.maxAbsE / PITCH, 4)} teeth`);
  }
}

function trainCase(nMesh, { load = false, secs = 2, lead = true, quiet = false } = {}) {
  const W = makeWorld();
  const N = nMesh + 1;
  const cs = Array.from({ length: N }, (_, i) => [2 * i, 0, 0]);
  const extras = [];
  if (load) {
    extras[0] = [weight([3, 0, 0], 2)];
    extras[N - 1] = [weight([0, -3, 0], 3)];
  }
  const { gears, joints } = chain(W, cs, Array(N).fill(1), extras);
  if (!load) motor(W, joints[0], 10);
  const meshes = [];
  for (let i = 0; i + 1 < N; i++) meshes.push(new Mesh(W, gears[i], gears[i + 1], { lead }));
  const w = [];
  const sa = {}, sb = {};
  const a0 = twist(q(gears[0].body.rotation()), AX, sa), b0 = twist(q(gears[N - 1].body.rotation()), AX, sb);
  let a1 = a0, b1 = b0;
  const t0 = now();
  step(W, meshes, Math.round(secs / DT), (i) => { if (i < 5) w.push(omega(gears[0].body, AX)); a1 = twist(q(gears[0].body.rotation()), AX, sa); b1 = twist(q(gears[N - 1].body.rotation()), AX, sb); });
  const meanRatio = (b1 - b0) / (a1 - a0);
  const ms = now() - t0;
  const s = stats(gears, joints, meshes);
  let Ieff = 0;
  for (const g of gears) {
    const b = g.body;
    const com = sub(v(b.worldCom()), v(b.translation()));
    Ieff += v(b.principalInertia())[2] + b.mass() * (com[0] ** 2 + com[1] ** 2);
  }
  return { W, gears, joints, meshes, s, ms, w, Ieff, secs, meanRatio };
}

if (want('train')) {
  console.log('=== 20 meshes in one train (21 gears r=1 in a line)');
  const T = trainCase(20, { secs: 10 });
  const kEnd = 1; // (−1)^20
  console.log(`driven 10 rad/s: last gear mean ratio (angles, 10 s) ${fmt(T.meanRatio, 7)} (ideal ${kEnd}), end-of-step ω ${fmt(omega(T.gears[20].body, AX), 5)} (ideal ${10 * kEnd}); max phase err over 20 meshes ${fmt(T.s.maxE / PITCH, 4)} teeth; max revolute err ${fmt(T.s.maxRev, 3)}; ${fmt(T.ms / T.secs, 1)} ms per sim s`);
  // loaded 21-gear chain vs the analytic reduced model: see q3_torque.mjs chain (engine inertias).
}

if (want('determinism')) {
  console.log('=== determinism: same 20-mesh loaded train twice, compare raw f32 state after 1 s');
  const snap = () => {
    const T = trainCase(20, { load: true, secs: 1 });
    return T.gears.map((g) => [...v(g.body.translation()), ...q(g.body.rotation()), ...v(g.body.angvel())]).flat();
  };
  const a = snap(), b = snap();
  const diff = Math.max(...a.map((x, i) => Math.abs(x - b[i])));
  console.log(`max |Δ| between runs: ${diff} (bitwise identical: ${a.every((x, i) => Object.is(x, b[i]))})`);
}

if (want('cost')) {
  console.log('=== cost: chain of N gears r=1 on revolutes, motor on the first; with and without meshes (median of 3 runs, 2 s each)');
  for (const N of [2, 6, 11, 21]) {
    const res = {};
    for (const mode of ['revolutes only', 'with meshes']) {
      const times = [];
      for (let rep = 0; rep < 3; rep++) {
        const W = makeWorld();
        const cs = Array.from({ length: N }, (_, i) => [2 * i, 0, 0]);
        const { gears, joints } = chain(W, cs, Array(N).fill(1));
        motor(W, joints[0], 10);
        const meshes = mode === 'with meshes' ? gears.slice(1).map((g, i) => new Mesh(W, gears[i], g, { lead: true })) : [];
        step(W, meshes, 48);
        let tu = 0;
        const t0 = now();
        for (let i = 0; i < 960; i++) {
          const a = now();
          for (const m of meshes) m.update();
          tu += now() - a;
          W.w.step();
        }
        times.push([(now() - t0) / 2, tu / 2]);
        W.w.free();
      }
      times.sort((x, y) => x[0] - y[0]);
      res[mode] = times[1];
    }
    const per = (res['with meshes'][0] - res['revolutes only'][0]) / (N - 1);
    console.log(`N=${N}: revolutes only ${fmt(res['revolutes only'][0], 1)} ms/sim s; with ${N - 1} meshes ${fmt(res['with meshes'][0], 1)} ms/sim s (JS re-anchoring ${fmt(res['with meshes'][1], 2)} of it) → ${fmt(per, 2)} ms per mesh per sim s`);
  }
}

if (want('remove')) {
  console.log('=== removing a gear body mid-run (3 gears, middle removed at 1 s)');
  const W = makeWorld();
  const { gears, joints } = chain(W, [[0, 0, 0], [2, 0, 0], [4, 0, 0]], [1, 1, 1]);
  motor(W, joints[0], 10);
  const meshes = [new Mesh(W, gears[0], gears[1], { lead: true }), new Mesh(W, gears[1], gears[2], { lead: true })];
  let err = null;
  try {
    step(W, meshes, 480);
    const w2 = omega(gears[2].body, AX);
    W.w.removeRigidBody(gears[1].body);
    step(W, meshes, 480);
    console.log(`before removal ω3=${fmt(w2, 4)}; after 1 s more: meshes dead [${meshes.map((m) => !!m.dead)}], joints in world ${W.w.impulseJoints.len()} (2 revolutes expected), ω1=${fmt(omega(gears[0].body, AX), 4)} ω3=${fmt(omega(gears[2].body, AX), 4)} (coasting; spin gain only)`);
  } catch (e) {
    err = e;
  }
  if (err) console.log(`EXCEPTION: ${err}`);
}

// Exit explicitly: at exit Node 20 spins on Rapier wasm-bindgen finalizers (measured: minutes of CPU after the last line).
process.exit(0);
