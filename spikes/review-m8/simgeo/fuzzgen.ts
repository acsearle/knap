// Random valid gear models for the physics fuzz (moved out of fuzz.test.ts so it can be imported).
import {
  GEAR_RADII, addCell, addPart, canAddCell, canSetGear, emptyModel, gearPlaneBasis, isHole, makeCell, setGear, setRoot, validateModel,
} from '../../../src/core';
import type { Axis, Kind, Model } from '../../../src/core';
import { rng } from '../../review-m7/kgen';

export function gearModel(seed: number): Model {
  const r = rng(seed * 104729 + 13);
  const pick = <T,>(a: readonly T[]): T => a[Math.floor(r() * a.length)]!;
  const rnd = (n: number) => Math.floor(r() * (2 * n + 1)) - n;
  let m = emptyModel();
  const KINDS: Kind[] = ['pinHole', 'pinHole', 'pinHole', 'axleHole', 'axle', 'pin', 'pin', 'frictionPin'];
  for (let step = 0; step < 60; step++) {
    const op = m.parts.length === 0 ? 0 : Math.floor(r() * 10);
    const part = m.parts.length ? pick(m.parts) : null;
    if (op <= 4) {
      const kind = pick(KINDS);
      let pos: [number, number, number] = [rnd(3), rnd(3), rnd(2)];
      if (part && r() < 0.8) {
        const from = pick(part.cells);
        pos = [from.x + rnd(1), from.y + rnd(1), from.z + rnd(1)];
      }
      const axis = r() < 0.6 ? 2 : pick([0, 1, 2] as Axis[]);
      const cell = makeCell(pos[0], pos[1], pos[2], kind, axis);
      const target = part && r() < 0.6 ? part.id : null;
      if (canAddCell(m, target, cell).ok) m = target === null ? addPart(m, [cell]).model : addCell(m, target, cell);
    } else if (op <= 6) {
      const c = pick(part!.cells);
      if (!isHole(c.kind)) continue;
      const g = pick(GEAR_RADII);
      if (canSetGear(m, part!.id, [c.x, c.y, c.z], g).ok) m = setGear(m, part!.id, [c.x, c.y, c.z], g);
    } else {
      const gs = m.parts.flatMap((p) => p.cells.filter((c) => c.teeth));
      if (!gs.length) continue;
      const g0 = pick(gs);
      const r2 = pick(GEAR_RADII);
      const s = g0.rim! + r2;
      if (s !== Math.round(s)) continue;
      const [u, v] = gearPlaneBasis(g0.axis);
      const q: [number, number, number] = [g0.x, g0.y, g0.z];
      q[r() < 0.5 ? u : v] += r() < 0.5 ? s : -s;
      const cell = makeCell(q[0], q[1], q[2], pick(['pinHole', 'axleHole'] as Kind[]), g0.axis, r2, true);
      // a gear with a pin into the next layer so it has a chance to be jointed to something
      if (canAddCell(m, null, cell).ok) {
        const res = addPart(m, [cell]);
        m = res.model;
      }
    }
  }
  if (m.parts.length) m = setRoot(m, pick(m.parts).id);
  if (validateModel(m).length) throw new Error('generator produced invalid model');
  return m;
}

