// UX review 4: look and layout at 1280×720, 1440×900, 1920×1080 and DPR 2.
import { startUx, st, mk } from './review-ux-lib.mjs';
import { frames, hover, clickAt, facePos, model, settle, press, state, openApp } from './app-lib.mjs';

const ux = await startUx();
const sizes = [
  { w: 1280, h: 720, dpr: 1 },
  { w: 1440, h: 900, dpr: 1 },
  { w: 1920, h: 1080, dpr: 1 },
  { w: 1280, h: 720, dpr: 2 },
];
for (const { w, h, dpr } of sizes) {
  const tag = `${w}x${h}${dpr > 1 ? '-dpr2' : ''}`;
  const { page, shot, close } = await ux.page(`ux-layout-${tag}`, { width: w, height: h, deviceScaleFactor: dpr });
  await openApp(page, ux.url);
  // measure overflow / truncation of chrome
  const metrics = await page.evaluate(() => {
    const over = (sel) => {
      const e = document.querySelector(sel);
      return e ? { sw: e.scrollWidth, cw: e.clientWidth } : null;
    };
    const tb = document.querySelector('.topbar');
    const kids = [...tb.children].map((c) => c.getBoundingClientRect());
    const overlaps = [];
    for (let i = 1; i < kids.length; i++) if (kids[i].left < kids[i - 1].right - 0.5 && kids[i].width > 0 && kids[i - 1].width > 0) overlaps.push(i);
    return { topbar: over('.topbar'), toolbar: over('.toolbar'), toolbarH: (() => { const e = document.querySelector('.toolbar'); return { sh: e.scrollHeight, ch: e.clientHeight }; })(), overlaps, lastRight: kids[kids.length - 1].right, vw: innerWidth };
  });
  console.log(tag, JSON.stringify(metrics));
  ux.check(metrics.topbar.sw <= metrics.topbar.cw && metrics.lastRight <= metrics.vw, `${tag}: top bar fits`, JSON.stringify(metrics.topbar));
  ux.check(metrics.toolbarH.sh <= metrics.toolbarH.ch, `${tag}: tool bar fits vertically`, JSON.stringify(metrics.toolbarH));
  // build-tool hover over a link end so the status bar is full
  await page.keyboard.press('1');
  const p = await facePos(page, 3, 4, 2).catch(() => null);
  if (p) await hover(page, p);
  await frames(page, 2);
  const trunc = await page.evaluate(() =>
    [...document.querySelectorAll('.statusbar > div')].map((d) => ({ cls: d.className, text: d.textContent, truncated: d.scrollWidth > d.clientWidth + 1 })),
  );
  console.log(tag, 'status bar:', JSON.stringify(trunc));
  for (const t of trunc) ux.check(!t.truncated, `${tag}: status "${t.cls}" not truncated while hovering with a build tool`, t.text);
  await shot(`review-ux-70-${tag}-build-hover`);
  // selection + inspector
  await page.keyboard.press('v');
  await clickAt(page, await page.evaluate(() => window.__knap.partScreenPos(4)));
  await frames(page, 2);
  await shot(`review-ux-71-${tag}-inspector`);
  // examples menu
  await press(page, '[data-action=examples]');
  await frames(page, 1);
  await shot(`review-ux-72-${tag}-examples-menu`);
  await page.keyboard.press('Escape');
  // help
  await page.keyboard.press('?');
  await frames(page, 1);
  const helpBox = await page.evaluate(() => { const d = document.querySelector('[data-role=help]'); return { sh: d.scrollHeight, ch: d.clientHeight }; });
  console.log(tag, 'help dialog', JSON.stringify(helpBox));
  ux.check(helpBox.sh <= helpBox.ch, `${tag}: help fits without scrolling`, JSON.stringify(helpBox));
  await shot(`review-ux-73-${tag}-help`);
  await page.keyboard.press('Escape');
  // simulate
  await page.keyboard.press('Space');
  await page.waitForFunction(() => window.__knap.getState().mode === 'simulate', null, { timeout: 60000 });
  await page.evaluate(() => window.__knap.setPaused(true));
  await page.evaluate(() => window.__knap.stepSim(240));
  await page.keyboard.press('k');
  await frames(page, 2);
  await shot(`review-ux-74-${tag}-simulate-kin`);
  await page.keyboard.press('k');
  await page.keyboard.press('Escape');
  await frames(page, 1);
  // keyboard focus ring: Tab from the body
  await page.mouse.click(640, 700);
  await page.evaluate(() => document.activeElement?.blur());
  for (let i = 0; i < 3; i++) await page.keyboard.press('Tab');
  await frames(page, 1);
  const foc = await page.evaluate(() => { const e = document.activeElement; const cs = getComputedStyle(e); return { el: e.getAttribute('aria-label') || e.textContent.trim(), outline: cs.outlineStyle + ' ' + cs.outlineWidth + ' ' + cs.outlineColor }; });
  console.log(tag, 'focus after 3×Tab', JSON.stringify(foc));
  await shot(`review-ux-75-${tag}-focus`, { clip: { x: 0, y: 0, width: 640, height: 60 } });
  // titles on all buttons
  const noTitle = await page.evaluate(() => [...document.querySelectorAll('button')].filter((b) => b.offsetParent && !b.title && !b.getAttribute('aria-label')).map((b) => b.textContent.trim()));
  console.log(tag, 'visible buttons without title/aria-label:', JSON.stringify(noTitle));
  await close();
}
await ux.close();
