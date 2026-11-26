// Review: the embedded-wheel cases with soft CCD off on the wheel, and with the ground created first.
import { it } from 'vitest';
import { mkdirSync } from 'node:fs';
import type { World } from '@dimforge/rapier3d-compat';
import { ModelBuilder, beam } from '../../src/core/examples';
import { makeCell, setFixRoot, setGround, setRim } from '../../src/core/model';
import type { Axis } from '../../src/core/types';
import { applyTransform, conj, rotate, sub } from '../../src/physics/math';
import type { Vec3 } from '../../src/physics/math';
import { LOGDIR, logger, make } from './lib';
import { groundFirst } from './groundfirst';
mkdirSync(LOGDIR, { recursive: true });
const log = logger(process.env.LOG ?? 'embed2');
const HC = 0.46;
const CASES: [number, Axis, number, number][] = [[2.5, 0, 5, 0], [2.5, 0, 10, 0.3], [2.5, 1, 20, 0.5], [4, 2, 40, 0.3], [4, 0, 10, 0.5], [4, 0, 2, 0], [1.5, 0, 20, 0.5]];
it('variants', async () => {
  for (const variant of (process.env.VARIANTS ?? 'default').split(',')) {
    groundFirst(variant === 'ground first');
    let bad = 0;
    const row: string[] = [];
    for (const [r, axis, h, off] of CASES) {
      const b = new ModelBuilder();
      const bm = b.add(beam([-7, 0, 0], [7, 0, 0], 1));
      const hubY = Math.round(0.5 + h + (axis === 1 ? 0.5 : r));
      const wl = b.add([makeCell(0, hubY, 0, 'pinHole', axis)]);
      let m = setRim(b.root(bm).build(), wl, [0, hubY, 0], r);
      m = setGround(m, true);
      if (variant !== 'fixed root far away (not free)') m = setFixRoot(m, false);
      else {
        const b2 = new ModelBuilder();
        b2.model = m;
        const root = b2.add([makeCell(0, 0, -30, 'pinHole', 2)]);
        m = b2.root(root).build();
      }
      const s = await make(m);
      const bw = s.bodyOf(wl)!;
      const bb = s.bodyOf(bm)!;
      if (variant.startsWith('ccd ')) {
        const w = (s as unknown as { world: World }).world;
        w.forEachRigidBody((rb) => { if (Math.abs(rb.translation().y - hubY) < 1e-6) rb.setSoftCcdPrediction(Number(variant.slice(4))); });
      }
      s.setBodyVelocity(bw, [0, 0, off * 3], [off * 4, off * 2, 0]);
      const R = r - 0.04;
      const u = ((axis + 1) % 3) as Axis;
      const v = ((axis + 2) % 3) as Axis;
      const pts: Vec3[] = [];
      for (const k of [0, 0.25, 0.5, 0.75, 0.9, 1]) for (let i = 0; i < 48; i++) for (const sa of [-HC, 0, HC]) {
        const p: Vec3 = [0, hubY, 0];
        p[u] += k * R * Math.cos((i / 48) * 2 * Math.PI); p[v] += k * R * Math.sin((i / 48) * 2 * Math.PI); p[axis] += sa;
        pts.push(p);
      }
      s.stepFixed(480 * 5);
      const tw = s.bodyTransform(bw)!;
      const tb = s.bodyTransform(bb)!;
      let d = -Infinity;
      for (const q of pts) {
        const e = rotate(conj(tb.q), sub(applyTransform(tw, q), tb.p));
        const t = Math.max(-7, Math.min(7, e[0]));
        d = Math.max(d, Math.min(HC - Math.hypot(e[0] - t, e[2]), HC - Math.abs(e[1])));
      }
      if (d > 0.1) bad++;
      row.push(`r${r}/ax${axis}/h${h}/off${off}: ${d.toFixed(3)}`);
      s.dispose();
    }
    log(`${variant}: embedded ${bad}/${CASES.length} — ${row.join(', ')}`);
  }
  groundFirst(false);
}, 1800000);
