# spike-step: a smaller inner step dt/k when needed

`spikes/adaptive/REPORT.md` was not written. The harness refused the Write ("Subagents should return findings as text"), and I did not work around it. The report below is what it would contain; it needs copying in if you want the file.

**Verdict.** Yes. Running each 1/480 s step as k Rapier steps of dt/k with 240/k iterations keeps everything the 240 iterations were chosen for. Rapier's iteration count is its TGS substep count, so the substep size h = dt/(k·iterations) = 1/115 200 s does not change, and h is what sets joint stiffness. Stiffness, pendulum period, joint error, loop closure, slide stops, friction decay, f32 spin gain and the energy guard are unchanged to 3 digits or better. Contacts get better (shallower impacts and drops). Two things get worse:
1. Stiction at rest under ground contact: a cart's wheel joints creep 4.5e-3 rad in 10 s at k = 4, against 1e-4 at k = 1.
2. Restitution is lower: a link striking a wheel rebounds at 0.3 rad/s instead of 1.5 rad/s.

An adaptive rule that drops back to k = 1 when things are slow avoids the first. A k = 8 step costs 1.0–2.0× a k = 1 step (median about 1.4×), paid only while something spins fast. A cap is still needed above what k = 8 covers (about 300 rad/s).

Load: the machine was shared with five other agents throughout, with load averages of 17–46 on 10 cores. Every timing below is inflated and noisy. Read the ratios, not the absolute values.

Everything runs the real code. `spikes/adaptive/sim.ts` is a copy of src/physics/sim.ts at ede9948 with an inner step added. Its defaults are bit-identical to src (k = 1): the copy passes all 240 tests at k = 1. `spikes/adaptive/vitest.config.ts` swaps it in for src/physics/sim.ts, so the existing tests/physics suite runs against it unchanged. Run from the repo root: `KNAP_K=4 npx vitest run --config spikes/adaptive/vitest.config.ts tests/physics`.

## What the copy does

- `stepFixed` still advances 1/480 s, and `fixedDt`, `time` and `stepCount` are unchanged. Inside, it runs k inner steps. Each one does applyGrab, world.step, removeFallen, updateFriction, an optional cap, and guardEnergy.
- `setK(k)` sets:
  - `world.timestep = dt/k`;
  - `numSolverIterations = max(1, round(30/k))` (free bodies);
  - `setAdditionalSolverIterations(240/k − free)` on jointed bodies;
  - the soft-CCD prediction on free bodies (kept at the outer-step value);
  - the stiction hold targets, multiplied by oldDt/newDt.
- `adaptive` chooses k once per fixed step, from the state only (see section 4).
- `omegaCap` (modes body, group, damp) is the speed-cap alternative.
- Options `frictionOuter` and `guardOuter` run friction and the guard once per fixed step instead.
- Counters: `kHist`, `kChanges`, `tWorld` (ms inside world.step), `tTotal`.

## 1. The tests/physics suite at k = 1, 2, 4, 8 (240 tests each)

Results: k = 1: 240 pass. k = 2: 6 fail. k = 4: 12 fail. k = 8: 11 fail. Every measurement line is lined up by k in `out/report-table.txt`.

**Verified unchanged** (identical, or within the last printed digit, at every k):
- pendulum period: 309.46 ms against 309.46 predicted;
- four-bar closure: 6.5e-5 / 5.7e-5 units at k1 / k8;
- axle slide stop: −2.00000, joint error 1.2e-7;
- stiction holds below the load: deviation 1–2e-5 rad in 20 s at all k, and turns 0.71° in 2 s at 1.2 × τ_f at all k;
- friction spin-down: stops at 68.03 s against 67.69 s predicted;
- cart coast-down: 49.53 / 49.55 units against 49.38 predicted at k1 / k8;
- cart on 15°: −0.11 % / −0.02 %;
- wheel incline: within 0.17 %; wheel rolling speed: within 0.5 %;
- welds: 1e-14;
- crank wheel: the guard keeps energy at 1.00 % of KE_max;
- examples: joint errors 0.4–1e-5;
- free-spin gain: 0.51 % / 0.50 % in 5 s.

**Better with k** (k1 / k2 / k4 / k8):
- collision drop from 40, lowest cell centre (contact at 0.92; lower = deeper impact): 0.656 / 0.835 / 0.912 / 0.967;
- deepest into the floor in drop tests: tumbling pin 0.138 → 0.002 / 0.002 / 0.020; wheel r 4 with tilted spin 0.162 → 0.068 / 0.044 / 0.046;
- non-principal-inertia blow-up (max ω over 10 s): 251 rad/s with +1662 % energy at k1, then 61 / 55 / 52 rad/s;
- grab, light pin off target after 1.5 s: 7.8e-3 → 3.8e-3;
- contact energy noise the guard removes on a rolling cart: 479 → 59.

No fall-throughs at any k.

**Worse with k:**

| quantity (test tolerance) | k1 | k2 | k4 | k8 |
|---|---|---|---|---|
| cart example at rest, realistic: joint creep (< 1e-3 rad) | 2.2e-4 | 1.7e-3 ✗ | 1.1e-2 ✗ | 9.9e-3 ✗ |
| parallelogram at rest: creep (< 1e-4) | 1.2e-7 | 4.4e-5 | 3.0e-4 ✗ | 2.6e-4 ✗ |
| link striking a pinned wheel: rebound (> 0.64 rad/s) | 1.49 | 0.52 ✗ | 0.32 ✗ | 0.32 ✗ |
| cart at 100 units/s, friction off: energy (< 1 %) | 0.84 % | 0.99 % | 1.01 % ✗ | 1.01 % ✗ |
| "low" 9-hole beam at 200 rad/s: step-to-step ω rise (< 1e-3) | 7.6e-4 | 1.2e-4 | 3.1e-3 ✗ | 2.9e-3 ✗ |
| free 3×3×3 block: off-axis ω leak (< 3e-3) | pass | pass | 3.7e-3 ✗ | 5.2e-3 ✗ |

- **Cart creep is systematic, not chance.** I re-ran it with six gravity perturbations per k (`out/creep2.jsonl`). The worst joint (a wheel on its axle) creeps:

  | k | creep in 10 s (rad) |
  |---|---|
  | 1 | 0.3–1.2e-4 |
  | 2 | 0.4–1.0e-3 |
  | 4 | 4.4–4.6e-3 |
  | 8 | 3.8–4.0e-3 |

  The joint keeps letting go and sticking again inside a fixed step. Its measured |ω| at rest is about 0.01 rad/s, right at STICK_SPEED.
  - Scaling STICK_SPEED by k did not change it.
  - Running updateFriction and the guard once per fixed step did not change it.

  The cause is not found. My guess is wheel–ground contact jitter at the smaller step.
- **Restitution:** with restitution set to 0.1 the expected rebound is about 1.3 rad/s. k = 1 gives 1.49; k ≥ 2 gives 0.32–0.52. Not investigated further.
- **Spin-down step rise:** 3e-3 rad/s at 200 rad/s is 1.5e-5 of ω, and it is not monotonic in k. Unexplained, and small.
- **Off-axis leak:** the test's own comment says this leak wanders with the step count.

**Fail only by construction** (no physics meaning):
- the bit-for-bit hashes recorded at k = 1, including the collision example's loose-beam hashes;
- `numSolverIterations === 30`;
- "free-body count does not change a mechanism" at k = 4 (free iterations 8 against 7.5, rounding);
- "switched off vs created off" at k = 8 (difference 0.003).

**Bit-identity check** (`out/bitident.jsonl`): the pendulum at μ = 0 with the guard off has the same positions at every k after 2 s (difference 0). The other examples differ by 1e-7 to 1e-2, which is f32 rounding amplified by their own dynamics. The chaotic triple pendulum diverges by 3–13 units. The collision example differs by up to 0.3 because contacts are regenerated k× more often.

## 2. Stiffness (`out/stiffness.json`)

The model is a chain of 10 or 20 revolute links with a welded 5×7-hole load at the end. Three cases: hanging at rest, the grab spring pulling at its force cap, and released horizontal.

| n | k / iterations (substeps per 1/480 s) | hang error | sag | pull error (mean / max) | ms per simulated s |
|---|---|---|---|---|---|
| 10 | 1/240, 2/120, 4/60, 8/30 (240) | 9.5e-6 | 1.9e-4 | 1.37e-3 / 2.34e-3, all four the same | 1007 / 1043 / 1516 / 1908 |
| 10 | 1/120 (120) | 3.8e-5 | 7.6e-4 | 5.3e-3 / 9.4e-3 | 896 |
| 10 | 1/60 (60) | 1.5e-4 | 3.0e-3 | 2.0e-2 / 2.8e-2 | 439 |
| 10 | 4/120 = 8/60 (480) | 5.5e-6 | 5.2e-5 | 3.6e-4 / 6.2e-4 | 2788 / 2993 |
| 10 | 4/240 = 8/120 (960) | 1.8e-6 | 1.3e-5 | 9.8e-5 / 1.8e-4 | 5938 / 5373 |
| 20 | 1/240 … 8/30 (240) | 1.18e-5 | 3.8e-4 | 1.97e-3 / 3.11e-3 | 3158 → 4872 |
| 20 | 4/240 (960) | 3.6e-6 | 2.7e-5 | 1.4e-4 / 2.8e-4 | 16787 |

**Verified:** dt/4 with 60 iterations is exactly as stiff as dt with 240: hang, sag and pull agree to 3 digits. Stiffness depends only on the total substep count per 1/480 s. Pull error scales roughly with h² (×3.8 when the substeps are halved). Extra stiffness costs about linearly: 4× the substeps is 5.9× the time.

Swing errors (released horizontal) differ by up to 30 %. I attribute that to the trajectories diverging, not to stiffness.

## 3. Cost (`out/cost.jsonl`)

Setup: k interleaved, order alternating each round, 3 rounds, median, load average about 28.

| model | k8/k1 cost |
|---|---|
| pendulum | 2.02 |
| triple pendulum | 1.62 |
| four-bar | 1.75 |
| parallelogram | 1.17 |
| sliding axle | 1.04 |
| weld test | 1.40 |
| collision | 1.18 |
| crank wheel | 1.39 |
| cart | 1.42 |
| 10-link chain with load | 1.89 |
| 20-link chain with load | 1.54 |

- JS (everything outside world.step) is 1–2 % of a step at k = 1 and 5–12 % at k = 8, growing about k-fold. Example: cart 5 → 42 ms per simulated second.
- Rapier's own time also grows (pendulum 110 → 205 ms), from its fixed cost per world.step.
- So of the extra cost at k = 8, about one third to one half is JS and the rest is Rapier.
- Per fixed step at k = 8 under this load: cart 1.6 ms, 20-link chain 10 ms.

## 4. Adaptive

**Rule (as run):**
- levels k ∈ {1, 2, 4, 8}.
- Once per fixed step, before stepping: ω* = max |ω| over the nominated bodies + max(0, ω − ω one fixed step ago). The second term predicts one step of further spin-up.
- Up immediately to the smallest k with ω*·dt/k ≤ 0.08 rad.
- Down only when ω*·dt/k′ ≤ 0.04 rad, and not within 48 fixed steps (0.1 s) of the last step up.
- Bands: k1 < 38, k2 < 77, k4 < 154, k8 < 307 rad/s.

**Runs:**
- **Pinned wheel** (r 2.5 and r 1, impulse to 50, 100, 200 or 400 rad/s, coast 3 s, realistic friction, guard on):
  - Under the adaptive rule ω matches fixed k = 8 to 1e-3 rad/s. Example, r 2.5 from 400 rad/s: 376.892 / 351.755 / 326.617 at 1, 2, 3 s.
  - Deceleration 24.9 against 25.1 rad/s² predicted (τ_f/I).
  - Joint error 3e-11. The guard removes the same amount as at fixed k.
  - k steps down 8 → 4 → 2 → 1 with 3–4 changes. Rotation per inner step stays ≤ 0.04 rad up to 300 rad/s, but is 0.104 rad at 400 rad/s.
- **Fast pendulum** (thrown at 30, 100 or 200 rad/s): end energy and joint error are identical at every k and under the adaptive rule. The pendulum alone is not k-sensitive, so this only shows that switching costs nothing.
- **Fast cart** at 300 units/s: chassis speed 297.9–299.9 at k1 against 300.0–301.3 at k8. Chassis bounce on the floor 0.115 at k1 against 0.019 at k8.
- **Cart coasting from 100 units/s, realistic friction,** with contacts present during each k change:

  | run | distance (units) | k changes |
  |---|---|---|
  | k1 | 310.53 | 0 |
  | k8 | 311.47 | 0 |
  | adaptive | 311.45 | 3 |
  | forced 1↔8 every 7 steps | 310.76 | 823 |

  Joint error ≤ 5e-5 in all of them.
- **Discontinuities**, tested by forcing k to alternate 1 ↔ 8 every 7 fixed steps (549 changes):
  - The pendulum comes to rest at the same angle (−89.3162°) with 0 creep, with or without the stiction rescale.
  - The collision example's loose beam ends at 0.9142 against 0.9143.
  - No energy jump or joint-error spike was seen, and the guard removed nothing extra.
  - The `frictionOuter` + `guardOuter` variant (friction and guard once per fixed step, hold = 1/fixedDt) gave results identical to running them per inner step on 57 friction, cart and pendulum tests.
  - Do not use `frictionOuter` without `guardOuter`: the guard then subtracts the stale friction work k times (my spike bug) and spin-down came out 4× too fast.
- **Determinism (verified):** the triple pendulum thrown at 80 rad/s under the adaptive rule, run twice, gave the same pose hash (fe1cd0ff) with 22 k changes each time. The previous ω* must be part of any snapshot.
- **Accumulator (src/app):** nothing changes. It still counts fixed steps: 2 per frame at speed 0.25 and 60 fps. Each fixed step costs 1–2× more while k is high, so the 8 ms budget drops steps sooner on big models; the existing "slow" readout shows it. Dropped steps depend on wall clock, as before, but k never does.
- **Soft CCD:** kept at the outer-step prediction distance (1.04 units). No fall-throughs were seen.
- **Not handled:** a spin-up within one fixed step that the prediction cannot see (an impact) runs that one step at the old k.

## 5. Speed cap

- **Rapier's own clamps:**
  - The angular clamp is π/4 per Rapier step: 377 rad/s at k1, 754 at k2, and above 1000 at k4. **It moves with dt.**
  - The linear clamp of 400 units/s does not move with dt (400 at every k).
- **Cap on one body only:** joint error stays about 1.6e-6, because the next solve absorbs it. But the neighbouring links still whip: 48.8 rad/s against 22.5 with a whole-group cap. The energy taken out goes through the joints into the neighbours.
- **Damping near the cap:** does not hold the limit (8 → 21.5 rad/s) and over-brakes from far above (200 → 1.9 rad/s in one step). Reject it.
- **Whole-group uniform scale** (the same operation as the energy guard): keeps joint and contact constraints consistent. This is the one to use.
- **What a user sees:**
  - The pendulum example (uncapped peak 28 rad/s) reaches the bottom in 0.094 s. With a group cap of 15 rad/s it takes 0.123 s; with 5 rad/s, 0.304 s, falling at a constant speed, as if in oil.
  - For a 1:25 train with a 50 rad/s cap on the small gear, the arm is held to 2 rad/s: about 0.8 s for a quarter turn instead of about 0.1 s. A cap alone at k = 1 is not acceptable for that case.

## 6. f32 spin gain

Setup: frictionless, no gravity, guard off, 10 s. K/K0 is bit-identical at k = 1, 2, 4, 8:
- pinned arm at 20 rad/s: 1.08651;
- pinned wheel r 2.5 at 20 rad/s: 1.26475;
- a loose tumbling part: 1.0626 at k1 and k2, 1.0679 at k4 and k8 (its free substeps go from 30 to 32 by rounding).

The gain depends only on the substep count, not on dt. The energy guard is still needed and behaves the same.

## Recommendation for the design

1. **Levels and iterations.** Inner step dt/k, k ∈ {1, 2, 4, 8}. Jointed iterations 240/k (120, 60, 30). Free iterations max(1, round(30/k)) (15, 8, 4).
2. **Switching rule.** Per fixed step, from the state only:
   - ω* = max |ω| over the gear-train bodies (or all dynamic bodies; it is cheap), plus the positive part of the increase over the previous step;
   - step up immediately to the smallest k with ω*/480/k ≤ 0.08 rad;
   - step down only at ≤ 0.04 rad, and no sooner than 0.1 s after the last step up;
   - keep the previous ω* in any snapshot.
3. **What a k change must rescale:** `world.timestep`, `numSolverIterations`, and every jointed body's `additionalSolverIterations`. Run updateFriction and guardEnergy once per fixed step with hold = 1/fixedDt, so nothing in friction or the guard depends on k. Keep the grab spring per inner step and the soft-CCD prediction at the fixed-step value.
4. **Cost.** 1.0–2.0× per fixed step at k = 8, paid only while something spins fast.
5. **Cap on top.** Yes: a group-uniform velocity scale at 300 rad/s on nominated gears, applied after each inner step (k = 8 runs 0.078 rad per step there). Never a single-body clamp or damping. Rather than add k = 16, cap.

## Still wrong / not tested

- **Measured:** rest creep under ground contact at k ≥ 2 (4e-3 rad in 10 s). Cause not found; scaling STICK_SPEED or running friction per fixed step does not fix it. The adaptive rule avoids it only because k = 1 at rest. A model with a fast gear (k ≥ 2) and a joint that should hold at the same time is untested.
- **Measured:** impact restitution drops from about 0.12 to about 0.03 of the impact speed at k ≥ 2, so impacts look slightly deader while k > 1.
- **Not tested:** the mesh row itself under switching (spike-mesh). Its per-step anchor update and phase feedback run per inner step here. The obvious next check is whether its "lead" and phase feedback tolerate a k change mid-mesh.
- **Not tested:** in-step impact spin-ups; models larger than 22 bodies; the browser (all timings are Node, under heavy load).
- **Unexplained:** the 3e-3 rad/s step-to-step ω rise at 200 rad/s for k ≥ 4.

## Files

Everything is in `/Users/antony/Desktop/knap.nosync/spikes/adaptive/`; run every command from the repo root.
- `sim.ts` — the modified copy
- `vitest.config.ts` — swaps the copy in for the real sim
- `stiffness.test.ts`, `dyn.test.ts`, `cost.test.ts`, `bitident.test.ts`, `creep.test.ts` — the measurements
- `table.py` — lines up the report files by k
- `out/` — all raw results