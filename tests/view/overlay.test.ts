// Overlay contrast (fixer, after review): hover highlights, erase bands and ghosts drawn over a part
// of (nearly) their own colour switch to a contrasting variant, so a blue ghost on a blue wheel or a
// red erase band on a red part stays legible (DEVIATIONS §6 "Overlay contrast").
import { describe, expect, it } from 'vitest';
import { OVERLAY_ALT_BLUE, overlayColor } from '../../src/view/viewport';
import { PALETTE } from '../../src/ui/palette';
import { rgba } from '../../src/view/lines';

const ACCENT = '#1f7ae0';
const RED = '#e0322b';
const dist = (a: string, b: string): number => {
  const x = rgba(a);
  const y = rgba(b);
  return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]);
};

describe('overlayColor', () => {
  it('unchanged without a part colour or over a distinct one', () => {
    expect(overlayColor(ACCENT)).toBe(ACCENT);
    expect(overlayColor(ACCENT, '#e2b23a')).toBe(ACCENT);
    expect(overlayColor(RED, '#3b74c4')).toBe(RED);
  });

  it('the accent over a blue part turns orange; red over red turns dark red', () => {
    expect(overlayColor(ACCENT, '#3b74c4')).toBe(OVERLAY_ALT_BLUE);
    const r = overlayColor(RED, '#c8403a');
    expect(r).not.toBe(RED);
    expect(rgba(r)[0]).toBeGreaterThan(rgba(r)[1]); // still a red
  });

  it('on every palette colour the overlay is at least 0.3 (sRGB distance) from the part', () => {
    const cols = (PALETTE as readonly (string | { color: string })[]).map((c) => (typeof c === 'string' ? c : c.color));
    expect(cols.length).toBeGreaterThan(4);
    for (const over of cols)
      for (const base of [ACCENT, RED]) {
        const c = overlayColor(base, over);
        expect(dist(c, over), `${base} over ${over} → ${c}`).toBeGreaterThanOrEqual(0.3);
      }
  });
});
