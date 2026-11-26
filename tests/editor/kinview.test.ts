import { describe, expect, it } from 'vitest';
import { analyze } from '../../src/core/kinematics';
import { EXAMPLES, buildExample } from '../../src/core/examples';
import { FIXED_BODY_TINT, bodyTint, countsText, kinematicsSummary, meshGlyphSpecs, partTints } from '../../src/editor';
import { meshGlyphSegments } from '../../src/view/glyphs';
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

describe('gear mesh glyphs (§7.4)', () => {
  it('one glyph per gearMeshes entry at its pitch point, following both gears; the view draws two ticks for each', () => {
    expect(meshGlyphSpecs(buildExample('crank-wheel'))).toEqual([]);
    const m = buildExample('gear-train');
    const g = meshGlyphSpecs(m);
    expect(g.length).toBe(2);
    const byPair = Object.fromEntries(g.map((x) => [`${x.followA}-${x.followB}`, x]));
    // Pinion's first 8 (part 2, hub (0, 3, 1)) and the 40 (part 3, hub (0, 0, 1)): pitch point 0.5 from the 8.
    const a = byPair['2-3']!;
    expect([a.rA, a.rB, a.axis]).toEqual([0.5, 2.5, 2]);
    expect(a.pitch).toEqual([0, 2.5, 1]);
    // The pinion's second 8 (hub (0, 3, 2)) and the 24 (part 4, hub (2, 3, 2)).
    const b = byPair['2-4']!;
    expect([b.rA, b.rB]).toEqual([0.5, 1.5]);
    expect(b.pitch).toEqual([0.5, 3, 2]);
    // The view's segments are centred on the same pitch point (structurally a MeshGlyph).
    const segs = meshGlyphSegments(g, () => null);
    expect(segs.length).toBe(4);
    const mid = segs.slice(0, 2).flat().reduce<number[]>((acc, p) => acc.map((v, i) => v + p[i]! / 4), [0, 0, 0]);
    // the two ticks are offset ±along the tangent and overlap by OVER − BACK along the line of centres
    expect(Math.hypot(mid[0]! - a.pitch[0], mid[2]! - a.pitch[2])).toBeLessThan(1e-12);
    expect(countsText(m)).toMatch(/ · 2 meshes$/);
  });
});
