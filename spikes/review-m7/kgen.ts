// Random small valid models for the kinematics fuzz (reviewer "verify-sim", item 5).
import { addPart, emptyModel, makeCell, setFixRoot, setGround, setRoot, validateModel } from '../../src/core/model';
import type { Axis, Cell, Kind, Model } from '../../src/core/types';

export function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Beams (pin/axle holes, axis Z) in layers z = 0..2 on a 5×5 grid, then rods along Z (pin, axle,
 * friction pin, 1–3 long) dropped into hole columns, sometimes a rod along X/Y through a beam's
 * side. `beamsOnly` → only pin holes and smooth pins (revolute mates only).
 */
export function randomModel(seed: number, beamsOnly = false): Model {
  const R = rng(seed);
  const ri = (n: number) => Math.floor(R() * n);
  let m = emptyModel();
  const nBeams = 2 + ri(4);
  const tryAdd = (cells: Cell[]): number | null => {
    try {
      const r = addPart(m, cells);
      if (validateModel(r.model).length) return null;
      m = r.model;
      return r.partId;
    } catch {
      return null;
    }
  };
  for (let i = 0; i < nBeams * 3; i++) {
    if (m.parts.length >= nBeams) break;
    const z = ri(3);
    const x0 = ri(5);
    const y0 = ri(5);
    const len = 1 + ri(4);
    const dir = ri(2);
    const kind: Kind = beamsOnly || R() < 0.8 ? 'pinHole' : 'axleHole';
    const cells: Cell[] = [];
    for (let k = 0; k < len; k++) cells.push(makeCell(x0 + (dir === 0 ? k : 0), y0 + (dir === 1 ? k : 0), z, R() < 0.85 ? kind : beamsOnly ? 'pinHole' : 'axleHole', 2));
    tryAdd(cells);
  }
  const holes = m.parts.flatMap((p) => p.cells);
  const nRods = 1 + ri(5);
  for (let i = 0; i < nRods * 4 && holes.length; i++) {
    if (m.parts.length >= nBeams + nRods) break;
    const h = holes[ri(holes.length)]!;
    const len = 1 + ri(3);
    const z0 = h.z - ri(len);
    const kinds: Kind[] = beamsOnly ? ['pin'] : ['pin', 'pin', 'axle', 'frictionPin'];
    const kind = kinds[ri(kinds.length)]!;
    const cells: Cell[] = [];
    for (let k = 0; k < len; k++) cells.push(makeCell(h.x, h.y, z0 + k, kind, 2 as Axis));
    tryAdd(cells);
  }
  const ids = m.parts.map((p) => p.id);
  if (ids.length && R() < 0.9) m = setRoot(m, ids[ri(ids.length)]!);
  return m;
}

/** All four ground × fixRoot variants of a model. */
export function variants(m: Model): { label: string; m: Model }[] {
  const out: { label: string; m: Model }[] = [];
  for (const g of [false, true])
    for (const f of [true, false]) out.push({ label: `ground ${g} fixRoot ${f}`, m: setFixRoot(setGround(m, g), f) });
  return out;
}
