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
interface Cell { x: number; y: number; z: number; kind: Kind; axis: Axis;
                 rim?: number }      // wheel radius, §2.6; hole cells only
interface Part { id: number; color: string /* '#rrggbb' */; cells: Cell[] }
interface Model { version: 1 | 2; parts: Part[]; rootPartId: number | null; nextPartId: number;
                  ground?: boolean;   // §2.6; absent = false
                  fixRoot?: boolean } // §2.6; absent = true
```

`version` is 2 as soon as a model uses `rim`, `ground` or `fixRoot` (the operations that set them
set it) and is otherwise left alone; version 1 files load unchanged and a model that uses none of
the three behaves exactly as before.

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
canRemoveCell(m, partId, pos): { ok: true } | { ok: false; reason: string }
removeCell(m, partId, pos): Model           // throws if !canRemoveCell (e.g. a piece's rim would then
                                            // overlap another part); if the part falls apart, split it into several parts
                                            // (largest keeps the id; root follows the piece that keeps the id)
removePart(m, partId): Model
movePart(m, partId, delta: [dx,dy,dz]): Model | null          // null if result invalid
rotatePart(m, partId, axis: Axis, quarterTurns: number, pivot: [x,y,z]): Model | null
setPartColor, setRoot
serialize(m): string; deserialize(json): Model   // deserialize validates and throws a useful error

// wheels, ground (§2.6)
RIM_MIN = 1, RIM_MAX = 4, RIM_STEP = 0.5
canSetRim(m, partId, pos, rim: number | undefined): { ok: true } | { ok: false; reason: string }
setRim(m, partId, pos, rim | undefined): Model    // undefined removes the rim; may split the part
setGround(m, on): Model; setFixRoot(m, on): Model
rootIsFixed(m): boolean                           // fixRoot !== false || !ground
groundLevel(m): number | null                     // null when ground is off or the model is empty
// disc.ts — exact overlap tests (integer / half-integer arithmetic, no epsilons)
discOverlapsCell(hub, axis, r, pos): boolean; discCoversCell(hub, axis, r, pos): boolean
discsOverlap(hubA, axisA, rA, hubB, axisB, rB): boolean
```

A `WorldIndex` (position → cells with part ids) helper is expected; rebuild it per call or cache
by model identity — models are small (≤ a few thousand cells).

### 2.6 Wheels, ground and a free root

Added after user request ("plain wheels with simple colliders … grow them out from the 1×1×1
pin-hole or axle-hole parts by adding and erasing half-units of material at the outer radius").
The numbers come from a feasibility spike (`spikes/wheels/`, Rapier 0.21).

**Rim.** A hole cell (`pinHole` or `axleHole`) may carry `rim = r`: a solid disc of radius `r`
about the cell's axis, one cell thick (the cell's own layer). `r` is a multiple of ½ with
`1 ≤ r ≤ 4`; absent means a bare cell (whose barrel is the "radius ½" wheel). The cell is the
wheel's **hub**. A part may have any number of rims and any other cells: a wheel is just a part.
Male cells never carry a rim. Toothed rims (gears, `16·r` teeth) are a later feature and will
reuse this field.

**Disc geometry for the rules** (nominal, exact): the disc occupies, in the hub's layer, the
points within distance `r` of the hub axis. A grid cell is a closed unit cube. *Overlap* means an
intersection of positive volume; touching does not count.
- disc × cell: only in the same layer; with in-plane offsets `(du, dv)` from the hub,
  overlap iff `max(0,|du|−½)² + max(0,|dv|−½)² < r²`; the disc *covers* the cell iff
  `(|du|+½)² + (|dv|+½)² ≤ r²`.
- disc × disc, parallel axes: overlap iff same layer and centre distance `< r₁ + r₂`
  (equal is touching — the distance at which gears will mesh).
- disc × disc, perpendicular axes `a`, `b`, third axis `k`: with `m_b = max(0,|d_b|−½)²`,
  `m_a = max(0,|d_a|−½)²`: overlap iff `m_b < r₁²`, `m_a < r₂²` and
  `|d_k| < √(r₁²−m_b) + √(r₂²−m_a)` (compare squared so it stays exact).
A reference implementation with tests is in `spikes/wheels/disc.ts`; move it into `src/core`.

**Rules added to §2.2 and §2.3.**
1. *Connection.* A rim connects its hub to every cell of the same part that its disc overlaps
   (as well as the ordinary face connections), so a crank hole at `(1,1)` of an `r = 2.5` wheel
   belongs to the wheel without a bridge of cells. Two overlapping discs of the same part
   connect their hubs likewise. Shrinking or removing a rim can therefore split a part, exactly
   like erasing a cell.
2. *Blocking.* A disc must not overlap any cell of **another** part, and must not overlap a disc
   of another part. The one exception is the ordinary mate: a male cell of another part inside a
   hole cell of the wheel's part (its hub or a crank hole). Discs and cells of the *same* part may
   overlap freely (they fuse). `validateModel`, `canAddCell`, `movePart`, `rotatePart` and
   `canSetRim` all enforce this; reasons read "inside the wheel of part N" / "wheel would hit
   part N" / "wheels would overlap".
3. A rim moves and rotates with its cell (`rotatePart` turns the disc with the cell's axis).

Rims do not take part in the kinematic analysis (§3): they add no mates and no slide stops. What
a turning wheel hits is left to collisions.

**Ground.** `ground: true` puts a horizontal floor under the model. Its nominal level is
`groundLevel(m)` = the lowest point of the model at edit time: the minimum over all cells of
`y − ½` and over all rims with a horizontal axis of `y_hub − r`. So a model always starts
resting on the floor (or hanging from its fixed root above it), wherever it was built, and the
floor follows the model while editing. Off by default: every existing example swings below its
own lowest point.

**Free root.** `fixRoot: false` means no part is fixed in space — a vehicle. It only has an
effect while the ground is on (`rootIsFixed`): without a floor a model with nothing fixed would
just fall away, so the root stays fixed then. Default: fixed.

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
      Exception: a free pin that is itself the root part is kept as its own (fixed) body while
      the root is fixed (`rootIsFixed`); with a free root it is absorbed like any other.
   2. **Pairwise reduction.** Group the non-weld mates between each unordered pair of distinct
      bodies (A, B). Let *lines* be the distinct axis lines (direction + position) of those mates.
      - One line: if any mate on it is `revolute` → **revolute** joint. Otherwise (all
        `cylindrical`) compute slide limits (3.2); if the limits are `[0,0]` → **revolute**,
        else **cylindrical** with those limits.
      - Two or more lines, all parallel, and every mate `cylindrical` → **prismatic** along
        that direction with limits (3.2); if the limits are `[0,0]` → the pair is rigid: **union A and B**.
      - Otherwise (two or more lines, any revolute or any non-parallel) → rigid: **union A and B**.
4. Bodies = final union-find classes. `fixed` = contains the root part **and** `rootIsFixed(model)`
   (§2.6; with a free root no body is fixed). Joints as determined in
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

Per **rim** (§2.6) on a hole cell with axis `h`: one more positive, a cylinder about the hub axis
of radius `r − (½ − H)` = `r − 0.03` and extent `[−H, +H]` — the same thickness as a beam, and
the same 0.06 gap to a neighbour that it touches nominally. Bores of the part's cells (the hub
and any crank holes) are subtracted from it like from everything else. Rim edges get a small
chamfer (≈ 0.04). **Index mark:** so that rotation is visible, each rim carries one mark at a
fixed angle (the hub cell's first transverse axis): a shallow radial groove on both flat faces
from the hub ring to the edge, continued across the tread. It must be legible at the Home zoom
of a small model for `r ≥ 1`, from both sides and edge-on; the technique (cut geometry that the
outline pass picks up, or a painted line) is the implementer's choice. Use about 40 segments
per unit of radius (48 at `r = 1`, 160 at `r = 4`) so the tread never reads as a polygon.
Because the drawn rim is slightly smaller than the nominal disc, a hole that rule 1 of §2.6
joins to the wheel only through the disc's edge is bridged to the rim by a short web, so the
part is always drawn as one piece.

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

- rim → `{ shape: 'disc'; center; axis; radius: r − (½ − HC) = r − 0.04; halfLength: HC; cell }`.
  The physics layer turns it into three colliders (§5.1 "Wheels").

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
- No ground unless the model asks for one (see "Ground" below). A dynamic body that falls below `y = −400` is removed from the world (and hidden).
- **No body damping.** A loose part in free flight keeps its linear and angular velocity.
- **Joint friction** (added after first user testing: frictionless joints swing far longer than
  real parts). Every joint resists its *free relative motion* with dry (Coulomb) friction:
  - `revolute`: a torque about the joint axis of at most `τ_f`.
  - `prismatic`: a force along the joint axis of at most `F_f`.
  - `cylindrical`: both, independently.
  - `F_f = μ · m_j · |g|` and `τ_f = F_f · R_BORE`, where `m_j` is the **weight the joint
    carries**, estimated once per run from the kinematic graph: bodies are ranked by joint
    distance from a fixed body and, from the farthest in, each dynamic body passes its own mass
    plus everything passed to it, in equal shares, to its joints that lead one step closer to a
    fixed body; `m_j` is what the joint passes. So every pivot of a hanging chain carries all the
    links below it. A joint that passes nothing (two bodies at the same distance) and every joint
    of an assembly with no path to a fixed body use the lighter body's mass. This is a static
    load estimate — real friction follows the instantaneous joint reaction, which the engine does
    not expose. (First specified as "the lighter of the two bodies"; review showed that left
    chains swinging for minutes.)
  - `μ` is the **friction level**: `off` = 0, `low` = 0.05, `realistic` = 0.2 (default); any
    value in [0, 10] is accepted by the API. With `off` the simulation behaves exactly as it did
    without this feature (bit-identical trajectories).
  - Friction opposes motion and holds below its limit (stiction): a mechanism comes to rest in
    finite time, possibly slightly off its equilibrium, and then stays at rest without creeping.
    It never adds energy. A stuck joint is held at the coordinate where it stuck (a bare
    velocity motor creeps under load) and lets go once the load exceeds the limit.
  - Suggested construction: a velocity motor with target 0 on each free joint axis, limited with
    `setMotorMaxForce`. Verify units and behaviour against the installed package; if the motor
    limit is not usable from JS, use another construction with the same behaviour and record it
    in DEVIATIONS.md.
  - `Simulation.setJointFriction(μ)` changes the level while running; the UI offers
    Off / Low / Realistic beside the playback speed and remembers the choice (a UI preference,
    not part of the model file).

- **Ground** (§2.6; only when `model.ground`). A fixed body with a half-space collider, normal
  +Y, at `groundLevel(model) + (½ − HC)` so that the lowest collider starts in exact contact.
  Friction 0.4. It is not a model body: it has no part, is not in the energy guard's groups and
  is never removed. Only a half-space works — measured: a native cylinder on a cuboid floor
  creeps, accelerates by itself and tunnels. `SimOptions.groundSlopeDeg` (default 0, tests only
  for now) tilts the floor about Z (normal `(sin θ, cos θ, 0)`), placed to touch the model's
  lowest nominal point along its normal. `Simulation.groundY` is the plane's height at θ = 0
  (`groundLevel + 0.04`); the view draws the floor there in both modes. Two refinements found
  in review: the plane is lowered (never raised) to the lowest free end of a pin or axle, which
  reaches 0.02 further than a hole cell, so a model standing on a male end also starts in exact
  contact; and the ground collider must be created **before** the bodies' colliders (measured:
  created after them, Rapier's half-space contact drifts toward the plane's origin, and a wheel
  100 units away rolled 0.35 units in 20 s).
  With a ground, the grab spring's force component pushing *into* the floor is capped at
  2 × the grabbed mechanism's weight (measured: the full cap pressed pin-mounted wheels more
  than a unit into the floor); lifting and sideways pulls keep the full cap.
  The "falls below −400" removal rule stays.
- **Wheels.** A `disc` primitive becomes three colliders on the part's body, separated by
  collision groups, because no single shape works for both jobs (measured in `spikes/wheels/`):
  - *Round*: a native cylinder (radius and half-length of the primitive). It collides **only
    with the ground and with other wheels' round colliders.** On a half-space it rolls
    correctly: speed loss ≤ 0.5 % over 20 diameters, incline acceleration within 1 % of
    `g·sinθ/(1 + I/(m r²))` for `r ≥ 1.5`. It carries the rim's mass: the annulus between the hub
    barrel and the rim at density 1 (overlap with other cells of the part is ignored). Friction
    0.8 (a tyre; the ground and parts are 0.4, combine rule average).
  - *Hull*: a circumscribed 32-gon prism built like the other prisms (DEVIATIONS §5) with an
    end-face bevel of `0.02·r` (parry's 4-vertex face limit needs ≥ 0.0125·r), density 0. It
    collides **only with ordinary part colliders** — never the ground, never another wheel. It
    is what a liftarm hits. A polygon cannot roll (it loses energy at every facet), so a wheel
    rolling *along a beam* slows quickly; that is a documented limit, not a goal.
  - Ordinary part colliders collide with the ground, with wheel hulls and with each other, as
    now. Suggested groups: ground 1, round 2, hull 4, part 8.
  - *Ground guard*: a 32-gon prism inside the round collider (0.12 smaller in radius, 0.02 in
    half-length), density 0, no friction, colliding **only with the ground** (group 16).
    Measured need: the cylinder-on-half-space contact misses the rim when the disc is nearly
    flat (an `r = 4` wheel wobbling onto its face sank 1.04 units); the guard stops that at
    0.05–0.17 units and, being inset, is never touched in normal rolling.
  - Soft CCD stays on for unjointed bodies with a rim, as for any loose body (measured by the
    builder: without it a wheel dropped 10 units sinks 0.25 into the floor; the spike's
    fall-through against liftarms did not reproduce in 2 × 816 drops, with or without it).
  - Rapier clamps spin at π/4 per step (377 rad/s): a wheel skids above `377·r` units/s. Fine.
- **Free root** (§2.6): no body is fixed. Consequences that must be handled:
  - *Joint-friction load.* The fixed-body ranking has nothing to start from. When the ground is
    on, every body with a horizontal-axis rim whose lowest point is within 0.05 of the ground at
    Play counts as a sink (distance 0) in the ranking of "Joint friction" above, in addition to
    any fixed body. A four-wheel cart's axles then each carry a quarter of the chassis (spike:
    the lighter-body fallback overestimated it by 1.8×).
  - *Energy guard*: unchanged; ground contact only removes energy. A frictionless cart rolling
    at 100 units/s gains 45 % energy in 20 s without the guard and < 1 % with it.
  - *Products of inertia* (DEVIATIONS §5) are only dropped for mechanisms attached to a fixed
    body. A free vehicle with an off-centre crank is a known risk: test it, and record what
    happens.
- Cost (spike, Node): a four-wheel cart ≈ 480 ms of stepping per simulated second, about twice
  the same model without wheel contacts; a wheel–wheel pair costs ≈ +200 ms whenever their
  bounding boxes overlap. Fine at ¼×; at 1× a cart runs slower than real time.

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

The period and energy-conservation tests above run with joint friction **off**. With friction
on (default level unless stated):

- **Pendulum decay**: the swing amplitude falls by `≈ 2 τ_f / (m g d)` per half-swing (linear
  decay, the signature of dry friction; within 25 %), the link comes to rest in finite time, rests
  within `asin(τ_f / (m g d))` of straight down (plus tolerance) and stays at rest for a further
  5 s. The built-in pendulum released horizontal is at rest within 2–6 simulated seconds.
- **Monotone energy**: for every built-in example, total energy never rises (beyond the energy
  guard's band) and every jointed mechanism is at rest by 30 simulated seconds.
- **Spin**: a rotor spun up on a smooth pin slows at `τ_f / I` and stops; it never speeds up.
- **Slides**: the vertical axle still drops to its stop; a horizontal axle at rest does not creep.
- **Linkages still move**: four-bar and parallelogram crank range > 20° at every level.
- **Level changes**: `setJointFriction` while running takes effect on the next step; `off` then
  matches a run created with friction off from that state on.
- **Loose bodies** are unaffected by the friction level.
- **Stiction is exact**: a link released inside its dead zone, or come to rest, moves less than
  3e-5 rad in 20 s; a closed loop held far below its limit does not creep.
- **Chains come to rest**: triple pendulum within 8 s; a light link carrying a heavy one and
  6- and 12-link chains within tens of seconds, not minutes.

**Wheels, ground and free root** (all with the default settings unless stated):

- *Unchanged without them*: a model with no rim, no ground and a fixed root gives bit-identical
  trajectories to the previous simulator (the existing hash tests must not change).
- *Rest*: a loose wheel (`r` = 1, 1.5, 2.5, 4; axis horizontal) on the ground for 5 s moves
  < 0.01 units, sinks < 0.03 and does not tip; lying flat (axis vertical) it stays put too.
- *Rolling*: a loose wheel (`r` ≥ 1) started rolling at 40 units/s keeps its speed within 1 %
  over 160 units; on a 5° and a 15° floor (`groundSlopeDeg`) from rest its acceleration is
  within 2 % of `g·sinθ/(1 + I/(m r²))` for `r ≥ 1.5`.
- *Drop*: wheels and liftarms dropped onto the ground from 10 units in several orientations come
  to rest on it; nothing passes through and nothing is removed.
- *Cart* (free root; chassis, two axles, four wheels `r = 1.5`): at rest for 30 s it drifts
  < 0.01 units and no joint error exceeds 1e-3; with friction off and a push of 40 units/s it
  keeps its speed within 2 % for 5 s; with friction Realistic it stops within ± 10 % of
  `v₀²/(2·decel)`, `decel = 4·τ_f / (r · (M + ΣI/r²))` using the corrected load, and then does
  not creep; on a 15° floor with friction off it accelerates within 2 % of the analytic value.
  (The incline test tilts gravity rather than the floor: a level cart on a tilted floor first
  tips onto it. "At rest" for a model with no fixed body allows < 1e-3 rad of relative joint
  rotation over the rest window instead of 1e-4: native cylinders creep on the half-space by
  about 1e-5 units/s and no joint can hold that.)
- *Fixed root with ground*: a pendulum hung above the floor swings as before; a link released
  above the floor lands and rests on it.
- *Wheels against parts* (the weak spot — measure and report honestly, do not tune the test to
  pass): a liftarm dropped onto a fixed wheel from 2–10 units in ≥ 12 positions/orientations never
  passes through it; a loose wheel dropped onto a fixed 15-hole beam lying flat from 2–10 units
  in ≥ 12 cases never passes through; a pendulum link striking the rim of a pinned wheel bounces
  off and sets the wheel turning.
- *Crank wheel*: a pinned `r = 2.5` wheel with a link hanging from a crank hole rocks and comes
  to rest (friction Realistic) and shows no energy gain beyond the guard's band (friction off).
- *Determinism*: the cart run twice gives identical pose hashes.

---------------------------------------------------------------------------------------------

## 6. Rendering & camera (`src/view`)

three.js (WebGL2 renderer), TypeScript.

### 6.1 Look

Like printed building instructions: clean flat-ish colour, smooth lit curves, dark outlines.

- **Orthographic** camera only.
- Light background (near-white). No cast shadows (the one exception is the ground's contact
  shadow, below), no environment maps, no gloss. Lambert-like shading
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
  stronger axis lines; hidden while simulating.
- The root part carries a small unobtrusive "fixed" marker (a ground hatch of constant screen
  size). It is **stable and always visible**: its anchor is a point fixed on the root part,
  chosen from the model alone (never from the camera, other parts or the simulation), so it does
  not jump while simulating or orbiting; it is drawn on top of everything with a halo, at full
  strength where nothing is in front of it and fainter where another part covers it (the same
  idiom as the ghost). No marker when the root is free (§2.6).
- **Wheels** are drawn like any part (part colour, outlines), with their index mark (§4.2).
- **Ground** (§2.6, when on): shown the same way in **both** modes, by a **contact shadow** and
  nothing drawn *on* the floor (owner's call: lines or any other surface features compete with
  the reference grid; a first version with unit lines read as a second grid and was otherwise
  invisible).
  - *Tint*: a barely darker tint than the background, unbounded (it reaches the edges of the view
    at any zoom and pan). Not drawn when seen from below.
  - *Contact shadow*: a soft, neutral dark shadow on the floor under everything close to it, as
    if lit from straight above by a wide light — an ambient-occlusion blob, not a cast shadow
    with a direction. It depends only on **height above the floor**: under a point of the model
    at height `h` (lowest surface over that floor point) its strength is
    `(1 − h/SHADOW_H)²` for `h < SHADOW_H` (`SHADOW_H = 3` units), blurred in **world units**
    (so it looks the same at every zoom and frame size) into two lobes that are added: a
    *contact* lobe (Gaussian `σ = 0.35`, opacity 0.42 of a near-black neutral) that gives a
    crisp dark footprint, and a broad *ambient* lobe (`σ = 0.9`, opacity 0.42) that reaches
    about 4 units out, so the shade shows past the part that casts it. (A first version with
    the contact lobe alone at 0.34 was judged too faint from the default view: the dark
    footprint sat hidden under its own part.) Full strength is therefore 0.84 opacity, under a
    wide surface lying on the floor. Tuned by eye on the Cart: wheel contact patches clearly
    dark with a skirt past each wheel, the chassis 1.5 above the floor a faint broad shade, a
    beam lying on the floor a soft shade around it. It must read as a shadow in a printed
    manual, not as dirt. The strength is the owner's to tune.
  - *Suggested technique* (the usual "contact shadows" recipe): an orthographic camera in the
    floor plane looking straight up renders the part meshes (nothing else: no outlines, ghost,
    highlights, markers, glyphs, grid) with a depth-to-strength material into a texture covering
    the model's footprint; two separable blur passes; the result is drawn on a quad in the floor
    plane, after the tint and before everything else, never writing depth, normals or part ids
    (so the outline pass ignores it), and hidden by parts in front of it as any floor would be.
    Where the floor lies above the `y = −½` grid (the usual case) it is drawn after the grid,
    so the shadow darkens the grid lines under it instead of being diluted by them.
  - It follows the **current** pose of every part (edit placement, or simulated transforms; a
    part hidden with the test hook casts none). It is **view-independent**: orbiting, panning and
    zooming must not re-render the shadow texture; it is re-rendered only when a part moves, the
    model changes or the floor level changes (and after a WebGL context restore), and never
    while idle.
  - *Stability*: as a cart rolls the shadow must travel with it without swimming, shimmering or
    popping — snap the texture's frame to its texel grid and change the frame's size in coarse
    steps. The frame covers every part within `SHADOW_H` of the floor up to a maximum extent
    of 128 units across. When the model spreads further, the frame is the 128-unit square
    holding the most part footprint (ties keep the previous frame, so it never flips between
    equal groups and follows a moving one); what is outside gets no shadow.
  - Seen from below, nothing is drawn (it must not hide the model). Edge-on it degenerates
    naturally; the floor is then a line at its level, as before.
  - In edit mode the `y = −½` reference grid stays as the building plane; the floor may be lower.
    The grid is lines, the floor is a shadow: they cannot be confused.
  - Cost: with the ground on, a frame in which nothing moved costs the same as with it off
    (within noise); a simulated frame adds one small offscreen pass (measure and report).

### 6.2 Camera & navigation

- Turntable orbit about a pivot with world +Y up: **left-drag** orbit (a press that moves < 4 px
  is a click, not a drag), **right-drag / middle-drag / Shift+left-drag** pan, **wheel** zoom
  toward the cursor. Trackpad pinch works. Pitch clamps at ±90°.
- **View widget (prominent, top-right):** a view cube with labelled faces (FRONT, BACK, LEFT,
  RIGHT, TOP, BOTTOM) that rotates with the camera. Clicking a face snaps (animated ≈ 250 ms) to
  that orthographic view; clicking a corner snaps to that isometric view; clicking an edge to the
  corresponding 45° view. Hover highlight on the cube. Beside it: **Home** (default isometric +
  fit all) and **Fit** (frame the selection, else everything; also re-centres the orbit pivot).
  Both centre the model in the part of the view not covered by the side panel.
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
  With a free root (§2.6) no part shows the "fixed root" badge, and Set as fixed root also turns
  Fix root back on (one undo step).
- **Build** — one tool per kind: Pin hole `[1]`, Axle hole `[2]`, Axle `[3]`, Pin `[4]`,
  Friction pin `[5]`.
- **Wheel** `[W]` (after Friction pin in the toolbar): hover a hole cell — or the disc of a
  wheel — and click to **grow its rim by half a unit** (bare → 1 → 1.5 → … → 4). The ghost is the
  disc at the new radius. **Shift+click shrinks** by half a unit (1 → bare). Invalid growth is
  shown red with the reason ("wheel would hit part 3", "largest wheel is radius 4", "wheels grow
  from pin holes and axle holes"). Status: "Grow wheel · part 3 · radius 1.5 (24 mm across)".
  Each click is one undo step. A bare hole lying wholly inside a wheel of its own part (a crank
  hole) acts on that wheel, not on itself — a second disc there would be hidden inside the first.
- **Erase** `[E]`: click a cell to remove that sub-part (hovered cell highlighted red). Parts
  split if they fall apart. On a hub that has a rim, or anywhere on its disc outside the part's
  own cells, Erase removes **the outer half-unit of the rim** instead (highlighting that ring);
  once the rim is gone the next click erases the cell as usual.

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

**Back side.** With **Alt/Option** held (or the "Back side" toggle `[B]` on, a toolbar button
beside New part) the build tools pick **the back face under the cursor**: the face the mouse
ray would hit if every part's front faces were culled and only its back faces drawn (owner's
call; a first version that took the face *opposite the hovered front face* was logical but did
not match intuition — the cursor was not over the face being built on).

Precisely, with each part's solid taken as the union of its cell cubes and its rim discs — and,
for a male standing in another part's hole, that hole's part as well, so that a pin's faces
buried inside a beam are never picked and the beam's far face is (a pin is still pickable where
it sticks out) — a *back-face crossing* is a point
where the ray leaves a part's solid — it passes out of one of the part's cubes or discs into
space that is not that same part's (whether empty or occupied by another part). The pick is
the **nearest** such crossing over all parts: (`P`, `C`, `n`) with `C` the cell the ray leaves
and `n` the outward normal of the face it leaves through (so `n` points away from the viewer).
For a part with nothing in front of it this is where the ray exits the part it first enters;
for a concave part it is the *first* exit, not the last. Faces between two cells of the same
part are never picked. Ties: as for the front pick — the hole's part before the male inside it,
then lower part id, lower cell index; a ray leaving exactly through an edge or corner reports,
among the tied faces, the first whose neighbour cell is not the part's own.

The click then resolves exactly as if (`P`, `C`, `n`) had been hovered from behind — same
priority order, same `[R]`, Shift and New part behaviour, same validity rules and reasons (a
back face that abuts another part is pickable; whether anything can be built there is decided
as usual). The picked face's highlight and the ghost are drawn through the part and must be
legible there (the ghost's silhouette rim, the highlight at full strength), so that moving the
mouse over a part with Alt held visibly walks the highlight over its back faces. Every hover
line has a white under-stroke, and a highlight, ghost or band whose colour is close to the part
under the cursor switches to a contrasting one (orange over a blue part, dark red over red), so
it reads on every palette colour. The status
sentence says so ("… · back side (−Z)", the picked face's direction). With nothing under the
cursor Back side changes nothing (New on grid as usual). Erase, Select and Wheel ignore it.

**Wheels in picking.** Besides the cell cubes, each rim is pickable as its nominal disc (radius
`r`, one cell thick). A hit on a disc that is not inside one of the part's own cell cubes gives
the hover (`P`, `G`, `n`) where `G` is the grid cell under the hit point in the hub's layer — a
*virtual cell* of the wheel:
- Select, grab (simulate mode) and the kinematics tint treat it as part `P`.
- Wheel and Erase act on that rim (§7.2).
- Hole tools on a flat face of the disc (`n` ∥ hub axis): **Extend** — add a hole cell *at `G`*
  to `P` (a crank hole through the wheel; default orientation ∥ hub axis). It is valid whenever
  `canAddCell` allows it (the disc connects it, §2.6).
- Hits on the tread: Select, grab, Wheel and Erase act on the wheel as above (the hit reports
  the hub on its lateral face nearest the hit direction). The **build tools refuse** a tread,
  with the hint "Part 3 · wheel tread — point at the wheel's flat face or at a hole to build on
  a wheel": resolving it as the hub's lateral face built a cell buried inside the disc, far
  from the cursor.
- Male tools on a virtual cell: invalid, "add a hole here first" (a pin goes *into* a crank hole).
- Back side: a ray leaving the part through a disc's far flat face gives the virtual cell under
  the exit point with that face's normal; leaving through the tread is refused like a front
  hit on the tread (the hint adds "· back side (±A)"). Passing from a disc into one of the
  part's own cubes (or back) is not a crossing.

New parts take the current palette colour (or the kind default, §6.1).

### 7.4 Other

- Undo / redo (`⌘/Ctrl+Z`, `⇧⌘Z` / `Ctrl+Y`), unlimited within the session.
- File: **New**, **Open…** (`.knap.json`), **Save** (download), autosave to `localStorage` and
  restore on load. **Examples** menu (§8).
- **Show kinematics** toggle (edit mode): tints parts by rigid body and draws a small glyph on
  each joint axis (ring = revolute, ring + double arrow = cylindrical, double arrow = prismatic),
  so the user can see what welded and what moves before pressing play. Status bar shows counts:
  parts, bodies, joints.
- **Model settings** (edit mode only; saved in the file; each change is one undo step): a
  **Ground** toggle `[G]` and a **Fix root** toggle, in a small always-visible "Model" block of
  the inspector panel (not the top bar, which is full). Fix root is checked and disabled while
  the ground is off, with a tooltip saying why. The status bar's body count says "(none fixed)"
  for a free root. The inspector shows a selected wheel's radius.
- Status bar: hover info, action hint, last error. Keep the chrome compact and neutral.
  While simulating, when no part is in view (a vehicle rolled away) the hint says so and names
  Fit.
- UI is plain DOM + CSS (no framework). Works at 1280×720 and up; DPR-aware.

### 7.5 Test hook

`window.__knap` exposes a small debug API for automated tests: `getModel()`, `setModel(m)`,
`loadExample(name)`, `analyze()` (summary), `setMode('edit'|'simulate')`, `stepSim(n)`,
`setView(name)`, `fit()`, `partScreenPos(partId)`, `simTransforms()`. For wheels:
`getState().ground` / `.fixRoot`, `setGround(on)`, `setFixRoot(on)`, `simInfo().groundY`, and a
way to give a body a velocity in simulate mode (`pushBody(partId, [vx,vy,vz], [wx,wy,wz]?)`; one
body per call, so a vehicle needs each of its bodies pushed) so e2e can roll a cart without a
mouse. `groundShadowAt(x, z)`: the contact shadow's strength (0…1, after blur) at a floor point,
read back from the shadow texture, or null when the ground is off.

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
8. **Crank wheel** — a fixed upright carrying an `r = 2.5` wheel on a smooth pin, with a link
   hanging from a pin in a crank hole of the wheel, started off balance so the wheel rocks and
   the index mark is seen turning. No ground.
9. **Cart** — ground on, root free: a chassis on two axles with four wheels, carrying a raised
   arm on a smooth pin that falls and swings at Play, so the cart visibly rolls back and forth
   under it before friction brings it to rest. Wheel radius ≥ 1.5.

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

Gears (next: toothed rims meshing as constraints — see `spikes/coupling/`), racks, half-unit
offsets, tyres as separate parts, sloped or uneven ground, wheels that roll well on other parts,
studs, flexible parts, friction-pin friction, motors, an official
part catalogue, decomposition into official parts, collisions between directly-jointed bodies
(may come later as an experimental option), mobile/touch UI.
