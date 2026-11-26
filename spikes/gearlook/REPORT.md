## Gear placement, phase and drawing spike (spike-look, spikes/gearlook/)

I did not write `spikes/gearlook/REPORT.md`: the harness refused it ("subagents should return findings as text"). This message is the report. Paste it into that file if you want it kept.

## Verdict

Gears can be drawn honestly, with every real tooth, in the current outline style. A 40-tooth gear is not a black blob at the Home zoom. It goes dark only when zoomed far out on a DPR 1 screen, at about 5 px per tooth pitch.

Placement and phase reduce to exact, cheap rules:

- **Phase:** every gear's teeth sit a quarter pitch off its cell axes, measured in the **world** frame. Every axis-aligned pair then meshes, with nothing to propagate. Only the diagonal (3,4)/(4,3) pairing of two 40-tooth gears needs an offset, solved per gear train.
- **Blocking:** gears block at the drawn tip radius r + 3/32. The one exception is a gear–gear pair at exactly r1 + r2, which is a mesh.

### Recommended profile

- **Shape:** involute, pressure angle 20°, module 0.125.
- **Radii:** addendum 3/32, so tip = r + 0.09375. Dedendum 5/32, so root = r − 0.15625.
- **Backlash:** 0.05 units in total per pair; each tooth is 0.025 thinner at the pitch circle.
- **Flank below the base circle:** parallel (keeps the base-circle width down to the root), not radial.
- **Edges and thickness:** no chamfer, full thickness ±0.47.
- **Segments:** 5 points per involute flank, 2 segments on the tip land, 2 on the root land.

### Recommended drawing

- **Tooth band as one patch:** flanks, tips and roots form one patch for the outline pass, with the same-patch crease fallback switched off for it. This needs a small `src/view` change.
- **Face groove:** the wheel-style index groove for r ≥ 1.
- **Painted index tooth on every gear:** the only index the 8-tooth gear can have.

### Cost

| | 8 teeth | 16 teeth | 24 teeth | 40 teeth |
|---|---|---|---|---|
| Triangles | 672 | 1216 | 1728 | 2752 |

- That is about 1.6–2.3× a plain wheel; an r 2.5 wheel is 1192 triangles.
- Build time is 7–17 ms per gear, measured under load.

### What is still wrong, in short

- Zoomed far out at DPR 1 the tooth bands are dark.
- Teeth alone strobe at modest speeds.
- Some diagonal 40+40 gear loops cannot be assembled.
- A pawl cannot be placed engaged at rest under the blocking rule.

Load average was 30–40 on 10 cores throughout. All ms figures are inflated and only useful as ratios.

## How to run

- **Part A:** `node spikes/gearlook/placement.mjs` writes `out/placement.txt` (under 4 s).
- **Solids and clearance:** `npx vitest run --config spikes/gearlook/vitest.config.ts measure|under|cost` writes `out/measure.txt`, `out/underbase.txt` and `out/cost.txt` (measure takes about 10 min under load).
- **Screenshots:** `node spikes/gearlook/{shots,compare,anim,orbit}.mjs` writes `e2e/out/gearlook-*.png` (42 files); `orbit.mjs` also writes `out/orbit.txt`.

**How the harness works.** It uses the real `Viewport` and the real outline pass. `vite.gearlook.config.mjs` swaps three imports, only when they are made from `src/view`:
- `../geometry` → `geomwrap.ts`, which returns gear meshes for registered part ids;
- `./markpaint` → `markwrap.ts`;
- `./outline` → `outline-copy.ts`, a copy whose only change is that the crease fallback can be turned off.

Patch treatments are emulated by appending zero-area triangles (a,b,b) to join vertex sets into one patch.

Nothing under `src/`, `docs/` or `tests/` was touched. I ran no dist build and no git writes. `spikes/gearlook/node_modules` holds only vitest's cache.

## Part A — placement and phase

### A1. Which pairs can mesh on the grid

Verified by enumeration: two gears in one layer mesh at an offset (du, dv) with du² + dv² = (r1 + r2)².

| Teeth | r1 + r2 | Offsets |
|---|---|---|
| 8 + 8 | 1 | (1,0) |
| 8 + 24 | 2 | (2,0) |
| 16 + 16 | 2 | (2,0) |
| 8 + 40 | 3 | (3,0) |
| 24 + 24 | 3 | (3,0) |
| 24 + 40 | 4 | (4,0) |
| 40 + 40 | 5 | (5,0), (3,4), (4,3) |

All sign and swap images of these offsets mesh too.

**The 16-tooth gear meshes only with another 16-tooth gear in the same layer.** Its sums with 8, 24 and 40 teeth are 1.5, 2.5 and 3.5, which are never a grid distance.

**Trap the pitch-disc rule misses:** offsets where the tips overlap without meshing, i.e. r1+r2 < d < r1+r2+0.25. Overlap at the full addendum:

| Teeth | Offset | Tip overlap (units) |
|---|---|---|
| 16 + 40 | (2,3) | 0.144 |
| 40 + 40 | (1,5) | 0.151 |
| 24 + 40 | (1,4) | 0.127 |
| 8 + 40 | (1,3) | 0.088 |
| 24 + 24 | (1,3) | 0.088 |
| 8 + 24 | (1,2) | 0.014 |
| 16 + 16 | (1,2) | 0.014 |
| 24 + 40 | (3,3) | 0.007 |

The pitch-disc rule allows all of these, and they would be drawn interpenetrating.

### A2. Tooth phase

Define f_i(φ) as the position, in pitches, of direction φ in gear i's tooth pattern (0 = tooth centre, ½ = gap centre). Two gears mesh iff f1(φ) + f2(φ+π) ≡ ½ (mod 1). This sum does not change under rolling; the measured residual after random rolling was 5e-15.

**Fixed phases that fail:**
- A tooth on the cell axis (s = 0) or a gap on it (s = ½) gives residual ½ on every axis-aligned pair: tooth on tooth. See `e2e/out/gearlook-phase-wrong-s0.png`.
- No choice of s from {0, ½} per tooth count works either, because a same-size pair needs 2s ≡ ½.

**The fixed phase that works:** s = ¼, the tooth pattern a quarter pitch off the +u axis, for all gears. All 14 axis-aligned (du,dv) cases mesh with residual 0, because 4 divides every tooth count. (s = ¾ also works.)

**The diagonal pairs:** a 40+40 pair at (3,4) or (4,3) is off by ±0.1933 pitch (0.076 units). The sign is sgn(du·dv)·sgn(|du|−|dv|).

**The phase is chiral.** A mirror image turns ¼ into ¾, so the phase must be defined about the world +x/+y/+z axes, with (u,v) = (y,z), (z,x), (x,y), and not carried by the part.
- Consequence: flipping a gear part over makes its teeth jump half a pitch.

**Phase rule** (`phaseRule` in `placement.mjs`). Each gear gets a rest offset g_i in pitches on top of the canonical ¼. Every mesh requires g_i + g_j ≡ δ, where δ = 0 for axis-aligned meshes and ±0.1933 for diagonal ones.
1. Find the components of the mesh graph: same axis, same layer, distance exactly r1 + r2.
2. In each component, run a BFS from the gear with the smallest (axis, layer, u, v). This never depends on part id. Set g_child = δ − g_parent.
3. Every component is bipartite, so its solutions form a family g_i + σ_i·t. Choose the t that minimises Σg_i² (ties go to the smallest |t|). This makes the result independent of which gear was the root.
4. Check each non-tree edge. A residual above tolerance means the loop cannot be assembled.

A component with only axis-aligned meshes always gets g ≡ 0 with no propagation. That is nearly every real build.

**Checks of the rule:**
- **30,000 random configurations** (2–7 gears on a 9×9 patch, 8232 meshes, 85 of them diagonal): it never depended on order or root choice, never changed a gear's teeth when a gear was added 30 cells away, and never gave g ≠ 0 to a purely axis-aligned train.
- **Exhaustive loop search** (centres within ±12):
  - axis-aligned only: 0 odd loops among 324 even loops (up to 6 gears);
  - with diagonals (up to 5 gears): 8 consistent loops and **24 inconsistent** ones, residual ±0.387 pitch. Example: 8@(0,0), 40@(−3,0), 40@(0,−4), 40@(3,0).

**Proof that there are no odd (locked) loops in one layer:** c = (u + v + r − ½) mod 2 flips across every mesh edge.

**Tooth consistency and freedom to turn are different conditions:**
- An inconsistent loop can turn but cannot be assembled.
- A loop through rigid links (gears on one axle, a ratio product ≠ 1) can be tooth-consistent and still locked. That is the kinematic analysis's job.
- Rigid links add no phase constraint.
- Gears that swing or slide into mesh later keep the canonical phase; the physics snaps them by less than half a pitch when they engage.

**Failure cases:**
- An inconsistent diagonal loop. Proposal: refuse the edit that closes it, with a reason like "the teeth of these gears cannot line up". Only the edited gear's component needs re-solving.
- Adding a gear to a diagonal train re-solves t and shifts every gear in that train by up to about 0.1 pitch (example: g = 0.0967 becomes 0.1289). This stays local to that one train.

### A3. Blocking radius

Cells of another part, in the gear's layer, that the pitch-radius rule allows but the tips reach:

| r | Cells | Tip into the cell | Tip into the drawn flat face |
|---|---|---|---|
| 0.5 | the 4 face neighbours, (1,0) | 0.125 | 0.095 |
| 1 | none | — | — |
| 1.5 | (2,0) ×4 | 0.125 | 0.095 |
| 1.5 | (2,1) ×8 | 0.044 | 0.014 |
| 2.5 | (3,0) ×4 | 0.125 | 0.095 |
| 2.5 | (3,1) ×8 | 0.075 | 0.045 |

The teeth visibly vanish into the beam (`gearlook-intrude-crops.png`).

**Proposed rule** (exact in dyadic arithmetic):
- **Against cells, plain wheels and non-meshing gears:** a gear blocks with its drawn tip radius rt = r + 3/32. Strict "<", so equal distance is touching.
- **Gear against gear:** they collide iff d < r1 + r2, or r1 + r2 < d < r1 + r2 + 3/16. d = r1 + r2 exactly is a mesh.
- **What this blocks and allows:** every bad near-miss in A1 is blocked. 24+40 at (3,3) is still allowed (drawn tips clear by 0.053), and so are 8+24 and 16+16 at (1,2). The in-layer face neighbours of an 8-tooth gear are blocked, as in reality. The 16-tooth gear is unaffected.

**Cells of the gear's own part in its layer:**
- **Holes:** only holes with |p| ≤ r − ½. This leaves a bore-to-root wall of at least 0.034. Without the rule, a hole at (2,1) on r 2.5 cuts through the root.
  - 40-tooth gear: 12 holes, at (1,0), (1,1), (2,0) and their images.
  - 24-tooth gear: 4 holes at (1,0) and images.
  - 16- and 8-tooth gears: none.
- **Everything else:** must lie entirely outside the tip disc.

**Ratchets:** with this rule a pawl cannot be built engaged at rest. This needs a decision from the tooth-collider work.

### A4. Gear next to a plain wheel

At touching distance the gear's tips go 0.095 into the drawn rim, and there is no friction drive between them. Recommendation: block, using rt + r_wheel.

## Part B — the solid and its drawing

### B1. Solids

Every variant builds as a closed 2-manifold (each edge used once in each direction) with genus 1. This covers involute, trapezoid and sine profiles, with and without chamfer, crank holes, the groove, and a thin tooth band. Triangle counts are after `creasedMesh`; times are under load.

| Variant | 8t | 16t | 24t | 40t | 40t build |
|---|---|---|---|---|---|
| Involute, 5 pts/flank | 608 | 1056 | 1504 | 2400 | 7–30 ms |
| Involute + 0.03 chamfer | 832 | 1248 | 1984 | 3264 | about 2× |
| Involute, 3 pts/flank | 416 | 672 | 928 | 1440 | — |
| Trapezoid | 256 | 416 | 544 | 800 | 2–10 ms |
| Sine | 672 | 1184 | 1696 | 2720 | — |
| Final profile | 672 | 1216 | 1728 | 2752 | 7–17 ms |

For comparison, plain wheels are 768 triangles at r 1, 874 at r 1.5 and 1192 at r 2.5.

**Interpenetration over one mesh cycle.** 2-D test, 96 steps per pitch, both gears at the canonical phase and rolling, all 10 size pairs. The value is the worst signed clearance in units (negative = interpenetration).

| Profile | d − 0.02 | d | d + 0.02 |
|---|---|---|---|
| Involute, backlash 0.03, radial below base | +0.0036 | +0.0125 | +0.0208 |
| Involute, full 0.125 addendum | −0.0012 (8t pairs) | — | — |
| Involute, no backlash | −0.0097 | −0.0011 | — |
| **Final** (involute, backlash 0.05, parallel below base) | **+0.0048** | **+0.0157** | **+0.0262** |
| Trapezoid, backlash 0.03 | −0.028 | −0.014 | — |
| Trapezoid, backlash 0.06 | −0.017 | −0.003 | — |
| Sine | +0.008 | +0.020 | — |

- **Trapezoid:** straight flanks are not conjugate, so it interpenetrates at every backlash tried.
- **Parallel flank below the base circle:** needs backlash of at least 0.04 for the 8-tooth gear, where the margin is +0.0004. That is too tight, hence 0.05.

**Equivalent of the 0.06 clearance idiom.** The drawn addendum is the module addendum less 0.03, the same inset as rims. Tip-to-root clearance is then 0.0625. A backlash of 0.05 adds 0.016 of flank clearance at the nominal distance.

**Phase-error tolerance** (backlash 0.03): ±0.035 pitch (0.014 units) before the teeth visibly overlap.
- **Covered:** the coupling spike's static and 50 rad/s errors (≤ 0.0065 teeth).
- **Not covered:**
  - the 0.062-tooth lag of the 2.5:0.5 pair at 50 rad/s;
  - re-snaps of up to 0.19 teeth on engagement.

**Rejected options:**
- **Radial flank below the base circle:** gives the 8-tooth gear thin "flower petal" necks (`gearlook-cmp-small.png`).
- **Chamfer:** double lines at every tooth tip and twice the cost.
- **Thin teeth on a full-thickness web:** fussier — an extra step and a web-circle line.
- **Sine teeth:** look toy-like.
- **Trapezoid teeth:** interpenetrate.

### B2. Drawing with the real view pipeline

**At the Home zoom** (5-gear train, 13 units long, 900×600, about 38 px per unit, 15 px per tooth pitch), every option is legible in every palette colour, including dark grey. No blob.

**Most tooth lines are true occlusion contours:** each tooth hides the root behind it, which is a real depth jump. So the treatments differ less than expected.

| Treatment | Result |
|---|---|
| Ink every crease (repo default) | Fine in isometric. Edge-on it is a "barcode", about 2 lines per tooth. |
| Tooth band as one patch, fallback off | Edge-on: quiet shaded flutes with only the real contours. Isometric: 25% fewer ink pixels (3210 → 2408). |
| Faces merged into the band patch as well | Not worth it. |
| 20 teeth drawn on the 40 | The most legible far out, but dishonest; the mismatch shows at a mesh. Rejected. |
| Plain disc at far zoom (LOD) | Loses the gear identity. Rejected. |

**Orbit stability** (21 steps of 0.25°, frame-to-frame change in ink pixels): ink-every-crease 0.94% mean / 2.2% max; one-patch band 1.08% / 2.6%. The difference is negligible.

**Recommendation: the tooth band as one patch, with the fallback off.** `src/view` needs two things:
- a per-vertex patch override, e.g. an optional `MeshData.patch`, or a merge predicate passed to `creasedMesh`;
- a "soft patch" flag that skips the crease fallback for that patch.

**Far out** (0.35× Home, about 5 px per pitch): at DPR 1 the tooth band is a near-black fringe, fully black on dark grey. The faces, holes, mark and axles still read. At DPR 2 it is fine. A zoom-dependent ink weight on soft patches would be the cheapest fix; I did not test it.

**Rotation and strobing.** A feature with k-fold symmetry appears to stand still at ω = 120π/k rad/s at 60 fps, and to run backwards from half that speed.

| Feature | Appears frozen at | Appears to run backwards from |
|---|---|---|
| 40 teeth | 9.42 rad/s | 4.7 rad/s |
| 24 teeth | 15.7 rad/s | 7.9 rad/s |
| 16 teeth | 23.6 rad/s | 11.8 rad/s |
| 8 teeth | 47 rad/s | 23.6 rad/s |
| 4 crank holes, or the axle cross | 94 rad/s | 47 rad/s |
| A single index mark | 377 rad/s (the Rapier clamp) | 188 rad/s |

**Filmstrip check.** At 9.42 rad/s the 40-tooth gear's outline is identical in every frame; only the mark and the holes move. Teeth alone do not show rotation, so an index is required.

**Index marks:**
- **Wheel groove (radius 0.5 to root − 0.05):** works for r ≥ 1. It is short on the 16-tooth gear (0.29 long).
- **8-tooth gear:** no room for a groove (its root is 0.344), and it is usually the fastest gear in a train.
- **Painted index tooth:** the tooth at the gear's phase angle has its flanks and tip land painted in the mark colour. It is clearly visible at the Home zoom on both dark and light parts, costs nothing, and works for all sizes.
- **Above about 30 rad/s** the mark reads as jumping, but in the right direction.

### B3. Thickness and crank holes

- **Thickness:** keep the full ±0.47, like wheels and like real gears.
- **Crank holes:** they look good. The 24-tooth gear's holes leave a 0.034 wall to the root, which is visible but acceptable; that is the limit, hence |p| ≤ r − ½.
- **Groove and holes:** the groove crosses the hole at (1,0), same as on wheels.

## Best screenshots (`e2e/out/`)

1. `gearlook-cmp-finaldpr2.png` — the final profile with the one-patch band, DPR 2, default and dark palettes. This is the recommendation.
2. `gearlook-train-front.png` — the 40–8–24–24–40 train face-on; every mesh interleaves with the ¼ phase; holes and grooves shown.
3. `gearlook-cmp-edge.png` — edge-on: ink-every-crease gives the barcode, the one-patch band gives quiet flutes.
4. `gearlook-cmp-far.png` — 0.35× Home at DPR 1, six treatments, showing the dark fringe.
5. `gearlook-cmp-close.png` — close-ups of involute, chamfer, one-patch band, sine, trapezoid and thin band.
6. `gearlook-strobe-markholes.png` — 60 fps filmstrips; at 9.42 rad/s the teeth are frozen and only the mark and holes move.
7. `gearlook-cmp-tooth.png` — the painted index tooth in isometric, front, edge-on and dark palette.
8. `gearlook-intrude-crops.png` — tips into a beam at pitch-touching distance (8t, 24t, 40t), and a 24t against a wheel.
9. `gearlook-pair-diag.png` — a 40+40 pair at (4,3) with the solved g = 0.0967 each; it meshes.
10. `gearlook-phase-wrong-s0.png` vs `gearlook-phase-axisX.png` — tooth-on-axis clashes; the ¼ rule meshes (shown on the X axis).

## How solid each claim is

**Verified by measurement:**
- the mesh families and the near-miss table;
- the ¼ rule (residual 0) and the 0.1933 diagonal offset;
- the rule's independence from root choice and far edits, over 30,000 configurations;
- 0 odd loops, and the 24 inconsistent diagonal loops;
- the closed-manifold check;
- the 2-D clearance tables;
- the triangle counts;
- the orbit ink counts;
- the strobe frames;
- the rendered looks, judged from screenshots.

**Measured but uncertain:**
- Build times (load 30–40; single runs vary by ±50%).
- Clearance is 2-D and sampled at vertices (20 points per flank). That is exact up to sampling, because the solids are prisms.
- The orbit metric, an ink-pixel count, is only a rough stand-in for flicker.

**Not tested:**
- live 60 fps playback in a real browser (everything here is SwiftShader);
- the actual `src/view` changes (emulated with zero-area triangles and the copied shader);
- a zoom-dependent ink weight;
- a pawl or ratchet placement rule;
- X and Y axes beyond one pair each;
- interaction with the ground shadow;
- physics.

## What still looks wrong

- At DPR 1, below about 6 px per pitch, tooth bands go near-black, especially on dark grey.
- At Home the 8-tooth gear is mostly hidden behind its 40-tooth partner, and its only index is the painted tooth.
- Physics re-snaps of up to 0.19 teeth will show as brief interpenetration; the backlash covers only about ±0.04 pitch.
- Flipping a gear part shifts its drawn teeth by half a pitch, because the phase lives in the world frame.
- In a diagonal 40+40 train, adding a gear rotates the others' drawn teeth by up to about 0.1 pitch.

## Files

**Code** (`/Users/antony/Desktop/knap.nosync/spikes/gearlook/`): `placement.mjs`, `gear.ts`, `measure.test.ts`, `under.test.ts`, `cost.test.ts`, `vitest.config.ts`, `harness.html`, `harness.ts`, `geomwrap.ts`, `markwrap.ts`, `outline-copy.ts`, `vite.gearlook.config.mjs`, `shots.mjs`, `compare.mjs`, `anim.mjs`, `orbit.mjs`

**Results** (`/Users/antony/Desktop/knap.nosync/spikes/gearlook/out/`): `placement.txt`, `measure.txt`, `underbase.txt`, `cost.txt`, `orbit.txt`

**Screenshots:** `/Users/antony/Desktop/knap.nosync/e2e/out/gearlook-*.png` (42 files)