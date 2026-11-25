// Review fapp: arrow keys while a top-bar segmented button (speed or friction) has keyboard focus
// and a part is selected. Run on fapp-dist and on a HEAD build (FAPP_DIST).
import { harness, ev } from './review-fapp-lib.mjs';
import { frames } from './app-lib.mjs';
const h = await harness();
try {
  const c = await h.open('fapp-arrows');
  const p = c.page;
  for (const sel of ['[data-speed="1"]', '[data-friction=off]']) {
    if (!(await p.locator(sel).count())) { console.log(sel, 'absent'); continue; }
    await ev(p, () => window.__knap.loadExample('pendulum'));
    const id = await ev(p, () => window.__knap.getModel().parts[1].id);
    const pos = await ev(p, (id) => window.__knap.partScreenPos(id), id);
    await p.mouse.click(pos.x, pos.y); await frames(p, 2);
    const m0 = await ev(p, () => JSON.stringify(window.__knap.getModel()));
    await p.locator(sel).focus();
    await p.keyboard.press('ArrowLeft'); await frames(p, 2);
    const m1 = await ev(p, () => JSON.stringify(window.__knap.getModel()));
    const st = await ev(p, () => window.__knap.getState());
    console.log(sel, 'selection', st.selection, 'model changed by ArrowLeft:', m0 !== m1, 'historySize', st.historySize, 'message', st.message?.text ?? JSON.stringify(st.message));
  }
} finally { await h.done(); }
