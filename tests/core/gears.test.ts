// Gears in the core (DESIGN.md §2.7): constants, validation, file format, the exact placement
// tables of spikes/gearlook/REPORT.md Part A, the web, and the editing operations.
import { describe, expect, it } from 'vitest';
import {
  GEAR_CLASH_BAND,
  GEAR_GROUND_EXTRA,
  GEAR_RADII,
  GEAR_TIP,
  ModelFormatError,
  addCell,
  addPart,
  canAddCell,
  canRemoveCell,
  canSetGear,
  canSetRim,
  components,
  copyCell,
  deserialize,
  discOverlapsCell,
  emptyModel,
  fineDiscOverlapsCell,
  gearContact,
  gearMeshes,
  gearPlaneBasis,
  gearTeeth,
  gearToothAngle,
  gearsOf,
  groundLevel,
  isGear,
  isWebCell,
  makeCell,
  movePart,
  planeAxes,
  removeCell,
  rotatePart,
  serialize,
  setFixRoot,
  setGear,
  setGround,
  setRim,
  setRoot,
  tipOverlapsCell,
  tipOverlapsWheel,
  tipRadius,
  validateModel,
  webOffsets,
  wheelsAt,
} from '../../src/core';
import type { Axis, CanResult, Cell, Kind, Model, Vec3i } from '../../src/core';

// ---------------------------------------------------------------------------------------------
// helpers

const C = (x: number, y: number, z: number, kind: Kind, axis: Axis, rim?: number, teeth?: boolean): Cell => makeCell(x, y, z, kind, axis, rim, teeth);
/** A gear hub (pin hole) of pitch radius r about `axis`. */
const G = (p: Vec3i, r: number, axis: Axis = 2, kind: Kind = 'pinHole'): Cell => C(p[0], p[1], p[2], kind, axis, r, true);
/** A plain wheel hub. */
const W = (p: Vec3i, r: number, axis: Axis = 2): Cell => C(p[0], p[1], p[2], 'pinHole', axis, r);
const H = (p: Vec3i, axis: Axis = 2, kind: Kind = 'pinHole'): Cell => C(p[0], p[1], p[2], kind, axis);
/** hub + in-plane offset (du, dv) along gearPlaneBasis(axis). */
function off(hub: Vec3i, axis: Axis, du: number, dv: number, dk = 0): Vec3i {
  const [u, v] = gearPlaneBasis(axis);
  const p: [number, number, number] = [hub[0], hub[1], hub[2]];
  p[u] += du;
  p[v] += dv;
  p[axis] += dk;
  return p;
}
function build(...parts: Cell[][]): Model {
  let m = emptyModel();
  for (const cells of parts) m = addPart(m, cells).model;
  return m;
}
/** Raw v3 model bypassing all checks. */
function raw(...parts: Cell[][]): Model {
  return { version: 3, parts: parts.map((cells, i) => ({ id: i + 1, color: '#808080', cells })), rootPartId: null, nextPartId: parts.length + 1 };
}
const reason = (r: CanResult) => (r.ok ? 'ok' : r.reason);
const codes = (m: Model) => validateModel(m).map((e) => e.code);
const AXES: Axis[] = [0, 1, 2];
const HUBS: Vec3i[] = [[0, 0, 0], [-3, -2, -5], [7, -4, 2]];
const TEETH: Record<number, number> = { 0.5: 8, 1: 16, 1.5: 24, 2.5: 40 };
/** The 8 sign/swap images of (a, b). */
function images(a: number, b: number): [number, number][] {
  const out = new Set<string>();
  for (const [x, y] of [[a, b], [b, a]]) for (const sx of [1, -1]) for (const sy of [1, -1]) out.add(`${sx * x!},${sy * y!}`);
  return [...out].map((s) => s.split(',').map(Number) as [number, number]);
}

// ---------------------------------------------------------------------------------------------

describe('constants and helpers (§2.5, §2.7)', () => {
  it('GEAR_RADII, GEAR_TIP, gearTeeth, tipRadius', () => {
    expect(GEAR_RADII).toEqual([0.5, 1, 1.5, 2.5]);
    expect(GEAR_TIP).toBe(3 / 32);
    expect(GEAR_CLASH_BAND).toBe(3 / 16);
    expect(GEAR_GROUND_EXTRA).toBe(1 / 8);
    expect(GEAR_RADII.map(gearTeeth)).toEqual([8, 16, 24, 40]);
    expect(() => gearTeeth(2)).toThrow(/not a gear radius/);
    expect(GEAR_RADII.map(tipRadius)).toEqual([0.59375, 1.09375, 1.59375, 2.59375]);
  });
  it('gearPlaneBasis is (Y,Z), (Z,X), (X,Y) — right-handed, u × v = +axis', () => {
    expect(gearPlaneBasis(0)).toEqual([1, 2]);
    expect(gearPlaneBasis(1)).toEqual([2, 0]);
    expect(gearPlaneBasis(2)).toEqual([0, 1]);
    for (const a of AXES) expect(gearPlaneBasis(a)).toEqual(planeAxes(a));
  });
  it('gearToothAngle: tooth k at (k + ¼)·2π/T', () => {
    expect(gearToothAngle(8, 0)).toBeCloseTo(Math.PI / 16, 15);
    expect(gearToothAngle(40, 3)).toBeCloseTo((3.25 * 2 * Math.PI) / 40, 15);
  });
  it('makeCell / copyCell keep teeth only when true, key order x y z kind axis rim teeth', () => {
    expect(Object.keys(G([0, 0, 0], 1.5))).toEqual(['x', 'y', 'z', 'kind', 'axis', 'rim', 'teeth']);
    expect(Object.keys(makeCell(0, 0, 0, 'pinHole', 2, 1.5, false))).toEqual(['x', 'y', 'z', 'kind', 'axis', 'rim']);
    expect(copyCell(G([1, 2, 3], 2.5))).toEqual({ x: 1, y: 2, z: 3, kind: 'pinHole', axis: 2, rim: 2.5, teeth: true });
    expect(isGear(G([0, 0, 0], 0.5))).toBe(true);
    expect(isGear(W([0, 0, 0], 1.5))).toBe(false);
  });
  it('gearsOf lists every gear with its geometry, in part then cell order', () => {
    const m = build([H([0, 0, 1]), G([0, 0, 0], 1.5)], [G([5, 0, 0], 0.5, 0, 'axleHole')]);
    expect(gearsOf(m).map((g) => [g.partId, g.index, g.hub, g.axis, g.r, g.teeth])).toEqual([
      [1, 1, [0, 0, 0], 2, 1.5, 24],
      [2, 0, [5, 0, 0], 0, 0.5, 8],
    ]);
  });
});

describe('validation and file format (§2.4, §2.7)', () => {
  const file = (cell: string, version = 3) => `{"version":${version},"parts":[{"id":1,"color":"#000000","cells":[${cell}]}]}`;
  const hole = (extra: string, kind = 'pinHole') => `{"x":0,"y":0,"z":0,"kind":"${kind}","axis":2${extra}}`;
  const rejects = (json: string, re: RegExp) => {
    let err: unknown;
    try {
      deserialize(json);
    } catch (e) {
      err = e;
    }
    expect(err, json).toBeInstanceOf(ModelFormatError);
    expect((err as Error).message).toMatch(re);
  };
  it('rejects teeth on a wrong radius, rim ½ without teeth, teeth on a male, malformed teeth', () => {
    rejects(file(hole(',"rim":2,"teeth":true')), /cells\[0\] at \(0, 0, 0\): a gear's radius must be ½, 1, 1½ or 2½ \(8, 16, 24 or 40 teeth\) \(got rim 2 with teeth\)/);
    rejects(file(hole(',"rim":4,"teeth":true')), /got rim 4 with teeth/);
    rejects(file(hole(',"rim":0.5')), /rim must be a multiple of ½ from 1 to 4 \(got 0.5\): radius ½ exists only as a gear \(teeth: true\)/);
    rejects(file(hole(',"rim":1,"teeth":true', 'pin')), /a pin cannot carry teeth: gears grow from pin holes and axle holes/);
    rejects(file(hole(',"rim":1,"teeth":true', 'axle')), /an? axle cannot carry teeth/);
    rejects(file(hole(',"teeth":true')), /teeth without a rim/);
    rejects(file(hole(',"rim":1,"teeth":false')), /teeth must be true when present \(got false\)/);
    rejects(file(hole(',"rim":1,"teeth":null')), /teeth must be true when present \(got null\)/);
    rejects(file(hole(',"rim":1,"teeth":"yes"')), /got "yes"/);
  });
  it('teeth need version 3; versions 1 and 2 load unchanged; version 3 without teeth is fine', () => {
    rejects(file(hole(',"rim":1,"teeth":true'), 2), /a model with gears \(teeth\) must be version 3 \(got 2\)/);
    rejects(file(hole(',"rim":1,"teeth":true'), 1), /must be version 3 \(got 1\)/);
    expect(deserialize(file(hole(',"rim":1'), 2)).version).toBe(2);
    expect(deserialize(file(hole(''), 1)).version).toBe(1);
    expect(deserialize(file(hole(''), 3)).version).toBe(3);
    rejects('{"version":4,"parts":[]}', /unsupported version 4 \(expected 1, 2 or 3\)/);
  });
  it('round-trips gears byte for byte', () => {
    let m = build([G([0, 0, 0], 2.5), H([1, 1, 0])], [G([4, 0, 0], 1.5, 2, 'axleHole')], [G([-2, 3, 1], 0.5, 0)]);
    m = setGround(m, true);
    const s = serialize(m);
    expect(s).toMatch(/"version": 3,/);
    expect(s).toMatch(/\{"x":0,"y":0,"z":0,"kind":"pinHole","axis":2,"rim":2.5,"teeth":true\}/);
    expect(s.match(/"teeth":true/g)).toHaveLength(3);
    const back = deserialize(s);
    expect(back).toEqual(m);
    expect(serialize(back)).toBe(s);
  });
  it('operations set version 3 and never lower it', () => {
    const m = build([H([0, 0, 0])]);
    expect(m.version).toBe(1);
    expect(setGear(m, 1, [0, 0, 0], 1).version).toBe(3);
    expect(addPart(m, [G([5, 0, 0], 1)]).model.version).toBe(3);
    expect(addCell(m, 1, G([0, 0, 1], 1)).version).toBe(3);
    const g = setGear(m, 1, [0, 0, 0], 1.5);
    expect(setGround(g, true).version).toBe(3);
    expect(setFixRoot(g, false).version).toBe(3);
    expect(setRim(g, 1, [0, 0, 0], 2).version).toBe(3);
    const bare = setGear(g, 1, [0, 0, 0], undefined);
    expect(bare.version).toBe(3);
    expect(bare.parts[0]!.cells[0]).toEqual(H([0, 0, 0]));
    expect(validateModel(bare)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------
// A1 — which pairs mesh where; the near misses (REPORT.md Part A, A1 / A3)

/** Non-negative offsets (a ≤ b shown once; all images apply) per size pair, from the report. */
const MESH: Record<string, [number, number][]> = {
  '0.5+0.5': [[0, 1]],
  '0.5+1.5': [[0, 2]],
  '1+1': [[0, 2]],
  '0.5+2.5': [[0, 3]],
  '1.5+1.5': [[0, 3]],
  '1.5+2.5': [[0, 4]],
  '2.5+2.5': [[0, 5]],
};
const DIAGONAL: Record<string, [number, number][]> = { '2.5+2.5': [[3, 4]] };
/** s < d < s + 3/16: the teeth would clash. */
const CLASH: Record<string, [number, number][]> = {
  '1+2.5': [[2, 3]],
  '2.5+2.5': [[1, 5]],
  '1.5+2.5': [[1, 4]],
  '0.5+2.5': [[1, 3]],
  '1.5+1.5': [[1, 3]],
};
const PAIRS: [number, number][] = [];
for (let i = 0; i < 4; i++) for (let j = i; j < 4; j++) PAIRS.push([GEAR_RADII[i]!, GEAR_RADII[j]!]);

function expectedContact(r1: number, r2: number, du: number, dv: number): string {
  const key = `${r1}+${r2}`;
  const has = (t: Record<string, [number, number][]>) => (t[key] ?? []).some(([a, b]) => images(a, b).some(([x, y]) => x === du && y === dv));
  if (has(MESH)) return 'mesh';
  if (has(DIAGONAL)) return 'diagonal';
  if (has(CLASH)) return 'clash';
  return 4 * (du * du + dv * dv) < (2 * (r1 + r2)) ** 2 ? 'overlap' : 'clear';
}

describe('A1: meshing offsets and near misses, exact (all axes, negative coordinates)', () => {
  it('the table rows: pairs, mesh distances, the 16-tooth gear meshes only with a 16', () => {
    const meshing = PAIRS.filter(([a, b]) => Number.isInteger(a + b)).map(([a, b]) => `${TEETH[a]}+${TEETH[b]}@${a + b}`);
    expect(meshing).toEqual(['8+8@1', '8+24@2', '8+40@3', '16+16@2', '24+24@3', '24+40@4', '40+40@5']);
    expect(PAIRS.filter(([a, b]) => (a === 1) !== (b === 1)).every(([a, b]) => !Number.isInteger(a + b))).toBe(true);
  });
  it('gearContact over every size pair × offset in [−7, 7]² × axis × hub matches the table', () => {
    let n = 0;
    const seen: Record<string, number> = {};
    for (const [r1, r2] of PAIRS)
      for (const axis of AXES)
        for (const hub of HUBS)
          for (let du = -7; du <= 7; du++)
            for (let dv = -7; dv <= 7; dv++) {
              const want = expectedContact(r1, r2, du, dv);
              const q = off(hub, axis, du, dv);
              expect(gearContact(hub, axis, r1, q, axis, r2), `${r1}+${r2} (${du},${dv}) axis ${axis}`).toBe(want);
              expect(gearContact(q, axis, r2, hub, axis, r1)).toBe(want); // symmetric
              expect(gearContact(hub, axis, r1, off(hub, axis, du, dv, 1), axis, r2)).toBe('clear'); // next layer
              seen[want] = (seen[want] ?? 0) + 1;
              n++;
            }
    expect(n).toBe(10 * 3 * 3 * 225);
    // every pair: 4 in-line mesh images (×3 axes ×3 hubs) for the 7 meshing pairs; 40+40 diagonals 8 images
    expect(seen.mesh).toBe(7 * 4 * 9);
    expect(seen.diagonal).toBe(8 * 9);
    expect(seen.clash).toBe(5 * 8 * 9);
  });
  it('the near misses are blocked as "teeth would clash", the close-but-clear ones stay allowed', () => {
    const place = (r1: number, r2: number, du: number, dv: number, axis: Axis = 2, hub: Vec3i = [-3, -2, -5]) => {
      const m = build([G(hub, r1, axis)]);
      return canAddCell(m, null, G(off(hub, axis, du, dv), r2, axis));
    };
    for (const axis of AXES) {
      for (const [r1, r2, du, dv] of [
        [1, 2.5, 2, 3],
        [2.5, 2.5, 1, 5],
        [1.5, 2.5, 1, 4],
        [0.5, 2.5, 1, 3],
        [1.5, 1.5, 1, 3],
      ] as const) {
        for (const [a, b] of images(du, dv)) {
          expect(reason(place(r1, r2, a, b, axis))).toBe(`the teeth would clash with the gear of part 1 (hub (-3, -2, -5))`);
          expect(reason(place(r2, r1, a, b, axis))).toMatch(/^the teeth would clash with the gear of part 1/);
        }
      }
      for (const [r1, r2, du, dv] of [
        [1.5, 2.5, 3, 3],
        [0.5, 1.5, 1, 2],
        [1, 1, 1, 2],
      ] as const)
        for (const [a, b] of images(du, dv)) expect(place(r1, r2, a, b, axis)).toEqual({ ok: true });
      // the diagonal 40+40 with its own reason
      for (const [a, b] of [...images(3, 4)]) {
        expect(reason(place(2.5, 2.5, a, b, axis))).toBe(
          'these gears can only mesh in a straight line along the grid (the gear of part 1, hub (-3, -2, -5))',
        );
      }
      // every mesh distance can be built, with the mesh listed and both tooth counts
      for (const [k, offs] of Object.entries(MESH)) {
        const [r1, r2] = k.split('+').map(Number) as [number, number];
        for (const [a, b] of images(offs[0]![0], offs[0]![1])) {
          expect(place(r1, r2, a, b, axis), `${k} (${a},${b})`).toEqual({ ok: true });
          const m = build([G([-3, -2, -5], r1, axis)], [G(off([-3, -2, -5], axis, a, b), r2, axis)]);
          expect(validateModel(m)).toEqual([]);
          const ms = gearMeshes(m);
          expect(ms).toHaveLength(1);
          expect([ms[0]!.a.partId, ms[0]!.b.partId, ms[0]!.teethA, ms[0]!.teethB, ms[0]!.axis]).toEqual([1, 2, TEETH[r1], TEETH[r2], axis]);
        }
      }
      // pitch discs overlapping
      expect(reason(place(1.5, 1.5, 2, 0, axis))).toBe('gears would overlap: the gear of part 1 (hub (-3, -2, -5))');
    }
  });
  it('validateModel agrees and names the reason', () => {
    const msg = (m: Model) => validateModel(m).map((e) => `${e.code}: ${e.message}`);
    expect(msg(raw([G([0, 0, 0], 1)], [G([2, 3, 0], 2.5)]))).toEqual([
      'overlap: the teeth would clash: the gear of part 1 (hub (0, 0, 0), 16 teeth) and the gear of part 2 (hub (2, 3, 0), 40 teeth)',
    ]);
    expect(msg(raw([G([0, 0, 0], 2.5)], [G([3, 4, 0], 2.5)]))[0]).toMatch(/^overlap: these gears can only mesh in a straight line along the grid/);
    expect(msg(raw([G([0, 0, 0], 2.5)], [G([4, 0, 0], 2.5)]))[0]).toMatch(/^overlap: gears would overlap/);
    expect(validateModel(raw([G([0, 0, 0], 1.5)], [G([3, 3, 0], 2.5)]))).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------
// A3 — the tip disc against cells; the web

/** Cells of another part, in the gear's layer, blocked by the tip but not by the pitch disc (du ≥ 0 ≤ dv shown). */
const TIP_ONLY: Record<number, [number, number][]> = {
  0.5: [[0, 1]],
  1: [],
  1.5: [[0, 2], [1, 2]],
  2.5: [[0, 3], [1, 3]],
};

describe('A3: tip disc × cell, exact', () => {
  it('cells blocked by the tip but not by the pitch disc are exactly the report\'s (all axes, hubs)', () => {
    for (const r of GEAR_RADII)
      for (const axis of AXES)
        for (const hub of HUBS) {
          const tipOnly: string[] = [];
          for (let du = -5; du <= 5; du++)
            for (let dv = -5; dv <= 5; dv++) {
              const q = off(hub, axis, du, dv);
              const tip = tipOverlapsCell(hub, axis, r, q);
              expect(tip).toBe(fineDiscOverlapsCell(hub, axis, r + 3 / 32, q));
              if (tip && !discOverlapsCell(hub, axis, r, q)) tipOnly.push(`${du},${dv}`);
              expect(tipOverlapsCell(hub, axis, r, off(hub, axis, du, dv, 1))).toBe(false); // other layer
            }
          const want = new Set<string>();
          for (const [a, b] of TIP_ONLY[r]!) for (const [x, y] of images(a, b)) want.add(`${x},${y}`);
          expect(new Set(tipOnly), `r ${r} axis ${axis}`).toEqual(want);
        }
    expect([...new Set(TIP_ONLY[1.5]!.flatMap(([a, b]) => images(a, b).map(String)))]).toHaveLength(12); // 4 + 8
  });
  it('another part\'s cell there is blocked ("gear teeth would hit" / "inside the gear"), one step further is free', () => {
    for (const axis of AXES) {
      const hub: Vec3i = [2, -1, -3];
      for (const [r, du, dv] of [
        [0.5, 1, 0],
        [0.5, 0, -1],
        [1.5, 2, 0],
        [1.5, 2, 1],
        [1.5, -1, -2],
        [2.5, 3, 0],
        [2.5, 3, -1],
        [2.5, 1, 3],
      ] as const) {
        const q = off(hub, axis, du, dv);
        const beamCell = H(q, axis);
        const m = build([G(hub, r, axis)]);
        expect(reason(canAddCell(m, null, beamCell))).toBe(`(${q.join(', ')}) is inside the gear of part 1`);
        const m2 = build([beamCell]);
        expect(reason(canAddCell(m2, null, G(hub, r, axis)))).toBe(`gear teeth would hit part 1 at (${q.join(', ')})`);
        expect(canSetRim(build([beamCell], [H(hub, axis)]), 2, hub, r)).toEqual(r === 0.5 ? { ok: false, reason: 'smallest wheel is radius 1' } : { ok: true });
        expect(reason(canSetGear(build([beamCell], [H(hub, axis)]), 2, hub, r))).toBe(`gear teeth would hit part 1 at (${q.join(', ')})`);
        expect(codes(raw([G(hub, r, axis)], [beamCell]))).toEqual(['overlap']);
        // perpendicular cells too
        expect(codes(raw([G(hub, r, axis)], [H(q, ((axis + 1) % 3) as Axis)]))).toEqual(['overlap']);
      }
      // one step further out (or diagonal of an 8) is free
      for (const [r, du, dv] of [
        [0.5, 1, 1],
        [0.5, 2, 0],
        [1, 1, 2],
        [1, 2, 0],
        [1.5, 3, 0],
        [1.5, 2, 2],
        [2.5, 4, 0],
        [2.5, 3, 2],
      ] as const) {
        const q = off(hub, axis, du, dv);
        expect(canAddCell(build([G(hub, r, axis)]), null, H(q, axis)), `r ${r} (${du},${dv})`).toEqual({ ok: true });
      }
    }
  });
  it('a gear hub cell is its gear: an 8 beside an 8 meshes, a 24 and an 8 at (2,1) are clear', () => {
    for (const axis of AXES) {
      const hub: Vec3i = [-1, -1, -1];
      expect(validateModel(build([G(hub, 0.5, axis)], [G(off(hub, axis, 1, 0), 0.5, axis)]))).toEqual([]);
      expect(validateModel(build([G(hub, 1.5, axis)], [G(off(hub, axis, 2, 1), 0.5, axis)]))).toEqual([]);
      // but an ordinary hole there is inside the 24
      expect(codes(raw([G(hub, 1.5, axis)], [H(off(hub, axis, 2, 1), axis)]))).toEqual(['overlap']);
    }
  });
  it('web cells per size: none / none / 4 / 12, axis ∥ the hub', () => {
    expect(GEAR_RADII.map((r) => webOffsets(r).length)).toEqual([0, 0, 4, 12]);
    expect(webOffsets(1.5)).toEqual([[-1, 0], [0, -1], [0, 1], [1, 0]]);
    expect(new Set(webOffsets(2.5).map(String))).toEqual(new Set([...images(0, 1), ...images(1, 1), ...images(0, 2)].map(String)));
    for (const r of GEAR_RADII)
      for (const axis of AXES)
        for (const hub of HUBS) {
          const g = G(hub, r, axis);
          const web = new Set(webOffsets(r).map(String));
          for (let du = -4; du <= 4; du++)
            for (let dv = -4; dv <= 4; dv++) {
              const q = off(hub, axis, du, dv);
              expect(isWebCell(g, H(q, axis))).toBe(web.has(`${du},${dv}`));
              expect(isWebCell(g, H(q, ((axis + 2) % 3) as Axis))).toBe(false);
              expect(isWebCell(g, H(off(hub, axis, du, dv, 1), axis))).toBe(false);
              // rule 5 in validateModel: own cell in the layer is fine iff web or out of the tips
              const own = raw([g, H(q, axis)]);
              const cuts = codes(own).includes('gear');
              const tip = tipOverlapsCell(hub, axis, r, q);
              if (du !== 0 || dv !== 0) expect(cuts, `r ${r} (${du},${dv})`).toBe(tip && !web.has(`${du},${dv}`));
              // a web cell is connected to the hub by the pitch disc (§2.6 rule 1)
              if (web.has(`${du},${dv}`)) expect(components([g, H(q, axis)])).toHaveLength(1);
            }
        }
  });
  it('rule 5 through the editing operations, with its reason', () => {
    const m = build([G([0, 0, 0], 1.5)]);
    expect(canAddCell(m, 1, H([1, 0, 0], 2))).toEqual({ ok: true }); // web crank hole
    expect(canAddCell(m, 1, H([1, 0, 0], 2, 'axle'))).toEqual({ ok: true }); // web crank pin
    expect(reason(canAddCell(m, 1, H([1, 0, 0], 0)))).toBe("(1, 0, 0) would cut into the teeth of this part's gear (hub (0, 0, 0))");
    expect(reason(canAddCell(m, 1, H([1, 1, 0], 2)))).toBe("(1, 1, 0) would cut into the teeth of this part's gear (hub (0, 0, 0))");
    expect(canAddCell(m, 1, H([0, 0, 1], 0))).toEqual({ ok: true }); // other layer
    // a 16 and an 8 have no web: nothing of their own part beside them in the layer
    expect(reason(canAddCell(build([G([0, 0, 0], 1)]), 1, H([1, 0, 0], 2)))).toMatch(/would cut into the teeth/);
    expect(reason(canAddCell(build([G([0, 0, 0], 0.5)]), 1, H([0, -1, 0], 2)))).toMatch(/would cut into the teeth/);
    // making a gear where the part already has a cell outside the web
    const beam = build([H([0, 0, 0]), H([1, 0, 0]), H([2, 0, 0])]);
    expect(canSetGear(beam, 1, [0, 0, 0], 2.5)).toEqual({ ok: true }); // (1,0), (2,0) are web
    expect(reason(canSetGear(beam, 1, [0, 0, 0], 1.5))).toBe("(2, 0, 0) would cut into the teeth of this part's gear (hub (0, 0, 0))");
    expect(reason(canSetGear(beam, 1, [1, 0, 0], 0.5))).toBe("(0, 0, 0) would cut into the teeth of this part's gear (hub (1, 0, 0))");
    expect(() => addPart(emptyModel(), [G([0, 0, 0], 1), H([1, 0, 0])])).toThrow(/would cut into the teeth of this part's gear/);
    expect(codes(raw([G([0, 0, 0], 1.5), H([2, 1, 0])]))).toContain('gear');
  });
  it('a mated male in a web hole is allowed; removing that hole is not', () => {
    const gear = [G([0, 0, 0], 2.5), H([1, 1, 0]), H([2, 0, 0])];
    const axle = [H([1, 1, -1], 2, 'axle'), H([1, 1, 0], 2, 'axle'), H([1, 1, 1], 2, 'axle')];
    const m = build(gear, axle);
    expect(validateModel(m)).toEqual([]);
    expect(reason(canRemoveCell(m, 1, [1, 1, 0]))).toBe('the axle of part 2 at (1, 1, 0) would be inside the gear of part 1');
    expect(canRemoveCell(m, 1, [2, 0, 0])).toEqual({ ok: true });
    // the axle without the hole
    expect(codes(raw([G([0, 0, 0], 2.5)], axle))).toEqual(['overlap']);
    expect(reason(canAddCell(build([G([0, 0, 0], 2.5)]), null, H([1, 1, 0], 2, 'axle')))).toBe('(1, 1, 0) is inside the gear of part 1');
    // and a male through the hub
    expect(validateModel(build([G([0, 0, 0], 0.5)], [H([0, 0, -1], 2, 'axle'), H([0, 0, 0], 2, 'axle'), H([0, 0, 1], 2, 'axle')]))).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------

describe('gears of one part, gears beside wheels, crossed gears', () => {
  it('two gears of one part: a compound gear on one axle line is fine; in one layer they cannot mesh', () => {
    for (const axis of AXES) {
      const m = build([G([0, 0, 0], 0.5, axis), G(off([0, 0, 0], axis, 0, 0, 1), 2.5, axis)]);
      expect(validateModel(m)).toEqual([]);
      expect(gearMeshes(m)).toEqual([]);
    }
    const bridge = [H([0, 0, 1]), H([1, 0, 1]), H([2, 0, 1]), H([3, 0, 1])];
    const same = raw([G([0, 0, 0], 1.5), G([3, 0, 0], 1.5), ...bridge]);
    expect(validateModel(same).map((e) => e.message)).toEqual([
      'two gears of one part cannot mesh: the gear of part 1 (hub (0, 0, 0), 24 teeth) and the gear of part 1 (hub (3, 0, 0), 24 teeth)',
    ]);
    expect(() => addPart(emptyModel(), [G([0, 0, 0], 1.5), G([3, 0, 0], 1.5), ...bridge])).toThrow('two gears of one part cannot mesh (the gear at hub (0, 0, 0))');
    const m = build([G([0, 0, 0], 1.5), ...bridge]);
    expect(reason(canAddCell(m, 1, G([3, 0, 0], 1.5)))).toBe('two gears of one part cannot mesh (the gear at hub (0, 0, 0))');
    expect(canAddCell(m, 1, G([3, 0, 0], 0.5))).toEqual({ ok: true }); // 24 + 8 at 3: clear (≥ 2 + 3/16)
    // same part, clash band
    expect(reason(canAddCell(build([G([0, 0, 0], 1.5), H([0, 0, 1]), H([1, 0, 1]), H([1, 1, 1]), H([1, 2, 1]), H([1, 3, 1])]), 1, G([1, 3, 0], 1.5)))).toBe(
      "the gear at hub (1, 3, 0) would cut into the teeth of this part's gear (hub (0, 0, 0))",
    );
    // the same placement for two parts is a mesh
    expect(gearMeshes(build([G([0, 0, 0], 1.5)], [G([3, 0, 0], 1.5)]))).toHaveLength(1);
  });
  it('gear beside a plain wheel: tip × wheel disc (A4), any part', () => {
    for (const axis of AXES) {
      const hub: Vec3i = [-4, 1, -2];
      const ok = (rg: number, rw: number, du: number, dv: number) => canAddCell(build([G(hub, rg, axis)]), null, W(off(hub, axis, du, dv), rw, axis));
      expect(ok(1.5, 1, 3, 0)).toEqual({ ok: true }); // 1.59 + 1 < 3
      expect(reason(ok(1.5, 1.5, 3, 0))).toBe('the wheel would hit the gear teeth of part 1 (hub (-4, 1, -2))'); // touching pitch: blocked
      expect(ok(2.5, 1, 3, 2)).toEqual({ ok: true }); // √13 = 3.606 ≥ 2.594 + 1
      expect(reason(ok(2.5, 1.5, 4, 0))).toBe('the wheel would hit the gear teeth of part 1 (hub (-4, 1, -2))'); // 4 < 2.594 + 1.5
      expect(reason(ok(2.5, 1, 3, 1))).toBe(`(${off(hub, axis, 3, 1).join(', ')}) is inside the gear of part 1`); // the hub cell itself first
      // from the gear's side
      const w = off(hub, axis, 3, 0);
      expect(reason(canAddCell(build([W(w, 1.5, axis)]), null, G(hub, 1.5, axis)))).toBe(`gear teeth would hit part 1: its wheel (hub (${w.join(', ')}), radius 1.5)`);
      expect(codes(raw([G(hub, 1.5, axis)], [W(w, 1.5, axis)]))).toEqual(['overlap']);
      // the plain disc rule alone (pitch × wheel) would allow it: they only touch
      expect(discOverlapsCell(hub, axis, 1.5, w)).toBe(false);
      // perpendicular wheel crossing the tips
      const p = ((axis + 1) % 3) as Axis;
      expect(tipOverlapsWheel(hub, axis, 1.5, off(hub, axis, 2, 0, 0), p, 1)).toBe(true);
      // same part: a wheel of the gear's own part must not cut into its teeth either
      const own = [G(hub, 1.5, axis), H(off(hub, axis, 0, 0, 1), axis), H(off(hub, axis, 1, 0, 1), axis), H(off(hub, axis, 2, 0, 1), axis), H(off(hub, axis, 3, 0, 1), axis)];
      const ownM = build(own);
      expect(reason(canAddCell(ownM, 1, W(w, 1.5, axis)))).toMatch(/would cut into the teeth of this part's gear/);
      expect(canAddCell(ownM, 1, W(off(hub, axis, 3, 0), 1, axis))).toEqual({ ok: true }); // 1.59 + 1 < 3
    }
  });
  it('crossed gears: tip × tip must not overlap ("there are no bevel gears")', () => {
    for (const axis of AXES) {
      const b = ((axis + 1) % 3) as Axis;
      const hub: Vec3i = [1, -3, 2];
      const q = off(hub, axis, 1, 0);
      expect(gearContact(hub, axis, 0.5, q, b, 0.5)).toBe('crossed');
      expect(reason(canAddCell(build([G(hub, 0.5, axis)]), null, G(q, 0.5, b)))).toBe(
        'the teeth would clash with the gear of part 1 (hub (1, -3, 2); crossed axes — there are no bevel gears)',
      );
      expect(gearContact(hub, axis, 0.5, off(hub, axis, 2, 0), b, 0.5)).toBe('clear');
    }
  });
});

describe('editing operations with gears', () => {
  it('setRim on a gear makes it a plain wheel (teeth cleared); a meshing gear cannot become a wheel of its radius', () => {
    const m = build([G([0, 0, 0], 1.5)]);
    const w = setRim(m, 1, [0, 0, 0], 1.5);
    expect(w.parts[0]!.cells[0]).toEqual(W([0, 0, 0], 1.5));
    expect(setRim(m, 1, [0, 0, 0], undefined).parts[0]!.cells[0]).toEqual(H([0, 0, 0]));
    expect(setRim(w, 1, [0, 0, 0], 1.5)).toBe(w); // plain no-op
    const mesh = build([G([0, 0, 0], 1.5)], [G([3, 0, 0], 1.5)]);
    expect(reason(canSetRim(mesh, 1, [0, 0, 0], 1.5))).toBe('the wheel would hit the gear teeth of part 2 (hub (3, 0, 0))');
    expect(canSetRim(mesh, 1, [0, 0, 0], 1)).toEqual({ ok: true }); // 1 + 1.59 < 3
    expect(canSetRim(mesh, 1, [0, 0, 0], undefined)).toEqual({ ok: true });
    expect(() => setRim(mesh, 1, [0, 0, 0], 1.5)).toThrow(/gear teeth of part 2/);
  });
  it('a gear whose bare hub would sit in another gear\'s tips cannot lose its teeth (8 beside 8)', () => {
    const m = build([G([0, 0, 0], 0.5), H([0, 0, 1])], [G([1, 0, 0], 0.5)]);
    expect(gearMeshes(m)).toHaveLength(1);
    expect(reason(canSetGear(m, 1, [0, 0, 0], undefined))).toBe('(0, 0, 0) is inside the gear of part 2');
    expect(reason(canSetRim(m, 1, [0, 0, 0], undefined))).toBe('(0, 0, 0) is inside the gear of part 2');
    expect(reason(canSetRim(m, 1, [0, 0, 0], 1))).toMatch(/inside the gear of part 2|gear teeth of part 2/);
    expect(canSetGear(m, 1, [0, 0, 0], 1.5).ok).toBe(false); // overlaps the 8
    expect(canRemoveCell(m, 1, [0, 0, 0])).toEqual({ ok: true }); // the whole cell goes
    // a 24 meshing with a 24 can lose its teeth: its bare hub is out of the other's tips
    const m2 = build([G([0, 0, 0], 1.5)], [G([3, 0, 0], 1.5)]);
    expect(canSetGear(m2, 1, [0, 0, 0], undefined)).toEqual({ ok: true });
  });
  it('setGear on a wheel makes it a gear; on a bare cell; resizing; undefined → bare cell; reasons', () => {
    const m = build([W([0, 0, 0], 2)], [H([5, 0, 0], 2, 'pin')]);
    const g = setGear(m, 1, [0, 0, 0], 2.5);
    expect(g.parts[0]!.cells[0]).toEqual(G([0, 0, 0], 2.5));
    expect(g.version).toBe(3);
    expect(setGear(g, 1, [0, 0, 0], 2.5)).toBe(g);
    expect(setGear(g, 1, [0, 0, 0], 0.5).parts[0]!.cells[0]).toEqual(G([0, 0, 0], 0.5));
    expect(setGear(m, 1, [0, 0, 0], undefined).parts[0]!.cells[0]).toEqual(H([0, 0, 0]));
    expect(reason(canSetGear(m, 2, [5, 0, 0], 1))).toBe('gears grow from pin holes and axle holes');
    expect(reason(canSetGear(m, 1, [0, 0, 0], 2))).toBe("a gear's radius is ½, 1, 1½ or 2½ (8, 16, 24 or 40 teeth) (got 2)");
    expect(reason(canSetGear(m, 1, [9, 9, 9], 1))).toBe('part 1 has no cell at (9, 9, 9)');
    expect(reason(canSetGear(m, 7, [0, 0, 0], 1))).toBe('no part with id 7');
    expect(() => setGear(m, 1, [0, 0, 0], 2)).toThrow(/a gear's radius/);
    // a plain rim ½ stays impossible
    expect(reason(canSetRim(build([H([0, 0, 0])]), 1, [0, 0, 0], 0.5))).toBe('smallest wheel is radius 1');
  });
  it('removing a gear can split its part (web cells hang on the pitch disc), like erasing a cell', () => {
    const cells = [G([0, 0, 0], 2.5), H([1, 1, 0]), H([2, 0, 0]), H([2, 0, 1])];
    const m = setRoot(build([H([9, 9, 9])], cells), 2);
    expect(validateModel(m)).toEqual([]);
    expect(components(cells)).toHaveLength(1);
    const a = removeCell(m, 2, [0, 0, 0]);
    expect(a.parts.map((p) => [p.id, p.cells.length])).toEqual([[1, 1], [2, 2], [3, 1]]);
    expect(validateModel(a)).toEqual([]);
    const b = setGear(m, 2, [0, 0, 0], undefined);
    // bare hub, (1,1) and the (2,0)+(2,0,1) pair fall apart: the pair (largest) keeps the id
    expect(b.parts.map((p) => [p.id, p.cells.length])).toEqual([[1, 1], [2, 2], [3, 1], [4, 1]]);
    expect(b.rootPartId).toBe(2);
    expect(validateModel(b)).toEqual([]);
    // 40 → 16: (2,0) is out of the 16's tips and off its pitch disc: it splits off; (1,1) is in the tips: blocked
    expect(reason(canSetGear(m, 2, [0, 0, 0], 1))).toBe("(1, 1, 0) would cut into the teeth of this part's gear (hub (0, 0, 0))");
    const m2 = build([G([0, 0, 0], 2.5), H([2, 0, 0]), H([2, 0, 1])]);
    const c = setGear(m2, 1, [0, 0, 0], 1);
    expect(c.parts.map((p) => p.cells.length)).toEqual([2, 1]);
    expect(validateModel(c)).toEqual([]);
  });
  it('movePart and rotatePart enforce the gear rules', () => {
    const m = build([G([0, 0, 0], 1.5)], [G([4, 0, 0], 1.5), H([4, 0, 1])]);
    expect(gearMeshes(m)).toEqual([]);
    const meshed = movePart(m, 2, [-1, 0, 0])!;
    expect(gearMeshes(meshed).map((x) => [x.a.partId, x.b.partId, x.teethA, x.teethB])).toEqual([[1, 2, 24, 24]]);
    expect(movePart(m, 2, [-2, 0, 0])).toBeNull(); // overlap
    expect(movePart(m, 2, [-2, 1, 0])).toBeNull(); // (2,1): d = √5 < 3
    expect(movePart(meshed, 2, [0, 1, 0])).toBeNull(); // (3,1): clash
    expect(movePart(meshed, 2, [0, 0, 1])).not.toBeNull(); // next layer
    // a quarter about X through its hub: its axis becomes Y and its tips cross the first gear's (|dx| = 3 < 2·1.59375)
    expect(rotatePart(meshed, 2, 0, 1, [3, 0, 0])).toBeNull();
    // a quarter about Y: its axis becomes X, its layer x ∈ [2.5, 3.5] is clear of the first gear's 1.59 tips
    expect(validateModel(rotatePart(meshed, 2, 1, 1, [3, 0, 0])!)).toEqual([]);
    // a quarter about Z keeps the axis: still a mesh
    const r = rotatePart(meshed, 2, 2, 1, [3, 0, 0])!;
    expect(validateModel(r)).toEqual([]);
    expect(gearMeshes(r)).toHaveLength(1);
    // a web cell turns with its gear
    const crank = build([G([0, 0, 0], 2.5), H([1, 1, 0])]);
    const t = rotatePart(crank, 1, 0, 1, [0, 0, 0])!;
    expect(t.parts[0]!.cells).toEqual([G([0, 0, 0], 2.5, 1), H([1, 0, 1], 1)]);
    expect(validateModel(t)).toEqual([]);
  });
  it('gearMeshes: a train across parts, deterministic order', () => {
    const m = build([G([0, 0, 0], 2.5)], [G([3, 0, 0], 0.5), G([3, 0, 1], 1.5)], [G([3, 3, 1], 1.5)], [G([0, -5, 0], 2.5)]);
    expect(validateModel(m)).toEqual([]);
    expect(gearMeshes(m).map((x) => `${x.a.partId}.${x.a.index}-${x.b.partId}.${x.b.index} ${x.teethA}:${x.teethB}`)).toEqual([
      '1.0-2.0 40:8',
      '1.0-4.0 40:40',
      '2.1-3.0 24:24',
    ]);
  });
  it('groundLevel: a horizontal gear reaches y − r − ⅛', () => {
    const on = (...parts: Cell[][]) => groundLevel(setGround(build(...parts), true));
    expect(on([G([0, 0, 0], 2.5, 0)])).toBe(-2.625);
    expect(on([G([0, 3, 0], 0.5, 2)])).toBe(2.375);
    expect(on([G([0, 0, 0], 2.5, 1)])).toBe(-0.5);
    expect(on([W([0, 0, 0], 2.5, 0)])).toBe(-2.5);
  });
  it('wheelsAt reports a gear by its pitch disc', () => {
    const m = build([G([0, 0, 0], 1.5)]);
    expect(wheelsAt(m, [1, 1, 0]).map((e) => [e.partId, e.r, e.gear])).toEqual([[1, 1.5, true]]);
    expect(wheelsAt(m, [2, 0, 0])).toEqual([]); // tips only
  });
});
