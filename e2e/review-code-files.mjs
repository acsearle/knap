// Reviewer "code": file open (hostile / invalid / huge), XSS, autosave timing / failures.
import { runProbes, st, sleep } from './review-code-lib.mjs';
import { frames, settle } from './app-lib.mjs';

const KEY = 'knap.autosave.v1';

function bigModel(nParts, cellsPerPart, withNextId = true) {
  const parts = [];
  for (let i = 0; i < nParts; i++) {
    const cells = [];
    for (let k = 0; k < cellsPerPart; k++) cells.push({ x: k, y: 0, z: i * 2, kind: 'pinHole', axis: 1 });
    parts.push({ id: i + 1, color: '#3b74c4', cells });
  }
  const m = { version: 1, parts, rootPartId: 1 };
  if (withNextId) m.nextPartId = nParts + 1;
  return m;
}

const probes = {
  async hostileOpen({ page }) {
    const r = {};
    const tryOpen = (name, text) => page.evaluate(([n, t]) => {
      const ok = window.__knap.openText(n, t);
      const s = window.__knap.getState();
      return { ok, msg: s.message.text.slice(0, 160), banner: s.banner.slice(0, 160), bannerHTML: document.querySelector('[data-role=banner-text]').innerHTML.slice(0, 200), polluted: ({}).polluted ?? null, xss: window.__xss ?? null };
    }, [name, text]);
    r.proto = await tryOpen('p.knap.json', '{"version":1,"parts":[],"rootPartId":null,"nextPartId":1,"__proto__":{"polluted":1},"constructor":{"prototype":{"polluted":2}}}');
    r.protoPart = await tryOpen('p2.knap.json', JSON.stringify({ version: 1, rootPartId: 1, nextPartId: 2, parts: [JSON.parse('{"id":1,"color":"#3b74c4","cells":[{"x":0,"y":0,"z":0,"kind":"pinHole","axis":1,"__proto__":{"polluted":3}}],"__proto__":{"polluted":4}}')] }));
    r.version2 = await tryOpen('v2.knap.json', JSON.stringify({ version: 2, parts: [] }));
    r.xssName = await tryOpen('<img src=x onerror="window.__xss=1">.json', '{bad');
    r.xssColor = await tryOpen('c.json', JSON.stringify({ version: 1, rootPartId: 1, nextPartId: 2, parts: [{ id: 1, color: '<img src=x onerror="window.__xss=2">', cells: [{ x: 0, y: 0, z: 0, kind: 'pinHole', axis: 1 }] }] }));
    r.cssColor = await tryOpen('c2.json', JSON.stringify({ version: 1, rootPartId: 1, nextPartId: 2, parts: [{ id: 1, color: 'red', cells: [{ x: 0, y: 0, z: 0, kind: 'pinHole', axis: 1 }] }] }));
    r.nested = await tryOpen('deep.json', '['.repeat(200000) + ']'.repeat(200000));
    r.emptyText = await tryOpen('empty.json', '');
    r.nullJson = await tryOpen('null.json', 'null');
    await sleep(100);
    r.xssAfter = await page.evaluate(() => window.__xss ?? null);
    return r;
  },

  async hugeOpen({ page }) {
    const out = {};
    for (const [label, m] of [['20k-cells', bigModel(2000, 10)], ['100k-cells', bigModel(10000, 10)], ['150k-parts-no-nextId', bigModel(150000, 1, false)]]) {
      const text = JSON.stringify(m);
      const t = await page.evaluate(([t]) => {
        const t0 = performance.now();
        const ok = window.__knap.openText('big.knap.json', t);
        return { ok, ms: Math.round(performance.now() - t0), msg: window.__knap.getState().message.text.slice(0, 200) };
      }, [text]);
      // time until the next frame is produced (the render of the new model)
      const t1 = Date.now();
      await frames(page, 1).catch(() => {});
      t.firstFrameMs = Date.now() - t1;
      t.MB = +(text.length / 1e6).toFixed(1);
      out[label] = t;
      if (!t.ok) continue;
      // undo back
      await page.keyboard.press('Control+z');
    }
    return out;
  },

  async autosaveTiming({ page }) {
    await page.evaluate(() => window.__knap.flushAutosave());
    const before = await page.evaluate((k) => localStorage.getItem(k), KEY);
    await page.evaluate(() => window.__knap.loadExample('pendulum'));
    const at50 = await page.evaluate((k) => localStorage.getItem(k), KEY);
    await sleep(700);
    const at700 = await page.evaluate((k) => localStorage.getItem(k), KEY);
    return { changedAt50ms: at50 !== before, savedAt700ms: JSON.parse(at700).parts.length };
  },

  // edit then reload immediately (< debounce): pagehide must flush.
  async flushOnReload({ page }) {
    await page.evaluate(() => window.__knap.loadExample('pendulum'));
    await page.reload();
    await page.waitForFunction(() => document.body.dataset.ready === 'true', null, { timeout: 90000 });
    const m = await page.evaluate(() => window.__knap.getModel());
    const s = await st(page);
    return { partsAfterReload: m.parts.length, msg: s.message.text, fileName: s.fileName };
  },

  // edit, Play immediately; the debounced save fires during the simulation -> must be the edit model.
  async autosaveDuringSim({ page }) {
    await page.evaluate(() => window.__knap.loadExample('pendulum'));
    await page.evaluate(() => window.__knap.setMode('simulate'));
    await page.evaluate(() => window.__knap.stepSim(200));
    await sleep(800);
    const saved = JSON.parse(await page.evaluate((k) => localStorage.getItem(k), KEY));
    const m = await page.evaluate(() => window.__knap.getModel());
    return { equal: JSON.stringify(saved) === JSON.stringify(m), mode: (await st(page)).mode };
  },

  async corruptAutosave({ page }) {
    await page.evaluate((k) => localStorage.setItem(k, '{"version":1,"parts":[{"id":1}]'), KEY);
    await page.reload();
    await page.waitForFunction(() => document.body.dataset.ready, null, { timeout: 90000 });
    const s = await st(page);
    const corrupt = await page.evaluate(() => localStorage.getItem('knap.autosave.v1.corrupt'));
    return { ready: await page.evaluate(() => document.body.dataset.ready), banner: s.banner, parts: (await page.evaluate(() => window.__knap.getModel())).parts.length, corruptKept: !!corrupt };
  },

  async newThenReload({ page }) {
    await page.click('[data-action=new]');
    await sleep(600);
    await page.reload();
    await page.waitForFunction(() => document.body.dataset.ready === 'true', null, { timeout: 90000 });
    const s = await st(page);
    return { partsAfterReload: (await page.evaluate(() => window.__knap.getModel())).parts.length, fileName: s.fileName, msg: s.message.text };
  },

  // undo of Open does not restore the file name used by Save
  async fileNameAfterUndo({ page }) {
    await page.evaluate(() => window.__knap.openText('mine.knap.json', JSON.stringify({ version: 1, rootPartId: 1, nextPartId: 2, parts: [{ id: 1, color: '#3b74c4', cells: [{ x: 0, y: 0, z: 0, kind: 'pinHole', axis: 1 }] }] })));
    await page.evaluate(() => window.__knap.loadExample('pendulum'));
    await page.keyboard.press('Control+z');
    const s = await st(page);
    const m = await page.evaluate(() => window.__knap.getModel());
    const [dl] = await Promise.all([page.waitForEvent('download'), page.keyboard.press('Control+s')]);
    return { parts: m.parts.length, fileName: s.fileName, downloadName: dl.suggestedFilename() };
  },
};

// Storage that throws on write (quota) and storage that is blocked entirely.
const quota = async ({ page }) => {
  await page.evaluate(() => window.__knap.loadExample('pendulum'));
  await sleep(700);
  const s1 = await st(page);
  await page.evaluate(() => window.__knap.loadExample('four-bar'));
  await sleep(700);
  const s2 = await st(page);
  return { msg1: s1.message, msg2: s2.message, banner: s1.banner };
};
quota.init = () => {
  const o = Storage.prototype.setItem;
  Storage.prototype.setItem = function (k, v) { if (k === 'knap.autosave.v1') throw new DOMException('quota', 'QuotaExceededError'); return o.call(this, k, v); };
};
probes.quota = quota;

const blocked = async ({ page }) => {
  const s = await st(page);
  await page.evaluate(() => window.__knap.loadExample('pendulum'));
  await sleep(700);
  const s2 = await st(page);
  return { startMsg: s.message, afterEditMsg: s2.message, banner: s2.banner, ready: await page.evaluate(() => document.body.dataset.ready) };
};
blocked.init = () => {
  Object.defineProperty(window, 'localStorage', { get() { throw new DOMException('denied', 'SecurityError'); } });
};
probes.blocked = blocked;

await runProbes(probes);
