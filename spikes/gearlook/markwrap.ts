// Stand-in for src/view/markpaint.ts (aliased): gear parts get their painted mark from gearlook.
import type { Part } from '../../src/core';
import * as real from '../../src/view/markpaint';
import { partSignature } from './geomwrap';

export const markColor = real.markColor;
export function markWeights(part: Part, positions: Float32Array, normals: Float32Array): Float32Array {
  const g = globalThis as unknown as { __gearSpecs?: Map<number, unknown>; __gearMarks?: Map<string, Float32Array> };
  if (g.__gearSpecs?.has(part.id)) {
    const m = g.__gearMarks?.get(partSignature(part));
    if (m && m.length === positions.length / 3) return m;
    return new Float32Array(positions.length / 3);
  }
  return real.markWeights(part, positions, normals);
}
