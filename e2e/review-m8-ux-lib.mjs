// Reviewer "ux" (milestone 8 gears): shared helpers. Run scripts with
//   E2E_DIST=e2e/out/review-m8-ux-dist node e2e/review-m8-ux-<name>.mjs
import { launchBrowser, openPage, startServer } from './lib.mjs';
import { frames, openApp, status, model, state, hover, clickAt } from './app-lib.mjs';
export { frames, openApp, status, model, state, hover, clickAt };

export const C = (x, y, z, kind = 'pinHole', axis = 2, rim, teeth) => ({ x, y, z, kind, axis, ...(rim ? { rim } : {}), ...(teeth ? { teeth: true } : {}) });
export const M = (parts, extra = {}) => ({
  version: 3, rootPartId: 1, nextPartId: parts.length + 1, ground: false, fixRoot: true, ...extra,
  parts: parts.map((p, i) => ({ id: i + 1, color: p.color ?? '#a8adb2', cells: p.cells ?? p })),
});
export const K = (page, fn, arg) => page.evaluate(fn, arg);
export const setModel = (page, m) => K(page, (m) => window.__knap.setModel(m), m);
export const canon = (v) => JSON.stringify(v, (k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => (a < b ? -1 : 1))) : x));
export const face = (page, id, ci, dir) => K(page, ([a, b, d]) => window.__knap.clientPosOfCellFace(a, b, d), [id, ci, dir]);
export const virt = (page, id, ci, pos, dir) => K(page, ([a, b, q, d]) => window.__knap.clientPosOfVirtualCell(a, b, q, d), [id, ci, pos, dir]);
export const scr = (page, p) => K(page, (p) => window.__knap.screenPos(p), p);
export const OUT = new URL('../spikes/review-m8/ux/out/', import.meta.url).pathname;

export async function session() {
  const server = await startServer();
  const browser = await launchBrowser();
  const ctxs = [];
  return {
    async open(name, viewport = {}) {
      const ctx = await openPage(browser, server.url, name, viewport);
      ctxs.push(ctx);
      await openApp(ctx.page, server.url);
      await frames(ctx.page, 2);
      ctx.snap = async (f) => { await ctx.page.screenshot({ path: OUT + f + '.png' }); return OUT + f + '.png'; };
      return ctx;
    },
    async close() {
      for (const c of ctxs) await c.close().catch(() => {});
      await browser.close();
      await server.close();
    },
  };
}
/** Status-cell overflow: is the text wider than its box? */
export const overflow = (page) => K(page, () => [...document.querySelectorAll('[data-role^=status-]')].map((e) => ({ role: e.dataset.role, text: e.textContent, clipped: e.scrollWidth > e.clientWidth + 1, sw: e.scrollWidth, cw: e.clientWidth })));
