## Report: gear–gear mesh coupling spike (`spikes/coupling/`)

**Verdict: works, with limits.** The proposed construction is expressible and stable in Rapier 0.21. It is a single generic joint with only `LinX` locked, re-anchored in place before every step, with f64 phase feedback. It needs three changes, all measured below:
- a **lead offset** of the anchors (fixes an in-step error that grows with rotation per step);
- **phase feedback is mandatory** (without it, gears drift by teeth per minute);
- for gears that swing into mesh, a **one-sided distance limit (`LinY`) in the same joint** in place of cylinder contact.

Mean ratio and phase errors are negligible up to about 50 rad/s. The limits come from Rapier itself: the 377 rad/s angular clamp, the f32 spin-gain artefact, and end-of-step velocities that are not fully converged along long trains.

Nothing under `src/`, `tests/`, `e2e/` or `docs/` was touched. I ran no git commands. `npm test` does not pick these files up (they are `.mjs` outside `tests/`).

### How to run
From the project root:
- `node spikes/coupling/q1_joint.mjs`
- `sh spikes/coupling/run_q2.sh`, then `cd spikes/coupling && python3 summarize_q2.py` (304 runs of 60 s each; about 20 min wall time at 6 in parallel)
- `node spikes/coupling/q2_energy.mjs 60`
- `node spikes/coupling/q3_torque.mjs [hold static dynamic r5 r25 idler chain mass100 friction recreate]`
- `node spikes/coupling/q4_planet.mjs [planet sunfree swing]`, plus the sweeps `sh spikes/coupling/run_swing.sh` and `sh spikes/coupling/run_swing2.sh`
- `node spikes/coupling/q5_robust.mjs [loop3 loop4 offset train determinism cost remove]`

The shared code is `spikes/coupling/lib.mjs` (class `Mesh`, energy `Guard`, and `Friction`, a copy of the sim.ts friction motor and stiction hold). Raw outputs are in `spikes/coupling/out/`; `q5c.txt` has a wrong analytic inertia and is superseded by `q3_chain.txt`. The `dbg_*.mjs` files are the diagnosis scripts mentioned below.

Settings follow sim.ts: dt 1/480 s, 240 solver iterations, 1 internal PGS iteration, `maxCcdSubsteps` 0, density 1, g = 1226.25 units/s².

Every script ends with `process.exit(0)`. Without it, Node 20 spins for minutes at exit inside Rapier's wasm-bindgen finalizers (seen in `sample`: `FreeEnvironment` → `DrainTasks` → `TriggerUncaughtException`).

The machine load average was about 50 on 10 cores for most of the run, so all ms figures are inflated. The ratios between them are more reliable.

### 1. Is the joint expressible, and is it one row? (`q1_joint.mjs`)
- **In-place updates work.** `ImpulseJoint.setLocalFrame1/2` (and `setAnchor1/2`, `setFrameX1/2`) take effect on the very next step:
  - after `setAnchor1(+0.1 x)`, the separation was 0.10000 after one step;
  - after switching the axis with `setFrameX` plus a new anchor, the new axis reached 0.0984 of 0.1 in one step, and the old axis became free.
- **Recreating is unnecessary.** Removing and recreating the joint every step gave bitwise-identical results to re-anchoring, both in a loaded hold (`F` = 1.47e5) and in the dynamic 1:5 test. So there is no warm-start loss either way.
- **Cost of the update.** The JS-side re-anchor costs 5 µs/step (14 µs under load); recreating costs 13–34 µs/step.
- **Frame 1 defines the locked axis.** With frame1 X = x and frame2 X = y, and body 2 given v = (1, 1, 0), the result was v1 = (0.5, 0, 0) and v2 = (0.5, 1, 0). With the frames swapped: v1 = (0, 0.5, 0) and v2 = (1, 0.5, 0).
- **It is a pure single row.**
  - One step agrees with the analytic single-row impulse to 1e-4–2e-3, against velocities of about 1. The residual comes from the Jacobian rotating within the step.
  - Linear momentum changed by 1e-6.
  - Over 2 s of free tumbling, the locked component stayed ≤ 5.6e-7 while the free separation grew to 3.2 units: no hidden rows, no drift on the free axes.
- **The 0.1 rad/step question: it matters, and not because of which frame is used.**
  - Cause: the anchors are fixed on both gears' material and X is fixed in gear 1's frame for the whole step. So the row holds gear 2's anchor at a fixed coordinate in gear 1's frame. Under true rolling that coordinate drifts along an epicycloid by D(1−k²)φ³/6, with k = (r1+r2)/r2 and φ = gear 1's rotation relative to the line of centres in one step.
  - Effect: the end-of-step velocity is off by about 3× the mean.
    - At 50 rad/s (0.1 rad/step) for 1:1, the end-of-step ratio error is 3.3% rms.
    - At 200 rad/s for 1:5, it is 28%.
  - Swapping which body owns the frame only halves it (28% → 15%).
  - **Fix ("lead"):** shift both anchors along t by λ = D(1−k²)φ/(2k²), with φ = (ω1·a − β̇)·dt. This brings the 1:1 error at 50 rad/s from 3.3% to 0.024%, and 1:5 at 200 rad/s from 28% to 0.9%.

### 2. Ratio and phase accuracy, 60 s per run (`out/q2.jsonl`)
Coverage: all 16 ordered pairs of r ∈ {0.5, 1, 1.5, 2.5} on axis Z, plus 3 pairs on X and Y, with the driver at 1, 10, 50 and 200 rad/s.

With feedback and lead:

| Driver speed | Max mean-ratio error | Max phase error (teeth) |
|---|---|---|
| ≤ 10 rad/s | 1.6e-7 | 4e-4 |
| 50 rad/s | 4.8e-6 | 0.062 (only 2.5:0.5, where the small gear runs at 250 rad/s); ≤ 0.0065 otherwise |
| 200 rad/s | 1.3e-5 | 0.71 |

- The phase error is a bounded lag, not drift. Mean ratios come from angles tracked in f64.
- **Without feedback the gears drift** by 0.15–12 teeth per minute at 10 rad/s, and up to 1800 teeth per minute at 50 rad/s.
- **Axes X, Y and Z give identical results** to 3 significant figures.
- **Hard limit: Rapier clamps angular speed at 377 rad/s** (π/4 per step). Any gear pushed past it breaks the ratio; 2.5:0.5 with the driver at 200 rad/s had a mean ratio error of −61%.
- **End-of-step ω noise:** 1.1% rms on the 0.5:2.5 output at 1 rad/s, about 0.002 rad/s absolute (inertia ratio 625). The mean is exact.

**Energy, free-spinning, 60 s (`out/q2_energy.txt`):**

| Case | Raw K(60 s)/K0 | With the sim.ts guard |
|---|---|---|
| Single rotor, 10 rad/s | 1.90 | 1.010 |
| Single rotor, 50 rad/s | 1.45 | 1.010 |
| Pair 1:1, 10 rad/s | 1.86 | 1.010 |
| Pair 0.5:1.5, 10 rad/s | 3.1 | 1.010 |
| Pair 0.5:2.5, 10 rad/s | 1.85 | 1.010 |
| Pair 1:1, 50 rad/s | 0.33 (0.81 with lead) | unchanged — the guard never adds energy |

- The single rotor's gain is the known f32 spin-gain artefact. Pairs show the same gain or more.
- At 50 rad/s the mesh is an energy sink, which the guard does not restore. The sign varies: 0.5:1.5 with lead gains ×2.5 raw, which the guard brings back to 1.0102.
- `decoupleInertia` is irrelevant for symmetric gears and was not applied.

### 3. Torque transmission (`out/q3*.txt`)
- **Static balance point vs analytic:**
  - 1:1: off by 1.6e-4 rad;
  - 1:2.5: off by 1.8e-5 rad;
  - 0.5:1.5: off by 2e-3 rad, but it had not fully settled (|ω| still up to 0.044 rad/s);
  - 5-gear idler: off by 1.1e-4 rad.
- **Dynamic acceleration from rest vs the reflected-inertia value** (α0 = Q/I_eff, I_eff = Σk_j²I_j): errors of −0.15%, −0.045% and −0.02%. Angle trajectories match an RK4 solution of the reduced model within 0.2% for 0.2–0.4 s.
- **1:5 lifting a heavy arm with a light input:** α0 error 7e-5; θ(0.8 s) = −1.1538 vs −1.1515.
- **Compound 1:25** (4 gears, two on one shaft):
  - α0 error 5e-5; θ(0.2 s) = −6.843 vs −6.837.
  - At 1 s it is −74.86 vs −75.74 (1.2% off), and at 1.5 s −60.6 vs −56.5: the input reaches over 100 rad/s, so the in-step error and energy loss grow.
  - Kinematic residual 2.4e-4 rad.
- **Idler chains of 6, 11 and 21 gears:** α0 error over the first 5 steps was +0.6%, −1.1% and −1.5%. θ(t) stays within 0.2%. The kinematic residual is ≤ 7.7e-6 rad along 21 gears, and the phase error ≤ 1.1e-5 teeth.
- **Mass ratio 119** (0.985 vs 117.6): α0 −0.6%; θ(t) within 0.15%.
- **Revolute anchor error:** ≤ 3.8e-6 units everywhere.
- **Compliance in a balanced hold** (tangential force up to 1.47e5):
  - with feedback, 7–10e-11 units of phase per unit of force — effectively rigid;
  - without feedback it creeps rather than deflecting elastically: 0.003–0.009 teeth in 10 s.
  - Buzz: ω rms 2e-5 to 2e-3 rad/s.
- **sim.ts joint-friction motors** (μ = 0.2 on the revolutes):
  - 1:5 α0 = −18.85 vs −18.48 analytic including friction (2% off); the final stop is −0.6442 vs −0.6436.
  - In a hold within the friction band, |θ| ≤ 2.4e-5 rad over 5 s.

### 4. Emergent mechanisms (`out/q4a.txt`, `out/swing*.txt`)
- **Planetary with a fixed sun:** ω_planet/ω_arm matches 1 + r_s/r_p within 7e-7 for (1,1), (2.5,0.5) and (0.5,1.5), on axes Z and Y, at 1 and 10 rad/s. Phase error ≤ 3.6e-4 teeth.
- **Sun free and driven, arm free:** the arm speed is 2.7–3.6% below the value from conservation of p_β (1.566 vs 1.610 rad/s). This is Rapier, not the mesh:
  - p_β leaks at a rate proportional to the substep count (−0.058, −0.28 and −1.12 per second at 60, 240 and 960 substeps);
  - with no mesh at all, a lone rotor gains 1.33%/s at 240 substeps vs 0.31%/s at 60 (`dbg_sunfree.mjs`, `dbg_spin.mjs`).
- **Swing-arm selector** (axis Y; output load is angular damping 2/s):
  - **Best variants (I/J/K/L): the "stop" mesh, cylinders at root radius r − 0.16, rate-limited snap.** They select, engage once per reversal, stop at exactly the design angle (β = 0.500, overlap 0.0000), transmit, and release about 0.03 s after reversal. This held over 3 reversals, also with planet-bearing μ 0.2 and arm-pivot μ 0.05.
  - **Engagement jerk:** peak α_O at engagement was ≈ 4900 rad/s², the same with or without snap. This matches an output going from rest to about 5 rad/s within a few steps (5 rad/s in one step would be 2400 rad/s²).
  - **Full snap** (half a tooth corrected in one step) kicks hard: 3.7e4–1.1e5 rad/s², ω_O up to −169 rad/s, and repeated re-engagement.
  - **Cylinders only, without the stop row:** the planet rests 2·eps (0.04–0.10 units) inside pitch distance. With eps = 0.02 it chatters; with eps = 0.05 it is clean.
  - **A tan 20° separating force is not needed.** With the stop row it changed nothing; with cylinders only it caused chatter.
  - **Default sim.ts friction stops the selector:** with μ 0.2 on both the arm pivot and the planet bearing, the arm sticks and never selects. The arm pivot's friction torque (≈ 277, from the weight it carries) exceeds the planet bearing's drag (≈ 239).

### 5. Robustness (`out/q5*.txt`)
- **Triangle of 3 gears (cannot turn):**
  - With motor max force 1e3 or 1e6 it locks: |θ| ≤ 1e-4 rad over 5 s, phase ≤ 1.9e-4 teeth.
  - Without feedback it creeps 0.23 rad (0.46 teeth) in 5 s.
  - With an unlimited motor (Rapier's default max force) it fails: 4.5 rad of rotation, a peak of 399 rad/s, phase errors of 9–11 teeth.
- **Square loop of 4 gears:** turns with exactly ±100.0000 rad in 10 s; phase ≤ 8.9e-5 teeth.
- **Centre distance off by ±0.02:** ratio −0.666667 exact; phase ≤ 1.7e-4 teeth.
- **20 meshes in one train:**
  - mean ratio 0.9999992; phase ≤ 8.8e-4 teeth;
  - but the last gear's end-of-step ω is 9.748 vs 10 (2.5% low): velocities are not converged along 20 links.
- **Determinism:** bitwise identical between runs.
- **Removing a gear body:** Rapier deletes the attached mesh joints. `joint.isValid()` must be checked before touching the removed body; the remaining gears coast.
- **Cost:**
  - At load average ≈ 4: 152 → 175 ms per simulated second for a 2-gear pair, so about 22 ms per mesh per simulated second.
  - At load average ≈ 50: 28–42 ms per mesh per simulated second, against about 75 ms for each body on a revolute. The JS re-anchoring is about 3 ms of that.

### Recipe that worked best
Per mesh, once:
- `JointData.generic(A1, A2, {x:1,y:0,z:0}, JointAxesMask.LinX)`, then `world.createImpulseJoint(data, gear1, gear2, true)`.

Every step before `world.step()`:
- **Geometry:** P = c1 + d·r1/(r1+r2), n = in-plane unit(c2 − c1), t = a × n.
- **Plain meshes:** both anchors at P + λt, plus −e·t on anchor 2 (gain k = 1).
- **Phase:** φ = r1θ1 + r2θ2 − (r1+r2)ψ, with θ unwrapped twist angles and ψ the angle of n, all in f64.
- **Frames:** `setLocalFrame1/2(anchor, rotation taking x to t)` in each body's local coordinates.
- **Swing-in meshes ("stop"):**
  - anchors at c1 + r1·n and c2 − r2·n;
  - right-handed frame X = t, Y = n, Z = −a (Z = +a is left-handed; it produced a garbage quaternion and locked the gears together);
  - `impulseJoints.raw.jointSetLimits(h, 1 /*LinY*/, stopMin, 1e6)`;
  - stopMin = 0 for a free arm. For fixed-axis pairs it must be min(0, D0 − r1 − r2): at Δd = −0.01 a stop of 0 fights the revolutes (phase 2.7e-4 teeth, end-of-step ratio 1.4% off).
- **Proximity rule:**
  - engage below r1 + r2 + 0.03; release above r1 + r2 + 0.13;
  - snap φ0 to the nearest (k+½)·π·0.125;
  - clamp the correction to 0.002 units per step.
- **Collisions:** gear–gear cylinders at r − 0.16.
- **Keep:** the energy guard.

### Known failure modes
- Above 377 rad/s Rapier's clamp breaks the ratio.
- Above about 50 rad/s the mesh dissipates energy (up to 19% per minute with lead), and the phase lag reaches 0.06–0.7 teeth.
- End-of-step velocities are noisy or unconverged: 1% with high inertia ratios, 2.5% along 20 meshes. This corrupts any velocity-based energy accounting.
- Rapier's per-substep spin and momentum artefact: 3% error in the free-arm planetary.
- An infeasible loop driven by an unlimited motor runs away.
- A rate-unlimited snap kicks hard.
- sim.ts friction loads make a swing arm stick.
- The stop row conflicts with fixed-axis pairs that are built slightly too close.

### Not tested
- Explicit-impulse, motor-pair or multibody alternatives. The proposed construction worked, so I measured none of them.
- Non-parallel gears (bevel, worm, crown), internal ring gears, racks.
- Coplanarity tolerance, and gears whose axis direction rotates in 3D (the twist measurement assumes a fixed axis direction).
- Tooth colliders and ratchets.
- Integration with sim.ts itself (guard group merging, `decoupleInertia`, stiction with meshes).
- Engaging two gears that are both already spinning fast.
- Browser timing.

### When to switch engines
I would not switch for the current scope. I would recommend an engine with native gear constraints and f64 or better integration (for example Jolt's GearConstraint via its wasm build) if any of these become requirements:
- gears above about 300 rad/s;
- accurate momentum or energy over minutes;
- converged velocities along long trains.
