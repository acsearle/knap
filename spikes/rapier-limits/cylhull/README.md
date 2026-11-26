# cylhull: a native cylinder resting on convex-hull floors (Rapier 0.21.0 JS, parry 0.31)

The question: the project recorded that a native Rapier cylinder placed at rest on liftarm hulls
"falls straight through ... with zero contacts reported", near hull ends and on a 1-hole cell on
edge. Is that a Rapier bug?

**Short answer: not reproduced as a fall-through.** In this setup the cylinder **rolls off the end
or side**, and then falls past the floor. It rolls because a native cylinder lying on its curved
side starts rolling by itself at knap scale. That happens on a plain `cuboid` too, so it has nothing
to do with hulls. The project's repro printed only `y`, `z` and the contact count, never `x`.
`endcase.mjs` re-runs it with native code and prints `x`. It reproduces the project's numbers
exactly: x0=0 gives y−r −182.7594, z −0.055; x0=14 gives −90.4187. It also shows where the
cylinder went: it started at x 0 and ended at x −11.47, and began dropping at x −0.528, past the
beam's end at −0.46.

Two other things are real and are separate from the claim:

- **Many-sided hull faces (DESIGN LIMIT).** A hull lying on a many-sided face really can fall
  straight through, with one contact point per step. Example: a 32-gon prism hull on its
  un-bevelled cap. The cause is parry keeping only the first 4 vertices of a face.
- **One-step contact gaps (DEFECT, minor).** Sometimes the manifold is empty for one or two steps
  even though the shapes overlap. This happens at SI scale too, always while the body rolls over a
  floor edge. It never caused a fall-through in any run here.

All scripts use only the native `@dimforge/rapier3d-compat` API. Run them from the repo root.

## Scripts

| script | what it does | runtime |
|---|---|---|
| `lib.mjs` | Builds the floors: point sets that copy `src/physics/shapes.ts` prismShape (16-gon, HC 0.46, BEVEL 0.01, 9-hole stadium run). It also builds the bodies and provides `run()`, one rest test that logs the manifold each step. A test counts as *THROUGH* only if the body's centre is still over the floor's footprint when it passes y = −0.5; otherwise it counts as *OFF*. | – |
| `sweep.mjs [knap\|si] [body] [floors] [radii] [poses] [json]` | Places the body at 13 x positions × 2–3 z positions per floor, for each radius and pose, and runs 3 s. It counts outcomes and the runs in which the manifold was empty while `intersectsShape` said the shapes overlap. | knap ≈ 70 s for everything (pass a floor list to shorten it); si ≈ 5 s |
| `trace.mjs '<json>' [every]` | Prints the contact points, depth and normal for every step of one run. | <1 s |
| `miss.mjs '<json>'` | For each step with an empty manifold while the shapes overlap: prints the manifold's raw `localNormal1`, a direct `contactCollider` query, and a **fresh** manifold at the same poses in a new world (no cached normal, no recycling). | <1 s |
| `endcase.mjs [r] [axis] [ccd]` | Native replica of `spikes/wheels/out/diag2.mjs cyl 1 15 2`, the project's repro, with x printed. | <1 s |
| `matrix.mjs switches\|bodies\|si` | Changes one thing at a time from the knap-scale baseline. Uses interior positions only (centre ≥ 1 unit from the ends). | ≈ 60 s each |
| `hull32cap.mjs` | The 32-gon hull on its cap, one switch at a time, with a histogram of contact points per step. | ≈ 10 s |
| `hull32si_long.mjs` | The same at SI scale for 3, 10 and 30 s, to check whether it keeps sinking. | <1 s |
| `barrel_edge.mjs` | A cylinder on the top flat of a 1-hole barrel standing on edge, knap vs SI. | ≈ 5 s |

Knap scale is g 1226.25, dt 1/480, 30 iterations, maxCcdSubsteps 0. SI scale is g 9.81, dt 1/60 and
all defaults, with the same numeric sizes read as metres. The bodies are dynamic, density 1,
friction 0.5 (default), and never sleep.

## Results

| # | behaviour | evidence (command → numbers) | class |
|---|---|---|---|
| 1 | "Falls straight through at rest with zero contacts" (native cylinder on hulls) | `sweep.mjs knap cyl`: 1248 runs on 10 floors (cuboid, box hull, flat/edge 9-hole arm and 1-hole barrel, each with and without bevel), r 1 and 2.5, rolling and cap poses. **THROUGH 0**, OFF 901, STAYED 339. `sweep.mjs si cyl`: THROUGH 0. `endcase.mjs 1 2 1` reproduces the project's numbers and shows the cylinder had rolled past the beam end before dropping. | NOT REPRODUCED |
| 2 | A native cylinder on its curved side rolls by itself and falls off the floor | `matrix.mjs switches`, interior positions, 112 runs per row. Baseline: **0/112 stay**. SI defaults: **112/112 stay**. g 9.81 with knap dt and iterations: **112/112 stay**. Knap g with dt 1/60: 1/112. These had no effect (0/112 stay): contact_natural_frequency 120 or 300, prediction 0.1 or 0.002, recycling off (hook), soft CCD, 4 iterations. On a native `cuboid` floor too: 0/28. In `matrix.mjs bodies`, a 32-gon hull prism, a ball and a cuboid in the same pose stay 28/28 on every floor. A round cylinder stays 4–12/28. | SCALE (gravity; see below) |
| 3 | A hull resting on a many-sided face gets 1 contact point per step and sinks through | `hull32cap.mjs`: 32-gon hull on its cap at knap scale on the arm or a cuboid → **THROUGH** (step 72–149), points per step = `{"1":n}`. The same hull with bevelled caps (4-vertex face) → STAYED, sink 0.0076, 5 points per step. At SI it also gets 1 point per step and settles 0.037 deep (r 1) or 0.067 deep (r 2.5), and stays there for 30 s (`hull32si_long.mjs`); the bevelled version sinks 0.0001. Native cylinder on the un-bevelled flat arm (16-vertex top face): 3/26 stay vs 22/26 on the bevelled arm (`sweep.mjs knap cyl armFlat0,armFlat 1 cap`). | DESIGN LIMIT (truncation); falling *through* happens only at knap scale |
| 4 | Empty manifold for 1–2 steps while the shapes overlap | `miss.mjs` at SI on a cuboid, r 1, x0 −0.46: step 120 has n=0, raw `localNormal1` **exactly (1,0,0)**. A direct query gives dist −0.0014; a fresh manifold at the same pose has 4 points. The same holds on armFlat (SI, knap) and on the barrel (2 steps in a row). `sweep.mjs si`: 32 of 1248 runs have such a step, always while rolling over an edge or round end. Recycling off (hook) does not remove it: 4 runs at knap. | DEFECT (minor) |
| 5 | With soft CCD on, step 1 has no contact pair | `miss.mjs` with `softCcd` 1.04: step 1 `found:false`, while a direct query gives −0.0027 and a fresh manifold has 3 points. Same at SI. Causes one extra free-fall step (sink ≈ 0.002). | DEFECT (minor; cause not investigated) |

### Mechanism notes (from the source)

- **Witness point.** In 3D, `contact_manifolds_pfm_pfm.rs:115-127` always pushes the GJK/EPA
  witness pair, so a manifold whose GJK/EPA succeeded never had 0 points in any run. That is why #3
  shows exactly 1 point: clipping the 4-vertex sliver of the 32-gon cap added nothing.
- **Where n = 0 comes from.** Zero points means `contact_support_map_support_map_with_params`
  returned `NoIntersection` (`pfm_pfm.rs:153-156`), and the manifold was already cleared at
  line 78. The raw normal is exactly `(1,0,0)`, which matches only the
  `// Everything failed  GJKResult::NoIntersection(Vector::X)` fallback at
  `contact_support_map_support_map.rs:71-72`, reached when EPA returns `None` (several
  `return None` exits in `epa3.rs`). GJK is started from the previous manifold normal
  (`pfm_pfm.rs:66`). Without that cached direction, the fresh manifold at the same pose succeeds.
  So "cached direction vs none" is the switch that is shown. That EPA in particular fails is
  **suspected**; a parry-level unit test that feeds that `pos12` and `init_dir` would settle it.
- **Face truncation.** `convex_polyhedron.rs:960-961`:
  `// TODO: if there are more than 4 vertices, we need to select four vertices that maximize the area.`
  followed by `face.num_vertices_or_edges.min(4)`. A cylinder cap is an inscribed square turned
  toward the contact (`polygonal_feature_map.rs:121-128`), so a native cylinder on its cap gets 4
  good points. A polygonal cap with more than 4 vertices does not.
- **Self-rolling (#2).** The cause shown is the size of gravity: switching only g from 1226.25 to
  9.81 takes it from 0/112 stay to 112/112. The mechanism is **suspected**, not shown. The curved
  side's support feature is one segment (`polygonal_feature_map.rs:108-120`), so the contacts are 2
  segment-end points plus the witness, all regenerated each step along the current lowest line.
  Under 125× gravity the soft contact sits 0.004–0.005 deep (SI: ≈ 0.0006), and the line wanders.
  The `cylbox` spike covers this behaviour on a cuboid.

### What makes a body that should be round rest reliably on a hull at knap scale

Measured, interior positions, both poses:

- **Works:** a convex-hull 32-gon prism with bevelled (4-vertex) caps (`hull32b`) stays 28/28 on
  every floor in both poses at knap and at SI. A ball also stays 28/28.
- **Does not work:**
  - No integration setting tried makes a *native cylinder* on its side stay at knap scale: natural
    frequency 30/120/300, prediction 0.002–0.1, recycling off, soft CCD, 4 or 30 iterations.
  - A round cylinder (border 0.02) is partly better: 4–12/28.
  - An un-bevelled polygonal prism is fine on its side but falls through when lying on its cap.

## Not tested

- lengthUnit other than 1.
- Perpendicular axes (cylinder axis across a barrel standing on edge).
- Friction other than 0.5.
- Moving or rolling contact (only placement at rest was tested).
- Mass ratios: the floor is always fixed.
- Rapier's `contact_recycling` flag itself: it is not exposed to JS, so only the hook bypass was
  used. It is verified in `rapier/src/geometry/narrow_phase/pair_update.rs:121-123`
  (`hooks_involved` → no recycling).
- EPA was not instrumented directly.
