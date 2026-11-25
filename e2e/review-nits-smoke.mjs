import { reviewSetup, markDiff } from './review-nits-lib.mjs';
const S = await reviewSetup();
const { page, shot, errors } = await S.open('rn-smoke');
await page.evaluate(() => window.__knap.loadExample('pendulum'));
const d = await markDiff(page);
console.log(JSON.stringify(d));
await shot('review-nits-smoke');
console.log('errors', errors);
await S.close();
