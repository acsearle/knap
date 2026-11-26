import { it } from 'vitest';
import { canSetRim, setRim, setFixRoot, setGround } from '../../../src/core/model';
import { analyze } from '../../../src/core/kinematics';
import { randomModel, rng } from '../../review-m7/kgen';
it('stats of the 200 bit-identity models', () => {
  let n = 0, rim = 0, ground = 0, free = 0, joints = 0, bodies = 0;
  for (let seed = 1; n < 200; seed++) {
    let m = randomModel(seed);
    const R = rng(seed * 31 + 7);
    const holes = m.parts.flatMap((p) => p.cells.filter((c) => c.kind === 'pinHole' || c.kind === 'axleHole').map((c) => ({ p: p.id, c })));
    for (let i = 0; i < 3 && holes.length; i++) {
      const h = holes[Math.floor(R() * holes.length)]!;
      const r = [1, 1.5, 2, 2.5][Math.floor(R() * 4)]!;
      const pos: [number, number, number] = [h.c.x, h.c.y, h.c.z];
      if (canSetRim(m, h.p, pos, r).ok) m = setRim(m, h.p, pos, r);
    }
    const g = R() < 0.7; const f = R() < 0.5;
    m = setFixRoot(setGround(m, g), f);
    if (!m.parts.length) continue;
    n++;
    if (m.parts.some((p) => p.cells.some((c) => c.rim !== undefined))) rim++;
    if (m.ground) ground++;
    if (m.ground && m.fixRoot === false) free++;
    const a = analyze(m); joints += a.joints.length; bodies += a.bodies.length;
  }
  console.log(`STATS models ${n} with rim ${rim} ground ${ground} free-root-with-ground ${free} joints ${joints} bodies ${bodies}`);
});
