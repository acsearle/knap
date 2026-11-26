# PhysX 5 (physx-js-webidl) against the knap battery

Engine: NVIDIA PhysX through fabmax's WebIDL/emscripten bindings, npm `physx-js-webidl@2.9.1`
(published 2026-10-24; 2,617 downloads in the week to 2026-11-25 from api.npmjs.org; MIT bindings over BSD-3 PhysX).
The package says "PhysX 5.12.0" and `PHYSICS_VERSION` reads 0x050C0000 (measured).

## Install and run

```
cd spikes/engines/physx
npm install            # installs physx-js-webidl@2.9.1 into this directory only
node b1.mjs            # B1a/b/c resting contact
node b23.mjs           # B2 impacts, B3 free fall   (SPEC=1: speculative CCD on)
node b4.mjs            # B4a/b polygon faces, with contact-point counts
node b5.mjs core       # B5 wheels: native convex-core cylinder   (also: hull64, hull32)
node b5box.mjs         # native cylinder on fixed boxes of several sizes (MARGIN=0.02 for a rounded one)
node b5hullfloor.mjs   # native cylinder on a convex-mesh box and on a convex-core box
node b5trace.mjs 1 1   # per-step trace (FLOOR=small|long|tiles|plane, noPCM, hull)
node b6.mjs joint      # B6a/b with PxRevoluteJoint      node b6.mjs artic: reduced-coordinate articulation
node b7.mjs            # B7 free asymmetric spin, gyroscopic term off (default) and on
node b8.mjs 100        # B8 PxGearJoint, driven to 100 rad/s   (node b8.mjs 300)
node b9.mjs            # B9 hinge extras;  node b9fric.mjs: drive-as-friction probe (IMP=1, PGS=1)
node b10.mjs           # B10 cost
node det.mjs           # determinism
```
Env for every script: `POS` (TGS position iterations, default 4), `VEL` (default 1), `SUB` (outer steps per
1/480 s, default 1), `PGS=1`, `PXU=m` (run the same world in SI metres/kg instead of studs/grams).
Saved outputs: `out-*.txt`.

**Getting it to run in Node.** The npm build is compiled `-sENVIRONMENT=web` with emscripten ASSERTIONS on
(5,098 `assert(` in the 4.8 MB glue). `lib.mjs` hides `process`, sets `window`, and passes `wasmBinary`
during the factory call; the package is not modified. Two traps found: the bindings' `DefaultFilterShader`
needs non-zero filter data (word0 & word1) or nothing collides; the pass-through filter shader resets
`outputPairFlags` before each call, so it must be set inside the callback.

## Units and settings chosen

- Internal units: 1 length unit = 1 stud, mass in grams, seconds. g = 1226.25 studs/s². Density 0.3 g/stud³.
- `PxTolerancesScale` length = 1 (a part is about a stud), speed = 1226.25 (PhysX's rule: speed after 1 s of fall).
  Contact offset then defaults to 0.02 studs, rest offset 0.
- TGS solver, 4 position / 1 velocity iterations per body (PhysX defaults), PCM on (default), dt 1/480,
  sleeping off (sleep and stabilisation thresholds 0), CCD off unless stated.
- Overridden absolute defaults (they do NOT follow `PxTolerancesScale`): rigid dynamic max angular velocity
  100 rad/s, angular damping 0.05; articulation links max linear velocity **100 units/s** (0.8 m/s in studs),
  max angular 50 rad/s, damping 0.05/0.05; articulation joint max velocity 100 rad/s. All set to 0 / unlimited.
- **Scaling question:** every test rerun with `PXU=m` (length 0.008 m, kg, tolerances length 0.008, speed 9.81)
  gives the same results to 2–3 digits (`out-units-m.txt`), defects included. With a consistent
  `PxTolerancesScale` PhysX is scale-invariant; only the absolute defaults listed above change meaning.

## Results (real units, measured in this session)

| test | setup | verdict | numbers |
|---|---|---|---|
| B1a | cube on box floor / plane, 2 s | PASS | sink 1.6e-5 / 5.6e-6 studs; moved 5.5e-5 / 6.3e-5 studs in 2 s; instantaneous velocity noise 0.02–0.04 studs/s |
| B1b | cube on loose beam 9 | PASS | cube into beam 4.6e-4, beam into floor 1.5e-4 (box) / 1.0e-4 (plane) |
| B1c | 5-stack; top ×10 | PASS | compression 0.0058; ×10: 0.022, top offset 0.036, stands |
| B2 | flat drop 150 / 300 studs/s | MARGINAL (default), PASS (speculative CCD) | default: penetration 0.118 / 0.243 studs for a step, rebound ≤ 2.7 studs/s on the plane, sideways ≤ 0.028, spin ≤ 0.076 rad/s. `eENABLE_SPECULATIVE_CCD`: penetration 4e-5–0.0018, rebound ≤ 0.19 |
| B3 | free fall 1.5 s | PASS | 613.13 / 1226.25 / 1839.38 studs/s, no clamp (after raising the limits above) |
| B4a | box on fixed 32-gon top, 7 spots | PASS | tilt 0.06–0.11°, sink 7e-5–1e-4, none fell, 4 contact points every step |
| B4b | 16-, 32-gon prism on end, plane and box | PASS | tilt 0.008°, sink 1.5e-5, 4 contacts |
| B5a | wheel r 1 on side, rest and 1 stud/s, native cylinder | plane PASS, box FAIL | plane: 1.0000→1.0003 studs/s in 5 s; at rest creeps 4.4e-4 studs/s after 5 s (growing linearly). 40×1×40 box: 1 → **1.37 studs/s within 0.5 s**; 10-stud box: rest → 0.78 studs/s; 4-stud box: rolls off and falls; 500-stud box: falls through at rest |
| B5a | same, 64-gon convex hull wheel | FAIL | at 1 stud/s it cannot climb a facet, stops within 1 s (rest is fine) |
| B5b | r 1 at 100 studs/s, 2 s | plane PASS, box FAIL, hull FAIL | plane: 100.00 % kept, no sink, z drift 0.34, tilt 0.15°. Long box: falls through / thrown sideways. 64-gon hull: 9–12 % kept |
| B5c | r 2.5 on rim on loose beam | native FAIL, hull PASS | native: rolls along the beam by itself, 0.37 studs in 2 s, 0.26–0.30 studs/s and rising; sink 0.0015. Hull: stays (x 0.001), sink 0.0014 |
| B6a | beam-7 pendulum, PxRevoluteJoint | PASS | −0.20 % of mgL in 10 s, separation 4.6e-4 studs (POS 32: −0.03 %, 2.2e-5) |
| B6b | triple pendulum, PxRevoluteJoint | FAIL at defaults, PASS at 32 iterations | 4 iters: −19.1 %, separation 0.030. 32 iters: −0.54 %, separation 0.0022, 20 ms per simulated s incl. per-step JS readout. PGS 4: −83 % |
| B6a/b | articulation (fixed base, eREVOLUTE) | FAIL | single: **+124 %** in 10 s (TGS 4), +156 % (TGS 32), +39 % (dt 1/1920), −0.64 % (PGS). Triple: −30 to −77 %. Joint separation 1–4e-6. With the default link clamps it read +85 % / −74 %. Cause not found; my set-up may be at fault |
| B7 | free spin 20 rad/s, non-principal | default FAIL, gyro on PASS | gyroscopic term off (PhysX default): E −0.001 %/s, |L| −5e-4 %/s but **L direction turns 40.7° in 30 s**. `eENABLE_GYROSCOPIC_FORCES`: E −0.021 %/s, |L| +0.012 %/s, L direction within 2.6° |
| B8 | r 1 + r 2.5 on world hinges, PxGearJoint 2.5:1 | PASS | ratio −2.5000 throughout; phase error ≤ 0.053 teeth (16-tooth pitch) over 6 s at 100 rad/s, ≤ 0.017 at 300 rad/s; KE / work 1.0021 (my rectangle-rule work estimate); hinge drift 0; 11 ms per simulated s. `setGearRatio(k)` means ω(hinge 1) = k·ω(hinge 0) in the other sense: 0.4 gives 2.5:1 |
| B9 | hinge extras | MARGINAL | see below |
| B10 | B6b + 20 cubes | PASS | 30.5 ms CPU per real s at 4 iters (0.063 ms per 1/480 s); 90 ms at 32 iters (0.19 ms per step); 107 ms at 16 iters × 1/960; 142 ms at 8 × 1/1920 |
| det. | B6b + pile twice, two processes | PASS | bit-identical (same pose hash in-process and across processes) |

B9 detail (`out-b9.txt`, `out-b9fric.txt`):
- Joint friction on `PxRevoluteJoint`: no native one. Drive at velocity 0 with `setDriveForceLimit` works,
  but the limit behaves as an **impulse per simulate call** (a limit of 0.5×, 0.8×, 1.2×, 10× the gravity
  torque all hold identically; scaled by dt it slips at 0.5 and 0.8 and holds at 1.2). A held horizontal arm
  **creeps 0.24 rad/s** (TGS) / 0.21 (PGS): the drive is a velocity row with no position correction.
- Articulation joint friction `PxJointFrictionParams` (static, dynamic, viscous): native; 1.2× holds at
  −0.013 rad and stops (ω 0), 0.8× slips and stops at −1.14 rad.
- Motor with max torque: yes (`eDRIVE_ENABLED`, `setDriveVelocity`, `setDriveForceLimit`), same impulse units.
- Angle limits: yes (`setLimit(PxJointAngularLimitPair)`, `eLIMIT_ENABLED`); overshoot 0.0045 rad.
- One-way: a one-sided limit [0, 3.1] holds at −0.0012 rad; no ratchet type.
- Reaction force: yes, `getConstraint().getForce(lin, ang)`: −2179.586 vs m·g 2179.586 g·stud/s².
- Also exposed: `PxRackAndPinionJoint`, `PxD6Joint` (per-axis limits/drives), prismatic limits, break force,
  `addLoopJoint` on articulations (not tested).

## Not tested
B6 articulation cause; loop closure in articulations; rack and pinion; prismatic/D6; convex-mesh limits in
practice (only 64-vertex hulls); per-pair contact stiffness; browser performance (Node only, assertion
build); a build without assertions; meshes of real liftarm shapes; gear trains longer than one pair.
