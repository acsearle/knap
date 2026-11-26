// Help dialog text, LEGO/Technic scan across the UI, tooltips of the Gear button.
import { session, frames, K } from './review-m8-ux-lib.mjs';
const s = await session();
const { page, errors, snap } = await s.open('text');
const log = (...a) => console.log(...a);
const gearTitle = await page.evaluate(() => { const b = document.querySelector('[data-tool=gear]'); return b?.title + ' | ' + b?.getAttribute('aria-label'); });
log('gear button title:', gearTitle);
await page.keyboard.press('t'); await frames(page, 2);
log('gear tool idle hint:', await page.textContent('[data-role=status-hint]'));
await page.click('[data-action=help]'); await frames(page, 2);
const help = await page.evaluate(() => document.querySelector('dialog[open], .dialog, [role=dialog]')?.innerText ?? '');
log('help mentions mesh:', /mesh/i.test(help), '| 16:', /16/.test(help), '| straight:', /straight|line/i.test(help));
log(help.split('\n').filter((l) => /gear|teeth|mesh/i.test(l)).join('\n'));
await snap('text-help');
await page.keyboard.press('Escape');
// scan all text and titles on screen in several states
const scan = async (label) => { const t = await page.evaluate(() => document.body.innerText + ' ' + [...document.querySelectorAll('[title],[aria-label]')].map((e) => e.title + ' ' + e.getAttribute('aria-label')).join(' ')); const hits = t.match(/.{0,40}(lego|technic).{0,40}/gi); log(label, hits ? JSON.stringify(hits) : 'clean'); };
await scan('home');
await K(page, () => window.__knap.loadExample('gear-train')); await frames(page, 2);
await scan('gear-train');
await page.click('[data-action=examples]'); await frames(page, 2); await scan('examples menu'); await page.keyboard.press('Escape');
await page.click('[data-action=about]'); await frames(page, 2); await scan('about (disclaimer expected)'); await page.keyboard.press('Escape');
log('errors', errors);
await s.close();
