# refute: rapier-regimes

This is an adversarial re-check of `../README.md`. It uses the repo's `@dimforge/rapier3d-compat` 0.21.0 and does not install anything. The scripts do not import `../lib.mjs`.

```
cd spikes/engines/rapier-regimes/refute
node indep.mjs all     # sink vs fixed/kinematic floor, clamps, B5a wheel, B4a shape variants, B1c stack
node nofork.mjs        # R0 vs R2 vs "RX" (setters only: cnf, kinematic ground, compensated lengthUnit)
node nofork.mjs ablate # each RX ingredient on its own
node roll2.mjs         # B5a wheel vs lengthUnit, floor size
node roll3.mjs         # B5a 1 stud/s on the battery's 40x40 floor vs lengthUnit
```

I also re-ran `../battery.mjs R0|R1|R2|R3 B1 B3 B4a B5a B6a` and two L-ladder rungs. They reproduced the other agent's numbers to every digit, and I restored their results/ JSON afterwards.

## Results (real units: studs, real s)

| claim | verdict | my numbers |
|---|---|---|
| resting sink is g/(2πf)², with f = 60 Hz (fixed) / 30 Hz (moving) | CONFIRMED | R0 8.60e-3 (pred 8.63e-3); R2 6.79e-5 (6.90e-5) |
| static softness can only be reached with a bindings fork | REFUTED | Rapier treats only bodies with no solver velocity (fixed) as "static". A **kinematicPositionBased** ground body counts as a moving body, so `contact_natural_frequency` controls it. R0 + kinematic ground + cnf 671 gives sink 6.78e-5 and cube-on-beam 6.97e-5, the same as R2 or better |
| the 400 studs/s clamp needs an unexposed field | REFUTED | the clamp is 400·lengthUnit. Raising `lengthUnit` to 11.18 and dividing the two exposed normalized tolerances by 11.18 gives 4472 and a free-fall speed of 1840 at 1.5 s. B1/B2/B6a stay identical to R0 |
| a no-fork "RX" (cnf 671 + kinematic ground + compensated lengthUnit 11.18) matches R2 | CONFIRMED with cost | B1a 6.8e-5, B1b 7.0e-5 / 1.0e-4, B1c(10x) 0.007, B3 1840, B4a same as R2. Cost: the B2 300 studs/s impact penetrates 0.123 instead of 0.007, which comes from the kinematic ground |
| B4a R2 "holds" | REFUTED as a pass | the 0.1-tall box ends 0.072 deep (72 % embedded), tilted 11.7° on 1 contact |
| B4a R0 FAIL is engine-wide | WEAKENED | it is the convexHull path only. On a fixed `trimesh` 32-gon prism or a `cylinder` the box rests: R0 sink about 0.011, tilt ≤ 2°; R2 sink 1e-4, tilt 0° |
| B5a: a wheel at rest starts rolling by itself | WEAKENED | on the battery's 40×40 floor it stays at 0.00 for 5 s in R0 and R2. The other agent's B5a used a 40×120 floor, where it reaches −10.8 |
| B5a self-acceleration is units-independent | WEAKENED | it is time-independent (R2 is the same as R0). But lengthUnit ≥ 8 (tolerances compensated) on the 40×40 floor holds 1 stud/s to 1.03–1.12 instead of 8.4. This does not carry over to a 40×400 floor, so it is fragile, not a fix |
| B1c R0 stack topples | CONFIRMED | it collapses to floor level (top y 0.45) within 0.3 s, at 4, 8 and 30 iterations alike. It stands with cnf 335 (R1) or in R2 |
| R3 = R0 by scaling, exact for power-of-two L | CONFIRMED for B1a/B6a/B7 | bit for bit. B5a differs even at L = 0.5 (9.50 vs 10.75 at 5 s), so B5a depends on absolute length constants |
| JS exposes only cnf, lengthUnit, the 2 normalized tolerances, iterations, CCD substeps | CONFIRMED | `dist/dynamics/integration_parameters.d.ts`; wasm 3,082,103 bytes; Apache-2.0 in package.json |
| B10 cost R0 / R2 | CONFIRMED | 287 / 268 ms CPU per real s |

## Not checked

- B2, B5b, B5c, B6b, B7 and B8 in detail.
- The RX recipe with joints to a kinematic ground under load, restitution 0.1 and CCD.
- Which lengthUnit-scaled constant drives B5a. The broad-phase change-detection skin (`CHANGE_DETECTION_FACTOR * length_unit`) is a guess.
