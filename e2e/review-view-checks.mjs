// Independent review checks of src/view: node e2e/review-view-checks.mjs [section ...]
// Prints PASS/FAIL lines; exits 1 if any check fails. Sections: basis cube anim fit idle memory
// dispose pick resize width shimmer transform cubeclick
import { join } from 'node:path';
import { OUT_DIR, READBACK, check, harness, results } from './review-view-lib.mjs';

const want = new Set(process.argv.slice(2));
const run = (s) => want.size === 0 || want.has(s);
const H = await harness();
const { open } = H;
const ISO_PITCH = Math.atan(1 / Math.SQRT2);
const wrap = (a) => {
  let r = a % (2 * Math.PI);
  if (r <= -Math.PI) r += 2 * Math.PI;
  else if (r > Math.PI) r -= 2 * Math.PI;
  return r;
};
const EXAMPLES = ['pendulum', 'triple-pendulum', 'four-bar', 'parallelogram', 'sliding-axle', 'weld-test', 'collision'];

try {
  // ----------------------------------------------------------------------------- basis
  if (run('basis')) {
    const c = await open('example=four-bar&anim=0');
    const out = await c.page.evaluate(() => {
      const vp = window.__view.vp;
      const names = ['front', 'back', 'left', 'right', 'top', 'bottom', 'top-front-right', 'bottom-back-left', 'front-right', 'top-back'];
      const res = {};
      for (const n of names) {
        vp.snapTo(n, { animate: false });
        vp.renderNow();
        const cam = vp.camera; // private three camera
        const e = cam.matrixWorld.elements;
        // three camera looks along -Z of its frame; up = +Y of its frame
        res[n] = { fwd: [-e[8], -e[9], -e[10]], up: [e[4], e[5], e[6]], right: [e[0], e[1], e[2]] };
      }
      return res;
    });
    const near3 = (a, b) => a.every((v, i) => Math.abs(v - b[i]) < 1e-6);
    const s3 = 1 / Math.sqrt(3);
    const s2 = 1 / Math.SQRT2;
    check('basis FRONT looks along -Z, up +Y, right +X', near3(out.front.fwd, [0, 0, -1]) && near3(out.front.up, [0, 1, 0]) && near3(out.front.right, [1, 0, 0]), out.front);
    check('basis BACK looks along +Z, up +Y, right -X', near3(out.back.fwd, [0, 0, 1]) && near3(out.back.up, [0, 1, 0]) && near3(out.back.right, [-1, 0, 0]), out.back);
    check('basis RIGHT looks along -X, up +Y, right -Z', near3(out.right.fwd, [-1, 0, 0]) && near3(out.right.up, [0, 1, 0]) && near3(out.right.right, [0, 0, -1]), out.right);
    check('basis LEFT looks along +X, up +Y', near3(out.left.fwd, [1, 0, 0]) && near3(out.left.up, [0, 1, 0]), out.left);
    check('basis TOP looks along -Y, up -Z (front at bottom)', near3(out.top.fwd, [0, -1, 0]) && near3(out.top.up, [0, 0, -1]), out.top);
    check('basis BOTTOM looks along +Y, up +Z', near3(out.bottom.fwd, [0, 1, 0]) && near3(out.bottom.up, [0, 0, 1]), out.bottom);
    check('basis iso looks along -(1,1,1)', near3(out['top-front-right'].fwd, [-s3, -s3, -s3]) && out['top-front-right'].up[1] > 0, out['top-front-right']);
    check('basis bottom-back-left looks along (1,1,1)', near3(out['bottom-back-left'].fwd, [s3, s3, s3]), out['bottom-back-left']);
    check('basis front-right looks along -(1,0,1)/√2', near3(out['front-right'].fwd, [-s2, 0, -s2]), out['front-right']);
    check('basis top-back looks along (0,-1,1)/√2', near3(out['top-back'].fwd, [0, -s2, s2]), out['top-back']);
    await c.close();
  }

  // ----------------------------------------------------------------------------- cube labels / pick
  if (run('cube')) {
    for (const dpr of [1, 2]) {
      const c = await open('example=four-bar&anim=0', { width: 1000, height: 640, deviceScaleFactor: dpr });
      // The cube's own pick and label orientation: from each face view, the centre of the cube
      // must pick that face, and the face mesh named for it must face the camera.
      const r = await c.page.evaluate(() => {
        const vp = window.__view.vp;
        const out = [];
        for (const [n, d] of [['front', [0, 0, 1]], ['back', [0, 0, -1]], ['right', [1, 0, 0]], ['left', [-1, 0, 0]], ['top', [0, 1, 0]], ['bottom', [0, -1, 0]]]) {
          vp.snapTo(n, { animate: false });
          vp.renderNow();
          const rect = vp.cube.rect(vp.size.width);
          const got = vp.cube.pick(rect.x + rect.size / 2, rect.y + rect.size / 2, vp.size.width);
          // which labelled mesh faces the cube camera most?
          const fwd = (() => { const e = vp.cube.camera.matrixWorld.elements; return [-e[8], -e[9], -e[10]]; })();
          let best = null; let bd = 0;
          for (const m of vp.cube.faces) {
            const nrm = m.geometry.getAttribute('normal');
            const dd = -(nrm.getX(0) * fwd[0] + nrm.getY(0) * fwd[1] + nrm.getZ(0) * fwd[2]);
            if (dd > bd) { bd = dd; best = m.name; }
          }
          out.push({ n, d, got, label: best });
        }
        return out;
      });
      for (const o of r) check(`cube dpr${dpr} centre of cube in ${o.n} view picks ${o.n} and shows label ${o.n.toUpperCase()}`, o.got && o.got.join() === o.d.join() && o.label === o.n.toUpperCase(), o);
      // Real clicks on every one of the 26 regions (from an orientation that shows it)
      const names = await c.page.evaluate(() => {
        // eslint-disable-next-line no-undef
        return null;
      });
      void names;
      const regions = [];
      for (let x = -1; x <= 1; x++) for (let y = -1; y <= 1; y++) for (let z = -1; z <= 1; z++) if (x || y || z) regions.push([x, y, z]);
      let bad = [];
      for (const d of regions) {
        // look from a direction that shows the region well: d plus a small tilt toward all axes
        const look = d.map((v, i) => v * 3 + [0.35, 0.5, 0.25][i] * (v === 0 ? 1 : 0));
        const pt = await c.page.evaluate(([look, d]) => {
          const vp = window.__view.vp;
          const yaw = Math.atan2(look[0], look[2]);
          const pitch = Math.atan2(look[1], Math.hypot(look[0], look[2]));
          vp.setCamera({ ...vp.getCamera(), yaw, pitch }, { animate: false });
          vp.renderNow();
          const p = vp.cube.regionPoint(d, vp.size.width);
          return p;
        }, [look, d]);
        if (!pt) { bad.push({ d, why: 'region not visible' }); continue; }
        await c.page.mouse.move(pt[0], pt[1]);
        await c.page.mouse.down();
        await c.page.mouse.up();
        const cam = await c.page.evaluate(() => window.__view.settle());
        const h = Math.hypot(d[0], d[2]);
        const wantPitch = h === 0 ? Math.sign(d[1]) * Math.PI / 2 : Math.atan2(d[1], h);
        const okPitch = Math.abs(cam.pitch - wantPitch) < 1e-9;
        const okYaw = h === 0 ? Math.abs(wrap(cam.yaw - Math.round(cam.yaw / (Math.PI / 2)) * Math.PI / 2)) < 1e-9 : Math.abs(wrap(cam.yaw - Math.atan2(d[0], d[2]))) < 1e-9;
        if (!okPitch || !okYaw) bad.push({ d, cam });
      }
      check(`cube dpr${dpr}: real clicks on all 26 regions snap to that view exactly`, bad.length === 0, bad);
      await c.close();
    }
  }

  // ----------------------------------------------------------------------------- animation interplay
  if (run('anim')) {
    const c = await open('example=four-bar&anim=250', { width: 1000, height: 640 });
    const p = c.page;
    // snap then F (fit) immediately: the final orientation must be the snapped view
    let cam = await p.evaluate(async () => {
      const v = window.__view;
      v.vp.snapTo('front');
      await new Promise((r) => setTimeout(r, 60));
      v.vp.fit();
      return v.settle();
    });
    check('fit() during a snap animation still ends in the snapped view (yaw 0, pitch 0)', Math.abs(cam.yaw) < 1e-9 && Math.abs(cam.pitch) < 1e-9, cam);
    // fit then snap immediately: target must end at the fitted target
    const res = await p.evaluate(async () => {
      const v = window.__view;
      v.vp.setCamera({ target: [30, 5, -20], yaw: 0.3, pitch: 0.2, height: 40 }, { animate: false });
      const fitted = (() => { v.vp.fit('all', { animate: false }); const c = v.vp.getCamera(); return c; })();
      v.vp.setCamera({ target: [30, 5, -20], yaw: 0.3, pitch: 0.2, height: 40 }, { animate: false });
      v.vp.fit();
      await new Promise((r) => setTimeout(r, 60));
      v.vp.snapTo('top', { keepYaw: true });
      const end = await v.settle();
      return { fitted, end };
    });
    const dt = Math.hypot(...res.end.target.map((x, i) => x - res.fitted.target[i]));
    check('snap during a fit animation keeps the fit target/zoom', dt < 1e-6 && Math.abs(res.end.height - res.fitted.height) < 1e-6, res);
    // Home key twice in a row ends exactly at home
    cam = await p.evaluate(async () => {
      const v = window.__view;
      v.vp.snapTo('front');
      v.vp.home();
      return v.settle();
    });
    check('home ends exactly at the iso orientation', Math.abs(cam.pitch - Math.atan(1 / Math.SQRT2)) < 1e-12 && Math.abs(cam.yaw - Math.PI / 4) < 1e-12, cam);
    // wheel during animation keeps point under cursor relative to the end state
    await c.close();
  }

  // ----------------------------------------------------------------------------- fit tightness
  if (run('fit')) {
    const sizes = [[1280, 720], [400, 900], [1600, 300], [700, 700]];
    for (const [w, h] of sizes) {
      const rows = [];
      for (const ex of EXAMPLES) {
        const c = await open(`example=${ex}&grid=0&root=0&cube=0&anim=0`, { width: w, height: h });
        const r = await c.page.evaluate(`(() => {
          const d = ${READBACK};
          let x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1;
          for (let y = 0; y < d.h; y++) for (let x = 0; x < d.w; x++) {
            const i = (y * d.w + x) * 4;
            if (Math.abs(d.px[i] - 247) + Math.abs(d.px[i + 1] - 247) + Math.abs(d.px[i + 2] - 245) > 12) {
              if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
            }
          }
          return { w: d.w, h: d.h, x0, x1, y0, y1 };
        })()`);
        const fx = (r.x1 - r.x0 + 1) / r.w;
        const fy = (r.y1 - r.y0 + 1) / r.h;
        const cx = (r.x0 + r.x1 + 1) / 2 / r.w - 0.5;
        const cy = (r.y0 + r.y1 + 1) / 2 / r.h - 0.5;
        rows.push({ ex, fill: +Math.max(fx, fy).toFixed(3), fx: +fx.toFixed(3), fy: +fy.toFixed(3), off: [+cx.toFixed(3), +cy.toFixed(3)] });
        await c.close();
      }
      const minFill = Math.min(...rows.map((r) => r.fill));
      check(`fit ${w}x${h}: limiting dimension filled ≥ 75 % for every example (10 % margin → 83 %)`, minFill >= 0.75, rows);
      check(`fit ${w}x${h}: nothing clipped (fill ≤ 1)`, rows.every((r) => r.fx < 1 && r.fy < 1), rows.map((r) => [r.ex, r.fx, r.fy]));
    }
  }

  // ----------------------------------------------------------------------------- idle rendering
  if (run('idle')) {
    const c = await open('example=four-bar&anim=250&log=1', { width: 1000, height: 640 });
    const p = c.page;
    await p.evaluate(() => window.__view.settle());
    const r0 = await p.evaluate(() => window.__view.vp.stats().renders);
    await p.waitForTimeout(1500);
    const r1 = await p.evaluate(() => window.__view.vp.stats().renders);
    check('idle: no renders in 1.5 s without changes', r1 === r0, { r0, r1 });
    // hover moves over the scene (no cube hover change) must not render
    for (let i = 0; i < 20; i++) await p.mouse.move(300 + i * 5, 400);
    await p.waitForTimeout(200);
    const r2 = await p.evaluate(() => window.__view.vp.stats().renders);
    check('idle: hover moves over the scene do not render', r2 === r1, { r1, r2 });
    // a snap animation renders ≈ duration × fps frames then stops
    await p.evaluate(() => window.__view.vp.snapTo('front'));
    await p.evaluate(() => window.__view.settle());
    await p.waitForTimeout(300);
    const r3 = await p.evaluate(() => window.__view.vp.stats().renders);
    await p.waitForTimeout(800);
    const r4 = await p.evaluate(() => window.__view.vp.stats().renders);
    check('idle: rendering stops after the snap animation', r4 === r3, { r3, r4 });
    // onFrame unsubscribe stops the loop
    const r5 = await p.evaluate(async () => {
      const vp = window.__view.vp;
      let n = 0;
      const frames = (k) => new Promise((res) => { const f = () => (--k <= 0 ? res() : requestAnimationFrame(f)); requestAnimationFrame(f); });
      const off = vp.onFrame(() => n++);
      await frames(20);
      off();
      await frames(3);
      const a = vp.stats().renders;
      await frames(20);
      return { n, extra: vp.stats().renders - a };
    });
    check('onFrame: loop runs while subscribed and stops after unsubscribe', r5.n > 5 && r5.extra === 0, r5);
    await c.close();
  }

  // ----------------------------------------------------------------------------- memory
  if (run('memory')) {
    const c = await open('example=four-bar&anim=0', { width: 800, height: 500 });
    const r = await c.page.evaluate(async () => {
      const v = window.__view;
      const vp = v.vp;
      const info = () => ({ ...vp.renderer.info.memory, programs: vp.renderer.info.programs.length, geos: vp.stats().geometries, parts: vp.stats().parts });
      vp.renderNow();
      const before = info();
      const m0 = vp.getModel();
      const kinds = [
        { kind: 'pinHole', axis: 2 }, { kind: 'axleHole', axis: 0 }, { kind: 'pin', axis: 2 }, { kind: 'axle', axis: 1 }, { kind: 'frictionPin', axis: 0 },
      ];
      const cycle = (N) => {
      for (let i = 0; i < N; i++) {
        const op = i % 4;
        if (op === 0) v.edit('move', 2, [i % 2 ? 1 : -1, 0, 0]);
        else if (op === 1) v.edit('color', 3, i % 8 ? '#c8433a' : '#3b74c4');
        else if (op === 2) {
          // add a cell to part 4 then restore the original model (rebuild both ways)
          try { v.edit('add', 4, { x: 50 + (i % 7), y: 0, z: 0, kind: 'pinHole', axis: 2 }); } catch { /* rejected */ }
        } else vp.setModel(m0);
        const k = kinds[i % kinds.length];
        vp.setGhost({ cell: { x: i % 5, y: 3, z: 0, ...k }, valid: i % 2 === 0 });
        vp.setHoverFace({ cell: [i % 3, 0, 0], dir: i % 6 });
        vp.setHoverCell(i % 3 ? { cell: [0, i % 4, 0] } : null);
        vp.cube.setHover(i % 2 ? [1, i % 3 - 1, 0] : [0, 0, 1]);
        vp.setSelection(i % 3 ? [1] : []);
        if (i % 25 === 0) vp.renderNow();
      }
      vp.setModel(m0);
      vp.setGhost(null);
      vp.setHoverFace(null);
      vp.setHoverCell(null);
      vp.renderNow();
      };
      cycle(500);
      const mid = info();
      cycle(500);
      const end = info();
      return { before, mid, after: end };
    });
    check('memory: a second round of 500 setModel/overlay cycles adds no GPU geometries/textures/programs', r.after.geometries === r.mid.geometries && r.after.textures === r.mid.textures && r.after.programs === r.mid.programs, r);
    // render of a fresh setModel with identical parts: geometry shared
    await c.close();
  }

  // ----------------------------------------------------------------------------- dispose
  if (run('dispose')) {
    const c = await open('example=four-bar&anim=0', { width: 800, height: 500 });
    const warnings = [];
    c.page.on('console', (m) => { if (m.type() === 'warning' || m.type() === 'error') warnings.push(m.text()); });
    const r = await c.page.evaluate(async () => {
      const V = window.__view.vp.constructor;
      const m = window.__view.vp.getModel();
      const out = { lost: 0, created: 0, errors: [] };
      const ctxs = [];
      for (let i = 0; i < 24; i++) {
        const div = document.createElement('div');
        div.style.cssText = 'position:fixed;left:0;top:0;width:300px;height:200px';
        document.body.append(div);
        const vp = new V(div, {});
        vp.setModel(m);
        vp.renderNow();
        const gl = vp.renderer.getContext();
        ctxs.push(gl);
        vp.dispose();
        out.created++;
        out.leftover = div.childElementCount;
        div.remove();
      }
      await new Promise((r) => setTimeout(r, 300));
      // the main viewport must still be alive (Chrome caps live contexts at 16)
      const main = window.__view.vp.renderer.getContext();
      out.mainLost = main.isContextLost();
      out.disposedNotLost = ctxs.filter((g) => !g.isContextLost()).length;
      try {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'f' }));
      } catch (e) { out.errors.push(String(e)); }
      return out;
    });
    check('dispose: creating/disposing 24 viewports does not kill the live viewport context', !r.mainLost, r);
    check('dispose: disposed viewports release their WebGL context (forceContextLoss)', r.disposedNotLost === 0, { disposedNotLost: r.disposedNotLost, warnings: [...new Set(warnings)].slice(0, 3) });
    await c.close();
  }

  // ----------------------------------------------------------------------------- pick vs pixels
  if (run('pick')) {
    for (const dpr of [1, 2]) {
      for (const view of ['front', 'top', 'right', 'iso', 'bottom-back-left']) {
        const c = await open(`example=four-bar&grid=0&root=0&cube=0&anim=0&view=${view}`, { width: 900, height: 560, deviceScaleFactor: dpr });
        const r = await c.page.evaluate(`(() => {
          const vp = window.__view.vp;
          const d = ${READBACK};
          const dpr = vp.size.pixelRatio;
          const m = vp.getModel();
          const out = [];
          for (const part of m.parts) for (const cell of part.cells) {
            const p = vp.project([cell.x, cell.y, cell.z]);
            const ray = vp.rayAtLocal(p.x, p.y);
            const q = [cell.x - ray.origin[0], cell.y - ray.origin[1], cell.z - ray.origin[2]];
            const t = q[0] * ray.dir[0] + q[1] * ray.dir[1] + q[2] * ray.dir[2];
            const off = Math.hypot(q[0] - t * ray.dir[0], q[1] - t * ray.dir[1], q[2] - t * ray.dir[2]);
            out.push({ id: part.id, cell: [cell.x, cell.y, cell.z], off, t, px: [p.x, p.y] });
          }
          // pixel/geometry agreement: project each part's world box corners and compare with
          // where its colour appears; simpler: the three camera's projection of a point vs project()
          const cam = vp.camera;
          let worst = 0;
          for (const o of out) {
            const v = new cam.position.constructor(o.cell[0], o.cell[1], o.cell[2]).project(cam);
            const x = (v.x + 1) / 2 * vp.size.width, y = (1 - v.y) / 2 * vp.size.height;
            worst = Math.max(worst, Math.hypot(x - o.px[0], y - o.px[1]));
          }
          return { worstOff: Math.max(...out.map((o) => o.off)), minT: Math.min(...out.map((o) => o.t)), worst };
        })()`);
        check(`pick dpr${dpr} ${view}: ray through projected cell centre hits it (off < 1e-9), t > 0, render camera agrees (< 0.01 px)`, r.worstOff < 1e-9 && r.minT > 0 && r.worst < 0.01, r);
        await c.close();
      }
    }
  }

  // ----------------------------------------------------------------------------- resize / DPR
  if (run('resize')) {
    const c = await open('example=four-bar&anim=0', { width: 900, height: 560 });
    const p = c.page;
    await p.setViewportSize({ width: 500, height: 800 });
    await p.waitForTimeout(300);
    let r = await p.evaluate(() => { const g = window.__view.vp.renderer.getContext(); return { bw: g.drawingBufferWidth, bh: g.drawingBufferHeight, size: window.__view.vp.size }; });
    check('resize: drawing buffer follows the container', r.bw === 500 && r.bh === 800, r);
    await p.screenshot({ path: join(OUT_DIR, 'review-view-resized.png') });
    const cdp = await p.context().newCDPSession(p);
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 500, height: 800, deviceScaleFactor: 2, mobile: false });
    await p.waitForTimeout(500);
    // Headless CDP emulation fires no resolution media-query event; the viewport also re-checks
    // devicePixelRatio on every render, so draw one frame before reading (engineer's fix).
    await p.evaluate(() => window.__view.vp.renderNow());
    r = await p.evaluate(() => { const g = window.__view.vp.renderer.getContext(); return { dpr: devicePixelRatio, bw: g.drawingBufferWidth, bh: g.drawingBufferHeight, size: window.__view.vp.size, ss: window.__view.vp.stats().supersample }; });
    // supersample is now 2 at every DPR (DEVIATIONS §6 "Supersampling"; 1× flickers under orbit).
    check('DPR change 1→2: drawing buffer doubles, supersample stays 2', r.bw === 1000 && r.bh === 1600 && r.ss === 2, r);
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 500, height: 800, deviceScaleFactor: 1.5, mobile: false });
    await p.waitForTimeout(500);
    await p.evaluate(() => window.__view.vp.renderNow());
    r = await p.evaluate(() => { const g = window.__view.vp.renderer.getContext(); return { dpr: devicePixelRatio, bw: g.drawingBufferWidth, size: window.__view.vp.size }; });
    check('DPR change 2→1.5 also tracked', r.bw === 750, r);
    await p.screenshot({ path: join(OUT_DIR, 'review-view-dpr15.png') });
    await c.close();
  }

  // ----------------------------------------------------------------------------- transforms
  if (run('transform')) {
    const c = await open('example=pendulum&anim=0', { width: 800, height: 500 });
    const r = await c.page.evaluate(() => {
      const vp = window.__view.vp;
      const q = [0, 0, Math.sin(0.35), Math.cos(0.35)];
      vp.setPartTransform(2, [0.25, -1, 0.5], q);
      vp.renderNow();
      const pv = vp.views.get(2);
      const o = pv.origin;
      // expected world position of local point (0,0,0): R·origin + p
      const e = pv.colorMesh.matrixWorld.elements;
      const pos = [e[12], e[13], e[14]];
      const [x, y, z, w] = q;
      const rot = (v) => {
        const tx = 2 * (y * v[2] - z * v[1]), ty = 2 * (z * v[0] - x * v[2]), tz = 2 * (x * v[1] - y * v[0]);
        return [v[0] + w * tx + (y * tz - z * ty), v[1] + w * ty + (z * tx - x * tz), v[2] + w * tz + (x * ty - y * tx)];
      };
      const exp = rot(o).map((v, i) => v + [0.25, -1, 0.5][i]);
      const idE = pv.idMesh.matrixWorld.elements;
      return { pos, exp, same: idE.every((v, i) => v === e[i]) };
    });
    const err = Math.hypot(...r.pos.map((v, i) => v - r.exp[i]));
    check('transform: matrixWorld = R·origin + p exactly, id mesh identical', err < 1e-6 && r.same, r);
    await c.close();
  }
} finally {
  await H.done();
}
const fails = results.filter((r) => !r.ok);
console.log(`\n${results.length - fails.length}/${results.length} passed`);
process.exit(fails.length ? 1 : 0);
