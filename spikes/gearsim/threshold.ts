// Q1 static balance with friction: an arm on the output of 1:5 / 1:25 / 1:125, held horizontal at
// the start; a constant input torque at fractions of the analytic fall / lift thresholds.
// Usage: sh spikes/gearsim/run.sh threshold [models=1:5,1:25,1:125] [mus=0,0.05,0.2] [ks=1] [arm=7] [secs=1.5]
import { Angle, G, Simulation, crane, f, out, phaseTeeth, train } from './lib';

async function run(name: string, mu: number, k: number, arm: number, secs: number) {
  const M = crane(name, arm);
  const t = train(M.cols);
  const probe = await Simulation.create(t.model, { jointFriction: mu, substeps: k });
  const bodies = t.parts.map((p) => probe.bodyOf(p)!);
  const last = bodies.length - 1;
  const ob = bodies[last]!;
  const ox = M.cols[last]!.x;
  const mi = probe.massInfo(ob)!;
  const tauOut = mi.mass * G * (mi.com[0] - ox); // gravity torque magnitude about −z (arm along +x falls clockwise)
  const js = probe.jointStates();
  const tf = bodies.map((b) => js.find((j) => j.bodyA === b || j.bodyB === b)!.frictionTorque);
  const kOut = M.ratios[last]!;
  // Torque at the input that balances the arm: τ_in·k_out⁻¹... power balance τ_in ω_in = τ_out ω_out → τ_in = τ_out·|k_out|.
  const bal = tauOut * Math.abs(kOut);
  const tfIn = tf.reduce((s, x, i) => s + Math.abs(M.ratios[i]!) * x, 0); // all pivot friction reflected to the input
  const fall = bal - tfIn;
  const lift = bal + tfIn;
  probe.dispose();
  // Sign: the arm falling turns the output by −z; the input then turns by −z/k_out·… use sign of k_out.
  const sgn = Math.sign(kOut); // input torque direction that lifts the arm (arm along +x falls toward −z)
  const cases: [string, number][] = [
    ['0', 0],
    ['0.97·fall', 0.97 * fall],
    ['1.03·fall', 1.03 * fall],
    ['bal', bal],
    ['0.97·lift', 0.97 * lift],
    ['1.03·lift', 1.03 * lift],
  ];
  const res: string[] = [];
  for (const [lab, tau] of cases) {
    if (tau < 0) {
      res.push(`${lab}=n/a`);
      continue;
    }
    const s = await Simulation.create(t.model, { jointFriction: mu, substeps: k });
    if (tau) s.setDrive(s.bodyOf(t.parts[0]!)!, [0, 0, sgn * tau]);
    const ang = new Angle(s, ob);
    const a0 = ang.get();
    const n = Math.round(secs * 480);
    let creepLate = 0;
    let aMid = 0;
    for (let i = 1; i <= n; i++) {
      s.stepFixed(1);
      const a = ang.get();
      if (i === Math.round(n / 3)) aMid = a;
      if (i > n / 3) creepLate = Math.max(creepLate, Math.abs(a - aMid));
    }
    const d = ang.get() - a0;
    const st = Math.abs(d) < 1e-3 ? 'held' : d > 0 ? 'LIFTS' : 'FALLS';
    res.push(`${lab}: ${st} ${f(d, 5)} (late creep ${f(creepLate)}) ph ${f(phaseTeeth(s).max)}`);
    s.dispose();
  }
  const expect = ['falls', fall > 0 ? 'falls' : 'held', 'held', 'held', 'held', 'lifts'];
  out(`${name} arm ${arm} mu ${mu} k ${k}: τ_out ${f(tauOut, 1)} bal_in ${f(bal, 2)} τf_in ${f(tfIn, 2)} fall<${f(fall, 2)} lift>${f(lift, 2)}  expect ${expect.join('/')}`);
  for (const r of res) out('   ' + r);
}

const [models = '1:5,1:25,1:125', mus = '0,0.05,0.2', ks = '1', arm = '7', secs = '1.5'] = process.argv.slice(2);
for (const name of models.split(','))
  for (const mu of mus.split(',').map(Number)) for (const k of ks.split(',').map(Number)) await run(name, mu, k, Number(arm), Number(secs));
process.exit(0);
