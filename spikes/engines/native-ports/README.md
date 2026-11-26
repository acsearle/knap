# Native engines that would need porting to the browser, and the "write our own" option

This is a documentation survey. Nothing was installed, built or run against any engine, so every
battery row (B1a–B10) is **NOT RUN** for every engine here. What *was* run: a few `curl` + `grep`
checks of the published WebIDL binding files of the ready browser builds of ammo.js and
JoltPhysics.js, and the GitHub REST API for repository size, licence and last push (commands at the
end). Everything else is a **claim** taken from the cited page, or my **estimate** (marked). Facts
were looked up on 2026-11-27.

Engines that already ship a maintained browser build (MuJoCo `@mujoco/mujoco`, Jolt
`jolt-physics`, PhysX `physx-js-webidl`, Bullet `ammo.js`, Havok) are covered by the sibling
spikes in `spikes/engines/{mujoco,jolt,physx,bullet,havok-and-js}` and are mentioned here only
where they matter for comparison.

## What knap needs, from docs/RAPIER.md

The limits that hurt are not exotic, and they fall into three groups:

1. **Integration and solver errors on jointed mechanisms.** Hinge energy loss ∝ ω²h (linearised
   in-substep integration), f32 spin gain from the gyroscopic step, Gauss–Seidel creep, no gear
   row, a re-anchored LinX row standing in for gears that brakes above about 0.1 rad per step,
   long gear trains that do not converge, and about 240 substeps (h = 1/115 200 s) to keep a triple
   pendulum within 10 %.
2. **Contact-manifold defects in parry.** The polygon face is cut to 4 vertices, the frozen
   contact points make cylinders self-accelerate, the cylinder side is one segment, and contact
   against dynamic bodies is soft at 30 Hz.
3. **Missing API pieces.** No joint friction, no reaction forces, no one-way limits, no
   per-pair stiffness, and f32 only.

An engine built for **mechanisms** fixes group 1 by construction: it uses implicit or direct
solves, f64, and gear and coupler constraints. Group 2 depends on the engine's collision code,
which in most multibody engines is weaker than in game engines. That trade-off runs through
everything below.

## Per-engine assessment

Size column: GitHub repository size from the API (measured; it includes assets and history, so it
is an upper bound and not a WASM size). WASM size is an estimate unless cited.

| engine | licence | lang / deps | f32/f64 | gear / coupler | joint friction | browser build known? | repo size |
|---|---|---|---|---|---|---|---|
| Project Chrono 10.0 | BSD-3 | C++17; core needs only Eigen (header-only) | f64 | `ChLinkLockGear`, `ChLinkMateRackPinion`, `ChLinkLockPulley` | not confirmed (see text) | **yes, official Emscripten tutorial** | 1,026 MB |
| Simbody 3.x | Apache-2.0 | C++; LAPACK/BLAS | f64 | `Constraint::CoordinateCoupler`, gear example | via forces (`Force::MobilityLinearDamper`, custom) | none found | 266 MB |
| DART 6/7 | BSD-2 | C++; Eigen, FCL, assimp, (Bullet/ODE collision optional) | f64 | mimic joints (estimate, not re-verified) | joint Coulomb friction (estimate) | none found | 230 MB |
| Drake | BSD-3 | C++/Python, Bazel, very large dep tree | f64 / AutoDiff | `MultibodyPlant::AddCouplerConstraint` (estimate) | yes | none found | 425 MB |
| Newton Dynamics 4 | zlib | C++; optional AVX2/CUDA | f32 or f64 build (estimate) | gear/pulley joints (estimate, not verified) | yes (estimate) | none found | 2,385 MB |
| ODE 0.16 | BSD-3 or LGPL (dual) | C/C++; no hard deps (libccd optional) | f32 or f64 (`dDOUBLE`) | **Transmission joint** (parallel, intersecting, chain; backlash) | yes: velocity motor with FMax (classic idiom) | none maintained found | 33 MB (mirror) |
| Bepu Physics 2 | Apache-2.0 | C# / .NET 8, heavy `System.Numerics` SIMD | f32 | `AngularAxisGearMotor` (estimate) | via motors | none found; only an open question | 22 MB |
| Avian (Bevy) | MIT / Apache-2.0 | Rust, needs Bevy ECS | f32/f64 features | none known | via motors | runs where Bevy runs (wasm) | 11 MB |
| Box3D 0.1 (alpha) | MIT | C, no deps | f32 + double positions | **none** | **yes** (+ joint forces reported) | Emscripten build documented in README | 5 MB |
| RBDL | zlib | C++; Eigen | f64 | via custom constraints | no | none found | 16 MB |
| Pinocchio 3 | BSD-2 | C++; Eigen, (Boost, coal/hpp-fcl for collision) | f64 | via constraint models | no | none found | 44 MB |
| Bullet `btMultiBody` | zlib | C++ | f32/f64 | `btMultiBodyGearConstraint` (estimate) | `btMultiBodyJointMotor` max impulse | ammo.js exists but **has no btMultiBody** (measured: 0 matches in ammo.idl) | — |
| PhysX 5 articulations | BSD-3 | C++ | f32 | `PxGearJoint`, `PxRackAndPinionJoint` (maximal-coordinate joints) | articulation joint friction | physx-js-webidl exists; gear joints exposed? **not checked** | — |

### Project Chrono (top native candidate)

- **What it gives over Rapier.** A real multibody engine in f64. It has gear, rack-and-pinion and
  pulley links (`ChLinkLockGear`, `ChLinkMateRackPinion`, `ChLinkLockPulley`), and limits on
  `ChLinkLock*` joints ("ChLinkMate classes do not" have limits). Motors are `ChLinkMotorRotation*`
  and `ChLinkMotorLinear*`, driven by `ChFunction`. Spring-dampers are `ChLinkTSDA`/`RSDA`.
  Sources: https://api.projectchrono.org/links.html, https://api.projectchrono.org/motors.html.
  Constraints are solved as a whole system. The available solvers are PSOR, APGD and
  Barzilai–Borwein (all handle hard contact, "DVI"), MINRES, ADMM, and direct SparseLU/QR. Time
  steppers are the default `EULER_IMPLICIT_LINEARIZED` and second-order `HHT`; HHT "can't
  currently handle DVI hard contacts". Source: https://api.projectchrono.org/simulation_system.html.
- **Contact.** NSC is non-smooth complementarity contact (hard, fine at large steps). SMC is
  penalty contact (compliant, needs small steps). Same source as above. Collision runs on a
  Bullet-derived collision system. I did not verify how its cylinder manifolds behave, and knap's
  contact problems could come back with it.
- **Browser.** Official tutorial "Build Chrono for WASM" with emcmake, CMake and Ninja (release
  10.0.0 as the example). Eigen ≥ 3.3 is required and ≥ 3.4 recommended; GLM is needed only for
  WebGL visualisation. Command-line demos run under Node. It warns that "Other modules might
  require additional settings and dependencies". Build time is 15–25 min. It says nothing about
  threads or WASM size. https://api.projectchrono.org/tutorial_install_chrono_emscripten.html
- **Browser complications (estimate).** OpenMP must be off; `Chrono::Multicore` is out. Assets
  and the filesystem are only needed for demos. The core WASM is probably several MB (Eigen
  templates, many link classes). Not measured.
- **Version and maintenance.** 10.0.0 was announced 27 March 2026 (https://groups.google.com/g/projectchrono/c/OGb3bWbCjbc).
  Last push 2026-11-25 (API, measured). Licence BSD-3 (API).
- **Mapping to knap.** Good. Rebuilding on Play is cheap: create a `ChSystemNSC`, add bodies, add
  links. Bodies are rigid with compound collision shapes. Hinges map to `ChLinkLockRevolute` with
  limits, sliders to `ChLinkLockPrismatic`, cylindrical joints to `ChLinkLockCylindrical`, gears
  to `ChLinkLockGear`, which couples the two Z axes with a ratio. Joint friction may be available
  as a limit/friction feature of ChLinkLock, or else as a motor with bounded torque. **I could not
  confirm this from the docs; it is the first thing to check.** A single-threaded run should be
  deterministic (estimate).
- **Main risks.**
  - The default implicit-Euler stepper is first order and damps numerically. Pendulum energy
    could fall the other way from Rapier's, and HHT cannot be combined with hard contact.
  - Contact quality for cylinders and hulls is unknown.
  - WASM size, and the cost of an embind wrapper over a large C++ API.
- **Effort (estimate).** 1–2 person-weeks to a Node prototype with a thin embind or C-API
  wrapper running the battery. 4–8 person-weeks to replace `sim.ts` (2,189 lines today).

### Simbody

- **What it gives over Rapier.**
  - True internal-coordinate (Featherstone-family) dynamics in f64 with error-controlled
    integrators, so energy behaviour is the best of this list in principle.
  - `Constraint::CoordinateCoupler` is a holonomic constraint from a user function, which gives
    exact gear couplings. Docs: https://simtk.org/api_docs/molmodel/api_docs22/Simbody/html/classSimTK_1_1Constraint_1_1CoordinateCoupler.html.
    Gear example: https://sources.debian.org/src/simbody/3.7%2Bdfsg-5/examples/ExampleGears.cpp.
  - Loop closure by constraints.
- **Contact.** Weak for knap: it is built for biomechanics, with compliant Hunt–Crossley contact
  on spheres, ellipsoids and meshes (estimate).
- **Browser.** It needs LAPACK/BLAS (claim, https://github.com/Lemm/simbody), so a Fortran or
  CLAPACK build for WASM is needed. No Emscripten build found. Apache-2.0, last push 2026-11-24
  (API).
- **Effort (estimate).** 4–8 person-weeks. The risks are LAPACK in WASM, contact, and an API
  based on mobilizers, which means knap would have to choose a spanning tree.

### DART

- **What it is.** BSD-2 (API), f64, Featherstone dynamics with an LCP contact solver, from
  Georgia Tech (https://dart.readthedocs.io/en/latest/overview.html). It exposes the mass matrix
  and Coriolis terms.
- **Dependencies and browser.** The dependency tree (Eigen, FCL, assimp, optional
  Bullet/ODE/octomap) is the main porting cost. No WASM build found.
- **Features.** I did not re-verify joint Coulomb friction or mimic joints for gears.
- **Effort (estimate).** 4–6 person-weeks, mostly the dependencies.

### Drake (too large)

- **What it is.** BSD-3, MultibodyPlant with strong convex contact solvers (SAP) and hydroelastic
  contact, f64 and AutoDiff. It is the most accurate option for contact-rich mechanisms.
- **Why not.** It builds with Bazel (https://drake.mit.edu/from_source.html) against a large
  native dependency set (LCM, VTK, optimisation solvers, and more). No WASM build was found and
  none is planned that I could see. Its scope (planning, optimisation, systems framework) is far
  beyond knap.
- **Effort (estimate).** Over 10 person-weeks, with a large WASM output. Not recommended; it is
  useful only as a reference design for contact.

### Newton Dynamics 4

- **Licence and status.** zlib (claim; https://github.com/JulioJerez/newton-dynamics). The old
  MADEAPPS repository says it "has been discontinued" in favour of that one
  (https://github.com/MADEAPPS/newton-dynamics). The new repository has 49 stars, one main author,
  no releases, and a 2.4 GB repository (API).
- **Features (from memory, not verified this session).** Newton is known for an exact
  "skeleton" solver for articulated chains and for gear and pulley joints, which would suit knap.
- **Browser.** No WASM build found. The demos are OpenGL. Threads, and optionally AVX2/CUDA, need
  to be disabled.
- **Effort (estimate).** 4–8 person-weeks. The highest risk is the bus factor and thin
  documentation.

### ODE (Open Dynamics Engine)

- **Features.**
  - Has the **Transmission joint** (added in 0.14, patch #182: https://sources.debian.org/src/ode/2:0.14-2/CHANGELOG.txt/).
    Its modes are parallel axes, intersecting axes and chain, with backlash modelled in the
    joint. A Webots discussion reports the chain mode worked well and the intersecting mode was
    hard to use (https://github.com/cyberbotics/webots/discussions/5948).
  - `dHinge2` is a steering-wheel joint, not a gear.
  - Joint friction uses the standard idiom of a velocity-zero motor with `dParamFMax` set to the
    friction torque (estimate). This is the same thing knap does in Rapier, but ODE's
    direct-solve `dWorldStep` holds it without creep.
  - Limits are `dParamLoStop`/`HiStop`.
  - It can build in f64 (`dDOUBLE`).
- **Contact.** Cylinder collision has historically been weak (cylinder–cylinder via libccd only;
  estimate).
- **Browser.** It is small C with no dependencies, so it is easy to Emscripten (estimate, no
  maintained build found).
- **Maintenance.** Low: the GitHub mirror was last pushed 2024-01 (API). Upstream is on Bitbucket.
- **Effort (estimate).** 1–3 person-weeks. The risks are the old ERP/CFM solver, energy
  behaviour, contact quality, and maintenance.

### Bepu Physics 2 (C#)

- **What it gives.**
  - Excellent dedicated convex pair testers, including cylinders (estimate).
  - A rich constraint library: hinges, limits, motors, and an angular gear-motor style
    constraint (estimate).
  - Deterministic on one platform with fixed threading (estimate).
- **Browser.**
  - The route is .NET 8/9 `browser-wasm`, which means shipping the .NET runtime (several MB),
    or the experimental NativeAOT-LLVM.
  - The engine "heavily uses System.Numerics.Vectors types" and needs a compiler that consumes
    them (claim, https://github.com/bepu/bepuphysics2).
  - A maintainer discussion asking whether anyone has run it in WASM expects no vectorisation
    there (https://github.com/bepu/bepuphysics2/discussions/80).
- **Licence and maintenance.** Apache-2.0, last push 2026-10 (API). f32 only.
- **Effort (estimate).** 3–6 person-weeks. The risks are performance without SIMD, runtime size,
  and JS interop. It solves knap's contact group but is the same impulse-solver class as Rapier
  for joints.

### Avian, or a bare Rust XPBD/TGS solver

- **Avian.** MIT/Apache, Rust. It uses an impulse-based, substepped soft-constraint solver
  (TGS-soft style) for contacts, with joints solved by XPBD (claim; https://docs.rs/avian3d,
  issue https://github.com/Jondolf/avian/issues/346).
- **Why it does not help much.** It is a Bevy plugin, so using it without the Bevy ECS is
  impractical. It has no gear joint, and its collision is parry, the same library that causes
  knap's contact group. It would fix little.
- **Bare XPBD.** Small-step XPBD (Müller et al. 2020, "Detailed rigid body simulation with
  extended position based dynamics") is attractive for pendulum energy and is easy to write,
  but it is still maximal-coordinate and iterative.

### Box3D (new)

- **What it is.** MIT, plain C, by Erin Catto. Announced 29 June 2026 and described as alpha
  (https://box2d.org/posts/2026/06/announcing-box3d/).
- **Features (README, https://github.com/erincatto/box3d).**
  - Joints: revolute, prismatic, distance, motor, weld and wheel, with **limits, motors, springs
    and joint friction**.
  - **Joint and contact forces reported.**
  - Cross-platform determinism with record/replay, and double-precision positions.
  - The README documents an Emscripten build.
- **What it lacks.** **No gear joint, and no cylinder shape** (hulls, capsules, spheres, meshes
  and height fields only).
- **Assessment.** It is small enough (5 MB repository) that adding a gear joint in C is
  realistic. It is the same soft-step (TGS-soft) solver family as Rapier, so pendulum energy loss
  could be similar.
- **Effort (estimate).** 1–2 person-weeks plus the gear joint. Strictly it has a documented
  browser build, so the sibling spikes may want to measure it directly. It is cheap to try.

### Reduced-coordinate (Featherstone) libraries

- **RBDL.** zlib, Eigen. Has `ConstraintSet` loop and contact constraints, no collision. A good
  core with no contact story.
- **Pinocchio.** BSD-2, Eigen, collision via coal/hpp-fcl. Fast articulated-body algorithms,
  constrained dynamics with proximal solvers. A robotics focus and a heavy template build. No
  WASM build found (search, no result).
- **Rapier multibody.** Already measured in this project: no improvement, and no limits on
  generic multibody joints from JS (docs/RAPIER.md). The Rust source has loop closure only
  through impulse joints added to the multibody. That was seen in a comment in
  `multibody.rs:1658`; the mechanism was not traced.
- **Bullet `btMultiBody`.** It has multibody gear constraints and joint motors (estimate). It is
  not in ammo.js: `grep -c btMultiBody ammo.idl` → 0, and there is no `btGearConstraint` either.
  Using it means a custom Emscripten build of Bullet with new IDL entries, about 2–3 person-weeks
  (estimate).
- **PhysX 5 articulations.** Reduced-coordinate, with joint friction, limits and drives.
  `PxGearJoint` and `PxRackAndPinionJoint` exist in 5.2/5.3 for ordinary rigid-body joints
  (https://nvidia-omniverse.github.io/PhysX/physx/5.3.1/docs/Joints.html). A browser build
  exists, so it belongs to the physx spike.

### For comparison: the ready builds

- **JoltPhysics.js.** The IDL exposes `GearConstraintSettings`, and `HingeConstraintSettings`
  has `mMaxFrictionTorque` (measured by grep). `RackAndPinion` appears only as an enum subtype;
  there is no settings interface in the IDL (measured).
- **MuJoCo.** `@mujoco/mujoco` ships official WASM bindings described as "WIP"
  (https://raw.githubusercontent.com/google-deepmind/mujoco/main/wasm/README.md). Its equality
  constraints (`connect`, `weld`, `joint` with `polycoef`) give loop closure and gear couplings in
  generalised coordinates (https://mujoco.readthedocs.io/en/2.3.0/XMLreference.html). It is the
  closest existing thing to the "write our own" design below, so the mujoco spike's B6/B8
  numbers are the most important input to this decision.

## The "write our own" option

**What exists.** `src/core/kinematics.ts` (523 lines) already turns the model into rigid
`bodies`, `joints` and `bodyOfPart`:

- `joints` hold the type (`revolute | cylindrical | prismatic`), origin, axis and
  `limits: [lo, hi]` for sliding.
- `bodies` carry a `fixed` flag.
- `src/core/gears.ts` classifies gear pairs (`gearContact` → `'mesh'` and others) with exact
  tooth counts.

So the mechanism graph (nodes are rigid groups; edges are joints and gear meshes) is already
computed and deterministic. That is the input a reduced-coordinate solver needs.

**Design (estimate), modelled on MuJoCo.**

1. **Generalised coordinates.** Pick a spanning tree of the joint graph rooted at the fixed body
   (or a 6-DOF free joint for free roots). Coordinates q are the hinge angles and slider
   displacements, so a cylindrical joint gives 2.
2. **Gear meshes between two tree hinges are linear constraints** q_b = −(r_a/r_b)·q_a. They can
   be **eliminated exactly** with a constant null-space basis (q = N·z). Gear trains of any
   length then become rigid, energy-conserving and free of drift, with no per-step angle limit.
   That removes the whole gear section of docs/RAPIER.md: braking above 0.1 rad/step, phase
   feedback, the lead offset, the energy guard on meshes, and non-convergent long trains. Gear
   loops that are infeasible show up as a rank-deficient N at build time, which is also a better
   editor error than a runaway.
3. **Kinematic loops (four-bars, parallel beams) are non-tree joints**, held by constraint rows
   J·q̈ = −J̇·q̇ − Baumgarte terms, plus a position projection (Gauss–Newton on the loop closure)
   after each step. The mass matrix comes from CRBA and is dense. For knap's 6–50 DOF, a dense
   Cholesky of M and the KKT system costs microseconds to tens of microseconds in JS (estimate).
4. **Integration** in f64, which JavaScript gives for free, so the f32 problems disappear. Use
   semi-implicit Euler, or implicit midpoint and RK4 for jointed-only scenes, with the same
   1/480 s step and no 240 substeps.
5. **Joint friction and limits** as complementarity or box-constrained rows in joint space
   (|τ_f| ≤ μ·load). The joint-space reaction comes out of the solve, so the static load estimate
   `loadMasses` goes away. One-way (ratchet) joints are a unilateral limit row, which is trivial
   here.
6. **Contact.** Collision detection comes from a library (parry via a slim wasm-bindgen wrapper,
   Jolt's or Bullet's narrow phase, or a hand-written GJK/EPA with a proper face-clipping
   manifold). Contact rows are mapped through the body Jacobians into joint space. A PGS or
   convex solve (MuJoCo-style) runs on the Delassus matrix A = J·M⁻¹·Jᵀ, with pyramidal or
   elliptic friction cones.

**Hard parts.**

- **Contact and friction with reduced coordinates.** A is dense and couples everything in a
  mechanism. Hard contact needs an LCP/NCP or soft convex solve (MuJoCo's choice). Getting
  stable stacking, rolling wheels, impacts and creep-free rest is where most engines spend their
  years. Knap's own records show that most remaining pain is contact.
- **Singular loops.** A four-bar at toggle, or redundant parallel hinges, give a rank-deficient
  J. This needs SVD or regularised (soft) rows, as MuJoCo's solref/solimp do.
- **Stiffness and stability.** Rigid loop rows with Baumgarte drift, and light parts against
  heavy ones (mass ratios). Implicit joint damping is easy in joint space; stiff contact is not.
- **Free bodies.** Loose parts, carts and dropped beams need a 6-DOF root per body and the same
  contact solver. A hybrid (own solver for joint-connected mechanisms, Rapier for loose parts)
  breaks down as soon as the two touch.

**What comparable projects do.**

- MuJoCo: generalised coordinates, soft convex constraints, equality constraints for loops and
  couplings.
- Simbody and Featherstone codes: internal coordinates with coupler constraints.
- Chrono, Adams and Simscape Multibody: maximal or relative coordinates with a DAE and direct or
  implicit solves.
- Game engines (Rapier, Jolt, PhysX rigid bodies): maximal coordinates with iterative impulses,
  the class whose limits knap has measured.

**Cost (estimate).**

| scope | person-weeks |
|---|---|
| Tree plus eliminated gears plus loop rows plus limits and friction, no contact. Fixed-root mechanisms only; would pass B6, B8 and B9 by design | 3–5 |
| Plus contact (ground half-space, hulls, cylinders), free roots, stacking and rolling, to parity with today's product | 6–12 more |
| Plus robustness, determinism tests and performance | 2–4 more |

The total is 2.5–5 months, with contact the main schedule risk. A staged path keeps Rapier for
contact-heavy scenes while the joint-space solver proves itself on fixed-root mechanisms.

## Ranked shortlist

1. **MuJoCo (ready build, sibling spike).** Not native-port work, but it is the reduced-coordinate
   design knap would otherwise write. Decide after its B6/B8 numbers.
2. **Project Chrono (native, official WASM route).** f64, gear, rack and pulley links, limits,
   hard NSC contact, BSD-3, actively maintained. This is the best native candidate.
3. **Write our own joint-space solver in TypeScript (f64).** The strongest fit for gears (exact
   elimination) and joint friction. The cost is contact.
4. **Box3D.** Tiny, MIT, joint friction and reaction forces, documented Emscripten build. It
   needs a gear joint and a cylinder shape and is alpha. A cheap side spike.
5. **ODE.** Transmission joint and easy port, but old and thinly maintained.
6. **Bullet btMultiBody via a custom ammo build**, then **DART** and **Simbody**: capable, but
   more dependency work for less contact quality.
7. **Not recommended:** Drake (size, build system), Newton 4 (bus factor, documentation),
   Bepu 2 (.NET-in-WASM runtime and SIMD risk; solves contact but not joints), and Avian
   (parry, Bevy-bound).

## Two-day spike: Project Chrono

**Day 1.**

1. Build Chrono 10.0 **core only** (all optional modules off, OpenMP off) with emcmake/Ninja per
   the official tutorial (`-O3`, `ALLOW_MEMORY_GROWTH`). Then build with and without
   `-msimd128`. Record the `.wasm` and `.js` sizes and the build time.
2. Write one C++ driver per test, using plain `main()` printing JSON and run under Node, so no
   embind is needed yet.
3. Run B6a and B6b with `ChSystemNSC` + `ChLinkLockRevolute` at h = 1/480 s, three ways:
   - (a) the default `EULER_IMPLICIT_LINEARIZED` + PSOR;
   - (b) APGD or Barzilai–Borwein with a tight tolerance;
   - (c) HHT with a direct solver (no contact).
4. Report energy change and hinge separation. **The key question: does Chrono's implicit Euler
   damp the triple pendulum more than Rapier's −3.7 %/10 s?**

**Day 2.**

1. **B8** with `ChLinkLockGear` at 2.5:1: ratio error, work in vs kinetic energy, behaviour at
   300 rad/s.
2. **B9** checklist: is there joint friction (look for a friction feature in ChLinkLock, else a
   bounded `ChLinkMotorRotationSpeed`), can reaction forces be read (`GetReaction1/2`-style
   accessors), and are there one-way limits?
3. **B5a and B4b** with Chrono's collision on a box floor and a cylinder or 16-gon. This checks
   whether the cylinder runaway and 4-vertex problems are parry-specific.
4. **B10** cost in ms per simulated second.

**Stop rule.** If B6 or B8 is not clearly better than Rapier at 1/480 s, or the core WASM is over
about 10 MB, drop Chrono and spend the time on prototyping the joint-space solver (gears
eliminated) in TypeScript, using B6b and B8 as acceptance tests.

## Battery results

None. This task was documentation-only (no installs, no builds), so every row is **NOT RUN** for
every engine above.

## Commands actually run

```
curl -sL https://raw.githubusercontent.com/jrouwe/JoltPhysics.js/main/JoltJS.idl -o jolt.idl
grep -n "interface GearConstraintSettings\|MaxFrictionTorque\|RackAndPinion" jolt.idl
curl -sL https://raw.githubusercontent.com/kripken/ammo.js/main/ammo.idl -o ammo.idl
grep -c btMultiBody ammo.idl                      # 0
grep -n btGearConstraint ammo.idl                 # no match
for r in projectchrono/chrono simbody/simbody dartsim/dart RobotLocomotion/drake \
  JulioJerez/newton-dynamics thomasmarsh/ODE bepu/bepuphysics2 avianphysics/avian \
  erincatto/box3d rbdl/rbdl stack-of-tasks/pinocchio jrouwe/JoltPhysics google-deepmind/mujoco
do curl -s https://api.github.com/repos/$r ; done  # size, license, pushed_at, stars
```

(The files were saved in the session scratchpad, not in this directory.) The physx-js-webidl IDL
could not be fetched at the guessed path, so whether it exposes `PxGearJoint` is **not checked**.
