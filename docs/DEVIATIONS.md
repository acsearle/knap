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
- **Autosave.** An unreadable autosave is moved to `knap.autosave.v1.corrupt`, so it is neither
  lost nor retried on every load. An autosaved empty model restores as "nothing".

## §7 Application (`src/app`, `src/ui`)

- **New / Open / Examples are undoable.** They push the new model onto the history instead of
  resetting it (`History.reset` is not used), so an accidental New or Open is one `Ctrl/⌘+Z` away.
  §7.4 only asks for undo of model changes; there is no "unsaved changes" confirm dialog.
- **Simulate mode freezes editing by disabling, not by stopping.** Tools, palette, New / Open /
  Examples, Undo / Redo and the inspector's buttons are disabled and greyed; editing keys and
  `⌘/Ctrl+Z` show "Stop the simulation to edit (Esc)"; clicks in the view edit nothing. Save,
  Show kinematics, speed and the camera stay available. Stop keeps the selection (the model is
  the same object, so it is still valid) and does not touch the camera.
- **Pause turns the frame loop off.** While paused nothing renders continuously (the view
  renders on demand); Step (`.`) advances 1/60 s = 8 fixed steps. Step in edit mode starts the
  simulation paused.
- **"Can't keep up"** is shown when `Simulation.step` dropped steps (its per-call cap) *or* when
  frames arrive more than 10 ms later than the viewport's clamped dt (the page cannot draw fast
  enough), held for 1.2 s. It sits over the view next to the SIMULATING badge so the top bar
  never changes width.
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
- **Clicks belong to the mode of their press.** A press made while simulating and released after
  Stop (Esc) is not an edit-mode click (it used to build a part).
- **Start-up view.** The viewport is created detached (1×1 px); the app measures it once it is in
  the page and then fits Home, so the start-up view equals Home (it was ≈ 30 % looser).
- **Input while the simulation starts.** Play first builds the physics world asynchronously (mode
  `starting`, tens of ms on a cold first Play). Stop / Esc in that window cancels the start (back
  to edit, "Simulation cancelled"); a speed picked then is applied to the new simulation; a Step
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
  - No damping and no sleeping (`setCanSleep(false)`). The energy guard (§5 "Free rotation gains
    speed") only trims energy a group has gained beyond 1 % of its peak kinetic energy.
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
    - This is a correction, not damping: §5.1 asks for no damping by default and the guard does
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
