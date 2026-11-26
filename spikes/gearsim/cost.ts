// Q7 cost: idler chains of N gears r 1 (N − 1 meshes) driven at ~10 rad/s, with meshes (gears on)
// against the same model with gears off (same bodies and revolutes, no mesh rows), interleaved;
// and the substep knob's cost (k 1 / 2 / 4) on the 1:25 crane falling. ms per simulated second.
import { Simulation, crane, f, now, out, train } from './lib';

const reps = Number(process.argv[2] ?? 3);

async function chainRun(N: number, gears: boolean, k = 1): Promise<number> {
  const t = train(Array.from({ length: N }, (_, i) => ({ x: 2 * i, col: [1] })));
  const s = await Simulation.create(t.model, { gears, substeps: k });
  const b0 = s.bodyOf(t.parts[0]!)!;
  const I = s.massInfo(b0)!.inertia[8]!;
  let last = NaN;
  for (let i = 0; i < 48; i++) s.stepFixed(1); // warm-up
  const t0 = now();
  for (let i = 0; i < 480; i++) {
    const w = s.bodyVelocity(b0)!.w[2];
    const tau = Math.max(-2e4, Math.min(2e4, I * N * (10 - w) * 480));
    if (tau !== last) {
      s.setDrive(b0, [0, 0, tau]);
      last = tau;
    }
    s.stepFixed(1);
  }
  const ms = now() - t0;
  s.dispose();
  return ms;
}

async function craneRun(k: number): Promise<number> {
  const M = crane('1:25', 7);
  const t = train(M.cols);
  const s = await Simulation.create(t.model, { jointFriction: 0, substeps: k });
  const t0 = now();
  for (let i = 0; i < 480; i++) s.stepFixed(1);
  const ms = now() - t0;
  s.dispose();
  return ms;
}

for (const N of [2, 5, 11]) {
  const on: number[] = [];
  const off: number[] = [];
  for (let r = 0; r < reps; r++) {
    off.push(await chainRun(N, false));
    on.push(await chainRun(N, true));
  }
  const mOn = Math.min(...on);
  const mOff = Math.min(...off);
  out(`chain N ${N}: gears off ${off.map((x) => f(x, 0)).join('/')} ms, on ${on.map((x) => f(x, 0)).join('/')} ms per sim s | min ratio on/off ${f(mOn / mOff, 3)} | per mesh +${f((mOn - mOff) / (N - 1), 1)} ms/sim s | per body (off) ${f(mOff / N, 1)} ms/sim s`);
}
{
  const ks = [1, 2, 4];
  const res: number[][] = ks.map(() => []);
  for (let r = 0; r < reps; r++) for (let i = 0; i < ks.length; i++) res[i]!.push(await craneRun(ks[i]!));
  const base = Math.min(...res[0]!);
  out(`crane 1:25 arm 7 falling, μ 0: ${ks.map((k, i) => `k ${k}: ${res[i]!.map((x) => f(x, 0)).join('/')} ms (min ×${f(Math.min(...res[i]!) / base, 2)})`).join(' | ')}`);
}
process.exit(0);
