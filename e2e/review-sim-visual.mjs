// Review "sim" 1: every example + own mechanisms (tests/review/sim.review.test.ts writes them to
// e2e/out/review-sim-models.json): enter simulate mode, step deterministically, screenshot
// sequences (montage per model: e2e/out/review-sim-seq-<name>.png), joint anchors projected to
// screen for both bodies, first-frame teleport check, Stop restores the picture (pixel compare).
// Run: node e2e/review-sim-visual.mjs [name ...]
import { frames, settle } from './app-lib.mjs';
import { MODELS, check, harness, jointScreenErrors, montage, pixelDiff, results, viewShot } from './review-sim-lib.mjs';

const EXAMPLES = ['pendulum', 'triple-pendulum', 'four-bar', 'parallelogram', 'sliding-axle', 'weld-test', 'collision'];
const only = process.argv.slice(2);
const h = await harness();
const c = await h.open('review-sim-visual');
const { page } = c;
const mechs = MODELS();
const cases = [...EXAMPLES.map((n) => ({ name: n, example: true })), ...Object.keys(mechs).map((n) => ({ name: n, example: false }))].filter(
  (x) => !only.length || only.includes(x.name),
);
const k = (fn, arg) => page.evaluate(fn, arg);

/** Max screen distance (px) of every cell centre from its position in the previous sample. */
const cellScreen = () =>
  k(() => {
    const m = window.__knap.getModel();
    const out = [];
    for (const p of m.parts) p.cells.forEach((_, i) => out.push(window.__knap.cellScreenPos(p.id, i)));
    return out;
  });

try {
  for (const cs of cases) {
    console.log(`--- ${cs.name}`);
    if (cs.example) await k((n) => window.__knap.loadExample(n), cs.name);
    else await k((m) => window.__knap.setModel(m), mechs[cs.name]);
    await k(() => window.__knap.home());
    await settle(page);
    await frames(page, 2);
    const a = await k(() => window.__knap.analyze());
    const status = await page.textContent('[data-role=status-counts]');
    console.log(`  analysis: ${a.summary} | status bar: ${status}`);
    const editShot = await viewShot(page, `review-sim-${cs.name}-edit`);
    const cells0 = await cellScreen();

    // Enter simulate mode paused at t = 0 (no step yet): the picture must not jump.
    await k(() => window.__knap.stepSim(0));
    await frames(page, 2);
    const st = await k(() => window.__knap.getState());
    if (cs.name === 'empty') {
      check(`${cs.name}: Play on an empty model stays in edit mode with a message`, st.mode === 'edit', st.message);
      continue;
    }
    check(`${cs.name}: simulate mode entered`, st.mode === 'simulate', st.mode);
    const t0Shot = await viewShot(page, `review-sim-${cs.name}-t0`);
    const d0 = await pixelDiff(page, editShot, t0Shot, { diffFile: `review-sim-${cs.name}-diff-edit-t0` });
    const cellsT0 = await cellScreen();
    const jump0 = Math.max(...cells0.map((p, i) => (p && cellsT0[i] ? Math.hypot(p.x - cellsT0[i].x, p.y - cellsT0[i].y) : 0)));
    check(`${cs.name}: t=0 cell positions identical to edit`, jump0 < 0.01, `max ${jump0.toFixed(4)} px; edit→t0 pixel diff ${d0.n} px bbox ${JSON.stringify(d0.bbox)}`);
    await k(() => window.__knap.stepSim(1));
    const cells1 = await cellScreen();
    const jump1 = Math.max(...cells0.map((p, i) => (p && cells1[i] ? Math.hypot(p.x - cells1[i].x, p.y - cells1[i].y) : 0)));
    check(`${cs.name}: first fixed step moves nothing visibly`, jump1 < 0.5, `max ${jump1.toFixed(3)} px`);

    // Sequence: 8 samples, 0.25 s apart (120 fixed steps).
    const shots = [t0Shot];
    const labels = ['t=0'];
    let worstPx = 0;
    let worstPx2 = 0;
    let worstPerp = '';
    for (let i = 1; i <= 7; i++) {
      await k((n) => window.__knap.stepSim(n), i === 1 ? 119 : 120);
      await frames(page, 1);
      shots.push(await viewShot(page));
      const info = await k(() => window.__knap.simInfo());
      labels.push(`t=${info.time.toFixed(2)} jerr=${info.jointError.toExponential(1)}`);
      for (const j of await jointScreenErrors(page)) {
        if (j.removed) continue;
        // For sliding joints, origin points of A and B legitimately separate along the axis.
        if (j.type !== 'revolute') continue;
        if (j.px > worstPx) worstPx = j.px;
        if (j.px2 > worstPx2) {
          worstPx2 = j.px2;
          worstPerp = j.joint;
        }
      }
    }
    await montage(page, shots, labels, `review-sim-seq-${cs.name}`);
    check(`${cs.name}: revolute anchors coincide on screen (≤ 0.5 px)`, worstPx <= 0.5 && worstPx2 <= 0.5, `origin ${worstPx.toFixed(3)} px, second axis point ${worstPx2.toFixed(3)} px (${worstPerp})`);
    const st2 = await k(() => window.__knap.getState());
    check(`${cs.name}: still simulating after 1.75 s`, st2.mode === 'simulate', st2.banner || st2.message);

    // Stop restores the picture exactly.
    await k(() => window.__knap.setMode('edit'));
    await frames(page, 2);
    const stopShot = await viewShot(page, `review-sim-${cs.name}-stopped`);
    const d = await pixelDiff(page, editShot, stopShot, { thresh: 0, diffFile: `review-sim-${cs.name}-diff-stop` });
    check(`${cs.name}: Stop restores the picture pixel-exactly`, d.n === 0, d);
  }
  if (c.errors.length) check('no page errors', false, c.errors);
} finally {
  await h.done();
}
const bad = results.filter((r) => !r.ok);
console.log(`\n${results.length - bad.length}/${results.length} checks passed`);
for (const r of bad) console.log(`FAILED: ${r.name}  ${JSON.stringify(r.detail)}`);
