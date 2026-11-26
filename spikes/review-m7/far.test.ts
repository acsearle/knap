// Item 1: does anything depend on distance from the origin / from the floor's pivot?
// Run: npx vitest run --config spikes/review-m7/vitest.config.ts far
import { it } from 'vitest';
import { ModelBuilder, buildExample } from '../../src/core/examples';
import { makeCell, setFixRoot, setGround, setRim } from '../../src/core/model';
import type { Model } from '../../src/core/types';
import { Simulation } from '../../src/physics/sim';
import { com, logger, shifted, stateHash } from './lib';

const log = logger('far');
const G = 1226.25;

/** Lone r-wheel (axis Z) at `at`; optional fixed root hole at `anchor` (moves the floor's pivot). */
function wheelModel(at: [number, number, number], r: number, anchor?: [number, number, number]): { m: Model; w: number } {
  const b = new ModelBuilder();
  let root: number | undefined;
  if (anchor) root = b.add([makeCell(anchor[0], anchor[1], anchor[2], 'pinHole', 2)]);
  const w = b.add([makeCell(at[0], at[1], at[2], 'pinHole', 2)]);
  let m = setRim(b.build(), w, at, r);
  if (root !== undefined) m = { ...m, rootPartId: root };
  m = setGround(m, true);
  if (!anchor) m = setFixRoot(m, false);
  return { m, w };
}

async function runWheel(label: string, m: Model, w: number, slope: number) {
  const out: string[] = [];
  for (let rep = 0; rep < 2; rep++) {
    const s = await Simulation.create(m, { groundSlopeDeg: slope });
    const bw = s.bodyOf(w)!;
    const mi = s.massInfo(bw)!;
    const R = 1.5 - 0.04;
    const Iz = mi.inertia[8]!;
    const th = (slope * Math.PI) / 180;
    const a = (G * Math.sin(th)) / (1 + Iz / (mi.mass * R * R));
    const c0 = com(s, bw);
    if (slope === 0) {
      s.stepFixed(480);
      const c1 = com(s, bw);
      s.stepFixed(480 * 10);
      const c2 = com(s, bw);
      const v = s.bodyVelocity(bw)!;
      out.push(
        `${label} flat: settle dy ${(c1[1] - c0[1]).toExponential(2)}, drift 1–11 s dx ${(c2[0] - c1[0]).toExponential(2)} dz ${(c2[2] - c1[2]).toExponential(2)} dy ${(c2[1] - c1[1]).toExponential(2)} |v| ${Math.hypot(...v.v).toExponential(2)} hash ${stateHash(s)}`,
      );
    } else {
      const T = 0.5;
      // height of the hub above the plane along n, sampled each step
      const n = [Math.sin(th), Math.cos(th), 0];
      const h = (c: number[]) => c[0]! * n[0]! + c[1]! * n[1]!;
      const h0 = h(c0);
      let hmin = Infinity;
      let hmax = -Infinity;
      for (let i = 0; i < 480 * T; i++) {
        s.stepFixed(1);
        const hh = h(com(s, bw)) - h0;
        hmin = Math.min(hmin, hh);
        hmax = Math.max(hmax, hh);
      }
      const c1 = com(s, bw);
      const along = (c1[0] - c0[0]) * Math.cos(th) - (c1[1] - c0[1]) * Math.sin(th);
      const theory = 0.5 * a * T * T;
      const v = s.bodyVelocity(bw)!;
      const omega = v.w[2]!;
      const vAlong = v.v[0]! * Math.cos(th) - v.v[1]! * Math.sin(th);
      out.push(
        `${label} slope ${slope}: s(0.5 s) ${along.toFixed(4)} theory ${theory.toFixed(4)} ratio ${(along / theory).toFixed(5)}, slip v+ωR ${(vAlong + omega * R).toExponential(2)}, normal dh [${hmin.toExponential(2)}, ${hmax.toExponential(2)}], dz ${(c1[2] - c0[2]).toExponential(2)} hash ${stateHash(s)}`,
      );
    }
    s.dispose();
  }
  const hashes = out.map((l) => l.split('hash ')[1]);
  log(out[0]!, hashes[0] === hashes[1] ? '(deterministic)' : `NON-DETERMINISTIC ${hashes[1]}`);
}

it('wheel far from origin / from pivot', async () => {
  for (const slope of [0, 5, 15])
    for (const D of [0, 100, 1000, 5000]) {
      // wheel at distance D from the origin along X (pivot under the wheel)
      let { m, w } = wheelModel([D, 0, 0], 1.5);
      await runWheel(`wheel@x=${D}`, m, w, slope);
      ({ m, w } = wheelModel([0, 0, D], 1.5));
      await runWheel(`wheel@z=${D}`, m, w, slope);
      if (D > 0) {
        // wheel at the origin, pivot D away (fixed anchor at −2D)
        ({ m, w } = wheelModel([0, 0, 0], 1.5, [-2 * D, 0, 0]));
        await runWheel(`wheel@0 pivot ${D} away (x)`, m, w, slope);
        ({ m, w } = wheelModel([0, 0, 0], 1.5, [0, 0, -2 * D]));
        await runWheel(`wheel@0 pivot ${D} away (z)`, m, w, slope);
      }
    }
}, 1800000);

it('cart far from origin: trajectory vs the cart at the origin', async () => {
  const base = buildExample('cart');
  const track = async (m: Model, slope: number) => {
    const s = await Simulation.create(m, { groundSlopeDeg: slope });
    const ch = s.bodyOf(m.rootPartId!)!;
    const c0 = com(s, ch);
    const pts: number[][] = [];
    for (let k = 0; k < 10; k++) {
      s.stepFixed(480);
      const c = com(s, ch);
      pts.push([c[0] - c0[0], c[1] - c0[1], c[2] - c0[2]]);
    }
    const e = s.energy();
    s.dispose();
    return { pts, e };
  };
  for (const slope of [0, 5])
    for (const D of [0, 100, 1000, 5000]) {
      const ref = await track(base, slope);
      const a = await track(shifted(base, [D, 0, D]), slope);
      let dev = 0;
      for (let k = 0; k < 10; k++) dev = Math.max(dev, Math.hypot(...ref.pts[k]!.map((x, i) => x - a.pts[k]![i]!)));
      log(`cart slope ${slope} offset (${D},0,${D}): chassis displacement at 10 s ${a.pts[9]!.map((x) => x.toFixed(4)).join(',')} (origin run ${ref.pts[9]!.map((x) => x.toFixed(4)).join(',')}), max deviation from origin run over 10 s ${dev.toExponential(2)}`);
    }
}, 1800000);

it('cart parked (arm removed) far from origin: drift at rest', async () => {
  const base = buildExample('cart');
  const armless: Model = { ...base, parts: base.parts.filter((p) => p.cells.length !== 13 && !(p.cells.length === 2 && p.cells.every((c) => c.kind === 'pin' && c.x === 4))) };
  for (const D of [0, 100, 1000, 5000]) {
    const m = shifted(armless, [D, 0, D]);
    const s = await Simulation.create(m);
    const ch = s.bodyOf(m.rootPartId!)!;
    s.stepFixed(480 * 2);
    const c1 = com(s, ch);
    s.stepFixed(480 * 10);
    const c2 = com(s, ch);
    s.dispose();
    log(`armless cart parked at (${D},0,${D}) [${armless.parts.length} parts]: drift 2–12 s ${Math.hypot(c2[0] - c1[0], c2[1] - c1[1], c2[2] - c1[2]).toExponential(2)} (dx ${(c2[0] - c1[0]).toExponential(2)}, dy ${(c2[1] - c1[1]).toExponential(2)}, dz ${(c2[2] - c1[2]).toExponential(2)})`);
  }
}, 1800000);
