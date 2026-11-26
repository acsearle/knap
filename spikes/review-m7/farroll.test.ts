// Item 1, the user-facing form: a vehicle that drives away from where it started (the floor's
// pivot stays at the edit-time mean cell centre). Does its speed or its rest depend on how far it went?
// Run: npx vitest run --config spikes/review-m7/vitest.config.ts farroll
import { it } from 'vitest';
import { ModelBuilder, buildExample } from '../../src/core/examples';
import { makeCell, setFixRoot, setGround, setRim } from '../../src/core/model';
import type { Model } from '../../src/core/types';
import { Simulation } from '../../src/physics/sim';
import { com, logger, shifted } from './lib';

const log = logger('farroll');

it('lone wheel rolled away from the pivot: speed along the way (no rolling resistance: should stay constant)', async () => {
  for (const v0 of [5, 50]) {
    const b = new ModelBuilder();
    const w = b.add([makeCell(0, 0, 0, 'pinHole', 2)]);
    const m = setFixRoot(setGround(setRim(b.build(), w, [0, 0, 0], 1.5), true), false);
    const s = await Simulation.create(m);
    const bw = s.bodyOf(w)!;
    s.stepFixed(240);
    s.setBodyVelocity(bw, [v0, 0, 0], [0, 0, -v0 / 1.46]);
    const rows: string[] = [];
    const T = v0 === 5 ? 200 : 100;
    for (let t = 0; t < T; t += T / 10) {
      s.stepFixed(480 * (T / 10));
      const v = s.bodyVelocity(bw)!;
      rows.push(`x ${com(s, bw)[0].toFixed(1)} v ${v.v[0].toFixed(4)}`);
    }
    s.dispose();
    log(`wheel v0 ${v0}: ${rows.join(' | ')}`);
  }
}, 1800000);

it('a lone wheel placed far away, pivot far away: at rest it accelerates toward the pivot', async () => {
  // Same mechanism as "pivot D away" in far.test.ts, with the pivot made far by the model itself:
  // a fixed anchor at −2D. Reported: x(t) over 30 s.
  for (const D of [100, 300, 1000]) {
    const b = new ModelBuilder();
    const root = b.add([makeCell(-2 * D, 0, 0, 'pinHole', 2)]);
    const w = b.add([makeCell(0, 0, 0, 'pinHole', 2)]);
    const m: Model = setGround({ ...setRim(b.build(), w, [0, 0, 0], 1.5), rootPartId: root }, true);
    const s = await Simulation.create(m);
    const bw = s.bodyOf(w)!;
    s.stepFixed(480);
    const x0 = com(s, bw)[0];
    const xs: string[] = [];
    for (let k = 1; k <= 3; k++) {
      s.stepFixed(4800);
      xs.push((com(s, bw)[0] - x0).toExponential(2));
    }
    s.dispose();
    log(`pivot ${D} away: dx at 10/20/30 s ${xs.join(', ')}`);
  }
}, 1800000);

it('armless cart pushed away, comes to rest by joint friction, then: drift at rest vs distance travelled', async () => {
  const base = buildExample('cart');
  const armless: Model = { ...base, parts: base.parts.filter((p) => p.cells.length !== 13 && !(p.cells.length === 2 && p.cells.every((c) => c.kind === 'pin' && c.x === 4))) };
  for (const v0 of [0, 20, 60, 120]) {
    const s = await Simulation.create(armless);
    const ch = s.bodyOf(armless.rootPartId!)!;
    s.stepFixed(240);
    for (const b of s.graph.bodies) {
      // every body: translate at v0; wheels also spin (ω = −v/R about Z)
      const isWheel = b.partIds.some((pid) => armless.parts.find((p) => p.id === pid)!.cells.some((c) => c.rim !== undefined));
      s.setBodyVelocity(b.id, [v0, 0, 0], isWheel ? [0, 0, -v0 / 1.46] : [0, 0, 0]);
    }
    let t = 0;
    while (t < 120) {
      s.stepFixed(480);
      t++;
      if (Math.hypot(...s.bodyVelocity(ch)!.v) < 1e-3 && t > 3) break;
    }
    const c1 = com(s, ch);
    s.stepFixed(480 * 20);
    const c2 = com(s, ch);
    const v = s.bodyVelocity(ch)!;
    s.dispose();
    log(`armless cart v0 ${v0}: stopped at x ${c1[0].toFixed(2)} after ${t} s; drift over the next 20 s ${Math.hypot(c2[0] - c1[0], c2[1] - c1[1], c2[2] - c1[2]).toExponential(2)} (dx ${(c2[0] - c1[0]).toExponential(2)}), |v| ${Math.hypot(...v.v).toExponential(2)}`);
  }
}, 1800000);

it('cart example translated: slow motion is quantised by f32 positions (chassis x at 1 s steps)', async () => {
  const base = buildExample('cart');
  for (const D of [0, 1000, 5000, 20000]) {
    const m = shifted(base, [D, 0, 0]);
    const s = await Simulation.create(m);
    const ch = s.bodyOf(m.rootPartId!)!;
    const x0 = com(s, ch)[0];
    const xs: string[] = [];
    for (let k = 0; k < 6; k++) {
      s.stepFixed(480);
      xs.push((com(s, ch)[0] - x0).toFixed(4));
    }
    s.dispose();
    log(`cart at x+${D}: chassis dx at 1..6 s ${xs.join(', ')}`);
  }
}, 1800000);
