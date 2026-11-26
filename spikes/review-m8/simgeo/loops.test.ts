// Gear loops: four 16s in a square (consistent, must turn) and the locked train (inconsistent, must
// hold); plus gears built one unit too far apart (must never engage).
import { it } from 'vitest';
import { appendFileSync } from 'node:fs';
import { ModelBuilder } from '../../../src/core/examples';
import { makeCell } from '../../../src/core/model';
import type { Cell } from '../../../src/core/types';
import { Simulation } from '../../../src/physics/sim';
import { lockedTrain } from '../../../tests/physics/gearModels';
import { Twist, energyOf, finish, maxV, pinAt } from './lib';

const OUT = 'spikes/review-m8/simgeo/loops.out';
const log = (s: string) => {
  console.log(s);
  appendFileSync(OUT, s + '\n');
};

it('square loop of four 16s with an arm on one: turns, ratios hold, energy bounded', async () => {
  for (const mu of [0, 0.2]) {
    const b = new ModelBuilder();
    const ring: Cell[] = [];
    for (const [x, y] of [[0, 0], [1, 0], [2, 0], [2, 1], [2, 2], [1, 2], [0, 2], [0, 1]]) ring.push(makeCell(x!, y!, -1, 'pinHole', 2));
    const frame = b.add(ring);
    const ids: number[] = [];
    const gears: [number, [number, number, number], number][] = [];
    for (const [i, [x, y]] of ([[0, 0], [2, 0], [2, 2], [0, 2]] as [number, number][]).entries()) {
      const cells: Cell[] = [makeCell(x, y, 0, 'pinHole', 2), makeCell(x, y, 1, 'pinHole', 2)];
      if (i === 0) for (let k = 0; k <= 4; k++) cells.push(makeCell(x - k, y, 2, 'pinHole', 2));
      const id = b.add(cells);
      pinAt(b, 2, x, y, -1, 0);
      ids.push(id);
      gears.push([id, [x, y, 1], 1]);
    }
    const m = finish(b, frame, gears);
    const s = await Simulation.create(m, { jointFriction: mu });
    const tw = ids.map((id) => new Twist(s, s.bodyOf(id)!, [0, 0, 1]));
    tw.forEach((t) => t.get());
    const E0 = energyOf(s);
    let eMax = E0;
    let phase = 0;
    let jerr = 0;
    let range = 0;
    for (let i = 0; i < 480 * 10; i++) {
      s.stepFixed(1);
      const th = tw.map((t) => t.get());
      range = Math.max(range, Math.abs(th[0]!));
      eMax = Math.max(eMax, energyOf(s));
      for (const st of s.meshStates()) phase = Math.max(phase, Math.abs(st.phaseErrorTeeth));
      jerr = Math.max(jerr, s.jointError());
    }
    const th = tw.map((t) => t.get());
    log(`square loop μ ${mu}: engaged ${s.meshStates().length}/4 pairs, arm swing range ${range.toFixed(3)} rad, θ ${th.map((x) => x.toFixed(4)).join('/')}, E max − E0 ${(eMax - E0).toExponential(2)} (E0 ${E0.toFixed(1)}), phase max ${phase.toExponential(2)}, joint err ${jerr.toExponential(2)}, |ω| end ${maxV(s).w.toExponential(2)}`);
    s.dispose();
  }
});

it('locked train: holds still at every friction level, under a kick and a drive', async () => {
  for (const mu of [0, 0.05, 0.2]) {
    const rig = lockedTrain(4);
    const s = await Simulation.create(rig.model, { jointFriction: mu });
    const P = s.bodyOf(rig.part.P!)!;
    const tw = new Twist(s, P, [0, 0, 1]);
    tw.get();
    const E0 = energyOf(s);
    let eMax = E0;
    let moved = 0;
    let jerr = 0;
    for (let i = 0; i < 480 * 10; i++) {
      s.stepFixed(1);
      moved = Math.max(moved, Math.abs(tw.get()));
      eMax = Math.max(eMax, energyOf(s));
      jerr = Math.max(jerr, s.jointError());
    }
    // kick: set ω 20 on P, see what happens over 2 s
    s.setBodyVelocity(P, [0, 0, 0], [0, 0, 20]);
    const E1 = energyOf(s);
    let eMax2 = E1;
    let moved2 = 0;
    const th0 = tw.get();
    let wmax = 0;
    for (let i = 0; i < 960; i++) {
      s.stepFixed(1);
      moved2 = Math.max(moved2, Math.abs(tw.get() - th0));
      eMax2 = Math.max(eMax2, energyOf(s));
      jerr = Math.max(jerr, s.jointError());
      wmax = Math.max(wmax, maxV(s).w);
    }
    log(`locked train μ ${mu}: 10 s at rest moved ${moved.toExponential(2)} rad, E max − E0 ${(eMax - E0).toExponential(2)}; after a 20 rad/s kick moved ${moved2.toExponential(2)} rad, max |ω| after ${wmax.toExponential(2)}, E max − E(kick) ${(eMax2 - E1).toExponential(2)}, joint err ${jerr.toExponential(2)}, k ${s.substeps}, releases ${s.meshDiagnostics().map((d) => d.releases).join(',')}`);
    s.dispose();
  }
});

it('a pair built one unit too far never engages, even swung together', async () => {
  // 16 and 16 at distance 3 (gap +1): A on a frame pin; B on an arm that could swing
  const b = new ModelBuilder();
  const frame = b.add([0, 1, 2, 3].map((x) => makeCell(x, 0, -1, 'pinHole', 2)));
  const A = b.add([makeCell(0, 0, 0, 'pinHole', 2), makeCell(0, 0, 1, 'pinHole', 2)]);
  pinAt(b, 2, 0, 0, -1, 0);
  const B = b.add([makeCell(3, 0, 0, 'pinHole', 2), makeCell(3, 0, 1, 'pinHole', 2)]);
  pinAt(b, 2, 3, 0, -1, 0);
  const m = finish(b, frame, [[A, [0, 0, 1], 1], [B, [3, 0, 1], 1]]);
  const s = await Simulation.create(m);
  s.setBodyVelocity(s.bodyOf(A)!, [0, 0, 0], [0, 0, 20]);
  for (let i = 0; i < 960; i++) s.stepFixed(1);
  const d = s.meshDiagnostics()[0]!;
  log(`16+16 at distance 3: engagements ${d.engagements}, gap ${d.gap.toFixed(4)}, B ω ${s.bodyVelocity(s.bodyOf(B)!)!.w[2]!.toExponential(2)}`);
  s.dispose();
});
