// Reviewer "look" (m9): the toggle, key C, legend, top bar widths, persistence, combined overlays.
//   E2E_DIST=e2e/out/review-m9-look-dist node e2e/review-m9-look-ui.mjs
import { K, frames, session } from './review-m8-look-lib.mjs';

const S = await session();
const st = (page) => K(page, () => window.__knap.getState());
const on = async (page) => (await st(page)).showColliders;
try {
  // ---- top bar at several widths
  for (const [w, h, d] of [[1024, 700, 1], [1280, 720, 1], [1280, 720, 2], [1440, 900, 1], [1920, 1080, 1]]) {
    const { page, shot } = await S.open(`m9look-bar-${w}-${d}`, { width: w, height: h, deviceScaleFactor: d });
    for (const mode of ['edit', 'sim']) {
      if (mode === 'sim') await K(page, () => window.__knap.stepSim(1));
      await frames(page, 2);
      const r = await page.evaluate(() => {
        const top = document.querySelector('.topbar');
        const kids = Array.from(top.children).filter((e) => e.getClientRects().length);
        const boxes = kids.map((e) => { const b = e.getBoundingClientRect(); return { n: (e.dataset.action || e.dataset.role || e.className).slice(0, 18), x: +b.x.toFixed(1), r: +b.right.toFixed(1), y: +b.y.toFixed(1), b: +b.bottom.toFixed(1) }; });
        const overl = [];
        for (let i = 1; i < boxes.length; i++) if (boxes[i].x < boxes[i - 1].r - 0.5) overl.push(`${boxes[i - 1].n}/${boxes[i].n}`);
        const clipped = Array.from(top.querySelectorAll('button, label, span')).filter((e) => e.getClientRects().length && e.scrollWidth > e.clientWidth + 0.5 && getComputedStyle(e).display !== 'inline').map((e) => e.textContent.trim()).slice(0, 10);
        const sp = top.querySelector('.spacer');
        const lab = document.querySelector('[data-action=colliders]').closest('label');
        return { overflow: top.scrollWidth - top.clientWidth, height: top.getBoundingClientRect().height, spacer: sp ? sp.getBoundingClientRect().width : null, overl, clipped, rows: new Set(boxes.map((b) => Math.round((b.y + b.b) / 2))).size, label: { fs: getComputedStyle(lab).fontSize, kfs: getComputedStyle(document.querySelector('[data-action=kinematics]').closest('label')).fontSize, otherFs: getComputedStyle(document.querySelector('.topbar button')).fontSize }, lastR: Math.max(...boxes.map((b) => b.r)) };
      });
      console.log(`bar ${w}x${h}@${d} ${mode}: ${JSON.stringify(r)}`);
      await shot(`review-m9-look-bar-${w}-d${d}-${mode}`, { clip: { x: 0, y: 0, width: w, height: 40 } });
    }
  }

  const { page, shot } = await S.open('m9look-ui', { width: 1280, height: 720, deviceScaleFactor: 1 });
  await K(page, () => window.__knap.loadExample('cart'));
  await K(page, () => window.__knap.home());
  await page.mouse.move(640, 714);
  // tooltip + help text
  console.log('tooltip:', await page.evaluate(() => document.querySelector('[data-action=colliders]').closest('label').title));
  await page.keyboard.press('?');
  await frames(page, 1);
  const help = await page.locator('[data-role=help]').innerText();
  console.log('help line:', help.split('\n').filter((l) => /collider|kinematic/i.test(l)).join(' || '));
  // C while help open
  await page.keyboard.press('c');
  console.log('C with help open toggles?', await on(page));
  await shot('review-m9-look-help');
  await page.keyboard.press('Escape');
  // modifiers
  for (const k of ['Control+c', 'Meta+c', 'Alt+c', 'Shift+c', 'Shift+C']) {
    const b = await on(page);
    await page.keyboard.press(k);
    await frames(page, 1);
    const a = await on(page);
    console.log(`${k}: ${b} -> ${a}`);
    if (a) await K(page, () => window.__knap.setShowColliders(false));
  }
  // focus after click, then Space
  await page.click('[data-action=colliders]');
  await frames(page, 1);
  const focus = await page.evaluate(() => `${document.activeElement?.tagName}.${document.activeElement?.className}`);
  await page.keyboard.press(' ');
  await frames(page, 2);
  console.log(`after click: on=${await on(page)} focus=${focus}; after Space: mode=${(await st(page)).mode} on=${await on(page)}`);
  if ((await st(page)).mode !== 'edit') { await page.keyboard.press('Escape'); await page.waitForFunction(() => window.__knap.getState().mode === 'edit'); }
  // persistence: Play / Stop / New / Examples menu / undo
  await K(page, () => window.__knap.setShowColliders(true));
  await page.keyboard.press(' ');
  await page.waitForFunction(() => window.__knap.getState().mode === 'simulate');
  await frames(page, 4);
  console.log('after Play: on', await on(page), 'legend hidden', await page.locator('[data-role=collider-legend]').isHidden());
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => window.__knap.getState().mode === 'edit');
  console.log('after Stop: on', await on(page));
  await page.click('[data-action=new]').catch(() => {});
  await frames(page, 3);
  const afterNew = await page.evaluate(() => ({ on: window.__knap.getState().showColliders, parts: window.__knap.getModel().parts.length, legend: document.querySelector('[data-role=collider-legend]').innerText.replace(/\n/g, ' | '), legendHidden: document.querySelector('[data-role=collider-legend]').hidden }));
  console.log('after New:', JSON.stringify(afterNew));
  await shot('review-m9-look-new-empty');
  await K(page, () => window.__knap.loadExample('cart'));
  await frames(page, 2);
  console.log('after load: on', await on(page));

  // legend counts update on edit: select a wheel by clicking, delete it
  await K(page, () => window.__knap.home());
  await frames(page, 2);
  const m = await K(page, () => window.__knap.getModel());
  const wheel = m.parts.find((p) => p.cells.some((c) => c.rim));
  const wp = await K(page, (id) => window.__knap.partScreenPos(id), wheel.id);
  await page.mouse.click(wp.x, wp.y);
  await frames(page, 2);
  console.log('selected', (await st(page)).selection, 'wanted', wheel.id);
  const panel = await page.evaluate(() => {
    const leg = document.querySelector('[data-role=collider-legend]');
    const sc = (function up(e) { while (e && e !== document.body) { const s = getComputedStyle(e); if (/(auto|scroll)/.test(s.overflowY) && e.scrollHeight > e.clientHeight) return e; e = e.parentElement; } return null; })(leg);
    const del = Array.from(document.querySelectorAll('button')).find((b) => /delete/i.test(b.textContent) && b.getClientRects().length);
    const vh = innerHeight;
    const db = del?.getBoundingClientRect();
    const lb = leg.getBoundingClientRect();
    const pn = leg.parentElement.getBoundingClientRect();
    return { legend: [lb.x, lb.y, lb.right, lb.bottom].map(Math.round), panel: [pn.x, pn.y, pn.right, pn.bottom].map(Math.round), scroller: sc ? [sc.className, sc.scrollHeight, sc.clientHeight] : null, del: db ? [Math.round(db.y), Math.round(db.bottom)] : null, vh };
  });
  console.log('panel with selection + legend:', JSON.stringify(panel));
  await shot('review-m9-look-select-wheel-legend');
  const before = await page.evaluate(() => document.querySelector('[data-role=collider-legend]').innerText.replace(/\n/g, ' | '));
  await page.keyboard.press('Delete');
  await frames(page, 3);
  const after = await page.evaluate(() => document.querySelector('[data-role=collider-legend]').innerText.replace(/\n/g, ' | '));
  console.log('legend before delete:', before, '\nlegend after delete:', after);
  await page.keyboard.press('Control+z');
  await frames(page, 2);

  // ground toggle G: legend floor row + guards
  await page.keyboard.press('g');
  await frames(page, 2);
  console.log('ground off legend:', await page.evaluate(() => document.querySelector('[data-role=collider-legend]').innerText.replace(/\n/g, ' | ')));
  await page.keyboard.press('Control+z');
  await frames(page, 2);

  // combined: kinematics + selection + hover, erase hover, build ghost refused, back side
  await K(page, () => window.__knap.home());
  await page.keyboard.press('k');
  await frames(page, 2);
  await page.mouse.move(640, 714);
  await shot('review-m9-look-kin-on');
  await page.keyboard.press('Escape');
  await page.keyboard.press('e');
  const beam = m.parts.filter((p) => !p.cells.some((c) => c.rim)).sort((a, b) => b.cells.length - a.cells.length)[0];
  const bp = await K(page, (id) => window.__knap.partScreenPos(id), beam.id);
  await page.mouse.move(bp.x, bp.y, { steps: 3 });
  await frames(page, 2);
  await shot('review-m9-look-erase-hover');
  await page.keyboard.press('k');
  await page.keyboard.press('3');
  await page.mouse.move(bp.x + 3, bp.y + 3, { steps: 3 });
  await frames(page, 2);
  console.log('build highlight', JSON.stringify((await st(page)).buildHighlight ?? null).slice(0, 200));
  await shot('review-m9-look-build-ghost');
  await page.keyboard.down('Alt');
  await frames(page, 3);
  await shot('review-m9-look-backside');
  await page.keyboard.up('Alt');
  await page.keyboard.press('v');
  await page.keyboard.press('Escape');

  // pixel identity: off after on, with a selection and the kinematics view
  await page.mouse.click(wp.x, wp.y);
  await page.keyboard.press('k');
  await page.mouse.move(640, 714);
  await K(page, () => window.__knap.setShowColliders(false));
  const grab = (mode) => page.evaluate((mode) => {
    const vp = document.querySelector('canvas').__knapViewport; vp.renderNow();
    const gl = vp.renderer.getContext(); const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
    const b = new Uint8Array(w * h * 4); gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, b);
    if (mode === 'keep') { window.__r = b; return 0; }
    let d = 0; for (let i = 0; i < b.length; i++) if (b[i] !== window.__r[i]) d++; return d;
  }, mode);
  await frames(page, 2);
  await grab('keep');
  await page.keyboard.press('c');
  await frames(page, 3);
  await shot('review-m9-look-kin-sel-on');
  await page.keyboard.press('c');
  await frames(page, 3);
  console.log('off again with selection + kinematics: differing bytes', await grab('cmp'));
  if (S) console.log('page errors', page.url());
} finally {
  await S.close();
}
