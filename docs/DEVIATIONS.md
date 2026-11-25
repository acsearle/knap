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
