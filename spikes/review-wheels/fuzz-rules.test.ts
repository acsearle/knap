// Review sweep: random sequences of core operations with rims; every result must validate, canX must
// agree with X, splits must conserve cells / rims / colours, serialisation must round-trip.
import { it, expect } from "vitest";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
import {
  addCell, addPart, canAddCell, canRemoveCell, canSetRim, deserialize, emptyModel, makeCell, movePart,
  removeCell, removePart, rotatePart, serialize, setRim, setRoot, validateModel, setGround, setFixRoot, effectiveRootId,
} from '../../src/core/model';
import type { Axis, Cell, Kind, Model } from '../../src/core/types';

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const KINDS: Kind[] = ['pinHole', 'axleHole', 'axle', 'pin', 'frictionPin'];
const RIMS = [undefined, undefined, 1, 1.5, 2, 2.5, 3, 4, 0.5, 4.5, 1.25];

function multiset(m: Model): string[] {
  const out: string[] = [];
  for (const p of m.parts) for (const c of p.cells) out.push(`${c.x},${c.y},${c.z},${c.kind},${c.axis},${c.rim ?? '-'},${p.color}`);
  return out.sort();
}

it('random operation sequences stay valid and canX agrees with X', () => {
  const stats: Record<string, number> = {};
  const bump = (k: string) => (stats[k] = (stats[k] ?? 0) + 1);
  const problems: string[] = [];
  for (let seed = 1; seed <= 400; seed++) {
    const R = rng(seed);
    const ri = (n: number) => Math.floor(R() * n);
    const pick = <T>(a: readonly T[]): T => a[ri(a.length)]!;
    const rc = (): Cell => {
      const kind = pick(KINDS);
      const rim = kind === 'pinHole' || kind === 'axleHole' || R() < 0.1 ? pick(RIMS) : undefined;
      return makeCell(ri(9) - 4, ri(9) - 4, ri(5) - 2, kind, ri(3) as Axis, rim);
    };
    let m: Model = emptyModel();
    for (let step = 0; step < 80; step++) {
      const op = ri(9);
      const before = m;
      try {
        if (op <= 1 || m.parts.length === 0) {
          const cells = [rc()];
          const c0 = cells[0]!;
          // a short beam sometimes
          if (R() < 0.5 && (c0.kind === 'pinHole' || c0.kind === 'axleHole')) {
            const d = ri(3) as Axis;
            if (d !== c0.axis) for (let k = 1; k < 1 + ri(4); k++) { const p = [c0.x, c0.y, c0.z]; p[d] += k; cells.push(makeCell(p[0]!, p[1]!, p[2]!, 'pinHole', c0.axis)); }
          }
          try { m = addPart(m, cells).model; bump('addPart ok'); } catch { bump('addPart refused'); }
        } else if (op === 2) {
          const p = pick(m.parts);
          const base = pick(p.cells);
          const d = ri(6);
          const off = [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]][d]!;
          const c = rc();
          const cell = makeCell(base.x + off[0]!, base.y + off[1]!, base.z + off[2]!, c.kind, c.axis, c.rim);
          const can = canAddCell(m, p.id, cell);
          let threw = false;
          try { m = addCell(m, p.id, cell); } catch { threw = true; }
          if (can.ok === threw) problems.push(`seed ${seed} step ${step}: canAddCell ${can.ok} but addCell threw=${threw}`);
          bump(can.ok ? 'addCell ok' : 'addCell refused');
        } else if (op === 3) {
          const p = pick(m.parts);
          const c = pick(p.cells);
          const can = canRemoveCell(m, p.id, [c.x, c.y, c.z]);
          let threw = false;
          const ms = multiset(m);
          const root = effectiveRootId(m);
          try { m = removeCell(m, p.id, [c.x, c.y, c.z]); } catch { threw = true; }
          if (can.ok === threw) problems.push(`seed ${seed}: canRemoveCell ${can.ok} threw=${threw}`);
          if (!threw) {
            const want = ms.filter((s) => s !== `${c.x},${c.y},${c.z},${c.kind},${c.axis},${c.rim ?? '-'},${p.color}`);
            const got = multiset(m);
            if (JSON.stringify(want) !== JSON.stringify(got)) problems.push(`seed ${seed}: removeCell changed other cells`);
            if (root === p.id && p.cells.length > 1 && !m.parts.some((q) => q.id === p.id)) problems.push(`seed ${seed}: root lost`);
            bump('removeCell');
          } else bump('removeCell refused');
        } else if (op === 4) {
          const p = pick(m.parts);
          const c = pick(p.cells);
          const r = pick(RIMS);
          const can = canSetRim(m, p.id, [c.x, c.y, c.z], r);
          let threw = false;
          const ms = multiset(m).length;
          try { m = setRim(m, p.id, [c.x, c.y, c.z], r); } catch { threw = true; }
          if (can.ok === threw) problems.push(`seed ${seed}: canSetRim ${can.ok} threw=${threw}`);
          if (!threw && multiset(m).length !== ms) problems.push(`seed ${seed}: setRim changed the cell count`);
          if (!threw && m !== before) {
            // shrink split: root id must survive
            if (!m.parts.some((q) => q.id === p.id)) problems.push(`seed ${seed}: setRim lost the part id`);
          }
          bump(can.ok ? 'setRim ok' : 'setRim refused');
        } else if (op === 5) {
          const p = pick(m.parts);
          const r = movePart(m, p.id, [ri(5) - 2, ri(5) - 2, ri(3) - 1]);
          if (r) m = r;
          bump(r ? 'move ok' : 'move refused');
        } else if (op === 6) {
          const p = pick(m.parts);
          const c = pick(p.cells);
          const r = rotatePart(m, p.id, ri(3) as Axis, 1 + ri(3), [c.x, c.y, c.z]);
          if (r) m = r;
          bump(r ? 'rotate ok' : 'rotate refused');
        } else if (op === 7) {
          if (R() < 0.3) m = removePart(m, pick(m.parts).id);
          else m = setRoot(m, pick(m.parts).id);
          if (R() < 0.2) m = setGround(m, R() < 0.5);
          if (R() < 0.2) m = setFixRoot(m, R() < 0.5);
        } else {
          // round trip
          const s = serialize(m);
          const back = deserialize(s);
          if (serialize(back) !== s) problems.push(`seed ${seed}: serialize round trip differs`);
          bump('roundtrip');
        }
      } catch (e) {
        problems.push(`seed ${seed} step ${step} op ${op}: crash ${(e as Error).message}`);
        m = before;
      }
      const errs = validateModel(m);
      if (errs.length) {
        problems.push(`seed ${seed} step ${step} op ${op}: invalid model: ${errs[0]!.message}`);
        m = before;
      }
    }
  }
  require("node:fs").writeFileSync("e2e/out/review-sim/fuzz.json", JSON.stringify(stats));
  console.log(problems.slice(0, 30).join('\n'), problems.length);
  expect(problems).toEqual([]);
});
