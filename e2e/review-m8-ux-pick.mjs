// Hover sweep over a lone 40-tooth gear (axis X, Y, Z), several cameras, each tool, front and Alt.
import { session, setModel, M, C, status, frames, K, scr } from './review-m8-ux-lib.mjs';
const s = await session();
const { page, errors, snap } = await s.open('pick');
const log = (...a) => console.log(...a);
const settle = async () => { await page.waitForFunction(() => !window.__knap.getState().animating); await frames(page, 2); };
const TIP = 2.5 + 3 / 32;
const basis = (axis) => (axis === 0 ? [1, 2] : axis === 1 ? [2, 0] : [0, 1]);
const bad = [];
let total = 0;
for (const axis of [2, 0, 1]) {
  await setModel(page, M([[C(0, 0, 0, 'pinHole', axis, 2.5, true)]], { version: 3 }));
  for (const view of ['iso', 'back-left-top']) {
    await K(page, (v) => window.__knap.setView(v), view);
    await K(page, () => window.__knap.fit());
    await settle();
    const cam = await K(page, () => window.__knap.camera());
    // which face of the gear faces the camera? camera direction from yaw/pitch: use projection of axis
    const [u, v] = basis(axis);
    for (const side of [1, -1]) {
      for (const tool of ['v', '1', 't']) {
        await page.keyboard.press(tool);
        for (const alt of (tool === '1' ? [false, true] : [false])) {
          if (alt) await page.keyboard.down('Alt');
          for (const rho of [0.2, 1.9, 2.52, 2.75]) {
            for (const th of [0.3, 1.9, 3.5, 5.0]) {
              const w = [0, 0, 0];
              w[axis] = 0.5 * side; w[u] = rho * Math.cos(th); w[v] = rho * Math.sin(th);
              const p = await scr(page, w);
              if (p.x < 70 || p.x > 1040 || p.y < 50 || p.y > 690) continue;
              await page.mouse.move(p.x, p.y);
              await frames(page, 1);
              const st = await status(page);
              total++;
              const onGear = /Part 1|part 1/.test(st.hover + st.hint);
              // facing: is this face visible from the camera? check pick info via hover text later
              const G = [0, 0, 0]; G[axis] = 0; G[u] = Math.round(w[u]); G[v] = Math.round(w[v]);
              const rec = { axis, view, side, tool, alt, rho, th: th.toFixed(1), hover: st.hover, hint: st.hint };
              if (rho <= TIP - 0.05 && !onGear) bad.push({ why: 'inside tip disc but not picked', ...rec });
              if (rho >= TIP + 0.1 && onGear) rec.note = 'outside tip but picked (maybe through/behind)';
              if (rec.note) bad.push({ why: rec.note, ...rec });
              if (process.env.V) console.log(JSON.stringify(rec));
            }
          }
          if (alt) await page.keyboard.up('Alt');
        }
      }
    }
    await page.keyboard.press('v');
  }
}
log('total samples', total, 'anomalies', bad.length);
const groups = {};
for (const b of bad) { const k = `${b.why} | axis ${b.axis} ${b.view} side ${b.side} tool ${b.tool} alt ${b.alt}`; (groups[k] ??= []).push(`rho ${b.rho} th ${b.th}: "${b.hover}" / "${b.hint}"`); }
for (const [k, v] of Object.entries(groups)) { log(k); for (const x of v.slice(0, 3)) log('   ', x); if (v.length > 3) log('    …', v.length); }
log('errors', errors);
await s.close();
