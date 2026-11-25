// Reviewer "code": what exactly does the autosave contain when it fires during a simulation?
import { runProbes, sleep } from './review-code-lib.mjs';
const probes = {
  async autosaveDuringSim2({ page }) {
    await page.evaluate(() => window.__knap.loadExample('pendulum'));
    const m0 = await page.evaluate(() => window.__knap.getModel());
    await page.evaluate(() => window.__knap.setMode('simulate'));
    await page.evaluate(() => window.__knap.stepSim(200));
    await sleep(800);
    const saved = JSON.parse(await page.evaluate(() => localStorage.getItem('knap.autosave.v1')));
    return { savedKeys: Object.keys(saved), modelKeys: Object.keys(m0), savedParts: JSON.stringify(saved.parts).slice(0, 300), modelParts: JSON.stringify(m0.parts).slice(0, 300), sameCells: JSON.stringify(saved.parts.map(p=>p.cells.map(c=>[c.x,c.y,c.z,c.kind,c.axis]))) === JSON.stringify(m0.parts.map(p=>p.cells.map(c=>[c.x,c.y,c.z,c.kind,c.axis]))) };
  },
};
await runProbes(probes);
