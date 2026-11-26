# Jolt Physics (jolt-physics 1.1.2, WASM) against the engine battery

## Install and run

```
cd spikes/engines/jolt
npm install            # installs jolt-physics@1.1.2 locally (package.json / package-lock.json)
node contacts.mjs      # B1-B5, all three regimes    (< 1 s)
node joints.mjs        # B6-B8, all three regimes    (~2 s); flags: --csteps=N --vsteps=N --psteps=N --nogearpos=1 --teeth2=N
node api.mjs           # B9 functional checks + B10 cost
node b2var.mjs         # B2 with LinearCast CCD / larger speculative distance
node b5var.mjs         # B5a cause check (body-pair cache)
node b5slow.mjs        # slow rolling and B5c with the cache on/off (metre, si-scaled)
node contacts.mjs metre-nc; node api.mjs metre-nc   # metre regime with the body-pair cache off
node b6var.mjs         # B6a with hinge vs point constraint, Baumgarte, warm start, csteps
```
Every script takes regime names (`si-def`, `si-scaled`, `metre`) as arguments. Output captured in `out-*.txt`.
Runs are bit-identical across runs (checked with `cmp` on two runs of `contacts.mjs`).

## Regimes (all reported in studs, real seconds)

| name | 1 stud = | time | gravity (internal) | settings |
|---|---|---|---|---|
| `si-def` | 8 mm | real, dt 1/480 s | 9.81 m/s² | Jolt defaults (slop 2 cm, speculative distance 2 cm, body-pair cache 1 mm / 2°, hull tolerance 1 mm, max ω 47.1 rad/s). Convex radius 0.05 stud (the 5 cm default is impossible on 7 mm parts). |
| `si-scaled` | 8 mm | real | 9.81 | every length tolerance in PhysicsSettings and hull build scaled by 0.008; max ω 2000 rad/s |
| `metre` | 1 m | dilated ×√125 = 11.18 (internal dt 0.0233 s) | 9.81 | Jolt defaults ("game" regime: ~1 m bodies, ~43 Hz steps, ω ≤ 27 rad/s internal at 300 real rad/s) |
| `metre-nc` | 1 m | as metre | 9.81 | as metre plus `mUseBodyPairContactCache = false` (recommended for knap) |

Density 586 kg/m³ (0.30 g per stud cube). Friction 0.5, restitution 0, sleeping off, 10 velocity / 2 position iterations, 1 collision step per 1/480 s unless noted.

## Results

| test | si-def | si-scaled | metre | verdict (metre / si-scaled) |
|---|---|---|---|---|
| B1a cube on box / plane | sink 2e-8, drift 4e-8 studs/s | same | sink −7e-8, drift 6e-8 | PASS |
| B1b cube on loose beam 9 | 4.8e-6 / 1.6e-7 | same | 4.8e-6 / 1.7e-7 | PASS |
| B1c 5-stack (top ×10) | 0.0045 (0.026), stands | 0.0045 (0.021) | 0.0045 (0.032), tilt ≤1.3° | PASS |
| B2 drop 150 / 300 studs/s | pen 1.8e-5 / 1.3e-5 (2.5-stud speculative distance catches it) | pen 0.141 / 0.130, rebound 0, sideways ≤0.03 studs/s, spin ≤0.004 rad/s, rests 0.02 deep (slop) | same as si-scaled | MARGINAL at defaults; PASS with speculative 0.7 stud (pen ≤1.2e-5) or LinearCast at 300 (0.02) |
| B3 free fall | 613.13 / 1226.25 / 1839.37 | same | same | PASS, no clamp |
| B4a box on 32-gon top, 7 spots | tilt 0.06–0.42°, floats 7e-5–1.9e-4, n=4, never falls | tilt 0.058°, floats 7e-5 | tilt 0, sink 1e-8, n=4 | PASS |
| B4b 16/32-gon on end | 16-gon floats 0.0039 (1 mm hull tolerance) | sink 4e-7, n=4 | sink ≤4e-7, n=4 | PASS (si-def MARGINAL) |
| B5a wheel r1, rest / 1 stud/s, 5 s | rest OK; **rolling 1 → 16.8 studs/s** (plane), off the box floor | 1.0000 constant | 1.0000 constant; **but 0.1 → 0.48 studs/s** (b5slow) | FAIL with the cache on (any units); metre-nc PASS: 0.1/0.3/1 stud/s held to 4 digits |
| B5b wheel 100 studs/s, 2 s | clamped to 47.1 % (ω cap 47.1 rad/s) | 100.00 %, sink ≤2e-6, lateral 0.09 studs/s | same | PASS |
| B5c r2.5 on loose beam | rolls off (−28 studs), sink 1.2 | sink 4.6e-4, beam 6e-5, self-accelerates to 0.48 studs/s (cache) | same | FAIL with cache; metre-nc: sink 4.5e-4, moves 0.006 in 2 s → PASS |
| B6a pendulum 10 s | −73.9 % mgL, sep 0.0062 | −73.9 % | −73.9 % | **FAIL** (csteps 16: −14 %, 59 ms/s; csteps 64: −3.9 %, 220 ms/s) |
| B6b triple pendulum 10 s | −71.4 %, sep 0.062 | −70.7 % | −70.7 %, sep 0.059 | **FAIL** (csteps 16: −51 %, 270 ms/s; csteps 64: −16.4 %, 912 ms/s) |
| B7 free spin, 30 s | gyro off: E, abs L held to 1e-5 % but ω stays fixed in world, L direction turns 70.8°; gyro on: E −3.08 % (−0.10 %/s), abs L +0.22 %, L turns 3.0° | same | same | gyro off FAIL (wrong physics); gyro on MARGINAL |
| B8 gear 16:40, GearConstraint | ω capped 47.1 rad/s | **pose snaps by π (8 teeth)** whenever gear 2's hinge angle wraps; velocity ratio exact 2.500000, KE/work 1.00000 | same | FAIL with SetConstraints; with no position correction: 2e-5 teeth at 100, 1.8e-4 teeth at 300 rad/s, KE drift ≤3e-4 %/s → PASS. Integer ratio 16:32 PASS with correction |
| B9 hinge extras | friction `SetMaxFrictionTorque` ✓ (holds at 1.2 mgL, slips at 0.8); motor `EMotorState_Velocity` + `MotorSettings.mMax/MinTorqueLimit` ✓ (saturates at exactly 0.700 mgL); limits `SetLimits` ✓ (overshoot 0.0039 rad); one-way limit ✗ (no ratchet; limits only); reaction `GetTotalLambdaPosition()/dt` ✓ (1.0000 mg) | same | same | PASS (no ratchet) |
| B10 triple pendulum + 20 cubes | 185 ms/s (385 µs/step) | 47.5 ms/s (99 µs/step) | 47.7 ms/s (metre-nc 63.6); csteps 4: 190; csteps 16: 699 | PASS at defaults, but B6 needs csteps ≥ 64 → FAIL |

## Main findings

1. **Units.** Jolt's absolute tolerances are in metres. With 8 mm parts at Jolt defaults it reproduces knap's Rapier symptoms: a rolling wheel self-accelerates to v* = r·2°/dt = 16.8 studs/s (cause: the body-pair contact cache, 1 mm / 2°; turning it off or scaling the 1 mm fixes it, and scaling it ×125 in the metre regime brings the runaway back, `b5var.mjs`), prisms float on 1 mm hull tolerance, ω is capped at 47 rad/s, and the 2 cm speculative distance makes a 20-cube pile cost ×3.9. Scaling the tolerances by 0.008, or simulating 1 stud = 1 m with time dilated ×√125, gives the same results to 3–4 digits. **But it only moves the runaway**: the cache re-uses the contact while the pair moved < 1 mm and turned < 2° per step, so rolling speeds up to v* = min(r·2°/dt, 1 mm/dt) = 0.48 studs/s in the metre regime (`b5slow.mjs`). Only `mUseBodyPairContactCache = false` removes it (B10 cost +29 %). Units matter only through these absolute thresholds; the joint losses are dimensionless (ω·h) and do not change with units.
2. **Joints lose energy badly at 1/480 s.** Hinge and point constraint behave the same, independent of Baumgarte and warm start. The loss shrinks with smaller steps (collision sub-steps), but Jolt's sub-steps re-run collision detection, so the cost grows linearly.
3. **GearConstraint position correction is wrong for non-integer ratios** (`error = CenterAngleAroundZero(fmod(gear1rot + mRatio * gear2rot, 2π))` with hinge angles wrapped to [−π, π]). The velocity row alone is excellent.
4. **Contacts are much better than parry.** Full face clipping reduced to 4 points; cylinders roll at constant speed; no sideways throw on impact.
