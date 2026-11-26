// Overlay treatment (DESIGN §7.3 "Hue keeps its meaning on every part colour"): hover highlights,
// erase bands and ghosts keep their semantic hue on every part colour — the accent always means "a
// click will do this", red always "refused" or "erase". Over a part close to that colour the
// treatment changes instead: white fill, the outline in the semantic colour drawn bold (double
// width, over the white under-stroke). (Replaces the first version's hue switch: orange over blue
// parts, dark red over red ones.)
import { describe, expect, it } from 'vitest';
import { OVERLAY_CLOSE, OVERLAY_CLOSE_FILL, overlayStyle } from '../../src/view/viewport';
import { PALETTE } from '../../src/ui/palette';
import { rgba } from '../../src/view/lines';

const ACCENT = '#1f7ae0';
const RED = '#e0322b';
const dist = (a: string, b: string): number => {
  const x = rgba(a);
  const y = rgba(b);
  return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]);
};
const cols = (PALETTE as readonly (string | { color: string })[]).map((c) => (typeof c === 'string' ? c : c.color));

describe('overlayStyle', () => {
  it('unchanged without a part colour or over a distinct one', () => {
    expect(overlayStyle(ACCENT)).toEqual({ line: ACCENT, fill: ACCENT, bold: false });
    expect(overlayStyle(ACCENT, '#e2b23a')).toEqual({ line: ACCENT, fill: ACCENT, bold: false });
    expect(overlayStyle(RED, '#3b74c4')).toEqual({ line: RED, fill: RED, bold: false });
  });

  it('over a close colour: the hue is kept, the fill turns white and the outline bold', () => {
    expect(overlayStyle(ACCENT, '#3b74c4')).toEqual({ line: ACCENT, fill: OVERLAY_CLOSE_FILL, bold: true });
    expect(overlayStyle(RED, '#c8403a')).toEqual({ line: RED, fill: OVERLAY_CLOSE_FILL, bold: true });
    expect(OVERLAY_CLOSE_FILL).toBe('#ffffff');
  });

  it('on every palette colour: the line is always the semantic colour; bold exactly where it is close', () => {
    expect(cols.length).toBe(8);
    const bold: string[] = [];
    for (const over of cols)
      for (const base of [ACCENT, RED]) {
        const st = overlayStyle(base, over);
        expect(st.line, `${base} over ${over}`).toBe(base);
        expect(st.bold, `${base} over ${over}`).toBe(dist(base, over) < OVERLAY_CLOSE);
        expect(st.fill).toBe(st.bold ? OVERLAY_CLOSE_FILL : base);
        // what the part shows through: the fill is never close to the part either
        expect(dist(st.fill, over), `${base} over ${over}: fill ${st.fill}`).toBeGreaterThanOrEqual(OVERLAY_CLOSE);
        if (st.bold) bold.push(`${base}/${over}`);
      }
    // the palette's blue for the accent; red and orange for red
    expect(bold.sort()).toEqual([`${ACCENT}/${cols.find((c) => dist(c, ACCENT) < OVERLAY_CLOSE)}`, ...cols.filter((c) => dist(c, RED) < OVERLAY_CLOSE).map((c) => `${RED}/${c}`)].sort());
    console.log(`bold cells: ${bold.join(', ')}`);
  });
});
