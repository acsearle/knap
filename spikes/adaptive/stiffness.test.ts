// Stiffness against inner step k and iterations: long revolute chains with a heavy welded load,
// hanging at rest, pulled by the grab spring at its force cap, and falling from horizontal.
// Run: npx vitest run --config spikes/adaptive/vitest.config.ts spikes/adaptive/stiffness.test.ts
import { it } from 'vitest';
import { writeFileSync } from 'node:fs';
import { ModelBuilder, beam, pin } from '../../src/core/examples';
import type { Model } from '../../src/core/types';
import { Simulation } from './sim';
import type { Vec3 } from '../../src/physics/math';

/**
 * Chain of n 3-hole links from a fixed frame; links alternate layers z = 1, 2. dir 'down': links
 * hang along −Y; 'side': along +X (released horizontal). Load: 5 parallel 7-hole beams welded by
 * pins (one body, mass ≈ 35 cells) on the last pivot. Returns model and the load's body-local point.
 */
function chain(n: number, dir: 'down' | 'side', load: boolean): { model: Model; tip: Vec3 } {
  const b = new ModelBuilder();
  const P = (s: number, z: number): [number, number, number] => (dir === 'down' ? [0, -s, z] : [s, 0, z]);
  const frame = b.add(beam([-2, 0, 0], [0, 0, 0]));
  let z = 0;
  for (let i = 0; i < n; i++) {
    const nz = (i % 2) + 1;
    b.add(beam(P(2 * i, nz), P(2 * i + 2, nz)));
    b.add(pin(P(2 * i, z), P(2 * i, nz)));
    z = nz;
  }
  let tip = P(2 * n, z);
  if (load) {
    // Load block: beams at layers z+1..z+5 along the same line, welded together by two pins each.
    const L = 6;
    for (let l = 1; l <= 5; l++) b.add(beam(P(2 * n, z + l), P(2 * n + L, z + l)));
    b.add(pin(P(2 * n, z), P(2 * n, z + 1))); // pivot to the chain
    for (let l = 1; l < 5; l++) {
      const o = l % 2 ? 2 : 3; // stagger so no cell holds two pins
      b.add(pin(P(2 * n + o, z + l), P(2 * n + o, z + l + 1)));
      b.add(pin(P(2 * n + o + 3, z + l), P(2 * n + o + 3, z + l + 1)));
    }
    tip = P(2 * n + L, z + 3);
  }
  return { model: b.root(frame).build(), tip };
}

interface Cfg { k: number; it: number }
const CFGS: Cfg[] = (process.env.CFGS ?? '1:240,2:120,4:60,8:30,4:120,4:240,8:60,8:120,8:240,1:120,1:60')
  .split(',')
  .map((s) => { const [k, i] = s.split(':').map(Number); return { k: k!, it: i! }; });
const NS = (process.env.NS ?? '10,20').split(',').map(Number);

function make(m: Model, c: Cfg, extra = {}): Promise<Simulation> {
  return Simulation.create(m, { substeps: c.k, innerIterations: c.it, innerFreeIterations: Math.min(c.it, Math.max(1, Math.round(30 / c.k))), ...extra });
}

function tipPos(s: Simulation): Vec3 {
  const last = s.graph.bodies.length - 1;
  return s.massInfo(last)!.com;
}

it('stiffness', async () => {
  const rows: Record<string, unknown>[] = [];
  for (const n of NS) {
    for (const c of CFGS) {
      const row: Record<string, unknown> = { n, k: c.k, it: c.it };
      // 1. Hanging at rest (from the straight-down build pose): mean joint error over the last 0.5 s, load com drop.
      {
        const { model } = chain(n, 'down', true);
        const s = await make(model, c);
        const y0 = tipPos(s)[1];
        let e = 0;
        let cnt = 0;
        for (let i = 0; i < 960; i++) {
          s.stepFixed(1);
          if (i >= 720) { e += s.jointError(); cnt++; }
        }
        row.hangErr = e / cnt;
        row.hangDrop = y0 - tipPos(s)[1];
        row.msPerSimS = (s.tTotal / s.time);
        row.worldFrac = s.tWorld / s.tTotal;
        s.dispose();
      }
      // 2. Grab spring at its cap: target 1000 units below the load's com, after 0.5 s of hanging.
      {
        const { model } = chain(n, 'down', true);
        const s = await make(model, c);
        s.stepFixed(240);
        const last = s.graph.bodies.length - 1;
        const p = tipPos(s);
        s.grab(last, p);
        s.dragTo([p[0] + 300, p[1] - 1000, p[2]]);
        let e = 0;
        let emax = 0;
        let cnt = 0;
        for (let i = 0; i < 480; i++) {
          s.stepFixed(1);
          const je = s.jointError();
          emax = Math.max(emax, je);
          if (i >= 240) { e += je; cnt++; }
        }
        row.pullErr = e / cnt;
        row.pullErrMax = emax;
        s.dispose();
      }
      // 3. Released horizontal (with load), 2 s: max joint error during the swing, final energy vs initial.
      {
        const { model } = chain(n, 'side', true);
        const s = await make(model, c);
        let emax = 0;
        let maxW = 0;
        for (let i = 0; i < 960; i++) {
          s.stepFixed(1);
          emax = Math.max(emax, s.jointError());
          for (const b of s.graph.bodies) { const v = s.bodyVelocity(b.id); if (v) maxW = Math.max(maxW, Math.hypot(...v.w)); }
        }
        row.swingErrMax = emax;
        row.swingMaxW = maxW;
        row.swingGuard = s.guardRemoved;
        s.dispose();
      }
      rows.push(row);
      console.log(JSON.stringify(row));
    }
  }
  writeFileSync(process.env.OUT ?? 'spikes/adaptive/out/stiffness.json', JSON.stringify(rows, null, 1));
});
