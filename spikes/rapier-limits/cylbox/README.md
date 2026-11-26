# cylbox: native Rapier cylinder resting on a box

Pure-Rapier repros (`@dimforge/rapier3d-compat` 0.21.0, no project code). Run each from the repo root
with `node spikes/rapier-limits/cylbox/<script>.mjs`. Every script finishes in under 30 s.
`out-*.txt` holds the output of the runs quoted below.

| script | what it does |
|---|---|
| `lib.mjs` | Harness. One dynamic body on a floor (fixed cuboid, convex hull of the same box, or HalfSpace; optionally dynamic). Records pose, velocities, energy and the contact manifold every step. Switches: g, dt, iterations, `contact_natural_frequency`, prediction, allowed error, lengthUnit, soft/hard CCD, sleeping, recycling off (ActiveHooks plus a hooks object), re-creating the floor collider every step, friction, shape. |
| `smoke.mjs` | Quick check: cuboid vs half-space, r 0.5/1/2.5. |
| `repro.mjs [knap\|si]` | Steps 1 and 2. 4 floors × 2 poses × 3 radii × μ 0.8/0 × 3 placements, 5 s each. |
| `trace.mjs '<json>' [every] [max]` | Per-step trace of one configuration. |
| `lever.mjs [cuboid\|halfspace\|hull] v0 steps` | Per step: each contact point's z minus the cylinder centre at the pose the narrow phase saw. `RECREATE=1` re-creates the floor collider before every step. |
| `switches.mjs [knap\|si]` | Step 3. Changes one setting at a time from the base, at 6 placements. |
| `gjkband.mjs` | Geometry only (`Shape.contactShape`, i.e. parry GJK/EPA). Measures how far the witness point on a lying cylinder sits off the true contact line, and the normal error. |
| `capband.mjs` | The same for an upright cylinder with its cap flush with the box face. |
| `roll.mjs` | Rolling start (v0): speed after 1 s on a cuboid vs a half-space. |
| `terminal.mjs` | Prediction test: plateau speed vs v* = r·(π/180)/dt. |
| `recreate.mjs`, `recreate2.mjs` | Switch: no persistent manifold (floor collider re-created every step). |
| `upright.mjs` | Upright cylinder on a narrow beam (cuboid/hull 3.5×0.46×0.46). |
| `projectfloor.mjs` | The wheels spike's own box ground (200×1×50, wheel 20.3 from one end). |
| `sisleep.mjs` | SI scale with all defaults, sleeping included. |

## Results

| behaviour | class | key numbers |
|---|---|---|
| Self-acceleration of a rolling cylinder on a box | **DEFECT** | SI, all defaults (sleep on), r 0.5 m, 200 m box: nudged at 0.05 m/s, it reaches 0.52 m/s and holds (predicted v* 0.524) (`sisleep`). Half-space: speed kept at 0.0500. Knap: plateau 8.9 units/s, prediction 8.38 (`terminal`). The project's "0 → 8.4 units/s" is this v*. |
| Creep from rest | **MIXED** | The lever exists at every scale. `gjkband` maximum witness offset from the contact line, by box half-size: 1.5 → 0.0045, 5 → 0.0082, 20 → 0.026, 200 → 0.051, 2000 → 0.15. On a half-space it is 0. From rest at SI it runs away only with sleeping off: 6/6 placements, drift up to 0.60 m in 5 s; with sleeping on, 0/6. At knap g it runs away even with sleeping on (6/6). |
| Tunnelling through the box | **NOT REPRODUCED** | 0 cases of the centre dropping below the top face over the footprint, in every script. Every 400 units/s case was the cylinder rolling off an edge, including the spike's own geometry (`projectfloor`: off the near end at 2.95–4.76 s, with soft CCD on or off). |
| Upright runaway | **NOT REPRODUCED** | On beam cuboid/hull, r 0.5/1/2.5, 4 positions: drift ≤ 0.0094 in 5 s (`upright`). |
| Wrong (horizontal) normal on the first contact, cap exactly flush and centred | **DEFECT** | `capband`: normal (0.13,0,−0.99) for r 1 on the beam, (0.71,0,0.71) on a 2000 box. It is geometric, so the same at SI. In simulation the body drops 0.04–0.1 into the box before recovering. |
| Error grows with box size | **DESIGN LIMIT** | GJK uses relative tolerances (`gjk.rs:367`, `:415`, `:442`). Lever on the first step in `repro`: about 0.0004–0.004 on a 20 box, 0.0013–0.85 on a 2000 box. Normals tilt up to 87–90° on 200 and 2000 boxes (`gjkband`). |

Mechanism, from the source and the traces:

1. **The narrow-phase routine differs.** A cuboid or hull against a cylinder goes to `contact_manifold_pfm_pfm` (`default_query_dispatcher.rs` ~807). A half-space goes to `contact_manifold_halfspace_pfm` (~777), which has no GJK and no reuse of old points. It takes the cylinder's support feature straight down the plane normal and rebuilds the points from the current pose on every call (`contact_manifolds_halfspace_pfm.rs:55-92`).
2. **The starting lever.** In pfm_pfm, GJK's witness point on the curved side is accurate only to a relative tolerance, so it sits about 1e-3 r off the true contact line. The side segment is placed at that witness azimuth, not at the normal's (`polygonal_feature_map.rs:73-83`, `:108-120`). Trace, step 1: the normal is exactly (0,1,0), but every point sits at z = −0.00147.
3. **The ratchet.** `contact_manifolds_pfm_pfm.rs:62` reuses the old points through `try_update_contacts_eps(pos12, COS_1_DEGREES, 1e-6)`. That check passes as long as the material point is still near its floor anchor and the body has turned less than 1°. On a rolling body the material point at the bottom barely moves, so the points stay frozen while the centre moves on. The contact then trails the centre by up to r·1° (`lever.mjs`: −0.0155 at v = 1, then it resets). A trailing normal force is a downhill slope in the direction of travel. The effect stops once the body turns more than 1° per step, which gives v* = r·(π/180)/dt.

Settings that do **not** fix it (`switches`): contact recycling off via hooks; `contact_natural_frequency` 30–1000 (a fixed floor uses `static_contact_softness`, 60 Hz, which JS cannot set); iterations 4–100; dt; prediction; allowed error; soft or hard CCD; a dynamic heavy floor; a hull floor; a thin floor. Sleeping only hides the effect at SI, for a body that is truly at rest.

Things that do avoid it: a HalfSpace floor; a ball. 32- and 64-gon prisms do not run away, but they cannot roll freely: a prism64 rolling at 1 unit/s keeps 4 % of its speed after 1 s. A capsule runs away at knap scale (plateau 8.40) but not at SI. Friction 0 removes the runaway but also removes rolling.
