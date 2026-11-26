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

### Wheels, ground, free root (DESIGN §2.4–§2.6)

- **Discs of one part that overlap connect their hubs.** Rule 1 joins a hub to every cell its disc
  overlaps; it says nothing about two discs. Two rims of one part can overlap without either disc
  reaching the other hub's cell (r 1.5 hubs at (0,0) and (2,2)). If only the cells between them
  joined them, erasing those cells would split the part into two parts whose discs overlap, which
  rule 2 forbids. So `components` also joins hubs whose discs overlap (they are fused material).
  With this, every split (removeCell, setRim) yields valid pieces.
- **`canRemoveCell` (new) and a throwing `removeCell`.** Erasing a hole cell of a wheel's part
  that holds another part's pin or axle, while a remaining disc of the part covers that position,
  would leave the pin inside the wheel's material (rule 2 without its mate exception). There is
  no valid model to return, so `removeCell` throws with the reason; callers check
  `canRemoveCell` first. Every other removal is allowed, as before. Removing a hub removes its rim.
- **Version.** `validateModel`/`deserialize` accept version 1 and 2. A version-1 model that has a
  rim, a `ground` or a `fixRoot` key (even `false`/`true`) is rejected ("must be version 2"), so an
  older knap never silently ignores wheels. A version-2 model without any of them is valid (the
  version is "otherwise left alone"). `setGround(m, false)` and `setFixRoot(m, true)` delete the
  key (absent = default) and keep version 2. No-op calls return the same model object.
  Three existing assertions used version 2 as *the* unsupported version; they now use version 3
  (`tests/core/model.test.ts` ×2, `tests/review/core.review.test.ts` ×1), same intent.
- **Strict values.** `rim`, `ground` and `fixRoot` are validated when present (JSON `null`
  included) and never dropped; other unknown fields are still dropped. A bad rim value or a rim
  on a male cell has the new `ValidationCode` `'rim'`; wheel blocking uses `'overlap'`.
- **Reasons.** `canSetRim`: "wheels grow from pin holes and axle holes", "largest wheel is radius
  4", "smallest wheel is radius 1", "wheel radius goes in steps of 0.5", "wheel would hit part N
  at (x, y, z)", "wheels would overlap: the wheel of part N (hub …)". `canAddCell`/moves:
  "(x, y, z) is inside the wheel of part N". Shrinking or removing a rim is always allowed.
- **Rim connection in `canAddCell`.** A cell may also attach through a disc: a crank hole inside
  a wheel of the part, or a new cell carrying a rim whose disc overlaps a cell or disc of the part.
  Any cell kind joins through a disc (a pin fused into a wheel face), as rule 1 says "every cell".
- **`makeCell(x, y, z, kind, axis, rim?)`** keeps a given rim and omits the key otherwise;
  `copyCell` copies a cell with its rim. `addPart` keeps rims (Duplicate); the editor's move,
  rotate and duplicate pass the rim through (`src/editor/selection.ts`).
- **WorldIndex** also lists the hubs (`rims: RimEntry[]`) with a spatial hash of 8-cell buckets
  (used above 32 hubs; a scan below), `rimsNear`, `discsOverlapping` and `holeOfPartAt`; the
  checks look only at the ≤ 9×9 cells of a disc's layer square and the nearby hubs. Measured:
  `validateModel` 4 ms, `canAddCell` 0.01 ms, `movePart` of a wheel 0.1 ms on 3060 cells / 60
  wheels.
- **Task text vs §2.6.** The task said a crank hole at (1,1) of an r 2.5 wheel "splits off when the
  rim shrinks to 1.5". By the §2.6 formula, cell (1,1) is overlapped by every disc r ≥ 1
  (near² = ½ < r²), so it splits off only when the rim is removed. A hole at (2,1) (or (2,0))
  splits off at r 1.5. The tests follow the formula.


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

### Wheels, ground, free root (DESIGN §3.1 step 4)

Only `Body.fixed` changes (`&& rootIsFixed`). The root still steers the
free-pin absorption preference and the "a free pin that is the root is not absorbed" rule
(§3 above), so the partition is the same with a free root. Rims change nothing (tested on every
example with rims grown wherever allowed).


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

### Wheels, ground, free root (DESIGN §4.2, §4.3)

- **Construction.** The rim is a disc of radius r − 0.03 revolved from the axis with a 45° chamfer
  of 0.04 on both edges, 48 segments for r < 2 and 64 from r 2. It fills its hub. Every hole cell
  under a disc (hub included) takes the 3D CSG path instead of the 2D slab path, because the slab
  path subtracts its bores before the rim is united; all bores are then cut afterwards.
- **Sealed bores.** A hole whose axis lies in a wheel's plane, inside the disc, can have both bore
  ends capped by rim material. Like the existing "blind at both ends" rule, such a run gets no bore
  (it would be a sealed cavity); a bore capped at one end is a blind hole into the rim.
- **Index mark.** A rectangular groove 0.12 wide and 0.04 deep along +((axis+1) % 3) from radius
  0.5 to 0.02 past the edge on both flat faces, and 0.04 deep across the tread. Its walls are
  90° creases, so each wall and floor is its own smooth patch, and the outline pass draws patch
  boundaries as lines at any zoom (`patches.ts`). In the browser the groove alone was faint on dark
  parts, so the view also paints it (§6 below).
  A cutter is left out when other material of the part fills the region it opens onto (the 0.06
  gap above a face, the band beyond the tread). Otherwise a double-thick stack bridged by
  sliver-fill webs, or a perpendicular wheel of the same part, made the groove a sealed cavity
  (found by the wheel fuzz test). The tread groove is also left out when a cell of the part
  continues past the edge along the mark (`RimMark.tread`, nominal; the geometric test may drop
  more). A face groove may run 0.02 onto a flush beam face beyond the rim edge.
  `rimMarks(part)` exposes the mark (hub centre, axis, direction, radii, width, depth) for the
  view, in case it wants to paint it instead.
- **Collider `'disc'`** carries two extra fields: `innerRadius` (= HC, the hub cylinder's radius,
  for the annulus mass of §5.1) and `male: false` (so code that switches on `male` keeps working).
  The hub cell's own cylinder and web boxes are still emitted, unchanged, and the disc comes
  after them. Do not count the hub's volume twice in the disc's mass.
- **Robustness.** A random-wheel fuzz test of 1500 parts with one or two random rims: one part
  (0.07 %) has the known zero-volume pinch (§4 above). The default run of 200 parts has none.
  Build time of a lone r 4 wheel is ≈ 8 ms (r 1: ≈ 7 ms) in Node.


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
- **New on grid defaults to ∥ Z for every kind (changed after the UX review).** Beams stand
  upright on the reference plane, as in every example, and rods lie along Z, so a pin placed on the
  grid still fits a hole placed on the grid. The earlier default ∥ Y laid beams flat: a pendulum
  built with every default then had a vertical joint axis, parallel to gravity, and did not move
  when played. The letter of §7.3 ("first valid axis") would give X for holes, which also stands
  upright but makes the beam extend along Z away from the default view. The [R] order is Z, X, Y.
  Play also says so when every joint is a revolute about Y ("every joint axis is vertical (∥
  gravity), so gravity cannot turn it"), since such a model is still easy to build on purpose.
- **Sleeve before Extend on a rod's end (departs from the §7.3 order; UX review).** With a hole
  tool, without Shift / [N], on an *axial* face of a male cell: when Sleeve is valid it is the
  default, and Extend's orientations (necessarily perpendicular to the rod) follow it in the same
  [R] options, e.g. "[R] 1/3" sleeve ∥ Z, then extend ∥ X, ∥ Y. The axis alone tells which action is
  shown, so a persisted [R] choice of a perpendicular axis shows Extend. The §7.3 order offered
  Extend first, fusing a perpendicular hole onto the pin's end (a loose pin silently became a
  liftarm-with-pin, which changes the kinematics) while the intended action — sliding a beam onto
  the pin — needed Shift at every joint. When Sleeve is not valid (the rod is already sleeved
  there, or the hole kind does not fit) the §7.3 order applies unchanged. The fuzz reference in
  `tests/review/editor.review.test.ts` encodes this rule.
- **Deep insert (UX review).** Without Shift / [N] and without an Insert-join, a male tool on the
  mouth of hole C (axial face n) pushes the new male on through every cell C − n, C − 2n, … that
  holds exactly one cell, an empty hole coaxial with C that the male fits (any part, the hovered
  one included). Two stacked, unpinned beams are thus pinned together (one revolute joint) with
  one click; before, only the front hole got a 1-cell pin and the beams stayed unconnected, and the
  back hole could only be reached by orbiting. The ghost shows the whole new part and the status
  bar says "New part · insert pin ∥ Z into part 2 · 2 long, through part 1". Shift gives the plain
  1-cell insert (shown as the Shift hint).
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
  order, and [R] only changes the axis inside it, never the action — except on a rod's end with a
  hole tool (Sleeve before Extend, above), where [R] steps from the sleeve to Extend's axes.
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
  instead, e.g. "Shift: New part · pin hole ∥ Z"), and `describeHover` for the status bar's hover
  info.
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
- **Back side** (§7.3, rewritten after the owner's feedback: the back face *under the cursor*, not
  the face opposite the hovered one). `pickBack(model, ray, opts?)` (picking.ts) is the back-face
  pick; `buildPick(model, ray, state, hit?)` (tools.ts) returns it for a build tool with
  `state.backSide` and the front hit otherwise, and the app resolves `resolveBuild(m, buildPick(…),
  …)`. `resolveBuild` goes by the pick's `back` flag, not by `state.backSide`: a back pick (P, C, n)
  resolves as that face hovered from behind and appends " · back side (−Z)" before " — reason" (the
  Shift hint gets the same suffix: it is what Shift + Back side does). `farSidePick` is gone.
  Implementation: per part, in its own frame, the [tIn, tOut] spans of every cube and rim disc the
  ray crosses are merged where they touch or overlap (|Δt| ≤ 1e-9), and the end of the first merged
  span is the part's first exit; the nearest exit over all parts wins. Choices where §7.3 was
  ambiguous:
  - *Shared cell ties.* §7.3 says "as for the front pick — the hole's part before the male inside
    it". The front pick gives the male on an axial face within R_ROD of the axis, so `pickBack` does
    the same when a male and its hole leave the same shared cube at once: the male iff the exit face
    is axial and the exit point is strictly within R_ROD of the axis, else the hole's part. With
    "always the hole" an axle or pin flush with the back of a beam could never be extended out of
    it with Back side (the beam's back face would always win), which `e2e/app-wheels` does.
  - A male inside a hole is part of its own part's solid (§7.3 says so), so a ray along a beam
    through a pin leaves the *pin's* cube first (its side face) — the pin, not the beam's far end, is
    picked there. Likewise a protruding pin head in front of a wheel's hub hides the hub.
  - Exit through an edge or corner of a cube: the tied face with the larger |dir| component, then the
    lower axis, unless its neighbour is the part's own cell (then the next tied face that is not).
  - Exit through the tread highlights the hub's lateral face as §7.3 says; that face is generally
    not under the cursor (up to ~40 px away in `e2e/app-back`).
  Ray-reference tests: `tests/editor/backside.test.ts` (independent crossing/midpoint reference,
  ~10 000 rays incl. wheels, transforms, examples); real mouse: `e2e/app-back` (≥ 200 random hovers
  on three models × three views: the highlighted face's projected quad contains the cursor).
  `ToolState.backSide` is the [B] toggle; Alt/Option is applied per event by
  `withModifiers(s, { shift, alt })` (`altHeld`, never latches, like `shiftHeld`); `withShift` is
  kept as `withModifiers(s, { shift })`. Like New part, the toggle survives tool changes and is
  ignored (its button disabled) for Select / Erase; Wheel ignores it too. Test hook:
  `getState().buildHighlight` = { pos, dir, backSide, valid } of the shown build proposal.
- **Autosave.** An unreadable autosave is moved to `knap.autosave.v1.corrupt`, so it is neither
  lost nor retried on every load. An autosaved empty model restores as "nothing".

### Wheels, ground, free root (DESIGN §7.2, §7.3)

- **Picking discs** (`picking.ts`). Each rim is ray-tested as its nominal disc (radius r, the hub's
  layer). A disc hit counts only when it is *strictly* nearer than every cube hit; the slab
  parameters are computed with the same expression as the cube test, so a disc face coplanar with
  a cube face (the hub, a crank hole) gives the identical t and the real cell wins the tie. A
  flat-face hit returns the hub (`cellIndex`) plus `virtual: G`; a tread hit returns the hub with
  `tread: true` and `dir` = the hub's lateral face nearest the hit's radial direction. Checked
  against a marching reference on 400 random rays and against the §7.3 cases in
  `tests/editor/wheels.test.ts`.
- **Wheel tool on a pin or axle in a hub.** Picking gives the male when the ray enters a shared
  cell's mouth near its axis, so clicking the middle of a wheel on an axle would hover the axle.
  The Wheel tool then acts on the hole around it (another part's hole at that position): "hover a
  hole cell" is read as "the hole under the cursor, even with a rod in it". A lone male: invalid,
  "wheels grow from pin holes and axle holes".
- **Wheel tool modifiers.** Shift = shrink (§7.2), so Shift is not "New part" for this tool; Back
  side and [R] do not apply to it (its toolbar toggles are disabled like for Select / Erase).
  Shrinking shows the band a click removes (the same red ring as Erase) instead of a ghost, since a
  smaller disc would be hidden inside the current one. Growth beyond radius 4 has no ghost (there
  is no valid disc to draw): the hovered face turns red and the hint gives the reason.
- **Virtual cells with New part / Shift.** The §7.3 order applies (Insert, Sleeve, New adjacent);
  only New adjacent is relevant, so a hole tool starts a new part at G + n (on the wheel's face).
  Male tools on a virtual cell are invalid with or without Shift ("add a hole here first"), as
  §7.3 says without qualification. Extend into a virtual cell says "… in the wheel".
- **Erase on a crank hole that holds a pin inside a remaining disc** is refused with core's reason
  (`canRemoveCell`, see §2–§4 Wheels) instead of throwing; the hint is red and a click reports it.
- **Duplicate keeps rims** and skips offsets whose discs would hit anything (pre-filtered by the
  part's disc footprint, then `addPart` decides). **Move / rotate failures** name the wheel conflict
  (first `validateModel` message of the raw result) when the old cell-only check finds none.
- **Kinematics overlay with a free root**: every body gets a moving-body tint (none is grey), and
  the counts say "(none fixed)" (`kinematicsSummary` rewrites core's "(0 fixed)").


## §7 Application (`src/app`, `src/ui`)

- **New / Open / Examples are undoable.** They push the new model onto the history instead of
  resetting it (`History.reset` is not used), so an accidental New or Open is one `Ctrl/⌘+Z` away.
  §7.4 only asks for undo of model changes; there is no "unsaved changes" confirm dialog.
- **Simulate mode freezes editing by disabling, not by stopping.** Tools, palette, New / Open /
  Examples, Undo / Redo and the inspector's buttons are disabled and greyed; editing keys and
  `⌘/Ctrl+Z` show "Stop the simulation to edit (Esc)"; clicks in the view edit nothing. Save,
  Show kinematics, speed, joint friction and the camera stay available. Stop keeps the selection (the model is
  the same object, so it is still valid) and does not touch the camera.
- **Pause turns the frame loop off.** While paused nothing renders continuously (the view
  renders on demand); Step (`.`) advances 1/60 s = 8 fixed steps. Step in edit mode starts the
  simulation paused.
- **"Can't keep up"** is shown when `Simulation.step` dropped steps (its per-call cap) *or* when
  frames arrive more than 10 ms later than the viewport's clamped dt (the page cannot draw fast
  enough), held for 1.2 s. It sits over the view next to the SIMULATING badge and the time
  readout so the top bar never changes width.
- **Joint friction control** (DESIGN §5.1 last bullet). The caption "Friction" (plain text, fix
  after review: as a grey cell of the group it read as a disabled fourth option) and a segmented
  control "Off | Low | Real" sit right of the playback speed. The level's one name is Off / Low /
  Realistic — in the tooltips, the status bar, the help dialog and each button's accessible name;
  "Real" is only the button caption, shortened to fit. The group's title / aria-label is "Joint
  friction: how quickly pins and axles lose motion", the active level is highlighted and
  `aria-pressed`. Arrow keys on a keyboard-focused speed or friction button move the focus within
  its group (fix after review: they fell through to the edit keys and moved the selected part);
  Space / Enter pick the focused level. It works in every mode
  (edit, starting, simulating, paused): it is a simulation setting, so it is no undo step, does
  not touch the model, its autosave or the saved file, and a running simulation gets
  `setJointFriction(μ)` at once (effective from its next fixed step). A level picked while the
  simulation is starting is applied when the world is ready, like the speed. The status bar says
  what the level means ("Joint friction: Off — ideal joints, motion never dies down", …). The
  level is a UI preference in `localStorage` under `knap.pref.jointFriction`; a missing, blocked
  or unrecognised value gives Realistic silently, and a failed write keeps the level for the page.
  `window.__knap`: `getState().friction`, `setFriction(level)`, `simInfo().jointFriction` (μ).
- **Top-bar room for it.** At 1280×720 the bar had ≈ 48 px to spare and the control needs ≈ 160 px,
  so the simulated-time readout moved out of the top bar into the overlay beside the SIMULATING
  badge (shown only while simulating; it was a useless "t = –" while editing), and spacing was
  tightened slightly (gaps 4 → 3 px, separators' margins 5 → 4 px, segmented buttons' padding 7 →
  6 px, the Show kinematics label's padding 8 → 6 px, brand 10 → 8 px). With the caption as plain
  text the bar needs 1252 px (HEAD before the control: 1216 px); at 1280 px the spacer keeps 20 px
  (its minimum is 8). Below ≈ 1252 px Help and About overflow past the right edge, as they did
  below 1216 px before; DESIGN §7 promises 1280×720 and up. `e2e/app-layout` checks that no top-bar item overlaps, overflows or is
  truncated at 1280×720, 1440×860 and 1920×1080 @2×, and `e2e/app-friction` checks the control at
  1280×720 and 1440×900.
- **Simulation failure.** Exceptions from stepping, non-finite poses, a NaN joint error or a joint
  error above 2 units stop the simulation on the next microtask with a banner
  ("Simulation stopped: …"); the model is restored as on Stop.
- **Keys.** Space = Play / Pause, `.` = Step, Esc = Stop while simulating (else Select tool, or
  deselect if Select is already active), `K` = Show kinematics, `D` = Duplicate, `?` = controls,
  `⌘/Ctrl+S` Save, `⌘/Ctrl+O` Open. All other `Ctrl/⌘/Alt` combinations are left to the browser;
  nothing fires while focus is in a text field. Shift pressed or released re-resolves the hover
  without a pointer move. `[`, `]`, `.` and `?` are matched by the character typed even with
  Option (Mac) or AltGr (Windows, reported as Ctrl+Alt) held, because many layouts (German, French,
  Nordic) need it for them; Cmd/Meta combinations still go to the browser. The inspector also has
  Rotate buttons (↺ / ↻), the same as `[` / `]`.
- **Keyboard focus (review).** F and Home go through the app's key handler (the viewport is
  created with `keyboard: false`), so they follow the same rules as every other shortcut: ignored
  while a dialog is open, working while a checkbox has focus. Space / Enter on a *keyboard*-focused
  button or checkbox activate that control (browser default) instead of Play; buttons and the
  Show kinematics checkbox clicked with the mouse are blurred, so Space after a click is still
  Play. The open Examples menu (role=menu) takes ArrowUp / ArrowDown / Home / End, Escape, and
  Space / Enter on the focused item, and holds other single keys back (no tool change behind it).
  The Controls / About dialogs keep Tab focus inside. `N` with Select or Erase active only says
  that New part applies to the build tools (it used to turn the toggle on invisibly).
- **Status messages (review).** Stop says "Stopped · back to the model as edited" (the simulating
  message used to stay). Picking a top-bar colour says "Colour for new parts: …", and with a part
  selected adds that the inspector's swatches recolour it. While autosave fails, or storage is
  blocked, a lasting "Not autosaved" badge sits in the status bar (the error message itself is
  shown once and is soon overwritten). A WebGL context loss shows its notice in the banner and,
  on restore, puts back whatever banner was showing before (e.g. a file error).
- **Back side keys.** `B` toggles it (the toolbar button beside New part shows it, `aria-pressed`);
  Alt/Option pressed or released re-resolves the hover without a pointer move, and pointer events'
  `altKey` resync it. A lone Alt keydown/keyup is `preventDefault`ed (no menu-bar focus on Windows /
  Linux); characters typed with Option/AltGr (`[ ] . ?`) are separate keydowns and still work
  (checked in `e2e/app-back`). While Alt alone (no Ctrl/Meta/AltGraph) is held, the build-hover
  keys `R`, `N`, `B`, `V`, `E` and `1`–`5` act as without it (§7.3 "same [R]"); they are matched
  by physical key (`e.code`), since Option+R types "®" on a Mac. Other Alt combinations are still
  left to the browser. The hint line adds "Alt: back side (the back face under the cursor)" while a
  part is hovered with a build tool and Back side is off; it still fits at 1280×720 (`e2e/app-ui`).
- **Clicks belong to the mode of their press.** A press made while simulating and released after
  Stop (Esc) is not an edit-mode click (it used to build a part).
- **Start-up view.** The viewport is created detached (1×1 px); the app measures it once it is in
  the page and then fits Home, so the start-up view equals Home (it was ≈ 30 % looser).
- **Input while the simulation starts.** Play first builds the physics world asynchronously (mode
  `starting`, tens of ms on a cold first Play). Stop / Esc in that window cancels the start (back
  to edit, "Simulation cancelled"); a speed or friction level picked then is applied to the new
  simulation; a Step
  waits for the start and then steps, so two quick Steps from edit mode advance 2/60 s.
- **Hover is re-resolved on camera changes** (wheel zoom, snaps) from the last pointer position, so
  the ghost never lags behind the view.
- **New's camera.** An empty model cannot be fitted, so New sets the default iso camera with a
  12-unit view (Home / Fit frame a small default box).
- **Selection vs tools.** Switching to a build or erase tool clears the selection; the inspector
  appears only for a selection. Undo that removes the selected part clears the selection, and redo
  does not restore it. Undo / redo across a New / Open / example load also clears it (part ids
  belong to one model: the same id would name an unrelated part), and the file name Save suggests
  follows the history (it is stored per history entry; it is not autosaved).
- **Viewport frame-loop fix** (`src/view/viewport.ts`, a bug that blocked simulate mode): a frame
  callback that touched the view (`setPartTransform` → `requestRender`) left a second
  `requestAnimationFrame` pending, so every simulated frame doubled the pending frames and the
  page rendered exponentially often (SwiftShader froze within seconds). `frame()` now cancels the
  pending request before rendering. Test: `tests/view/frameloop.test.ts`.

### Wheels, ground, free root (DESIGN §7.4, §7.5)

- **Model block.** A small card at the top of a right-hand column under the view cube, above the
  part inspector (which keeps its own `[data-role=inspector]` and is hidden without a selection).
  Fix root shows checked and disabled while the ground is off, with a tooltip saying why; clicking it
  then (or toggling either while simulating) changes nothing. `G` toggles the ground.
- **Test hook (§7.5) additions**: `getState().rootFixed` (what takes effect), `floor()` (what the
  view draws: `{ y, lines }`), `clientPosOfVirtualCell(partId, hubIndex, pos, dir)`.
  `simInfo().groundY` is `Simulation.groundY`; `pushBody(partId, v, angular?)` calls
  `Simulation.setBodyVelocity` for the part's body (false for a fixed / removed body or a bad
  vector). A cart is pushed by pushing every one of its bodies with matching wheel spin; pushing
  only the light chassis moved it 0.8 units, because the push is shared with the heavy wheels.
- **e2e**: `E2E_DIST=<dir>` builds into / serves that directory instead of `dist/` (concurrent
  runs on one machine). `app-examples` now expects the §8 examples 8 and 9 (crank-wheel: 3 bodies,
  1 fixed; cart: 6 bodies, none fixed) — a spec change, not a weakened check — and runs both at
  friction Realistic to 30 simulated seconds with `stepSim` (motion, index mark, floor, rest; §8
  below). `app-wheels` builds wheels with the real mouse and keyboard, then drops a wheel on the
  floor (hub rests at y 0.9942: 1.00 less the round collider's 0.006 resting sink) and rolls a pushed cart (14.3 units in
  0.5 s at 30 units/s, Δy ≤ 0.002).
- **Examples menu scrolls.** With nine examples their descriptions made the menu ≈ 740 px tall, so
  at 1280×720 the last entry (cart) was below the window and could not be clicked. The menu is now
  440 px wide (≈ 30 % shorter) and capped at the window height with its own scroll.
- **Known limits of playing with a vehicle** (an owner-style session through the real UI, a cart
  built from nothing: one 7-hole beam, two axles, four axle-hole hubs grown to r 1.5, Ground on,
  Fix root off; screenshots `e2e/out/owner-*.png`):
  - The grab plane is the view plane (§7.1, unchanged). From the default isometric view a drag
    "along the floor" therefore also pulls toward the camera: a drag of the cursor over 8 units of
    +X moved the cart 5.5 units in X and 2.1 in Z (the wheels skid sideways). From FRONT the same
    drag moves it straight (8 units, pure rolling: wheel angle = travel / r to 1°). Before the
    §5 grab press limit the isometric drag also pressed the wheels ≈ 0.1 into the floor.
  - Lifting the chassis by one point makes the cart dangle and it lands on its side (correct
    physics, but a surprise).
  - The camera does not follow: a cart flung at ≈ 10 units/s rolls out of the fitted view.
  - All new parts take the current palette colour, so a cart built quickly is one colour.
  - Under SwiftShader the page runs at ≈ 1 simulated second per 8 s at ¼× ("can't keep up"); a
    real GPU was not tried.


## §6 Rendering & camera (`src/view`)

- **Outline technique.** It is the suggested post-process, but the "part id" buffer holds *smooth
  patch* ids (part slot·4096 + connected component of the crease-split mesh, `patches.ts`). Every
  crease ≥ 35° is therefore an id boundary: crease lines need no normal threshold, so they cannot
  speckle on curved surfaces or in bores, or smear at grazing angles. Two fallbacks apply within one
  patch: a depth jump that survives linear extrapolation from either side (self-occlusion), and a
  flat-face-normal angle > 30° when both faces look at the camera (a patch that meets itself across
  a crease, e.g. the inner corner of an L beam's wall). Lines are drawn as a polyline through the
  midpoints of the texel-boundary segments, at a uniform width (1.25 CSS px × DPR) with a 1-px AA
  ramp. The ID buffer is supersampled (`supersample` option; see **Supersampling** below).
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
- **Root marker** (reworked after owner feedback: it jumped while simulating and sometimes
  vanished). Anchor = `rootAnchorIndex` (`src/view/rootmarker.ts`): among the root's cells with the
  lowest y, the one nearest that row's x/z centroid; ties → lower x, then lower z. The hatch (24 CSS
  px wide, 1.35 px strokes, white 3.5 px halo) hangs 0.72 world units + 4 px straight below the
  anchor cell's centre on screen, follows the root's own transform, and is drawn with no depth test.
  Fading is per fragment from the outline ID buffer: a texel of another part whose depth is nearer
  than the anchor-cell centre by > 0.55 (i.e. in front of the root's own surface, not merely beside
  it in the same layer) multiplies the strokes' alpha by 0.85 and the halo's by 0.5. "Fainter" is
  carried mostly by the halo: fading the dark strokes as well (0.7 / 0.3 at first, and the ghost's
  ≈ 0.38 before that) left an unreadable smudge on red, blue and dark-grey parts at 1:1, and the
  faint state is common (four-bar, pendulum and triple pendulum at Home: a link hangs in front of
  the root's anchor). It is never hidden. The previous candidate search (`setMask`) is gone.
  "Always visible" with the anchor off-screen: when the mark would not fit in the view but some
  root cell reaches into it, the mark is clamped into the view, 4 px from the edge (`placeMark`).
  Clamping is the identity while the mark fits, so it slides continuously and never hops; it stops
  when the root has left the view entirely (then the mark is off-screen with it).
  `rootMarker()` reports `clamped` and the unclamped `anchorX/anchorY`.
- **Back side ghost / face** (§7.3): a back-side proposal draws its face highlight with no depth
  test (double-sided, fill 0.22) so it reads through the part, and the hidden part of its ghost at
  opacity 0.32 instead of 0.16. The hidden part of every ghost also gets a light silhouette rim
  (fresnel term mixed towards white, `uRim` 0.9 for Back side, 0.5 otherwise) so it stays legible
  through a part of its own hue (the accent ghost behind a blue beam). No dashed outline.
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
- **Lost releases (review).** A gesture also ends, as cancelled (no click; a host drag gets
  `end(…, true)`), on `lostpointercapture`, on a mouse move with no button held, and on a new mouse
  press while it runs. Before, a release lost to a native dialog or a window switch left it
  running: button-less moves kept orbiting and the next press was swallowed.
- **`updateSize()`** reads the container size immediately (a container created detached reports
  1×1 until the ResizeObserver fires, and a resize keeps the framed world rectangle).
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

### Wheels, ground, free root (DESIGN §6.1)

- **Index mark is also painted** (`src/view/markpaint.ts`). The cut groove alone (outline lines on
  its walls) was legible on light parts but faint on dark grey at Home zoom, so the groove's own
  vertices (its floors and walls, which the crease split keeps separate from the face) get a
  per-vertex weight and the part shader paints them in a contrasting shade (lighter on dark colours,
  darker on light ones, by luma). Read on screenshots of r 1 / 1.5 / 2.5 / 4 in white and dark grey,
  from the front, 45°, edge-on and the back, at DPR 1 and 2 (`e2e/wheels-look.mjs`). A groove the
  geometry left out (covered by other material) is not painted either.
- **Floor level.** The view draws the floor at `groundLevel + (½ − HC)` in edit mode too — the
  physics floor (`sim.groundY`), not the nominal level — so it does not jump by 0.04 at Play. Parts'
  visual solids start 0.03 above the nominal level, so they appear to touch it (0.01 under).
- **Floor look** (reworked after owner feedback: the unit lines read as a second grid and the floor
  was otherwise invisible). The same in edit and simulate mode: a tint (`FLOOR_TINT` = 3 % black,
  247 → 240 on the background; was 4.5 %) plus the contact shadow; no lines. Technique for the
  tint: a full-screen shader intersecting each pixel's orthographic view ray with the plane, so it
  is never clipped by the near / far planes; from above the tint is the whole background; it fades
  out within ≈ 7° of edge-on, where a line at the floor's level is drawn instead (continuous
  through FRONT). From below nothing is drawn.
- **Contact shadow** (§6.1; `src/view/shadowmath.ts` constants and pure frame logic,
  `src/view/shadow.ts` GPU side, `floor.ts` draws it). The suggested recipe without a camera: one
  caster mesh per part view (its own geometry, one shared material) is drawn into an RGBA8 texture
  by a vertex shader that maps world (x, z) straight to the frame and a fragment shader that writes
  `(1 − h/SHADOW_H)²`; MAX blending keeps the lowest surface over each texel (no depth buffer, both
  faces). Two separable Gaussian passes (19 taps). The floor's full-screen shader looks the result
  up (bilinear) at each pixel's floor point and draws a near-black (0.08, 0.085, 0.09) at
  `SHADOW_MAX` × strength over the tint — so it is in no outline buffer, writes no depth, draws
  under everything, and parts drawn later cover it.
  - Constants: `SHADOW_MAX` = **0.42** (was 0.34: next to the outlines and the grid at Home the
    shade beside the wheels read as faint; 0.42 makes the floor's position obvious while the
    darkest visible pixel, beside a wheel, stays ≈ 205 on 247 — a shade, not dirt), `SHADOW_H` = 3,
    `SHADOW_BLUR` σ = 0.35 (kept), texel `SHADOW_TEXEL` = 0.125 units, frame sides 8…128 units
    (powers of two, `SHADOW_MAX_EXTENT` = 128 → at most 1024² texels, 8 MB for both targets),
    margin 2.125 units (3σ + 1 unit edge fade).
  - **Stability by a fixed world texel grid**: the texel is a fixed world size and the frame's
    origin a multiple of it, so a moving model is always rasterised and looked up on the same
    world grid. A re-centre or a size change changes only which texels exist: the cart's shadow is
    bit-identical across them (e2e). Sub-texel motion leaves the resampling error of a 0.125 grid:
    ≤ 0.016 strength (≈ 0.007 opacity, under 2 grey levels) for the Cart moved 1.75 units in
    0.044 steps. The frame is kept while it still holds the region and is at most one step too big
    (hysteresis), else re-centred on it.
  - Only parts whose box reaches below `SHADOW_H` above the floor size the frame. Beyond 128 units
    across, the frame is 128 centred on them and what is outside casts nothing; the shadow fades
    out over the last unit of the frame (never visible otherwise, where the margin keeps it ~0).
  - Re-rendered only when a part's pose actually changes (matrix compare: a paused simulation
    re-applies the same poses every frame), a part view is added / removed / re-meshed, visibility
    changes or the floor level changes — not for colours, selection, overlays or any camera change.
    `shadowInfo().renders` counts it.
  - `groundShadowAt(x, z)` returns 0…1 with **1 = `SHADOW_MAX` opacity** (the strength under a wide
    surface on the floor); it is read back from the blurred texture with the floor shader's rule.
    Measured, Cart at t = 0: 0.854 under each wheel's contact line (a 1-wide wheel: the blur across
    its width caps it at ≈ erf(0.47/(σ√2)) ≈ 0.82–0.85), 0.376 under a chassis beam (h = 0.99,
    model (1 − h/3)²·erf = 0.37), 0.071 between the beams, 0 six units away. A 1-wide beam lying on
    the floor: 0.84 at its middle line, ≈ ½ at its edge.
  - Cost (headless Chromium, ANGLE/Metal on an M1 Max, Cart at Home, 1280×720): a frame in which
    nothing moved 1.21 ms with the ground on vs 1.19 off (DPR 1), 7.52 vs 7.44 (DPR 2) — noise; a
    frame in which every part moved +0.16 ms (DPR 1; one 128×128 caster pass + two blur passes).
    No GPU objects leak over 50 example loads with ground toggles (`renderer.info.memory`
    geometries 19 / textures 11 before and after).
- **Ghost depth offset.** The ghost materials carry a small polygon offset toward the viewer, so a
  ghost disc coplanar with the current wheel's faces does not z-fight (it drew as a starburst).


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
  - **Bodies with a joint run 240 TGS substeps per step** (h = 1/115200 s). Everything in
    contact with such a body runs at that count too.
  - **Bodies without a joint run 30 substeps per step** (h = 1/14400 s). This covers loose parts
    that touch only each other or fixed bodies. The option is `freeSolverIterations`, clamped to
    `solverIterations`.
    - How: Rapier runs each connected component of dynamic bodies (linked by joints or active
      contacts; fixed bodies do not link) at `numSolverIterations` plus the largest
      `additionalSolverIterations` among its bodies (`island_manager/substep_groups.rs`). The
      world count is 30, and every jointed body asks for 210 more.
    - Mechanisms are bit-identical to running everything at 240. Tested in
      `tests/physics/lifecycle.test.ts`.
    - Effect on the collision example: 405 → 300 ms of stepping per simulated second in Node.
      Free-body spin drift (below) drops ≈ 8×. Resting contacts are calmer: residual speed
      ≤ 1e-4, tilt ≤ 3e-5 rad, against up to 2e-3 rad before.
    - Contacts change slightly. Flat parts rest 0.911–0.914 below each other's centre instead of
      0.914–0.916; the exact touching distance is 0.92. The deepest transient penetration of the
      40-cell drop is 0.656 instead of 0.659 (the bound is 0.57).
  - 1 PGS iteration and `lengthUnit` 1.
  - No body damping and no sleeping (`setCanSleep(false)`). Joints have dry friction (§5 "Joint
    friction" below, default μ = 0.2). The energy guard (§5 "Free rotation gains speed") only trims
    energy a group has gained beyond 1 % of its peak kinetic energy.
  - **Rapier's hard CCD is off (`maxCcdSubsteps = 0`, fix after review); free bodies use soft
    CCD instead.** The hard CCD clamped the motion of a jointed body at a time of impact with its
    own joint partner, although contacts between them are disabled: an axle sliding in its hole
    stalled for a step whenever it moved faster than about half its thinnest collider piece
    (seen at 10 units/s with thin pieces, at ≈ 180 units/s with the shapes above). Dynamic
    bodies without joints get `softCcdPrediction` = 1.25 × 400 units/s × fixedDt (one step at
    the speed cap). Predictive contacts respect the joint's contact exclusion.
- **Tuning study: no setting with fewer substeps is as accurate (measured, Node, Rapier
  0.21.0).** The harness is a stand-alone script built on `Simulation`; it is not part of the
  repo.
  - Columns:
    - Triple pendulum: energy change relative to E0 − E_min, min over the run.
    - Four-bar: max joint error, loop-closure error and final energy as % of KE_max, over 10 s.
    - Slide stop: final displacement error.
    - Spin: ω drift in % per second, over 5 s without gravity. Cases: symmetric axle in a pin
      hole at 100 rad/s; centre-pinned 5-hole link at 100; end-pinned 5-hole link at 30; free
      3×3×3 block at 100. The block numbers are from before the free-body split.
  - The rows here and the pendulum period error and energy figures below were measured before
    the free-body split. Jointed rows still hold, because jointed bodies did not change.

  | step × substeps | substeps/s | triple 10 s | triple 30 s | four-bar jerr / loop / E | slide | spin %/s axle / centre / end / block |
  |---|---|---|---|---|---|---|
  | 1/480 × 240 (default) | 115 200 | −3.7 % | −13.6 % | 7.6e-6 / 1.1e-3 / +2.0 % | 2e-7 | +0.76 / +1.35 / +0.26 / +1.97 |
  | 1/960 × 120 | 115 200 | −5.2 % | −14.2 % | 7.8e-6 / 1.1e-3 / +2.0 % | 2e-7 | same |
  | 1/1920 × 60 | 115 200 | −5.0 % | −18.5 % | 7.6e-6 / 1.2e-3 / +2.0 % | 2e-7 | same |
  | 1/4800 × 24 | 115 200 | −6.5 % | −15.0 % | 7.7e-6 / 2.3e-3 / +1.9 % | 3e-7 | same |
  | 1/9600 × 12 | 115 200 | −9.8 % | −20.4 % | 7.7e-6 / 9.5e-4 / +1.9 % | 3e-7 | same |
  | 1/480 × 60 | 28 800 | −34.9 % | −59.3 % | 1.1e-4 / 0.01 / −11.6 % | 2e-7 | +0.20 / +0.34 / −0.89 / +0.47 |
  | 1/1920 × 15 | 28 800 | −23.7 % | −51.4 % | 1.1e-4 / 0.01 / −11.6 % | 3e-7 | same |
  | 1/9600 × 1 | 9 600 | −59.5 % | −80.1 % | 9.7e-4 / 0.03 / −31.1 % | 4e-7 | +0.06 / +0.11 / −2.53 / +0.16 |
  | 1/960 × 8 | 7 680 | −48.6 % | −81.5 % | 1.5e-3 / 0.04 / −36.5 % | 2e-7 | +0.05 / +0.09 / −3.04 / +0.13 |
  | 1/1920 × 4 | 7 680 | −63.0 % | −83.8 % | 1.5e-3 / 0.04 / −36.5 % | 2e-7 | same |
  | 1/2400 × 2 | 4 800 | −75.5 % | −88.6 % | 3.9e-3 / 0.07 / −49.7 % | 3e-7 | +0.02 / +0.05 / −4.33 / +0.07 |
  | 1/4800 × 1 | 4 800 | −66.2 % | −88.5 % | 3.9e-3 / 0.08 / −49.7 % | 2e-7 | same |
  | 1/480 × 320 | 153 600 | −2.8 % | — | 4.8e-6 / 2.7e-3 / +4.5 % | — | +0.98 / +1.82 / +0.54 / +2.69 |
  | 1/480 × 480 | 230 400 | +2.9 % | — | 2.4e-6 / 4.3e-4 / +8.1 % | — | +1.90 / +3.20 / +1.00 / +4.54 |
  | 1/480 × 120, 2 PGS | 57 600 | −10.9 % | — | 1.3e-5 / 3.5e-3 / −4.2 % | — | +0.31 / +0.60 / −0.26 / +0.92 |
  | 1/480 × 60, 4 PGS | 28 800 | −31.1 % | — | 2.5e-5 / 5.9e-3 / −11.6 % | — | +0.20 / +0.34 / −0.89 / +0.48 |
  | 1/480 × 240, 2 PGS | 115 200 | −6.0 % | — | 3.8e-6 / 6.9e-4 / +2.0 % | — | same as default |

  - **Only the substep length h matters, not how substeps are split into outer steps.** At a
    fixed number of substeps per second, the joint error, four-bar energy and spin drift are the
    same to 2–3 digits. Only the chaotic triple pendulum differs.
  - Cost is not lower either. Collision example in Node, ms per simulated s (under load):
    1/480 × 240 → 405–446, 1/960 × 120 → 459, 1/1920 × 60 → 477, 1/4800 × 24 → 494,
    1/9600 × 12 → 603. Many small outer steps add collision detection and gain nothing.
  - The pendulum period is right in every row (error ≤ 1.1e-3 %, against the 3 % bound).
  - Extra PGS iterations reduce the joint error but not the energy loss, and they cost about as
    much as substeps.
  - **Where the pendulum's energy goes: Rapier's joint solve dissipates ∝ ω²·h.**
    - Rapier integrates every body's centre of mass along a straight line within a substep and
      rotates it about the centre of mass (`integrate_linearized`).
    - So a pinned link's anchor leaves the pivot by about ½(ωh)²·d per substep, where d is the
      distance from the pivot to the centre of mass.
    - The next substep's biased velocity solve pulls the anchor back, and the unbiased
      stabilisation pass then removes that correction velocity. This is a perfectly inelastic
      projection.
    - In the table, 4× the substep length gives roughly 4–6× the loss.
    - This happens inside the solver, which we cannot reach from JS: the joint softness (1e6 Hz,
      ζ = 1), `warmstart_joints` (default off) and `num_internal_stabilization_iterations` are
      not exposed by the 0.21 JS bindings.
  - **The triple pendulum has no robust margin at 240.** Same model with gravity scaled by
    (1 + k·1e-6), k = 1…20, 10 s:
    - 240 substeps: −3.1 … −11.7 %, median −5.2 %. Two of 20 runs pass the §5.3 limit of −10 %.
    - 288 substeps: worst −8.9 % (12 runs).
    - 320 substeps: −0.7 … −4.0 %, at most +0.4 % (20 runs).
    - The §5.3 test passes at 240 (−3.7 %) because of its particular trajectory, which is chaotic.
  - **320 substeps was not adopted.** It costs +33 %, and the spin gain grows with the substep
    count. Over 30 s at 320 the pendulum rises +15.2 % of KE_max, the four-bar +12.4 % and the
    parallelogram +11.3 %. That fails the review's 30 s bound of +10 %. At 288: +13.0 %, +9.4 %
    and +10.1 %. At 240 the worst is +9.6 % (pendulum).
  - So 240 is the only count that keeps both the loss bound and the gain bound. It does so with
    little margin on either side, because the two errors pull in opposite directions as h
    changes.
  - **Tolerance scales.**
    - `lengthUnit` scales only the contact tolerances and the speed caps, not the joints. At
      `lengthUnit` 2 every number above is unchanged, except that the linear speed cap rises to
      800 units/s.
    - At `lengthUnit` 0.5 the cap falls to 200 units/s, so impacts are slower and shallower.
    - At `lengthUnit` 10 the four-bar stalls on speculative contacts: −109 % of KE_max.
    - `normalizedAllowedLinearError` 0.001 or 0.02, `normalizedPredictionDistance` 0.01 or 0.05
      and `contact_natural_frequency` 60 or 120 change none of the tested numbers.
    - In Rapier 0.21 the JS setter only affects dynamic–dynamic contacts. Contacts with fixed
      bodies use `static_contact_softness` (60 Hz, ζ = 10), which is not exposed.
    - None of these was changed.
- **Cost of the default settings, stepping only.**
  - Measured in headless Chromium 159 on the dev machine, in ms of stepping per simulated
    second. These are the numbers from before the free-body split. Every example except
    collision steps exactly as before.

  | Example | ms per simulated s |
  |---|---|
  | pendulum | 70 |
  | triple pendulum | 151 |
  | four-bar | 194 |
  | parallelogram | 193 |
  | sliding axle | 101 |
  | weld test | 57 |
  | collision | 342 → ≈ 250 (est.) |

  - Collision after the split, Node, best of 3, two runs each: 405 → 295–301 ms. The other
    examples in Node are unchanged at 88–259 ms.
  - The ≈ 250 ms browser figure scales the Chromium number by that Node ratio. It was not
    measured in a browser.
  - At 1× and 60 Hz that is 0.9–3.2 ms per frame, and ≈ 4.2 ms (est.) for collision, still
    just over the ≈ 4 ms budget. Most of what remains is the two jointed links, which run 240
    substeps.
  - In Node the collision example at 1× with the default 8 ms budget simulates 1.95 s of 2 s
    (drops 23 steps).
  - At the default ¼× every example takes ≤ 1.4 ms per frame.
  - `step()` caps the work per call: at most `maxStepsPerCall` (16) fixed steps and
    `stepBudgetMs` (8 ms) of wall-clock time. It drops the rest and counts it in `droppedSteps`
    and `droppedTime`. So an overloaded 1× runs slower than real time instead of spiralling.
- **Free rotation gains speed (known limitation; root cause found in the tuning study).**
  - The cause is Rapier's per-substep gyroscopic correction (`gyroscopic_corrected_angvel`).
    - It is on by default, and the 0.21 JS API cannot switch it off.
    - It rotates ω into the principal frame with the body's f32 quaternion and back again.
    - glam's `Quat * Vec3` assumes a unit quaternion, so each pass scales ω by |q|².
    - Rapier's f32 `normalize()` leaves |q|² ≈ 1 + 6.7e-8 on average for rotations about one
      axis (77 % of samples are above 1), and ≈ 1 + 5.1e-8 for random orientations.
    - So ω grows by ≈ 1e-7 per substep. The rounding of I·(1/I) adds up to ±4e-8, depending on
      the principal inertia values.
  - An f32 emulation of exactly this path reproduces Rapier to 4 digits:
    - +1.1514 %/s for a free body with I = 4 at 100 rad/s about z.
    - +1.5037 %/s at 10 rad/s.
    - +1.4265 %/s with I = 3.
    - 0 when the rotation stays the identity.
  - It is independent of joints and ∝ substeps. Its size depends on ω, on the inertia values
    and on the principal frame, so no damping constant cancels it.
  - Tried and rejected: a principal frame whose norm² is 1 − 6.7e-8, plus principal inertia
    values nudged by ulps so that I·fl(1/I) rounds to 1.
    - In emulation it moves the drift to −0.1 … −1.2 %/s.
    - In Rapier it moves the centre-pinned link from +1.35 to −1.9 %/s.
    - It over-corrects by different amounts for different ω and inertias, and it depends on the
      rounding of this exact Rapier/glam build. It would hide the bias, not remove it.
  - Measured without the guard below, % per second of ω, 5 s, no gravity:
    - Jointed bodies (240 substeps): axle in a pin hole +0.76, centre-pinned link +1.35,
      end-pinned link +0.26.
    - Unjointed bodies (30 substeps): 3×3×3 block +0.24 (was +1.97), 5-hole beam +0.17 (was
      +1.35).
  - Without the guard, rise of the total energy as % of the peak KE, measured from a reference
    after transients (sim review): over 30 s pendulum +9.6, parallelogram +8.2, four-bar +5.4,
    root-not-first +7.0, light body +6.0, **sliding-axle example from t = 2 s +44**, **arm on an
    axle with a bush +30.5** (+48.9 at 60 s: released horizontal, its tip climbed 25° above
    horizontal by 30 s and 68° by 60 s; the sliding-axle arm was vertical at 60 s), **spatial chain
    with joint axes Y, X, Z +50.3**. The earlier "at most 9.6 % over 30 s" counted from t = 0, where
    the sliding axle's drop onto its stop hid the gain, and had no axle-carried or spatial case.
  - **Energy guard (fix after the sim review; `Simulation` option `energyGuard`, default on).**
    After every fixed step, per *group* of dynamic bodies (joint-connected, not through fixed
    bodies; groups whose bodies start touching — Rapier collision-start events — merge for good):
    E = kinetic + potential energy, eRef = the lowest E since the group's reference was set, kPeak =
    the highest kinetic energy since then. If E > eRef + max(band·kPeak, floor), every velocity of
    the group is scaled by one factor s < 1 so that E returns to that cap. band =
    `energyGuardBand` = 1 %; floor = 1e-5·Σ m·|g|·(1 + |com|) sits above the f32 rounding noise of
    the potential energy, so a mechanism starting from rest, or balanced on an unstable equilibrium,
    is never held still (with no floor the guard froze a pendulum balanced upright).
    - A uniform scale keeps every joint's homogeneous velocity constraint and the sign of every
      contact velocity, so the path is unchanged; only the speed is trimmed. The guard only removes
      energy: losses (joint solve, impacts, slide stops) lower eRef and stay lost. It does not undo
      external work: the reference is reset on the first step, every step a body of the group is
      grabbed, on release, when a body of the group is removed and when groups merge.
    - This is a correction, not damping: §5.1 asks for no body damping and the guard does
      not act on a mechanism that is not gaining (the triple pendulum's 10 s run is bit-identical
      with and without it; chain6, crank-slider, collision, prismatic sled: nothing removed).
    - Measured with the guard over 30 s (60 s for axle-arm, spatial chain and sliding axle): every
      example and review mechanism rises by at most 1.0 % of its peak KE (pendulum, four-bar, parallelogram, axle-arm, spatial chain, light body,
      root-not-first: exactly the 1 % cap; sliding axle after its drop 0.0 %), and the minimum
      energy is the same as without the guard to 0.1 % (no extra loss). A spinning axle without
      gravity settles at +0.5 % of ω (KE +1 %) and stays there (was +22 % in 30 s). Cost:
      +1–2 % of the stepping time.
    - Tests: `tests/physics/energyguard.test.ts` (axle-arm, spatial chain and sliding axle over
      60 s; untouched triple pendulum; grab work kept; collision energy between groups kept; the
      gain without the guard), `tests/physics/pendulum.test.ts` (ω drift ≤ 0.75 % in 5 s for
      jointed and free bodies), `tests/review/sim.review.test.ts` and the former `it.fails` spin
      tests in `tests/review/physics.review.test.ts`, which now pass.
    - Limits: the guard caps the *total* of a group, so energy gained by one body of a group is
      taken back from all of them in proportion. A body that is set spinning by code between steps
      (tests do this through private access) has its new energy accepted only on the next step.
  - `decoupleInertia` is skipped for a body whose products with the joint axis are already
    negligible (< 1e-6 of the trace), so it does not change a symmetric body's representation.
  - The real fix belongs in Rapier: rotate with a matrix, or divide by |q|², or expose
    `enable_gyroscopic_forces`. In a planar mechanism every body spins about a principal axis,
    so the gyroscopic term is exactly zero there and switching it off would be exact. Until then
    the energy guard (above) bounds the effect.
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
- **Joint friction (added after first user testing; DESIGN §5.1 "Joint friction").** Options
  `jointFriction` (μ, default 0.2), `Simulation.setJointFriction(μ)` / `jointFriction`, levels
  `JOINT_FRICTION = { off: 0, low: 0.05, realistic: 0.2 }`, `DEFAULT_FRICTION_LEVEL = 'realistic'`.
  μ must be a number in [0, `MAX_JOINT_FRICTION` = 10] (fix after review: any finite μ was
  accepted and `Number.MAX_VALUE` made τ_f = Infinity); −0 is stored as 0.
  - **Three changes after review, all in `sim.ts`; the first changes DESIGN §5.1:**
    1. **m_j is the weight the joint carries, not the lighter body** (below, "Load estimate").
    2. **Stuck joints are held where they stuck** (below, "Stiction hold"); DESIGN asked for this
       ("stays at rest without creeping") and the motor alone did not deliver it.
    3. **The energy guard subtracts friction's work from its reference** (below, "Energy guard
       and grab"), so DESIGN §5.3's "slows at τ_f / I" holds at Low for long fast rotors too.
  - **Construction: the suggested one.** Every joint gets a Rapier velocity motor with target 0 on
    each free axis: revolute AngX, prismatic LinX, cylindrical (generic joint) AngX and LinX. It is
    set through `world.impulseJoints.raw.jointConfigureMotorModel / jointConfigureMotorVelocity /
    jointSetMotorMaxForce` with the raw axis values AngX = 3 and LinX = 0, model
    `AccelerationBased`, gain (damping factor) 1e9, and maxForce = τ_f or F_f.
    - F_f = μ·m_j·|g| and τ_f = F_f·R_BORE (0.31), m_j from "Load estimate" below (engine masses,
      read after `decoupleInertia`, which keeps the mass). |g| is the magnitude of the `gravity`
      option, so with zero gravity there is no joint friction (tested). `jointStates()` reports
      `loadMass` = m_j and the limits; a joint whose body was removed reports 0 for both limits
      (fix after review: it reported the configured value although it has no motor any more).
    - The generic joint's frame X is the joint axis for every world axis and both body orders (the
      same frame the LinX limits use). Spin-down was identical for X, Y and Z, and for both orders.
    - μ = 0: a joint that never had friction gets no motor at all. Every example's trajectory at
      μ = 0 is bit-identical to the code before this change (hashes recorded from git HEAD before
      editing, in `tests/physics/friction.test.ts`).
    - A joint whose friction is switched off keeps its motor rows at limit 0. That is bit-identical
      to having no motor: tested for every example over 3 s. A run switched off mid-way also
      continues exactly as a run created with friction off from that state (state copied, tested).
  - **Rapier 0.21 motor findings (measured).**
    - `maxForce` is a force or torque, not an impulse. Rapier turns it into an impulse per substep,
      so the limit does not depend on the substep count. For a rotor with I = 2, maxForce 4 and 10
      rad/s, dω/dt is 2.000 rad/s² at 1 substep. At 240 substeps it measures 1.84; the missing
      0.16 is the known f32 spin gain, which gives +0.15 rad/s² with maxForce 0. 1 and 4 PGS
      iterations give the same result.
    - While sliding, the motor saturates. The deceleration was then the same for both motor models
      and for gains 1, 1e3 and 1e6.
    - Below the limit, a low gain is a soft damper, and the joint creeps through. At gain ≥ 1e6 the
      row is effectively rigid, and the two models agree.
    - Limits still hold with a motor on the same axis. Prismatic and cylindrical joints along X, Y
      and Z, in both body orders, stop exactly at their stops.
    - Joint error is unchanged: at realistic it is as small as at off for every example (table).
  - **Load estimate (fix after review; changes DESIGN §5.1, which said "the smaller of the two
    joined bodies' masses").** `Simulation.loadMasses`, computed once when the world is built:
    - Bodies are ranked by their joint distance from a fixed body. From the farthest in, each
      dynamic body passes its own mass plus everything passed to it on to its joints that lead one
      step closer to a fixed body, in equal shares. A joint's m_j is what it passes. So in a chain
      every pivot carries every link below it, and in a loop (four-bar, parallelogram) the far
      link's weight is split between the two sides. At rest this equals the static joint load of
      a chain exactly; for the four-bar it is the equal-split approximation of the statics.
    - A joint that passes nothing (it joins two bodies at the same distance, e.g. across a loop),
      and every joint of a group with no path to a fixed body (a loose sub-assembly): the lighter
      body's mass, as before. Two fixed bodies: Infinity, i.e. no friction.
    - Why: with the lighter body, a pivot that carries a chain got one link's friction. The
      reviewers measured (realistic): a 15-hole beam on a 2-hole link (m_j / true load 0.10) never
      at rest in 120 s (≈ 145 s); a 12-link chain of 3-hole links still swinging at 150 s; three
      9-hole links 62.5 s; the triple-pendulum example 17 s (68 s on screen at ¼×), against "a
      swing dies down within seconds" in the UI.
    - Rest after the change (`tests/physics/friction-chains.test.ts`; at rest = no body turns more
      than 1e-3 rad in 0.5 s): triple pendulum 17 → 6.5 s, 2-hole + 15-hole 145 → 22.0 s, double
      5 + 5 13.5 → 8.5 s, six 3-hole links ≈ 25 → 13.0 s, three 9-hole links 62.5 → 37.0 s, twelve
      3-hole links > 150 → 31–32 s. Single-pivot examples are unchanged (pendulum 4.01, weld test
      8.22, sliding axle 3.34 / 3.42). Built-in loads now: triple pendulum 10.53 / 6.00 / 2.31,
      four-bar 4.84 (ground–crank) / 7.15 (ground–rocker) / 2.53 / 2.53, parallelogram 6.73 / 6.73
      (ground–cranks) / 1.58 / 1.58 (cranks–coupler; the lighter-body rule gave 2× the true load),
      collision 6.84 / 3.16.
    - Tried and not adopted: the instantaneous reaction, Σ m·(a − g) over the far side from each
      body's Δv per step (it also gives the radial load of a slide, and zero load in free fall).
      Rest times: twelve links 29 s, 2 + 15 18.5 s, triple pendulum 8.0 s, pendulum 3.5 s — barely
      different, at the cost of rewriting the calibration (Coulomb on an incline) and per-step
      limits. Long chains are slow because their light tail links carry only their own weight
      under either model.
  - **Stiction hold (fix after review).** The friction motor is one Gauss–Seidel row per substep:
    a joint held below its limit kept slipping slowly, in proportion to the load (1.2e-3 rad/s for
    a 2-hole link at 90 % of τ_f). The slip shows wherever the f32 pose resolves ≈ 1e-9 rad per
    substep, which is near the build orientation *and* ≈ 180° from it (an up-built part hanging
    down), and it did not run toward equilibrium: a 2-hole link released at 0.9 × its dead zone
    turned 1.02° in 20 s; an up-built pendant wandered 1.3° over 6 minutes; the built-in four-bar
    at μ ≥ 2 crept 0.4°/s whatever μ. (The earlier text here said it only showed near the build
    orientation and ran toward equilibrium; both were wrong.)
    - Now (`updateFriction`, after every fixed step with μ > 0): a free axis whose relative speed
      is below `STICK_SPEED` = 0.01 rad/s (units/s) sticks at its current coordinate — the angle
      of B relative to A about the axis since the build pose, from the f32 rotations, or B's
      anchor along A's axis. While stuck, its velocity motor's target is −offset / fixedDt (0 when
      |offset| ≤ `HOLD_DEADBAND` = 1e-5), still limited to τ_f / F_f: the next step takes it back
      to where it stuck. Once |offset| > `SLIP` = 2e-4 the load has overcome the limit, the joint
      lets go and the target is 0 again (sliding friction). The motor's target velocity sign is
      the sign of `jointStates().omega` / `.speed` (measured: target +1 gives ω = +1.0000 for both
      body orders).
    - It only ever pulls back an offset of at most SLIP against a limited force, so it can return
      at most τ_f·SLIP of energy per stick (0.06 for the pendulum, whose swing energy is ≈ 1e4);
      the energy never rose above its running minimum in any sweep. A held joint's offset stays
      ≤ 1.7e-5 rad (SLIP is 12× that). The deadband keeps the target 0 for offsets the f32 pose
      cannot undo, so a body at rest does not report a velocity it never moves with.
    - A first version corrected a quarter of the offset per step: two stuck joints of a light link
      under a heavy one (2-hole + 15-hole) then oscillated to ±SLIP, let go and re-stuck 7 times
      a second, ratcheting 3.5e-4 rad/s. Correcting the whole offset each step holds them still.
    - Measured (`tests/physics/friction.test.ts` "stiction is exact"): 2- and 5-hole links released
      at 0.5 and 0.97 × their dead zone near the build pose deviate ≤ 1.7e-5 rad in 20 s (was
      1.2e-2 – 2.2e-2 rad for the 2-hole link); a 2-hole link stuck 175.4° from its build pose moves
      2.7e-6 rad from 3 to 30 s (was 2.45°); the four-bar at μ = 10 moves 5.8e-8 rad in 10 s.
      Every example and chain, once at rest, turns < 1e-4 rad for the rest of the run (jointed
      bodies; at most 1.4e-5 rad measured, twelve-link chain).
    - A part resting on *another moving part* through a contact is held by the contact, whose own
      solver creep remains: in the reviewers' four-joint mechanism a pendant leaning on a sibling
      beam (its pin's τ_f = 240 against 2385 of gravity torque) slides 0.12° in 50 s. That is
      Rapier's resting-contact creep (DEVIATIONS "Contacts"), not joint friction.
    - "At rest" in the tests is still judged by pose; a held body's velocity reading stays below
      1e-3 rad/s (the grab-release test checks it).
  - **Calibration (Node, `tests/physics/friction.test.ts`).**
    - Built-in pendulum at realistic: m = 4.005, d = 2.000, τ_f = 304.5, so 2τ_f/(mgd) = 3.55°
      per half-swing.
      - Energy lost per half-swing divided by τ_f·(θ₁+θ₂) = 0.987–1.001.
      - Decrement below 30° divided by 2τ_f/(mgd) = 1.001–1.035 (unchanged by the review fixes: a
        single pivot's load is the same). At large amplitude the decrement
        is larger (≈ 2τ_f/(mgd) · θ/sin θ), as dry friction predicts.
      - 21 half-swings (≈ 10 swings), amplitudes 90 → 4.2°. At rest (|ω| < 1e-3) from 3.58 s,
        0.684° off vertical (dead zone asin(τ_f/(mgd)) = 1.776°).
      - The spec's 2–6 s bound is met with the formula as specified. At low: 73 half-swings, at
        rest from ≈ 15 s.
    - Spin-down at realistic: a centred 5-hole link on a pin decelerates at 38.82 rad/s² against
      τ_f/I = 39.12 (−0.8 %). An axle in a pin hole decelerates at 1783 rad/s² against 1784. Neither
      ever speeds up: the largest step-to-step rise in |ω| is 0.
    - Spin-down at low, centred 9-hole beam (fix after review): 2.89 rad/s² from 50 rad/s and 2.90
      from 200 rad/s against τ_f/I = 2.95 (−2 %; before the fix −17 % and −52 %, still 140 rad/s at
      40 s instead of stopping at 67.7 s; now it stops at 68.0 s). |ω| never rises over any 0.1 s;
      single steps from 200 rad/s rise by up to 7.6e-4 rad/s (f32 noise of the spin gain).
    - Slides: a prismatic joint loaded at 2μ accelerates at (sin φ − μ)·g, measured exactly
      (1.226 vs 1.226 units after 0.1 s). Loaded at 0.5μ it moves < 1e-6 in 3 s. The sliding-axle
      example's vertical axle reaches 1.97 at 0.0646 s against 0.0634 s for free fall under
      (1 − μ)·g (one 1/480 s step of sampling).
    - A hanging 5-hole link with gravity tilted to load it to 0.5 or 0.9 × τ_f holds (≤ 8.6e-6 rad
      in 2 s). At 1.2 × τ_f it slides.
  - **Energy guard and grab.**
    - **The energy guard counts friction's work (fix after review).** The f32 spin gain grows with ω
      (≈ 0.0115·ω rad/s² for a jointed body), and while friction lowered the energy faster than
      the gain raised it the guard never acted, so the gain silently ate part of friction's
      deceleration (above). Now `updateFriction` adds τ_f·|Δθ| + F_f·|Δs| of every axis with
      friction to its group's work for the step (a moving friction motor is saturated, so that is
      the energy it removed; a stuck axis has Δ ≈ 0), and the guard lowers its reference eRef by
      that work before comparing. Energy above the reference minus friction's work (beyond the 1 %
      band) is trimmed as before; the guard still only removes energy. At μ = 0 the work is
      exactly 0, so the frictionless guard is unchanged bit for bit. `setJointFriction` restarts the
      guard's reference (like a grab), so a run switched to off continues exactly as a run created
      off from that state.
    - Over 30 s at realistic the guard removed nothing in any example; at low it removed 51 (pendulum)
      and 64 (four-bar) of the f32 gain and nothing elsewhere. The total energy never rose above its
      running minimum at low or realistic.
    - Grab at realistic: the grab spring (M·(2π·10 Hz)²) is far stiffer than friction.
      - Dragging the pendulum's tip round at 6 units/s, it lags the cursor by 0.346 units, against
        0.341 with friction off. Most of that is the spring's sag under gravity, g/ω².
      - Released at 45°, it rests 1.72° off vertical, inside the 1.78° dead zone.
      - Released at rest 1.17° off vertical, inside the dead zone, it stays there: 0.0° in 2 s.
  - **Measured behaviour per example and level** (30 s, `friction-examples-*.test.ts`).
    - "At rest" is judged by pose (see above). "Creep" is the largest rotation after that, up to
      30 s.
    - Joint error is the maximum over the run. Energy never rose above its running minimum by more
      than the guard's band at any level; at low and realistic it never rose at all.

  | example | at rest from: off / low / realistic | creep after rest (realistic) | max joint error off / realistic |
  |---|---|---|---|
  | pendulum | never / 14.5 s / 4.0 s (ω below 1e-3 rad/s from 3.58 s) | 0 | 9.9e-7 / 9.9e-7 |
  | triple pendulum | never / 21.5 s / 6.5 s | 0 | 9.6e-6 / 3.5e-6 |
  | four-bar | never / 9.5 s / 2.5 s | 0 | 7.7e-6 / 5.0e-6 |
  | parallelogram | never / 4.0 s / 1.5 s | 0 | 1.1e-6 / 8.2e-7 |
  | sliding axle | never / 2.5 s / 0.5 s | 0 | 6.6e-7 / 4.8e-7 |
  | weld test | never / 21.5 s / 5.5 s | 0 | 1.3e-6 / 1.3e-6 |
  | collision | 1.5 s / 1.0 s / 0.5 s | 0 (the loose beam settles ≤ 1.7e-3 units) | 1.1e-6 / 1.1e-6 |

  - Notes on the table:
    - Collision at "off" comes to rest because the struck link ends up lying on the peg. The loose
      beam settles on its contact by up to 1.7e-3 units at every level.
    - Before the review fixes, realistic was: triple pendulum 17.0 s, four-bar 3.0 s, parallelogram
      3.5 s with 0.049° of creep after rest, collision 0.046° of creep; low: triple pendulum still
      2.5 rad/s at 30 s.
    - The linkages still move at every level. Crank range over 5 s: four-bar 212° / 212° / 212°,
      parallelogram 61° / 59° / 56° (off / low / realistic).
    - **Dead zones of nearly balanced parts.** A body comes to rest anywhere within
      asin(τ_f / (m·g·d)) of hanging straight, d = its centre of mass's distance from the axis.
      The sliding-axle example's arm sits on its axle with a bush (m = 3.42, d = 0.214), so its dead
      zone is 16.8° and at realistic it stops 11.3° short of hanging straight in its first swing
      (reviewer fapp). This is what the model says for a real near-balanced rotor with that load and
      bore (μ·R_BORE/d = 0.29); it is kept and documented in the README rather than special-cased.
  - **Collision example, transient depth.** The struck link comes to 0.745 of the peg's centre line
    at realistic (0.638 with the earlier load estimate), against 0.731 at off (contact at 0.75).
    - This is the step-phase effect in "Contacts" below, not friction. With gravity scaled by
      1 + k·2e-3 (k = 0…11): off 0.590–0.731, low 0.642–0.751, realistic 0.573–0.745.
    - `tests/physics/examples.test.ts` runs every example's 10 s checks at off *and* at the default
      level (fix after review: it ran only at off). The collision bound is > 0.70 at off and > 0.5
      at the default level, below the measured range and far from passing through. The 30 s
      friction sweep checks > 0.75 − 0.29, the documented transient depth.
  - **Cost** (Node, best of 3, ms of stepping per simulated s, off → realistic): pendulum 90 → 95
    (+6 %), triple pendulum 209 → 225 (+8 %), four-bar 262 → 284 (+8 %), sliding axle 149 → 165
    (+11 %), collision 315 → 329 (+4 %). All are under the 15 % budget.
  - **Limits of the model.**
    - The load is an estimate from the weight, fixed for the run, not the joint's true reaction.
      It ignores centrifugal and impact loads, so a fast swinging chain gets less friction than real
      parts. It also applies when the true load is small: a pinned pair falling freely has its
      relative spin of 10 rad/s stopped within 0.2 s, and the sliding-axle example's vertical axle
      falls at (1 − μ)·g although its weight is along the axle. Both last a fraction of a second.
      Long chains of light links settle slowest (twelve 3-hole links ≈ 32 s, three 9-hole links
      37 s at realistic; DESIGN §5.3's 30 s bound is for the built-in examples).
    - Pins and axles share one μ, and the level is independent of the contact friction (0.4).
      Friction pins are still welds.
    - The friction does not depend on speed (no viscous term) or on how the joint is loaded
      sideways.
    - There is no joint friction without gravity.
    - A part resting on another moving part is held by the contact, which creeps slowly (above).
  - **Tests.**
    - `tests/physics/friction.test.ts`: API and μ range, load estimate (chain, loop, loose pair),
      diagnostics (no gravity, removed body, omega / speed), μ = 0 hashes, the off switch,
      determinism, pendulum decay, static hold, exact stiction (near and 180° from the build pose,
      closed loop at μ = 10), spin (also 9-hole at low), slides on every axis and in both body
      orders, linkages, level changes, loose bodies and grab.
    - `tests/physics/friction-examples-{off,low,realistic}.test.ts`: every example for 30 s; at
      realistic no jointed body turns more than 1e-4 rad after coming to rest (was 0.1°).
    - `tests/physics/friction-chains.test.ts`: the chains of "Load estimate" come to rest by their
      bounds and then turn < 1e-4 rad in 5 s.
    - The conservation tests (period, energy bounds, energy guard, spin drift, triple pendulum,
      free-slide timing, non-principal spin-up, the 10 s example run) and both review files now
      pass `jointFriction: 0` explicitly, so they still test what they tested. No assertion was
      changed.
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

### Wheels, ground, free root (DESIGN §5.1 "Ground", "Wheels", "Free root", §5.3)

All numbers are Node, Rapier 0.21.0, sim.ts defaults (1/480 s, 240/30 substeps), measured on a
machine shared with other jobs (load average ≈ 30 during the cost runs).

- **Unchanged without them.** Collision groups are set only when the model has a rim or a ground;
  otherwise every collider keeps Rapier's default groups and nothing else is created, so the seven
  older examples give the recorded bit-identical hashes (`friction.test.ts`, unchanged
  assertions). The load-ranking change (sinks) is a no-op without a ground.
- **Ground.** A fixed Rapier body (not one of the model's bodies: no part, never removed, not in
  the energy guard, ignored by contact-event grouping) with one half-space collider, friction 0.4,
  restitution 0.1. `groundY` = groundLevel + (½ − HC) at θ = 0 (bit-exact).
  `SimOptions.groundSlopeDeg` (θ, |θ| < 90°, validated): normal (sin θ, cos θ, 0), so the floor
  falls toward +X. "Through the point under the model's centre" was made concrete as: the plane is
  placed to touch the model's lowest nominal point along −n (cells as unit cubes, rims as discs of
  radius r and thickness 1), lifted by ½ − HC; `groundY` is its height under the mean cell centre.
  A plane through a fixed pivot started a tilted wheel inside the floor, and the energy guard then
  froze it (it read the depenetration as an energy gain). A level vehicle on a tilted floor still
  starts on its downhill wheels and tips onto the slope; the cart incline test therefore tilts
  gravity instead (exactly equivalent, and the cart starts on all four wheels). After landing, a
  cart on a 15° *floor* accelerates within −0.45 % of the analytic value.
- **Existing colliders on the half-space** (dropped from 10 units, 5 s, `wheels.test.ts`): deepest
  impact 0.002–0.143 units (tumbling 5-hole liftarm 0.143, tumbling pin 0.138), resting sink
  0.001–0.011 units, no body moves > 1e-3 units in the last second, none removed. Soft CCD of loose
  bodies works with the half-space as it is; nothing needed fixing for prisms and boxes.
- **Wheels** (shapes.ts `WheelShape`, sim.ts `addWheel`): as §5.1. Round = `ColliderDesc.cylinder`
  (radius r − 0.04, half-length HC) rotated onto the axis, mass set explicitly to the annulus
  π(R² − HC²)·2·HC with its analytic inertia (in the collider frame, f64 values; the engine's mass
  and axial inertia match within 1e-4 relative), friction 0.8. Hull = 32-gon prism over the same
  cylinder, bevel 0.02·r, density 0, friction 0.4. Groups 1/2/4/8 exactly as suggested, plus 16
  (below).
- **Deviation: a third, "ground guard" collider per wheel (group bit 16, meets only the ground).**
  Rapier's cylinder–half-space contact takes the cap's support feature as 4 points when the disc
  is near flat, so a wheel wobbling down onto its face sank up to **1.04 units** into the floor
  (r = 4, dropped from 10 units spinning; found by the drop tests) before the hub's barrel prism
  caught it. The guard is a bevelled 32-gon prism inscribed in the round collider, 0.12 smaller in
  radius and 0.02 in half-length, density 0, frictionless (combine rule Min). It must never touch a
  wheel that rolls upright: the round collider's sink grows with speed (0.006 at rest, 0.015 at
  120 units/s, 0.063 at 330 units/s, ≈ 0.08 at the 400 cap); a 0.03 inset was hit at 150 units/s
  and its polygon then slowed a cart on a 15° floor by 16 % and made a wheel hop. With 0.12/0.02
  the rolling and incline numbers are identical to no guard, and the wobble is caught at
  0.05–0.17 units. Only created with a ground.
- **Deviation: soft CCD is kept for unjointed bodies with a rim** (§5.1 says none). Without it a
  wheel dropped 10 units sinks a full step's travel into the ground (0.25 units) on impact, and the
  guard was then hit too and kicked upright drops into rolling at 1–5 units/s. With it the same
  drops sink 0.002–0.08. The spike's reason (soft CCD makes the hull fall through liftarms) did
  not reproduce with this construction (wheel drops 2–10 units, r 1–4, axis X/Y/Z, spinning and
  tumbling, centred / at ends / at the seam between two beams): with soft CCD 0 of 816 passed
  through (144 onto a 15-hole beam lying flat, 672 onto a 5 × 30 liftarm floor lying flat or on
  edge); without it 0 of 816 too. With soft CCD more wheels bounce and roll off the floor's edge
  (123 vs 53 of 336 on the flat floor). I did not find why the spike's cases failed (its 0.05 fixed
  bevel and separate per-beam hulls are the obvious differences). Jointed wheels (the cart) have
  no soft CCD, as every jointed body.
- **Wheels against parts: the full measurement** (more than `wheels.test.ts` keeps).
  - Liftarm (5 holes) dropped onto a fixed wheel: r 1.5 / 2.5 / 4 × drop 2 / 5 / 10 units × 14
    configurations (on edge, flat, across the wheel, on end, centred and off-centre by 1–2,
    spinning): 126 cases, **0 passed through**; deepest vertex inside the rim 0.042 units; 9 came
    to rest balanced on the rim, the others were deflected and fell past. The test keeps 14 of them.
  - Loose wheel dropped onto a fixed 15-hole beam lying flat: r 1 / 1.5 / 2.5 / 4 × 2 / 5 / 10
    units × 12 (on edge across / along the beam at holes 0, 3, 7, 13, 14, lying flat, spinning,
    tumbling): 144 cases, **0 passed through** (deepest point inside the beam's box 0.29 units
    without soft CCD — at the rounded ends, where the box overestimates — 0.16 with it). The test
    keeps 12.
  - Not measured: wheels rolling along beams (lossy by construction, §10), wheel hulls against pins
    and axles specifically, two loose wheels' round colliders against each other beyond resting.
  - A pendulum link (pinned at (−5, 3), friction off) striking an r = 2 wheel pinned at (0, 0): the
    link arrives at 12.8 rad/s, rebounds at 1.49 rad/s (restitution 0.1), the wheel is kicked to
    1.40 rad/s and then held by the link resting on its rim (static friction; the contact normal
    of a circle passes through the axle). With the pivot at (−5, 4) the link slides off the rim
    after 1.5 s and leaves the wheel spinning at 2.2 rad/s.
- **Free root.** With `rootIsFixed` false no body is fixed (kinematics). In sim.ts:
  - *Load ranking*: bodies with a horizontal-axis rim whose nominal lowest point (hub · n − r·|n
    in the disc's plane|) is within 0.05 of the nominal floor are sinks at distance 0, in addition to
    fixed bodies (also with a fixed root). `Simulation.isGroundSink(bodyId)` exposes it. The
    §5.3 cart's four axle joints carry 4.1777 each = chassis / 4 = (M − Σ m_wheel)/4 exactly; the
    lighter-body fallback gave 6.169 (×1.48; the spike's ×1.8 was for its lighter wheels).
  - *decoupleInertia* stays restricted to mechanisms attached to a fixed body (so it does nothing
    for a free vehicle). Tested: a free cart with a 2-cell friction pin welded in a crank hole of
    one wheel (products of inertia 0.22 with the axle), friction off, pushed to 40 units/s: in
    10 s no spin-up (wheel |ω| ≤ 28.3 rad/s against 27.4 for rolling), energy never above its
    start, chassis tilt ≤ 0.004 rad, but it slows to 27.6 units/s — the eccentric wheel bumps
    and loses energy in its ground contact.
  - Energy guard, grab, removal, `jointStates` work unchanged (no code assumed a fixed body
    exists; `findPlanarMechanisms` and the friction-work owner already handled it).
  - `setBodyVelocity(bodyId, linear, angular?)`: centre-of-mass velocity (and optionally angular
    velocity, else unchanged), dynamic live bodies only, finite vectors only; resets the energy
    guard reference of the body's group. Returns `boolean` (false = refused), which is assignable
    where the app expects `void`.
- **Measured against §5.3** (`wheels.test.ts`, `cart.test.ts`):
  - Rest, 5 s: horizontal axis moved ≤ 2.4e-3 units, sank 4.5e-3–7.4e-3, turned ≤ 2.5e-7 rad;
    lying flat moved ≤ 7.0e-5, sank ≤ 2.6e-3.
  - Rolling at 40 units/s over 160 units: speed within −0.09 %…+0.55 % (r 1 and 4 gain up to
    0.5 % before the energy guard caps it; sideways drift 0.02–0.10 units).
  - 5° / 15° floor from rest, r 1.5–4: acceleration −0.17 %…+0.02 % of g·sinθ/(1 + I/(m R²)),
    R = r − 0.04 (the contact radius).
  - Cart at rest 30 s: drift 4.3e-4 units, sink 9.8e-3, joint error 5.3e-7. Pushed to 40,
    friction off: 39.99–40.46 units/s over 5 s (+1.1 %). Coasting, Realistic: 3.088 vs 3.086 units
    from 10 units/s (+0.07 %), 49.53 vs 49.38 from 40 (+0.31 %), then ≤ 4.8e-7 units in 5 s.
    5° / 15° (gravity tilted), friction off: −0.05 % / −0.11 %. 100 units/s, friction off, 10 s:
    energy +0.84 % (guard removed 4 % of the kinetic energy). Two runs: identical pose hashes.
  - Fixed root with ground: the pendulum above the floor is bit-identical to the run without a
    floor over 3 s; a loose link lands and rests 0.010 into the floor.
- **Known limit: native-cylinder creep at rest.** A wheel or cart resting on the half-space creeps
  sideways and yaws by ≈ 1e-5 units/s (solver noise in the friction rows; more with fewer
  substeps: 1e-2 units in 20 s at 30). A wheel whose tyre grips while the chassis creeps is turned
  against its axle's stiction, so for a free vehicle the 30 s example sweep cannot use the
  1e-4 rad "no jointed body turns" bound. `frictionExamples.ts` therefore checks, for a model with
  no fixed body only, that every joint's *relative* rotation after coming to rest is < 1e-3 rad
  (measured 3.9e-4 for the cart example) and the vehicle turns < 1e-3 rad and moves < 5e-3 units
  (measured 0.023°, 1.7e-3 units in 25 s). The old examples are checked exactly as before.
- **Cost** (ms of stepping per simulated second, best of 3 × 2 s, first 2 s of each run, loaded
  machine): pendulum 100, four-bar 285, crank wheel 161, cart example 507 (first layout; the
  final one measured 486 over 30 s); §5.3 cart at rest 396, rolling at 40 units/s 378, and the same
  model with no rims and no ground (chassis fixed) 278. In the app (headless Chromium, `stepSim`,
  wall clock around the stepping only) the crank wheel costs ≈ 130 and the cart ≈ 420 ms per
  simulated second — at ¼× the cart needs ≈ 100 ms of physics per real second.
- **Deviation: the grab spring presses into the ground with at most 2× the mechanism's weight**
  (`GRAB_PRESS_LIMIT`; lifting and sideways pulls keep the full M·100 g cap). Found by the
  integrator's owner-style session: in the default isometric view the grab plane is the view
  plane, so dragging a cart "along the floor" puts the target below the floor. Pressing the cart
  example's chassis toward a target 10 or 100 units below the floor for 2 s sank its pin-mounted
  wheels (light bodies, 5.5 each) **1.05 and 1.47 units** into the floor (they came back to 0.05–0.07
  units after release, resting on their guards); a cart with wheels welded to axles sank 0.12–0.30.
  With the limit: 0.07 (cart example) and 0.01 (welded) at either depth, ≤ 0.02 after release
  (`wheels.test.ts` "grabbing with a ground"). Limits 20 / 10 / 5 gave 0.37 / 0.19 / 0.14.
- **Known failure envelope** (what is known not to work, or not measured):
  - Pressing with the full grab force (before the limit above) pushed light wheels 1–1.5 units into
    the floor; any other sustained force of tens of g's on a light wheel body would do the same —
    the round collider's half-space contact is soft under large loads; the guard then holds it.
  - A wheel wobbling down onto its face sinks up to 0.17 units before the guard catches it.
  - Rolling sinks the round collider more the faster it rolls (≈ 0.08 units at 400 units/s), so
    the effective rolling radius shrinks slightly with speed.
  - Wheels rolling along beams: lossy by construction (32-gon hull), not a goal (§10).
  - Not measured: wheel hulls against pins and axles specifically; two moving wheels' round
    colliders against each other; wheels against parts under a sustained grab.
  - Contact creep of ≈ 1e-5 units/s at rest on the half-space (below).
  - The spike's soft-CCD fall-through did not reproduce, and its cause was not found.
- **Tests changed because the spec changed** (no expectation of an old example was altered):
  - `tests/kinematics/examples.test.ts`: the registry lists nine examples (was seven); new
    structure tests for examples 8 and 9.
  - `tests/physics/friction.test.ts`: the "bit for bit before joint friction" test loops over the
    seven examples that the recorded hashes cover; "switched to off" compares the two new examples
    with their own run created at μ = 0.
  - `tests/physics/frictionExamples.ts`: free-vehicle creep bound (above) and motion checks for
    examples 8–9; `tests/physics/examples.test.ts`: checks for examples 8–9.
  - `src/app` dropped its shim for a physics module without `groundY` / `setBodyVelocity` (and the
    test hook's `simInfo().groundFromSim`); `e2e/app-wheels` now asserts the drop and the cart
    instead of logging them as unverified.
  - `tests/core/wheels.test.ts` (core builder's): "rims change nothing else" grows rims on bare
    holes only (shrinking the crank wheel's 2.5 rim to 2 splits off its crank hole).
  - `tests/review/kinematics.review.test.ts`: "exactly one fixed body" becomes "one iff the root
    is fixed" (§3.1 step 4 as amended; the cart has none).

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

### Wheels, ground, free root (DESIGN §8 examples 8–9)

- **8 Crank wheel**: inverted-T upright in layer 0 (base y = −10, post up to the hub at (0, 0)); an
  r = 2.5 wheel in layer 1 on a smooth pin at (0, 0) with a crank hole at (2, 2) (joined to the
  hub by the disc only, §2.6 rule 1); a 7-hole link in layer 2 on a smooth pin in the crank hole.
  The crank starts 45° above horizontal. Realistic: the wheel sweeps 218° in the first 2 s and is
  at rest from 3.5–4 s at −133.6° (crank-down is −135°). Off: energy ≤ 1.00 % above its running
  minimum (the guard removes 8.5e3 in 30 s). The upright was first only 5 cells tall (base
  y = −5): the link, hanging crank-down, then reached y ≈ −9.3 and left the bottom of the view
  fitted at load (seen in the app screenshots). Only the frame changed (it is fixed and in another
  layer, so the motion is identical).
- **9 Cart**: ground on, root free. Two 9-hole beams (z 0 and 2) bridged at both ends, a post at
  x = 4 rising from the front beam to y = 7, four r = 1.5 wheels on their own axles (friction pin
  in the chassis + smooth pin in the hub), and a weighted arm in layer 1 (7-hole beam + a 3×3 block
  of holes at its end) on a smooth 2-cell pin at the post's top, starting horizontal. It swings
  clear of the ground (reach 6.7 from a pivot 8.5 above the nominal floor), the bridges and the
  wheels. Realistic (Node, every step): chassis x range 2.32 units in the first 4 s, at rest from
  ≈ 4 s, tilt ≤ 1.2e-3 rad, joint error < 1e-6, nothing removed; the app e2e (sampled every 0.1 s)
  sees 2.26 units of range and 13.9 units of back-and-forth travel in the first 2 s, wheels turning
  up to 52°, hubs ≤ 0.016 into the floor, and every part still to 5.3e-4 units over 25–30 s.
  The physics builder's layout (post to y = 6, 6-hole arm with a 2×2 block, arm mass 12.4) gave
  1.54 units of range: in the app screenshots the cart's motion against the floor's lines (since removed) was
  readable only side by side, so the arm was made longer and heavier (+50 % travel). Earlier, a
  3-cell pivot pin broke the review test "every pin joins two parts" and a lighter arm gave
  0.5 units.

## Fixes after the three adversarial reviews (wheels physics, wheels UI, Back side + ground shadow)

Each entry: what changed and why; the tests that pin it. Where an earlier entry above is
superseded, it says so here.

### §2–§4 Model, kinematics, geometry

- **Rule 1 vs the drawn rim** (`src/geometry/solid.ts` `rimBridges`). Rule 1 joins every cell the
  *nominal* disc overlaps, but the drawn rim is RIM_INSET (0.04) smaller, so a hole near the edge
  — (2, 3) of an r 3 wheel, (2, 4) of an r 4 — rendered as a ring floating beside the wheel (2
  shells). Now each such hole is bridged to its rim by a short web (2-D hull of a 0.36-radius circle
  at the cell and one inside the rim on the line to the hub, ±H thick; the bore is cut afterwards).
  The reviewer's sweep of 270 hub/crank solids: 270 single closed shells (was 262). Rule 1 itself
  is unchanged. Test: `tests/review/wheels-sim.review.test.ts` "FIXED … crank hole … fused".
- **Rim segments** (`src/geometry/dims.ts` `rimSegments`): about 40 per unit of radius (r 1: 48,
  r 1.5: 60, r 2.5: 100, r 4: 160; was 48 / 64), so a segment is ≈ 0.16 units at every radius —
  the r 1.5 tread read as a polygon at 4× the Home zoom.
- **A free pin that is the root** (`src/core/kinematics.ts`): stays its own (fixed) body only when
  the root is fixed. With a free root it is absorbed like any other free pin (was: 3 bodies and 2
  revolutes whose friction load was the pin's 0.527). Test: `tests/core/wheels.test.ts` "a free pin
  that is the root".
- **Rim error message**: a non-finite rim reads "(got Infinity)", not "(got null)".
- **Not changed (spec gap, documented)**: a wheel's mass counts the part's other cells that lie
  inside the disc a second time (§5.1 says overlap is ignored). A crank hole therefore shifts the
  centre of mass ≈ 0.1 units *toward* itself (a drilled real wheel shifts ≈ 0.04 away), and a
  pinned wheel with a crank hole hangs hole-down on its own; an r 2.5 rim in the middle of a 7-hole
  beam weighs 22.6 instead of ≈ 18.5. Plain wheels are exact (mass +0.05…0.3 %, I within 0.16 %).

### §5 Physics

- **Ground collider created first** (`Simulation` constructor: `buildGroundCollider` before
  `buildBodies`; the joint-friction sinks still come after the bodies). Rapier's contact with a
  half-space created *after* a body's collider drifts toward the half-space's origin like a bowl
  (reviewer's pure-Rapier repro `spikes/review-wheels/bowl7.test.ts`): a loose r 1.5 wheel 100
  units from the floor's pivot rolled 0.346 units in 20 s; now 1.6e-3 (the reviewer's spike
  patch; the suite's test asserts < 0.01). Changes trajectories of models with a ground only; the
  seven recorded hashes have none. Test: "FIXED … 100 units from the floor's pivot stays put".
- **Floor plane at a male's free end** (constructor): the plane was exact for hole cells (±HC)
  only; a pin or axle standing on end, or poking out below the lowest beam, reaches E_FREE = 0.48
  and started 0.02 inside the floor (a lone standing pin gained 11 energy units). The plane is now
  lowered to the lowest male collider point along −n (E_FREE·|n_a| + R_COLL_ROD·√(1 − n_a²) from
  its centre); it never rises, so every model whose lowest point is a hole or a rim keeps
  `groundY = groundLevel + 0.04` exactly. For a model standing on a male end, `sim.groundY` is
  0.02 below the edit-mode floor the view draws (invisible). Test: "FIXED … the lowest collider
  starts in exact contact".
- **Known failure envelope, additions** (with the review's numbers):
  - *A wheel lying across a beam that lies on the floor sinks into the beam.* The round collider
    holds the wheel on the half-space while the wheel's 32-gon hull gives way against the beam's
    edge (parry hull–hull contact; the same with the beam fixed and with soft CCD off; a 5×5 plate
    of holes rests correctly in the same place). Built in place, r 2.5 across a 15-hole beam 1
    unit off the hub: 0.37 units deep (of the beam's 0.46 half-width), hub at y 0.22, then at
    rest (speed 0 at 20 s), never through, nothing removed. Drops onto a loose beam on the floor
    (180 drops): 33 still embedded > 0.1 at 5 s, worst 0.45. Not fixed: it needs a different wheel
    hull (convex pieces with ≤ 4-vertex caps, or a native cylinder against parts) and a re-run of
    every wheel measurement; no special case was added. Test: "KNOWN LIMIT … sinks into the beam,
    then rests" asserts the envelope.
  - *A free linkage without wheels lying on the floor creeps*: a free 4-bar of beams on smooth pins
    moves 0.037 units between 10 and 20 s (friction off: the same), against 4e-5 for a loose beam
    and 5e-7 for the cart. It survived the two fixes above; it is contact creep of a jointed group
    on small contact patches (sleeping is off for determinism). Test: "KNOWN LIMIT … creeps
    slowly" asserts < 0.1 units in 10 s.
  - *Impacts of ordinary parts* dip deeper than earlier reported: up to 0.70 units for one or two
    steps (a 15-hole beam on end dropped 10 units, 157–280 units/s at impact; 13 of 189 drops
    > 0.3). Nothing passes through or is removed; resting sink ≤ 0.012.
  - The creep figure "≈ 1e-5 units/s at rest" above held only near the floor's pivot before the
    ground-first fix; "no wheel and no part passed through the other in any configuration" is
    true of the configurations measured, not of a wheel lying across a beam on the floor.
- **Spec gap, documented**: joint-friction loads are fixed at Play from the wheels within 0.05 of
  the floor then (§5.1 "Free root"). Wheels that touch down later carry no share (a cart with
  r 1.5 front and r 2.5 rear wheels: 6.17 on the front joints, 14.52 on the rear, instead of about
  a quarter each); the same for a vehicle set down slightly above the floor.

### §6 Rendering

- **Contact shadow: two lobes** (`src/view/shadowmath.ts`, `shadow.ts`, `floor.ts`; supersedes
  the "Constants" and "groundShadowAt" bullets of "Wheels, ground, free root" above). The owner's
  reviewer judged the single σ = 0.35 lobe "probably yes, but faintly": from the default isometric
  view the dark footprint lies under the part that casts it, and a beam lying on the floor showed
  only a 1-px halo. The same height field (1 − h/SHADOW_H)² is now blurred twice, into two
  channels of the texture: a *contact* lobe (σ = SHADOW_BLUR = 0.35, opacity SHADOW_CONTACT = 0.42)
  and a broad *ambient* lobe (σ = SHADOW_AMBIENT_BLUR = 0.9, opacity SHADOW_AMBIENT = 0.42; 16
  linear-sampled taps per side, each two texels, exactly the per-texel Gaussian to 4 units). The
  floor draws SHADOW_CONTACT·R + SHADOW_AMBIENT·G; strength 1 = SHADOW_MAX = 0.84 opacity under a
  wide surface on the floor. The margin grew to 5 units (4-unit reach + 1 edge fade). Tuned by eye
  on the Cart and the palette beams at Home (`e2e/fix-shadow-look.mjs`, `e2e/out/fix-sh-c-*.png`):
  the skirt now shows past each wheel and under the chassis; beams lying on the floor get a soft
  shade below them. Measured (`groundShadowAt`, 1 = 0.84 opacity): 0.634 under each Cart wheel's
  contact line (narrow footprint: the ambient lobe is partly spent; was 0.854 of 0.42 = 0.36
  opacity, now 0.53 opacity), 0.29 under a chassis beam, 0.14 between the beams; a beam lying on the
  floor 0.63 at its middle, 0 by h = 3. e2e `app-shadow` and `app-examples` compare against the
  two-lobe strip model; the review test's CPU truth (`tests/review/ux2.review.test.ts`) uses both
  lobes.
- **The floor over the grid**: when the floor lies above the grid's plane (y = −½, the usual case:
  the floor is 0.04 above the lowest part's −½), it is drawn after the grid, so the shadow darkens
  the grid lines under it instead of the lines diluting the shadow (renderOrder −90 vs −110).
- **Beyond the maximum frame** (`clusterWindow`): with casters spread over more than 128 units,
  the frame is no longer centred on the whole region (with two groups 130+ apart that covered
  only the empty gap: neither got a shadow). It is the 128-unit square holding the most caster
  footprint area (candidates centred on, or aligned with, each caster; the previous frame, then
  the one nearest it, wins ties, so equal groups never flip and a moving group is followed).
  What is outside still gets no shadow. Tests: `tests/view/shadow.test.ts`, e2e `app-shadow`.
- **WebGL context restore** redraws the shadow (`shadowDirty` on `webglcontextrestored`); the
  render targets lose their contents with the context. e2e `app-shadow` loses and restores the
  context (it failed without the fix: 0.634 → 0).
- **Overlay contrast** (`overlayColor`, `applyHalo` in `viewport.ts`): every hover line (face,
  erase cell, wheel band) now has a white under-stroke 3 px wider, and a face fill, ghost or band
  whose colour is within 0.3 (sRGB distance) of the part under the cursor switches to a
  contrasting variant — orange for the blue accent (over a blue wheel), a dark shade of the red.
  Back-side highlights and ghosts on the Cart's blue wheels and dark chassis were nearly
  invisible. Test: `tests/view/overlay.test.ts` (every palette colour ≥ 0.3 from its overlay).

### §7 Editor and application

- **Back side: a male inside another part's hole is buried in it** (`pickBack`; supersedes
  DESIGN §7.3's "including a male cell inside another part's hole" for this case). The pick
  treats the hole part's cubes and discs as part of the male's solid; an interval that ends in
  the host is no crossing of the male. So sweeping Alt along a beam with a pin through it no longer
  lands on the pin's side faces buried in the beam: the beam's far face is picked (the owner's
  "face under the cursor"). Unchanged: the shared-cell tie (both leave the same cube: the male only
  through an axial face within R_ROD of the axis), and a pin proud of the beam is still pickable
  where it sticks out. Tests: `tests/editor/backside.test.ts` (reference updated to the rule; "a
  pin through a hole" now expects the beam's far end along the beam), `e2e/review-ux2-ref.mjs`
  (the reviewer's marching reference, same rule).
- **A wheel's tread refuses the build tools** (front and Back side): DESIGN resolves a tread hit
  as the hub's lateral face, which built a cell buried inside the disc ≈ r below the cursor and,
  for Back side, highlighted a face not under the cursor. Now: no ghost, a red hint "Part 3 · wheel
  tread — point at the wheel's flat face or at a hole to build on a wheel" (with "· back side (±A)"
  for Back side). Select, Wheel, Erase and grab still act on the tread. Tests:
  `tests/editor/wheels.test.ts`, `tests/editor/backside.test.ts`.
- **Wheel tool on a crank hole**: a bare hole wholly inside a wheel of its own part (same layer,
  disc covers the cell) acts on that wheel's hub — it grew a hidden second disc on the crank hole.
  Erase still erases the crank hole (it is one of the part's own cells, §7.2). Test:
  `tests/editor/wheels.test.ts` "a bare crank hole inside its own wheel".
- **Inspector with a free root**: no "fixed root" badge; the button reads "Set as fixed root" and
  turns Fix root back on with this part as the root (one undo step).
- **Fit and Home avoid the side panel**: the right 234 CSS px (the always-visible Model block and
  the inspector) are treated as covered, and the fitted model is centred in the rest.
- **Out of view while simulating**: when no part's box meets the view, the hint says "The model is
  out of view · press F (Fit) to bring it back".
- **Small text fixes**: [R] with a non-build tool says "Orientation applies to the build tools …"
  (like N and B); G on an empty model says the floor appears under the first part; Fix root
  messages shortened; the disabled Fix root tooltip says when the model's own setting is off; the
  wheel hover info drops the size in mm (the Wheel hint keeps it), so the status bar fits at 1280.
- **Not changed**: the top bar clips Friction / Help / About at 1024 px wide (DESIGN requires
  1280 and up).

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
