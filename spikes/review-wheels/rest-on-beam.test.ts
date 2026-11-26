// Review: a wheel built lying flat ON a beam that lies on the floor (no drop). Does it stay on top?
import { it } from 'vitest';
import { mkdirSync } from 'node:fs';
import { ModelBuilder, beam } from '../../src/core/examples';
import { makeCell, setFixRoot, setGround, setRim, validateModel } from '../../src/core/model';
import { applyTransform, conj, rotate, sub } from '../../src/physics/math';
import type { Vec3 } from '../../src/physics/math';
import { LOGDIR, com, logger, make } from './lib';
mkdirSync(LOGDIR, { recursive: true });
const log = logger('rest-on-beam');
const HC = 0.46;
it('flat wheel resting on a beam', async () => {
  for (const variant of (process.env.VARIANTS ?? 'default').split(',')) for (const r of [1.5, 2.5, 4]) for (const off of [0, 1, 2, 3]) {
    if (off > r) continue;
    const b = new ModelBuilder();
    const bm = b.add(beam([-7, 0, off], [7, 0, off], 1)); // beam along X at z = off, lying flat on the floor
    const wl = b.add([makeCell(0, 1, 0, 'pinHole', 1)]); // wheel lying flat one layer above, hub over z = 0
    let m = setRim(b.root(bm).build(), wl, [0, 1, 0], r);
    m = variant === 'beam fixed' ? setGround(m, true) : setFixRoot(setGround(m, true), false);
    if (validateModel(m).length) { log('invalid', r, off); continue; }
    const s = await make(m);
    const bw = s.bodyOf(wl)!;
    const bb = s.bodyOf(bm)!;
    if (variant === 'no ccd') (s as any).world.forEachRigidBody((rb: any) => rb.setSoftCcdPrediction(0));
    const R = r - 0.04;
    const pts: Vec3[] = [];
    for (const k of [0, 0.25, 0.5, 0.75, 0.9, 1]) for (let i = 0; i < 48; i++) for (const sa of [-HC, 0, HC]) pts.push([k * R * Math.cos((i / 48) * 2 * Math.PI), 1 + sa, k * R * Math.sin((i / 48) * 2 * Math.PI)]);
    let worst = -Infinity;
    for (let i = 0; i < 480 * 5; i++) {
      s.stepFixed(1);
      if (i % 8) continue;
      const tw = s.bodyTransform(bw)!;
      const tb = s.bodyTransform(bb)!;
      for (const q of pts) {
        const e = rotate(conj(tb.q), sub(applyTransform(tw, q), tb.p));
        const t = Math.max(-7, Math.min(7, e[0]));
        worst = Math.max(worst, Math.min(HC - Math.hypot(e[0] - t, e[2] - off), HC - Math.abs(e[1])));
      }
    }
    const c = com(s, bw);
    log(`${variant}: r ${r} beam at in-plane offset ${off}: worst wheel-in-beam ${worst.toFixed(3)}; wheel hub end ${JSON.stringify(c.map((x) => +x.toFixed(3)))} (on the beam = y ≈ 0.92, tilted onto the floor < 0.92)`);
    s.dispose();
  }
}, 1800000);
