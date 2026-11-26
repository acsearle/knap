// Shafts through gears and crank holes facing the partner (review m8, editor findings; DEVIATIONS
// "Gears"): §2.7 rule 1 judges another part's male by its rod (tipOverlapsRod) against a gear's tip
// disc, and a cell in the web of its own part's gear is that gear's body (like the hub). Removing,
// shrinking or un-gearing that gear must not leave a web cell inside another gear.
import { describe, expect, it } from 'vitest';
import {
  GEAR_RADII,
  ROD_HALF_WIDTH,
  canAddCell,
  canRemoveCell,
  canSetGear,
  canSetRim,
  components,
  gearMeshes,
  gearPlaneBasis,
  isHole,
  makeCell,
  movePart,
  removeCell,
  rotatePart,
  setGear,
  tipOverlapsRod,
  tipRadius,
  validateModel,
  webOffsets,
} from '../../src/core';
import type { Axis, CanResult, Cell, Kind, Model, Part, Vec3i } from '../../src/core';

const hole = (x: number, y: number, z: number, rim?: number, teeth?: boolean, kind: Kind = 'pinHole'): Cell => makeCell(x, y, z, kind, 2, rim, teeth);
const model = (parts: Cell[][]): Model =>
  ({ version: 3, rootPartId: 1, nextPartId: parts.length + 1, ground: false, fixRoot: true, parts: parts.map((cells, i) => ({ id: i + 1, color: '#a8adb2', cells })) }) as Model;
const reason = (r: CanResult) => (r.ok ? 'ok' : r.reason);

describe('tipOverlapsRod (exact, units of 1/32)', () => {
  it('a rod ∥ the gear axis is a circle of radius ROD_HALF_WIDTH; touching is clear', () => {
    expect(ROD_HALF_WIDTH).toBe(5 / 16);
    // 8 + rod: r_t + w = 19/32 + 10/32 = 29/32 < 1
    expect(tipOverlapsRod([0, 0, 0], 2, 0.5, [1, 0, 0], 2)).toBe(false);
    expect(tipOverlapsRod([0, 0, 0], 2, 0.5, [0, 0, 0], 2)).toBe(true);
    // every meshing distance clears a rod in the partner's hub
    for (const [ra, rb] of [[0.5, 0.5], [0.5, 1.5], [0.5, 2.5], [1, 1], [1.5, 1.5], [1.5, 2.5], [2.5, 2.5]])
      for (const r of [ra!, rb!]) expect(tipOverlapsRod([0, 0, 0], 2, r, [ra! + rb!, 0, 0], 2), `${r} vs rod at ${ra! + rb!}`).toBe(false);
  });
  it('a rod ⟂ the gear axis is a ±½ × ±ROD_HALF_WIDTH rectangle; other layers never overlap', () => {
    // radial rod at (1, 0) of an 8: its end is 0.5 from the hub < 0.59375
    expect(tipOverlapsRod([0, 0, 0], 2, 0.5, [1, 0, 0], 0)).toBe(true);
    // tangential rod at (1, 0): 1 − 5/16 = 0.6875 > 0.59375
    expect(tipOverlapsRod([0, 0, 0], 2, 0.5, [1, 0, 0], 1)).toBe(false);
    expect(tipOverlapsRod([0, 0, 0], 2, 2.5, [0, 0, 1], 2)).toBe(false);
  });
  it('agrees with a float computation on every offset up to 4 (all radii, all rod axes)', () => {
    for (const r of GEAR_RADII)
      for (const ax of [0, 1, 2] as Axis[]) {
        const [u, v] = gearPlaneBasis(ax);
        for (let du = -4; du <= 4; du++)
          for (let dv = -4; dv <= 4; dv++)
            for (const rod of [0, 1, 2] as Axis[]) {
              const p: [number, number, number] = [0, 0, 0];
              p[u] = du;
              p[v] = dv;
              const R = tipRadius(r);
              let want: boolean;
              if (rod === ax) want = Math.hypot(du, dv) < R + ROD_HALF_WIDTH - 1e-12;
              else {
                const eu = rod === u ? 0.5 : ROD_HALF_WIDTH;
                const ev = rod === v ? 0.5 : ROD_HALF_WIDTH;
                want = Math.hypot(Math.max(0, Math.abs(du) - eu), Math.max(0, Math.abs(dv) - ev)) < R - 1e-12;
              }
              expect(tipOverlapsRod([0, 0, 0], ax, r, p, rod), `${r} ${ax} ${du},${dv} rod ${rod}`).toBe(want);
            }
      }
  });
});

describe('a shaft of another part through a meshing gear (review m8 major)', () => {
  const frame = [0, 1, 2, 3].map((x) => hole(x, 0, 0));
  const pin40 = [makeCell(0, 0, 0, 'pin', 2), makeCell(0, 0, 1, 'pin', 2)];
  for (const kind of ['axle', 'pin', 'frictionPin'] as Kind[])
    it(`a ${kind} through an 8 no longer blocks the 40 that meshes with it`, () => {
      const shaft = [makeCell(3, 0, 0, kind, 2), makeCell(3, 0, 1, kind, 2), makeCell(3, 0, 2, kind, 2)];
      const m = model([frame, shaft, [hole(3, 0, 1, 0.5, true, kind === 'axle' ? 'axleHole' : 'pinHole')], pin40, [hole(0, 0, 1)]]);
      expect(validateModel(m)).toEqual([]);
      expect(reason(canSetGear(m, 5, [0, 0, 1], 2.5))).toBe('ok');
      const m2 = setGear(m, 5, [0, 0, 1], 2.5);
      expect(validateModel(m2)).toEqual([]);
      expect(gearMeshes(m2)).toHaveLength(1);
      // the 8 cannot lose its teeth (rule 6: its hub cube is inside the 40); erasing it leaves the shaft, which is clear
      expect(reason(canSetGear(m2, 3, [3, 0, 1], undefined))).toBe('(3, 0, 1) is inside the gear of part 5');
      expect(canRemoveCell(m2, 3, [3, 0, 1]).ok).toBe(true);
      expect(validateModel(removeCell(m2, 3, [3, 0, 1]))).toEqual([]);
    });
  it('8 + 24, 8 + 8 and 24 + 24 with shafts through both gears', () => {
    for (const [ra, rb] of [[0.5, 1.5], [0.5, 0.5], [1.5, 1.5], [0.5, 2.5], [1.5, 2.5]] as const) {
      const d = ra + rb;
      const m = model([
        [hole(0, 0, 1, ra, true, 'axleHole')],
        [hole(d, 0, 1, rb, true, 'axleHole')],
        [makeCell(0, 0, 0, 'axle', 2), makeCell(0, 0, 1, 'axle', 2), makeCell(0, 0, 2, 'axle', 2)],
        [makeCell(d, 0, 0, 'axle', 2), makeCell(d, 0, 1, 'axle', 2), makeCell(d, 0, 2, 'axle', 2)],
      ]);
      expect(validateModel(m), `${ra}+${rb}`).toEqual([]);
      expect(gearMeshes(m)).toHaveLength(1);
    }
  });
  it('still blocked: a hole beside an 8, a rod pointing at its teeth', () => {
    const g = model([[hole(0, 0, 0, 0.5, true)]]);
    expect(reason(canAddCell(g, null, hole(1, 0, 0)))).toBe('(1, 0, 0) is inside the gear of part 1');
    expect(canAddCell(g, null, makeCell(1, 0, 0, 'pin', 0)).ok).toBe(false);
    // a pin beside it, parallel, clears the teeth (0.6875 > 0.594)
    expect(canAddCell(g, null, makeCell(1, 0, 0, 'pin', 2)).ok).toBe(true);
  });
});

describe('a web cell facing the partner gear (review m8 minor)', () => {
  it('24 + 24: the crank hole on the mesh side is allowed, and so is another part\'s pin in it', () => {
    const near = model([[hole(0, 0, 0, 1.5, true), hole(1, 0, 0)], [hole(3, 0, 0, 1.5, true)]]);
    expect(validateModel(near)).toEqual([]);
    expect(gearMeshes(near)).toHaveLength(1);
    const pinned = model([[hole(0, 0, 0, 1.5, true), hole(1, 0, 0)], [hole(3, 0, 0, 1.5, true)], [makeCell(1, 0, 0, 'pin', 2), makeCell(1, 0, 1, 'pin', 2)]]);
    expect(validateModel(pinned)).toEqual([]);
  });
  it('40 + 8 and 40 + 24: the (2, 0) crank hole toward the partner', () => {
    expect(validateModel(model([[hole(0, 0, 0, 2.5, true), hole(2, 0, 0)], [hole(3, 0, 0, 0.5, true), hole(3, 0, 1)]]))).toEqual([]);
    expect(validateModel(model([[hole(0, 0, 0, 2.5, true), hole(2, 0, 0), hole(1, 1, 0)], [hole(4, 0, 0, 1.5, true), hole(3, 0, 0)]]))).toEqual([]);
  });
  it('the gear cannot be taken away from under its crank hole while the partner is there', () => {
    const near = model([[hole(0, 0, 0, 1.5, true), hole(1, 0, 0)], [hole(3, 0, 0, 1.5, true)]]);
    expect(reason(canSetGear(near, 1, [0, 0, 0], undefined))).toBe('without this gear, (1, 0, 0) is inside the gear of part 2');
    expect(reason(canRemoveCell(near, 1, [0, 0, 0]))).toBe('without this gear, (1, 0, 0) is inside the gear of part 2');
    expect(reason(canSetRim(near, 1, [0, 0, 0], 1.5))).toBe('the wheel would hit the gear teeth of part 2 (hub (3, 0, 0))');
    expect(reason(canSetGear(near, 1, [0, 0, 0], 1))).toBe("(1, 0, 0) would cut into the teeth of this part's gear (hub (0, 0, 0))");
    // the partner side may always go; then everything may
    const alone = removeCell(near, 2, [3, 0, 0]);
    expect(canSetGear(alone, 1, [0, 0, 0], undefined).ok).toBe(true);
    expect(canRemoveCell(alone, 1, [0, 0, 0]).ok).toBe(true);
  });
  it('a hole that is not in the web is still blocked (24 offset (2, 0) is not a web cell)', () => {
    const m = model([[hole(0, 0, 0, 1.5, true), hole(1, 0, 0)], [hole(4, 0, 0, 1.5, true)]]);
    expect(validateModel(m)).toEqual([]);
    expect(reason(canAddCell(m, 1, hole(2, 0, 0)))).toBe("(2, 0, 0) would cut into the teeth of this part's gear (hub (0, 0, 0))");
    expect(reason(canAddCell(m, null, hole(2, 0, 0)))).toBe("(2, 0, 0) is inside the gear of part 1");
  });
});

// ---- targeted fuzz -------------------------------------------------------------------------

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Replace a part's cells without any checks, splitting into components (as the ops do). */
function rawReplace(m: Model, part: Part, cells: Cell[]): Model {
  if (cells.length === 0) return { ...m, version: 3, parts: m.parts.filter((p) => p.id !== part.id) };
  const comps = components(cells).sort((a, b) => b.length - a.length);
  let next = Math.max(m.nextPartId, ...m.parts.map((p) => p.id + 1));
  const pieces = comps.map((comp, k) => ({ ...part, id: k === 0 ? part.id : next++, cells: comp.map((i) => cells[i]!) }));
  const parts: Part[] = [];
  for (const p of m.parts) parts.push(...(p.id === part.id ? pieces : [p]));
  return { ...m, version: 3, parts, nextPartId: next };
}

describe('fuzz: meshing pairs with web holes and shafts — canX / ops agree with validateModel', () => {
  const SEEDS = Number(process.env.SHAFT_FUZZ_SEEDS ?? 300);
  it(`${SEEDS} seeds × 40 edits`, () => {
    const pairs: [number, number][] = [[0.5, 0.5], [0.5, 1.5], [0.5, 2.5], [1, 1], [1.5, 1.5], [1.5, 2.5], [2.5, 2.5]];
    const stats = { models: 0, shafts: 0, webs: 0, accepted: 0, rejected: 0 };
    for (let seed = 1; seed <= SEEDS; seed++) {
      const r = rng(seed * 31 + 7);
      const pick = <T,>(a: readonly T[]): T => a[Math.floor(r() * a.length)]!;
      const ax = pick([0, 1, 2] as Axis[]);
      const [u, v] = gearPlaneBasis(ax);
      const at = (du: number, dv: number, l: number): Vec3i => {
        const p: [number, number, number] = [0, 0, 0];
        p[u] = du;
        p[v] = dv;
        p[ax] = l;
        return p;
      };
      const [ra, rb] = pick(pairs);
      const d = ra + rb;
      const gearPart = (cu: number, rr: number, flip: number): Cell[] => {
        const k = pick(['pinHole', 'axleHole'] as Kind[]);
        const h = at(cu, 0, 0);
        const cells = [makeCell(h[0], h[1], h[2], k, ax, rr, true)];
        for (const [du, dv] of webOffsets(rr)) {
          if (r() < 0.4) continue;
          const p = at(cu + flip * du, dv, 0);
          cells.push(makeCell(p[0], p[1], p[2], pick(['pinHole', 'axleHole'] as Kind[]), ax));
          stats.webs++;
        }
        const b = at(cu, 0, flip > 0 ? -1 : 1);
        if (r() < 0.5) cells.push(makeCell(b[0], b[1], b[2], 'pinHole', ax));
        return cells;
      };
      let m = model([gearPart(0, ra, 1), gearPart(d, rb, -1)]);
      if (validateModel(m).length) continue;
      // shafts of new parts through some holes of the gear layer
      for (const p of [...m.parts])
        for (const c of p.cells) {
          if (!isHole(c.kind) || c.axis !== ax || r() < 0.5) continue;
          const kind: Kind = c.kind === 'axleHole' ? pick(['axle', 'pin'] as Kind[]) : pick(['pin', 'frictionPin'] as Kind[]);
          const k = kind === 'axle' && c.kind !== 'axleHole' ? 'pin' : kind;
          const cells: Cell[] = [];
          for (let l = -1; l <= 1; l++) {
            const q: [number, number, number] = [c.x, c.y, c.z];
            q[ax] += l;
            if (m.parts.some((pp) => pp.cells.some((cc) => cc.x === q[0] && cc.y === q[1] && cc.z === q[2]) && l !== 0)) continue;
            cells.push(makeCell(q[0], q[1], q[2], k, ax));
          }
          const raw: Model = { ...m, parts: [...m.parts, { id: m.nextPartId, color: '#808080', cells }], nextPartId: m.nextPartId + 1 };
          if (components(cells).length === 1 && validateModel(raw).length === 0) {
            m = raw;
            stats.shafts++;
          }
        }
      expect(validateModel(m)).toEqual([]);
      for (let step = 0; step < 40; step++) {
        if (m.parts.length === 0) break;
        const part = pick(m.parts);
        const c = pick(part.cells);
        const tag = `seed ${seed} step ${step}`;
        const op = Math.floor(r() * 5);
        let can: boolean;
        let raw: Model;
        if (op === 0) {
          can = canRemoveCell(m, part.id, [c.x, c.y, c.z]).ok;
          raw = rawReplace(m, part, part.cells.filter((q) => q !== c));
        } else if (op === 1) {
          if (!isHole(c.kind)) continue;
          const g = pick([undefined, ...GEAR_RADII]);
          can = canSetGear(m, part.id, [c.x, c.y, c.z], g).ok;
          raw = rawReplace(m, part, part.cells.map((q) => (q === c ? makeCell(q.x, q.y, q.z, q.kind, q.axis, g, g !== undefined) : q)));
        } else if (op === 2) {
          if (!isHole(c.kind)) continue;
          const rim = pick([undefined, 1, 1.5, 2]);
          can = canSetRim(m, part.id, [c.x, c.y, c.z], rim).ok;
          raw = rawReplace(m, part, part.cells.map((q) => (q === c ? makeCell(q.x, q.y, q.z, q.kind, q.axis, rim) : q)));
        } else if (op === 3) {
          const dd = pick<Vec3i>([[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]);
          const res = movePart(m, part.id, dd);
          can = res !== null;
          raw = rawReplace(m, part, part.cells.map((q) => makeCell(q.x + dd[0], q.y + dd[1], q.z + dd[2], q.kind, q.axis, q.rim, q.teeth)));
          expect(can, `${tag} move ${dd}`).toBe(validateModel(raw).length === 0);
          if (res) m = res;
          stats.models++;
          continue;
        } else {
          const axis = pick([0, 1, 2] as Axis[]);
          const res = rotatePart(m, part.id, axis, 1, [c.x, c.y, c.z]);
          const alone = rotatePart({ ...m, parts: [part] }, part.id, axis, 1, [c.x, c.y, c.z]);
          if (!alone) continue;
          raw = rawReplace(m, part, alone.parts[0]!.cells);
          expect(res !== null, `${tag} rotate`).toBe(validateModel(raw).length === 0);
          if (res) m = res;
          stats.models++;
          continue;
        }
        const errs = validateModel(raw);
        expect(can, `${tag} op ${op} on ${JSON.stringify(c)} of part ${part.id}: ${JSON.stringify(errs.slice(0, 1))}`).toBe(errs.length === 0);
        if (can) {
          m = raw;
          stats.accepted++;
        } else stats.rejected++;
        stats.models++;
        expect(validateModel(m), tag).toEqual([]);
      }
    }
    console.log(`shaft fuzz: ${JSON.stringify(stats)}`);
    expect(stats.shafts).toBeGreaterThan(SEEDS / 2);
    expect(stats.webs).toBeGreaterThan(SEEDS / 2);
    expect(stats.accepted).toBeGreaterThan(SEEDS);
    expect(stats.rejected).toBeGreaterThan(SEEDS / 4);
  });
});
