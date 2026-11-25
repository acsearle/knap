// Review "sim" 6: Esc pressed while the first simulation is still starting (physics WASM loading).
import { sleep } from './app-lib.mjs';
import { harness } from './review-sim-lib.mjs';
const h = await harness();
const c = await h.open('review-sim-startstop');
const { page } = c;
try {
  await page.keyboard.press(' ');
  const s1 = await page.evaluate(() => window.__knap.getState().mode);
  await page.keyboard.press('Escape');
  const s2 = await page.evaluate(() => window.__knap.getState().mode);
  await sleep(2000);
  const s3 = await page.evaluate(() => window.__knap.getState());
  console.log(`after Space: ${s1}; right after Esc: ${s2}; 2 s later: ${s3.mode} (message "${s3.message.text}")`);
  console.log(s3.mode === 'edit' ? 'PASS  Esc during start is honoured' : 'FAIL  Esc pressed while "Starting…" was ignored: the simulation started anyway');
} finally {
  await h.done();
}
