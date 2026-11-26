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
                 rim?: number;       // wheel radius, §2.6; hole cells only
                 teeth?: true }      // the rim is a gear, §2.7; only with rim ∈ GEAR_RADII
interface Part { id: number; color: string /* '#rrggbb' */; cells: Cell[] }
interface Model { version: 1 | 2 | 3; parts: Part[]; rootPartId: number | null; nextPartId: number;
                  ground?: boolean;   // §2.6; absent = false
                  fixRoot?: boolean } // §2.6; absent = true
```

`version` is 2 as soon as a model uses `rim`, `ground` or `fixRoot` (the operations that set them
set it) and is otherwise left alone; version 1 files load unchanged and a model that uses none of
the three behaves exactly as before. `version` is 3 as soon as any cell has `teeth` (§2.7);
versions 1 and 2 load unchanged.

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
// gears (§2.7)
GEAR_RADII = [0.5, 1, 1.5, 2.5]; GEAR_TIP = 3/32   // teeth = 16·r → 8, 16, 24, 40
gearTeeth(r): number
canSetGear(m, partId, pos, r: number | undefined): { ok: true } | { ok: false; reason: string }
setGear(m, partId, pos, r | undefined): Model       // sets rim = r and teeth; undefined → bare cell
gearMeshes(m): { a: { partId, cell }, b: { partId, cell }, teethA, teethB }[]   // edit-time meshes
gearPlaneBasis(axis): [u: Axis, v: Axis]            // (Y,Z), (Z,X), (X,Y) for axis X, Y, Z
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
Male cells never carry a rim. A rim with `teeth` is a gear (§2.7); `r = ½` exists only as a gear.

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

### 2.7 Gears

Added after user request ("gear wheels … simple gears that mesh stably can become efficient
angle constraints"), with the owner's call for **real tooth counts**. Numbers come from four
spikes: `spikes/gearlook/` (placement, phase, profile, drawing), `spikes/gearsim/` (the mesh
constraint inside the real simulation), `spikes/adaptive/` (smaller steps at speed) and
`spikes/teeth2/` (tooth colliders — rejected, see §10). Each has a `REPORT.md`.

**A gear is a toothed rim**: a hole cell with `rim = r` and `teeth: true`, `r ∈ GEAR_RADII =
{½, 1, 1½, 2½}`. `r` is the **pitch radius**; the gear has `T = 16·r` teeth (8, 16, 24, 40),
module ⅛ unit (1 mm), circular pitch `p = π/8`. `teeth` on any other radius, or `rim = ½`
without `teeth`, is invalid. Everything §2.6 says about rims holds for gears (hub, one layer
thick, moves with its cell, no part in the kinematic analysis) except where this section says
otherwise.

Two nominal radii matter: the **pitch radius** `r` (meshing) and the **tip radius**
`r_t = r + GEAR_TIP = r + 3/32` (blocking — the drawn tooth tips, which is also about where real
ones are). All tests below are exact (work in units of 1/32).

**Meshing.** Two gears of *different parts* **mesh** iff their axes are parallel, they are in
the same layer, their hubs are in line along a grid axis (one in-plane offset is 0) and the
hub distance is exactly `r₁ + r₂`. The pairs that can mesh on the grid: 8+8 (1 apart), 8+24 and
16+16 (2), 8+40 and 24+24 (3), 24+40 (4), 40+40 (5). A 16-tooth gear meshes only with another
16 (its sums with the others are 1½, 2½, 3½). `gearMeshes(m)` lists them. A mesh is not a
mate and not part of §3: it is enforced by the simulation (§5.1 "Gears"), where gears also
come into and out of mesh while running.

**Tooth phase (a convention, not data).** With `(u, v) = gearPlaneBasis(axis)`, tooth `k` of a
gear at rest is centred at angle `(k + ¼)·2π/T` from `+u` toward `+v`, about its hub, in
**world** axes. With this quarter-pitch offset every pair that meshes by the rule above has its
teeth interleaved exactly (4 divides every `T`; proved and enumerated in the spike), wherever
the gears are and whichever way their parts are turned, with nothing to solve or store. Tooth
0 is the **index tooth** (§4.2, §6.1).

**Blocking (replaces rule 2 of §2.6 for a gear's disc).**
1. *Other parts' cells:* a gear's **tip disc** (radius `r_t`) must not overlap any cell of
   another part, with the usual exception of a male mated in a hole of the gear's part.
   (So an 8-tooth gear cannot have another part's ordinary cell beside it in its layer; a 24
   not at distance 2 in line; as in reality.) **A gear's hub cell is its gear:** other discs
   meet it only through rules 2–4, never as a cube — otherwise every mesh with an 8 would be
   blocked by the 8's own hub cube. (So a 24 and an 8 at offset `(2,1)` are allowed: their tip
   discs clear.) **A gear's web cells are its gear too** (`isWebCell`, rule 5): they lie
   strictly inside the tip disc, so any disc that could reach one is already judged by rules
   2–4 (review m8: a crank hole facing a meshing partner was refused). **Another part's male
   counts by its rod, not its cell:** in the gear's layer a pin or axle is a circle of radius
   5/16 when parallel to the gear axis, else a `±½ × ±5/16` rectangle (`tipOverlapsRod`, exact
   in 1/32). Otherwise a pin or axle through an 8 — the usual way to mount a pinion — blocked
   every mesh with that 8 (review m8); every meshing distance clears a rod in the partner's
   hub by 3/32. Holes beside an 8 stay blocked, and so does a rod pointing at the teeth. Plain
   wheels (§2.6 rule 2) still test whole cells.
2. *Plain wheels (any part):* tip disc × wheel disc must not overlap (generic disc tests with
   `r_t`).
3. *Other gears, parallel axes, same layer,* hub distance `d`, `s = r₁ + r₂`:
   `d < s` → overlap; `d = s` → a mesh if in line along a grid axis and the gears belong to
   different parts, otherwise blocked (the diagonal 40+40 at `(3,4)` would need a per-train
   phase solve — deferred, reason "these gears can only mesh in a straight line along the
   grid"; two gears of one part cannot mesh); `s < d < s + 3/16` → blocked, "the teeth would
   clash" (tips overlap without meshing, e.g. 16+40 at `(2,3)`); `d ≥ s + 3/16` → clear.
4. *Other gears, perpendicular axes:* tip disc × tip disc must not overlap. There are no bevel
   gears.
5. *The gear's own part, in the gear's layer.* Besides the hub, a cell of the same part in the
   gear's layer must either lie in the **web** — centre offset `du² + dv² ≤ (r − ½)²` and axis
   ∥ the hub axis (a crank hole or crank pin: `(1,0)` on a 24; `(1,0)`, `(1,1)`, `(2,0)` and
   their images on a 40; none on an 8 or 16) — or not be overlapped by the tip disc at all.
   Reason: "would cut into the teeth of this part's gear". Rule 1 of §2.6 connects the web
   cells to the hub (by the pitch disc). Rules 2–4 apply between discs of one part too: a
   gear's tips must clear its own part's plain wheels and other gears (two plain wheels of
   one part still fuse).
6. *Taking the teeth off.* A gear that stops being one (plain wheel, or bare) is checked like a
   new wheel or an ordinary cell: an 8 meshing with an adjacent 8 cannot become a bare hole
   there ("inside the gear of part N"); erasing the cell is still allowed — unless a web cell
   of the gear would be left inside another gear's tips, in which case un-gearing, shrinking
   below that web cell and removing the hub are all refused ("without this gear, (1, 0, 0) is
   inside the gear of part 2").
Reasons read "gear teeth would hit part N", "the teeth would clash with the gear of part N",
"inside the gear of part N". `validateModel`, `canAddCell`, `movePart`, `rotatePart`,
`canSetRim`, `canSetGear` enforce all of it.

**Ground level.** For `groundLevel` a gear with a horizontal axis reaches `y_hub − r − ⅛`
(its collider's tip radius `r + 0.085` plus the usual 0.04, §5.1).

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
Because the drawn rim is slightly smaller than the nominal disc, a cell that rule 1 of §2.6
joins to the wheel only through the disc's edge — a hole **or a male** (a crank pin built
into the wheel's part; review found those drawn as a separate floating rod) — is bridged to
the rim by a short web, so the part is always drawn as one piece. The web stays inside the
cells the disc already owns.

Per **gear** (§2.7), instead of the rim cylinder: a prism of the gear's outline about the hub
axis, extent `[−H, +H]`, no chamfer.
- Outline: `T = 16·r` involute teeth, pressure angle 20°, module ⅛; tip radius
  `r + 3/32`, root radius `r − 5/32`; tooth thickness on the pitch circle `π/16 − 0.025`
  (0.05 backlash per pair); below the base circle `r·cos 20°` the flank continues **parallel**
  (constant width) down to the root, not radially (radial gives the 8-tooth gear petal-thin
  necks). 5 points per involute flank, 2 segments on each tip land and each root land. Tooth
  `k` is centred at `(k + ¼)·2π/T` from `+u` toward `+v` (§2.7) — the solid is built in the
  part's edit-time world orientation, so the phase convention holds by construction.
  Measured in the spike: two such gears at mesh distance clear each other by ≥ 0.0157 through
  a whole mesh cycle for every size pair, and by ≥ 0.0048 at 0.02 closer.
- An 8-tooth gear's root (0.344) is inside the cell's barrel (`H`): its hub contributes **no
  barrel** in the gear's slab — the gear is the cell. An axial in-part connection is bridged by
  a cylinder 0.01 inside the root radius (at exactly the root its wall would coincide with
  the root lands).
- Web cells (§2.7 rule 5) contribute their bores (and rods) but **no barrel or web positive**
  inside the gear's slab — a crank hole is a bore through the gear, leaving ≥ 0.034 of wall to
  the tooth roots. Outside the slab a web cell's barrel stops 0.005 short of the gear face and
  joins it through a plug that stays inside the root circle (a barrel touching the face
  exactly left pinched, non-manifold bore edges; one reaching into the slab pokes out between
  the teeth).
- *Index:* tooth 0 is painted in the mark colour (flanks and tip land) on every gear — the only
  index an 8-tooth gear has room for; gears with `r ≥ 1` also carry the wheel's face groove
  along `+u`, from radius ½ to 0.05 inside the root (not across the teeth).
- The tooth band (flanks, tip lands, root lands) is flagged as one **soft patch** for the
  outline pass (§6.1): `MeshData` gains an optional per-vertex patch id and a set of soft
  patch ids.
- Cost: 672 / 1088 / 1536 / 2432 triangles for 8 / 16 / 24 / 40 teeth on an axle hole (32 more
  on a pin hole); 4–14 ms to build.

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

- gear → `{ shape: 'disc'; …; radius: r + 0.085; halfLength: HC; cell; gear: { pitch: r } }`
  (tip radius, 0.04 inside the nominal tip `r + ⅛`). The hub and the web cells of a gear
  yield **no** cylinder or box of their own inside the gear's slab — the disc stands for them
  (otherwise an 8-tooth gear's barrel, or a crank hole's, overlaps the partner's tip disc at
  mesh distance). The axial extensions of hub and web **hole** cells (from `HC` to ½) are
  dropped as well: they sit face to face with a meshing partner's tip hull and overlapped it
  by 0.045 (measured: a driven 1:5 pair ran backwards on that contact). A web crank pin keeps
  its rod outside the slab (radius 0.29, clear of partner tips).

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
  in review: the plane is placed **tangent to the lowest collider point of the whole model**
  (`groundPlane` in `src/physics/shapes.ts`, pure, computed from the collider shapes exactly as
  Rapier gets them; the edit-mode floor uses the same function), so every model
  starts in exact contact — a pin standing on its free end reaches 0.02 below a hole cell, and
  a rod lying on its side is 0.17 *above* `groundLevel + 0.04` (a first version only ever
  lowered the plane, and such a rod dropped at Play); and the ground collider must be created
  **before** the bodies' colliders (measured:
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
  - *Hull*: a circumscribed 32-gon prism, density 0, made of **32 wedges × 2 axial slabs**
    (`wheelHullPieces`: 64 six-point hulls, every face ≤ 4 vertices, no bevel). One prism gave
    one contact point against a beam's edge and too few against a loose part (see the
    requirement below). It
    collides **only with ordinary part colliders** — never the ground, never another wheel. It
    is what a liftarm hits. A polygon cannot roll (it loses energy at every facet), so a wheel
    rolling *along a beam* slows quickly; that is a documented limit, not a goal.
  - Ordinary part colliders collide with the ground, with wheel hulls and with each other, as
    now. Suggested groups: ground 1, round 2, hull 4, part 8.
  - *Requirement added in review (milestone 7 verification):* a wheel resting on or lying
    across a **loose** part that itself lies on the floor must not sink into it. Measured with
    the first hull: up to 0.458 (the whole half-thickness) lying flat across a beam, 0.06
    upright on a loose beam, 0.165 for a parked cart wheel, against 0.003 on a fixed beam.
    Target: ≤ 0.05 at rest in all of those, no regression in the wheel tests. Met by the wedge
    hull (≤ 0.0082 lying, ≤ 0.008 upright, 0.023 parked) except an `r = 4` wheel lying across a
    loose beam 1 off its hub (0.065, and the beam itself rolls onto its edge and sinks ≈ 0.4
    into the floor — a known limit of the ordinary prisms' bevel, DEVIATIONS). Costs ×1.15 on
    the Cart, up to ×2.4 while a wheel rests on a part. Gears use the same construction at
    their tip radius.
  - *Ground guard*: a 32-gon prism inside the round collider (0.12 smaller in radius, 0.02 in
    half-length), density 0, no friction, colliding **only with the ground** (group 16).
    Measured need: the cylinder-on-half-space contact misses the rim when the disc is nearly
    flat (an `r = 4` wheel wobbling onto its face sank 1.04 units); the guard stops that at
    0.05–0.17 units and, being inset, is never touched in normal rolling.
  - Soft CCD stays on for unjointed bodies with a rim, as for any loose body (measured by the
    builder: without it a wheel dropped 10 units sinks 0.25 into the floor; the spike's
    fall-through against liftarms did not reproduce in 2 × 816 drops, with or without it).
  - Rapier clamps spin at π/4 per step (377 rad/s): a wheel skids above `377·r` units/s. Fine.
- **Gears** (§2.7). Reference implementation to port: `spikes/gearsim/gearsim.ts` (a copy of
  `sim.ts` with every change marked `GEARSIM`) and its `REPORT.md`.
  - *Colliders.* A gear `disc` primitive becomes the wheel's three colliders at the **tip**
    radius `r + 0.085`: round (ground, and plain wheels' rounds; friction 0.4 — plastic, not a
    tyre), hull (ordinary part colliders) and ground guard. Mass: a solid disc of the pitch
    radius `r`, half-length `HC`, density 1, given explicitly (it stands for the hub cell too).
    **Gear colliders never collide with another gear's colliders**: at mesh distance the tip
    discs overlap by design, and the mesh constraint is what keeps two gears apart. Known
    limit: gears that are not in mesh (perpendicular ones, or one forced far inside another)
    pass through each other. There are **no tooth colliders**: measured in `spikes/teeth2/`,
    teeth meeting every part cost ×3.4, a gear lying flat on its teeth ×7–35, and they add
    nothing a smooth tip disc does not do for a beam resting on a gear (same grip, slip within
    0.5 %); tooth contacts cannot hold a ratchet either (§10).
  - *Mesh candidates:* every pair of gears on different bodies, not both fixed. Per pair, f64
    state: engaged flag, joint handle, unwrapped trackers `θ₁`, `θ₂`, `ψ`, phase reference `φ₀`,
    its target `φ_T`, and `stopMin`.
  - *Recomputed before every world step* (with `a` = gear 1's world axis, `c` the hub centres):
    `par = ∠(a₁, a₂) mod π`; `δ = (c₂ − c₁)·a`; `d⊥ = c₂ − c₁ − a·δ`, `D = |d⊥|`, `n = d⊥/D`,
    `t = a × n`; `gap = D − r₁ − r₂`.
  - *Engage* when all hold: `par ≤ 0.035` rad; `|δ| ≤ 0.6`; `−0.25 ≤ gap ≤ +0.125`; both
    bodies' linear speed ≤ 350 units/s. *Release* when any holds: `par > 0.087`; `|δ| > 0.9`;
    `gap > +0.25`; `gap < −0.5`; either body faster than 350 units/s (measured: a meshed
    gearbox reaching Rapier's 400 units/s linear clamp explodes; released, it freewheels).
  - *On engagement:* `φ = r₁θ₁ + r₂θ₂ − (r₁ + r₂)ψ` (`θ` = each body's twist about `a`, `ψ` =
    the angle of `n` in `gearPlaneBasis`); `φ_T = round(φ/p)·p`, `φ₀ = φ`;
    `stopMin = min(0, gap) − 0.005`. Create one generic joint with only `LinX` constrained,
    contacts on, and a `LinY` limit `[stopMin, 1e6]` (the radial stop). With the §2.7 phase
    convention every pair built in mesh engages with `φ ≡ 0 (mod p)` — snap 0.000 measured.
    Merge the two gears' **energy-guard groups** (never split again; measured: without the
    merge the guard brakes a geared pendulum to a stop).
  - *Every engaged world step* (step `h`): `φ₀` moves toward `φ_T` by at most `0.96·h` units of
    arc (the rate-limited snap, only after an off-grid engagement); `e = φ − φ₀`; lead
    `λ = D₀(1 − κ²)·φ_step/(2κ²)` with `D₀ = r₁ + r₂`, `κ = D₀/r₂`,
    `φ_step = (ω₁·a − β̇)·h`, `β̇ = (v₂(c₂) − v₁(c₁))·t/D`; anchor 1 `= c₁ + r₁n + λt`,
    anchor 2 `= c₂ − r₂n + (λ − e)t` (in gear 2's own plane); both frames `X = t, Y = n,
    Z = −a` in each body's local coordinates, via `setLocalFrame1/2`.
  - *Removal:* Rapier removes a mesh joint with its body; mark the pair dead and never touch
    the stale handle. No friction at a mesh; pivot friction loads stay as they are (static,
    mesh-agnostic). The grab's mechanism mass counts bodies linked through engaged meshes.
    `jointError()` is unchanged; `meshStates()` reports each engaged pair's phase error in teeth.
  - Measured in the real simulation: ratio error ≤ 3e-5, phase error ≤ 8e-4 teeth, static
    balance through 1:5, 1:25 and 1:125 with friction matching the analytic thresholds in 42 of
    42 cases; a swing-arm selector and a gear sliding along its axle engage and release once
    per stroke; a geared free-root cart neither accelerates by itself nor steers visibly.
- **Smaller steps at speed.** The mesh row is only clean while the fastest meshed gear turns
  ≤ 0.1 rad per world step (≈ 48 rad/s at 1/480 s); above it the mesh brakes (a 7-hole arm
  dropped through 1:25 lost 80 % of its energy) and above 0.2 rad it kicks and reverses. An
  arm falling through an ordinary 1:5 train exceeds 0.1 rad/step for half its fall. So each
  fixed step of 1/480 s runs as `k` world steps of `dt/k` with the solver iterations divided
  by `k` (jointed `240/k`, free `max(1, round(30/k))`): Rapier's iteration count is its
  substep count, so joint stiffness, pendulum period, slide stops and the f32 spin gain are
  unchanged (measured to 3 digits), and contacts get slightly better.
  - `k ∈ {1, 2, 4, 8}`, chosen once per fixed step from the state alone (deterministic):
    `ω* = max |ω|` over bodies carrying a gear with an **engaged** mesh, plus the positive part
    of its rise over the previous fixed step. Step **up** at once to the smallest `k` with
    `ω*·dt/k ≤ 0.08`; step **down** only when `ω*·dt/k′ ≤ 0.04` for the lower `k′` and no
    sooner than 0.1 s after the last step up. With no engaged mesh `k = 1` and the simulation
    is bit-identical to what it was.
  - *Gear size.* Measured (review m8), the braking starts at a rotation per world step that
    falls with gear size: 0.14 rad for 8 teeth, 0.096 for 16, 0.08 for 24, 0.06 for 40 —
    constant (≈ 0.1) when weighted by `√r`. So `ω*` uses `|ω|·max(1, √r)` with `r` the largest
    gear on that body with an engaged mesh (8 and 16 teeth are unchanged). Before this a driven
    40+40 pair stalled at 29 rad/s with half its drive work lost.
  - *Engaging at speed.* The fixed step is counted in eighths. When a mesh engages during a
    fixed step, `k` may step **up** at once (same rule) and the engaged meshes are re-anchored
    for the new step size before the world step runs. Before this the engaging step ran at
    the stale `k` and two gears meeting at matched speed lost up to 98 % of their energy; now
    they keep it, and a gear meeting one at rest ends at the plastic-impact speed.
  - A change of `k` rescales `world.timestep`, the solver iterations and every jointed body's
    additional iterations. Joint friction and the energy guard run **once per fixed step**
    (hold target `1/fixedDt`), the grab spring, mesh update, body removal and the speed cap
    per world step; the soft-CCD prediction stays at the fixed-step distance.
  - *Speed cap:* after each world step, if a gear with an engaged mesh spins faster than
    300 rad/s, every velocity in its guard group is scaled by the same factor to bring it back
    to 300 (the energy guard's operation; a single-body clamp whips the neighbours, damping
    over-brakes). The guard's reference falls with it.
  - Known costs of `k > 1`, paid only while a meshed gear is fast: 1.0–2.0× per fixed step at
    `k = 8`; joints that should hold still creep ≈ 4e-3 rad in 10 s under ground contact;
    impacts rebound less (restitution ≈ 0.03 instead of 0.12).
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

- **Gears** (§5.1; numbers from `spikes/gearsim/` unless noted, tolerances to be met with the
  guard on, friction off unless stated):
  - *Ratio:* 1:1, 1:3, 1:5, compound 1:25 and a 5-gear idler chain driven from rest to 40 rad/s
    at the input: ratio error < 1e-4, phase error < 0.005 teeth, joint error < 1e-5.
  - *Geared pendulum* (1:1 and 3:1): period within 1 % of the reduced model, energy within
    [−1 %, +1.1 %] of `mgL` over 4 s.
  - *Static balance* through 1:5 and 1:25 at friction Realistic: holds at 0.97 of the analytic
    threshold, moves at 1.03.
  - *Crane drop:* a 7-hole arm released horizontal on the output of 1:5 and 1:25 reaches the
    bottom with ≥ 95 % of the frictionless energy (it lost 46 % and 80 % at `k = 1`), `k`
    rises above 1 on the way and returns to 1 at rest; no reversed step of any gear.
  - *Yank:* the grab target jumped 8 units on a 1:5 arm: the arm never moves away from the
    target, phase error < 0.05 teeth, no gear above 300 rad/s.
  - *Engage / release:* a gear on a swing arm, and a gear sliding along its axle, engage and
    release exactly once per stroke; a pair built in mesh engages with snap 0.
  - *Removal and speed:* a meshed free gearbox falling out of the world never throws and is
    removed; nothing explodes at the 400 units/s clamp.
  - *Locked train* (a loop of meshes and shared axles whose ratios disagree): stays at rest,
    energy bounded, joint error < 1e-3.
  - *No gears, no change:* every example without gears reproduces its recorded hashes
    (`k = 1` path bit-identical).
  - *Collisions:* an 8-tooth and a 40-tooth gear built in mesh start with no contact between
    them; a beam dropped onto a gear rests on its tip radius; a gear with a horizontal axis
    rests on the ground at Play with gap 0.
  - *Determinism:* the Gear train example run twice gives identical hashes, `k` changes included.

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
- **Gears** are drawn with every real tooth, in the same style. The tooth band is a *soft
  patch* (§4.2): the outline pass inks its true contours (each tooth occluding the root behind
  it, the silhouette) but not its creases, so an edge-on gear shows quiet shaded flutes rather
  than a barcode of two lines per tooth. Where a tooth pitch is under about 6 device pixels
  the contours *inside* a soft patch fade out (to nothing at 3 px) so that a small or distant
  gear keeps its silhouette, faces, holes and index instead of a black fringe. The crease
  between the tooth band and the same part's flat faces is soft too where there is no depth
  jump (else a far gear keeps a zigzag along its near face). Inside a soft patch the depth
  test is its own: each side extrapolates with the smaller of its two nearest slopes, the
  threshold is half the ordinary tolerance, and a residual down to a quarter still draws when
  it connects along the contour (within 32 texels) to one above the half — without this the
  tooth-over-root contours came out dashed at oblique views (review m8); a few short breaks
  remain at some angles. The painted
  index tooth (and the face groove for `r ≥ 1`) shows rotation: the teeth alone strobe (a
  40-tooth gear looks frozen at 9.4 rad/s on a 60 Hz display).
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
    holding the most part footprint, with hysteresis: the previous frame (carried along with
    the parts inside it) is kept unless another square holds at least 25 % more — review found
    two similar carts 150 apart trading the shadow 16 times in 3 s as their arms swung. What is
    outside gets no shadow.
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
  Each click is one undo step. A bare hole of the wheel's own part, in its layer, that the
  wheel's disc overlaps (a crank hole, including one bridged at the rim's edge; exactly the
  cells rule 1 of §2.6 joins through the disc) acts on that wheel, not on itself — a second
  disc there would be hidden inside the first or poke out of it. With several such wheels, the
  nearest hub. On a gear the Wheel
  tool makes it a plain wheel of the same radius (1 for an 8-tooth gear).
- **Gear** `[T]` (after Wheel): hover a hole cell — or a gear — and click to make it a gear or
  step it **up one size**: bare → 8 → 16 → 24 → 40 teeth. **Shift+click steps down** (8 → bare).
  On a plain wheel it makes a gear of the largest size not above the wheel's radius. The ghost
  is the toothed disc at the new size. Invalid steps are red with the reason (§2.7: "gear teeth
  would hit part 3", "the teeth would clash with the gear of part 5", "largest gear has 40
  teeth", "gears grow from pin holes and axle holes", "would cut into the teeth of this part's
  gear"); when the next size is invalid but a later one in the same direction is valid, the
  click **goes to that size** and the status names what it skipped and why ("… 40 teeth
  (radius 2.5) · skips 8, 16, 24: …" — the middle hole of a long beam can only be a 40, whose
  web holds the beam's cells; review m8 found the old "24 teeth would fit" hint named a size
  no click could reach). Status: "Gear · part 3 · 24 teeth (radius 1.5)", and when the result
  meshes: "… · meshes with part 5 (40 teeth, 3:5)"; a parallel gear in the layer whose pitch
  circle is less than 1 away and that does not mesh is named with the reason ("does not mesh
  with part 1 (16 teeth): a 16 meshes only with another 16, in line at distance 2"). The `?`
  help has a Gears section with the pair table. Each click is one undo step.
- **Erase** `[E]`: click a cell to remove that sub-part (hovered cell highlighted red). Parts
  split if they fall apart. On a hub that has a rim, or anywhere on its disc outside the part's
  own cells, Erase removes **the outer half-unit of the rim** instead (highlighting that ring);
  once the rim is gone the next click erases the cell as usual. On a gear it steps the gear
  down one size (40 → 24 → 16 → 8 → bare).

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

Precisely, with each part's solid taken as the union of its cell cubes and its rim discs — and
a male and the hole it stands in treated as one solid **both ways**: a pin's faces buried
inside a beam are never picked and the beam's far face is (a pin is still pickable where it
sticks out), and equally a hole's face is never picked where the ray is still inside the rod
that passes through it, so looking straight down an axle the pick is the axle's far end
(review: it was the beam's back face, buried in the axle, with a red refusal) — a *back-face
crossing* is a point
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
line has a white under-stroke. **Hue keeps its meaning on every part colour**: the accent
(blue) always means "a click will do this", red always means refused or erase. Where the
overlay's colour is close to the part under the cursor it keeps its hue and changes its
*treatment* instead — white fill, and the outline in the semantic colour at double width over
the white under-stroke — so it still reads. (A first version switched to orange over blue
parts and dark red over red ones: on the Cart a valid face turned orange and an invalid one
red 6 px apart, and dark red on red read as a plain dark outline.) The status
sentence says so ("… · back side (−Z)", the picked face's direction). With nothing under the
cursor Back side changes nothing (New on grid as usual). Erase, Select, Wheel and Gear ignore it.

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

**Gears in picking.** A gear is pickable as its tip disc (radius `r + 3/32`) and otherwise
behaves as a wheel above: Select, grab, Gear, Wheel and Erase act on it; hole and male tools on
its flat face add a crank hole or crank pin at a virtual cell **in the web** (§2.7 rule 5) and
are refused elsewhere on the face ("too close to the teeth — crank holes go within N of the
hub", or "an 8-tooth gear has no room for crank holes"); the teeth are a tread.

New parts take the current palette colour (or the kind default, §6.1).

### 7.4 Other

- Undo / redo (`⌘/Ctrl+Z`, `⇧⌘Z` / `Ctrl+Y`), unlimited within the session.
- File: **New**, **Open…** (`.knap.json`), **Save** (download), autosave to `localStorage` and
  restore on load. **Examples** menu (§8).
- **Show kinematics** toggle (edit mode): tints parts by rigid body and draws a small glyph on
  each joint axis (ring = revolute, ring + double arrow = cylindrical, double arrow = prismatic),
  so the user can see what welded and what moves before pressing play. Status bar shows counts:
  parts, bodies, joints, and meshes when there are any. Each gear mesh (§2.7) gets a small
  glyph at its pitch point (two short interlocking ticks). Hovering a gear with Select says
  "Part 3 · gear 24 teeth ∥ Z · meshes with part 5 (40 teeth)"; the inspector shows a selected
  gear's tooth count and its meshes with their ratios.
- **Show colliders** toggle `[C]` (both modes; beside Show kinematics; a view preference, not
  saved in the file): draws **what the simulation collides with instead of what the parts look
  like** — owner's request ("a visualization of the collider meshes/primitives as a mode just
  like the constraints/joints visualization"). It exists to answer "why did that catch / sink /
  pass through?" and to show how coarse the physics shapes are.
  - *One source.* `colliderSpecs(part, segments)` in `src/physics/shapes.ts` (pure, no Rapier)
    lists every collider the simulation creates for a part, built from the same `partShapes`
    the simulation consumes: `{ role, shape }` with `shape` a convex point set (`hull`), a
    `box`, or a native `cylinder`, in edit-time world coordinates. A unit test builds a
    `Simulation` for every example and for random parts and checks the list against Rapier's
    own colliders (count per body, shape type, collision group ↔ role, and every hull's vertex
    set / box extents / cylinder radius, half-length and axis, to 1e-5). The view draws that
    list and nothing else, so the picture cannot drift from the physics.
  - *Roles* (the collision groups of §5.1, which decide what meets what):
    `part` — the bevelled prisms and boxes of ordinary cells (meet parts, hulls and the floor);
    `round` — a wheel's or gear's native cylinder (meets only the floor and other rounds);
    `hull` — a wheel's or gear's 64 wedge pieces (meet only parts);
    `guard` — a wheel's ground guard (meets only the floor; present only with a ground).
    Gears use their tip-radius shapes. The floor is a half-space: it stays shown by its contact
    shadow only.
  - *Look.* While the toggle is on the part solids step back (a faint ghost, no outlines) and
    the colliders are drawn over them: each primitive with its own crisp edges, so that the
    individual pieces — one stadium prism per liftarm run, the 16-gon barrels, the 0.01 bevels,
    the 64 wedges of a wheel — can be counted; roles told apart by colour, with a small legend
    (role, what it meets, how many) shown while the toggle is on. Edges hidden behind other
    colliders stay visible but fainter (a wheel's round cylinder and guard sit inside its
    hull). Still a tool, not a game: flat fills, no shadows of its own.
  - *Simulate mode.* Each part's colliders follow that part's body transform exactly as its
    solid does (a collider never moves relative to its part); removed bodies' colliders
    disappear with them. Picking, hover, grab, tools, selection and Show kinematics work
    unchanged and can be combined with it.
  - *Cost.* Built once per part signature and cached like the solids; toggling off restores
    the ordinary picture pixel for pixel.
  - Test hook: `setShowColliders(on)`, `colliderInfo()` → `{ on, parts: [{ partId, part, round,
    hull, guard }] }`.
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
read back from the shadow texture, or null when the ground is off. For gears:
`simInfo().substeps` (current `k`), `simInfo().meshes` (engaged pairs with phase error in
teeth), `analyze().meshes` (edit-time count).

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
10. **Gear train** — a fixed frame carrying a 40-tooth gear with an off-balance arm, meshing an
    8-tooth pinion with a light pointer, and from a second 8 on the pinion a second mesh
    (8 → 24) to a third pointer; no ground. (As built: the 40 carries a 7-hole arm with a 3×3
    weight; the pinion is straight above it and turns on its pointer's middle hole; the 24
    turns on a long pin from the frame.) At Play the arm falls and swings, the pointers turn
    five times as fast the other way and 5/3 as fast the same way. Friction pins or axle holes
    as needed so that each gear turns with its pointer.

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

Bevel, worm and crown gears, racks, gears meshing on a diagonal (40+40 at `(3,4)`: needs a
per-train phase solve, worked out in `spikes/gearlook/`), collisions between gears that are not
in mesh, friction in a gear mesh, **ratchets** (measured in `spikes/teeth2/`: a pawl made of
ordinary parts does click over tooth colliders, but soft contacts let the tooth crush through
it — an 8-tooth gear holds less than one pawl weight, a 40 about ten; the mechanism that holds
10⁴ is a one-way constraint row switched by a declared pawl, which needs a design decision),
half-unit offsets, tyres as separate parts, sloped or uneven ground, wheels that roll well on other parts,
studs, flexible parts, friction-pin friction, motors, an official
part catalogue, decomposition into official parts, collisions between directly-jointed bodies
(may come later as an experimental option), mobile/touch UI.
