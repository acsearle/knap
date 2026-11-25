import { describe, expect, it } from 'vitest';
import { analyze } from '../../src/core/kinematics';
import { EXAMPLES, buildExample } from '../../src/core/examples';
import { FIXED_BODY_TINT, bodyTint, kinematicsSummary, partTints } from '../../src/editor';
import { modelOf } from './helpers';

const rgb = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));

describe('kinematics overlay', () => {
  it('body tints: stable, distinct, never grey; the fixed body is the neutral grey', () => {
    const tints = Array.from({ length: 24 }, (_, i) => bodyTint(i));
    expect(tints).toEqual(Array.from({ length: 24 }, (_, i) => bodyTint(i)));
    for (const t of tints) expect(t).toMatch(/^#[0-9a-f]{6}$/);
    expect(new Set(tints).size).toBe(24);
    for (const t of tints) {
      const [r, g, b] = rgb(t);
      expect(Math.max(r!, g!, b!) - Math.min(r!, g!, b!)).toBeGreaterThan(60); // saturated
      expect(t).not.toBe(FIXED_BODY_TINT);
    }
    // neighbours differ clearly
    for (let i = 0; i + 1 < tints.length; i++) {
      const a = rgb(tints[i]!);
      const b = rgb(tints[i + 1]!);
      expect(Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!)).toBeGreaterThan(60);
    }
    expect(bodyTint(3, true)).toBe(FIXED_BODY_TINT);
  });

  it('part tints follow bodies', () => {
    const m = buildExample('four-bar');
    const g = analyze(m);
    const t = partTints(g);
    expect(t.size).toBe(m.parts.length);
    for (const [pid, bid] of g.bodyOfPart) {
      const fixed = g.bodies[bid]!.fixed;
      expect(t.get(pid)).toBe(fixed ? FIXED_BODY_TINT : bodyTint(bid));
    }
  });

  it('summary line', () => {
    expect(kinematicsSummary(modelOf())).toBe('0 parts');
    expect(kinematicsSummary(buildExample('four-bar'))).toBe('8 parts · 4 bodies (1 fixed) · 4 joints: 4 revolute');
    for (const e of EXAMPLES) expect(kinematicsSummary(buildExample(e.name))).toMatch(/^\d+ parts · \d+ bod/);
  });
});
