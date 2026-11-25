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
- **Back side** (§7.3). `farSidePick(model, pick)` maps the hover to the far side (only the picked
  part's own cells are walked, so a pin in a hole walks along the pin and the beam along the beam);
  `resolveBuild` does this itself when `state.backSide` is set and appends " · back side (−Z)"
  before " — reason". `ToolState.backSide` is the [B] toggle; Alt/Option is applied per event by
  `withModifiers(s, { shift, alt })` (`altHeld`, never latches, like `shiftHeld`); `withShift` is
  kept as `withModifiers(s, { shift })`. Like New part, the toggle survives tool changes and is
  ignored (its button disabled) for Select / Erase. The Shift hint of a back-side proposal is the far
  side's with the same " · back side (−Z)" suffix, i.e. exactly what a Shift + Back side click does
  (the hint is only ever a valid alternative, so there is no " — reason" to insert before).
- **Autosave.** An unreadable autosave is moved to `knap.autosave.v1.corrupt`, so it is neither
  lost nor retried on every load. An autosaved empty model restores as "nothing".

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
  left to the browser. The hint line adds "Alt: back side" while a part is hovered with a
  build tool and Back side is off; it still fits at 1280×720 (`e2e/app-ui`).
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
