# Bullet (ammo.js builds) on the knap battery

Every number below comes from these scripts, run with Node 20.11 on this machine. All results are in
real units: studs, real seconds, grams.

## Install and run

```
cd spikes/engines/bullet
npm install                  # ammojs3@0.0.11 and ammojs-typed@1.1.0, into this directory only
node minimal.mjs             # Bullet at its own defaults (sleeping on)
NOSLEEP=1 node minimal.mjs   # the same with deactivation off (AMMO=typed uses the kripken/master build)
node b1.mjs stud             # regimes: stud | big | si ; flags: --iters=N --split=0|1 --mlcp=1 --margin=<studs>
node b4.mjs stud [--poly=1 --boxhull=1 --sat=1]
node b5.mjs stud
node b6.mjs stud [--dtdiv=k] [--iters=N]
node b7.mjs stud [--flags=0|2|4|8] [--dtdiv=k]
node b8.mjs stud [--maxv=1e30] [--erp=0.2] [--nocol=1]
node b9.mjs stud
node b23.mjs stud
node b10.mjs stud [--dtdiv=k]
```

`lib.mjs` holds the unit mapping. The engine works in sim units: length = S·studs, time = t_real/T,
mass = M·grams.

| regime | S (units/stud) | T | M | what it is |
|---|---|---|---|---|
| `stud` | 1 | 1 | 1 | what knap does with Rapier: 1 unit = 1 stud, g = 1226 units/s², dt 1/480 s |
| `big` | 1 | 0.0894 | 1953 | the owner's regime 2. A stud is drawn as 1 m, masses are in kg, g = 9.81 and dt_sim = 1/42.9 s. Same physics with time stretched 11.2×. |
| `si` | 0.008 | 1 | 1e-3 | the owner's regime 1: metres and kg with real 8 mm parts, g 9.81, dt 1/480 s |

Friction: Bullet multiplies the two bodies' coefficients, so every body gets √0.5 and every pair gets
0.5. Restitution is 0 and deactivation is off on every body. Default solver: SI/PGS with 10 iterations
and split impulse on.

## Which build

- **ammojs3 0.0.11** (npm, 2023-12-25, 147 downloads a week, 10.1 MB unpacked). Wasm is 1.16 MB
  (440 kB gzipped) plus 636 kB of JS glue. It is a Bullet 3.x fork of ammo.js that also exposes
  btMultiBody, btMultiBodyGearConstraint, btMLCPSolver/Dantzig, btJointFeedback and solver ERP. Its
  GitHub repository (i12345/ammo.js) now returns 404. **All battery numbers use this build.**
- **ammojs-typed 1.1.0** (npm, 2026-09-23, 4,182 downloads a week, 3.5 MB unpacked). Wasm is 750 kB
  (290 kB gzipped) plus 453 kB of glue. It is kripken/ammo.js master with typings: Bullet **2.82**
  (2013), no multibody, no gear, no joint feedback getter. It was used to cross-check B5 and B7.
- Neither build exposes btGearConstraint (rigid bodies), btGeneric6DofSpring2Constraint, the NNCG
  solver, m_solverMode or global CFM. Both are f32. That was measured: `btVector3(0.1)` reads back
  0.10000000149.

## Results (stud regime unless stated)

| id | verdict | numbers |
|---|---|---|
| B1a | PASS | sink 2.3e-7 studs, drift 4e-6 studs/s, 4 contacts |
| B1b | PASS | cube into beam 7e-7, beam into floor 1.3e-6 |
| B1c | MARGINAL / FAIL | Stack of 5: compression 0.0033 and it stands, but the top slides 0.054 sideways. With the top cube 10× denser it **collapses** at 10 iterations in every regime, with split impulse on or off and with MLCP. It stands at 30 iterations (top moves 0.35) and at 100 (0.11). |
| B2 | MARGINAL | Box floor: deepest 0.06 at 150 and 0.375 at 300 studs/s (depends on step phase, no CCD), rebound 3.5 studs/s, sideways 0.3 studs/s. **Static plane:** 0.28 / 0.80 deep with a sideways kick of 15.7 / 32.5 studs/s and spin of 23 / 102 rad/s. |
| B3 | PASS | 613.13 / 1226.25 / 1839.38 studs/s, no clamp |
| B4a | FAIL by default; PASS with polyhedral hulls | btBoxShape on a btConvexHullShape 32-gon falls through at 3 of 7 spots (contacts 0–3). Making the box a hull too, with `initializePolyhedralFeatures` and `m_enableSatConvex` on: all 7 spots hold, tilt 4e-7, sink 4e-8, 4 contacts. Without SAT/poly the box floats 0.08 studs (both margins). |
| B4b | PASS (but it floats by the margin) | 16- and 32-gon on plane or box: tilt ≤ 6e-6, rest 0.04 studs **above** the floor (hull margin), 2–4 contacts |
| B5a | **FAIL** | btCylinderShape **self-accelerates**: on the plane, 1 → 21 studs/s in 5 s. On the box it starts rolling from rest (to 20 studs/s) and rolls off the edge. The same happens at Bullet's own defaults with r = 0.5 m and 1/60 s once sleeping is off (`NOSLEEP=1 node minimal.mjs`: 0.05 → 1.25 m/s in 20 s on a box, 0.92 m/s on a plane), in both builds. A sphere does not. |
| B5b | MARGINAL | plane: 99.3 % of the speed kept, sink 0.0064. box: 99.5 %. |
| B5c | FAIL | an upright r 2.5 wheel on a loose beam rolls away (29 studs/s, x −14 at 2 s) |
| B6a | FAIL at 1/480 s; PASS with substeps | Rigid hinge: −21 % of mgL in 10 s, separation 0.017, at any iteration count (10/50/200 the same). At dt 1/1920: −0.65 %; at 1/3840: −0.14 %. btMultiBody: −0.64 % at 1/480 s. |
| B6b | FAIL at 1/480 s; PASS with substeps | Rigid: −88 %, separation 0.15; more iterations barely help (−74 % at 200). 1/1920: −16.5 %. 1/3840: −2.6 %, 0.006. 1/7680: −0.40 %, 0.0016, at 54 ms per simulated second. btMultiBody: −82 % / −64 % / −44 % / −20 % at 1/480 / 1920 / 3840 / 7680 s (cause not found; my setup is possible). |
| B7 | **FAIL in every mode** | Default flag 8 (implicit body gyro): E −1.45 %/s and \|L\| −2.24 %/s (−43 % / −67 % in 10 s, then it plateaus). Flag 2 (explicit): E +2.55 %/s, and it is clamped by an absolute `m_maxGyroscopicForce`; in `si`, unclamped, it blows up to 1e8 rad/s. Flag 0 (the 2.82 default): \|L\| and E are constant only because ω stays fixed in the world; the L vector is off by 84–166 %. In `si` flag 8 silently behaves like flag 0. |
| B8 | PASS (btMultiBodyGearConstraint, fixed axes) | With `setMaxCoordinateVelocity(1e30)`: ratio −0.400000 exactly, KE/work 1.00000–1.00002, phase drift 0.015 teeth (erp 0) or 3e-4 teeth (erp 0.2). At 300 rad/s: fine. **Traps:** (1) the default max coordinate velocity of 100 sim rad/s clamps at 100 rad/s in `stud`, so the spin-up never reaches 300. (2) Without link colliders the gear does nothing, silently. (3) The ERP term reads bodyA for linkB, so both gears must be in one multibody. No rigid-body gear is exposed. |
| B9 | list | Joint friction: `btHingeConstraint.enableAngularMotor(true, 0, τ·dt)`, a velocity motor with an **impulse** cap; it slips at 0.9×mgL and holds at 1.1×. Motor with max torque: the same call. Limits: `setLimit(lo, hi, softness, bias, relax)`, overshoot 0.023 rad. One-way: none on rigid hinges (the angle is wrapped to ±π); `btMultiBodyJointLimitConstraint(mb, link, 0, 1e9)` works on multibody (held at 0, turned 443 turns the free way). Reaction force: `setJointFeedback(btJointFeedback)` → m_appliedForceBodyA = 2179.586 vs m·g 2179.586. btJointFeedback has no JS constructor (`_malloc` + `wrapPointer` was needed). Slider: linear motor and limits only. |
| B10 | PASS | 6 bodies with hinges + 20 cubes: 0.104 ms per 1/480 frame at 10 iterations (the pendulum loses 59 % in 5 s). 0.60 ms at 1/3840 (−0.7 %). 1.12 ms at 1/7680 (−0.2 %). |

## Units / scale (the owner's question)

- `big` (1 m bricks, kg, g 9.81, time stretched) gives the same results as `stud` in B1, B2, B4, B5,
  B6, B7 and B10, to 2–3 digits. That is expected: lengths are equal and only time is relabelled.
  The one difference: Bullet's absolute caps in sim units bite in other places. The multibody
  `maxCoordinateVelocity` of 100 sim rad/s is 1118 real rad/s in `big` but 100 in `stud`.
- `si` (real 8 mm parts in metres) is **worse**. The default 0.04 m margin is 5 studs. The box gets
  an automatic safe margin, but the hulls keep the full 0.04 m and float 5 studs above the floor.
  With the margin scaled down to 0.04 studs, B4a falls through at **every** spot even with
  polyhedral hulls. The stack and impacts get noisier (rebound 36 vs 3.5 studs/s at 300). The
  implicit gyroscopic term silently switches off (B7 identical to flag 0; inferred to be the
  determinant epsilon in Bullet's 3×3 solve).
- Mass scale made no difference (the `big` regime has M = 1953).
- So for Bullet the answer is: keep parts around 1 unit. Stud units (or the equivalent 1 m bricks)
  are Bullet's well-exercised regime, and the defects above (rolling cylinder, gyroscopic term,
  joint drift at 1/480 s) show up there and at Bullet's own defaults.

Not tested: B5 with cylinders as polyhedral hulls, contact breaking threshold (not exposed), the
MLCP solver on joints, Featherstone with contacts, B6b multibody cause, browser timing, and the
double-precision build (none on npm).
