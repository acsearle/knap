// Energy, k bands and the speed cap: crane drops (1:5, 1:25, 1:125), geared pendulums and the Gear
// train example at Off / Low / Realistic; whirl and yank against the 300 rad/s cap.
import { it } from 'vitest';
import { appendFileSync, writeFileSync } from 'node:fs';
import { exampleByName } from '../../../src/core/examples';
import { G, GEAR_SPEED_CAP, Simulation } from '../../../src/physics/sim';
import type { Model } from '../../../src/core/types';
import { chain, compound, energyOf, maxV } from './lib';
import { compound25, gearPair } from '../../../tests/physics/gearModels';

const OUT = 'spikes/review-m8/simgeo/energy.out';
const log = (s: string) => {
  console.log(s);
  appendFileSync(OUT, s + '\n');
};

interface Run {
  label: string;
  model: Model;
  seconds: number;
}

async function measure(r: Run, mu: number) {
  const s = await Simulation.create(r.model, { jointFriction: mu });
  let mass = 0;
  for (const b of s.graph.bodies) if (!b.fixed) mass += s.massInfo(b.id)!.mass;
  const scale = mass * G; // m·g·1
  const E0 = energyOf(s);
  let lo = E0;
  let riseOverMin = 0; // largest E − (lowest E so far): energy gained after a loss
  let riseOverE0 = 0;
  let kMax = 1;
  let kChanges = 0;
  let kPrev = 1;
  const kHist = new Map<number, number>();
  let restAt = NaN;
  let wMax = 0;
  let maxRot = 0;
  const n = Math.round(r.seconds * 480);
  const sign = new Map<number, number>();
  let reversals = 0;
  for (let i = 1; i <= n; i++) {
    s.stepFixed(1);
    const k = s.substeps;
    kHist.set(k, (kHist.get(k) ?? 0) + 1);
    if (k !== kPrev) kChanges++;
    kPrev = k;
    kMax = Math.max(kMax, k);
    const E = energyOf(s);
    riseOverMin = Math.max(riseOverMin, E - lo);
    riseOverE0 = Math.max(riseOverE0, E - E0);
    lo = Math.min(lo, E);
    const mv = maxV(s);
    wMax = Math.max(wMax, mv.w);
    maxRot = Math.max(maxRot, (mv.w / 480) / k);
    if (Number.isNaN(restAt) && mv.w < 1e-3 && mv.v < 1e-3 && i > 10) restAt = i / 480;
    if (!Number.isNaN(restAt) && (mv.w > 1e-2)) restAt = NaN;
    for (const b of s.graph.bodies) {
      if (b.fixed) continue;
      const v = s.bodyVelocity(b.id);
      if (!v) continue;
      const w = v.w[0]! + v.w[1]! + v.w[2]!;
      if (Math.abs(w) < 0.05) continue;
      const sg = Math.sign(w);
      if (sign.has(b.id) && sign.get(b.id) !== sg && Math.abs(w) > 1) reversals++; // a fast reversal (> 1 rad/s) within one fixed step
      sign.set(b.id, sg);
    }
  }
  log(
    `${r.label} μ ${mu}: E rise over E0 ${(riseOverE0 / scale).toExponential(2)} mg·1, largest regain after a loss ${(riseOverMin / scale).toExponential(2)} mg·1 (band 1 % of kPeak), E end − E0 ${((energyOf(s) - E0) / scale).toFixed(2)} mg·1, k max ${kMax}, k changes ${kChanges}, k hist ${[...kHist].map(([k, c]) => `${k}:${c}`).join(' ')}, max |ω| ${wMax.toFixed(1)}, max rot/world step ${maxRot.toFixed(3)}, fast reversals ${reversals}, rest at ${restAt.toFixed(2)} s, k end ${s.substeps}, guard removed ${(s.guardRemoved / scale).toFixed(2)} mg·1, cap removed ${s.capRemoved.toFixed(1)}`,
  );
  s.dispose();
}

it('crane drops, geared pendulums and the Gear train example at Off / Low / Realistic', async () => {
  writeFileSync(OUT, '');
  const runs: Run[] = [
    { label: 'crane 1:5', model: gearPair(0.5, 2.5, { armB: 6 }).model, seconds: 30 },
    { label: 'crane 1:25', model: compound25(6).model, seconds: 30 },
    { label: 'crane 1:125 (compound N=3, arm 6)', model: compound(2, 3, 6).model, seconds: 30 },
    { label: 'geared pendulum 1:1', model: gearPair(1, 1, { armB: 4 }).model, seconds: 30 },
    { label: 'geared pendulum 3:1', model: gearPair(0.5, 1.5, { armB: 4 }).model, seconds: 30 },
    { label: 'geared pendulum 1:3 (arm on the 8)', model: chain(2, [1.5, 0.5], { arm: 4 }).model, seconds: 30 },
    { label: 'gear-train example', model: exampleByName('gear-train')!.build(), seconds: 30 },
  ];
  for (const r of runs) for (const mu of [0, 0.05, 0.2]) await measure(r, mu);
});

it('speed cap: a whirled 1:5 pair, a 1:25 input spun to 1000 rad/s, and a yank on 1:25', async () => {
  for (const [label, rig, inName, w0] of [
    ['1:5 pair, 8 set to 1000 rad/s', gearPair(0.5, 2.5), 'A', 1000],
    ['1:25, input set to 1000 rad/s', compound25(6), 'A', 1000],
  ] as const) {
    const s = await Simulation.create(rig.model, { jointFriction: 0 });
    const A = s.bodyOf(rig.part[inName]!)!;
    // consistent speeds through the train (an inconsistent kick is absorbed by the mesh at once)
    const ratios: Record<string, number> = { A: 1, B: -1 / 5, C: 1 / 25 };
    for (const [n, f] of Object.entries(ratios)) if (rig.part[n] !== undefined) s.setBodyVelocity(s.bodyOf(rig.part[n]!)!, [0, 0, 0], [0, 0, w0 * f]);
    void A;
    let wMax = 0;
    let wMaxAfter = 0;
    let phase = 0;
    let finite = true;
    for (let i = 1; i <= 960; i++) {
      s.stepFixed(1);
      const w = maxV(s).w;
      if (i === 1) wMax = w;
      else wMaxAfter = Math.max(wMaxAfter, w);
      for (const m of s.meshStates()) phase = Math.max(phase, Math.abs(m.phaseErrorTeeth));
      if (!Number.isFinite(w)) finite = false;
    }
    const d = s.meshDiagnostics();
    log(`${label}: max |ω| after step 1 ${wMax.toFixed(1)}, after ${wMaxAfter.toFixed(2)} (cap ${GEAR_SPEED_CAP}), phase max ${phase.toExponential(2)} teeth, engaged ${d.map((m) => m.engaged).join(',')}, releases ${d.map((m) => m.releases).join(',')}, cap removed ${s.capRemoved.toFixed(0)}, finite ${finite}`);
    s.dispose();
  }
  // yank: grab the arm tip of the 1:25 crane and jump the target 8 units up, and 30 units
  for (const jump of [8, 30]) {
    const rig = compound25(6);
    const s = await Simulation.create(rig.model);
    const C = s.bodyOf(rig.part.C!)!;
    s.grab(C, [12, 0, 3]);
    for (let i = 0; i < 144; i++) s.stepFixed(1);
    const p0 = s.grabPoint()!;
    s.dragTo([p0[0], p0[1] + jump, p0[2]]);
    let wMax = 0;
    let phase = 0;
    let kMax = 1;
    for (let i = 0; i < 960; i++) {
      s.stepFixed(1);
      wMax = Math.max(wMax, maxV(s).w);
      kMax = Math.max(kMax, s.substeps);
      for (const m of s.meshStates()) phase = Math.max(phase, Math.abs(m.phaseErrorTeeth));
    }
    const d = s.meshDiagnostics();
    log(`yank 1:25 by ${jump}: max |ω| ${wMax.toFixed(2)}, k max ${kMax}, phase max ${phase.toExponential(2)} teeth, releases ${d.map((m) => m.releases).join(',')}, cap removed ${s.capRemoved.toFixed(0)}, grab point end ${s.grabPoint()!.map((x) => x.toFixed(2)).join(',')}`);
    s.dispose();
  }
});
