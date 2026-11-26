// Item 6: the two documented known limits, re-measured, and how easily ordinary builds hit the first.
// Run: npx vitest run --config spikes/review-m7/vitest.config.ts limits
import { it } from 'vitest';
import { ModelBuilder, beam, buildExample, pin } from '../../src/core/examples';
import { addPart, makeCell, setFixRoot, setGround, setRim, validateModel } from '../../src/core/model';
import type { Axis, Cell, Model } from '../../src/core/types';
import { Simulation } from '../../src/physics/sim';
import { applyTransform, conj, rotate, sub } from '../../src/physics/math';
import type { Vec3 } from '../../src/physics/math';
import { com, logger, shifted } from './lib';
import { depth } from './depthlib';
import type { BeamRef } from './depthlib';
import { rng } from './kgen';

const log = logger('limits');
const HC = 0.46;

it('re-measure KNOWN LIMIT 1: wheel built lying across a beam on the floor (reviewer case and variants)', async () => {
  for (const r of [1.5, 2.5, 4])
    for (const off of [0, 1, 2])
      for (const beamFixed of [false, true]) {
        if (off > r) continue;
        const b = new ModelBuilder();
        const bm = b.add(beam([-7, 0, off], [7, 0, off], 1));
        const wl = b.add([makeCell(0, 1, 0, 'pinHole', 1)]);
        let m = setGround(setRim(b.root(bm).build(), wl, [0, 1, 0], r), true);
        if (!beamFixed) m = setFixRoot(m, false);
        if (validateModel(m).length) {
          log(`r ${r} off ${off}: invalid ${validateModel(m)[0]!.message}`);
          continue;
        }
        const s = await Simulation.create(m);
        const ref: BeamRef = { a: [-7, 0, off], b: [7, 0, off], hole: 1, part: bm };
        const w = m.parts.find((p) => p.id === wl)!.cells[0]!;
        let worst = -Infinity;
        const at: number[] = [];
        for (let k = 1; k <= 20; k++) {
          s.stepFixed(480);
          const d = depth(s, w, wl, ref);
          worst = Math.max(worst, d);
          if (k === 1 || k === 5 || k === 20) at.push(d);
        }
        const bw = s.bodyOf(wl)!;
        const sp = Math.hypot(...s.bodyVelocity(bw)!.v);
        const tilt = Math.acos(Math.min(1, Math.abs(rotate(s.bodyTransform(bw)!.q, [0, 1, 0])[1]))) * 180 / Math.PI;
        s.dispose();
        log(`lying r ${r} beam ${off} off the hub ${beamFixed ? 'fixed' : 'loose'}: depth at 1/5/20 s ${at.map((x) => x.toFixed(3)).join('/')} worst ${worst.toFixed(3)}, tilt ${tilt.toFixed(1)}°, speed at 20 s ${sp.toExponential(1)}`);
      }
}, 1800000);

it('re-measure KNOWN LIMIT 2: free 4-bar on the floor creeps (rate over 10–40 s)', async () => {
  const b = new ModelBuilder();
  const g = b.add(beam([0, 0, 0], [4, 0, 0], 1));
  b.add(beam([0, 1, 0], [0, 1, 3], 1));
  b.add(beam([4, 1, 0], [4, 1, 3], 1));
  b.add(beam([0, 2, 3], [4, 2, 3], 1));
  b.add(pin([0, 0, 0], [0, 1, 0], 1));
  b.add(pin([4, 0, 0], [4, 1, 0], 1));
  b.add(pin([0, 1, 3], [0, 2, 3], 1));
  b.add(pin([4, 1, 3], [4, 2, 3], 1));
  for (const fr of [0.2, 0]) {
    const m = setFixRoot(setGround(b.root(g).build(), true), false);
    const s = await Simulation.create(m, { jointFriction: fr });
    s.stepFixed(480 * 10);
    let prev = s.graph.bodies.map((x) => s.massInfo(x.id)!.com);
    const rows: string[] = [];
    for (let k = 0; k < 3; k++) {
      s.stepFixed(480 * 10);
      const c = s.graph.bodies.map((x) => s.massInfo(x.id)!.com);
      rows.push(Math.max(...c.map((cc, i) => Math.hypot(cc[0] - prev[i]![0], cc[1] - prev[i]![1], cc[2] - prev[i]![2]))).toExponential(2));
      prev = c;
    }
    s.dispose();
    log(`free 4-bar friction ${fr}: max body drift per 10 s over 10–20/20–30/30–40 s: ${rows.join(', ')}`);
  }
}, 1800000);

/** Armless cart (chassis + 4 axles + 4 r 1.5 wheels) from the Cart example. */
function armlessCart(): Model {
  const base = buildExample('cart');
  return { ...base, parts: base.parts.filter((p) => p.cells.length !== 13 && !(p.cells.length === 2 && p.cells.every((c) => c.kind === 'pin' && c.x === 4))) };
}

it('a cart driving over a loose beam lying on the floor: wheel depth in the beam vs speed and beam direction', async () => {
  const cart = armlessCart();
  const wheels = cart.parts.filter((p) => p.cells.some((c) => c.rim !== undefined));
  // floor: groundLevel = −1.5 (wheels); a beam lying flat (holes along Y) sits in layer y = −1.
  const cases: { label: string; cells: Cell[]; ref: Omit<BeamRef, 'part'> }[] = [
    { label: 'across the path (beam ∥ Z) at x 14', cells: beam([14, -1, -4], [14, -1, 6], 1), ref: { a: [14, -1, -4], b: [14, -1, 6], hole: 1 } },
    { label: 'along the path under the z −1 wheels (beam ∥ X) from x 12', cells: beam([12, -1, -1], [26, -1, -1], 1), ref: { a: [12, -1, -1], b: [26, -1, -1], hole: 1 } },
    { label: 'beam on edge across the path (holes ∥ X) at x 14', cells: beam([14, -1, -4], [14, -1, 6], 0), ref: { a: [14, -1, -4], b: [14, -1, 6], hole: 0 } },
  ];
  for (const c of cases)
    for (const v0 of [10, 30, 60, 120]) {
      const r = addPart(cart, c.cells);
      const m = r.model;
      if (validateModel(m).length) {
        log(`${c.label}: invalid ${validateModel(m)[0]!.message}`);
        break;
      }
      const s = await Simulation.create(m);
      for (const bd of s.graph.bodies) {
        if (bd.partIds.includes(r.partId)) continue;
        const isWheel = bd.partIds.some((pid) => wheels.some((w) => w.id === pid));
        s.setBodyVelocity(bd.id, [v0, 0, 0], isWheel ? [0, 0, -v0 / 1.46] : [0, 0, 0]);
      }
      const ref: BeamRef = { ...c.ref, part: r.partId };
      let worst = -Infinity;
      let deepSteps = 0;
      let steps = 0;
      const T = Math.min(6, 40 / v0 + 2);
      for (let i = 0; i < 480 * T; i += 4) {
        s.stepFixed(4);
        steps++;
        let d = -Infinity;
        for (const w of wheels) d = Math.max(d, depth(s, w.cells[0]!, w.id, ref));
        worst = Math.max(worst, d);
        if (d > 0.1) deepSteps++;
      }
      const ch = s.bodyOf(cart.rootPartId!)!;
      const x = com(s, ch)[0];
      let endD = -Infinity;
      for (const w of wheels) endD = Math.max(endD, depth(s, w.cells[0]!, w.id, ref));
      s.dispose();
      log(`cart ${c.label} at ${v0} u/s: worst wheel depth ${worst.toFixed(3)}, time > 0.1 deep ${((deepSteps / steps) * 100).toFixed(1)} %, at end ${endD.toFixed(3)}, chassis x ${x.toFixed(1)}`);
    }
}, 1800000);

it('a cart parked with one wheel on a beam (built in place: beam under the (0, z −1) wheel)', async () => {
  const cart = armlessCart();
  const wheels = cart.parts.filter((p) => p.cells.some((c) => c.rim !== undefined));
  for (const [label, cells, ref] of [
    ['beam ∥ X under the x 0, z −1 wheel (lying flat, layer y −2)', beam([-3, -2, -1], [3, -2, -1], 1), { a: [-3, -2, -1], b: [3, -2, -1], hole: 1 }],
    ['beam ∥ Z under the x 0 wheels (lying flat, layer y −2)', beam([0, -2, -2], [0, -2, 4], 1), { a: [0, -2, -2], b: [0, -2, 4], hole: 1 }],
  ] as [string, Cell[], Omit<BeamRef, 'part'>][]) {
    const r = addPart(cart, cells);
    const m = r.model;
    if (validateModel(m).length) {
      log(`${label}: invalid ${validateModel(m)[0]!.message}`);
      continue;
    }
    const s = await Simulation.create(m);
    const bref: BeamRef = { ...ref, part: r.partId };
    const rows: string[] = [];
    for (let k = 1; k <= 20; k++) {
      s.stepFixed(480);
      if (k === 1 || k === 5 || k === 20) {
        let d = -Infinity;
        for (const w of wheels) d = Math.max(d, depth(s, w.cells[0]!, w.id, bref));
        rows.push(d.toFixed(3));
      }
    }
    const ch = s.bodyOf(cart.rootPartId!)!;
    const sp = Math.hypot(...s.bodyVelocity(ch)!.v);
    s.dispose();
    log(`parked, ${label}: worst wheel depth in the beam at 1/5/20 s ${rows.join('/')}, chassis speed at 20 s ${sp.toExponential(1)}`);
  }
}, 1800000);

it('wheels dropped flat onto a loose beam on the floor: fraction embedded > 0.1 at 5 s', async () => {
  const R = rng(7);
  for (const r of [1.5, 2.5]) {
    let n = 0;
    let emb = 0;
    let worst = 0;
    const hist = [0, 0, 0, 0]; // ≤0.05, ≤0.1, ≤0.3, >0.3
    for (let k = 0; k < 40; k++) {
      const off = Math.floor(R() * (2 * r + 1)) - r; // beam offset from the hub, in cells
      const h = 2 + Math.floor(R() * 6); // drop height in layers
      const b = new ModelBuilder();
      const bm = b.add(beam([-7, 0, Math.round(off)], [7, 0, Math.round(off)], 1));
      const wl = b.add([makeCell(0, 1 + h, 0, 'pinHole', 1)]);
      const m = setFixRoot(setGround(setRim(b.root(bm).build(), wl, [0, 1 + h, 0], r), true), false);
      if (validateModel(m).length) continue;
      const s = await Simulation.create(m);
      s.stepFixed(480 * 5);
      const d = depth(s, m.parts.find((p) => p.id === wl)!.cells[0]!, wl, { a: [-7, 0, Math.round(off)], b: [7, 0, Math.round(off)], hole: 1, part: bm });
      s.dispose();
      n++;
      worst = Math.max(worst, d);
      if (d > 0.1) emb++;
      hist[d <= 0.05 ? 0 : d <= 0.1 ? 1 : d <= 0.3 ? 2 : 3]!++;
    }
    log(`dropped flat r ${r}: ${emb}/${n} embedded > 0.1 at 5 s, worst ${worst.toFixed(3)}, histogram ≤0.05/≤0.1/≤0.3/>0.3: ${hist.join('/')}`);
  }
}, 1800000);

export { shifted };
