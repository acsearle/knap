// Helpers for the app e2e scripts (e2e/app-*.e2e.mjs). They drive the real UI with Playwright
// mouse / keyboard events; window.__knap (src/app/testhook.ts) is used only to read state and to
// find screen positions of cell faces / grid cells.

/** Load the app and wait until it is ready. */
export async function openApp(page, url) {
  await page.goto(url);
  await page.waitForFunction(() => document.body.dataset.ready === 'true' || document.body.dataset.ready === 'error', null, { timeout: 90000 });
  const ready = await page.evaluate(() => document.body.dataset.ready);
  if (ready !== 'true') throw new Error(`app failed to start: ${await page.textContent('#app')}`);
  await frames(page, 2);
}

/** Wait for n animation frames. */
export function frames(page, n = 2) {
  return page.evaluate(
    (n) =>
      new Promise((res) => {
        let k = 0;
        const f = () => (++k >= n ? res(undefined) : requestAnimationFrame(f));
        requestAnimationFrame(f);
      }),
    n,
  );
}

export const knap = (page, fn, arg) => page.evaluate(fn, arg);
export const state = (page) => page.evaluate(() => window.__knap.getState());
export const model = (page) => page.evaluate(() => window.__knap.getModel());
export const summary = (page) => page.evaluate(() => window.__knap.analyze());

/** Move the mouse to (x, y) in a few steps (so the viewport sees pointer moves / hover). */
export async function hover(page, p) {
  await page.mouse.move(p.x, p.y, { steps: 2 });
  await frames(page, 1);
}

/** A real click at a point (move there first so hover / ghost update like for a user). */
export async function clickAt(page, p, { shift = false } = {}) {
  await hover(page, p);
  if (shift) await page.keyboard.down('Shift');
  await page.mouse.down();
  await page.mouse.up();
  if (shift) await page.keyboard.up('Shift');
  await frames(page, 1);
}

/** Screen point of face `dir` of a part's cell (throws if not clickable from this view). */
export async function facePos(page, partId, cellIndex, dir) {
  const p = await page.evaluate(([a, b, c]) => window.__knap.clientPosOfCellFace(a, b, c), [partId, cellIndex, dir]);
  if (!p) throw new Error(`face ${dir} of cell ${cellIndex} of part ${partId} is not clickable in this view`);
  return p;
}

export async function gridPos(page, x, z) {
  const p = await page.evaluate(([a, b]) => window.__knap.clientPosOfGrid(a, b), [x, z]);
  if (!p) throw new Error(`grid cell (${x}, 0, ${z}) is not clickable in this view`);
  return p;
}

/** Index of the cell of `part` at position [x,y,z]. */
export function cellIndexAt(m, partId, pos) {
  const part = m.parts.find((p) => p.id === partId);
  if (!part) throw new Error(`no part ${partId}`);
  const i = part.cells.findIndex((c) => c.x === pos[0] && c.y === pos[1] && c.z === pos[2]);
  if (i < 0) throw new Error(`part ${partId} has no cell at ${pos}`);
  return i;
}

/** Click a face of the cell of `partId` at `pos`. */
export async function clickFace(page, partId, pos, dir, opts = {}) {
  const m = await model(page);
  const p = await facePos(page, partId, cellIndexAt(m, partId, pos), dir);
  await clickAt(page, p, opts);
}

/** Wait until no camera animation runs (snaps / fits take ≈ 250 ms). */
export async function settle(page) {
  await page.waitForFunction(() => !window.__knap.getState().animating);
  await frames(page, 1);
}

/**
 * Click a control by CSS selector with the real mouse (move to its centre, press, release), then
 * wait for camera animations. Not locator.click(): Playwright's "stable" check waits for
 * animation frames, which take ≈ 0.5 s each under software WebGL while a simulation renders.
 */
export async function press(page, selector) {
  const el = page.locator(selector);
  const box = await el.boundingBox();
  if (!box) throw new Error(`${selector} is not visible`);
  if (await el.isDisabled()) throw new Error(`${selector} is disabled`);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.up();
  await frames(page, 1);
  await settle(page);
}

export function deepEqual(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Read text of the status bar parts. */
export async function status(page) {
  return page.evaluate(() => ({
    hover: document.querySelector('[data-role=status-hover]')?.textContent ?? '',
    hint: document.querySelector('[data-role=status-hint]')?.textContent ?? '',
    aux: document.querySelector('[data-role=status-aux]')?.textContent ?? '',
    message: document.querySelector('[data-role=status-message]')?.textContent ?? '',
    error: document.querySelector('[data-role=status-message]')?.classList.contains('error') ?? false,
    counts: document.querySelector('[data-role=status-counts]')?.textContent ?? '',
  }));
}

/** Quaternion/vec helpers for asserting simulated poses. */
export function applyT(t, v) {
  const [x, y, z, w] = t.q;
  const [vx, vy, vz] = v;
  const tx = 2 * (y * vz - z * vy);
  const ty = 2 * (z * vx - x * vz);
  const tz = 2 * (x * vy - y * vx);
  return [vx + w * tx + (y * tz - z * ty) + t.p[0], vy + w * ty + (z * tx - x * tz) + t.p[1], vz + w * tz + (x * ty - y * tx) + t.p[2]];
}
export const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
