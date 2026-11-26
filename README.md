# knap

A browser-based 3D editor and rigid-body physics simulator for a construction system of beams,
pins and axles. Everything is built from one-stud *sub-parts* — pin holes, axle holes, axles,
pins and friction pins — placed on a cubic grid. knap works out which parts are welded together
and which can turn or slide against each other, and simulates the result at real scale under
gravity. It is a tool, not a game: orthographic, instruction-style drawing, compact neutral UI.

**Try it in a browser:** <https://acsearle.github.io/knap/> — nothing to install. Start with
Examples → Cart, press Play and drag it about.

> **Disclaimer.** knap is an independent project. It is not affiliated with, endorsed by, or an
> official product of the LEGO Group. "LEGO" and "Technic" are trademarks of the LEGO Group.

## Quick tour

The window has a top bar (File, Examples, Undo/Redo, colour palette, Show kinematics / colliders, the
simulation controls with playback speed and joint friction, help `?` and About), a tool bar on the left, the 3D view with the view cube
top-right, an inspector for the selected part, and a status bar (what is under the cursor, what a
click will do, the last message or error, and counts of parts / bodies / joints). The `?` button
lists every control.

**Camera.** Left-drag orbits (a press that moves less than 4 px is a click), right-, middle- or
Shift+left-drag pans, the wheel (or a pinch) zooms toward the cursor. Click a face, edge or corner
of the view cube to snap the view; Home (`Home`) gives the default isometric view, Fit (`F`)
frames the selection or everything.

**Building.** Pick a tool — Select `V`/`Esc`, Pin hole `1`, Axle hole `2`, Axle `3`, Pin `4`,
Friction pin `5`, Wheel `W`, Gear `T`, Erase `E`. A translucent ghost shows what a click would add and the status bar
says it in words ("Extend part 3 · pin hole ∥ Z"); red means not possible, with the reason.
- Click the grid to start a new part (its holes run along Z, so a beam stands upright). Click a
  face of a part to *extend* it; a pin tool on the mouth of an empty hole *inserts* a pin, pushing
  it on through any empty holes stacked right behind (two stacked beams get pinned together); a
  hole tool on a rod *sleeves* a new beam onto it — on the rod's end too, where `R` offers fusing
  a perpendicular hole onto the rod instead.
- `R` cycles the ghost through its other valid orientations.
- Hold `Shift` (or toggle **New part** with `N`) to start a separate part instead of extending the
  clicked one.
- Hold `Alt`/`Option` (or toggle **Back side** with `B`) to build on the **back face under the
  cursor**: the face the pointer would hit if the front faces of the parts were see-through. Its
  highlight and the ghost are drawn through the part, and moving the mouse walks the highlight over
  the part's back faces — no need to orbit round it. For a part with nothing in front of it this is
  where the line of sight leaves that part (for an L or U shape, where it first leaves it). A pin
  or axle inside a beam's hole counts as part of the beam here, so the beam's far face is picked
  through it. `R`, `N` and the tool keys still work while `Alt` is held.
- Erase removes one sub-part; a part that falls apart is split into separate parts.
- **Wheels.** A wheel is not a separate kind of part: it is a pin hole or an axle hole (its *hub*)
  with a solid disc grown round it, one cell thick, and it belongs to the hub's part like any other
  cell. An axle-hole hub on an axle turns with the axle; a pin-hole hub on a smooth pin turns on it.
  With the Wheel tool (`W`), click a pin hole or an axle hole to grow it into a wheel,
  half a unit of radius per click (radius 1 to 4, i.e. 16–64 mm across; the ghost shows the new
  disc, red with the reason if it would hit another part); `Shift`+click shrinks it again. Click a
  wheel's face, tread or a crank hole inside it to grow that wheel. Erase on a wheel removes its outer half-unit (the band is
  highlighted) and, once the rim is gone, the hole itself. A hole tool on a wheel's face adds a
  *crank hole* to it, which a pin can then go into; a pin or axle tool there says "add a hole
  here first". The build tools do nothing on a wheel's tread (the status bar says to point at its
  flat face or a hole). Each wheel carries an index mark (a painted groove) so its rotation is visible.
- **Gears.** A gear is a wheel with teeth: a pin hole or axle hole grown into a toothed disc of
  8, 16, 24 or 40 teeth (pitch radius ½, 1, 1½, 2½ units; module 1 mm). With the Gear tool (`T`)
  click a hole to make it an 8-tooth gear and click again to step up 8 → 16 → 24 → 40;
  `Shift`+click steps down. When the next size does not fit but a larger one does (a long beam's
  middle hole: its cells are the web of a 40), the click goes straight to that size. A gear needs
  a layer of its own part to itself: sleeve a hole onto a pin, or extend a hole out of a beam along
  its axis. On a plain wheel the Gear tool makes the largest gear that fits inside
  it, and the Wheel tool turns a gear back into a plain wheel. Erase on a gear steps it down one
  size. Two gears of different parts **mesh** when their axes are parallel, they are in the same
  layer, their hubs are in a straight line along the grid and exactly the sum of the pitch radii
  apart: 8+8 (1 apart), 8+24 and 16+16 (2), 8+40 and 24+24 (3), 24+40 (4), 40+40 (5). The ghost and
  the status bar say when a gear would mesh, with the ratio ("meshes with part 2 (8 teeth, 5:1)"),
  and when a gear close by would not, and why ("a 16 meshes only with another 16"); the `?` help
  lists the pairs;
  tips that would overlap without meshing are refused ("the teeth would clash"). Build a small gear
  before a large one next to it (a bare hole inside a large gear's tips cannot become a gear). A
  hole tool on a gear's flat face adds a crank hole within the web (24 and 40 only); the teeth are
  a tread (nothing builds on them). While simulating, meshed gears turn at their exact ratio and
  can come into and out of mesh (a gear sliding along an axle, or on a swinging arm). One tooth of
  each gear (the *index tooth*) is painted, and gears of 16 teeth and up carry a face groove.
- **Model settings** (the *Model* block at the top of the right-hand panel, edit mode only, saved
  in the file, undoable): **Ground** (`G`) puts a floor under the model at its lowest point (it
  follows the model as you edit; drawn the same way in edit and simulate mode, as a barely darker
  tint and a soft contact shadow under whatever is close to it — nothing is drawn on it, so it
  cannot be confused with the building grid);
  **Fix root** off (only with the ground on) leaves every part free, for vehicles — the status bar
  then says "(none fixed)" and the fixed-root marker disappears. Without the ground the root part
  is always fixed (a model with nothing fixed would just fall away).
- **A vehicle**, for example: a 7-hole beam, an axle through the hole at each end (insert with the
  Axle tool, extend it, `Alt`-click for the far end), an axle hole slid onto each axle end, each
  grown to radius 1.5 with the Wheel tool; Ground on, Fix root off, Play, and drag the beam.
- To close a loop (a four-bar), build the two links so that their end holes are stacked, then
  push one pin into the front hole: it goes on through the hole behind and pins them together.
- Select a part to recolour it (the inspector's swatches; the top-bar palette is the colour for
  *new* parts), make it the fixed root, rotate, duplicate (`D`) or delete it
  (`Delete`/`Backspace`). Arrow keys move it one cell along the screen-aligned axes,
  `PageUp`/`PageDown` toward / away from you, `[` / `]` (or the inspector's ↺ / ↻) rotate it 90°
  about the view axis.
- `⌘Z` / `Ctrl+Z` undo, `⇧⌘Z` / `Ctrl+Y` redo — every action, including New, Open and loading an
  example.

**Files.** New, Open… (`⌘/Ctrl+O`, a `.knap.json` file), Save (`⌘/Ctrl+S`, downloads
`.knap.json`). The model is autosaved in the browser and restored on the next visit; without an
autosave knap starts with the four-bar example. A model that uses wheels, the ground or a free root
is saved as file version 2, a model with gears as version 3; older files open unchanged. The Examples menu has a pendulum, a triple
pendulum, a four-bar and a parallelogram linkage, a sliding axle, a weld test, a collision test, a
crank wheel (a wheel on a fixed upright turned by a link hanging from a crank hole), a cart
(a free vehicle on the ground that rolls back and forth under a swinging arm) and a gear train (a
40-tooth gear with a weighted arm driving an 8-tooth pinion 5:1, and from the pinion's second
8-tooth gear a 24, each with a pointer).

**Show kinematics** (`K`) tints each rigid body in its own colour and draws a glyph on every joint
axis (ring = revolute, ring + double arrow = cylindrical, double arrow = prismatic) and two short
interlocking ticks at the pitch point of every gear mesh, so you can see what is welded, what moves
and what drives what before pressing Play. The status bar counts the meshes too.

**Show colliders** (`C`, in the top bar's *Show* group beside kinematics; works while simulating
too) draws what the simulation collides with instead of what the parts look like: the parts fade to
a faint flat grey ghost and every collision shape is drawn with its own edges — one bevelled prism per
liftarm run, 16-sided prisms for pins and axles, and for each wheel or gear a smooth cylinder, 64
wedge pieces and (with the ground on) a ground guard. Colours say what each shape hits (parts,
the floor, other wheels); edges hidden behind other shapes are drawn fainter, and a small legend in
the side panel names the colours, says what each kind hits and counts the shapes. Shapes may overlap
without colliding: parts joined by a pin or axle (or welded into one body) never hit each other, and
one gear's disc never hits another gear's — the legend says so. It is taken from the same list the physics
engine is built from, so it shows why something caught, sank or passed through. It is a view
setting: not saved in the file and not an undo step.

**Simulating.** Play (`Space`) freezes the model and runs the physics; Pause (`Space`), Step
(`.`, 1/60 s), and the speed buttons 1× ½× ¼× ⅒× (default ¼× so the motion is readable) control
it; the simulated time shows next to the SIMULATING badge. **Friction** Off / Low / Real(istic) sets how
quickly pins and axles lose motion (default Realistic: a swing dies down within seconds; Off:
ideal joints that never stop); it can be changed while simulating, is remembered by the browser
and is not part of the model file. Drag a moving part to pull it with a spring; dragging empty space or the fixed part orbits.
While simulating, editing is disabled (tools, palette, undo, New / Open / Examples are greyed
out; keys say "Stop the simulation to edit"). Stop (`Esc`) returns to exactly the model you
edited; the camera stays where it is. A "can't keep up" badge appears when the computer cannot
simulate (or draw) fast enough for the chosen speed. If the solver fails (NaN, blow-up) the
simulation stops with a message. If every joint turns about a vertical axis, Play says that gravity
cannot turn the mechanism (drag it instead).

## How the model works (one page)

- **Grid.** 1 unit = 1 stud = 8 mm, +Y up. Every cell holds one sub-part with an axis: a *hole*
  (pin hole, axle hole) or a *male* (axle, pin, friction pin).
- **Parts.** A part is a set of cells that forms one solid piece. Within a part, adjacent cells
  connect when the pairing makes mechanical sense: hole–hole always; male–male only end to end
  along their common axis; a male's end on a hole's side wall (a pin sticking out of a beam). A
  rod ending on the mouth of a coaxial hole does not attach, and a rod's side attaches to nothing.
- **Mates.** Two parts may share a cell only as one male inside one coaxial, compatible hole:
  axle in pin hole = rotate + slide (cylindrical), pin in pin hole = rotate (revolute), axle in
  axle hole = weld, friction pin in pin hole = weld (for now).
- **Kinematic analysis.** Parts joined by welds become one rigid body. A loose smooth pin is
  absorbed into one of the bodies it joins, so two beams on a pin form a direct revolute pair. Two
  bodies joined on one axis line get a revolute or cylindrical joint (slide limits from what is on
  the axis line: a bush against a beam is a stop); on several parallel lines with sliding mates a
  prismatic joint; anything else (two pins in different holes, perpendicular mates) welds them.
  The root part (the lowest id unless you set one) is fixed in space.
- **Physics.** One rigid body per analysed body, one joint per joint; bodies that share a joint do
  not collide with each other (a pin overlaps its hole), all other bodies collide. Gravity is real
  (9.81 m/s²), so a 4 cm pendulum swings with a ~0.4 s period. There is no ground unless the
  model's Ground setting is on; bodies that fall 400 units below the model are removed.
- **Wheels and ground.** A wheel's disc blocks other parts like any cell (it may not overlap another
  part or another part's wheel; a pin or axle of another part may go through its hub or a crank
  hole), but adds no joints. In the physics a wheel is a true cylinder against the ground (and
  against other wheels), so it rolls; against beams, pins and axles it is a 32-sided prism.
- **Gears.** A gear's tip circle blocks other parts' cells; its own part may have crank holes and
  pins in its web. A mesh is not a joint of the kinematic analysis: in the physics each pair of
  gears that comes into mesh gets one constraint row that keeps their pitch circles rolling on each
  other (exact ratio, the teeth stay interleaved), switched on and off as the gears move into and
  out of mesh. There are no tooth colliders: against beams and the ground a gear is a smooth disc
  at its tip radius. While a meshed gear turns fast the simulation takes up to 8 smaller steps per
  step, so fast gear trains stay exact.

## Engines

- [three.js](https://threejs.org/) — rendering: orthographic, Lambert-like shading from a head
  light, outlines as a post-process over an ID buffer.
- [Rapier](https://rapier.rs/) (`@dimforge/rapier3d-compat`, Rust → WASM) — physics. Chosen over
  ammo.js (stale Bullet port), cannon-es (weak joints, unmaintained) and Jolt (excellent solver
  but a heavier, manual-memory API).
- [manifold-3d](https://github.com/elalish/manifold) (WASM) — robust CSG for the part solids.
- TypeScript (strict), Vite, Vitest, Playwright. Plain DOM + CSS UI, no framework.

Everything, WASM included, is bundled: no network access at runtime.

## Known limitations

From `docs/DEVIATIONS.md` §5 (physics):
- Joints have dry friction, at the *Realistic* level (μ = 0.2) by default; *Low* is 0.05 and *Off*
  is frictionless. Each joint resists its free rotation with a torque of at most
  τ_f = μ·m·g·R_BORE (R_BORE = 0.31 units), and its free slide with a force of at most μ·m·g. Here
  m is the weight the joint carries: in a chain a pivot carries every link below it, and in a loop
  the far link's weight is shared between the two sides. At Realistic the built-in pendulum,
  released horizontal, makes about 10 swings and is at rest after 3.6 s, 0.7° off vertical; the
  triple pendulum rests after ≈ 6.5 s. A part may come to rest anywhere within asin(τ_f/(m·g·d))
  of its equilibrium (d = distance of its centre of mass from the axis), so a nearly balanced
  part, such as the sliding-axle example's arm, can stop visibly tilted. Once stopped it stays
  exactly where it stopped.
  - The load is estimated from the weight, once per run, not from the joint's true reaction: it
    ignores swinging (centrifugal) loads, and a joint between two parts falling freely, or along a
    vertical slide, still feels the weight. Long chains of light links take longest to settle
    (twelve 3-hole links: ≈ 32 s).
  - Pins and axles share the same μ.
  - Without gravity there is no joint friction.
- Fixed step 1/480 s with 240 solver substeps; no body damping. Rapier's joint solver loses some
  energy in fast motion (frictionless triple pendulum ≈ −4 % over 10 s), while its f32 integration
  slowly *adds* speed to rotation (up to +50 % of the peak kinetic energy in 30 s for an arm on an
  axle or a spatial chain). An *energy guard* stops that:
  - Per group of connected moving parts, energy may rise at most 1 % of the group's peak kinetic
    energy above its lowest value. Beyond that, the group's velocities are scaled down uniformly.
  - It never adds energy and it keeps the work done by dragging.
  - With joint friction on it also makes sure friction's work is not offset by that gain (a fast
    spinning rotor at Low slows at the friction rate). With friction Off a pendulum can end up 1 % of its
    swing energy above where it started, and a part spinning without gravity keeps its speed only
    to within ≈ 0.5 %.
- Rapier clamps linear speed to 400 units/s (3.2 m/s) and angular speed to 377 rad/s, so falling
  parts fall slower than free fall once they are fast.
- A flat face landing squarely on another at high speed can be thrown sideways; parts never pass
  through each other, but very fast impacts can penetrate briefly.
- Collision shapes are convex prisms with slightly bevelled ends, not the exact render mesh.
- Products of inertia are dropped for planar mechanisms (motion unchanged); a spatial mechanism
  rotating about a non-principal axis could still become unstable (not tested).
- Contacts between directly jointed bodies are off; slide stops come from joint limits.
- The collision example costs ≈ 4 ms of physics per frame at 1× (estimated; DEVIATIONS §5);
  slower machines show "can't keep up" and run slower than real time instead of stalling.
- **Size limit of the simulation.** Every body with a joint runs 240 solver substeps per step, so
  the cost grows with the number of jointed bodies: ≈ 55–60 ms of stepping per jointed body per
  simulated second (pinned chains of 3 / 6 / 12 / 24 links: 315 / 427 / 745 / 1410 ms, Node, dev
  machine). With the per-frame budget of 8 ms that is about 8 jointed bodies at 1× and about 30 at
  the default ¼×; larger mechanisms run slower than the chosen speed and show "can't keep up".

Wheels, ground and vehicles (`docs/DEVIATIONS.md` §5, §7):
- Wheels roll properly only on the ground (and against other wheels). Against beams and other
  parts a wheel is a 32-sided polygon, so a wheel rolling along a beam bumps and slows quickly.
- No tyres as separate parts, no sloped or uneven ground, no motors: a vehicle moves only by
  gravity or by dragging it.
- Wheels sink slightly into the floor (≈ 0.006 units at rest, up to ≈ 0.08 when rolling very fast,
  up to ≈ 0.17 when a wheel wobbles down onto its face); a resting cart creeps by ≈ 1e-5 units/s.
- A wheel lying across a beam that lies on the floor sinks into the beam's edge (≈ 0.37 of the
  beam's 0.46 half-thickness), then rests there; it does not pass through. A free linkage without
  wheels lying on the floor creeps a few hundredths of a unit per 10 s.
- Falling parts can dip up to ≈ 0.7 units into the floor for a step or two on a hard impact;
  nothing falls through.
- Dragging presses into the floor with at most twice the model's weight (more pushed light wheels
  through it). The drag plane faces the camera, so from the default isometric view a drag "along
  the floor" also pulls the vehicle toward you; drag from the FRONT view to roll it straight.
- The camera does not follow a vehicle; a fast one rolls out of view (the status bar then says so:
  press `F` to bring it back).
- A free vehicle costs ≈ 0.4–0.5 s of physics per simulated second (the cart example), so at 1×
  it runs slower than real time; at the default ¼× it needs ≈ 0.1 s of physics per second.

Gears (`docs/DESIGN.md` §2.7, §5.1, §10):
- Gears mesh only in a straight line along a grid axis: two gears whose hubs are diagonal (a 40
  and a 40 at (3, 4), which are exactly 5 apart) are refused, not meshed.
- A 16-tooth gear meshes only with another 16 (with the other sizes the hub distance would be a
  half unit, which the grid does not have).
- No bevel, worm or crown gears, no racks, no ratchets (a pawl cannot hold against smooth tip
  discs; a declared one-way mesh is not designed yet), and no friction in a mesh (only the pins and
  axles have friction).
- Gears that are not in mesh do not collide with each other: perpendicular gears, or one pushed
  into another while simulating, pass through each other. Against beams, pins, axles and the
  ground a gear is a smooth disc of its tip radius, so a beam resting on a gear does not catch in
  the teeth.
- Build order matters next to a gear: a bare hole that a gear's tips reach cannot become a gear,
  so make the small gear first, or shrink the big one and grow it back. Two 8-tooth gears side by
  side cannot be made with the Gear tool directly (each bare hole is inside the other's tips);
  build one apart and move it next to the other.
- An 8-tooth gear has no face groove, and its painted index tooth is edge-on when the gear is
  seen face-on, so a bare 8 seen square-on does not show its rotation; give it a pointer. A loose
  8-tooth gear rolling on the ground wanders sideways (it has too few tips to roll true).
- Rapier's f32 solve of a mesh adds energy while gears spin (≈ 10 % of the kinetic energy per
  second for a fast pair); the energy guard removes it, so with friction Off the Gear train swings
  for ever within the guard's 1 % band (its arm reaches 0.6° above its start), and a spinning
  engagement loses a little speed to the guard.
- A meshed gear is limited to 300 rad/s, and a gearbox moving faster than 350 units/s lets its
  gears go out of mesh (it would otherwise blow up at Rapier's speed clamp).

Editor and app:
- Picking is against cell cubes, so a part hidden behind another can only be reached by orbiting.
  A wheel is picked as its nominal disc (radius r, one cell thick), not its exact mesh; a gear as
  its tip disc.
- The floor is unbounded: seen from above, in the orthographic view, its tint fills the whole
  background. The contact shadow is a soft blob under everything less than 3 units above the floor
  (darkest where a part touches it, with a broader soft skirt around), the same from every
  viewpoint; it covers at most 128 units across — for a model spread wider than that it covers the
  128-unit square holding most of the parts, and parts outside it cast none. Seen from below the
  floor is not drawn; edge-on it is a line.
- A part's solid is rebuilt (CSG) on the main thread whenever its cells change, so each click on
  a large part waits for that rebuild: ≈ 0.16 s for a 16×16 plate of pin holes, 0.5 s when holes
  run along two axes, 0.7–2.3 s at 32×32 (1024 cells; Node, dev machine). Many small parts stay
  fast (only changed parts are rebuilt). Building in a worker is not done.
- Building rules depart from the specification's strict order in two places (sleeve before extend
  on a rod's end; deep insert through stacked holes) — see `docs/DEVIATIONS.md` §7.
- Duplicate places the copy at the nearest spot where it touches nothing.
- The UI targets mouse/trackpad on desktop at 1280×720 and up; touch is not supported.
- An autosaved *empty* model is treated as "nothing saved", so after New + reload knap shows the
  four-bar again. The file name Save suggests is not autosaved: after a reload Save uses a dated
  name. When the browser blocks storage, or a write fails (quota), the status bar shows
  "Not autosaved" until a write succeeds.

## Run, build, test

Requires Node 20.11+.

```sh
npm ci             # install exactly the locked dependencies
npx playwright install chromium   # only needed for npm run e2e
npm run dev        # development server (http://localhost:5173)
npm run build      # typecheck + production build into dist/
npm run preview    # serve dist/
npm test           # unit + headless physics tests (vitest)
npm run typecheck
npm run e2e        # build, serve, drive headless Chromium; screenshots in e2e/out/
npm run e2e -- app-build app-sim     # run some e2e scripts (E2E_NO_BUILD=1 reuses dist/)
```

The app e2e scripts (`e2e/app-*.e2e.mjs`) drive the real UI with Playwright mouse and keyboard
events: building a pendulum from scratch, every example in edit and simulate mode (the crank wheel,
the cart and the gear train run to rest), building and growing wheels, building gears and
simulating them, undo/redo of every edit, files and
autosave, grabbing in simulate mode, layout. They use the debug hook
`window.__knap` (see `src/app/testhook.ts`) only to read state and find screen positions.
Headless Chromium renders with SwiftShader (software WebGL), so frames are slow there (≈ 3–6 fps
at 1280×720); the scripts pause the simulation and use `stepSim` where they need determinism.

## Source layout

```
src/core/      pure model, rules, kinematic analysis, examples (no DOM / WASM)
src/geometry/  part solids (manifold) and collision primitives
src/physics/   Rapier simulation
src/view/      rendering, outlines, camera, view cube, overlays, pointer input
src/editor/    picking, build/erase/select resolution, selection ops, history, persistence
src/app/       the application: wiring, simulate mode, files, test hook
src/ui/        top bar, tool bar, inspector, status bar, dialogs, styles
src/main.ts    entry point
tests/         vitest tests
e2e/           Playwright scripts (see e2e/lib.mjs)
docs/          DESIGN.md (specification), DEVIATIONS.md (decisions)
```

## License

knap's own code is under the BSD Zero Clause License (0BSD, see `LICENSE`): do anything you like
with it, no attribution required, no warranty. The build writes the licences of
the bundled third-party code (three.js — MIT; Rapier and manifold-3d — Apache-2.0) to
`dist/THIRD_PARTY_LICENSES.txt`; ship that file with `dist/`.
