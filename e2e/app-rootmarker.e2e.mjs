// App e2e: the root part's "fixed" marker (DESIGN §6.1) is stable and always visible.
// - Simulating the triple pendulum, four-bar and collision examples from Home, FRONT and TOP
//   (deterministic fixed steps): the marker's screen position is identical in every frame, it is
//   always drawn inside the view, and its strength is full or MARK.faint, never 0.
// - Editing / moving other parts does not move it.
// - Orbiting moves it continuously: in a 360° yaw sweep and a pitch sweep (3° steps) its per-step
//   screen displacement equals the anchor cell's own displacement (it never hops to another cell).
// - Edge cases: root = a single pin inside another part's hole; root changed with "Set as fixed
//   root"; root hidden; empty model; anchor off-screen with the root on screen (the mark is clamped
//   into the view, continuously); root fully off-screen; DPR 2.
// Screenshots: e2e/out/app-rootmarker-*.png.
import { clickAt, facePos, frames, model, openApp, press, state } from './app-lib.mjs';

const FAINT = 0.85; // src/view/rootmarker.ts MARK.faint
const DROP_WORLD = 0.72; // MARK.dropWorld
const DROP_PX = 4; // MARK.dropPx

const marker = (page, probe = true) => page.evaluate((p) => window.__knap.rootMarker(p), probe);
const screenPos = (page, p) => page.evaluate((p) => window.__knap.screenPos(p), p);

async function view(page, v) {
  await page.evaluate((v) => {
    if (v === 'home') window.__knap.home();
    else {
      window.__knap.setView(v);
      window.__knap.fit();
    }
  }, v);
  await frames(page, 1);
}

export default async function ({ page, url, shot, assert, step }) {
  await step('load', () => openApp(page, url));

  const checkMark = (r, what) => {
    assert(r, `${what}: a marker`);
    assert(r.visible, `${what}: drawn inside the view (${JSON.stringify(r)})`);
    assert(r.alpha >= FAINT - 1e-6 && r.alpha <= 1 + 1e-6, `${what}: strength ${r.alpha} in [${FAINT}, 1]`);
  };

  const stats = [];
  for (const ex of ['triple-pendulum', 'four-bar', 'collision']) {
    for (const v of ['home', 'front', 'top']) {
      await step(`${ex} · ${v}: identical position in every simulated frame`, async () => {
        await page.evaluate((n) => window.__knap.loadExample(n), ex);
        await view(page, v);
        const r0 = await marker(page);
        checkMark(r0, `${ex} ${v} edit`);
        // the mark hangs straight below its anchor cell's centre
        const a = await screenPos(page, r0.anchor);
        const cam = await page.evaluate(() => window.__knap.camera());
        const vh = await page.evaluate(() => document.querySelector('.kv-canvas').clientHeight);
        assert(Math.abs(r0.x - a.x) < 0.01, `${ex} ${v}: centred under the anchor (${r0.x} vs ${a.x})`);
        const drop = r0.y - a.y;
        assert(Math.abs(drop - (DROP_WORLD * vh) / cam.height - DROP_PX) < 0.05, `${ex} ${v}: hung ${drop.toFixed(2)} px below the anchor`);
        let minAlpha = r0.alpha;
        const frameCount = v === 'home' ? 8 : 4;
        for (let f = 1; f <= frameCount; f++) {
          await page.evaluate(() => window.__knap.stepSim(48)); // 0.1 s per frame
          const r = await marker(page);
          checkMark(r, `${ex} ${v} t=${(f * 0.1).toFixed(1)} s`);
          assert(r.x === r0.x && r.y === r0.y, `${ex} ${v} frame ${f}: (${r.x}, ${r.y}) = (${r0.x}, ${r0.y})`);
          minAlpha = Math.min(minAlpha, r.alpha);
          if (v === 'home' || f === frameCount) await shot(`app-rootmarker-${ex}-${v}-f${f}`);
        }
        stats.push(`${ex}/${v}: (${r0.x.toFixed(1)}, ${r0.y.toFixed(1)}) min strength ${minAlpha.toFixed(2)}`);
        await page.evaluate(() => window.__knap.setMode('edit'));
      });
    }
  }
  console.log(`  [app-rootmarker] ${stats.join('; ')}`);

  await step('four-bar: editing and moving other parts does not move it', async () => {
    await page.evaluate(() => window.__knap.loadExample('four-bar'));
    await view(page, 'home');
    const r0 = await marker(page);
    const m = await model(page);
    const root = m.rootPartId ?? Math.min(...m.parts.map((p) => p.id));
    const other = m.parts.find((p) => p.id !== root && p.cells.length >= 3);
    await page.keyboard.press('v');
    await clickAt(page, await facePos(page, other.id, 0, 4).catch(() => facePos(page, other.id, 0, 2)));
    assert((await state(page)).selection === other.id, `part ${other.id} selected`);
    for (const k of ['ArrowUp', 'ArrowUp', 'ArrowRight', 'PageUp']) {
      await page.keyboard.press(k);
      await frames(page, 1);
      const r = await marker(page);
      assert(r.x === r0.x && r.y === r0.y, `after ${k}: (${r.x}, ${r.y}) = (${r0.x}, ${r0.y})`);
    }
    await shot('app-rootmarker-moved-other');
    // a new part (pin hole on the grid far away) and an erase of another part's cell
    await page.evaluate(() => {
      const m = window.__knap.getModel();
      m.parts.push({ id: m.nextPartId, color: '#3b74c4', cells: [{ x: 8, y: 0, z: 3, kind: 'pinHole', axis: 2 }] });
      m.nextPartId++;
      window.__knap.setModel(m);
    });
    const r = await marker(page);
    assert(r.x === r0.x && r.y === r0.y, 'a new part does not move it');
  });

  await step('orbit: continuous (no jump between cells), 360° yaw and a pitch sweep', async () => {
    await page.evaluate(() => window.__knap.loadExample('triple-pendulum'));
    await view(page, 'home');
    const base = await page.evaluate(() => window.__knap.camera());
    let worst = 0;
    let worstClamp = -Infinity;
    let clamped = 0;
    let maxStep = 0;
    const sweep = async (cams) => {
      let prev = null;
      for (const c of cams) {
        await page.evaluate((c) => window.__knap.setCamera(c), c);
        const r = await marker(page, false);
        const a = await screenPos(page, r.anchor);
        if (prev) {
          // the mark's own (unclamped) position moves exactly with the anchor cell …
          const dm = [r.anchorX - prev.r.anchorX, r.anchorY - prev.r.anchorY];
          const da = [a.x - prev.a.x, a.y - prev.a.y];
          worst = Math.max(worst, Math.hypot(dm[0] - da[0], dm[1] - da[1]));
          // … and the drawn one (clamped into the view near an edge) never moves further than it
          const dd = [r.x - prev.r.x, r.y - prev.r.y];
          worstClamp = Math.max(worstClamp, Math.abs(dd[0]) - Math.abs(da[0]), Math.abs(dd[1]) - Math.abs(da[1]));
          if (r.clamped) clamped++;
          maxStep = Math.max(maxStep, Math.hypot(...dd));
        }
        prev = { r, a };
      }
    };
    const deg = Math.PI / 180;
    await sweep(Array.from({ length: 121 }, (_, i) => ({ ...base, yaw: base.yaw + i * 3 * deg })));
    await sweep(Array.from({ length: 61 }, (_, i) => ({ ...base, pitch: -90 * deg + i * 3 * deg })));
    console.log(
      `  [app-rootmarker] orbit: max per-step move ${maxStep.toFixed(2)} px, max deviation from the anchor's own move ${worst.toExponential(2)} px, ${clamped} steps clamped at the edge`,
    );
    assert(worst < 0.01, `marker moves exactly with its anchor cell (worst ${worst} px)`);
    assert(worstClamp < 0.01, `the drawn mark never moves further than its anchor (worst excess ${worstClamp} px)`);
    await page.evaluate((c) => window.__knap.setCamera(c), base);
  });

  await step('root = a single pin inside another part\'s hole', async () => {
    const cells = [0, 1, 2].map((x) => ({ x, y: 0, z: 0, kind: 'pinHole', axis: 2 }));
    await page.evaluate(
      (cells) =>
        window.__knap.setModel({
          parts: [
            { id: 1, color: '#e0b43c', cells },
            { id: 2, color: '#d9cba3', cells: [{ x: 1, y: 0, z: 0, kind: 'pin', axis: 2 }, { x: 1, y: 0, z: 1, kind: 'pin', axis: 2 }] },
          ],
          rootPartId: 2,
          nextPartId: 3,
        }),
      cells,
    );
    await view(page, 'home');
    const r = await marker(page);
    checkMark(r, 'pin root');
    assert(JSON.stringify(r.anchor) === '[1,0,0]', `anchored on the pin's lowest-row centre cell: ${JSON.stringify(r.anchor)}`);
    console.log(`  [app-rootmarker] pin root: strength ${r.alpha.toFixed(2)}`);
    await shot('app-rootmarker-pin-root');
    await view(page, 'front');
    checkMark(await marker(page), 'pin root front');
    await shot('app-rootmarker-pin-root-front');
  });

  await step('"Set as fixed root" moves it to the new root; hidden root; empty model', async () => {
    await page.evaluate(() => window.__knap.loadExample('four-bar'));
    await view(page, 'home');
    const r0 = await marker(page);
    const m = await model(page);
    const root = m.rootPartId ?? Math.min(...m.parts.map((p) => p.id));
    const other = m.parts.find((p) => p.id !== root && p.cells.length >= 3);
    await page.keyboard.press('v');
    await clickAt(page, await facePos(page, other.id, 0, 4).catch(() => facePos(page, other.id, 0, 2)));
    await press(page, '[data-action=set-root]');
    assert((await model(page)).rootPartId === other.id, `part ${other.id} is the root`);
    const r1 = await marker(page);
    checkMark(r1, 'new root');
    assert(r1.x !== r0.x || r1.y !== r0.y, 'the marker moved to the new root');
    await shot('app-rootmarker-set-root');
    await page.evaluate((id) => window.__knap.setPartVisible(id, false), other.id);
    assert((await marker(page)) === null, 'hidden root: no marker');
    await page.evaluate((id) => window.__knap.setPartVisible(id, true), other.id);
    assert((await marker(page)) !== null, 'shown again');
    await press(page, '[data-action=new]');
    assert((await marker(page)) === null, 'empty model: no marker');
    await page.keyboard.press('Control+z');
  });

  await step('anchor off-screen, root on screen: the mark is clamped into the view, continuously', async () => {
    await page.evaluate(() => window.__knap.loadExample('pendulum'));
    await view(page, 'front');
    const r0 = await marker(page);
    assert(r0.visible && !r0.clamped, `in view: not clamped (${JSON.stringify(r0)})`);
    const cam = await page.evaluate(() => window.__knap.camera());
    const box = await page.locator('[data-role=viewport]').boundingBox();
    const wpp = cam.height / box.height;
    // pan the anchor leftwards past the edge in 2 px steps: the mark slides, then stops at the edge
    const minX = box.x + 12 + 4; // MARK.halfWidth + MARK.edge
    let prev = r0;
    let clampedSeen = false;
    for (let s = 0; s <= 30; s++) { // anchor from 40 px inside to 20 px outside the left edge
      const dx = (r0.x - box.x + 40 - 2 * s) * wpp; // anchor at box.x - 40 + 2 s
      await page.evaluate(([c, dx]) => window.__knap.setCamera({ ...c, target: [c.target[0] + dx, c.target[1], c.target[2]] }), [cam, dx]);
      const r = await marker(page, false);
      assert(r.visible, `step ${s}: visible (${JSON.stringify(r)})`);
      assert(Math.abs(r.x - Math.max(minX, r.anchorX)) < 0.01 && Math.abs(r.y - r.anchorY) < 0.01, `step ${s}: at the anchor, clamped to the edge (${JSON.stringify(r)})`);
      assert(Math.abs(r.x - prev.x) <= 2.01 || s === 0, `step ${s}: no jump (${prev.x} → ${r.x})`);
      clampedSeen ||= r.clamped;
      prev = r;
    }
    assert(clampedSeen, 'was clamped');
    // zoomed onto the root's top: the anchor (bottom cell) is far below the view
    await page.evaluate(([c]) => window.__knap.setCamera({ ...c, height: c.height * 0.3 }), [cam]);
    const z = await marker(page);
    assert(z.visible && z.alpha > 0, `zoomed in: still drawn (${JSON.stringify(z)})`);
    await shot('app-rootmarker-offscreen');
    // the whole root off-screen: no clamping, the mark is where its anchor is (out of the view)
    await page.evaluate(([c, dx]) => window.__knap.setCamera({ ...c, target: [c.target[0] + dx, c.target[1], c.target[2]] }), [cam, (r0.x - box.x + 900) * wpp]);
    const off = await marker(page);
    assert(off.visible === false && off.clamped === false, `fully off-screen: not drawn in the view (${JSON.stringify(off)})`);
  });

  await step('DPR 2: same CSS position and strength as DPR 1', async () => {
    await page.evaluate(() => window.__knap.loadExample('four-bar'));
    await view(page, 'home');
    const r1 = await marker(page);
    const ctx2 = await page.context().browser().newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 2 });
    try {
      const p2 = await ctx2.newPage();
      await openApp(p2, url);
      await p2.evaluate(() => window.__knap.loadExample('four-bar'));
      await view(p2, 'home');
      const r2 = await marker(p2);
      assert(Math.abs(r2.x - r1.x) < 0.5 && Math.abs(r2.y - r1.y) < 0.5, `DPR 2 at (${r2.x}, ${r2.y}) vs DPR 1 (${r1.x}, ${r1.y})`);
      assert(Math.abs(r2.alpha - r1.alpha) < 0.15, `strength ${r2.alpha} vs ${r1.alpha}`);
      await p2.evaluate(() => window.__knap.stepSim(96));
      checkMark(await marker(p2), 'DPR 2 simulating');
      const path = await shot('app-rootmarker-dpr2-sim'); // (DPR 1 page; the DPR 2 shot follows)
      void path;
      await p2.screenshot({ path: path.replace('dpr2-sim', 'dpr2-sim-2x') });
    } finally {
      await ctx2.close();
    }
  });
}
