# Rapier: limits met and workarounds applied

What this project had to learn about Rapier (`@dimforge/rapier3d-compat` 0.21.0) and parry, its
collision library, and what the code does about each. Every number was measured in this project;
the full records are in `docs/DEVIATIONS.md` (§5) and `spikes/*/REPORT.md`. Units: 1 unit = 8 mm,
g = 1226.25 units/s², fixed step 1/480 s.

## Solver and joints

- **Joints lose energy, roughly ∝ ω²·h (cause known).** Within a substep Rapier moves each body's centre of mass in a straight line and rotates it about the COM (`integrate_linearized`). A pinned link's anchor therefore drifts off the pivot by about ½(ωh)²·d. The next substep's biased solve pulls it back and the stabilisation pass removes that velocity, so the correction is a perfectly inelastic projection. Losses measured on the triple pendulum over 10 s: −3.7 % at 1/480×240, −34.9 % at ×60, −59.5 % at 9 600 substeps/s.
  - **Workaround:** 240 TGS substeps for jointed bodies (sim.ts `solverIterations`, default 240; h = 1/115 200 s) and 1 PGS iteration.
  - **Cost / still wrong:** the triple pendulum has no robust margin (−3.1 to −11.7 % in 10 s across gravity perturbations; 2 of 20 runs pass the −10 % limit). Jointed models cost 70–259 ms of stepping per simulated second. The knobs that could help are not reachable from JS in 0.21: joint softness (1e6 Hz, ζ = 1), `warmstart_joints` and `num_internal_stabilization_iterations`.
- **Rapier's iteration count is its TGS substep count, and accuracy depends only on the substep length h (measured).** How the substeps are split into outer steps makes no difference to joint error, energy or spin drift, to 2–3 digits. Joint stiffness depends only on substeps per 1/480 s (pull error ∝ roughly h²). Extra PGS iterations cut joint error but not energy loss, and cost about as much as substeps.
  - **Workaround:** keep 1/480 s × 240 substeps. The adaptive gear step (DESIGN §5.1 "Smaller steps at speed") divides the iterations by k so h stays the same.
  - **Cost:** 320 substeps was rejected because the f32 spin gain grows with the substep count (see Energy). 240 is the only count that meets both the loss bound and the gain bound, with little margin either way.
- **Substeps are set per island, not per body.** Each connected component (joints or active contacts; fixed bodies do not link) runs `numSolverIterations` plus the largest `additionalSolverIterations` of its bodies (`island_manager/substep_groups.rs`).
  - **Workaround:** world count 30 (`freeSolverIterations`), and +210 on every jointed body (sim.ts constructor and `buildBodies`).
  - **Cost:** anything touching a jointed body also runs 240. Free-body contacts shift slightly: flat parts rest at 0.911–0.914 against a touching distance of 0.92.
- **Generic joints have no limits in the JS `JointData`.**
  - **Workaround:** a cylindrical joint is `JointData.generic` with LinY, LinZ, AngY and AngZ locked, plus `world.impulseJoints.raw.jointSetLimits(handle, LIN_X, lo, hi)` (sim.ts `createImpulse`; the raw enum values LinX = 0 and AngX = 3 are asserted in tests).
  - **Cost:** depends on the unstable raw API. Related finding (skeptic spike): `JointData.limits` is silently ignored for revolutes; `ImpulseJoint.setLimits` works.
- **Multibody (reduced-coordinate) joints are no improvement.** At the same cost they lost as much energy, and the JS API cannot set limits on generic multibody joints.
  - **Workaround:** impulse joints only. None remaining.
- **Bodies spinning about a non-principal joint axis blow up (the record attributes this to Rapier; mechanism not stated).** The sliding-axle arm reaches the 377 rad/s cap in about 9 s; a tilted bar goes from 20 to 377 rad/s within 2 s. The adaptive-step spike saw much less at k ≥ 2 (peak 251 rad/s at k 1, 52–61 rad/s at k 2–8), which suggests rotation per step plays a part (inferred).
  - **Workaround:** sim.ts `decoupleInertia` zeroes I_ab and I_ac for bodies of planar mechanisms attached to a fixed body (exact for that motion). It skips bodies whose products are below 1e-6 of the trace.
  - **Still wrong:** spatial mechanisms and free-root vehicles keep their true inertia and could still blow up (untested for spatial). A free cart with an eccentric crank showed no spin-up but lost speed.
- **There is no gear constraint (DESIGN §5.1 "Gears"; spikes coupling, skeptic, gearsim).**
  - **Workaround:** one `JointData.generic` per mesh with only LinX locked (Frame 1 defines the locked axis). It is re-anchored before every world step with `setLocalFrame1/2`; re-anchoring takes effect next step and is bit-identical to recreating the joint. The design adds:
    - f64 phase feedback (without it gears drift 0.15–1800 teeth per minute);
    - a "lead" anchor offset for the in-step epicycloid error (1:1 at 50 rad/s: 3.3 % → 0.024 %);
    - a radial stop as a LinY limit via `raw.jointSetLimits`;
    - the frame must be right-handed (X = t, Y = n, Z = −a). Z = +a gave a garbage quaternion and locked the gears; Rapier does not reject it.
  - **Still wrong:**
    - Above about 0.1 rad per world step the row brakes (a 7-hole arm through 1:25 lost 80 % of mgL). From about 0.2 rad/step it kicks and reverses. Hence the adaptive k ∈ {1, 2, 4, 8} (see Performance).
    - The braking onset depends on gear size: 0.14 rad per world step for 8 teeth, 0.096 for 16, 0.08 for 24, 0.06 for 40, i.e. about 0.1/√r. sim.ts `chooseK` therefore weights ω by max(1, √r). Before that a driven 40+40 pair stalled at 29 rad/s with 54 % of the drive work lost.
    - A mesh that engages at speed must not run its first step at the old step size: two gears meeting at matched speed lost up to 98 % of their energy and the input reversed. k now steps up inside the fixed step in which a mesh engages.
    - Rapier's f32 solve of the mesh row adds energy: a meshed pair spinning at 20 rad/s gains about 10 % of its kinetic energy per second (a single gear 1.8 %/s). The gain is linear in substeps per second (4.6 / 9.5 / 20.7 %/s at 120 / 240 / 480) and independent of speed, k, gravity, the lead and the phase feedback. The energy guard removes it (measured 3.4 %K/s removed after an engagement).
    - End-of-step velocities are not converged along long trains: the last gear of 20 meshes runs 2.5 % slow, and static compliance grows with train length (0.035 rad at 40 gears under heavy load).
    - A free-floating gearbox does not conserve angular momentum (12 % for 0.5:2.5, worse at more iterations).
    - Pairs built slightly too close make the stop row fight the revolutes.
- **A collider that touches a meshing partner fights the mesh row.** The axial extension of an 8-tooth gear's hub hole sits 0.045 inside its partner's tip hull. With that contact a 1:5 pair driven by +1000 ran at −6.4 rad/s instead of +41.
  - **Workaround:** gears get no hub or web-hole colliders at all inside or beside the slab (colliders.ts), gear colliders live in their own groups (`gearRound` 0x20 meets ground and plain rounds, `gearHull` 0x40 meets parts only) and never meet another gear.
  - **Still wrong:** gears that are not in mesh pass through each other.
- **Rapier deletes a body's joints when the body is removed** (`removeRigidBody`).
  - **Workaround:** mark mesh pairs dead and never touch the stale handle (check `isValid()`). `jointError` skips joints whose bodies were removed.
- **Rapier's default motor max force is unlimited.** An infeasible gear loop driven by an unlimited motor runs away (triangle: 399 rad/s, about 11 teeth of phase error).
  - **Workaround:** the product has no unlimited drives. The grab is a mass-scaled spring.

## Energy

- **Free rotation gains speed (cause known, reproduced to 4 digits in an f32 emulation).** Rapier's per-substep gyroscopic correction (`gyroscopic_corrected_angvel`) is on by default and cannot be turned off from the 0.21 JS API. It rotates ω with an f32 quaternion whose |q|² ≈ 1 + 6.7e-8 after `normalize()`, and glam's `Quat*Vec3` assumes a unit quaternion. So ω grows about 1e-7 per substep: ∝ substeps, independent of joints, varying with inertia and ω.
  - Jointed bodies: +0.26 to +1.35 %/s. Free bodies at 30 substeps: +0.17 to +0.24 %/s.
  - Over 30 s, total energy rises up to +50 % of peak KE (spatial chain, sliding axle); a free cart at 100 units/s gains +45 % in 20 s.
  - **Workaround:** the energy guard (sim.ts `guardEnergy`, option `energyGuard`, band `energyGuardBand` 1 %). Per joint- and contact-connected group it uniformly scales velocities down when E exceeds its running minimum by more than max(1 % of peak KE, floor). Groups are merged on Rapier collision-start events. Friction work is subtracted from the reference.
  - Rejected: a nudged principal frame and inertias (it over-corrects and depends on this exact Rapier/glam build). Also the reason 320 substeps was not adopted.
  - **Still wrong:** energy may still rise up to 1 % of peak KE; a spinning axle settles at +0.5 % ω. Gain in one body is taken from the whole group. Energy set by code between steps is accepted only on the next step. Guard cost is +1–2 %. The real fix (rotate with a matrix, divide by |q|², or expose `enable_gyroscopic_forces`) belongs in Rapier.
- **Rapier has no joint friction (and no rolling resistance).**
  - **Workaround:** a velocity motor with target 0 on each free axis, configured through the raw API: `raw.jointConfigureMotorModel` (AccelerationBased), `raw.jointConfigureMotorVelocity` (gain `FRICTION_GAIN` 1e9) and `raw.jointSetMotorMaxForce` = τ_f or F_f (sim.ts `applyFriction`, `frictionAxes`).
  - Measured: `maxForce` is a force or torque, not an impulse, so it does not depend on the substep count. The motor saturates when sliding. A low gain acts as a soft damper (creep); ≥ 1e6 is rigid. Limits still hold with a motor on the same axis. The target-velocity sign equals `jointStates().omega` / `.speed`.
  - **Cost:** +4–11 % stepping. A free wheel with no axle friction never stops (no rolling resistance).
- **A motor is one Gauss–Seidel row per substep, so a held joint creeps.** A 2-hole link at 90 % of τ_f slipped 1.2e-3 rad/s. An up-built pendant wandered 1.3° in 6 minutes. The four-bar at μ ≥ 2 crept 0.4°/s.
  - **Workaround:** the stiction hold in sim.ts `updateFriction` (`STICK_SPEED` 0.01, `SLIP` 2e-4, `HOLD_DEADBAND` 1e-5). The motor target is set to −offset/fixedDt to return to the stuck coordinate.
  - **Still wrong:** the hold can return at most τ_f·SLIP of energy per stick. A part held by a *contact* on a moving part still creeps (0.12° in 50 s): that is Rapier's contact creep.
- **Joint reaction forces are not exposed.**
  - **Workaround:** a static load estimate m_j (sim.ts `loadMasses`; free-root ground sinks). Mesh friction was omitted for the same reason.
  - **Still wrong:** friction ignores centrifugal and impact loads. Wheels touching down after Play carry no share. A 7-hole arm falls almost freely through 1:25 at Realistic. (Contact impulses via `world.contactPair` were proposed for axles but not adopted.)

## Contacts

- **Parry keeps only the first four vertices of a polyhedron face for a contact manifold (cause known; re-examined in `spikes/rapier-limits/polygon`).** In `ConvexPolyhedron::local_support_feature`: `face.num_vertices_or_edges.min(4)`, with a TODO ("select four vertices that maximize the area"). A 3-hole beam lying on a 9-hole beam was gone in 1 s.
  - **What the face becomes: one quad.** The four are consecutive vertices of the face's boundary loop, closed by a chord from the fourth back to the first. Not two triangles, not four loose points: contact points from edge crossings land exactly on the chord. Which four depends on the hull builder's triangle order. The quad covers about 4 % of a regular 16-gon, 25 % of an octagon, 50 % of a hexagon.
  - **Outside the quad** a convex–convex pair still gets one point: the closest/deepest pair from GJK/EPA is always added in 3D. One soft point does not hold a body: at Rapier's own defaults (g 9.81, 1/60 s) a box on the cut-off part of a 32-gon tilts 7.5° and sinks 0.063; on a 0.02-thick plate it falls through. The sink grows with gravity (0.023 at g 2.45, 0.175 at g 78.5), so at this project's gravity it is always a fall-through.
  - **Against a half-space** there is no extra point at all (`contact_manifold_halfspace_pfm` emits only the kept vertices): an n-gon prism with n ≥ 6 lying on a half-space tips about 45° and sinks, at both scales.
  - A deliberate approximation that is wrong at any scale; upstream knows only through the TODO.
  - **Workaround:** shapes.ts `bevelledPrism` / `prismShape` with `BEVEL` = 0.01. Every end face is a kept 4-vertex rectangle surrounded by facets sloping 1.5–8°.
  - **Still wrong:** a part whose COM lies outside the rectangle rests a few degrees tilted. A beam rolled past the 1.5–3.5° facet slope (an r 4 wheel lying across a loose beam) gets half-space contact on one end facet and sinks about 0.4–0.6 into the floor (0.36 at 20 s). Left as a known limit because changing `BEVEL` changes every recorded trajectory.
- **Rapier's convex-hull builder merges nearly coplanar facets back into one face.** The test is n1·n2 > 1 − √(f32 ε), i.e. a dihedral below 1.5057° (measured: merged at 1.505°, separate at 1.510°). That re-triggers the 4-vertex limit: a 0.005 bevel merged and fell through, 0.006 held. For large radii it fails above roughly r > 80–100 × bevel.
  - **Workaround:** `BEVEL` 0.01 for parts. `WHEEL_BEVEL` = 0.02·r for the wheel ground guard. The wheel hull uses wedges (6-point pieces, every face ≤ 4 vertices, no bevel).
- **Parry returns one contact point where a beam edge crosses a hull end face (cause known: printed manifolds).** A wheel lying across a beam pivoted on that point and sank 0.37–0.458 (of HC = 0.46). This is not the 4-vertex limit: a native cylinder sank the same.
  - **Workaround:** the wheel hull is 32 wedges × 2 slabs (shapes.ts `wheelHullPieces`, `WHEEL_SEGMENTS` 32, `WHEEL_SLABS` 2), 64 convex-hull colliders per wheel.
  - **Cost:** ×1.15 on the Cart and up to ×2.4 while a wheel rests on a part. An r 4 wheel 1 off the hub on a loose beam still reaches 0.067.
- **Contacts between two dynamic bodies are soft (`contact_natural_frequency` 30 Hz). Resting depth grows with the load per contact point.**
  - Upright wheels on a loose beam sank 0.03–0.06 (0.002–0.003 on a fixed beam); a parked cart 0.165.
  - The natural frequency is what matters: 5×5 plate on a loose beam, 0.019 at 30 Hz, 0.0012 at 120 Hz. Substeps, PGS iterations and the guard made no difference.
  - **Workaround:** two slabs double the contact points (upright r 2.5: 0.0077; parked: 0.023). The frequency was not changed because it is global and would alter every recorded trajectory. Contact skin and dominance groups were not tried.
  - **Still wrong:**
    - Tooth-contact ratchets crush through (an r 1 gear holds only 2–4 pawl-weight·units at 30 Hz), so contacts cannot serve as a ratchet. A one-way revolute row was proposed instead (spike teeth2).
    - A loose beam under a wheel sinks 0.014–0.058 into the floor.
    - Supersession: DEVIATIONS §5 "Tolerance scales" says 60/120 Hz changed none of the tested numbers, and "Contacts" says the setter had no measurable effect. Later spikes (teeth2, M7 fix) show it clearly matters for dynamic–dynamic contacts.
- **Contacts with fixed bodies use `static_contact_softness` (60 Hz, ζ = 10), which the 0.21 JS API does not expose.** The JS `contact_natural_frequency` setter affects dynamic–dynamic contacts only.
  - **Workaround:** none; documented limit.
- **Native cylinder narrow phase (re-examined in `spikes/rapier-limits`, which corrects the wheels spike).**
  - How parry sees a cylinder against a box or hull (`polygonal_feature_map.rs`): the curved side is one line segment, each cap an inscribed square (64 % of the cap) turned toward the contact, switching between the two when the contact direction is 60° from the axis. A half-space uses a different routine.
  - (a) The exact cylinder–cylinder test costs about 0.6 ms per rotated, coaxial, nested pair per step, even with contacts disabled. Every pin in a hole is such a pair; the 4-body four-bar cost about 2.5 ms/step.
  - (b) **A rolling cylinder (or capsule) on a cuboid or hull accelerates by itself. This is a defect in parry, present at Rapier's own defaults.** g 9.81, 1/60 s, default iterations, sleeping on: a 0.5 m cylinder given 0.05 m/s reaches 0.52–0.55 m/s on a fixed cuboid and keeps 0.0500 on a half-space (`spikes/rapier-limits/minimal.mjs`).
    - Cause (shown by a single switch): `contact_manifold_pfm_pfm` reuses the previous step's contact points through `try_update_contacts_eps(cos 1°, 1e-6)` as long as the normals agree within 1° and each point's material position slid less than 1e-3. In pure rolling the material point at the contact does not slide, so the points stay frozen until the body has turned 1°. The support then trails the centre by up to r·1°, which acts as a downhill slope in the direction of travel.
    - The push stops once the body turns more than 1° per step, so speed climbs to about v* = r·(π/180)/dt and stays: 0.52 m/s for r 0.5 m at 1/60 s; 8.4 units/s for r 1 at 1/480 s, which is the wheels spike's "0 → 8.4 units/s". Measured plateaus are within 0–6 % of v* for r 1 and 2.5 and dt 1/240–1/960.
    - The switch: moving the fixed floor ±0.1 along the cylinder's axis every step (which defeats the reuse without changing what the cylinder touches) takes 8.83 → 0.48 units/s and, at SI, 0.519 → 0.054 m/s; ±0.0003 (below the threshold) changes nothing.
    - No setting reachable from JS helps (contact frequency, iterations, dt, prediction, allowed error, soft CCD, Rapier's own contact recycling switched off through a hook). A ball does not run away; a half-space floor does not; prisms do not, but they cannot roll freely.
    - A wheel standing on its rim on a beam does the same and rolls off the beam end in 1.5–1.9 s (9 of 24 runs within 2 s). This is the old "(d) runs away upright on beams".
  - (c) **Retracted: "a cylinder against a convex hull falls through at rest with zero contacts".** In 2,496 rest tests (cuboid, box-hull, 9-hole arm and 1-hole barrel floors, both scales) no cylinder fell through a hull it was still over. The wheels spike's cases were (b): the cylinder rolled off the end of the beam and then fell past it; the old script printed y and the contact count but never x. Reproduced to the digit with x printed.
  - **Retracted: "tunnels" through a cuboid.** Every 400 units/s fall was a roll off an edge.
  - Two small defects remain: the manifold can be empty for 1–2 steps while a cylinder rolls over a floor edge, and a cap placed exactly flush and centred on a box gets a horizontal first normal and drops 0.04–0.1.
  - **Workaround:** part cylinders become circumscribed 16-gon prisms (`DEFAULT_CYLINDER_SEGMENTS`), and a liftarm run becomes one stadium prism. A wheel's native cylinder ("round") meets only the ground and other rounds (`GROUP` bits in sim.ts); it carries the mass, friction 0.8. The hull meets parts. The ground is a half-space.
  - **Still wrong:**
    - Prisms cannot roll (they lose energy per facet), so a wheel rolling along a beam slows quickly.
    - A wheel–wheel round pair costs about +190–230 ms per simulated second whenever their bounding boxes overlap.
    - Polygon-against-polygon friction drive does not work (μ_eff 0–0.08), so drive rims must be cylinders.
- **Cylinder on a half-space takes the cap as 4 points when the disc is near flat.** A wobbling r 4 wheel sank 1.04 into the floor.
  - **Workaround:** a third "ground guard" collider (shapes.ts `WheelShape.guard`, `GUARD_INSET_R` 0.12, `GUARD_INSET_A` 0.02, group bit 16, frictionless, `CoefficientCombineRule.Min`).
  - **Still wrong:** a wobbling wheel still sinks 0.05–0.17 before the guard catches it.
- **The cylinder–half-space contact is soft and its sink grows with speed and load.** Sink: 0.006 at rest, 0.015 at 120 units/s, 0.063 at 330 units/s, about 0.08 at 400 units/s. Under the full grab force, light wheels were pushed 1.05–1.47 into the floor.
  - **Workaround:** the guard inset was chosen above the rolling sink. `GRAB_PRESS_LIMIT` = 2× weight for the grab's into-floor component.
  - **Still wrong:** the effective rolling radius shrinks slightly with speed. Any other sustained large force would sink a light wheel.
- **Half-space contact depends on collider creation order and on distance from the half-space's origin (measured; pure-Rapier repro in `spikes/review-wheels/bowl7.test.ts`).** Created after a body, it drifts toward the plane's origin "like a bowl": a wheel 100 units away rolled 0.346 in 20 s.
  - **Workaround:** sim.ts constructor calls `buildGroundCollider()` before `buildBodies()` (now 1.6e-3).
  - **Still wrong:** residual drift grows with distance and time (1000 units: 1.3e-2 in 20 s). §5.3's rest bound fails from about 300 units at 30 s. Suggested fix, not done: re-centre the half-space origin.
- **Only a half-space works as ground.** A cuboid floor gives the cylinder runaway and impacts up to 0.37 deep.
  - **Workaround:** a fixed body with a `HalfSpace` collider, made tangent to the lowest collider (shapes.ts `groundPlane` / `lowestGroundPoint`).
- **Resting-contact creep (solver noise in the friction rows; sleeping is off).**
  - Native cylinder on the half-space: about 1e-5 units/s, and 1e-2 in 20 s at 30 substeps.
  - A free four-bar lying on the floor: about 4e-3 units/s, constant and not decaying (about 2.5 units in 10 minutes).
  - Beams rest 0.004–0.008 below the touching distance.
  - **Workaround:** none beyond 240 substeps. Free-vehicle tests allow 1e-3 rad of relative joint rotation instead of 1e-4.
- **Fast impacts penetrate transiently.** At 310 units/s a part moves 0.65 units per step, giving 0.0–0.29 penetration depending on step phase. Later measured up to 0.70 for one or two steps (15-hole beam on end, 157–280 units/s). Nothing has passed through.
  - **Workaround:** soft CCD on free bodies (below). Tests use bounds below the measured range.
- **Symmetric fast impacts on a flat face throw the part sideways (reproduced with two native Rapier cuboids).** Impulses over the 4 points are uneven (264/178/287/161), giving about 10 % of the impact speed sideways plus spin (36 rad/s). More PGS iterations do not change it.
  - **Workaround:** none; documented limit.
- **Hard CCD clamps jointed pairs whose contacts are disabled.** An axle sliding in its hole stalled for a step above about half its thinnest collider piece (about 180 units/s).
  - **Workaround:** `integrationParameters.maxCcdSubsteps = 0`. Unjointed bodies, wheels included, get `setSoftCcdPrediction(SPEED_CAP·fixedDt·1.25)` (sim.ts `buildBodies`). Predictive contacts respect joint contact exclusion.
  - **Cost / unsure:** the wheels spike blamed soft CCD for hull wheels falling through liftarms (17/24); this did not reproduce later (0 of 2 × 816), cause not found. Soft CCD did not stop tooth tunnelling at 200 rad/s. Jointed bodies have no CCD.
- **Speculative contacts and `lengthUnit`.** `lengthUnit` scales only contact tolerances (defaults: allowed penetration 0.005, prediction 0.02) and the linear speed cap, not joints. At `lengthUnit` 10 the 0.2 prediction distance exceeds the 0.08 gap between layers, and the four-bar stalls (−109 % of KE_max); with prediction scaled back, impacts go deeper.
  - **Workaround:** `lengthUnit` 1.
  - **Cost:** the 400 units/s cap stays (see Numerics).
- **Contacts are solved every substep, so contact count sets the cost.** Splitting liftarms into ≤ 4-vertex strips tripled the collision example (about 1300 ms per simulated second).
  - **Workaround:** one stadium prism per liftarm run. No tooth colliders (teeth meeting every part cost ×3.4; a gear lying on its teeth ×7–35). Gear colliders never collide with other gears.
  - **Still wrong:** gears not in mesh pass through each other.

## Numerics

- **Speed clamps (measured; not configurable from JS except via `lengthUnit`).**
  - Linear: 400 units/s (3.2 m/s) at `lengthUnit` 1. Falling parts hit it, reaching y = −400 at 1.16 s instead of 0.81 s.
  - Angular: π/4 rad per Rapier step, i.e. 377 rad/s at 1/480 s.
  - The angular clamp moves with dt (754 rad/s at k 2); the linear one does not.
  - **Workaround:** `SPEED_CAP` 400 sizes soft CCD. The gear code releases meshes above 350 units/s (a meshed gearbox at the 400 clamp explodes: phase 10–20 teeth, guard removing 6.6e8). It caps engaged gears at 300 rad/s by group-uniform velocity scaling; a single-body clamp whips neighbours and damping over-brakes.
  - **Still wrong:** wheels skid above 377·r units/s. Gear ratios break near 377 rad/s. Examples stay below the caps (186 units/s, 175 rad/s).
- **f32 positions and rotations.**
  - (a) Far from the origin slow motion stalls below about ulp/dt: 0.23 units/s at 5000 units, 0.03 at 1000, 3.7e-3 at 100. The Cart example at +5000 froze after 2 s.
  - (b) f32 quaternions drive the spin gain (Energy).
  - (c) f32 pose resolution of about 1e-9 rad per substep makes stiction slip visible near the build pose and 180° from it. A held mechanism reports about 5e-3 rad/s without moving.
  - **Workaround:**
    - Body reference point at the f32-rounded mean of its cell centres (short lever arms; displacement exactly the identity at t = 0).
    - Output quaternion renormalised in f64.
    - Guard noise floor `NOISE` 1e-5·Σm|g|(1+|com|).
    - `STICK_SPEED` and `HOLD_DEADBAND` sized above the f32 noise.
  - **Still wrong:** the far-from-origin stall is not fixed. Suggested: simulate in a model-centred frame.
- **Sleeping is off** (`setCanSleep(false)`), for determinism. Runs are bit-identical across runs and processes.
  - **Cost:** resting contact creep is never frozen (above).

## API gaps

- Raw or unstable API used: `impulseJoints.raw.jointSetLimits` (generic-joint limits; gear radial stop), `raw.jointConfigureMotorModel`, `raw.jointConfigureMotorVelocity`, `raw.jointSetMotorMaxForce` (friction motors), with raw enum values cast in sim.ts (`LIN_X`, `ANG_X`, `ACCELERATION_BASED`).
- Not exposed in 0.21 JS: joint softness, `warmstart_joints`, `num_internal_stabilization_iterations`, `static_contact_softness`, `enable_gyroscopic_forces`, joint reaction forces, limits on generic multibody joints.
  - **All of these exist in the Rust API** (Rapier 0.36): `GenericJoint::set_softness`, `IntegrationParameters.{warmstart_joints, num_internal_stabilization_iterations, static_contact_softness, normalized_max_linear_velocity, contact_recycling, contact_clustering}`, `RigidBody::enable_gyroscopic_forces`, the public field `ImpulseJoint.impulses`. The JS `IntegrationParameters` wraps 8 of about 20 fields.
  - The JS package is a wasm-bindgen wrapper (about 4,400 lines of Rust plus TypeScript, Apache-2.0) in `bindings/typescript` of the Rapier repository. Exposing one of the above is a setter of a few lines and a rebuild with wasm-pack: a fork of the bindings, not of the engine. Not tried.
  - Needing a patch to the engine itself: the 4-vertex face and the contact-point reuse (parry), a gear or other user constraint (no hook exists), and f64 (a `rapier3d-f64` crate exists, but the TypeScript bindings hard-code `f32`).
- No feature for:
  - gear constraints (generic LinX row re-anchored each step);
  - one-way/ratchet joints (a re-anchored revolute with a [0, π] limit proposed; spike only);
  - per-pair contact stiffness (natural frequency is global; slabs used instead);
  - joint friction (motors);
  - rolling resistance;
  - turning off the gyroscopic term (energy guard).
- Node spike scripts end with `process.exit(0)`: without it Node 20 spins for minutes at exit inside Rapier's wasm-bindgen finalizers (coupling spike; it is not recorded whether tests need this).

## Performance

- Each `world.step` has a fixed cost and JS overhead. Many small outer steps add collision detection and gain nothing (1/9600 × 12 costs 603 against 405 ms per simulated second).
  - **Workaround:** a 1/480 s outer step, `maxStepsPerCall` 16 and `stepBudgetMs` 8 with dropped-step accounting.
  - **Still wrong:** the collision example at 1× drops steps; the Cart needs about 100 ms of physics per real second at ¼×.
- The adaptive gear step (k world steps of dt/k, iterations/k; DESIGN §5.1, spikes adaptive and gearsim) costs 1.0–2.0× per fixed step at k = 8. As built: a 3-gear chain costs 0.90 ms per fixed step at k 1 and 1.21 ms at k 8 (the same chain without teeth 0.58 and 1.26); the Gear train example 0.70–1.25 ms per fixed step with k up to 4 (Node, machine under load).
  - **Still wrong while k > 1:** joints creep about 4e-3 rad in 10 s under ground contact (cause not found); restitution drops from about 0.12 to about 0.03.
- The 240-substep jointed islands dominate cost. Each wheel–ground contact at 240 substeps adds about 67 ms per simulated second. A mesh row costs about 22–53 ms per simulated second, about half a body.

## Unsure

- Whether the non-principal-axis blow-up is a Rapier defect or partly the integration step. The records only say "Rapier blows up"; the adaptive spike's k-dependence hints at rotation per step.
- The raw motor API: the records do not say why motors are configured through `raw` rather than the `ImpulseJoint` methods. Possibly because generic joints lack typed motor methods; inferred.
- Soft-CCD fall-through of hull wheels (wheels spike) never reproduced in the product; cause not found.
- A compound collider of 40 teeth costs like a smooth disc while separate hulls cost ×8–35 (teeth2, "cannot explain").
- A velocity motor on a disc-less arm failed to lift at f = 2 while the same arm with a disc lifted at 1.1 (skeptic, unexplained).
- Free-gearbox angular momentum error and the planetary p_β leak ∝ substep count: likely the same Rapier per-substep artefact as the spin gain, but not proven.
- Settled: the parry version is 0.31. `@dimforge/rapier3d-compat` 0.21.0 is built from Rapier 0.36.0 and parry 0.31 (bindings changelog); the wheels spike's "parry 0.21" confused it with the JS package version.
- Why a driven gear pair reads (E − E0)/drive work ≈ 1.09–1.10 with the guard off: taken to be the mesh row's f32 gain above, not separately proven.
- A loose 8-tooth gear rolling on the ground wanders sideways (0.49 over 160 units; 16 teeth and up 0.003). Not investigated; it rolls on a 32-wedge hull at its tip radius like the others.
