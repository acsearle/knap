// Physics fuzz: random valid gear models (random edits as in tests/core/gears.fuzz.test.ts, only
// the accepted ones kept, plus gears placed at mesh distance), each simulated 5 s with and without
// ground (and free root on half the ground runs). No throw, no NaN, energy bounded, no fast part.
import { it } from 'vitest';
import { appendFileSync, writeFileSync } from 'node:fs';
import {
  GEAR_RADII, addCell, addPart, canAddCell, canSetGear, emptyModel, gearMeshes, gearPlaneBasis, isHole, makeCell, setFixRoot, setGear, setGround, setRoot, usesGears, validateModel,
} from '../../../src/core';
import type { Axis, Kind, Model } from '../../../src/core';
import { G, Simulation } from '../../../src/physics/sim';
import { rng } from '../../review-m7/kgen';
import { allFinite, energyOf, maxV } from './lib';
import { gearModel } from './fuzzgen';

const OUT = `spikes/review-m8/simgeo/fuzz-${process.env.FUZZ_PART ?? 0}.out`;
const log = (s: string) => appendFileSync(OUT, s + '\n');

it('300+ random gear models × (no ground, ground, ground + free root), 5 s each', async () => {
  writeFileSync(OUT, '');
  let models = 0;
  let meshes = 0;
  let engagedRuns = 0;
  let worstRise = 0;
  let worstV = 0;
  let worstW = 0;
  const fails: string[] = [];
  const t0 = Date.now();
  const P = Number(process.env.FUZZ_PART ?? 0);
  const NP = Number(process.env.FUZZ_PARTS ?? 1);
  for (let seed = 1; models < Number(process.env.FUZZ_N ?? 320); seed++) {
    if (seed % NP !== P) continue;
    const base = gearModel(seed);
    if (!usesGears(base)) continue;
    models++;
    meshes += gearMeshes(base).length;
    for (const [label, m] of [
      ['plain', base],
      ['ground', setGround(base, true)],
      ['free', setFixRoot(setGround(base, true), false)],
    ] as [string, Model][]) {
      let s: Simulation;
      try {
        s = await Simulation.create(m, { jointFriction: [0, 0.05, 0.2][seed % 3] });
      } catch (e) {
        fails.push(`seed ${seed} ${label} create threw ${(e as Error).message}`);
        continue;
      }
      let mass = 0;
      for (const b of s.graph.bodies) if (!b.fixed) mass += s.massInfo(b.id)?.mass ?? 0;
      const scale = Math.max(1, mass * G); // energy of lifting the whole model 1 unit
      const E0 = energyOf(s);
      let rise = 0;
      let vmax = 0;
      let wmax = 0;
      let engaged = false;
      let kmax = 1;
      let bad = '';
      try {
        for (let i = 0; i < 2400; i++) {
          s.stepFixed(1);
          if (s.meshStates().length) engaged = true;
          kmax = Math.max(kmax, s.substeps);
          if (i % 4 === 0) {
            if (!allFinite(s)) {
              bad = `non-finite at step ${i}`;
              break;
            }
            const alive = s.graph.bodies.filter((b) => s.hasBody(b.id)).length;
            if (alive === s.graph.bodies.length) rise = Math.max(rise, (energyOf(s) - E0) / scale); // a removal drops a body's (negative) energy
            const mv = maxV(s);
            if (label !== 'plain' || true) {
              vmax = Math.max(vmax, mv.v);
              wmax = Math.max(wmax, mv.w);
            }
          }
        }
      } catch (e) {
        bad = `threw ${(e as Error).message}`;
      }
      if (engaged) engagedRuns++;
      // in 'plain' a loose part free-falls (v = g t reaches 400 by 0.33 s), so speed only counts with a ground
      if (label !== 'plain') {
        worstV = Math.max(worstV, vmax);
        worstW = Math.max(worstW, wmax);
      }
      worstRise = Math.max(worstRise, rise);
      const line = `seed ${seed} ${label}: meshes ${gearMeshes(m).length} engaged ${engaged} kmax ${kmax} rise ${rise.toFixed(4)} vmax ${vmax.toFixed(1)} wmax ${wmax.toFixed(1)} ${bad}`;
      log(line);
      if (bad || rise > 0.05 || (label !== 'plain' && (vmax > 250 || wmax > 330))) fails.push(line + ' ' + JSON.stringify(m));
      s.dispose();
    }
  }
  const summary = `models ${models}, built meshes ${meshes}, runs with an engaged mesh ${engagedRuns}, worst energy rise ${worstRise.toFixed(4)} m·g·1, worst v ${worstV.toFixed(1)}, worst ω ${worstW.toFixed(1)} (ground runs), ${((Date.now() - t0) / 1000).toFixed(0)} s, fails ${fails.length}`;
  log(summary);
  log(fails.join('\n'));
  console.log(summary);
});
