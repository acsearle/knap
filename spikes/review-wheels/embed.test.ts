// Review: replay "r 2.5 wheel (axis X) dropped 5 units onto a 15-beam lying on the floor" and trace the penetration.
import { it } from 'vitest';
import { mkdirSync } from 'node:fs';
import { ModelBuilder, beam } from '../../src/core/examples';
import { makeCell, setFixRoot, setGround, setRim, serialize } from '../../src/core/model';
import type { Axis } from '../../src/core/types';
import { applyTransform, conj, rotate, sub } from '../../src/physics/math';
import type { Vec3 } from '../../src/physics/math';
import { LOGDIR, com, logger, make } from './lib';
import { writeFileSync } from 'node:fs';
mkdirSync(LOGDIR, { recursive: true });
const log = logger('embed');
const HC = 0.46;
it('trace', async () => {
  const r = Number(process.env.R ?? 2.5);
  const axis = Number(process.env.AXIS ?? 0) as Axis;
  const h = Number(process.env.H ?? 5);
  const b = new ModelBuilder();
  const bm = b.add(beam([-7, 0, 0], [7, 0, 0], 1));
  const hubY = Math.round(0.5 + h + (axis === 1 ? 0.5 : r));
  const wl = b.add([makeCell(0, hubY, 0, 'pinHole', axis)]);
  let m = setRim(b.root(bm).build(), wl, [0, hubY, 0], r);
  m = setFixRoot(setGround(m, true), false);
  writeFileSync(`${LOGDIR}/embed-model.knap.json`, serialize(m));
  const s = await make(m);
  const bw = s.bodyOf(wl)!;
  const bb = s.bodyOf(bm)!;
  const R = r - 0.04;
  const u = ((axis + 1) % 3) as Axis;
  const v = ((axis + 2) % 3) as Axis;
  const pts: Vec3[] = [];
  for (const k of [0, 0.25, 0.5, 0.75, 0.9, 1]) for (let i = 0; i < 64; i++) for (const sa of [-HC, 0, HC]) {
    const p: Vec3 = [0, hubY, 0];
    p[u] += k * R * Math.cos((i / 64) * 2 * Math.PI); p[v] += k * R * Math.sin((i / 64) * 2 * Math.PI); p[axis] += sa;
    pts.push(p);
  }
  for (let i = 0; i <= 480 * 3; i++) {
    if (i) s.stepFixed(1);
    if (i % 24 !== 0) continue;
    const tw = s.bodyTransform(bw)!;
    const tb = s.bodyTransform(bb)!;
    let d = -Infinity; let at: Vec3 = [0, 0, 0];
    for (const q of pts) {
      const w = applyTransform(tw, q);
      const e = rotate(conj(tb.q), sub(w, tb.p));
      const t = Math.max(-7, Math.min(7, e[0]));
      const dd = Math.min(HC - Math.hypot(e[0] - t, e[2]), HC - Math.abs(e[1]));
      if (dd > d) { d = dd; at = e; }
    }
    const ax = rotate(tw.q, [axis === 0 ? 1 : 0, axis === 1 ? 1 : 0, axis === 2 ? 1 : 0]);
    log(`t ${s.time.toFixed(3)} hub ${JSON.stringify(com(s, bw).map((x) => +x.toFixed(3)))} axis ${JSON.stringify(ax.map((x) => +x.toFixed(3)))} depth ${d.toFixed(3)} at beam-frame ${JSON.stringify(at.map((x) => +x.toFixed(2)))} beam ${JSON.stringify(com(s, bb).map((x) => +x.toFixed(3)))}`);
  }
}, 600000);
