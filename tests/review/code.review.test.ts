// Reviewer "code": app-facing core behaviour found while reviewing File ▸ Open.
import { describe, expect, it } from 'vitest';
import { parseModelFile } from '../../src/editor';

describe('review(code): Open of a large valid file without nextPartId', () => {
  it('loads (nextPartId is optional in files)', () => {
    const parts = Array.from({ length: 150_000 }, (_, i) => ({ id: i + 1, color: '#3b74c4', cells: [{ x: 0, y: 0, z: i * 2, kind: 'pinHole', axis: 1 }] }));
    const r = parseModelFile(JSON.stringify({ version: 1, rootPartId: 1, parts }));
    // Fails today: deserialize computes Math.max(...ids) (src/core/model.ts:637) → RangeError.
    expect(r.ok ? 'ok' : r.message).toBe('ok');
  }, 60_000);
});
