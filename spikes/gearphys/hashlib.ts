// Trajectory hash shared by the baseline (old sources) and tests/physics/gears-nochange.test.ts.
export interface Hashable {
  stepFixed(n?: number): void;
  graph: { bodies: readonly { id: number }[] };
  bodyTransform(id: number): { p: number[]; q: number[] } | null;
  bodyVelocity(id: number): { v: number[]; w: number[] } | null;
}
export function trajHash(s: Hashable, steps: number, every: number): string {
  let h = 0x811c9dc5;
  let h2 = 0x12345678;
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
    s.stepFixed(1);
    if (i % every) continue;
    for (const b of s.graph.bodies) {
      const t = s.bodyTransform(b.id);
      const v = s.bodyVelocity(b.id);
      if (!t || !v) { mix(-1); continue; }
      for (const x of [...t.p, ...t.q, ...v.v, ...v.w]) mix(x);
    }
  }
  return h.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0');
}
