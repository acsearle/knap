// Review: overlays cleared → image identical to the baseline. node e2e/review-view-clear.mjs
import { READBACK, check, harness, results } from './review-view-lib.mjs';
const H = await harness();
try {
  const c = await H.open('example=four-bar&anim=0', { width: 800, height: 500 });
  const r = await c.page.evaluate(`(() => {
    const vp = window.__view.vp;
    const a = ${READBACK}.px;
    vp.setSelection([3]); vp.setHoverFace({ cell: [4, 2, 2], dir: 4 }); vp.setHoverCell({ cell: [2, 0, 0] });
    vp.setGhost({ cell: { x: 7, y: 0, z: 1, kind: 'pinHole', axis: 2 }, valid: true });
    vp.setJointGlyphs([{ type: 'cylindrical', origin: [0, 0, 0], axis: 0 }]);
    vp.cube.setHover([1, 1, 1]);
    vp.renderNow();
    vp.setSelection([]); vp.setHoverFace(null); vp.setHoverCell(null); vp.setGhost(null); vp.setJointGlyphs(null); vp.cube.setHover(null);
    const b = ${READBACK}.px;
    let diff = 0; for (let i = 0; i < a.length; i++) if (Math.abs(a[i] - b[i]) > 2) diff++;
    return { diff };
  })()`);
  check('overlays set then cleared leave the image unchanged', r.diff === 0, r);
} finally { await H.done(); }
process.exit(results.some((r) => !r.ok) ? 1 : 0);
