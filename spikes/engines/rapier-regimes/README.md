# rapier-regimes: does Rapier do better in other unit systems?

Pure Rapier (`@dimforge/rapier3d-compat` 0.21.0 from the repo root, Rapier 0.36, parry 0.31, f32),
native API only, no project code. The battery of `../BATTERY.md` is run in several unit regimes
that all describe the **same physical world**; every number below is converted back to real units
(studs, real seconds, studs/s, rad/s).

## Run

```
cd spikes/engines/rapier-regimes
node battery.mjs R0                 # whole battery in one regime (about 7 s); or: node battery.mjs R2 B1 B5a
node table.mjs                      # main table from results/*.json
node table.mjs L1 L0.5 L0.125 L0.0078125 L0.008   # length-scale ladder (power-of-two scalings)
node table.mjs T1 T2 T4 T11.18 T32  # time-scale ladder
node dbg_stack.mjs R0               # trace of the 5-cube stack collapsing (B1c)
node dbg_rest.mjs R0                # wheel at rest on a box starts rolling, depending on box size
```

The saved tables are in `results/table-main.md`, `results/table-length-ladder.md` and
`results/table-time-ladder.md`; the raw numbers are in `results/<regime>.json`.

## Regimes

| id | lengths | time | g | world dt | steps / real s | lengthUnit | density | iterations free / jointed |
|---|---|---|---|---|---|---|---|---|
| R0 | studs | real | 1226.25 | 1/480 | 480 | 1 | 1 | 30 / 240 (world 30 + additional 210, as in sim.ts) |
| R1 | R0 + `contact_natural_frequency` = 335 | | | | | | | |
| R2 | studs | simulated = 11.18 × real | 9.81 | 0.02329 | 480 | 1 | 1 | 30 / 240 |
| R2d | studs | 11.18 × real | 9.81 | 1/60 | 671 | 1 | 1 | 4 / 4 (Rapier defaults) |
| R2d240 | as R2d | | | | 671 | | | 4 / 240 |
| R3 | metres (stud = 0.008) | real | 9.81 | 1/480 | 480 | 0.008 | 586 kg/m³ (0.3 g per stud cube) | 30 / 240 |
| R3n | R3 with lengthUnit 1 | | | | | 1 | | |
| Rm3 / Rp3 | R0 with density ×1e-3 / ×1e3 | | | | | | | |
| L*k* | R0 × length *k* (lengthUnit *k*, g×*k*, density /*k*³: same masses) | | | | | | | |
| T*s* | R0 time-scaled by *s* (R2 = T11.18) | | | | | | | |

In R2 every input speed is divided by s, angular speeds too, torques by s², durations multiplied
by s; outputs the other way. Scenes: friction 0.5, restitution 0, sleeping off, no CCD (Rapier
default: CCD off per body), contacts between jointed bodies disabled.

## Dimensional analysis and predictions (written before the runs)

Rapier's constants and what each regime does to them, in real terms:

| constant (source: `rapier/src/dynamics/integration_parameters.rs`, `solver/.../worker.rs`, parry `contact_manifold.rs`) | kind | R2 (time ×11.18) | R3 (length ×0.008, lengthUnit 0.008) |
|---|---|---|---|
| contact softness 30 Hz, ζ 10 (dynamic–dynamic; JS-settable) | 1/time | 335 Hz real | unchanged |
| static contact softness 60 Hz, ζ 10 (with fixed bodies; **not settable from JS**) | 1/time | 671 Hz real | unchanged |
| joint softness 1e6 Hz | 1/time | stiffer (already rigid) | unchanged |
| max corrective velocity 3·lengthUnit | length/time | 33.5 studs/s | unchanged |
| max linear velocity 400·lengthUnit (**not settable**) | length/time | 4472 studs/s | unchanged |
| allowed error 0.005, prediction 0.02 (·lengthUnit) | length | unchanged | unchanged |
| angular clamp π/4 per world step | per step | unchanged (same steps) | unchanged |
| parry contact reuse: normal within 1°, material slide < 1e-3 (absolute, `dist_sq 1e-6`) | angle / **absolute length** | unchanged | 1e-3 m = 0.125 stud |
| GJK `eps_tol` ≈ 1.2e-6 (absolute), hull merge 1.5° | absolute length / angle | unchanged | relatively 125× larger / unchanged |

Predictions:
- **Mass (Rm3, Rp3):** nothing in Rapier depends on the mass scale; identical to R0 apart from f32
  rounding. *Confirmed:* everything identical to 3 digits except the f32-noise-driven energy
  drifts (B6a +1.9 to +4.3 %, B7 0.25–0.28 %/s), which turn out to be rounding-sensitive.
- **R3:** by scaling the same computation as R0 (every lengthUnit-scaled tolerance moves with the
  parts). Differences can only come from f32 rounding (0.008 is not a power of two) or from absolute
  epsilons (parry's 1e-3 reuse slide, GJK eps). *Confirmed*, and the ladder separates the two (below).
- **R3n:** naive SI makes every tolerance 125× too big relative to the parts (prediction distance
  2.5 studs, allowed error 0.625 stud, speed clamp 50 000 studs/s). Predicted deep resting sinks.
  *Wrong in detail:* resting sink is unchanged (the allowed error does not set the rest depth in
  0.36); instead impacts bounce (B2 rebound 9–15 studs/s), the triple pendulum loses 17.6 % through
  speculative contacts with a link 1.08 studs away, and B4a still falls.
- **R2:** everything set by a frequency gets 11.18× stiffer, including the static softness that JS
  cannot reach, and the speed clamp lifts to 4472. Everything set per step or per substep (joint
  drift ∝ (ωh)², the f32 spin gain ∝ substeps per second, the 1° rolling plateau v* = r·1°·steps/s,
  the π/4-per-step angular clamp, the 4-vertex face, the gear row) is unchanged. Predicted: resting
  sinks ÷125, B5a/B6/B7/B8 unchanged, B4a still falls (geometry). *All confirmed except B4a*: the
  single GJK point now holds the box (tilted 7–15°) instead of letting it fall.
- **R2d:** Rapier's own regime. Plateau v* = 11.7 studs/s (worse, more steps per second); 4
  substeps → joints lose badly. *Confirmed* (12.7; −33 % / −60 %).

## Main result table (real units)

| metric (real units) | R0 | R1 | R2 | R2d | R2d240 | R3 | R3n | Rm3 | Rp3 |
|---|---|---|---|---|---|---|---|---|---|
| B1a sink (studs) | 0.0086 | 0.0086 | 6.8e-5 | 6.9e-5 | 6.9e-5 | 0.0086 | 0.0086 | 0.0086 | 0.0086 |
| B1a drift (studs/s) | 4.3e-5 | 4.3e-5 | 4.1e-5 | 7.8e-6 | 7.8e-6 | 4.2e-5 | 4.2e-5 | 4.3e-5 | 4.3e-5 |
| B1b cube into beam | 0.0360 | 2.8e-4 | 2.8e-4 | 2.9e-4 | 2.9e-4 | 0.0360 | 0.0360 | 0.0360 | 0.0360 |
| B1b beam into floor | 0.0130 | 0.0130 | 1.0e-4 | 1.0e-4 | 1.0e-4 | 0.0130 | 0.0130 | 0.0130 | 0.0130 |
| B1c 5-stack compression / stands | 3.689 / no | 0.049 / yes | 0.006 / yes | 0.006 / yes | 0.006 / yes | 3.689 / no | 0.720 / yes | 3.689 / no | 3.689 / no |
| B1c top 10x: compression / stands | 3.689 / no | 0.144 / yes | 0.024 / yes | 0.024 / yes | 0.024 / yes | 3.689 / no | 3.688 / no | 3.689 / no | 3.689 / no |
| B2 150: deepest / rebound / side / spin | 0.01 / 0.00 / 0.32 / 0.60 | same | 6.8e-5 / 1.2e-5 / 0.03 / 0.06 | 0.17 / 3.82 / 4.08 / 10.73 | same as R2d | = R0 | 0.01 / 9.18 / 14.67 / 11.30 | = R0 | = R0 |
| B2 300: deepest / rebound / side / spin | 0.01 / 4.40 / 8.23 / 7.24 | same | 6.8e-5 / 4.30 / 6.47 / 7.21 | 6.9e-5 / 9.09 / 16.05 / 24.97 | same as R2d | = R0 | 0.01 / 14.94 / 24.06 / 18.99 | = R0 | = R0 |
| B3 v at 0.5/1/1.5 s (613/1226/1839) | 400 / 400 / 400 | 400 ×3 | 611 / 1226 / 1839 | 611 / 1227 / 1839 | same | 400 ×3 | 611 / 1226 / 1839 | 400 ×3 | 400 ×3 |
| linear clamp (studs/s) | 400 | 400 | 4472 | 4472 | 4472 | 400 | 5.0e4 | 400 | 400 |
| angular clamp (rad/s) | 377 | 377 | 377 | 527 | 527 | 377 | 377 | 377 | 377 |
| B4a centre: fell / tilt deg / contacts | yes / 45 / 0 | yes / 45 / 0 | no / 11.7 / 1 | no / 7.3 / 1 | no / 7.3 / 1 | no / 0.6 / 1 | yes / 81.5 / 0 | yes / 45 / 0 | yes / 44 / 0 |
| B4a 6 off-centre: fell / max tilt held (deg) | 6 / – | 6 / – | 0 / 13.5 | 0 / 7.3 | 0 / 7.3 | 6 / – | 6 / – | 6 / – | 6 / – |
| B4a sink while held (studs) | – | – | 0.072 | 0.062 | 0.062 | 0.0086 (centre) | – | – | – |
| B4b 16-gon / 32-gon on plane: tilt deg / contacts | 90 / 4 both | same | same | same | same | same | same | same | same |
| B5a box, at rest: v after 5 s (starts rolling by itself) | −10.8 | −10.8 | −11.1 | −14.4 | −14.4 | −9.5 | −1.1 | −10.8 | −10.6 |
| B5a box, 1 studs/s: plateau (studs/s) | 9.09 | 9.09 | 9.31 | 12.67 | 12.67 | 8.37 | 0.67 | 9.08 | 9.10 |
| B5a predicted r·1°·steps/s | 8.38 | 8.38 | 8.38 | 11.71 | 11.71 | 8.38 | 8.38 | 8.38 | 8.38 |
| B5a half-space, 1 studs/s: v after 5 s | 1.0026 | 1.0026 | 1.0037 | 1.0007 | 1.0007 | 1.0021 | 1.0021 | 1.0030 | 1.0024 |
| B5b box: kept % / max sink | 96.6 / 0.042 | 96.6 / 0.042 | 96.6 / 0.014 | 93.4 / 0.009 | 93.4 / 0.009 | 95.3 / 0.022 | 93.9 / 0.023 | 95.2 / 0.021 | 95.9 / 0.017 |
| B5b half-space: kept % / max sink | 99.8 / 0.018 | 99.8 / 0.018 | 99.9 / 0.006 | 100.0 / 0.003 | 100.0 / 0.003 | 99.8 / 0.018 | 99.8 / 0.018 | 99.8 / 0.018 | 99.8 / 0.018 |
| B5c r 2.5 on loose beam: sink at 0.25 s / max while on beam | 0.0101 / 0.114 | 1.3e-4 / 0.027 | 6.7e-4 / 0.0031 | 6.9e-4 / 0.0031 | 6.9e-4 / 0.0031 | 0.0071 / 0.130 | 0.0087 / 0.095 | 0.0101 / 0.115 | 0.0095 / 0.114 |
| B5c rolled off the beam at (s) | 1.46 | 1.41 | 1.48 | 1.45 | 1.45 | 1.25 | stayed | 1.46 | 1.43 |
| B6a pendulum ΔE % of mgL (10 s) / hinge sep | +4.27 / 1.2e-6 | +4.27 | +4.15 / 1.2e-6 | −32.7 / 1.2e-4 | +6.74 / 1.2e-6 | +2.35 | +2.35 | +2.89 | +1.90 |
| B6b triple ΔE % (10 s) / worst sep | +1.30 / 1.5e-5 | +1.30 | +1.17 / 1.6e-5 | −60.1 / 0.021 | +3.91 / 6.9e-6 | −0.20 | −17.6 | +0.31 | −0.18 |
| B6b ms CPU per real s | 217 | 215 | 216 | 9 | 319 | 238 | 253 | 219 | 218 |
| B7 ΔE %/s / Δ\|L\| %/s | 0.281 / 0.156 | same | 0.269 / 0.150 | −0.030 / 0.030 | same | 0.202 / 0.110 | 0.202 / 0.110 | 0.267 / 0.150 | 0.249 / 0.141 |
| B8 (emulated) ω1 at 1 s (100) / ratio at 2 s (2.5) | 92.3 / 2.360 | same | 92.3 / 2.360 | 97.6 / 2.450 | 96.9 / 2.414 | = R0 | = R0 | = R0 | = R0 |
| B8 phase error (teeth of 16) at 2 s / 5 s | −18.9 / −143.7 | same | −18.9 / −143.7 | −6.5 / −91.4 | −11.2 / −121.1 | = R0 | = R0 | ≈ R0 | ≈ R0 |
| B8 KE / drive work at 1 s / 4 s | 0.994 / 0.393 | same | 0.994 / 0.393 | 0.998 / 0.571 | 1.012 / 0.493 | = R0 | = R0 | = R0 | = R0 |
| B10 ms CPU per real s | 279 | 291 | 264 | 30 | 320 | 282 | 312 | 283 | 294 |
| world steps per real s | 480 | 480 | 480 | 671 | 671 | 480 | 480 | 480 | 480 |

(Single runs on this machine, Node 20.11; CPU numbers vary ±10 % run to run.)

### Resting depth is Rapier's contact spring sag, nothing else

The resting sinks follow sag = g / (2πf)² with f in Rapier's own seconds: 60 Hz (fixed body) gives
1226.25/(2π·60)² = 0.0086 studs (B1a measured 0.0086); 30 Hz (dynamic pair) gives 0.0345 (B1b
0.036); 335 Hz gives 2.8e-4 (R1 B1b 2.8e-4); 671 Hz gives 6.9e-5 (R2 B1a 6.8e-5). The time ladder
shows the 1/s² law: B1a 0.0086 / 0.0021 / 5.4e-4 / 6.8e-5 / 8.0e-6 at s = 1 / 2 / 4 / 11.18 / 32.
So the "metre bricks under 125 g" view is right in effect but the operative ratio is g against
Rapier's absolute contact frequency, not size or mass. In R0 a 5-cube stack sags 0.036 per joint,
leans, and topples within 1.2 s (`dbg_stack.mjs`); in R2 it compresses 0.006 in total and stands.

### Length ladder: f32 rounding versus absolute epsilons (`results/table-length-ladder.md`)

Scaling R0 by powers of two (exact in f32) reproduces R0 **bit-for-bit** in B1a–c, B6a and B7 at
every k from 1 to 1/128. Only k = 0.008 changes B6a (+3.67 %) and B7 (0.356 %/s): the energy drifts
are f32 rounding, and their size (1.9–4.3 % in 10 s across R0/R3/Rm/Rp) is noise, not physics.
B4a and B5 change along the power-of-two ladder, so they depend on an **absolute** epsilon:
- B4a centre: falls at k ≥ 1/16, holds (1 contact, sink 0.0086) at 1/32 to 1/128, falls again at
  1/512. Consistent with parry's absolute contact-reuse slide threshold 1e-3 (it is 0.016–0.03 stud
  at k = 1/16–1/32) and, at 1/512, GJK's absolute eps_tol; inferred, not isolated with a switch.
- B5a plateau: 9.09 at k 1, 8.38 at k ≤ 1/32 (= the 1° prediction exactly); the 1e-3 slide
  threshold adds about 8 % at stud scale.
- B5c at k 1/512: the r 2.5 wheel sinks 0.92 through the beam (fails), so very small Rapier units
  are not safe either.
R3 is therefore R0 plus rounding plus a 125× larger reuse threshold: it holds the centre of B4a
but not the off-centre spots and changes nothing else that matters.

### Time ladder (`results/table-time-ladder.md`)

Joint and gear results do not move at all from s = 1 to 100 (B6b +1.1 to +1.6 %, B8 phase error
−143.7 teeth at 5 s in every case); B4a holds from s ≈ 11 (sink 0.072 → 0.009 at s 100, still tilted
10–15°); B1c with the 10× top cube needs s ≥ 4; the free-fall clamp is 400·s.

## Verdicts (R0 → R2)

| test | R0 | R2 | note |
|---|---|---|---|
| B1a | PASS (0.0086) | PASS (6.8e-5) | |
| B1b | MARGINAL (0.036 into beam) | PASS (2.8e-4) | R1 gets the same 2.8e-4 for the pair, not the 0.013 into the floor |
| B1c | FAIL (topples) | PASS (0.006 / 0.024) | R1 also stands (0.049 / 0.144) |
| B2 | MARGINAL (300: 8.2 studs/s sideways, 7.2 rad/s) | MARGINAL (6.5 / 7.2) | asymmetric impulse unchanged |
| B3 | FAIL (clamp 400) | PASS to 4472 studs/s | only R2/R3n lift it |
| B4a | FAIL (all fall) | MARGINAL (holds, 7–15° tilt, sink 0.07) | geometry (4-vertex face) unchanged |
| B4b | FAIL (90°) | FAIL (90°) | geometry |
| B5a | FAIL (8–9 studs/s; even from rest) | FAIL (9.3) | per-step, regime-independent |
| B5b | PASS on plane, MARGINAL on box | same, sink 0.006 | |
| B5c | FAIL (rolls off at 1.46 s; sink 0.11) | FAIL (rolls off 1.48 s; sink 0.003) | sink fixed, runaway not |
| B6a/b | MARGINAL (+4.3 / +1.3 %, f32 noise) | same | per-substep |
| B7 | MARGINAL (+0.28 %/s) | same | per-substep |
| B8 | NOT POSSIBLE natively; emulation FAIL | same | no gear constraint |
| B9 | API list | same | units cannot change the API |
| B10 | 279 ms/real s | 264 | same cost |

## Conclusion

R2 (time-scaled, same steps and iterations) is the best regime and costs nothing in CPU: resting
and loaded contact depths fall 125× (static and dynamic), stacks stand, a box held on one GJK point
no longer falls through a 32-gon, wheels on loose beams sink 0.003 instead of 0.11, and the linear
clamp rises from 400 to 4472 studs/s. It changes nothing that is per step or per substep: the
self-accelerating roll (8–9 studs/s, and it starts from rest), the 4-vertex face, the angular
clamp, joint energy drift, spin gain and the gear row are all identical. R1 alone gets the
dynamic–dynamic half of the gain; the static half and the clamp need fields JS does not expose
(`static_contact_softness`, `normalized_max_linear_velocity`, `normalized_max_corrective_velocity`),
so the alternative to R2 is a bindings fork with three setters. R2d (Rapier's own 1/60 s, 4
iterations) wrecks joints (−60 %) and needs 240 iterations to recover at ×1.15 cost. R3 is R0 with
rounding noise; naive SI (R3n) is worse. Mass scale is irrelevant.

### What adopting R2 in `src/physics/sim.ts` would involve (sketch, not done)

Pick s (11.18 matches g 9.81; the gain is ∝ s², so s = 4 already gives ÷16). Then convert at the
Rapier boundary only: `world.timestep` = s·h (lines 618, 1336), gravity /s²; every `setLinvel` /
`setAngvel` /s (1363–1364, 1721–1722, 1865–1866) and every `linvel()` / `angvel()` read ×s (20
reads), `jointStates` ω and speed ×s; `addTorque` (1232) and `addForceAtPoint` (1999, the grab
spring) /s²; motor target velocities (friction motors, stiction target −offset/fixedDt) /s,
`setMotorMaxForce` (friction τ_f, F_f) /s², motor gain (`FRICTION_GAIN` 1e9, acceleration-based,
1/time) /s; angular damping and grab damping /s; energy-guard energies and floors /s² (or compute
in real units); `SPEED_CAP` (400 → up to 4472) and soft-CCD prediction distance (a length, so
unchanged once computed from real speed × real dt); `STICK_SPEED`, mesh-release speed, and the
300 rad/s gear cap are compared against converted readings. Lengths, masses, friction, restitution,
iteration counts and `chooseK` (rad per step) stay as they are. Contact softness then becomes
335/671 Hz real for every contact, which changes every recorded trajectory.

## Not tested

B9 behaviours were listed, not exercised; restitution 0.1 (product) and soft CCD were not run; R2
was not run with the product's friction motors, energy guard or gear phase feedback (B8 used a bare
re-anchored LinX row without lead or feedback, so its absolute numbers are worse than the
product's); the absolute-epsilon attribution for B4a/B5a is inferred from the ladder, not proven by
a switch; sim.ts was not changed; each configuration was run once (no seed variation).
