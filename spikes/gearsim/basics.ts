// Q1 basics: pinned trains in a beam frame, torque-driven from rest at the input.
// Usage: sh spikes/gearsim/run.sh basics [models=1:1,1:3,1:5,1:25,idler5] [mus=0,0.05,0.2] [ks=1,2,4] [secs=2] [alpha=20]
import { Angle, Simulation, f, izAbout, out, phaseTeeth, train } from './lib';
import type { GearCol } from './lib';

export const MODELS: Record<string, { cols: GearCol[]; ratios: number[] }> = {
  // ratios: ω_j / ω_input for each column (kinematic)
  '1:1': { cols: [{ x: 0, col: [1] }, { x: 2, col: [1] }], ratios: [1, -1] },
  '1:3': { cols: [{ x: 0, col: [0.5] }, { x: 2, col: [1.5] }], ratios: [1, -1 / 3] },
  '1:5': { cols: [{ x: 0, col: [0.5] }, { x: 3, col: [2.5] }], ratios: [1, -0.2] },
  '1:25': { cols: [{ x: 0, col: [0.5] }, { x: 3, col: [2.5, 0.5] }, { x: 6, col: [null, 2.5] }], ratios: [1, -0.2, 0.04] },
  single: { cols: [{ x: 0, col: [2.5] }], ratios: [1] },
  idler5: { cols: [0, 2, 4, 6, 8].map((x) => ({ x, col: [1] })), ratios: [1, -1, 1, -1, 1] },
};

async function run(name: string, mu: number, k: number, secs: number, alpha: number) {
  const M = MODELS[name]!;
  const t = train(M.cols);
  const s = await Simulation.create(t.model, { jointFriction: mu, substeps: k });
  const bodies = t.parts.map((p) => s.bodyOf(p)!);
  const piv = M.cols.map((c) => [c.x, c.y ?? 0, 0] as [number, number, number]);
  const I = bodies.map((b, i) => izAbout(s, b, piv[i]!));
  const Ieff = I.reduce((a, Ii, i) => a + M.ratios[i]! ** 2 * Ii, 0);
  const js = s.jointStates();
  const tf = bodies.map((b) => js.find((j) => j.bodyA === b || j.bodyB === b)!.frictionTorque);
  const tfEff = tf.reduce((a, x, i) => a + Math.abs(M.ratios[i]!) * x, 0);
  const tau = alpha * Ieff + tfEff;
  s.setDrive(bodies[0]!, [0, 0, tau]);
  const ang = bodies.map((b) => new Angle(s, b));
  const th0 = ang.map((a) => a.get());
  const e0 = s.energy();
  let jerr = 0;
  let a0 = NaN;
  const n = Math.round(secs * 480);
  let wf = 0;
  let prev = th0.slice();
  for (let i = 1; i <= n; i++) {
    s.stepFixed(1);
    const th = ang.map((a) => a.get());
    th.forEach((x, j) => (wf += tf[j]! * Math.abs(x - prev[j]!)));
    prev = th;
    if (i % 4 === 0) jerr = Math.max(jerr, s.jointError());
    if (i === 24) a0 = (2 * (th[0]! - th0[0]!)) / (24 / 480) ** 2;
  }
  const th = ang.map((a) => a.get());
  const din = th[0]! - th0[0]!;
  let rmax = 0;
  for (let j = 1; j < th.length; j++) rmax = Math.max(rmax, Math.abs((th[j]! - th0[j]!) / din / M.ratios[j]! - 1));
  const e = s.energy();
  const dE = e.kinetic + e.potential - (e0.kinetic + e0.potential);
  const W = s.driveTotal;
  const ph = phaseTeeth(s);
  const thAn = 0.5 * alpha * secs * secs;
  out(
    `${name.padEnd(6)} mu ${mu.toFixed(2)} k ${k}: Ieff ${f(Ieff, 3)} tf_eff ${f(tfEff, 3)} | a0 ${f(a0, 3)} vs ${alpha} (${f(a0 / alpha - 1, 4)}) | θin(${secs}s) ${f(din, 3)} vs ${f(thAn, 3)} (${f(din / thAn - 1, 4)}) | ratio err ${f(rmax)} | phase max ${f(ph.max)} teeth | jointErr ${f(jerr)} | ΔE/(W−Wf) ${f(dE / (W - wf), 4)} guardRemoved/W ${f(s.guardRemoved / W, 4)} | ωin ${f(s.bodyVelocity(bodies[0]!)!.w[2], 2)} | engaged ${s.meshJointCount()}/${s.meshes.length} eng ${s.meshes.map((m) => m.engagements).join(',')} snap ${s.meshes.filter((m) => m.engagements).map((m) => f(m.lastSnap, 3)).join(',')}`,
  );
  s.dispose();
}

const [models = 'single,1:1,1:3,1:5,1:25,idler5', mus = '0,0.05,0.2', ks = '1,2,4', secs = '2', alpha = '20'] = process.argv.slice(2);
for (const name of models.split(','))
  for (const mu of mus.split(',').map(Number))
    for (const k of ks.split(',').map(Number)) await run(name, mu, k, Number(secs), Number(alpha));
process.exit(0);
