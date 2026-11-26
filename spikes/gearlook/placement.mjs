// Part A — placement and phase rules for gears on the integer grid (pure maths, no rendering).
//   node spikes/gearlook/placement.mjs > spikes/gearlook/out/placement.txt
//
// Gears: pitch radius r ∈ {0.5, 1, 1.5, 2.5}, N = 16·r teeth, module 1/8 unit, pitch p = π/8.
// Two parallel-axis gears in one layer mesh iff their centre distance is exactly r1 + r2.
// Tooth phase: f_i(φ) = N_i·(φ − θ_i)/2π mod 1, the position (in pitches) of the direction φ in gear
// i's tooth pattern, 0 = tooth centre, ½ = gap centre, θ_i = angle of one tooth centre (CCW about the
// world +axis). Gear 2 is seen from gear 1 at φ, gear 1 from gear 2 at φ+π. Meshing ⇔
//   f_1(φ) + f_2(φ+π) ≡ ½ (mod 1)                              (tooth faces gap)
// and this sum is invariant under rolling (gear 1 turns δ, gear 2 turns −δ·r1/r2): checked below.
const RADII = [0.5, 1, 1.5, 2.5];
const N = (r) => Math.round(16 * r);
const frac = (x) => x - Math.floor(x);
const wrapHalf = (x) => frac(x + 0.5) - 0.5; // → [−½, ½)
const out = [];
const log = (...a) => out.push(a.join(' '));

// ---------------------------------------------------------------- 1. meshing offsets
log('== 1. In-plane integer offsets (du, dv) with |d| = r1 + r2 (du ≥ 0, dv ≥ 0 shown; all 8 symmetric images also mesh)');
const meshOffsets = new Map(); // "r1,r2" → [[du,dv],...]
for (let i = 0; i < RADII.length; i++)
  for (let j = i; j < RADII.length; j++) {
    const r1 = RADII[i], r2 = RADII[j];
    const s = r1 + r2;
    const offs = [];
    for (let du = 0; du <= 6; du++) for (let dv = 0; dv <= 6; dv++) if (du * du + dv * dv === s * s) offs.push([du, dv]);
    meshOffsets.set(`${r1},${r2}`, offs);
    log(`  r ${r1}+${r2} (N ${N(r1)}:${N(r2)}) sum ${s}: ${offs.length ? offs.map((o) => `(${o})`).join(' ') : 'none — sum not an integer distance'}`);
  }

// all offsets (du,dv) in full sign/swap symmetry for a pair
function allOffsets(r1, r2) {
  const s = r1 + r2;
  const o = [];
  for (let du = -6; du <= 6; du++) for (let dv = -6; dv <= 6; dv++) if (du * du + dv * dv === s * s) o.push([du, dv]);
  return o;
}

// ---------------------------------------------------------------- 1b. near misses: tips clash without meshing
log('');
log('== 1b. Integer offsets where two gears do NOT mesh but their tips overlap: r1+r2 < d < r1+r2+0.25 (full addendum 0.125 each)');
log('       and offsets where pitch discs overlap (d < r1+r2) — those the disc rule already blocks');
for (let i = 0; i < RADII.length; i++)
  for (let j = i; j < RADII.length; j++) {
    const r1 = RADII[i], r2 = RADII[j];
    const s = r1 + r2;
    const clash = [];
    for (let du = 0; du <= 7; du++)
      for (let dv = du; dv <= 7; dv++) {
        const d = Math.hypot(du, dv);
        if (d > s + 1e-12 && d < s + 0.25 - 1e-12) clash.push(`(${du},${dv}) d=${d.toFixed(3)} overlap ${(s + 0.25 - d).toFixed(3)}`);
      }
    if (clash.length) log(`  r ${r1}+${r2}: ${clash.join('; ')}`);
  }

// ---------------------------------------------------------------- 2. fixed phase rules
// θ_i chosen so that f_i(0) = s for every gear (a tooth-pattern offset s, in pitches, at the cell's
// +u axis). Then f_i(k·π/2) = s + N_i·k/4 ≡ s since 4 | N_i; f_i(φ+π) = s + N/2 ≡ s.
function meshResidual(r1, f1at, r2, f2at, du, dv) {
  const phi = Math.atan2(dv, du);
  return wrapHalf(f1at(phi) + f2at(phi + Math.PI) - 0.5);
}
const fixedRule = (s) => (r) => (phi) => frac(N(r) * phi / (2 * Math.PI) + s);
log('');
log('== 2a. Fixed phase: every gear has the same tooth-pattern offset s (pitches) at its +u axis. Residual (pitches, 0 = meshes) per family:');
for (const s of [0, 0.5, 0.25, 0.75]) {
  const row = [];
  for (const [k, offs] of meshOffsets) {
    const [r1, r2] = k.split(',').map(Number);
    for (const [du0, dv0] of allOffsets(r1, r2).filter(([a, b]) => a >= 0 && b >= 0)) {
      const res = meshResidual(r1, fixedRule(s)(r1), r2, fixedRule(s)(r2), du0, dv0);
      row.push(`${r1}+${r2}@(${du0},${dv0}):${res.toFixed(3)}`);
    }
    void offs;
  }
  log(`  s=${s}: ${row.join('  ')}`);
}
// A per-size offset s(r) ∈ {0, ½} (tooth or gap on the axis) can't work: same-size pairs need 2s ≡ ½.
log('  per-size choice s(r) ∈ {0, ½}: same-size pairs need 2·s ≡ ½ — impossible; s = ¼ (or ¾) for ALL gears is the only fixed rule that meshes every axis-aligned pair.');
// Diagonal residual for the (3,4) family under s=¼:
const diag = {};
for (const [du, dv] of allOffsets(2.5, 2.5).filter(([a, b]) => a !== 0 && b !== 0)) {
  diag[`${du},${dv}`] = meshResidual(2.5, fixedRule(0.25)(2.5), 2.5, fixedRule(0.25)(2.5), du, dv);
}
log(`  s=¼, 2.5+2.5 diagonals: ${Object.entries(diag).map(([k, v]) => `(${k}) ${v.toFixed(4)}`).join('  ')}`);
const A_DIAG = Math.abs(diag['4,3']);
log(`  → diagonal mesh needs the two 40-tooth gears turned by a total of ±${A_DIAG.toFixed(4)} pitch (= ${(A_DIAG * Math.PI / 8).toFixed(4)} units at the pitch circle)`);

// rolling invariance check
{
  let worst = 0;
  for (const [r1, r2] of [[0.5, 2.5], [1, 1], [1.5, 2.5]]) {
    for (let t = 0; t < 50; t++) {
      const d1 = (Math.random() - 0.5) * 3, d2 = -d1 * r1 / r2;
      const f1 = (phi) => frac(N(r1) * (phi - d1) / (2 * Math.PI) + 0.25);
      const f2 = (phi) => frac(N(r2) * (phi - d2) / (2 * Math.PI) + 0.25);
      worst = Math.max(worst, Math.abs(meshResidual(r1, f1, r2, f2, r1 + r2, 0)));
    }
  }
  log(`  rolling invariance: max residual after random rolling of meshed pairs = ${worst.toExponential(2)} pitches`);
}
// mirror: a part turned 180° about a transverse axis sees f → −f, i.e. ¼ → ¾ — half a pitch off.
log('  chirality: a ¼ offset is not mirror-symmetric (mirror maps ¼ → ¾ = half a pitch shift), so the phase must be taken in the WORLD frame (about +x/+y/+z), not carried by the part: flipping a gear part re-derives its teeth (they jump half a pitch).');

// ---------------------------------------------------------------- 2b. propagation algorithm
// Every gear has a rest offset g_i (pitches) on top of the canonical s=¼ world phase.
// Mesh edge e=(i,j): g_i + g_j ≡ δ_e (mod 1), δ_e = 0 axis-aligned, ±A_DIAG for diagonal (3,4)-type.
// (Turning gear i CCW by g pitches shifts f_i by −g; residual becomes res − g_i − g_j.)
function delta(du, dv, r1, r2) {
  // residual of the canonical phase for this offset: required g_i + g_j
  return wrapHalf(meshResidual(r1, fixedRule(0.25)(r1), r2, fixedRule(0.25)(r2), du, dv));
}
function key(g) {
  return `${g.axis}|${g.layer}|${g.u}|${g.v}`;
}
function cmpPos(a, b) {
  return a.axis - b.axis || a.layer - b.layer || a.u - b.u || a.v - b.v;
}
/** Mesh graph: gears {axis, layer, u, v, r}. Returns adjacency with δ. */
function meshGraph(gears) {
  const adj = gears.map(() => []);
  for (let i = 0; i < gears.length; i++)
    for (let j = i + 1; j < gears.length; j++) {
      const a = gears[i], b = gears[j];
      if (a.axis !== b.axis || a.layer !== b.layer) continue;
      const du = b.u - a.u, dv = b.v - a.v;
      const s = a.r + b.r;
      if (du * du + dv * dv !== s * s) continue;
      const d = delta(du, dv, a.r, b.r);
      adj[i].push({ j, d });
      adj[j].push({ j: i, d });
    }
  return adj;
}
/**
 * The phase rule. Returns { g[], conflicts[], odd[] } with g in (−½, ½].
 * 1. components of the mesh graph; 2. within each, BFS from the smallest position (NOT part id),
 *    g_root = 0, g_child = δ − g_parent; 3. bipartite components have a one-parameter family
 *    g_i + σ_i·t: pick t minimising Σ wrapHalf(g_i)² (closest to canonical), ties → smallest |t|, then t>0;
 *    so the result does not depend on which gear was the root; 4. non-tree edges: residual
 *    g_i + g_j − δ; |res| > TOL → the loop cannot be assembled (teeth clash).
 * Purely axis-aligned components: every δ = 0 → g ≡ 0: the canonical phase, no propagation at all.
 */
function phaseRule(gears, TOL = 1e-6) {
  const adj = meshGraph(gears);
  const n = gears.length;
  const g = new Array(n).fill(null);
  const sigma = new Array(n).fill(0);
  const conflicts = [];
  const odd = [];
  const order = [...gears.keys()].sort((a, b) => cmpPos(gears[a], gears[b]));
  for (const root of order) {
    if (g[root] !== null) continue;
    const comp = [root];
    g[root] = 0;
    sigma[root] = 1;
    let bip = true;
    const q = [root];
    const edges = [];
    while (q.length) {
      const i = q.shift();
      for (const { j, d } of adj[i]) {
        if (g[j] === null) {
          g[j] = wrapHalf(d - g[i]);
          sigma[j] = -sigma[i];
          comp.push(j);
          q.push(j);
        } else if (i < j) edges.push([i, j, d]);
        if (g[j] !== null && sigma[j] === sigma[i]) bip = false;
      }
    }
    if (bip && comp.length > 1) {
      // choose t
      let best = null;
      const cost = (t) => comp.reduce((acc, i) => acc + wrapHalf(g[i] + sigma[i] * t) ** 2, 0);
      const cands = [];
      for (let k = -500; k <= 500; k++) cands.push(k / 1000);
      // exact candidates: t making some gear canonical, and midpoints
      for (const i of comp) cands.push(wrapHalf(-g[i] * sigma[i]));
      for (const t of cands) {
        const c = cost(t);
        if (!best || c < best.c - 1e-12 || (Math.abs(c - best.c) <= 1e-12 && (Math.abs(t) < Math.abs(best.t) - 1e-12 || (Math.abs(Math.abs(t) - Math.abs(best.t)) <= 1e-12 && t > best.t)))) best = { t, c };
      }
      // refine around best (cost is piecewise quadratic)
      let { t } = best;
      for (let h = 1e-3; h > 1e-10; h /= 2) {
        for (const tt of [t - h, t + h]) if (cost(tt) < cost(t) - 1e-15) t = tt;
      }
      for (const i of comp) g[i] = wrapHalf(g[i] + sigma[i] * t);
    }
    for (const [i, j, d] of edges) {
      const res = wrapHalf(g[i] + g[j] - d);
      if (Math.abs(res) > TOL) conflicts.push({ i, j, res });
    }
    if (!bip) odd.push(comp);
  }
  return { g, conflicts, odd, adj };
}

// ---------------------------------------------------------------- 2c. checks over small configurations
log('');
log('== 2c. Phase rule checks over random and exhaustive small configurations');
function overlapsOK(gs) {
  // pitch discs may touch (mesh) but not overlap; also tips must not clash without meshing
  for (let i = 0; i < gs.length; i++)
    for (let j = i + 1; j < gs.length; j++) {
      const a = gs[i], b = gs[j];
      if (a.axis !== b.axis || a.layer !== b.layer) continue;
      const d2 = (a.u - b.u) ** 2 + (a.v - b.v) ** 2;
      const s = a.r + b.r;
      if (d2 === 0) return false;
      if (d2 < s * s) return false;
      if (d2 > s * s && d2 < (s + 0.25) ** 2) return false; // tip clash
    }
  return true;
}
function rnd(k) {
  return Math.floor(Math.random() * k);
}
function randomConfig(n, size) {
  for (let tries = 0; tries < 200; tries++) {
    const gs = [];
    for (let i = 0; i < n; i++) gs.push({ axis: 2, layer: 0, u: rnd(size), v: rnd(size), r: RADII[rnd(4)] });
    if (overlapsOK(gs)) return gs;
  }
  return null;
}
// Verify: (a) every mesh edge in a consistent component has residual 0 after applying g;
// (b) root/ordering independence: shuffle gear order → same g per position; (c) locality: adding a
// gear that joins no component changes nothing; (d) purely axis-aligned → g = 0.
let stats = { configs: 0, meshes: 0, diagEdges: 0, conflicts: 0, oddComps: 0, orderDep: 0, farEditFlips: 0, axisNonZero: 0, oddExamples: [], conflictExamples: [] };
function gOf(gs) {
  const r = phaseRule(gs);
  const m = new Map();
  gs.forEach((x, i) => m.set(key(x), r.g[i]));
  return { r, m };
}
for (let it = 0; it < 30000; it++) {
  const n = 2 + rnd(6);
  const gs = randomConfig(n, 9);
  if (!gs) continue;
  stats.configs++;
  const { r, m } = gOf(gs);
  const nEdges = r.adj.reduce((a, l) => a + l.length, 0) / 2;
  stats.meshes += nEdges;
  let comps = new Map();
  r.adj.forEach((l, i) => l.forEach((e) => { if (Math.abs(e.d) > 1e-9) stats.diagEdges += 0.5; }));
  // (a) residuals of all edges
  for (let i = 0; i < gs.length; i++) for (const { j, d } of r.adj[i]) if (i < j) {
    const res = wrapHalf(r.g[i] + r.g[j] - d);
    if (Math.abs(res) > 1e-6 && !r.conflicts.some((c) => (c.i === i && c.j === j))) stats.unexplained = (stats.unexplained ?? 0) + 1;
  }
  stats.conflicts += r.conflicts.length ? 1 : 0;
  if (r.conflicts.length && stats.conflictExamples.length < 3) stats.conflictExamples.push(gs.map((x) => `${x.r}@(${x.u},${x.v})`).join(' ') + ` res=${r.conflicts.map((c) => c.res.toFixed(4)).join(',')}`);
  if (r.odd.length) { stats.oddComps++; if (stats.oddExamples.length < 3) stats.oddExamples.push(r.odd.map((c) => c.map((i) => `${gs[i].r}@(${gs[i].u},${gs[i].v})`).join(' ')).join(' | ')); }
  // (d)
  const allAxis = r.adj.every((l) => l.every((e) => Math.abs(e.d) < 1e-9));
  if (allAxis && r.g.some((x) => Math.abs(x) > 1e-9)) stats.axisNonZero++;
  // (b) order independence
  const sh = [...gs].sort(() => Math.random() - 0.5);
  const m2 = gOf(sh).m;
  for (const [k, v] of m) if (Math.abs(wrapHalf(v - m2.get(k))) > 1e-6) { stats.orderDep++; break; }
  // (c) far edit: add a gear 20 cells away
  const far = [...gs, { axis: 2, layer: 0, u: 30 + rnd(3), v: rnd(3), r: RADII[rnd(4)] }];
  const m3 = gOf(far).m;
  for (const [k, v] of m) if (Math.abs(wrapHalf(v - m3.get(k))) > 1e-6) { stats.farEditFlips++; break; }
  void comps;
}
log(`  random configs (2–7 gears on a 9×9 patch, valid placements): ${stats.configs}, mesh edges ${stats.meshes}, diagonal edges ${stats.diagEdges}`);
log(`  configs with a loop that cannot be assembled (conflict): ${stats.conflicts}; with an odd (locked) loop: ${stats.oddComps}`);
log(`  root/ordering dependence: ${stats.orderDep}; flips caused by a far edit: ${stats.farEditFlips}; axis-aligned-only components with g ≠ 0: ${stats.axisNonZero}; unexplained residuals: ${stats.unexplained ?? 0}`);
if (stats.oddExamples.length) log(`  odd loop examples: ${stats.oddExamples.join(' ;; ')}`);
if (stats.conflictExamples.length) log(`  conflict examples: ${stats.conflictExamples.join(' ;; ')}`);

// Targeted: search for odd cycles with axis-aligned meshes only, and for diagonal loops.
log('');
log('== 2d. Exhaustive search for short mesh loops (3–6 gears, one layer, centres in a 12×12 patch)');
function searchLoops(maxLen, allowDiag) {
  const found = { odd: [], evenDiagConflict: [], evenDiagOK: [], evenAxis: 0 };
  // DFS building a cycle from gear 0 at origin
  const offsFor = (r1, r2) => allOffsets(r1, r2).filter(([a, b]) => allowDiag || a === 0 || b === 0);
  const seen = new Set();
  function rec(path) {
    const last = path[path.length - 1];
    for (const r of RADII) {
      for (const [du, dv] of offsFor(last.r, r)) {
        const g = { axis: 2, layer: 0, u: last.u + du, v: last.v + dv, r };
        if (Math.abs(g.u) > 12 || Math.abs(g.v) > 12) continue;
        if (path.some((p) => p.u === g.u && p.v === g.v)) continue;
        const np = [...path, g];
        if (!overlapsOK(np)) continue;
        // closes a cycle with path[0]?
        const first = path[0];
        const d2 = (g.u - first.u) ** 2 + (g.v - first.v) ** 2;
        if (np.length >= 3 && d2 === (g.r + first.r) ** 2) {
          const ks = np.map((p) => `${p.r}@${p.u},${p.v}`).sort().join(' ');
          if (!seen.has(ks)) {
            seen.add(ks);
            const r2 = phaseRule(np);
            const desc = np.map((p) => `${p.r}@(${p.u},${p.v})`).join(' ');
            if (np.length % 2 === 1) found.odd.push(desc + (r2.conflicts.length ? ' [also tooth-inconsistent]' : ' [tooth-consistent]'));
            else if (r2.adj.some((l) => l.some((e) => Math.abs(e.d) > 1e-9))) (r2.conflicts.length ? found.evenDiagConflict : found.evenDiagOK).push(desc + (r2.conflicts.length ? ` res ${r2.conflicts[0].res.toFixed(4)}` : ''));
            else found.evenAxis++;
          }
        }
        if (np.length < maxLen) rec(np);
      }
    }
  }
  for (const r0 of RADII) rec([{ axis: 2, layer: 0, u: 0, v: 0, r: r0 }]);
  return found;
}
{
  const a = searchLoops(6, false);
  log(`  axis-aligned meshes only: odd loops found ${a.odd.length}, even loops ${a.evenAxis}`);
  if (a.odd.length) log('    e.g. ' + a.odd.slice(0, 3).join(' ;; '));
  const b = searchLoops(5, true);
  log(`  with diagonal 40+40 meshes (≤5 gears): odd ${b.odd.length}, even with diagonal & consistent ${b.evenDiagOK.length}, even with diagonal & INCONSISTENT ${b.evenDiagConflict.length}`);
  for (const k of ['odd', 'evenDiagOK', 'evenDiagConflict']) if (b[k].length) log(`    ${k} e.g. ${b[k].slice(0, 3).join(' ;; ')}`);
}

// ---------------------------------------------------------------- 2e. worked example values
log('');
log('== 2e. Worked examples of the rule (g in pitches; tooth-centre angle = (¼ − ... ) see REPORT)');
for (const cfg of [
  [{ u: 0, v: 0, r: 2.5 }, { u: 4, v: 3, r: 2.5 }],
  [{ u: 0, v: 0, r: 2.5 }, { u: 3, v: 4, r: 2.5 }],
  [{ u: 0, v: 0, r: 2.5 }, { u: 4, v: 3, r: 2.5 }, { u: 9, v: 3, r: 2.5 }],
  [{ u: 0, v: 0, r: 2.5 }, { u: 4, v: 3, r: 2.5 }, { u: 8, v: 0, r: 2.5 }],
  [{ u: 0, v: 0, r: 2.5 }, { u: 4, v: 3, r: 2.5 }, { u: 4, v: 0, r: 1.5 }],
]) {
  const gs = cfg.map((c) => ({ axis: 2, layer: 0, ...c }));
  const r = phaseRule(gs);
  log(`  ${gs.map((x, i) => `${x.r}@(${x.u},${x.v}) g=${r.g[i].toFixed(4)}`).join('  ')}  conflicts=${r.conflicts.map((c) => c.res.toFixed(4)).join(',') || 'none'} odd=${r.odd.length}`);
}

// ---------------------------------------------------------------- 3. tips vs cells
// Disc rule (pitch radius r): a cell of another part at in-plane offset (du,dv) overlaps iff
// m = max(0,|du|−½)² + max(0,|dv|−½)² < r². A tooth tip at r + a reaches it iff m < (r+a)².
log('');
log('== 3. Cells of another part in the gear\'s layer that the PITCH-radius rule allows but the tip circle reaches');
for (const [a, label] of [[0.125, 'full addendum 0.125'], [0.095, 'drawn addendum 0.095 (tip shortened 0.03)']]) {
  log(`  ${label}:`);
  for (const r of RADII) {
    const cells = [];
    for (let du = 0; du <= 4; du++)
      for (let dv = du; dv <= 4; dv++) {
        const m = Math.max(0, du - 0.5) ** 2 + Math.max(0, dv - 0.5) ** 2;
        if (m >= r * r && m < (r + a) ** 2) {
          const dist = Math.sqrt(m);
          // drawn neighbour: flat web/box face 0.03 inside the cell boundary → intrusion depth
          cells.push(`(${du},${dv}) cell at ${dist.toFixed(3)}, tip ${(r + a).toFixed(3)}: into cell ${(r + a - dist).toFixed(3)}, into a drawn flat face ${Math.max(0, r + a - dist - 0.03).toFixed(3)}`);
        }
      }
    const mult = (c) => (c.startsWith('(0,') || c.match(/^\((\d),\1\)/) ? 4 : 8);
    log(`    r ${r}: ${cells.length ? cells.map((c) => `${c} ×${mult(c)}`).join('; ') : 'none'}`);
  }
}
log('  (×n = number of symmetric positions)');
// gear vs plain wheel at touching distance: tip intrudes into the wheel's drawn rim by a − 0.03.
log('  gear vs plain wheel at touching distance r_g + r_w: tips reach 0.125 past the wheel\'s nominal disc, 0.095 into its drawn rim.');

console.log(out.join('\n'));
process.exit(0);
