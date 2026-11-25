// UX review: first look — start screen, help, New, first hover.
import { startUx, st, freshEmpty } from './review-ux-lib.mjs';
import { frames, openApp, gridPos, hover } from './app-lib.mjs';

const ux = await startUx();
const { page, shot } = await ux.page('ux-explore');
await openApp(page, ux.url);
await shot('review-ux-01-start');
console.log('status', await st(page));
await page.keyboard.press('?');
await frames(page, 2);
await shot('review-ux-02-help');
await page.keyboard.press('Escape');
await page.locator('[data-action=new]').click();
await frames(page, 2);
await shot('review-ux-03-new');
console.log('after New', await st(page));
await page.keyboard.press('1');
await hover(page, await gridPos(page, 0, 0));
await frames(page, 2);
console.log('hover grid', await st(page));
await shot('review-ux-04-grid-hover');
await ux.close();
