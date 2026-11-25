// Review fapp: the friction control itself — layout, keyboard, blur rule, status text.
import { join } from 'node:path';
import { harness, check, ev, OUT_DIR } from './review-fapp-lib.mjs';
import { frames, press, state, status } from './app-lib.mjs';

const h = await harness();
try {
  // ---- layout at several sizes, edit and simulate
  for (const [w, hh, dpr] of [[1280, 720, 1], [1440, 900, 1], [1920, 1080, 1], [1280, 720, 2], [1920, 1080, 2], [1024, 768, 1]]) {
    const c = await h.open(`fapp-${w}`, { width: w, height: hh, deviceScaleFactor: dpr });
    const p = c.page;
    const lay = async (label) => {
      const r = await ev(p, () => {
        const top = document.querySelector('.topbar');
        const items = Array.from(top.querySelectorAll('button, label, .brand, .seg-label, .swatch')).filter((e) => e.getClientRects().length);
        const boxes = items.map((e) => { const b = e.getBoundingClientRect(); return { n: e.dataset.action || e.dataset.speed || e.dataset.friction || e.className || e.textContent, x: b.x, r: b.right, y: b.y, b: b.bottom, sw: e.scrollWidth, cw: e.clientWidth }; });
        const ov = [];
        for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
          const a = boxes[i], c = boxes[j];
          if (items[i].contains(items[j]) || items[j].contains(items[i])) continue;
          if (Math.min(a.r, c.r) - Math.max(a.x, c.x) > 0.5 && Math.min(a.b, c.b) - Math.max(a.y, c.y) > 0.5) ov.push(`${a.n}/${c.n}`);
        }
        const trunc = boxes.filter((b) => b.sw > b.cw + 0.5).map((b) => b.n);
        const out = boxes.filter((b) => b.r > top.getBoundingClientRect().right + 0.5 || b.x < 0).map((b) => b.n);
        const fr = document.querySelector('[data-role=friction]').getBoundingClientRect();
        const sp = document.querySelector('[data-speed]').parentElement.getBoundingClientRect();
        const dis = Array.from(document.querySelectorAll('[data-friction]')).map((b) => b.disabled);
        const disSpeed = Array.from(document.querySelectorAll('[data-speed]')).map((b) => b.disabled);
        return { overflow: top.scrollWidth - top.clientWidth, ov, trunc, out, frTop: fr.top, frH: fr.height, spTop: sp.top, spH: sp.height, dis, disSpeed, opacity: getComputedStyle(document.querySelector('[data-friction]')).opacity };
      });
      check(`${w}x${hh}@${dpr} ${label}: no overflow/overlap/truncation; aligned with speed; enabled`, r.overflow <= 0 && !r.ov.length && !r.trunc.length && !r.out.length && Math.abs(r.frTop - r.spTop) < 0.6 && Math.abs(r.frH - r.spH) < 0.6 && r.dis.every((d) => !d), r);
    };
    await lay('edit');
    await c.shot(`review-fapp-topbar-${w}x${hh}@${dpr}-edit`, { clip: { x: 0, y: 0, width: w, height: 44 } });
    await ev(p, () => window.__knap.stepSim(1));
    await frames(p, 2);
    await lay('simulate(paused)');
    await c.shot(`review-fapp-topbar-${w}x${hh}@${dpr}-sim`, { clip: { x: 0, y: 0, width: w, height: 44 } });
    if (w === 1280 && dpr === 1) await c.shot('review-fapp-full-1280-sim');
  }

  // ---- keyboard operation
  {
    const c = await h.open('fapp-kbd');
    const p = c.page;
    // Tab from the start of the document until a friction button is focused.
    await p.mouse.click(5, 700); // somewhere neutral (status bar)
    await ev(p, () => document.activeElement && document.activeElement.blur());
    let found = null;
    const order = [];
    for (let i = 0; i < 60; i++) {
      await p.keyboard.press('Tab');
      const a = await ev(p, () => ({ f: document.activeElement?.dataset?.friction ?? null, n: document.activeElement?.dataset?.action || document.activeElement?.dataset?.speed || document.activeElement?.tagName }));
      order.push(a.f ? `F:${a.f}` : a.n);
      if (a.f === 'off') { found = i + 1; break; }
    }
    check('Tab reaches the Off friction button', found !== null, { tabs: found, order: order.join(' ') });
    // focus ring visible?
    const ring = await ev(p, () => { const s = getComputedStyle(document.activeElement); return { outline: s.outlineStyle + ' ' + s.outlineWidth + ' ' + s.outlineColor, shadow: s.boxShadow }; });
    check('focused friction button shows a focus indicator', ring.outline.split(' ')[0] !== 'none' || ring.shadow !== 'none', ring);
    await c.shot('review-fapp-kbd-focus', { clip: { x: 700, y: 0, width: 580, height: 44 } });
    await p.keyboard.press('Space');
    await frames(p, 2);
    let st = await state(p);
    check('Space on focused Off sets level off and does not play', st.friction === 'off' && st.mode === 'edit', { friction: st.friction, mode: st.mode });
    await p.keyboard.press('Tab');
    await p.keyboard.press('Enter');
    await frames(p, 2);
    st = await state(p);
    check('Tab, Enter sets Low and does not play', st.friction === 'low' && st.mode === 'edit', { friction: st.friction, mode: st.mode });
    // Arrow keys within the group (common for segmented controls) — report what they do.
    const before = await ev(p, () => document.activeElement?.dataset?.friction);
    await p.keyboard.press('ArrowRight');
    await frames(p, 1);
    const after = await ev(p, () => ({ f: document.activeElement?.dataset?.friction, lvl: window.__knap.getState().friction }));
    console.log('INFO arrow right in friction group:', before, '->', after);
    // With a part selected, arrows while friction focused: do they move the part?
    await ev(p, () => window.__knap.loadExample('pendulum'));
    const m0 = await ev(p, () => JSON.stringify(window.__knap.getModel()));
    const sel = await ev(p, () => { const m = window.__knap.getModel(); return m.parts[m.parts.length - 1].id; });
    // select via clicking the part
    const pos = await ev(p, (id) => window.__knap.partScreenPos(id), sel);
    await p.mouse.click(pos.x, pos.y);
    await frames(p, 2);
    const selected = (await state(p)).selection;
    await p.locator('[data-friction=realistic]').focus();
    await p.keyboard.press('ArrowLeft');
    await frames(p, 2);
    const m1 = await ev(p, () => JSON.stringify(window.__knap.getModel()));
    console.log('INFO selected', selected, 'arrow with friction button focused changed model:', m0 !== m1);
    check('ArrowLeft while the friction control has keyboard focus does not edit the model', m0 === m1, { selected });
    if (m0 !== m1) await p.keyboard.press(process.platform === 'darwin' ? 'Meta+z' : 'Control+z');
  }

  // ---- mouse click then Space plays (blur rule)
  {
    const c = await h.open('fapp-blur');
    const p = c.page;
    await press(p, '[data-friction=off]');
    await p.waitForTimeout(50);
    const act = await ev(p, () => document.activeElement?.tagName + ':' + (document.activeElement?.dataset?.friction ?? ''));
    await p.keyboard.press('Space');
    await p.waitForFunction(() => window.__knap.getState().mode === 'simulate', null, { timeout: 30000 }).catch(() => {});
    const st = await state(p);
    check('mouse click on friction then Space plays', st.mode === 'simulate' && st.friction === 'off', { active: act, mode: st.mode, friction: st.friction });
    const sim = await ev(p, () => window.__knap.simInfo());
    check('Play after clicking Off runs at mu=0', sim?.jointFriction === 0, sim);
    // Click Real while simulating, then Space pauses (not re-activating the button)
    await press(p, '[data-friction=realistic]');
    await p.waitForTimeout(50);
    await p.keyboard.press('Space');
    await frames(p, 2);
    const st2 = await state(p);
    const sim2 = await ev(p, () => window.__knap.simInfo());
    check('click Real while running then Space pauses; mu=0.2', st2.paused === true && sim2.jointFriction === 0.2 && st2.friction === 'realistic', { paused: st2.paused, mu: sim2.jointFriction });
    const s = await status(p);
    console.log('INFO status after Space:', s.message);
    await press(p, '[data-friction=low]');
    console.log('INFO status after Low while paused:', (await status(p)).message);
    await press(p, '[data-friction=off]');
    console.log('INFO status after Off while paused:', (await status(p)).message);
    await press(p, '[data-friction=realistic]');
    console.log('INFO status after Real while paused:', (await status(p)).message);
    // Hover tooltip text
    const titles = await ev(p, () => Array.from(document.querySelectorAll('[data-friction]')).map((b) => b.title));
    console.log('INFO titles:', JSON.stringify(titles));
    const help = await ev(p, () => null);
  }
  // ---- help dialog row
  {
    const c = await h.open('fapp-help');
    const p = c.page;
    await p.keyboard.press('?');
    await frames(p, 2);
    const txt = await ev(p, () => document.querySelector('dialog[open], [role=dialog]:not([hidden])')?.innerText ?? '');
    const line = txt.split('\n').filter((l) => /fric/i.test(l));
    console.log('INFO help friction lines:', JSON.stringify(line));
    await c.shot('review-fapp-help');
  }
} finally {
  await h.done();
}
