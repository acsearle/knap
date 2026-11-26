import { it } from 'vitest';
import { writeFileSync } from 'node:fs';
import {
  addPart, canAddCell, deserialize, emptyModel, makeCell, serialize, setRim, validateModel, groundLevel, setGround, rotatePart, movePart, canSetRim, components,
} from '../../src/core/model';
import { EXAMPLES, beam } from '../../src/core/examples';
import type { Model } from '../../src/core/types';

const OUT = 'e2e/out/review-sim/rules-misc.txt';
const log: string[] = [];
const L = (...a: unknown[]) => log.push(a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' '));

it('misc', () => {
  // v1 round trip of every example
  for (const ex of EXAMPLES) {
    const m = ex.build();
    const s = serialize(m);
    const s2 = serialize(deserialize(s));
    L(ex.name, 'version', m.version, 'roundtrip', s === s2);
  }
  const base = `{"version":2,"rootPartId":null,"nextPartId":2,"parts":[{"id":1,"color":"#aabbcc","cells":[CELL]}]}`;
  for (const cell of [
    '{"x":0,"y":0,"z":0,"kind":"pin","axis":2,"rim":2}',
    '{"x":0,"y":0,"z":0,"kind":"pinHole","axis":2,"rim":"2"}',
    '{"x":0,"y":0,"z":0,"kind":"pinHole","axis":2,"rim":null}',
    '{"x":0,"y":0,"z":0,"kind":"pinHole","axis":2,"rim":0.5}',
    '{"x":0,"y":0,"z":0,"kind":"pinHole","axis":2,"rim":1e400}',
    '{"x":0,"y":0,"z":0,"kind":"pinHole","axis":2,"rim":-1}',
    '{"x":0,"y":0,"z":0,"kind":"pinHole","axis":2,"rim":2.0000000000000004}',
  ]) {
    try { deserialize(base.replace('CELL', cell)); L('ACCEPTED', cell); } catch (e) { L('rejected', cell, (e as Error).message); }
  }
  try { deserialize(base.replace('CELL', '{"x":0,"y":0,"z":0,"kind":"pinHole","axis":2,"rim":2}').replace('"version":2', '"version":1')); L('ACCEPTED v1 rim'); } catch (e) { L('v1 rim rejected', (e as Error).message); }
  try { const m = deserialize(base.replace('CELL', '{"x":0,"y":0,"z":0,"kind":"pinHole","axis":2}').replace('"nextPartId":2,', '"nextPartId":2,"ground":"yes",')); L('ACCEPTED ground yes', m); } catch (e) { L('ground yes rejected', (e as Error).message); }

  // performance: 2000 cells, 8 wheels
  let m: Model = emptyModel();
  for (let z = 0; z < 20; z++) for (let y = 0; y < 10; y++) m = addPart(m, beam([0, y * 3, z * 2], [9, y * 3, z * 2])).model; // 20*10*10 = 2000
  const wheels: number[] = [];
  for (let k = 0; k < 8; k++) {
    const r = addPart(m, [makeCell(-20 - k * 10, 0, 0, 'pinHole', 2)]);
    m = setRim(r.model, r.partId, [-20 - k * 10, 0, 0], 4);
    wheels.push(r.partId);
  }
  let cells = 0; for (const p of m.parts) cells += p.cells.length;
  let t = performance.now();
  for (let i = 0; i < 10; i++) validateModel({ ...m });
  L('cells', cells, 'validateModel ms', (performance.now() - t) / 10);
  t = performance.now();
  for (let i = 0; i < 100; i++) canAddCell(m, m.parts[5]!.id, makeCell(10, 15, 10, 'pinHole', 2, 4));
  L('canAddCell (rim 4, cached index) ms', (performance.now() - t) / 100);
  t = performance.now();
  for (let i = 0; i < 20; i++) canAddCell({ ...m }, m.parts[5]!.id, makeCell(10, 15, 10, 'pinHole', 2, 4));
  L('canAddCell (rim 4, fresh index) ms', (performance.now() - t) / 20);
  t = performance.now();
  for (let i = 0; i < 20; i++) movePart({ ...m }, wheels[0]!, [0, 1, 0]);
  L('movePart wheel ms', (performance.now() - t) / 20);
  // a single 2000-cell part with 8 rims
  const big: ReturnType<typeof makeCell>[] = [];
  for (let x = 0; x < 100; x++) for (let y = 0; y < 20; y++) big.push(makeCell(x, y, 0, 'pinHole', 2, (x % 12 === 0 && y === 10) ? 4 : undefined));
  t = performance.now();
  const bm = addPart(emptyModel(), big).model;
  L('addPart one 2000-cell part with', big.filter((c) => c.rim).length, 'rims ms', performance.now() - t);
  t = performance.now();
  components(bm.parts[0]!.cells);
  L('components ms', performance.now() - t);

  // groundLevel with vertical wheel lowest
  let g = addPart(emptyModel(), [makeCell(0, 0, 0, 'pinHole', 1)]);
  let gm = setGround(setRim(g.model, g.partId, [0, 0, 0], 3), true);
  L('vertical-axis wheel groundLevel', groundLevel(gm));
  // rotate a wheel onto its side, checks
  g = addPart(emptyModel(), [makeCell(0, 0, 0, 'pinHole', 2), makeCell(1, 0, 0, 'pinHole', 2), makeCell(2, 0, 0, 'pinHole', 2)]);
  gm = setRim(g.model, g.partId, [1, 0, 0], 2);
  const g2 = addPart(gm, [makeCell(1, 0, 3, 'pinHole', 2)]);
  L('beam with mid rim 2 + bead at z=3 valid', validateModel(g2.model).length);
  const rot = rotatePart(g2.model, g.partId, 0, 1, [1, 0, 0]);
  L('rotate mid-rim beam about X onto bead (disc now in x=1 plane? axis Y)', rot ? validateModel(rot) : null);
  const rot2 = rotatePart(g2.model, g.partId, 1, 1, [1, 0, 0]);
  L('rotate about Y: disc axis X, plane x=1 covers (1,0,3)? r=2 dist 3 -> no', rot2 ? 'ok' : 'refused', rot2 && validateModel(rot2));
  L('canSetRim 2.5 next to bead', canSetRim(g2.model, g.partId, [1, 0, 0], 2.5), canSetRim(g2.model, g.partId, [1, 0, 0], 3));
  writeFileSync(OUT, log.join('\n'));
});
