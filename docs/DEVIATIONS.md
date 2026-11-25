# Deviations and clarifications

Where the implementation departs from, or had to interpret, `docs/DESIGN.md`.

## §2 Model (`src/core/model.ts`)

- **Extra validation.** Besides §2.2/§2.3, `validateModel` also reports malformed structure
  (`structure`), duplicate part ids (`duplicatePartId`), empty parts (`emptyPart`) and
  `nextPartId` not greater than every part id (`nextPartId`). Part ids must be non-negative
  integers; `nextPartId` must be a safe integer >= 1 (as `emptyModel`) and greater than every
  part id. A stale `rootPartId` is *not* an error (§2.4 defines its meaning). `addPart`/`removeCell`
  allocate ids as max(nextPartId, 1, max id + 1) so even an unvalidated model never yields a
  negative or duplicate id, and throw if the id would no longer be a safe integer.
- **Immutability.** Models must not be mutated in place once a core function has seen them: the
  `WorldIndex` is cached by model identity (`worldIndex`). `validateModel` alone builds a fresh
  index, since it is the entry point for hand-built / parsed objects.
- **Removing the root part** (`removePart`, or `removeCell` of its last cell) sets
  `rootPartId` to `null` rather than leaving a stale id, so the lowest id becomes root.
- **Split tie-break** (`removeCell`): largest piece keeps the id; among equal sizes, the piece
  containing the earliest remaining cell (in the part's cell order — i.e. edit history, not
  geometry; deterministic, kept deliberately). New pieces get fresh ids in
  order of size (desc) then earliest cell, and are inserted immediately after the original part
  in `parts`, with its colour.
- **Missing ids throw.** `addCell`, `removeCell`, `removePart`, `movePart`, `rotatePart`,
  `setPartColor`, `setRoot` throw on a part id that does not exist (programming error);
  `movePart`/`rotatePart` return `null` only for an *invalid result*. Malformed arguments
  (non-integer `delta`/`pivot`/`quarterTurns`, bad axis, bad colour, malformed cell passed to
  `addCell`/`addPart`) also throw; `canAddCell` returns `{ok:false}` for a malformed cell, and
  `connects`/`dirBetween` return false/null for non-adjacent or non-integer positions.
- **In-part rule consequences (§2.2, as specified).** A male can never continue coaxially out of a
  hole of the same part (end↔ring), and a male's side never attaches to anything; the editor
  reports these as "would not attach".
- **Rotation sign.** `rotatePart` uses the right-hand rule: +1 quarter turn about Y maps
  +Z → +X, +X → −Z; about X maps +Y → +Z; about Z maps +X → +Y.
- **Deserialize leniency.** Unknown fields are dropped; a missing `rootPartId` is read as `null`
  and a missing `nextPartId` as max id + 1. Colours are stored lower-case. Everything else must
  be valid or a `ModelFormatError` (with `.errors`) is thrown listing up to 10 problems.
- **Default colours** live in `DEFAULT_COLORS` in core (holes get a placeholder yellow; the UI is
  expected to pass its current palette colour for hole parts).

## §3 Kinematic analysis (`src/core/kinematics.ts`)

Interpretations where §3 leaves a choice open (all deterministic, all tested):

- **Invalid input.** `analyze` expects a valid model. A position contributes a mate only if it
  holds exactly two cells of different parts that form a valid §2.3 mate. Any other overlap is
  ignored, not reported. Callers validate first.
- **Free-pin test (3.1 b).** The pin's cells are all male, share one axis and the same two
  transverse coordinates. Pins are considered in ascending part id order against the live
  union-find state, so "most cells" counts whole bodies, including welded parts and pins absorbed
  earlier in the same pass. A tie goes to the body with the lowest part id.
- **A free pin that is the root is not absorbed** (fix of a review finding). It stays a fixed body
  of its own with a revolute to each body it holds. Absorbing it would weld one beam to the ground
  and remove that beam's rotation (e.g. a user who places a pin first: part 1 = default root).
- **Free pins connect every pair of bodies they pass through** (fix of a review finding; a gap in
  §3.1). Every pin that met conditions (a)–(d), whether absorbed or kept as the root, adds a
  *virtual* revolute line (its own axis line) to the pairwise reduction of every pair of *other*
  bodies it passes through, not only the pairs involving the body that holds its cells. Without
  this, a 3-long pin absorbed into beam A hid its line from the B–C pair, so B and C, pinned on
  two lines, stayed a redundant revolute pair instead of welding, and the partition depended on
  the root. A pair whose only connections are virtual gets no joint for one line (it is implied by
  the pin's joints to its own body and would be redundant) and is welded for two or more lines.
  Virtual lines count as revolute in the type rules, so any pair that has one never gets slide
  limits or a prismatic joint. Joint origins still come from real mates only.
- **Third-body pins block slides** (fix of a review finding; a gap in §3.2). In both the
  cylindrical and the prismatic limit tests, a position where a hole of A or B already holds a pin
  of a part in neither A nor B (a `revolute` mate) is occupied: a pin cannot slide out of its
  hole, so no cell of the other body can enter it. This makes the limits independent of which
  body a free pin was absorbed into. A third body's *axle* in such a hole does not block (it can
  slide away); that case is left to contacts, as §3.2 says.
- **Fixpoint loop.** Each pass absorbs pins, classifies every body pair from the state at the
  start of the pass, then applies all the unions it found. Passes repeat until one changes
  nothing. The joints are taken from that last pass.
- **Joint origin.** The lexicographically smallest (x, y, z) position among the pair's non-weld
  mates. These are only mates *between* the two bodies, so for an absorbed pin the origin is
  where it sits in the *other* body's hole.
- **Slide legality (3.2).** At an overlapping position, the two bodies must each have exactly one
  cell there, and the two cells must form a `cylindrical` mate whose axis is the joint axis. If
  either body already has two cells there (an axle in its own bush, an absorbed pin in its hole),
  the shift is blocked. This applies to the cylindrical case as well as the prismatic one. The
  spec says "along d" only for the prismatic case.
- **Limits.** These are the displacement of body B (higher id) relative to body A along +axis.
  A zero limit is always `0`, never `-0`. A joint never has limits `[0, 0]`: such a pair becomes
  a revolute joint (one line) or is welded (prismatic).
- **Order.** `mates` are sorted by position, `joints` by (bodyA, bodyB), and `bodyOfPart`
  iterates in ascending part id order. Shuffling `parts` or `cells` gives a deep-equal graph.

## §4 Geometry (`src/geometry`)

- **Extra files.** `topology.ts` holds what `solid.ts` and `colliders.ts` must agree on: the
  part-local frame (`partOrigin` = component-wise minimum of the cell positions, an integer
  point; local = world − origin), the cache signature (`partSignature`), per-cell connection
  analysis and `rodExtent`. `index.ts` re-exports the module.
- **Same solid, different construction.** The solid is the §4.2 union-minus-bores, but it is not
  built as one primitive per cell, because coincident surfaces between pieces make the boolean
  leave pinched, zero-length edges (found with a 2000-part random fuzz test):
  - *Prism runs* — a hole with no axial in-part connection (every planar liftarm cell), or a
    uniform coaxial stack (tube, double-thick beam: same kind, same webs, webs grown across every
    gap) — are exactly an extrusion of one 2D profile. Per axis and range, (⋃ barrel circles and
    web rectangles) − (⋃ bores) is computed with 2D booleans and extruded once.
  - Collinear connected males of one kind are one rod (one revolve/extrusion), and coaxial runs of
    remaining (3D-path) same-axis holes share one barrel cylinder.
  - Everything else (perpendicular ring↔wall connectors, mixed-kind tubes, irregular stacks) uses
    3D CSG of the §4.2 pieces with the §4.2 EPS overlaps. A test checks that the 2D path and a
    pure-3D build agree in volume (1e-4) and genus.
- **3D-path barrel polygons are rotated half a segment** (vertices at 3.75° + k·7.5°), so they stay
  strictly inside the ±H web faces. Consequence: such a barrel reaches H·cos(π/48) = 0.46899
  transversally instead of 0.47, and where it meets a flat web face there is a step of 0.001
  (8 µm). Prism-run barrels (2D path) keep vertices on the axes, so planar liftarms, blocks, tubes
  and double-thick beams have exact ±H and no step.
- **Sliver fill "likewise the barrel"** needs no extra solid: the barrel quadrant toward lateral
  side t would be filled exactly when C, C+h, C+t, C+h+t are all holes, which is the same condition
  that grows the web toward t to ½ along h, and that web covers the quadrant.
- **Bores sealed at both ends are omitted.** A coaxial run of (3D-path) hole cells whose bore is
  blind at *both* ends (each end's axial neighbour is a hole with a different axis, e.g. a row
  Z-hole, X-hole, Z-hole) would by the §4.2 letter be a sealed internal cavity: unreachable,
  invisible, a second (inverted) shell that understates volume and breaks Euler genus. Those cells
  get no bore, so they render solid. (Only a one-cell male of another part could ever sit there,
  fully enclosed either way.) Tests assert a single shell for catalogue and fuzz parts.
- **Pin-hole bore next to a coaxial axle hole stops at the face** (no 2·EPS overshoot). Otherwise
  the round bore cuts a 0.01-deep round counterbore into the start of the cross bore (§4 says no
  counterbores). The axle hole's cross bore still overshoots into the pin-hole cell, inside the
  round bore, so the passage stays one cavity.
- **Boss corner fill.** When a hole has connected *males* on two adjacent lateral faces, their two
  square bosses (webs to ½+EPS, ±H transversally) would leave a (½+EPS−H)² notch along the shared
  edge, visible as a slit. The lower-indexed web of the pair is grown to ½+EPS toward the other.
  With a *hole* neighbour on either face the region is a natural concave corner and is left as is.
  The boss itself (0.035 proud of a liftarm face under a side pin) is §4.2's "square boss" and is
  kept as specified.
- **manifold-3d wrapper leak worked around.** In manifold-3d 3.5.5 the JS wrappers
  `CrossSection.extrude/revolve` (and the static `Manifold.extrude/revolve`) never free the
  polygon vector from `_ToPolygons()`, and `Manifold.revolve(polygons)` also leaks a temporary
  CrossSection. `solid.ts` calls the raw `_Extrude`/`_Revolve` bindings and frees the vector
  itself; `tests/geometry/memory.test.ts` watches the WASM `Memory` size, which
  `liveManifoldCount()` cannot see. Do not call those wrappers elsewhere either.
- **Male details (suggested items).** Free ends of `pin`/`frictionPin` get a 45° chamfer of 0.03;
  axles have none (keeps the cross analytic). `frictionPin` has four ridges (radius 0.33,
  half-width 0.03, at 0/90/180/270°) that stop 0.045 short of a free end. 0.33 > `R_BORE`, so inside
  a hole the ridges sit in the barrel wall. That is hidden, and colliders do not include ridges.
- **Mesh post-processing.** The finished solid is `simplify(1e-5)`'d. Vertices with identical
  float32 positions are then welded and the triangles that become degenerate are dropped (an edge
  collapse, so topology and volume do not change). After that come the crease normals: corners are
  unioned across edges whose dihedral angle is < 35°, with angle-weighted face normals.
- **Known limitation.** In about 0.3% of large random parts with mixed axes (6 of 2000 parts of
  2–26 cells; 1 of the 400 smaller parts in the default test run), where coplanar faces of pieces
  with different orientations meet, the result keeps a zero-volume pinch. Its edge is shared by four
  triangles once vertices are welded by position. Manifold's own topology is valid
  (`status() === 'NoError'`) and nothing is visible. The fuzz test allows at most 1% and lists the
  cases. Every catalogue part (e2e/geom-catalog.ts) is a strict closed 2-manifold after welding.
- **Cache.** `buildPartMesh` returns the *same* typed arrays for parts with equal signatures. It is
  an LRU of 1024 entries, and callers must treat the arrays as read-only. `origin` is per call.
- **Colliders** use the shared `rodExtent` for males, so connected male ends reach ½+EPS (the
  visual extent) rather than exactly ½.

## §7 Editor logic (`src/editor`)

The full contract is in the header of `src/editor/index.ts`. Choices made where §7 is open or
had a gap:

- **Insert joins a male behind the hole (fix of a gap in §7.3).** Picking is against cell cubes, so
  the hovered face's neighbour `C + n` is always empty: the ray passes through it. Extend can
  therefore never add a cell where another part's cube already is. A pin could not be pushed
  through a second hole that was already placed, and no closed loop (four-bar) could be built
  through the UI. Rule: without newPart, if the cell behind the hovered hole (`C − n`) holds a
  coaxial male of a part other than the hole's, Insert adds the new male to *that* part
  (`joins: true`, "Extend part 8 · insert pin ∥ Z into part 5"). With Shift / [N], Insert always
  makes a new part. `tests/editor/fourbar.test.ts` builds the §8 four-bar this way.
- **New on grid defaults to ∥ Y for every kind.** Holes lie flat on the reference plane and rods
  stand on it, so a pin placed on the grid fits a hole placed on the grid. The letter of §7.3
  ("first valid axis") would give X for holes. The [R] order is Y, Z, X.
- **Orientation order.** The natural default comes first, then the remaining axes in cyclic
  order (d, d+1, d+2 mod 3). Exception: a hole tool not clicking a hole uses X, Y, Z ("first
  valid axis"). If the target already holds one cell of another part of the opposite class, its
  axis is moved to the front (§7.3 coaxial preference). For valid placements this is the only
  valid axis anyway. For invalid ones it sets the red ghost and its reason.
- **[R] cycling keeps an axis, not an index.** `ToolState.axisPref` holds the axis last chosen with
  [R]. It is used on every hover where it is valid, else the natural default is shown (the
  preference is kept). It is reset when the tool changes. So when the set of valid orientations
  changes between hovers, the choice maps by world axis.
- **R cycles within the chosen action.** The action is the first valid one in §7.3 priority
  order, and [R] only changes the axis inside it, never the action.
- **Most relevant invalid proposal.** When nothing is valid, the reason comes from Insert/Sleeve
  if its geometric precondition holds (male tool on an axial face of a hole; hole tool on a
  male). Otherwise it comes from Extend / New adjacent. "Compatible" in §7.3 is treated as part
  of validity, not of the precondition, so "pin does not fit an axle hole" is reported. Sleeve
  applies through any face of the male (§7.3 does not restrict it).
- **Colour rule.** Hole parts take the palette colour. Male parts take the kind default unless the
  user clicked a swatch since selecting the current tool (`colorPicked`, cleared on a tool
  change).
- **Picking details.** Cells win over the grid even when the grid plane is nearer (a part below
  the faint grid stays clickable through it). A ray touching only an edge or a corner misses. A ray
  lying in a face plane is inside that slab, and ties go to the lower part id. A ray starting inside
  a cube hits it at t = 0. Its `dir` is the face the line entered through. Shared male/hole cells
  use the §7.3 R_ROD rule, strict `<`. With simulation transforms the rule applies only while
  both parts have the same transform; otherwise both cubes are tested. `filter` applies to both
  partners of a shared cell: a rejected male never replaces its hole, and a male whose hole's part
  is rejected is picked through its own cube. A ray entering exactly through a cube edge/corner
  (tied entry slabs) reports a tied face whose neighbour cell is empty, so Extend never targets a
  cube the ray only grazed.
- **Proposals are bound to their model.** `Proposal.apply(current)` / `EraseProposal.apply(current)`
  throw unless `current` is the model the hover was resolved against (`baseModel`). Clicking after
  Ctrl+Z without moving the mouse would otherwise re-apply the pre-undo edit and drop the redo tail.
- **Shift cannot latch "New part".** `withShift` marks its per-event state (`shiftHeld`); all state
  functions (`cycleOrientation`, `selectTool`, `setNewPart`, `pickColor`) drop that newPart again.
- **Presentation extras (§7.4).** `ghostColor` on every proposal, `shiftHint` (what Shift would do
  instead — e.g. a hole tool on a rod's end extends the rod per §7.3 order, Shift sleeves), and
  `describeHover` for the status bar's hover info.
- **Coaxial preference is resolver-only in practice.** With cube picking `C + n` never holds another
  part's cell on a real hover (the ray crossed that cube first), so the §7.3 coaxial preference for
  Extend / New adjacent only applies to synthetic picks. Kept as specified; the Insert-join rule
  covers the "target already occupied" case reachable from the UI.
- **Selection ops.** A refused move or rotation states the first §2.3 conflict of the moved /
  rotated cells ("…: (0, 0, 0): pin is not coaxial with the pin hole (part 2 has a pin there)").
  For move keys, whichever of screen right/up is more axis-aligned takes its
  dominant axis first (tie → up), and the other takes the best remaining axis. Component ties go to
  the lower axis index (up prefers Y). PageUp moves toward the viewer. For rotation, ties of the
  view axis prefer Y, then X, then Z (the isometric view turns about Y). Duplicate only accepts an
  offset where every copied cell is empty, so a copy never mates by accident. Offsets are searched
  nearest first within L∞ ≤ 8.
- **Autosave.** An unreadable autosave is moved to `knap.autosave.v1.corrupt`, so it is neither
  lost nor retried on every load. An autosaved empty model restores as "nothing".

## §6 Rendering & camera (`src/view`)

- **Outline technique.** It is the suggested post-process, but the "part id" buffer holds *smooth
  patch* ids (part slot·4096 + connected component of the crease-split mesh, `patches.ts`). Every
  crease ≥ 35° is therefore an id boundary: crease lines need no normal threshold, so they cannot
  speckle on curved surfaces or in bores, or smear at grazing angles. Two fallbacks apply within one
  patch: a depth jump that survives linear extrapolation from either side (self-occlusion), and a
  flat-face-normal angle > 30° when both faces look at the camera (a patch that meets itself across
  a crease, e.g. the inner corner of an L beam's wall). Lines are drawn as a polyline through the
  midpoints of the texel-boundary segments, at a uniform width (1.25 CSS px × DPR) with a 1-px AA
  ramp. The ID buffer is 2× the drawing buffer below DPR 1.5 (`supersample` option).
- **Side effect: real gaps are drawn.** Lines follow the geometry exactly. The 0.06 gap between
  stacked parts shows as two close lines with a sliver of the part behind between them. A pin end in
  a hole shows three close concentric circles: end disc, 0.03 chamfer, bore rim. Both are true to
  the §4 geometry and were kept.
- **Selection** is an accent outline (2.5 CSS px) along the boundary between selected and other
  pixels, plus a 16 % lightening of the part colour. Mixing in the accent hue turned yellow beige and
  red pink, so it is not used.
- **Grid** is drawn behind all parts (it never cuts through parts below y = −½). Axis lines are
  coloured (x = 0 blue, z = 0 red) at 32 % alpha and minor lines are 6.5 % black. The grid fades
  radially, at grazing view angles and where cells fall below ~4 px.
- **Root marker**: a ground-hatch symbol of constant screen size under the root part's lowest cell
  on screen. It must never sit on another part (that reads as "this other part is fixed"), so the
  line shader probes the outline ID buffer over the mark's rectangle and draws it under the first of
  the root's lowest cells (up to 8, lowest first, within one unit of the lowest) whose rectangle no
  other part covers. When every candidate is covered, the marker is hidden in that view (e.g. the
  triple pendulum's root in a tall iso view). It may overlap the root itself and is not depth-tested.
- **Top/bottom from the view cube** keep the current yaw rounded to a quarter turn, so the picture
  does not spin. A tie (the default iso view has yaw exactly π/4) goes to the quarter turn nearer
  yaw 0, so TOP from Home has FRONT at the bottom. `snapTo('top')` from code uses yaw 0.
- **Supersampling**: the ID buffer is 2× the drawing buffer at every DPR (not only below DPR 1.5):
  at 1× the midpoint-polyline lines flicker under slow orbits (~5 % of ink pixels change coverage by
  > 0.6 per 0.05° step, at DPR 1 and 2 alike; < 0.02 % at 2×). It steps down to 1.5×, then 1×,
  when a side would exceed min(8192, MAX_TEXTURE_SIZE) or the buffer 4096² texels (≈ 335 MB at
  ≈ 20 B/texel), e.g. a 1920×1080 CSS viewport at DPR 2 renders at 1× and can flicker slightly.
  Cost on an M1 Max: 1280×720 at DPR 2 went from 4.9 to 8.9 ms/frame.
- **Fit / Home** frame the parts' transformed vertices (exact extent along the screen axes, centred),
  not their bounding box: AABB corners made iso fits fill only 50–70 % and sit off-centre. The
  orbit pivot is the parts' box centre moved within the view plane. `fit(box)` still frames a box.
- **Resize** keeps the world rectangle last chosen by any camera change fully visible (the height
  grows when the viewport narrows and returns when it widens), instead of keeping the height.
- **Animations compose**: snapTo / fit during a running snap / fit start from that animation's
  end state (orientation for fit, target and zoom for snapTo), as wheel zoom already did.
- **View-cube presses never reach the host**: a right or middle press on the cube may pan, but its
  click is swallowed (it would otherwise pick hidden scene geometry behind the cube).
- **Lifetime**: dispose() calls `forceContextLoss()` (browsers keep ~16 live contexts and kill the
  oldest, which may be a viewport still in use) and detaches the DPR media listener. Besides the
  resolution media query, the viewport re-checks devicePixelRatio on window resize and before every
  render (some zoom paths and headless emulation fire no media event).
- **Darkest faces**: the camera-relative ambient's bottom term is 0.54 (was 0.42), so down-facing
  faces of the darkest palette grey render ≈ (74, 78, 82) instead of ≈ (68, 72, 75) and keep their
  ink lines readable.
- **Drag claim timing**: the host's `claim()` runs when a left press has moved 4 px (with the press
  position), not on press, so a plain click on a body is still a click.
- **View-cube regions**: the outer 20 % of each face (beyond 0.6 of the half-width) are the edge
  and corner zones. They show only on hover; the cube has no chamfers.
- **Context alpha**: three.js always creates the WebGL context with an alpha channel. Every custom
  blend keeps destination alpha at 1, or the page shows through. The e2e checks the buffer stays
  opaque.

## §5 Physics (`src/physics`)

- **Files.** `sim.ts` (Simulation), `shapes.ts` (Rapier collision shapes built from
  `partColliders`), `rapier.ts` (`initPhysics()`, an idempotent WASM init), `math.ts` (vector and
  quaternion helpers on tuples), `index.ts`. Rapier is `@dimforge/rapier3d-compat` 0.21.0, with
  its WASM inlined. It works in Node and in a Vite bundle (checked in headless Chromium).
- **Body frames.** Each Rapier body starts with identity rotation at the f32-rounded mean of its
  cell centres. `bodyTransform` and `partTransform` return the *displacement* since t=0, that is
  `T(t)·T(0)⁻¹`. It is exactly the identity at t=0 and for the fixed body. It is not Rapier's raw
  pose, and the quaternion is renormalised in f64. An unknown or removed id gives `null`.
- **All joints are impulse joints.**
  - revolute → `JointData.revolute`.
  - prismatic → `JointData.prismatic` with limits.
  - cylindrical → `JointData.generic`, locking LinY, LinZ, AngY and AngZ. Its LinX limits are set
    with `world.impulseJoints.raw.jointSetLimits(handle, LinX, lo, hi)`, because the JS
    `JointData` has no limits for generic joints.
  - Rapier's coordinate is body 2 relative to body 1, which is `Joint.bodyB` relative to `bodyA`.
    So `Joint.limits` map over unchanged. Tested for axes X, Y and Z, both body orders, and
    gravity toward and away from each stop.
  - Rapier multibody (reduced-coordinate) joints on a spanning tree were tried and dropped. At
    the same cost they lost as much energy, and the JS API cannot set limits on generic
    multibody joints.
- **Collision shapes differ from §4.3 in how they are built; the solid differs only by a 0.01
  bevel on the end faces.**
  - Every cylinder becomes a circumscribed 16-sided convex prism. Its flat faces are tangent to
    the cylinder, and four of them are axis-aligned. Why: Rapier's exact cylinder–cylinder narrow
    phase costs about 0.6 ms per step for every rotated, coaxial, nested pair, and each pin in a
    hole is one. That cost remains even when the joint's contacts are disabled, and it made the
    4-body four-bar cost about 2.5 ms per step.
  - A straight run of plain hole cells (a liftarm) becomes one prism over the stadium of its two
    end barrels. That is exactly the union of the barrels and webs. It turns dozens of contact
    manifolds between two resting beams into one (contacts are solved in every substep, so
    their count sets the cost: splitting the run into ≤ 4-vertex strips instead tripled the
    collision example's cost to ≈ 1300 ms per simulated second).
  - **End faces are bevelled (fix after review).** Parry 0.31, which Rapier uses, builds a
    contact manifold from at most the *first four vertices* of a polyhedron face
    (`ConvexPolyhedron::local_support_feature`: `face.num_vertices_or_edges.min(4)`, with a TODO).
    A 16-gon cap, or the stadium face of a liftarm, therefore touched only near one corner:
    liftarms lying flat on each other tipped, sank and fell through (3-hole on 9-hole: gone in
    1 s). Now four rim vertices of each end face stay at the full half-length and the others are
    pulled in axially by 0.01, so every face has ≤ 4 vertices: a flat rectangle surrounded by
    facets sloping 1.5–8°. For a run the rectangle is the full-width straight part, reaching 0.09
    past each end barrel's centre; for a single cylinder it is ±0.26 × ±0.39 (hole barrel). A
    part lying flat rests on it (measured: 0.914–0.916 for a touching distance of 0.92, tilt
    ≤ 2e-3 rad). Only if its centre of mass is outside the rectangle does it settle a few degrees
    tilted on a facet. 0.01 because Rapier's hull builder merges facets closer to coplanar than
    that (0.005 merged and fell through, 0.006 held; 0.01 holds for a 31-hole beam lying on a
    41-hole beam).
  - Mass comes from the *un-bevelled* prisms, computed analytically (f64) and set per collider,
    and from the boxes at density 1, so relative masses scale with size.
- **Products of inertia are dropped for planar mechanisms.** Some mechanisms are attached to a
  fixed body and have all their joints on one axis a. For their bodies the mass properties are
  replaced: I_ab and I_ac are set to 0, while mass, centre of mass, I_aa and the other 2×2 block
  stay the same.
  - Why: Rapier blows up a body that rotates about a joint axis that is not principal. The
    captured axle with its off-centre arm (sliding-axle example) spins up to the 377 rad/s cap
    in about 9 s, and a pin absorbed into a link causes the same problem.
  - The motion is unchanged: such bodies can only rotate about a, the products only produce
    torques normal to a, and the joints absorb those.
  - Every other body keeps its true inertia. A spatial mechanism with a non-principal axis
    could still blow up. This is not tested, and it is a known limitation.
- **Integration settings.**
  - Fixed step 1/480 s.
  - `numSolverIterations` 240. These are TGS substeps, so the substep is h = 1/115200 s.
  - 1 PGS iteration and `lengthUnit` 1.
  - No damping and no sleeping (`setCanSleep(false)`).
  - **Rapier's hard CCD is off (`maxCcdSubsteps = 0`, fix after review); free bodies use soft
    CCD instead.** The hard CCD clamped the motion of a jointed body at a time of impact with its
    own joint partner, although contacts between them are disabled: an axle sliding in its hole
    stalled for a step whenever it moved faster than about half its thinnest collider piece
    (seen at 10 units/s with thin pieces, at ≈ 180 units/s with the shapes above). Dynamic
    bodies without joints get `softCcdPrediction` = 1.25 × 400 units/s × fixedDt (one step at
    the speed cap). Predictive contacts respect the joint's contact exclusion.
- **Why 240 substeps: Rapier's joint solving loses kinetic energy at about ω²·h per second.**
  - Example: a body swinging at 10 rad/s about a pivot loses 4.6 % of its KE every 2 s at
    h = 1/1920 s.
  - At real scale the triple pendulum reaches |ω| ≈ 190 rad/s. It is chaotic, so its loss also
    jumps with tiny mass changes.
  - Triple pendulum, energy change over 10 s relative to E0 − E_min, with the shapes and
    inertia from before the review: N = 160 → −14.7 %, 192 → −9.5 %, 224 → −6.6 %,
    240 → −5.3 %, 256 → −6.9 %, 320 → −1.3 %. With the current shapes: 160 → −12.0 %,
    192 → −7.6 %, 224 → −5.3 %, 240 → −3.7 %, 288 → −3.0 %.
  - Four-bar at N = 240: −0.9 %.
  - Going finer, f32 round-off *adds* energy: see "Free rotation gains speed" below. These
    gains are slow, roughly linear and bounded in the tests. §5.3 does not test them.
- **Cost of the default settings, stepping only.** Measured in headless Chromium 159 on the dev
  machine, in ms of stepping per simulated second (re-measured after the review fixes; within
  ±5 % of the numbers before them):

  | Example | ms per simulated s |
  |---|---|
  | pendulum | 70 |
  | triple pendulum | 151 |
  | four-bar | 194 |
  | parallelogram | 193 |
  | sliding axle | 101 |
  | weld test | 57 |
  | collision | 342 |

  - At 1× and 60 Hz that is 0.9–3.2 ms per frame. The collision example takes 5.7 ms, which is
    over the ≈ 4 ms budget, because resting contacts are solved in every substep.
  - At the default ¼× every example takes ≤ 1.4 ms per frame.
  - Node (vitest) measured 1.2–1.7× slower, on a machine shared with other test runs.
  - `step()` caps the work per call: at most `maxStepsPerCall` (16) fixed steps and
    `stepBudgetMs` (8 ms) of wall-clock time. It drops the rest and counts it in `droppedSteps`
    and `droppedTime`. So an overloaded 1× runs slower than real time instead of spiralling.
- **Free rotation gains speed (known limitation, found in review).** Rapier's f32 integration
  adds a small relative bias to every dynamic body's angular velocity in every substep: about
  1e-7–3e-7, independent of ω (measured from 0.01 to 300 rad/s), present on a free body with no
  joint and no gravity, proportional to the substep count (1/480 s × 240: +1.5 %/s for a cube;
  ×60 → ¼ of that; 1/960 s × 480: +18 %/s). Its size and sign depend on how the inertia is
  represented (−0.65 to +3.8 %/s on the same body with different but equivalent principal
  frames), so it cannot be compensated from outside. At the default settings, without gravity
  over 5 s: a symmetric axle in a pin hole +3.8 % of ω, a 5-hole link pinned at its centre
  +6.7 %, an end-pinned link +1.3 %; over 10 s the examples rise by at most 3.4 % of their
  peak KE (pendulum), over 30 s by at most 9.6 %. Fewer substeps shrink it but lose more
  energy in the joints (triple pendulum over 10 s: 160 → −12.0 %, 192 → −7.6 %, 240 → −3.7 %),
  and §5.3 bounds that loss, so 240 stays. `decoupleInertia` is now skipped for a body whose
  products with the joint axis are already negligible (< 1e-6 of the trace), so it no longer
  changes a symmetric body's representation (the review saw it double the axle's drift; that
  was this representation dependence, not a physical effect). Guarded in
  `tests/physics/pendulum.test.ts` at ≈ 1.5× the measured drift.
- **Symmetric fast impacts on a flat face throw the part sideways (Rapier, found in review).**
  A flat face landing squarely on another at 300–400 units/s gets uneven impulses over its
  4 contact points (264/178/287/161 for two plain cuboids crossed at 311 units/s), so it leaves
  with ≈ 10 % of the impact speed sideways and some spin (36 rad/s in that case), and may leave a
  narrow beam or a plate. Reproduced with two native Rapier cuboids, so it is not the collision
  shapes; more PGS iterations did not change it. It never passes through. §5.3 asks for "comes
  to rest on / deflects off it and never tunnels through", and the tests check that.
- **Rapier speed caps** (measured, not configurable from JS).
  - With `lengthUnit` 1, linear speed is clamped to 400 units/s (3.2 m/s). Angular speed is
    clamped to π/4 rad per step, which is 377 rad/s at 1/480 s.
  - Mechanisms stay below this: in the examples the fastest centre of mass moves at 186 units/s
    and the fastest ω is 175 rad/s.
  - Falling parts do hit the cap, so a part reaches y = −400 after 1.16 s instead of 0.81 s.
  - `lengthUnit` 10 lifts the linear cap to 4000 units/s, but it was not adopted:
    - With its scaled prediction distance of 0.2 units, larger than the 0.08 gap between layers,
      it stalled the four-bar through speculative contacts with the neighbouring layers.
    - With the prediction distance scaled back, impacts penetrated deeper.
- **Contacts.**
  - Rapier defaults: allowed penetration 0.005, prediction distance 0.02, contact natural
    frequency 30 Hz.
  - A beam rests on a beam 0.004–0.008 below the exact touching distance (edge-on or flat).
  - A 310 units/s impact moves 0.65 units per step. Its first contact can therefore penetrate
    transiently, measured 0.0–0.29 units depending on where in the step the impact falls, before
    the part bounces or deflects. It never passed through in any test.
  - Setting `integrationParameters.contact_natural_frequency` from JS had no measurable effect,
    so it is not exposed.
- **Grab.** A spring–damper acts at the grabbed point: `F = M·(ω²·(target − x) − 2ω·v) − m·g`,
  with ω = 2π·10 Hz.
  - m is the grabbed body's mass.
  - M is the mass of its joint-connected mechanism, not counting paths through fixed bodies,
    capped at 10·m.
  - |F| ≤ 100·M·g.
  - While held, the body gets an angular damping of 5/s so it does not swing about the cursor;
    the damping is removed on release.
  - Fixed, removed or unknown bodies cannot be grabbed: `grab` returns false.
- **Removal depth is relative to the model (fix after review).** §5.1 says a body that *falls*
  below y = −400 is removed. A body is now removed when its centre of mass is below
  `removalY` = min(−400, lowest edit-time cell centre y − 400) (`removeBelowY` sets the −400).
  For a model at y ≥ 0 that is the plain −400; a pendulum built hanging from a frame at
  y = −450 was deleted on the first step before.
- **Diagnostics beyond §5.2.**
  - `jointStates()`: per joint, the separation error, the slide coordinate (B relative to A) and
    the axis tilt.
  - `massInfo(bodyId)`: the engine's mass, world centre of mass and world inertia.
  - Also: `bodyVelocity`, `hasBody`, `bodyOf(partId)`, `grabbed`, `grabPoint()`, `stepCount`,
    `droppedSteps`/`droppedTime`, `speed`/`setSpeed` and `isDisposed`.
  - `energy()` counts live dynamic bodies only.
  - `jointError()` skips joints whose bodies were removed. It returns NaN if any separation is
    NaN.
- **Energy reference in the tests.** §5.3 gives the energy bounds as percentages, but the triple
  pendulum starts with E0 = 0, because it is released at pivot height. The tests therefore use
  E0 − E_min as 100 %, where E_min is the potential of the chain hanging straight down.

## §8 Examples (`src/core/examples.ts`)

- **Pendulum** starts with the link horizontal rather than hanging. A link hanging straight down
  is at rest and shows nothing. The physics period test builds its own small-angle setup.
- **Triple pendulum.** Each link is in its own layer (z = 1, 2, 3; the frame is at z = 0). They do
  not alternate between two layers, because then link 3 could collide with link 1, which would
  break the energy-conservation test in §5.3.
- **Parallelogram.** Horizontal ground (0,0)–(3,0); two equal L-shaped cranks (pivot to pivot
  (2,−2), length 2√2) in layers +1 and −1, released 45° from vertical; horizontal coupler
  (2,−2)–(5,−2) in the ground's layer. It is a rectangle when the cranks hang vertically, at the
  bottom of the swing. The first layout (vertical ground, straight horizontal cranks) swung through
  the change point (all four pivots collinear, where it can flip to the crossed branch and sweep the
  coupler through the ground) at peak speed. Here energy keeps the cranks within ±45° of vertical,
  so they never become parallel to the ground.
- **Sliding axle.** Each "bush" that carries the off-centre arm is a 2-hole part: an axle hole
  plus a pin hole. The captured (spin-only) axle is horizontal (along Z, through an extra Z hole on
  top of the frame's end), not vertical: with a vertical axle gravity is parallel to the joint and
  the arm would never turn by itself. Its arm starts horizontal, so it swings when played.
- **Collision.** The peg is an axle stub that comes out along +Z from a perpendicular (axis X)
  hole of the frame. This is the only way a male can attach to a frame whose holes run along Z
  (§2.2).
- All examples set `rootPartId` explicitly to the frame (part 1).

## §9 Tooling

- **Vitest 4.1** (not 3.x): 3.x pulls in `tinypool`/`@vitest/mocker` versions with published
  advisories; 4.1.12 supports Node 20 and Vite 6. Vite stays on 6.x because Vite 7 needs
  Node ≥ 20.19.
- **npm 10.2.4 bug.** With the bundled npm (10.2.4), *adding or changing* dev dependencies can
  crash with `Cannot read properties of null (reading 'edgesOut')` (arborist peer-set bug triggered
  by vitest 4's optional peers). Plain `npm install` from the committed lockfile works. To change
  dependencies use `npx -y npm@10.9.4 install …`.
- `npm run build` runs `tsc --noEmit` before `vite build`.
- E2E scripts are `e2e/*.e2e.mjs`, run by `e2e/run.mjs` (see the header of `e2e/lib.mjs`).
