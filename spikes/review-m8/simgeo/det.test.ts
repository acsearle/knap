import { it } from 'vitest';
import { setFixRoot, setGround, usesGears } from '../../../src/core';
import { Simulation } from '../../../src/physics/sim';
import { trajHash } from '../../gearphys/hashlib';
import { gearModel } from './fuzzgen';
it('determinism of 12 fuzz models with ground and free root (k changes included)', async () => {
  let n = 0, same = 0, withK = 0;
  for (let seed = 1; n < 12; seed++) {
    const m0 = gearModel(seed);
    if (!usesGears(m0)) continue;
    n++;
    const m = setFixRoot(setGround(m0, true), seed % 2 === 0);
    const hs: string[] = [];
    let kc = 0;
    for (let r = 0; r < 2; r++) {
      const s = await Simulation.create(m);
      hs.push(trajHash(s, 1440, 4));
      kc = Math.max(kc, s.worldSteps - 1440);
      s.dispose();
    }
    if (hs[0] === hs[1]) same++;
    if (kc > 0) withK++;
  }
  console.log(`DET ${same}/${n} identical, ${withK} used k > 1`);
});
