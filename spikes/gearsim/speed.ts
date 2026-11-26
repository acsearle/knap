// Q5 speeds in ordinary use: a crane (arm on the output of 1:5 / 1:25 / 1:125).
//  drop:  arm released horizontal; energy vs analytic (μ 0: constant), RK4 reduced-model angle,
//         phase slip, visible reversal (input turning against the kinematic sense while the output moves).
//  yank:  grab the arm tip at rest and jump the target 8 units up; hold 0.5 s.
//  spin:  grab the input gear's rim and drag the target round it at `rev` rev/s for 1 s.
// Usage: sh spikes/gearsim/run.sh speed [scen=drop] [models=1:5,1:25,1:125] [arms=7,15] [mus=0,0.2] [ks=1,2,4] [extra]
import { Angle, G, PITCH, RotHist, Simulation, crane, energyTotal, f, izAbout, maxGearOmega, out, train } from './lib';

const [scen = 'drop', models = '1:5,1:25,1:125', arms = '7,15', mus = '0,0.2', ks = '1,2,4', extra = ''] = process.argv.slice(2);

async function build(name: string, arm: number, mu: number, k: number, guard = true) {
  const M = crane(name, arm);
  const t = train(M.cols);
  const s = await Simulation.create(t.model, { jointFriction: mu, substeps: k, energyGuard: guard });
  const bodies = t.parts.map((p) => s.bodyOf(p)!);
  return { M, t, s, bodies };
}

async function drop(name: string, arm: number, mu: number, k: number, guard: boolean) {
  const { M, s, bodies } = await build(name, arm, mu, k, guard);
  const last = bodies.length - 1;
  const ob = bodies[last]!;
  const ox = M.cols[last]!.x;
  const mi = s.massInfo(ob)!;
  const mgL = mi.mass * G * (mi.com[0] - ox);
  const kOut = M.ratios[last]!;
  const Ieff = bodies.reduce((a, b, i) => a + (M.ratios[i]! / kOut) ** 2 * izAbout(s, b, [M.cols[i]!.x, 0, 0]), 0);
  const hist = new RotHist();
  hist.attach(s);
  const ao = new Angle(s, ob);
  const a0 = ao.get();
  const E0 = energyTotal(s);
  let emin = 0;
  let emax = 0;
  let reversals = 0;
  let maxW = 0;
  const n = 2 * 480;
  // RK4 reduced model (frictionless): Ieff θ'' = −mgL cos θ
  let th = 0;
  let w = 0;
  const rk = (dt: number) => {
    const acc = (x: number) => (-mgL * Math.cos(x)) / Ieff;
    const k1 = acc(th), l1 = w;
    const k2 = acc(th + (dt / 2) * l1), l2 = w + (dt / 2) * k1;
    const k3 = acc(th + (dt / 2) * l2), l3 = w + (dt / 2) * k2;
    const k4 = acc(th + dt * l3), l4 = w + dt * k3;
    th += (dt / 6) * (l1 + 2 * l2 + 2 * l3 + l4);
    w += (dt / 6) * (k1 + 2 * k2 + 2 * k3 + k4);
  };
  let err02 = NaN;
  let firstBottom = NaN;
  let firstBottomRK = NaN;
  let prevA = 0;
  let prevTh = 0;
  for (let i = 1; i <= n; i++) {
    s.stepFixed(1);
    for (let j = 0; j < 10; j++) rk(1 / 4800);
    const a = ao.get() - a0;
    if (i === 96) err02 = a - th;
    if (Number.isNaN(firstBottom) && prevA > -Math.PI / 2 && a <= -Math.PI / 2) firstBottom = i / 480;
    if (Number.isNaN(firstBottomRK) && prevTh > -Math.PI / 2 && th <= -Math.PI / 2) firstBottomRK = i / 480;
    prevA = a;
    prevTh = th;
    const e = (energyTotal(s) - E0) / mgL;
    emin = Math.min(emin, e);
    emax = Math.max(emax, e);
    const wo = s.bodyVelocity(ob)!.w[2];
    const wi = s.bodyVelocity(bodies[0]!)!.w[2];
    if (Math.abs(wo) > 0.5 && Math.sign(wi * kOut) !== Math.sign(wo)) reversals++;
    maxW = Math.max(maxW, maxGearOmega(s));
  }
  const ph = Math.max(...s.meshes.map((m) => m.maxE / PITCH));
  const wAn = Math.sqrt((2 * mgL) / Ieff) / Math.abs(kOut);
  out(
    `drop ${name} arm ${arm} mu ${mu} k ${k}${guard ? '' : ' GUARD OFF'}: max ω ${f(maxW, 1)} rad/s (analytic input at bottom ${f(wAn, 1)}) = ${f((maxW * s.h), 3)} rad/world-step | (E−E0)/mgL [${f(emin, 3)}, ${f(emax, 3)}] | θ−θRK4 @0.2s ${f(err02, 4)} rad | first bottom ${f(firstBottom, 4)} vs RK4 ${f(firstBottomRK, 4)} s | phase max ${f(ph, 3)} teeth | reversed steps ${reversals} | guardRemoved/mgL ${f(s.guardRemoved / mgL, 2)}`,
  );
  if (k === 1) out(`   rot/step hist: ${hist.str()}; >0.1: ${f(100 * hist.frac(0.1), 1)}%`);
  s.dispose();
}

async function yank(name: string, arm: number, mu: number, k: number) {
  const { M, s, bodies } = await build(name, arm, mu, k);
  const last = bodies.length - 1;
  const ob = bodies[last]!;
  const ox = M.cols[last]!.x;
  const z = M.cols[last]!.col.length + 1;
  const tip: [number, number, number] = [ox + arm, 0, z];
  const hist = new RotHist();
  hist.attach(s);
  s.grab(ob, tip);
  s.dragTo([tip[0], tip[1] + 8, tip[2]]);
  let maxW = 0;
  for (let i = 1; i <= 240; i++) {
    s.stepFixed(1);
    maxW = Math.max(maxW, maxGearOmega(s));
  }
  const gp = s.grabPoint()!;
  const ph = Math.max(...s.meshes.map((m) => m.maxE / PITCH));
  out(`yank ${name} arm ${arm} mu ${mu} k ${k}: max ω ${f(maxW, 1)} rad/s = ${f(maxW * s.h, 3)} rad/world-step | tip rose ${f(gp[1] - tip[1], 2)} of 8 | phase max ${f(ph, 3)} teeth | engaged ${s.meshJointCount()}`);
  if (k === 1) out(`   rot/step hist: ${hist.str()}; >0.1: ${f(100 * hist.frac(0.1), 1)}%`);
  s.dispose();
}

async function spin(name: string, arm: number, mu: number, k: number, rev: number) {
  const { M, s, bodies } = await build(name, arm, mu, k);
  const ib = bodies[0]!;
  const r = M.cols[0]!.col[0]!;
  const hist = new RotHist();
  hist.attach(s);
  const pt: [number, number, number] = [0, r, 1];
  s.grab(ib, pt);
  const ai = new Angle(s, ib);
  const a0 = ai.get();
  let maxW = 0;
  const n = 480;
  for (let i = 1; i <= n; i++) {
    const th = Math.PI / 2 + 2 * Math.PI * rev * (i / 480);
    s.dragTo([r * Math.cos(th), r * Math.sin(th), 1]);
    s.stepFixed(1);
    maxW = Math.max(maxW, maxGearOmega(s));
  }
  const ph = Math.max(...s.meshes.map((m) => m.maxE / PITCH));
  out(`spin ${name} arm ${arm} mu ${mu} k ${k} ${rev} rev/s: input turned ${f((ai.get() - a0) / (2 * Math.PI), 2)} rev of ${rev} | max ω ${f(maxW, 1)} = ${f(maxW * s.h, 3)} rad/world-step | phase max ${f(ph, 3)} teeth`);
  s.dispose();
}

for (const name of models.split(','))
  for (const arm of arms.split(',').map(Number))
    for (const mu of mus.split(',').map(Number))
      for (const k of ks.split(',').map(Number)) {
        if (scen === 'drop') await drop(name, arm, mu, k, extra !== 'noguard');
        if (scen === 'yank') await yank(name, arm, mu, k);
        if (scen === 'spin') await spin(name, arm, mu, k, Number(extra || 3));
      }
process.exit(0);
