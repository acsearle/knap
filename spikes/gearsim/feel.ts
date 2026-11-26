// Q1 "feel": (a) a hand crank (3-hole lever on the input of an unloaded 1:5, and of the 1:5 crane
// with a 7-arm) dragged round with the app's grab spring at 1 rev/s; (b) a small arm back-driving
// 1:25: does it fall, creep or hold, and how fast.
import { Angle, G, PITCH, Simulation, crane, f, out, train } from './lib';
import type { GearCol } from './lib';

async function crank(load: boolean, mu: number, rev: number) {
  const cols: GearCol[] = load ? crane('1:5', 7).cols.map((c) => ({ ...c })) : [{ x: 0, col: [0.5] }, { x: 3, col: [2.5] }];
  cols[0] = { x: 0, col: [0.5], arm: { len: 2, dir: -1 } }; // lever 2: clear of the output shaft at distance 3
  if (load) cols[1] = { x: 3, col: [2.5, null], arm: { len: 7 } }; // output arm one layer further out, clear of the crank
  const t = train(cols);
  const s = await Simulation.create(t.model, { jointFriction: mu });
  const ib = s.bodyOf(t.parts[0]!)!;
  const ob = s.bodyOf(t.parts[1]!)!;
  const L = 2;
  const pt: [number, number, number] = [-L, 0, 2];
  s.grab(ib, pt);
  const ai = new Angle(s, ib);
  const ao = new Angle(s, ob);
  const a0 = ai.get();
  const o0 = ao.get();
  let maxLag = 0;
  const n = 2 * 480;
  for (let i = 1; i <= n; i++) {
    const th = Math.PI + 2 * Math.PI * rev * (i / 480);
    s.dragTo([L * Math.cos(th), L * Math.sin(th), 2]);
    s.stepFixed(1);
    maxLag = Math.max(maxLag, Math.abs(ai.get() - a0 - 2 * Math.PI * rev * (i / 480)));
  }
  const din = ai.get() - a0;
  out(`crank ${load ? '1:5 + 7-arm' : '1:5 unloaded'} mu ${mu} ${rev} rev/s: input ${f(din / (2 * Math.PI), 3)} rev of ${2 * rev}, max lag ${f(maxLag, 3)} rad, output/input ${f((ao.get() - o0) / din, 4)} (−0.2), phase ${f(Math.max(...s.meshes.map((m) => m.maxE / PITCH)), 4)} teeth`);
  s.dispose();
}

async function backdrive(arm: number, mu: number) {
  const M = crane('1:25', arm);
  const t = train(M.cols);
  const s = await Simulation.create(t.model, { jointFriction: mu });
  const ob = s.bodyOf(t.parts[2]!)!;
  const mi = s.massInfo(ob)!;
  const tauArm = mi.mass * G * (mi.com[0] - 6);
  const js = s.jointStates();
  const bodies = t.parts.map((p) => s.bodyOf(p)!);
  const tf = bodies.map((b) => js.find((j) => j.bodyA === b || j.bodyB === b)!.frictionTorque);
  const resist = tf.reduce((a, x, i) => a + x * Math.abs(M.ratios[i]! / M.ratios[2]!), 0); // all friction reflected to the output
  const ao = new Angle(s, ob);
  const a0 = ao.get();
  let t90 = NaN;
  for (let i = 1; i <= 480 * 4; i++) {
    s.stepFixed(1);
    if (Number.isNaN(t90) && ao.get() - a0 < -Math.PI / 2) t90 = i / 480;
  }
  out(`1:25 back-driven by a ${arm}-hole arm, mu ${mu}: arm torque ${f(tauArm, 0)} vs friction reflected to the output ${f(resist, 0)} → ${tauArm > resist ? 'should fall' : 'should hold'}; fell ${f(ao.get() - a0, 4)} rad in 4 s; reached vertical at ${Number.isNaN(t90) ? 'never' : f(t90, 3) + ' s'}`);
  s.dispose();
}

for (const load of [false, true]) for (const mu of [0, 0.05, 0.2]) await crank(load, mu, 1);
for (const arm of [2, 3, 5, 7]) for (const mu of [0.05, 0.2]) await backdrive(arm, mu);
process.exit(0);
