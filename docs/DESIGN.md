# knap — design specification

A browser-based 3D editor and rigid-body physics simulator for a Technic-like construction
system of liftarms, pins and axles. This is a **tool, not a game**: legible, precise, quiet.

> knap is an independent project. It is not affiliated with, endorsed by, or an official
> product of the LEGO Group. "LEGO" and "Technic" are trademarks of the LEGO Group. The UI
> must not use those names except in this disclaimer (README + About).

This document is the source of truth. Where it says **MUST** the behaviour is contractual and
is tested; where it says *suggested* the implementer may do better. If the spec turns out to be
wrong or impossible, fix the problem the sensible way and add a note to
`docs/DEVIATIONS.md` (what, why) — do not silently diverge.

---------------------------------------------------------------------------------------------

## 1. Conventions

- Length unit: **1 unit = 1 stud = 8 mm**.
- Right-handed, **+Y up**. Gravity is −Y, `g = 9.81 m/s² = 1226.25 units/s²`.
- Space is a cubic grid. Cell `(x,y,z)` (integers) is the cube `[x−½,x+½]×[y−½,y+½]×[z−½,z+½]`;
  its centre is the integer point.
- `Axis = 0 | 1 | 2` meaning X, Y, Z. Axes are undirected (a hole along +X is a hole along −X).
- A *face* of a cell is identified by a direction `Dir = 0..5` = `+X,−X,+Y,−Y,+Z,−Z`.

## 2. Model

### 2.1 Sub-parts (cells)

The only primitive is the **sub-part**: one cell containing exactly one of five kinds, with an axis.

| Kind          | Class  | Description                                             |
|---------------|--------|---------------------------------------------------------|
| `pinHole`     | hole   | round through-hole along `axis`                         |
| `axleHole`    | hole   | cross-shaped through-hole along `axis`                  |
| `axle`        | male   | 1-long segment of cross axle along `axis`               |
| `pin`         | male   | 1-long segment of smooth (frictionless) pin along `axis`|
| `frictionPin` | male   | 1-long segment of friction pin along `axis`             |

### 2.2 Parts

A **part** is a set of cells that forms one solid moulded piece: `{ id, color, cells[] }`.
Parts are explicit — two liftarms stacked face-to-face are two parts because the user made them
as two parts, not because of any geometric rule.

A part MUST satisfy:

1. No two of its cells share a grid position.
2. It is connected under the *in-part connection* relation below (a part with one cell is fine).

**In-part connection.** Two cells of the same part at adjacent positions (sharing the face with
normal direction `n`) are *connected* iff both present material on that face and the pairing
is mechanically meaningful:

- A **hole** presents material on all six faces: a *ring* on its two axial faces (normal ∥ axis)
  and a *wall* on its four lateral faces.
- A **male** presents material only on its two axial faces (its *ends*). Its sides present nothing.
- ring↔ring, ring↔wall, wall↔wall: connected. (hole–hole adjacency always connects.)
- end↔end: connected (both males have axis ∥ n, hence collinear).
- end↔wall: connected (a pin/axle growing perpendicularly out of the side of a hole).
- end↔ring: **not** connected (a rod ending on the mouth of a coaxial hole has nothing to attach to).
- anything involving a male side: not connected.

Equivalently:
- hole–hole: always.
- male–male: iff both axes are ∥ n.
- male–hole: iff male axis ∥ n and hole axis ⟂ n.

Within a part every adjacency that *can* connect *does* (connections are implicit, derived).
Adjacent cells of *different* parts never connect.

Examples: liftarm = row of `pinHole`s with a common axis perpendicular to the row. Axle = row
of `axle`s along their axis. Bush = single `axleHole`. Pin = 2–3 `pin`/`frictionPin` in a row.
Axle-pin = `axle`+`pin` in a row. Perpendicular connector = adjacent holes with different axes.
Tube = coaxial holes stacked along their axis. "Liftarm with pin" = hole with a male sticking out of its wall.

### 2.3 Parts sharing a cell (mates)

A grid position may be occupied by cells of at most two different parts, and only as one
**male + one hole** that are **coaxial** (same `axis`) and **compatible**. This is a *mate*:

| male \ hole   | `pinHole`                         | `axleHole`  |
|---------------|-----------------------------------|-------------|
| `axle`        | `cylindrical` (rotate + slide)    | `weld`      |
| `pin`         | `revolute` (rotate, no slide)     | *invalid*   |
| `frictionPin` | `weld` (for now — keep this in one named constant/table so it can later become revolute-with-friction) | *invalid* |

Everything else sharing a position is invalid (two males, two holes, non-coaxial, incompatible,
or male+hole of the *same* part).

### 2.4 Model

```ts
type Axis = 0 | 1 | 2;
type Kind = 'pinHole' | 'axleHole' | 'axle' | 'pin' | 'frictionPin';
interface Cell { x: number; y: number; z: number; kind: Kind; axis: Axis }
interface Part { id: number; color: string /* '#rrggbb' */; cells: Cell[] }
interface Model { version: 1; parts: Part[]; rootPartId: number | null; nextPartId: number }
```

`rootPartId` designates the part fixed in space during simulation. If it is `null` or stale, the
part with the lowest id is the root. The model is plain JSON (this is also the file format,
`.knap.json`). Core operations are **pure functions** returning a new `Model` (structural sharing
is fine); undo/redo is a stack of models.

### 2.5 Core operations (module `src/core`)

All in pure TypeScript, no DOM / three / rapier / manifold imports. Unit-tested in Node.

```ts
// rules.ts
isMale(kind): boolean; isHole(kind): boolean
DIRS: readonly [x,y,z][]            // 6 unit vectors, index = Dir
axisOfDir(dir): Axis
connects(a: Cell, b: Cell): boolean // in-part connection; false if not face-adjacent
mateType(male: Kind, hole: Kind): 'weld' | 'revolute' | 'cylindrical' | null

// model.ts
emptyModel(): Model
validateModel(m): ValidationError[]         // [] when valid; checks 2.2 and 2.3
canAddCell(m, partId: number | null, cell): { ok: true } | { ok: false; reason: string }
     // partId null => the cell would start a new part.
     // For an existing part: position free within the part, >=1 connection to the part,
     // and world occupancy at that position compatible per 2.3.
addCell(m, partId, cell): Model             // throws if !canAddCell
addPart(m, cells, color?): { model: Model; partId: number }   // validates
removeCell(m, partId, pos): Model           // if the part falls apart, split it into several parts
                                            // (largest keeps the id; root follows the piece that keeps the id)
removePart(m, partId): Model
movePart(m, partId, delta: [dx,dy,dz]): Model | null          // null if result invalid
rotatePart(m, partId, axis: Axis, quarterTurns: number, pivot: [x,y,z]): Model | null
setPartColor, setRoot
serialize(m): string; deserialize(json): Model   // deserialize validates and throws a useful error
```

A `WorldIndex` (position → cells with part ids) helper is expected; rebuild it per call or cache
by model identity — models are small (≤ a few thousand cells).

---------------------------------------------------------------------------------------------

## 3. Kinematic analysis (`src/core/kinematics.ts`)

`analyze(model) → KinematicGraph` turns parts + mates into rigid bodies + joints. Pure function.
This is the heart of the simulator's correctness; the physics layer is a thin mapping of its output.

```ts
interface Mate { pos: [x,y,z]; axis: Axis; malePart: number; holePart: number;
                 type: 'weld' | 'revolute' | 'cylindrical' }
interface Body { id: number; partIds: number[]; fixed: boolean }
interface Joint {
  bodyA: number; bodyB: number;
  type: 'revolute' | 'cylindrical' | 'prismatic';
  origin: [number, number, number];   // a point on the joint axis (a mate cell centre), world, t=0
  axis: Axis;
  // cylindrical / prismatic only: allowed displacement of body B relative to body A along +axis,
  // in units. limits[0] <= 0 <= limits[1].
  limits?: [number, number];
}
interface KinematicGraph { mates: Mate[]; bodies: Body[]; joints: Joint[];
                           bodyOfPart: Map<number, number> }
```

### 3.1 Algorithm

1. Enumerate all mates (positions holding a male and a hole of different parts).
2. Union-find over parts. Union across every `weld` mate.
3. Repeat until nothing changes:
   1. **Absorb free pins.** A body that (a) consists of exactly one part, (b) whose cells are all
      male and collinear on a single line, (c) has at least one mate to another body, and
      (d) all of whose mates to other bodies are `revolute` — is merged into one of the bodies it
      mates with (prefer the body containing the root; else the one with most cells; else lowest
      part id). Rationale: a loose smooth pin's own spin is irrelevant, and removing the tiny
      intermediate body makes two liftarms joined by a pin a *direct* revolute pair.
   2. **Pairwise reduction.** Group the non-weld mates between each unordered pair of distinct
      bodies (A, B). Let *lines* be the distinct axis lines (direction + position) of those mates.
      - One line: if any mate on it is `revolute` → **revolute** joint. Otherwise (all
        `cylindrical`) compute slide limits (3.2); if the limits are `[0,0]` → **revolute**,
        else **cylindrical** with those limits.
      - Two or more lines, all parallel, and every mate `cylindrical` → **prismatic** along
        that direction with limits (3.2); if the limits are `[0,0]` → the pair is rigid: **union A and B**.
      - Otherwise (two or more lines, any revolute or any non-parallel) → rigid: **union A and B**.
4. Bodies = final union-find classes. `fixed` = contains the root part. Joints as determined in
   the last iteration, one per body pair. Body ids are dense `0..n−1`, deterministic (ordered by
   lowest part id). `bodyA` is the lower body id. Output is deterministic for a given model.

Redundant-but-consistent loops (triangles, 4-bars) are left to the solver.

### 3.2 Slide limits

For a body pair (A, B), direction `d = +axis`, shift `s` (integer): imagine B translated by
`s·d` relative to A.

- **Cylindrical (single line L):** consider only cells of A and B that lie on L (this is
  rotation-invariant — an on-axis bush blocks at any angle, an off-axis obstacle does not count).
  A shift is *legal* iff (i) at every position on L where both bodies then have a cell, the pair
  is a `cylindrical` mate (an `axle` in a coaxial `pinHole`) — any other overlap is a block —
  and (ii) at least one such mate remains (the axle never fully leaves the holes).
- **Prismatic:** bodies cannot rotate relative to each other, so test the full cell sets: legal
  iff every position where both bodies have a cell is a `cylindrical` mate along `d`, and at
  least one such mate remains on each of at least two distinct lines.

`limits = [−n₋, +n₊]` where `n₊` is the largest `n ≥ 0` such that all shifts `1..n` are legal
(likewise `n₋`). Both are finite because of the engagement requirement.

So: an axle through a liftarm with a bush hard against each side → `[0,0]` → revolute. A bush on
one side only → one-sided slide. No bushes → slides until one cell remains engaged.

### 3.3 Required test cases (unit tests, exact expectations)

- Two liftarms + one 2-long smooth pin → 2 bodies, 1 revolute, pin absorbed.
- Two liftarms + two smooth pins at different holes → 1 body, 0 joints.
- Two liftarms + one friction pin → 1 body.
- Triple pendulum (root + 3 links, smooth pins) → 4 bodies, 3 revolute.
- Four-bar (ground + 3 links, 4 smooth pins) → 4 bodies, 4 revolute, exactly 1 fixed.
- Axle through one `pinHole`, nothing else → 2 bodies, cylindrical, limits by engagement.
- Same with a bush (`axleHole`) welded on the axle touching one side → one limit is 0.
- Bushes touching both sides → revolute.
- Axle through `axleHole` of one liftarm and `pinHole` of another → 2 bodies (axle welded to the
  first), revolute or cylindrical between them depending on stops.
- Two parallel axles each through `pinHole`s of the same two bodies' … → prismatic.
- Two perpendicular mates between the same pair → 1 body.
- Determinism: shuffling part order / cell order does not change the partition or joint set.

---------------------------------------------------------------------------------------------

## 4. Geometry (`src/geometry`)

Appearance goal: the *functional surfaces* of parts, nothing else — no plastic-saving cut-outs,
no logos, no counterbores, no studs. A liftarm is a stadium-shaped slab with round holes. Adjacent
connected cells of a part are fused by a sensible envelope, like real parts.

### 4.1 Dimensions (units = studs) — `src/geometry/dims.ts`

| Name    | Value  | Meaning                                                            |
|---------|--------|--------------------------------------------------------------------|
| `H`     | 0.47   | half-size of a cell's solid core: barrel outer radius *and* half-thickness |
| `R_BORE`| 0.31   | pin-hole bore radius (also tip radius of the cross bore)           |
| `W_BORE`| 0.125  | half-width of each arm of the cross bore                           |
| `R_ROD` | 0.295  | pin radius; axle tip radius                                        |
| `W_ROD` | 0.11   | half-width of each axle arm                                        |
| `E_FREE`| 0.48   | half-length of a male cell at a free (unconnected) end             |
| `EPS`   | 0.005  | overlap added so touching positives fuse robustly                  |

Because `H < ½`, different parts sitting in adjacent cells show a visible 0.06 gap. Connected
cells of the same part are bridged across the gap.

### 4.2 Part solid

Built with real CSG using **manifold-3d** (WASM; works in Node and browser):
`solid(part) = ⋃ positives − ⋃ bores`.

Per **hole** cell with axis `h` (local coords relative to the cell centre):
- *Barrel*: cylinder radius `H` along `h`, extent `[−H, +H]`, extended to `±(½+EPS)` on each
  axial side that has an in-part connection.
- *Web*, for each lateral face `n` with an in-part connection: a box from the cell centre to the
  face (`[0, ½+EPS]` along `n`), `[−H, +H]` in the two transverse directions. Two parallel-axis
  holes side by side therefore fuse into a stadium; holes of differing axes fuse through a
  square neck; a male end lands on a square boss.
- *Sliver fill*: in each transverse direction `t`, a web's extent grows from `±H` to `±½` on
  the side where the four cells around that cube edge (this cell, `+n`, `+t`, `+n+t`) are all
  hole cells of this part. Likewise the barrel. (So a 2×2 block of parallel holes has no pin-prick
  gap in its middle, and a double-thick beam made as one part has no slit between layers.)
- *Bore*: `pinHole` → cylinder radius `R_BORE`; `axleHole` → cross prism = (box `±W_BORE × ±R_BORE`
  ∪ its 90° rotation) ∩ cylinder `R_BORE`. Along `h` the bore spans the whole cell `[−½, +½]`,
  overshooting by `2·EPS` on a side unless the in-part neighbour there is a hole with a
  *different* axis (then the bore stops at the face: a blind hole against that neighbour's wall).

Per **male** cell with axis `a`: a rod along `a` — `pin`/`frictionPin`: cylinder radius `R_ROD`;
`axle`: cross = (box `±W_ROD × ±R_ROD` ∪ rotation) ∩ cylinder `R_ROD`. Extent `±E_FREE`,
extended to `±(½+EPS)` on connected ends. *Suggested*: `frictionPin` gets four shallow
longitudinal ridges so it is distinguishable from `pin` even when recoloured; a small chamfer on
free rod ends.

Bores are subtracted after all positives are united, so a bore always cuts cleanly through its
own cell.

Output (`buildPartMesh(part) → MeshData`): indexed triangles in **part-local coordinates**
(world minus an integer `origin`, e.g. the part's min corner) so identical parts can share cached
geometry; vertex normals smooth across curved surfaces and split at creases (crease angle ≈ 35°).
Cylinders use ≥ 48 segments. The mesh MUST be a closed manifold with volume within 1% of the
analytic value for simple cases (single hole cell, single pin cell, 2-hole stadium, …).

Geometry is rebuilt only for parts whose cells changed; cache by a translation-normalised
signature of the part's cells.

### 4.3 Collision primitives (`partColliders(part) → ColliderPrim[]`, pure, no WASM)

Physics does **not** use the render mesh. Each part yields a compound of primitives in the same
part-local frame:

- hole cell → cylinder radius `HC = 0.46`, half-length `HC`, along its axis (extended to ½ on
  axially connected sides); plus for each connected lateral face a box from centre to face with
  half-extents `HC` transversally. Holes are solid for collision purposes.
- male cell → cylinder radius `0.29` along its axis, same extents as the visual rod.

```ts
type ColliderPrim =
  | { shape: 'cylinder'; center: Vec3; axis: Axis; radius: number; halfLength: number; cell: number; male: boolean }
  | { shape: 'box'; center: Vec3; halfExtents: Vec3; cell: number; male: false };
```

`HC < H` gives stacked liftarms a little real clearance so neighbouring layers do not rub.

---------------------------------------------------------------------------------------------

## 5. Physics (`src/physics`)

Engine: **Rapier** (`@dimforge/rapier3d-compat`, Rust→WASM, actively maintained; runs in Node
for headless tests). Chosen over ammo.js (stale Bullet port), cannon-es (weak joints, unmaintained)
and Jolt (excellent solver but a heavier, manual-memory API); noted in the README.

### 5.1 Mapping

- One rigid body per `Body`; `fixed` bodies are `RigidBodyDesc.fixed()`, others dynamic.
  Body frames coincide with the world frame at t=0 (translation 0, identity rotation) or the
  part-local origin — implementer's choice, but the render transform of each part during
  simulation MUST be exact (`T_body(t) · T_body(0)⁻¹` applied to the edit-time placement).
- Colliders from `partColliders` for every part of the body. Uniform density; mass realism is a
  non-goal but relative masses should scale with size. Friction ≈ 0.4, restitution ≈ 0.1.
- Joints from `Joint`:
  - `revolute` → revolute joint about the axis through `origin`.
  - `prismatic` → prismatic joint with limits.
  - `cylindrical` → rotation + translation about/along one axis with translation limits
    (Rapier: generic joint with all axes locked except linear-X and angular-X of a joint frame
    whose X is the joint axis; limits on the free linear axis. Verify the exact JS API against
    the installed package's `.d.ts`; if limits on generic joints are not reachable from JS, find
    another exact construction and document it in DEVIATIONS.md).
- **Contacts between two bodies that share a joint are disabled** (`contactsEnabled = false`).
  Rationale: a rod inside a hole necessarily overlaps the (solid) hole collider, and contact
  between pin-jointed neighbours would fight the joint. Slide stops come from joint limits
  (§3.2), not contacts. All other body pairs collide normally.
- Gravity `(0, −1226.25, 0)`. Real scale means real speed: a 4 cm pendulum has a ~0.4 s period.
  Use a small fixed step (suggested 1/480 s or finer; tune `lengthUnit`, solver iterations) with
  an accumulator; the UI offers playback speed 1×, ½×, ¼×, ⅒× (default **¼×** so motion is
  readable). Cap sub-steps per frame to avoid the spiral of death.
- No ground. A dynamic body that falls below `y = −400` is removed from the world (and hidden).
- No damping by default (a tiny angular damping constant is acceptable if needed for stability;
  state its value in the README).

### 5.2 API

```ts
class Simulation {
  static async create(model: Model, opts?): Promise<Simulation>   // analyze + build world
  step(dtReal: number): void             // advances by dtReal × speed using fixed sub-steps
  stepFixed(n?: number): void            // exactly n fixed sub-steps (tests, "step" button)
  readonly time: number
  bodyTransform(bodyId): { p: Vec3; q: Quat } | null  // null once removed
  partTransform(partId): { p: Vec3; q: Quat } | null  // transform to apply to the part's edit-time world placement
  readonly graph: KinematicGraph
  // interaction
  grab(bodyId, worldPoint): void; dragTo(worldPoint): void; release(): void   // spring pull on a dynamic body
  // diagnostics
  energy(): { kinetic: number; potential: number }
  jointError(): number                   // max anchor separation over all joints, in units
  dispose(): void
}
```

### 5.3 Required headless tests (vitest, Node)

- **Pendulum period**: fixed root + one 5-hole link on a smooth pin, released from a small angle:
  measured period within 3% of the physical-pendulum value `2π√(I_pivot /(m g d))` computed from
  the engine's own mass properties.
- **Triple pendulum** released horizontal: runs 10 simulated seconds with no NaN, joint error
  < 0.02, total energy never rises more than 2% above its initial value and does not lose
  more than 10%.
- **Four-bar**: runs 10 s, joint error < 0.02 throughout, the mechanism actually moves (crank
  angle range > 20°) and, having 1 DOF, the three link poses are consistent with loop closure.
- **Axle slide stop**: vertical axle with a bush two cells above a fixed liftarm drops, stops with
  the bush on the liftarm (displacement = 2 ± 0.03), stays there.
- **Collision**: a free part dropped onto a fixed, un-jointed part comes to rest on / deflects off
  it and never tunnels through.
- **Welds**: a two-pin-connected pair behaves as one rigid body (relative pose constant to 1e-6).

---------------------------------------------------------------------------------------------

## 6. Rendering & camera (`src/view`)

three.js (WebGL2 renderer), TypeScript.

### 6.1 Look

Like printed building instructions: clean flat-ish colour, smooth lit curves, dark outlines.

- **Orthographic** camera only.
- Light background (near-white). No shadows, no environment maps, no gloss. Lambert-like shading
  from a key light fixed to the camera (headlight, slightly up-left) + generous ambient/hemisphere
  so no face goes dark. Curved surfaces must read as curved (smooth normals).
- **Outlines**: uniform dark lines (~1.25 CSS px, DPR-aware, anti-aliased) on silhouettes,
  creases, and boundaries between different parts. *Suggested technique*: post-process edge
  detection over depth + view-normal + part-id buffers (handles unions and curved silhouettes with
  no per-mesh edge bookkeeping). Lines must be stable under orbit (no shimmering/flicker at
  typical zooms) and must not speckle on smooth curved surfaces or in hole interiors.
- Part colours from a small palette of solid colours. Darkest palette colour is dark grey, not
  black, so outlines stay visible. Default colours for new parts by first cell: holes → current
  palette colour; `axle` → light grey; `pin` → tan/light grey; `frictionPin` → blue.
- Edit mode shows a faint reference grid on the plane `y = −½` (cell boundaries) with slightly
  stronger axis lines; hidden while simulating (there is no ground).
- The root part carries a small unobtrusive "fixed" marker (e.g. an anchor glyph label or ground hatch).

### 6.2 Camera & navigation

- Turntable orbit about a pivot with world +Y up: **left-drag** orbit (a press that moves < 4 px
  is a click, not a drag), **right-drag / middle-drag / Shift+left-drag** pan, **wheel** zoom
  toward the cursor. Trackpad pinch works. Pitch clamps at ±90°.
- **View widget (prominent, top-right):** a view cube with labelled faces (FRONT, BACK, LEFT,
  RIGHT, TOP, BOTTOM) that rotates with the camera. Clicking a face snaps (animated ≈ 250 ms) to
  that orthographic view; clicking a corner snaps to that isometric view; clicking an edge to the
  corresponding 45° view. Hover highlight on the cube. Beside it: **Home** (default isometric +
  fit all) and **Fit** (frame the selection, else everything; also re-centres the orbit pivot).
  Keys: `F` fit, `Home` home.
- Default view: isometric from (+X, +Y, +Z), fitted.

---------------------------------------------------------------------------------------------

## 7. Editor (`src/editor`, `src/ui`)

### 7.1 Modes

- **Edit** (physics off): model can be changed.
- **Simulate** (physics on): model is frozen; editing tools disabled and visibly so. **Stop**
  returns to exactly the pre-simulation model and camera stays put. Pause / single-step /
  speed control. In simulate mode, left-dragging on a dynamic body grabs it with a spring
  (to poke mechanisms); dragging empty space orbits.

### 7.2 Tools

Left toolbar; keyboard shortcut in brackets.

- **Select** `[V]` / `Esc`: click a part to select it (clear highlight outline). Click empty space
  to deselect. With a selection: `Delete`/`Backspace` removes the part; arrow keys move it one cell
  along the screen-aligned grid axes, `PageUp/PageDown` along the remaining axis (rejected with a
  brief status message if the result is invalid); `[`/`]` rotate it 90° about the axis most
  aligned with the view direction, pivoting on the part's first cell; inspector panel shows
  id, cell count, colour swatches, **Set as fixed root**, **Duplicate** (offset copy, if cheap).
- **Build** — one tool per kind: Pin hole `[1]`, Axle hole `[2]`, Axle `[3]`, Pin `[4]`,
  Friction pin `[5]`.
- **Erase** `[E]`: click a cell to remove that sub-part (hovered cell highlighted red). Parts
  split if they fall apart.

### 7.3 Build interaction

Picking is against **cell bounding cubes** (not the detailed mesh): the hover target is
(part, cell, face). A translucent **ghost** of the sub-part that a click would create is shown,
with a face highlight; invalid placements are shown red with the reason in the status bar.

For hover (cell `C` of part `P`, face normal `n`) the click does the first *valid* of:

1. **Extend** — add a cell to `P` at `C + n` (the new sub-part becomes part of the clicked part).
2. **Insert** — (male tool, `C` is a compatible hole with no male in it, and `n` ∥ hole axis)
   start a **new part** with a male cell *at `C`* coaxial with the hole — a pin pushed into the hole.
3. **Sleeve** — (hole tool, `C` is a compatible male with no hole around it) start a **new part**
   with a hole cell *at `C`* coaxial with the rod — a beam slid onto the pin.

With **Shift** held (or the "New part" toggle `[N]` on) the order is: Insert, Sleeve, then
**New adjacent** — a new unconnected part at `C + n`. Hovering empty space over the reference
grid offers **New on grid** — a new part at that grid cell with `y = 0` (this is how the first part is placed).

Orientation of the ghost: default is the most natural valid one — male tools: along `n` (or the
hole axis when inserting); hole tools: the clicked cell's axis if it is a hole and that is valid,
otherwise the first valid axis; if the target cell already holds a compatible cell of another
part, prefer the coaxial orientation. `[R]` cycles through the other valid orientations (the
choice persists while the same tool is active). The status bar always says what a click will do
("Extend part 3 · pin hole ∥ Z", "New part · insert pin", …).

New parts take the current palette colour (or the kind default, §6.1).

### 7.4 Other

- Undo / redo (`⌘/Ctrl+Z`, `⇧⌘Z` / `Ctrl+Y`), unlimited within the session.
- File: **New**, **Open…** (`.knap.json`), **Save** (download), autosave to `localStorage` and
  restore on load. **Examples** menu (§8).
- **Show kinematics** toggle (edit mode): tints parts by rigid body and draws a small glyph on
  each joint axis (ring = revolute, ring + double arrow = cylindrical, double arrow = prismatic),
  so the user can see what welded and what moves before pressing play. Status bar shows counts:
  parts, bodies, joints.
- Status bar: hover info, action hint, last error. Keep the chrome compact and neutral.
- UI is plain DOM + CSS (no framework). Works at 1280×720 and up; DPR-aware.

### 7.5 Test hook

`window.__knap` exposes a small debug API for automated tests: `getModel()`, `setModel(m)`,
`loadExample(name)`, `analyze()` (summary), `setMode('edit'|'simulate')`, `stepSim(n)`,
`setView(name)`, `fit()`, `partScreenPos(partId)`, `simTransforms()`.

---------------------------------------------------------------------------------------------

## 8. Built-in examples (`src/core/examples.ts`)

Constructed programmatically with the core API (so they double as fixtures for tests). All use
smooth `pin`s for moving joints.

1. **Pendulum** — fixed 3-hole beam, one 5-hole link hanging from a pin.
2. **Triple pendulum** — fixed beam + links of 5, 4, 3 holes joined end to end, starting
   horizontal, alternating layers so links pass each other.
3. **Four-bar linkage** — ground beam (root), crank, coupler, rocker on four smooth pins; not a
   parallelogram (e.g. crank 2 up from `(0,0)`, coupler 4 across, an L-shaped rocker down and over
   to a ground pivot at `(6,0)`); starts out of equilibrium so it swings when played.
4. **Parallelogram linkage** — the rectangle four-bar.
5. **Sliding axle** — vertical axle through a fixed beam's hole with a bush above (drops and
   stops) and a second axle captured between two bushes (spins only), each carrying a small
   off-centre arm so the rotation is visible.
6. **Weld test** — two beams joined by two pins (rigid) hanging as one pendulum from a third.
7. **Collision** — a double pendulum whose lower link strikes a peg on the fixed frame, plus a
   loose part that falls onto the frame.

---------------------------------------------------------------------------------------------

## 9. Project layout & tooling

```
src/core/       types.ts rules.ts model.ts kinematics.ts examples.ts      (pure)
src/geometry/   dims.ts solid.ts colliders.ts
src/physics/    sim.ts
src/view/       scene/renderer, outline pass, camera controls, view cube, part meshes
src/editor/     tools, picking, ghost, history
src/ui/         toolbar, inspector, status bar, menus, styles
src/main.ts     wiring
tests/          vitest unit + headless physics tests
e2e/            Playwright smoke + screenshot scripts (screenshots written to e2e/out/, git-ignored)
```

- TypeScript `strict`. Vite (a major compatible with **Node 20.11**), vitest, three,
  `@dimforge/rapier3d-compat`, `manifold-3d`, Playwright (dev only).
- `npm run dev`, `npm run build`, `npm test` (vitest run), `npm run typecheck` (tsc --noEmit),
  `npm run e2e` (Playwright against the dev/preview server).
- No network at runtime; all assets (WASM included) bundled.

## 10. Explicit non-goals (for now)

Gears, racks, half-unit offsets, studs, flexible parts, friction-pin friction, motors, an official
part catalogue, decomposition into official parts, collisions between directly-jointed bodies
(may come later as an experimental option), mobile/touch UI.
