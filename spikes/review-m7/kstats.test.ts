// Coverage of the kinematics generator (how often the changed branch is exercised).
import { it } from 'vitest';
import { analyze } from '../../src/core/kinematics';
import { effectiveRootId } from '../../src/core/model';
import { randomModel } from './kgen';
import { logger } from './lib';
const log = logger('kstats');
it('generator coverage', () => {
  let rootPin = 0, multi = 0, joints = 0, cyl = 0, pris = 0, n = 0;
  for (let seed = 1; seed <= 20000; seed++) {
    const m = randomModel(seed, seed % 2 === 0);
    n++;
    const r = effectiveRootId(m);
    const rp = m.parts.find((p) => p.id === r);
    const g = analyze(m);
    if (rp && rp.cells.every((c) => c.kind === 'pin') && g.bodies[g.bodyOfPart.get(r!)!]!.partIds.length === 1 && g.mates.some((x) => x.malePart === r)) rootPin++;
    if (g.bodies.length > 1) multi++;
    joints += g.joints.length;
    cyl += g.joints.filter((j) => j.type === 'cylindrical').length;
    pris += g.joints.filter((j) => j.type === 'prismatic').length;
  }
  log(`${n} models: root is a lone smooth pin with mates (fixed root) ${rootPin}; >1 body ${multi}; joints ${joints} (cylindrical ${cyl}, prismatic ${pris})`);
});
