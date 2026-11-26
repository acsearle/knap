// App e2e: the ground's contact shadow (DESIGN §6.1 "Ground", §7.5 groundShadowAt). Deterministic:
// shadow strengths are read back from the shadow texture with the test hook, simulations are
// stepped with stepSim, and only the shadow's own render counter is asserted about re-rendering
// (never wall-clock time).
//   - the floor is the same in edit and simulate mode (no lines), at sim.groundY;
//   - Cart: dark under each wheel's contact line, a weaker shade under the chassis that matches its
//     height, nothing 6 units away; a beam lying on the floor; a pendulum 5 above casts nothing;
//     a part lifted in steps fades monotonically to nothing at SHADOW_H; a hidden part casts none;
//   - the texture is re-rendered only when something it shows changed: orbiting 20 steps, panning,
//     zooming and resizing add 0 renders; one simulated frame adds 1; an edit adds 1; idle adds 0;
//   - stability: the Cart moved along X in sub-texel steps keeps its shadow (points fixed relative
//     to the cart agree step to step), across frame re-centres and frame-size changes; a rolling
//     cart keeps a full-strength shadow under its wheels;
//   - pixels: from above the shadow darkens the floor, from below nothing is drawn.
import { applyT, frames, openApp, settle } from './app-lib.mjs';

const H = 3; // SHADOW_H (src/view/shadowmath.ts)
const SIGMA = 0.35; // SHADOW_BLUR (contact lobe)
// Two lobes (src/view/shadowmath.ts, DEVIATIONS §6 "Contact shadow"): opacities and σ of the contact
// and ambient lobes; strength 1 = both at full = SHADOW_MAX opacity.
const LOBES = [
  { m: 0.42, s: SIGMA }, // SHADOW_CONTACT, SHADOW_BLUR
  { m: 0.42, s: 0.9 }, // SHADOW_AMBIENT, SHADOW_AMBIENT_BLUR
];
const MAX = LOBES.reduce((a, l) => a + l.m, 0);
/** Under a 1-unit-wide wheel's contact line (narrow footprint: the ambient lobe is partly spent). */
const WHEEL_MIN = 0.55;
/** erf (Abramowitz–Stegun 7.1.26, |error| < 1.5e-7). */
function erf(x) {
  const s = Math.sign(x);
  x = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * x);
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496735) * t + 0.254829592) * t * Math.exp(-x * x);
  return s * y;
}
/**
 * Blurred strength (both lobes) at offset `x` from the middle of a long strip `w` wide of surface `h`
 * above the floor.
 */
const strip = (h, w, x = 0) =>
  ((1 - Math.max(0, h) / H) ** 2 *
    LOBES.reduce((a, l) => a + l.m * 0.5 * (erf((x + w / 2) / (l.s * Math.SQRT2)) - erf((x - w / 2) / (l.s * Math.SQRT2))), 0)) /
  MAX;
const stripCentre = (h, w) => strip(h, w, 0);

const cell = (x, y, z, kind = 'pinHole', axis = 2, rim) => ({ x, y, z, kind, axis, ...(rim ? { rim } : {}) });

export default async function ({ page, url, assert, step, shot, errors }) {
  await openApp(page, url);
  const k = (fn, arg) => page.evaluate(fn, arg);
  const at = (x, z) => k(([x, z]) => window.__knap.groundShadowAt(x, z), [x, z]);
  const renders = () => k(() => window.__knap.shadowInfo().renders);
  const viewRenders = () => k(() => window.__knap.getState().viewport.renders);

  let cart;
  await step('Cart at t = 0 (edit mode): wheels, chassis, 6 units away', async () => {
    await k(() => window.__knap.loadExample('cart'));
    await k(() => window.__knap.home());
    await frames(page, 2);
    cart = await k(() => window.__knap.getModel());
    const floor = await k(() => window.__knap.floor());
    assert(floor && Object.keys(floor).join() === 'y' && Math.abs(floor.y - (-1.5 + 0.04)) < 1e-9, `floor at groundLevel + 0.04, no lines: ${JSON.stringify(floor)}`);
    const wheels = [];
    for (const [x, z] of [[0, -1], [8, -1], [0, 3], [8, 3]]) wheels.push(await at(x, z));
    assert(wheels.every((v) => v >= WHEEL_MIN && v <= 1), `under each wheel's contact line ≥ ${WHEEL_MIN} (1 = SHADOW_MAX): ${wheels.map((v) => v.toFixed(3))}`);
    // The chassis beams (z = 0 and 2, 1 wide) have their bottom 0.99 above the floor (visual solid
    // starts 0.03 above the nominal −½; floor at −1.46): under a beam's middle the strength is that
    // of a 1-wide strip at that height; between the beams (z = 1) a much weaker blurred skirt.
    const beam = await at(4, 0);
    const expected = stripCentre(-0.47 - -1.46, 0.94);
    const mid = await at(4, 1);
    assert(Math.abs(beam - expected) < 0.04 && beam < 0.6 * wheels[0], `under the chassis beam ${beam.toFixed(3)} ≈ ${expected.toFixed(3)} (h = 0.99), clearly weaker than under a wheel`);
    assert(mid > 0.02 && mid < beam / 2, `between the beams (chassis centre) ${mid.toFixed(3)}: non-zero, weaker`);
    // footprint: x ∈ [−1.5, 9.5], z ∈ [−1.5, 3.5]; 6 units outside it, nothing
    const away = [await at(4, 9.5), await at(15.5, 1), await at(-7.5, 1), await at(4, -7.5)];
    assert(away.every((v) => v === 0), `6 units away: ${away}`);
    console.log(`  [app-shadow] Cart t=0: wheels ${wheels.map((v) => v.toFixed(3))}, beam ${beam.toFixed(3)} (model ${expected.toFixed(3)}), between beams ${mid.toFixed(3)}, frame ${JSON.stringify(await k(() => window.__knap.shadowInfo().frame))}`);
  });

  await step('no re-render on orbit (20 steps), pan, zoom, resize, or while idle', async () => {
    await frames(page, 3);
    const r0 = await renders();
    const v0 = await viewRenders();
    const vp = await page.locator('[data-role=viewport]').boundingBox();
    const cx = vp.x + vp.width * 0.2;
    const cy = vp.y + vp.height * 0.8;
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    for (let i = 1; i <= 20; i++) {
      await page.mouse.move(cx + i * 6, cy - i * 2);
      await frames(page, 1);
    }
    await page.mouse.up();
    const cam = await k(() => window.__knap.camera());
    // pan (right drag) and zoom (wheel)
    await page.mouse.move(cx, cy);
    await page.mouse.down({ button: 'right' });
    for (let i = 1; i <= 5; i++) {
      await page.mouse.move(cx + i * 8, cy + i * 3);
      await frames(page, 1);
    }
    await page.mouse.up({ button: 'right' });
    for (let i = 0; i < 4; i++) {
      await page.mouse.wheel(0, i < 2 ? -120 : 120);
      await frames(page, 1);
    }
    await page.setViewportSize({ width: 1100, height: 650 });
    await frames(page, 3);
    await page.setViewportSize({ width: 1280, height: 720 });
    await frames(page, 3);
    const v1 = await viewRenders();
    const r1 = await renders();
    assert(v1 - v0 >= 25, `the view did re-render (${v1 - v0} frames)`);
    assert(Math.abs(cam.yaw - Math.PI / 4) > 0.05, `orbited (yaw ${cam.yaw.toFixed(3)})`);
    assert(r1 === r0, `orbit / pan / zoom / resize: ${r1 - r0} shadow renders in ${v1 - v0} frames (expected 0)`);
    await page.waitForTimeout(300);
    await frames(page, 2);
    assert((await renders()) === r0, 'idle: no shadow render');
    await k(() => window.__knap.home());
    await frames(page, 2);
  });

  await step('an edit adds 1 render; a colour-only change none', async () => {
    const r0 = await renders();
    const m = structuredClone(cart);
    m.parts.find((p) => p.id === 1).cells.push(cell(-1, 0, 0));
    await k((m) => window.__knap.setModel(m), m);
    await frames(page, 3);
    const r1 = await renders();
    assert(r1 === r0 + 1, `an edit: +${r1 - r0} (expected 1)`);
    assert((await at(-1, 0)) > 0.3, 'the added cell casts');
    const m2 = structuredClone(m);
    m2.parts[0].color = '#e0b43c';
    await k((m) => window.__knap.setModel(m), m2);
    await frames(page, 3);
    assert((await renders()) === r1, 'a colour change: no re-render');
    await k((m) => window.__knap.setModel(m), cart);
    await frames(page, 2);
  });

  await step('simulate: the same floor and shadow as in edit mode; one simulated frame adds 1', async () => {
    const edit = [];
    const pts = [[0, -1], [4, 0], [4, 1], [8, 3], [1.2, -1]];
    for (const [x, z] of pts) edit.push(await at(x, z));
    await k(() => window.__knap.stepSim(0));
    await frames(page, 2);
    const info = await k(() => window.__knap.simInfo());
    const floor = await k(() => window.__knap.floor());
    assert(floor && Object.keys(floor).join() === 'y' && Math.abs(floor.y - info.groundY) < 1e-12, `floor at sim.groundY ${info.groundY}: ${JSON.stringify(floor)}`);
    const sim = [];
    for (const [x, z] of pts) sim.push(await at(x, z));
    const d = Math.max(...sim.map((v, i) => Math.abs(v - edit[i])));
    assert(d < 0.01, `edit vs simulate at t = 0 differ by ${d.toFixed(4)} (${edit.map((v) => v.toFixed(3))} / ${sim.map((v) => v.toFixed(3))})`);
    await frames(page, 3);
    const r0 = await renders();
    await frames(page, 3); // paused: the same poses every frame
    assert((await renders()) === r0, 'paused simulation: no re-render');
    await k(() => window.__knap.stepSim(1));
    await frames(page, 3);
    const r1 = await renders();
    assert(r1 === r0 + 1, `one simulated frame: +${r1 - r0} (expected 1)`);
    await k(() => window.__knap.setMode('edit'));
    await frames(page, 2);
  });

  await step('pixels: the shadow darkens the floor from above; nothing from below', async () => {
    await k(() => window.__knap.stepSim(0)); // simulate mode: no edit grid on the floor
    await k(() => window.__knap.setView('top'));
    await k(() => window.__knap.fit());
    await k(() => {
      const c = window.__knap.camera();
      window.__knap.setCamera({ ...c, height: c.height * 2 }); // room around the cart
    });
    await frames(page, 2);
    const px = async (p) => {
      const q = await k((p) => window.__knap.screenPos(p), p);
      const box = await page.locator('[data-role=viewport]').boundingBox();
      assert(q.x > box.x + 5 && q.x < box.x + box.width - 5 && q.y > box.y + 5 && q.y < box.y + box.height - 5, `${p} is in the view`);
      return k(([x, y]) => window.__knap.pixelAt(x, y), [q.x, q.y]);
    };
    // the skirt beside the front-left wheel (outside it, seen from straight above) and a far floor point
    const skirt = await px([0, -1.46, -1.62]);
    const far = await px([4, -1.46, 7]);
    const bottom = async () => {
      await k(() => window.__knap.setView('bottom'));
      await frames(page, 2);
      return [await px([0, -1.46, -1.62]), await px([4, -1.46, 7])];
    };
    assert(far[0] >= 236 && far[0] <= 243, `the tint alone: ${far} (background 247)`);
    assert(skirt[0] < far[0] - 12, `beside a wheel the shadow is clearly darker: ${skirt} vs ${far}`);
    console.log(`  [app-shadow] TOP, simulate mode: floor beside a wheel ${skirt}, far floor ${far} (background 247)`);
    await shot('app-shadow-top');
    const [sb, fb] = await bottom();
    assert(sb[0] === 247 && fb[0] === 247, `from below nothing is drawn: ${sb} ${fb}`);
    await k(() => window.__knap.setMode('edit'));
    await k(() => window.__knap.home());
    await frames(page, 2);
  });

  await step('a hidden part casts no shadow', async () => {
    const w = cart.parts.find((p) => p.cells.some((c) => c.rim && c.x === 0 && c.z === -1)).id;
    // under the wheel's contact line: what is left is the faint shade of its axle pin (1.2 up)
    const before = await at(0, -1);
    await k((id) => window.__knap.setPartVisible(id, false), w);
    const hidden = await at(0, -1);
    await k((id) => window.__knap.setPartVisible(id, true), w);
    const back = await at(0, -1);
    assert(before > WHEEL_MIN && hidden < before / 4 && back === before, `under the wheel: ${before.toFixed(3)} → ${hidden.toFixed(3)} hidden → ${back.toFixed(3)} shown`);
  });

  await step('stability: the Cart moved along X in sub-texel steps, across re-centres and size changes', async () => {
    // points fixed relative to the cart: wheel contacts, the skirt beside a wheel, chassis, between beams
    const rel = [[0, -1], [0.9, -1], [1.3, -1.6], [8, 3], [4, 0], [4, 1], [2.5, 2], [-1.2, 1]];
    const ids = cart.parts.map((p) => p.id);
    const extra = { id: 99, color: '#999999', cells: [cell(24, -1, 1, 'pinHole', 1)] }; // lies on the floor
    const sample = async (dx) => {
      const v = [];
      for (const [x, z] of rel) v.push(await at(x + dx, z));
      return v;
    };
    const move = (dx, extraDx = 0) =>
      k(([ids, dx, ex]) => {
        for (const id of ids) window.__knap.setPartTransform(id, [dx, 0, 0]);
        if (ex !== null) window.__knap.setPartTransform(99, [ex, 0, 0]);
      }, [ids, dx, extraDx]);
    // (1) the cart alone, 0.35-texel steps over 1.75 units: the shadow travels with it. What remains is
    // the resampling error of a 0.125-unit texel grid (bilinear lookup of a curve sampled at texel
    // centres), ≤ 0.02 strength = 0.007 opacity ≈ 1.7 grey levels on the background.
    const TOL = 0.02;
    const base = await sample(0);
    let worst = 0;
    let worstStep = 0;
    const origins = new Set();
    const sizes = new Set();
    const frame = async () => {
      const f = await k(() => window.__knap.shadowInfo().frame);
      origins.add(`${f.x0},${f.z0}`);
      sizes.add(`${f.w}x${f.d}`);
      return f;
    };
    let prev = base;
    let v = base;
    const N = 40;
    const STEP = 0.0437;
    for (let i = 1; i <= N; i++) {
      const dx = i * STEP;
      await move(dx, null);
      v = await sample(dx);
      await frame();
      const d = Math.max(...v.map((x, j) => Math.abs(x - base[j])));
      const ds = Math.max(...v.map((x, j) => Math.abs(x - prev[j])));
      worst = Math.max(worst, d);
      worstStep = Math.max(worstStep, ds);
      assert(d <= TOL, `dx ${dx.toFixed(3)}: differs by ${d.toFixed(4)} from dx 0 (${v.map((x) => x.toFixed(3))} vs ${base.map((x) => x.toFixed(3))})`);
      prev = v;
    }
    const atEnd = v;
    const dxEnd = N * STEP;
    // (2) the cart still at dxEnd, a far part on the floor moving away: the frame grows and re-centres
    // (16 → 32 → 64 wide), then shrinks back when the far part is hidden. The texel grid is fixed in
    // world space, so the cart's shadow is bit-identical throughout.
    await k((m) => window.__knap.setModel(m), { ...cart, nextPartId: 100, parts: [...cart.parts, extra] });
    let exact = 0;
    for (let i = 0; i <= 12; i++) {
      await move(dxEnd, i * 3.1);
      const w = await sample(dxEnd);
      const f = await frame();
      const d = Math.max(...w.map((x, j) => Math.abs(x - atEnd[j])));
      exact = Math.max(exact, d);
      assert(d < 1e-9, `far part at x ${(24 + i * 3.1).toFixed(1)} (frame ${JSON.stringify(f)}): the cart's shadow changed by ${d.toFixed(4)}`);
    }
    await k(() => window.__knap.setPartVisible(99, false));
    {
      const w = await sample(dxEnd);
      await frame();
      const d = Math.max(...w.map((x, j) => Math.abs(x - atEnd[j])));
      assert(d < 1e-9, `far part hidden (frame shrinks): the cart's shadow changed by ${d.toFixed(4)}`);
    }
    await k(() => window.__knap.clearTransforms());
    await k((m) => window.__knap.setModel(m), cart);
    await frames(page, 2);
    console.log(`  [app-shadow] stability: moving ${dxEnd.toFixed(2)} units in ${STEP} steps: worst ${worst.toFixed(4)} from the start, ${worstStep.toFixed(4)} step to step; across frame changes ${exact}; ${origins.size} frame origins, sizes ${[...sizes].join(', ')}`);
    assert(origins.size >= 3 && sizes.size >= 3, `exercised re-centres (${origins.size} origins) and size changes (${[...sizes].join(', ')})`);
  });

  await step('a rolling cart keeps its shadow under its wheels', async () => {
    await k(() => window.__knap.stepSim(0));
    // every body at 4 units/s along +X, the wheels with the matching rolling spin ω_z = −v / r
    const wheels = cart.parts.filter((p) => p.cells.some((c) => c.rim));
    const wheelIds = wheels.map((p) => p.id);
    await k(([ids, wheelIds]) => ids.forEach((id) => window.__knap.pushBody(id, [4, 0, 0], wheelIds.includes(id) ? [0, 0, -4 / 1.5] : undefined)), [cart.parts.map((p) => p.id), wheelIds]);
    let lo = 1;
    let hi = 0;
    let x0 = null;
    let x1 = 0;
    for (let i = 0; i < 12; i++) {
      await k(() => window.__knap.stepSim(20));
      const t = await k(() => window.__knap.simTransforms());
      for (const w of wheels) {
        const c = w.cells[0];
        const p = applyT(t[w.id], [c.x, c.y, c.z]); // the hub's current position
        const v = await at(p[0], p[2]);
        lo = Math.min(lo, v);
        hi = Math.max(hi, v);
        if (w === wheels[0]) {
          x0 ??= p[0] - c.x;
          x1 = p[0] - c.x;
        }
      }
    }
    console.log(`  [app-shadow] rolling: wheel 1 travelled ${(x1 - x0).toFixed(2)} units; shadow under the wheels ${lo.toFixed(3)}…${hi.toFixed(3)}`);
    assert(Math.abs(x1 - x0) > 0.5, `the cart rolled (${(x1 - x0).toFixed(2)} units)`);
    assert(lo >= WHEEL_MIN && hi - lo < 0.04, `under the rolling wheels ${lo.toFixed(3)}…${hi.toFixed(3)}`);
    await frames(page, 2);
    await shot('app-shadow-rolling');
    await k(() => window.__knap.setMode('edit'));
    await frames(page, 2);
  });

  await step('a beam lying on the floor; lifted in steps it fades monotonically to nothing at SHADOW_H', async () => {
    const beam = { version: 2, rootPartId: 1, nextPartId: 2, ground: true, parts: [{ id: 1, color: '#3b74c4', cells: [0, 1, 2, 3, 4, 5, 6].map((x) => cell(x, 0, 0)) }] };
    await k((m) => window.__knap.setModel(m), beam);
    await frames(page, 2);
    const c = await at(3, 0);
    const edge = await at(3, 0.47);
    const out = await at(3, 0.47 + 2 * SIGMA);
    const outFar = await at(3, 0.47 + 3.5 * SIGMA);
    const end = await at(-0.47 - 2 * SIGMA, 0);
    assert(Math.abs(c - stripCentre(-0.01, 0.94)) < 0.03, `beam centre ${c.toFixed(3)} ≈ ${stripCentre(0, 0.94).toFixed(3)}`);
    assert(Math.abs(edge - strip(-0.01, 0.94, 0.47)) < 0.04, `at its long edge ${edge.toFixed(3)} ≈ ${strip(-0.01, 0.94, 0.47).toFixed(3)}`);
    const eOut = strip(-0.01, 0.94, 0.47 + 2 * SIGMA);
    const eFar = strip(-0.01, 0.94, 0.47 + 3.5 * SIGMA);
    assert(Math.abs(out - eOut) < 0.04 && Math.abs(outFar - eFar) < 0.04 && outFar < out && out < edge, `soft edge: 2σ outside ${out.toFixed(3)} (model ${eOut.toFixed(3)}), 3.5σ ${outFar.toFixed(3)} (model ${eFar.toFixed(3)}), past its end ${end.toFixed(3)}`);
    await shot('app-shadow-beam');
    const seq = [];
    for (let i = 0; i <= 13; i++) {
      const dy = i * 0.25;
      await k((dy) => window.__knap.setPartTransform(1, [0, dy, 0]), dy);
      seq.push(await at(3, 0));
    }
    await k(() => window.__knap.clearTransforms());
    console.log(`  [app-shadow] beam lifted 0…3.25 in 0.25 steps: ${seq.map((v) => v.toFixed(3)).join(' ')}`);
    for (let i = 1; i < seq.length; i++) assert(seq[i] <= seq[i - 1] + 1e-9, `monotone fade: ${seq.map((v) => v.toFixed(3))}`);
    assert(Math.abs(seq[0] - stripCentre(-0.01, 0.94)) < 0.03 && seq[12] === 0 && seq[13] === 0, `full at the floor, nothing from SHADOW_H up: ${seq.map((v) => v.toFixed(3))}`);
    // the analytic strip model at each height (raster + bilinear: within 0.03)
    for (let i = 0; i <= 12; i++) {
      const e = stripCentre(i * 0.25 - 0.01, 0.94);
      assert(Math.abs(seq[i] - e) < 0.03, `lifted ${i * 0.25}: ${seq[i].toFixed(3)} vs (1 − h/H)²·blur ${e.toFixed(3)}`);
    }
  });

  await step('a pendulum hung 5 units above the floor casts nothing', async () => {
    // fixed post (root) x = 0, z = 0, y = 0 … −10 (its 1×1 foot: ≈ 0.45 after both blurs; the ambient
    // lobe's skirt reaches past x = 2, so "nothing from the link" is checked against the post alone);
    // a 5-hole link on a pin at its top, layer z = 1
    const m = {
      version: 2,
      rootPartId: 1,
      nextPartId: 4,
      ground: true,
      parts: [
        { id: 1, color: '#5f6468', cells: Array.from({ length: 11 }, (_, i) => cell(0, -i, 0)) },
        { id: 2, color: '#c8433a', cells: [0, 1, 2, 3, 4].map((x) => cell(x, 0, 1)) },
        { id: 3, color: '#d9d4c7', cells: [cell(0, 0, 0, 'pin'), cell(0, 0, 1, 'pin')] },
      ],
    };
    await k((m) => window.__knap.setModel(m), m);
    await frames(page, 2);
    const floor = await k(() => window.__knap.floor());
    assert(Math.abs(floor.y - (-10.46)) < 1e-9, `floor under the post ${floor.y}`);
    const post = await at(0, 0);
    const pts = [[2, 1], [3, 1], [4, 1], [-2, 1], [-3, 1], [-4, 1], [2.5, 2.5], [-2.5, 2.5], [0, 3]];
    const sample = async () => {
      const v = [];
      for (const [x, z] of pts) v.push(await at(x, z));
      return v;
    };
    // the post alone (link and pin hidden): the reference
    for (const id of [2, 3]) await k((id) => window.__knap.setPartVisible(id, false), id);
    const alone = await sample();
    for (const id of [2, 3]) await k((id) => window.__knap.setPartVisible(id, true), id);
    const withLink = await sample();
    assert(post > 0.35 && withLink.every((v, i) => v === alone[i]) && alone[2] === 0, `the post casts (${post.toFixed(3)}), the link 9.96 above the floor adds nothing: ${withLink} vs post alone ${alone}`);
    await k(() => window.__knap.stepSim(0));
    let worst = 0;
    for (let i = 0; i < 6; i++) {
      await k(() => window.__knap.stepSim(80));
      const v = await sample();
      for (let j = 0; j < v.length; j++) worst = Math.max(worst, Math.abs(v[j] - alone[j]));
    }
    assert(worst === 0, `swinging (lowest point ≥ 5 above the floor): nothing added under the link (max ${worst})`);
    await frames(page, 2);
    await shot('app-shadow-pendulum');
    await k(() => window.__knap.setMode('edit'));
  });

  await step('groups farther apart than the maximum frame: the bigger one keeps its full shadow', async () => {
    const beam = (id, x0, z) => ({ id, color: '#a8adb2', cells: [0, 1, 2, 3, 4].map((i) => cell(x0 + i, 0, z)) });
    for (const far of [100, 130, 200, -200]) {
      // a group of three beams at x 0…4, and one lone beam `far` away
      await k((m) => window.__knap.setModel(m), { version: 2, rootPartId: 1, nextPartId: 5, ground: true, fixRoot: false, parts: [beam(1, 0, 0), beam(2, 0, 2), beam(3, 0, 4), beam(4, far, 0)] });
      await frames(page, 1);
      const group = await at(2, 2);
      const lone = await at(far + 2, 0);
      const ref = stripCentre(-0.01, 0.94);
      if (Math.abs(far) < 110) assert(group > 0.4 && Math.abs(lone - ref) < 0.03, `${far} apart (one frame holds both): group ${group.toFixed(3)}, lone ${lone.toFixed(3)}`);
      else assert(group > 0.4 && lone === 0, `${far} apart: the group keeps its shadow (${group.toFixed(3)}), the lone beam is outside the frame (${lone})`);
    }
    // the lone beam moves next to the group: both shadowed again
    await k((m) => window.__knap.setModel(m), { version: 2, rootPartId: 1, nextPartId: 5, ground: true, fixRoot: false, parts: [beam(1, 0, 0), beam(2, 0, 2), beam(3, 0, 4), beam(4, 20, 0)] });
    assert((await at(22, 0)) > 0.5 && (await at(2, 2)) > 0.4, 'side by side: both shadowed');
  });

  await step('a lost and restored WebGL context redraws the shadow', async () => {
    await k(() => window.__knap.loadExample('cart'));
    await frames(page, 2);
    const before = await at(0, -1);
    const lost = await k(async () => {
      const c = document.querySelector('[data-role=viewport] canvas') || document.querySelector('canvas');
      const gl = c.getContext('webgl2');
      const ext = gl && gl.getExtension('WEBGL_lose_context');
      if (!ext) return false;
      ext.loseContext();
      await new Promise((r) => setTimeout(r, 300));
      ext.restoreContext();
      await new Promise((r) => setTimeout(r, 500));
      return true;
    });
    errors.length = 0; // three.js logs the loss
    await frames(page, 4);
    const after = await at(0, -1);
    assert(!lost || Math.abs(after - before) < 0.01, `under a wheel: ${before.toFixed(3)} before, ${after.toFixed(3)} after (lost: ${lost})`);
    if (!lost) console.log('  [app-shadow] WEBGL_lose_context not available: context loss not exercised');
    await shot('app-shadow-after-context-restore');
  });

  await step('ground off: groundShadowAt is null', async () => {
    await k(() => window.__knap.loadExample('pendulum'));
    await frames(page, 2);
    assert((await at(0, 0)) === null && (await k(() => window.__knap.floor())) === null, 'no ground, no shadow');
    await settle(page);
  });

  assert(errors.length === 0, `no console errors: ${errors.join(' | ')}`);
}
