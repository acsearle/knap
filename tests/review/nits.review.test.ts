// Nits review (DESIGN §7.3 Back side, §6.1 root marker): adversarial checks of the pure parts.
import { describe, expect, it } from 'vitest';
import { AXES, KINDS, addCell, addPart, canAddCell, emptyModel, makeCell, validateModel } from '../../src/core';
import type { Dir, Kind, Model } from '../../src/core';
import { DIR_LABELS, farSidePick, initialToolState, resolveBuild, selectTool, withModifiers } from '../../src/editor';
import type { CellPick } from '../../src/editor';
import { rootAnchorIndex } from '../../src/view/rootmarker';

function randomModels(count: number, seed0: number): Model[] {
  let seed = seed0;
  const rnd = (n: number): number => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed % n;
  };
  const out: Model[] = [];
  for (let t = 0; t < count; t++) {
    let m = emptyModel();
    for (let k = 0; k < 40; k++) {
      const cell = makeCell(rnd(5) - 2, rnd(3) - 1, rnd(5) - 2, KINDS[rnd(5)]!, AXES[rnd(3)]!);
      const target = m.parts.length && rnd(3) ? m.parts[rnd(m.parts.length)]!.id : null;
      if (!canAddCell(m, target, cell).ok) continue;
      m = target === null ? addPart(m, [cell]).model : addCell(m, target, cell);
    }
    expect(validateModel(m)).toEqual([]);
    out.push(m);
  }
  return out;
}

function* picks(m: Model): Generator<CellPick> {
  for (const p of m.parts) for (let i = 0; i < p.cells.length; i++) for (let d = 0; d < 6; d++) yield { partId: p.id, cellIndex: i, dir: d as Dir };
}

describe('Back side status text', () => {
  it('the Shift hint shown with Back side describes the Shift + Back side click', () => {
    // App shows `aux = [orientationHint, shiftHint, …]` next to the sentence; with Alt / [B] on,
    // holding Shift as well builds on the back side, so the hint must say so (§7.3 "the status
    // sentence says so"; §7.3 "The status bar always says what a click will do").
    const wrong: string[] = [];
    for (const m of randomModels(15, 777))
      for (const pick of picks(m))
        for (const kind of KINDS as readonly Kind[]) {
          const s = selectTool(initialToolState('#3b74c4'), kind);
          const back = resolveBuild(m, pick, null, withModifiers(s, { alt: true }));
          if (!back.shiftHint) continue;
          const both = resolveBuild(m, pick, null, withModifiers(s, { alt: true, shift: true }));
          if (back.shiftHint !== `Shift: ${both.description}`) wrong.push(`${back.shiftHint}  ≠  Shift: ${both.description}`);
        }
    expect(wrong.slice(0, 3)).toEqual([]);
  });

  it('front-side invariant the back-side sentence relies on: an invalid description ends with " — reason"', () => {
    const wrong: string[] = [];
    for (const m of randomModels(15, 99))
      for (const pick of picks(m))
        for (const kind of KINDS as readonly Kind[]) {
          const s = selectTool(initialToolState('#3b74c4'), kind);
          const back = resolveBuild(m, pick, null, withModifiers(s, { alt: true }));
          if (back.action === 'none') continue;
          const far = farSidePick(m, pick)!;
          expect(back.description).toContain(` · back side (${DIR_LABELS[far.dir]})`);
          if (!back.valid && !back.description.endsWith(` · back side (${DIR_LABELS[far.dir]}) — ${back.reason}`)) wrong.push(back.description);
        }
    expect(wrong.slice(0, 3)).toEqual([]);
  });
});

describe('root marker anchor', () => {
  it('does not depend on cell order', () => {
    const cells = [
      { x: 0, y: 0, z: 0 },
      { x: 2, y: 0, z: 0 },
      { x: 1, y: 0, z: 1 },
      { x: 1, y: 0, z: -1 },
      { x: 1, y: 3, z: 0 },
    ];
    const pick = (cs: typeof cells) => cs[rootAnchorIndex(cs)];
    const a = pick(cells);
    expect(pick([...cells].reverse())).toEqual(a);
    expect(pick([cells[3]!, cells[1]!, cells[4]!, cells[0]!, cells[2]!])).toEqual(a);
  });
});
