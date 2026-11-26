// Whole-model cost with N gears (r 1.5, T 24) spinning on revolutes at 5 rad/s, one 3-hole pawl
// clicking on gear 0, and a fixed 2N·3-long beam hovering 0.03 above all tooth tips (an ordinary
// part near every gear; with the "teeth only meet pawls" groups it never touches teeth).
//   sh spikes/teeth2/run.sh costN [rounds=5] [steps=100]
import { RAPIER, gear, gearDescs, partDescs, pawlParts, mkPart, makeWorld, fixed, body, revZ, vmotor, cpu, median, fmt, contactStats, G_PAWL, G_PART, grp, BIT } from './lib';
import type { Rep } from './lib';

await RAPIER.init();
const ROUNDS = Number(process.argv[2] ?? 5), STEPS = Number(process.argv[3] ?? 100);
const g = gear(1.5);
type V = { name: string; rep0: Rep; repN: Rep; group?: number };
const V: V[] = [
  { name: 'no teeth anywhere (smooth discs only)', rep0: 'none', repN: 'none' },
  { name: 'teeth (hull) on gear 0 only', rep0: 'hull', repN: 'none' },
  { name: 'teeth (hull) on all gears', rep0: 'hull', repN: 'hull' },
  { name: 'teeth (compound) on all gears', rep0: 'compound', repN: 'compound' },
  { name: 'teeth (hull) on all, teeth meet every part', rep0: 'hull', repN: 'hull', group: grp(BIT.TOOTH, 0xffff) },
];
function build(N: number, v: V) {
  const w = makeWorld();
  const f = fixed(w);
  for (let i = 0; i < N; i++) {
    const x = 3 * i;
    const gb = body(w, [x, 0, 0], 0, gearDescs(g, { rep: i === 0 ? v.rep0 : v.repN, smooth: true, toothGroup: v.group }));
    vmotor(w, revZ(w, f, gb, [x, 0, 0]), 5, 1e6);
  }
  const Y = Math.ceil(g.tip + 0.47);
  const pb = body(w, [2, Y, 0], Math.PI, partDescs(pawlParts('end', 2).parts, [0, 0, 0], G_PAWL));
  revZ(w, f, pb, [2, Y, 0]);
  // hovering beam on the fixed body, in front of the gears (layer z = 1 would not be near): place it
  // in the gear layer below the gears, 0.03 under the tip circles
  const n = 3 * N + 2;
  const cells = Array.from({ length: n }, (_, k) => ({ x: k - 1, y: 0, z: 0, kind: 'pinHole', axis: 2 }) as any);
  const yb = -(g.tip + 0.46 + 0.03);
  for (const d of partDescs([mkPart(cells)], [0, -yb, 0], G_PART)) w.createCollider(d, f);
  return w;
}
console.log(`load ${(await import('node:os')).loadavg().map((x) => x.toFixed(0)).join(' ')}`);
for (const N of [2, 10, 40]) {
  const worlds = V.map((v) => build(N, v));
  for (const w of worlds) for (let i = 0; i < 240; i++) w.step();
  const t: number[][] = V.map(() => []);
  for (let k = 0; k < ROUNDS; k++)
    worlds.forEach((w, i) => {
      const t0 = cpu();
      for (let s = 0; s < STEPS; s++) w.step();
      t[i]!.push((cpu() - t0) / STEPS);
    });
  const b = median(t[0]!);
  worlds.forEach((w, i) => {
    let nc = 0;
    w.colliders.forEach(() => nc++);
    const cs = contactStats(w);
    console.log(`N ${String(N).padStart(2)}  ${V[i]!.name.padEnd(44)} colliders ${String(nc).padStart(5)}  cpu ms/step ${fmt(median(t[i]!))} (x${fmt(median(t[i]!) / b)})  contact pairs ${cs.pairs} points ${cs.points}`);
    w.free();
  });
}
process.exit(0);
