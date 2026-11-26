// Q7 determinism: (1) every built-in example in the GEARSIM copy reproduces the product
// Simulation's trajectory hash bit for bit (μ 0 against the recorded frictionless hashes, μ 0.2
// against src/physics/sim.ts live); (2) two runs of models with meshes (engage / release / snap)
// give identical hashes.
import { EXAMPLES } from '../../src/core/examples';
import { Simulation as Product } from '../../src/physics/sim';
import { Simulation } from './gearsim';
import { out, train } from './lib';
import { selector } from './swing';
import { slider } from './slide';

type Sim = { stepFixed(n?: number): void; graph: { bodies: { id: number }[] }; bodyTransform(id: number): { p: number[]; q: number[] } | null; bodyVelocity(id: number): { v: number[]; w: number[] } | null; dispose(): void };

function trajectoryHash(s: Sim, steps: number, every: number, each?: (i: number) => void): string {
  let h = 0x811c9dc5 >>> 0;
  let h2 = 0x12345678 >>> 0;
  const buf = new Float64Array(1);
  const bytes = new Uint8Array(buf.buffer);
  const mix = (x: number) => {
    buf[0] = x;
    for (const b of bytes) {
      h = Math.imul(h ^ b, 0x01000193) >>> 0;
      h2 = Math.imul(h2 ^ b, 0x5bd1e995) >>> 0;
    }
  };
  for (let i = 1; i <= steps; i++) {
    each?.(i);
    s.stepFixed(1);
    if (i % every) continue;
    for (const b of s.graph.bodies) {
      const t = s.bodyTransform(b.id);
      const v = s.bodyVelocity(b.id);
      if (!t || !v) {
        mix(-1);
        continue;
      }
      for (const x of [...t.p, ...t.q, ...v.v, ...v.w]) mix(x);
    }
  }
  return h.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0');
}

const FRICTIONLESS_HASHES: Record<string, string> = {
  pendulum: 'be16d0ea302f91af',
  'triple-pendulum': '8045f3612e003414',
  'four-bar': '0ff7acea870a0f1f',
  parallelogram: '707e3d76770f0d85',
  'sliding-axle': '0c9d98094512d78a',
  'weld-test': '8d4f0b236fc9b568',
  collision: '2a1e19a7ce8ac25a',
};

let bad = 0;
for (const ex of EXAMPLES) {
  for (const mu of [0, 0.2]) {
    const g = await Simulation.create(ex.build(), { jointFriction: mu });
    const hg = trajectoryHash(g as unknown as Sim, 1440, 8);
    const cand = g.meshes.length;
    const eng = g.meshes.filter((m) => m.engagements > 0).length;
    g.dispose();
    const p = await Product.create(ex.build(), { jointFriction: mu });
    const hp = trajectoryHash(p as unknown as Sim, 1440, 8);
    p.dispose();
    const rec = mu === 0 ? FRICTIONLESS_HASHES[ex.name] : undefined;
    const ok = hg === hp && (rec === undefined || rec === hg);
    if (!ok) bad++;
    out(`${ex.name.padEnd(16)} mu ${mu}: gearsim ${hg} product ${hp}${rec ? ` recorded ${rec}` : ''} ${ok ? 'SAME' : 'DIFFERENT'} (gear candidates ${cand}, engaged ${eng})`);
  }
}
out(`examples differing: ${bad}`);

// Two runs with meshes.
const runs: [string, () => Promise<string>][] = [
  ['swing selector (shaft, μ 0.2, reversing drive)', async () => {
    const sel = selector('shaft');
    const s = await Simulation.create(sel.model, { jointFriction: 0.2 });
    const sun = s.bodyOf(sel.sun)!;
    const h = trajectoryHash(s as unknown as Sim, 960, 4, (i) => s.setDrive(sun, [0, (Math.floor(i / 240) % 2 ? -1 : 1) * 3000, 0]));
    const e = s.meshes.map((m) => m.engagements).join(',');
    s.dispose();
    return `${h} (engagements ${e})`;
  }],
  ['slider (μ 0.2, grab in/out)', async () => {
    const sl = slider();
    const s = await Simulation.create(sl.model, { jointFriction: 0.2 });
    const B = s.bodyOf(sl.B)!;
    s.grab(B, [2, 0, 3]);
    s.setDrive(s.bodyOf(sl.A)!, [0, 0, 800]);
    const h = trajectoryHash(s as unknown as Sim, 960, 4, (i) => s.dragTo([2, 0, Math.floor(i / 240) % 2 ? 3 : 2]));
    const e = s.meshes[0]!.engagements;
    s.dispose();
    return `${h} (engagements ${e})`;
  }],
  ['1:25 crane drop (μ 0, k 2)', async () => {
    const t = train([{ x: 0, col: [0.5] }, { x: 3, col: [2.5, 0.5] }, { x: 6, col: [null, 2.5], arm: { len: 7 } }]);
    const s = await Simulation.create(t.model, { jointFriction: 0, substeps: 2 });
    const h = trajectoryHash(s as unknown as Sim, 960, 4);
    s.dispose();
    return h;
  }],
];
for (const [name, fn] of runs) {
  const a = await fn();
  const b = await fn();
  out(`${name}: ${a} / ${b} ${a === b ? 'IDENTICAL' : 'DIFFERENT'}`);
}
process.exit(0);
