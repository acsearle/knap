// Bit-identity of the no-gear path: new src vs the sources at 2d3372a (spikes/review-m8/simgeo/base,
// extracted with git archive). Examples 1-9 at three friction levels, with a grab, and 200 random
// wheel / ground / free-root models; kinematics, colliders and ground plane compared too.
import { expect, it } from 'vitest';
import { Simulation as NewSim } from '../../../src/physics/sim';
import { Simulation as OldSim } from './base/src/physics/sim';
import { EXAMPLES, buildExample } from '../../../src/core/examples';
import { buildExample as buildOld } from './base/src/core/examples';
import { analyze } from '../../../src/core/kinematics';
import { analyze as analyzeOld } from './base/src/core/kinematics';
import { partColliders } from '../../../src/geometry/colliders';
import { partColliders as partCollidersOld } from './base/src/geometry/colliders';
import { groundPlane, partShapes } from '../../../src/physics/shapes';
import { groundPlane as groundPlaneOld, partShapes as partShapesOld } from './base/src/physics/shapes';
import { canSetRim, setRim, setFixRoot, setGround } from '../../../src/core/model';
import { randomModel, rng } from '../../review-m7/kgen';
import { trajHash } from '../../gearphys/hashlib';
import type { Model } from '../../../src/core/types';

const gjson = (g: unknown) => JSON.stringify(g, (_k, v) => (v instanceof Map ? [...v.entries()] : v instanceof Set ? [...v] : v));

function wheelModel(seed: number): Model {
  let m = randomModel(seed);
  const R = rng(seed * 31 + 7);
  const holes = m.parts.flatMap((p) => p.cells.filter((c) => c.kind === 'pinHole' || c.kind === 'axleHole').map((c) => ({ p: p.id, c })));
  for (let i = 0; i < 3 && holes.length; i++) {
    const h = holes[Math.floor(R() * holes.length)]!;
    const r = [1, 1.5, 2, 2.5][Math.floor(R() * 4)]!;
    const pos: [number, number, number] = [h.c.x, h.c.y, h.c.z];
    if (canSetRim(m, h.p, pos, r).ok) m = setRim(m, h.p, pos, r);
  }
  const g = R() < 0.7;
  const f = R() < 0.5;
  return setFixRoot(setGround(m, g), f);
}

it('examples 1-9 at friction 0 / 0.05 / 0.2 and with a grab: identical hashes', async () => {
  const names = EXAMPLES.map((e) => e.name).filter((n) => n !== 'gear-train');
  const rows: string[] = [];
  for (const name of names)
    for (const mu of [0, 0.05, 0.2]) {
      const mN = buildExample(name);
      const mO = buildOld(name);
      expect(JSON.stringify(mN), name).toBe(JSON.stringify(mO));
      const a = await NewSim.create(mN, { jointFriction: mu });
      const b = await OldSim.create(mO as never, { jointFriction: mu });
      const ha = trajHash(a, 2400, 10);
      const hb = trajHash(b as never, 2400, 10);
      rows.push(`${name}@${mu} new ${ha} old ${hb}`);
      expect(ha, `${name}@${mu}`).toBe(hb);
      // grab + drag on the last dynamic body
      const dyn = a.graph.bodies.filter((x) => !x.fixed && a.hasBody(x.id));
      if (dyn.length) {
        const id = dyn[dyn.length - 1]!.id;
        const p = a.bodyTransform(id)!.p;
        const ok1 = a.grab(id, [p[0], p[1], p[2]]);
        const ok2 = b.grab(id, [p[0], p[1], p[2]]);
        expect(ok1).toBe(ok2);
        a.dragTo([p[0] + 3, p[1] + 5, p[2]]);
        b.dragTo([p[0] + 3, p[1] + 5, p[2]]);
        const ga = trajHash(a, 480, 5);
        const gb = trajHash(b as never, 480, 5);
        a.release();
        b.release();
        expect(ga, `${name}@${mu} grab`).toBe(gb);
        expect(trajHash(a, 480, 5), `${name}@${mu} after release`).toBe(trajHash(b as never, 480, 5));
      }
      a.dispose();
      b.dispose();
    }
  console.log(rows.join('\n'));
});

it('200 random wheel / ground / free-root models: identical hashes, kinematics, colliders, shapes, ground plane', async () => {
  let n = 0;
  let withRim = 0;
  let withGround = 0;
  let free = 0;
  for (let seed = 1; n < 200; seed++) {
    const m = wheelModel(seed);
    if (m.parts.length === 0) continue;
    n++;
    if (m.parts.some((p) => p.cells.some((c) => c.rim !== undefined))) withRim++;
    if (m.ground) withGround++;
    if (m.fixRoot === false) free++;
    expect(gjson(analyze(m)), `seed ${seed}`).toBe(gjson(analyzeOld(m as never)));
    for (const p of m.parts) {
      expect(JSON.stringify(partColliders(p)), `seed ${seed} part ${p.id}`).toBe(JSON.stringify(partCollidersOld(p as never)));
      expect(JSON.stringify(partShapes(p, 16)), `seed ${seed} part ${p.id} shapes`).toBe(JSON.stringify(partShapesOld(p as never, 16)));
    }
    expect(JSON.stringify(groundPlane(m)), `seed ${seed}`).toBe(JSON.stringify(groundPlaneOld(m as never)));
    const mu = [0, 0.05, 0.2][seed % 3]!;
    const a = await NewSim.create(m, { jointFriction: mu });
    const b = await OldSim.create(m as never, { jointFriction: mu });
    const ha = trajHash(a, 960, 8);
    const hb = trajHash(b as never, 960, 8);
    expect(ha, `seed ${seed} ${JSON.stringify(m)}`).toBe(hb);
    a.dispose();
    b.dispose();
  }
  console.log(`random models: ${n}, with rim ${withRim}, ground ${withGround}, free root ${free}`);
});
