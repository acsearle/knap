# knap

A browser-based 3D editor and rigid-body physics simulator for a construction system of beams,
pins and axles. Everything is built from one-stud *sub-parts* — pin holes, axle holes, axles,
pins and friction pins — placed on a cubic grid. knap works out which parts are welded together
and which can turn or slide against each other, and simulates the result at real scale under
gravity. It is a tool, not a game: orthographic, instruction-style drawing, compact neutral UI.

> **Disclaimer.** knap is an independent project. It is not affiliated with, endorsed by, or an
> official product of the LEGO Group. "LEGO" and "Technic" are trademarks of the LEGO Group.

## Quick tour

The window has a top bar (File, Examples, Undo/Redo, colour palette, Show kinematics, the
simulation controls, help `?` and About), a tool bar on the left, the 3D view with the view cube
top-right, an inspector for the selected part, and a status bar (what is under the cursor, what a
click will do, the last message or error, and counts of parts / bodies / joints). The `?` button
lists every control.

**Camera.** Left-drag orbits (a press that moves less than 4 px is a click), right-, middle- or
Shift+left-drag pans, the wheel (or a pinch) zooms toward the cursor. Click a face, edge or corner
of the view cube to snap the view; Home (`Home`) gives the default isometric view, Fit (`F`)
frames the selection or everything.

**Building.** Pick a tool — Select `V`/`Esc`, Pin hole `1`, Axle hole `2`, Axle `3`, Pin `4`,
Friction pin `5`, Erase `E`. A translucent ghost shows what a click would add and the status bar
says it in words ("Extend part 3 · pin hole ∥ Z"); red means not possible, with the reason.
- Click the grid to start a new part (its holes run along Z, so a beam stands upright). Click a
  face of a part to *extend* it; a pin tool on the mouth of an empty hole *inserts* a pin, pushing
  it on through any empty holes stacked right behind (two stacked beams get pinned together); a
  hole tool on a rod *sleeves* a new beam onto it — on the rod's end too, where `R` offers fusing
  a perpendicular hole onto the rod instead.
- `R` cycles the ghost through its other valid orientations.
- Hold `Shift` (or toggle **New part** with `N`) to start a separate part instead of extending the
  clicked one.
- Erase removes one sub-part; a part that falls apart is split into separate parts.
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
autosave knap starts with the four-bar example. The Examples menu has a pendulum, a triple
pendulum, a four-bar and a parallelogram linkage, a sliding axle, a weld test and a collision test.

**Show kinematics** (`K`) tints each rigid body in its own colour and draws a glyph on every joint
axis (ring = revolute, ring + double arrow = cylindrical, double arrow = prismatic), so you can see
what is welded and what moves before pressing Play.

**Simulating.** Play (`Space`) freezes the model and runs the physics; Pause (`Space`), Step
(`.`, 1/60 s), and the speed buttons 1× ½× ¼× ⅒× (default ¼× so the motion is readable) control
it. Drag a moving part to pull it with a spring; dragging empty space or the fixed part orbits.
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
  (9.81 m/s²), so a 4 cm pendulum swings with a ~0.4 s period. There is no ground; bodies that
  fall 400 units below the model are removed.

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
- Fixed step 1/480 s with 240 solver substeps; no damping by default (angular damping 0). Rapier's
  joint solver still loses some energy in fast motion (triple pendulum ≈ −4 % over 10 s), while
  its f32 integration slowly *adds* speed to rotation (up to +50 % of the peak kinetic energy in
  30 s for an arm on an axle or a spatial chain). An *energy guard* stops that: per group of
  connected moving parts, energy may rise at most 1 % of the group's peak kinetic energy above
  its lowest value, beyond which the group's velocities are scaled down uniformly (it never adds
  energy and keeps the work done by dragging). So a frictionless pendulum can end up to 1 % of its
  swing energy above where it started, and a spinning part keeps its speed only to within ≈ 0.5 %.
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

Editor and app:
- Picking is against cell cubes, so a part hidden behind another can only be reached by orbiting.
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
events: building a pendulum from scratch, every example in edit and simulate mode, undo/redo of
every edit, files and autosave, grabbing in simulate mode, layout. They use the debug hook
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

The project's own licence is not chosen yet (TBD by the owner). The build writes the licences of
the bundled third-party code (three.js — MIT; Rapier and manifold-3d — Apache-2.0) to
`dist/THIRD_PARTY_LICENSES.txt`; ship that file with `dist/`.
