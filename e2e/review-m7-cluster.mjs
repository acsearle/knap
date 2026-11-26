// Reviewer verify-ui: does the >128-unit shadow frame (clusterWindow) flip between two equal
// groups? Two copies of the Cart, simulated, (a) standing still 150 apart, (b) driving apart.
// Counts how often the shadowed cart changes, with screenshots of two consecutive frames.
//   E2E_DIST=e2e/out/review-m7-dist node e2e/review-m7-cluster.mjs
import { frames } from './app-lib.mjs';
import { K, session, setModel } from './review-m7-lib.mjs';

const S = await session();
const log = (...a) => console.log(...a);
const at = (page, x, z) => K(page, ([x, z]) => window.__knap.groundShadowAt(x, z), [x, z]);
try {
  const ctx = await S.open('cluster', { width: 1280, height: 720 });
  const { page } = ctx;
  await K(page, () => window.__knap.loadExample('cart'));
  const cart = await K(page, () => window.__knap.getModel());
  const two = (dx) => ({
    ...structuredClone(cart),
    parts: [...cart.parts.map((p) => structuredClone(p)), ...cart.parts.map((p) => ({ ...structuredClone(p), id: p.id + 100, cells: p.cells.map((c) => ({ ...c, x: c.x + dx })) }))],
    nextPartId: 200,
  });
  for (const [label, dx, push] of [
    ['still 150 apart', 150, 0],
    ['still 125 apart', 125, 0],
    ['driving apart', 12, 45],
  ]) {
    await K(page, () => window.__knap.setMode('edit'));
    await setModel(page, two(dx));
    await K(page, () => window.__knap.setFriction('realistic'));
    await K(page, () => window.__knap.stepSim(0));
    let who = [];
    let switches = 0;
    let shotN = 0;
    for (let i = 0; i < 240; i++) {
      if (push) await K(page, (v) => { window.__knap.pushBody(1, [-v, 0, 0]); window.__knap.pushBody(101, [v, 0, 0]); }, push);
      await K(page, () => window.__knap.stepSim(6));
      const t = await K(page, () => window.__knap.simTransforms());
      // each cart's wheel (part 3 / 103): hub edit (0,0,-1)? use the transformed hub
      const hubOf = (id) => {
        const p = (id > 100 ? cart.parts.find((q) => q.id === id - 100) : cart.parts.find((q) => q.id === id));
        const h = p.cells.find((c) => c.rim);
        const tr = t[id];
        const [x, y, z, w] = tr.q;
        const v = [h.x + (id > 100 ? dx : 0), h.y, h.z];
        const tx = 2 * (y * v[2] - z * v[1]), ty = 2 * (z * v[0] - x * v[2]), tz = 2 * (x * v[1] - y * v[0]);
        return [v[0] + w * tx + (y * tz - z * ty) + tr.p[0], v[2] + w * tz + (x * ty - y * tx) + tr.p[2]];
      };
      const [ax, az] = hubOf(3);
      const [bx, bz] = hubOf(103);
      const sa = await at(page, ax, az);
      const sb = await at(page, bx, bz);
      const w = sa > 0.3 && sb > 0.3 ? 'AB' : sa > 0.3 ? 'A' : sb > 0.3 ? 'B' : '-';
      if (who.length && who.at(-1) !== w) {
        switches++;
        if (shotN < 2 && w !== 'AB' && who.at(-1) !== 'AB') {
          await K(page, () => window.__knap.setView('top'));
          await K(page, () => window.__knap.fit());
          await frames(page, 2);
          await ctx.shot(`review-m7-cluster-flip-${label.replace(/ /g, '')}-${shotN++}`);
        }
      }
      who.push(w);
      if (push && bx - ax > 300) break;
    }
    const runs = [];
    for (const w of who) if (!runs.length || runs.at(-1)[0] !== w) runs.push([w, 1]); else runs.at(-1)[1]++;
    log(`${label}: ${who.length} samples (6 steps = 12.5 ms sim each), shadowed cart changes ${switches}; runs ${runs.map(([w, n]) => `${w}×${n}`).join(' ')}`);
    await K(page, () => window.__knap.setMode('edit'));
  }
} finally {
  await S.close();
}
process.exit(0);
