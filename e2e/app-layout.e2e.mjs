// App e2e: layout at 1280×720 and 1920×1080 @2×, live resize, nothing overlapping the view
// cube, the top bar fitting without overflow, no console warnings in normal use.
import { openPage } from './lib.mjs';
import { frames, openApp, press, settle } from './app-lib.mjs';

async function checkLayout(page, assert, label) {
  const r = await page.evaluate(() => {
    const rect = (sel) => {
      const e = document.querySelector(sel);
      if (!e || e.hidden) return null;
      const b = e.getBoundingClientRect();
      return { x: b.x, y: b.y, w: b.width, h: b.height, r: b.right, b: b.bottom };
    };
    const top = document.querySelector('.topbar');
    const view = rect('[data-role=viewport]');
    const canvas = document.querySelector('canvas');
    return {
      topOverflow: top.scrollWidth - top.clientWidth,
      statusOverflow: document.querySelector('.statusbar').scrollWidth - document.querySelector('.statusbar').clientWidth,
      view,
      canvas: { w: canvas.clientWidth, h: canvas.clientHeight, bw: canvas.width, bh: canvas.height, dpr: devicePixelRatio },
      inspector: rect('[data-role=inspector]'),
      buttons: rect('[data-role=view-buttons]'),
      badge: rect('.sim-status'),
      docOverflow: document.documentElement.scrollWidth - innerWidth + (document.documentElement.scrollHeight - innerHeight),
    };
  });
  assert(r.topOverflow <= 0, `${label}: top bar fits (${r.topOverflow} px overflow)`);
  assert(r.statusOverflow <= 0, `${label}: status bar fits`);
  assert(r.docOverflow <= 0, `${label}: no page scroll`);
  assert(Math.abs(r.canvas.w - r.view.w) < 1 && Math.abs(r.canvas.h - r.view.h) < 1, `${label}: canvas fills the viewport`);
  assert(Math.abs(r.canvas.bw - Math.round(r.canvas.w * r.canvas.dpr)) <= 1, `${label}: drawing buffer is DPR-aware (${r.canvas.bw} for ${r.canvas.w}×${r.canvas.dpr})`);
  const cube = { x: r.view.x + r.view.w - 122, y: r.view.y, r: r.view.x + r.view.w, b: r.view.y + 122 };
  if (r.inspector) assert(r.inspector.y >= cube.b && r.inspector.y >= r.buttons.b, `${label}: inspector below the view cube and its buttons`);
  return r;
}

export default async function ({ page, url, shot, assert, step, errors }) {
  await step('1280×720', async () => {
    await openApp(page, url);
    await page.keyboard.press('v');
    const p = await page.evaluate(() => window.__knap.partScreenPos(3));
    await page.mouse.click(p.x, p.y);
    await frames(page, 2);
    await checkLayout(page, assert, '1280×720');
    await shot('app-layout-1280');
  });

  await step('live resize', async () => {
    await page.setViewportSize({ width: 1440, height: 860 });
    await frames(page, 3);
    await checkLayout(page, assert, '1440×860');
    await page.setViewportSize({ width: 1280, height: 720 });
    await frames(page, 3);
    await checkLayout(page, assert, 'back to 1280×720');
  });

  await step('1920×1080 @2×, simulating', async () => {
    const browser = page.context().browser();
    const c = await openPage(browser, url, 'app-layout', { width: 1920, height: 1080, deviceScaleFactor: 2 });
    try {
      await openApp(c.page, url);
      await press(c.page, '[data-action=play]');
      await c.page.waitForFunction(() => window.__knap.getState().mode === 'simulate');
      await press(c.page, '[data-action=pause]');
      await c.page.evaluate(() => window.__knap.stepSim(120));
      await frames(c.page, 2);
      await checkLayout(c.page, assert, '1920×1080@2');
      await c.shot('app-layout-1920-dpr2');
      await press(c.page, '[data-action=stop]');
      await settle(c.page);
      assert(c.errors.length === 0, `no errors: ${c.errors.join(' | ')}`);
    } finally {
      await c.close();
    }
  });
  assert(errors.length === 0, 'no console errors');
}
