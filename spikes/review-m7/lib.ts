// Shared helpers for the m7 sim/geometry verification sweeps (reviewer "verify-sim").
import { appendFileSync, mkdirSync } from 'node:fs';
import type { Cell, Model } from '../../src/core/types';
import { Simulation } from '../../src/physics/sim';
import type { SimOptions } from '../../src/physics/sim';

export const LOGDIR = process.env.VERIFY_SIM_LOG ?? '/private/tmp/claude-501/-Users-antony-Desktop-knap-nosync/7e685b98-2385-4c25-8c1e-9d77a71d1d8f/scratchpad/verify-sim';
mkdirSync(LOGDIR, { recursive: true });
export function logger(name: string) {
  return (...a: unknown[]) => {
    const line = a.map((x) => (typeof x === 'string' ? x : typeof x === 'number' ? fmt(x) : JSON.stringify(x))).join(' ');
    appendFileSync(`${LOGDIR}/${name}.log`, line + '\n');
    console.log(line);
  };
}
export function fmt(x: number): string {
  if (!Number.isFinite(x)) return String(x);
  if (x === 0) return '0';
  const a = Math.abs(x);
  return a >= 1e4 || a < 1e-3 ? x.toExponential(2) : x.toFixed(4);
}

/** Model translated by an integer offset (cells only; ids, root, flags kept). */
export function shifted(m: Model, d: [number, number, number]): Model {
  return {
    ...m,
    parts: m.parts.map((p) => ({ ...p, cells: p.cells.map((c): Cell => ({ ...c, x: c.x + d[0], y: c.y + d[1], z: c.z + d[2] })) })),
  };
}

/** FNV-1a over the float64 bits of every body's transform (or 'removed'). */
export function stateHash(s: Simulation): string {
  let h = 0x811c9dc5;
  const f = new Float64Array(1);
  const u = new Uint8Array(f.buffer);
  for (const b of s.graph.bodies) {
    const t = s.bodyTransform(b.id);
    const vals = t ? [...t.p, ...t.q] : [NaN];
    for (const v of vals) {
      f[0] = v;
      for (const byte of u) h = Math.imul(h ^ byte, 0x01000193) >>> 0;
    }
  }
  return h.toString(16);
}

export async function sim(m: Model, o: SimOptions = {}): Promise<Simulation> {
  return Simulation.create(m, o);
}

export function com(s: Simulation, b: number): [number, number, number] {
  return s.massInfo(b)!.com as [number, number, number];
}
