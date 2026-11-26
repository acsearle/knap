# spike-mesh: the gear mesh row inside knap's real Simulation (`spikes/gearsim/`)

The tool harness blocked writing `spikes/gearsim/REPORT.md`, so this message is the report. Please save it there if you want it on disk. All scripts and raw outputs are in `spikes/gearsim/` and `spikes/gearsim/out/*.txt`.

## Verdict

**The mesh row works inside the real `Simulation`.** It runs alongside everything that class does: kinematic analysis, friction motors with the stiction hold, the energy guard, `decoupleInertia`, body removal, the grab spring, ground and free root, and the wheel colliders.

It needed three integration changes, all measured:
- **Guard groups.** An engaging mesh must merge the two gears' energy-guard groups, for good. Without the merge, the guard brakes a geared pendulum to a stop: −0.996 mgL in 4 s.
- **Speed-cap release.** A mesh must release while either gear body moves faster than about 350 units/s. A meshed gearbox that falls into Rapier's 400 units/s linear clamp blows up, at every k.
- **Substep plumbing.** If the step is made smaller, the friction hold, soft CCD and every per-step rule must use the world step h = dt/k, not dt.

**Friction does not fight the mesh.** In 42 of 42 static threshold cases the motion matches the analytic fall/hold/lift prediction within ±3 % of the threshold.

**The k = 1 speed limit is the real problem, and ordinary builds hit it all the time.**
- **Above 0.1 rad/step at k = 1 the mesh becomes a brake.** The fastest meshed gear tops out at about 0.14–0.18 rad per world step (70–84 rad/s).
  - Energy only goes down. I measured no energy creation in any fixed-frame model, with the guard on or off.
  - The phase error stays below 0.001 teeth, and there is no visible reversal.
- **Examples.** A 7-hole arm dropped through 1:25 loses 80 % of mgL and reaches the bottom at 0.64 s instead of 0.43 s. A 3:1 geared pendulum loses 15 % of mgL.
- **What fixes it.** k = 2 fixes 1:5; k = 4 fixes 1:25 with arms of 7 or 15 holes. 1:125 with a 15-hole arm still loses 31 % at k = 4 and needs about k = 8.
- **Above about 0.2 rad/step the failures are worse.**
  - Grab-yanking a 1:5 arm at k = 1 drives the input to the 377 rad/s clamp, the phase error reaches 0.67 teeth, and the arm moves *down* while it is pulled up.
  - A free gearbox spinning at 100 rad/s (0.21 rad/step) reverses its small gear within one step.

**Still wrong:**
- A swing arm pinned to the frame sticks at Real.
- The guard removes 0.2–5 % of K per second after spinning gears engage, for a reason I did not find.
- Engagement off the grid snaps the phase by up to 0.46 teeth, so teeth are drawn interpenetrating for up to about 0.2 s.

**Load and timing.** The load average was 35–127 on 10 cores throughout (six agents). Every timing is inflated and noisy; only the interleaved ratios mean anything.

## What I built

- **`spikes/gearsim/gearsim.ts`** is a copy of `src/physics/sim.ts` at ede9948, with every change marked `GEARSIM` (365 diff lines). Everything else is imported from `src/`.
- **Models** are built with `ModelBuilder`, `beam`, `makeCell`, `setRim`, `setGround` and `setFixRoot`.
- **Rim r 0.5** is written into the cell directly (`lib.ts` `putRims`). `validateModel` still runs, with only the rim-range error filtered out. No constant was relaxed. The r 0.5 rim is the hub barrel: collider radius 0.46, zero extra mass.
- **Run:** `sh spikes/gearsim/run.sh <script> [args]` (esbuild bundle into `out/`). The scripts are `basics`, `threshold`, `feel`, `guard`, `swing`, `slide`, `cart`, `speed`, `hash` and `cost`, plus the diagnosis scripts `dbg_fall`, `dbg_heavy` and `dbg_spinengage`.
- **Test-only drive.** `setDrive(body, τ)` applies a constant torque whose work is credited to the guard reference. Without that credit the guard removed 98 % of an applied torque's work. The product needs no such thing: the grab resets the group while it is held.
- **Typecheck.** `npx tsc -p spikes/gearsim/tsconfig.json` is clean.

## Every place the Simulation had to change

1. **Options:** `gears` (every rim is a gear of pitch radius r, default true), `substeps` k, and `mesh` (overrides of `MESH`).
2. **Constructor:** h = fixedDt/k, `world.timestep = h`, solverIterations/k and freeSolverIterations/k.
3. **Uses of `fixedDt` that must become h:** soft-CCD prediction (`SPEED_CAP·h·1.25`) and the stiction hold target (−offset/h). Both are bit-identical at k = 1.
4. **`buildBodies`** collects gears: body, hub centre in body coordinates, axis, and r.
5. **`buildMeshCandidates`** (after joints) makes every gear pair on different bodies that are not both fixed.
6. **`stepFixed`** runs k world steps per fixed step. Each world step does `applyGrab`, `updateMeshes`, `world.step`, `removeFallen`, `updateFriction`, `guardEnergy`.
7. **`updateMeshes`** applies the engage/release rules; creates, re-anchors and removes the joint; unions the guard groups on engagement; and marks a pair dead when a body was removed, without touching the handle.
8. **Not changed, but should be:**
   - `mechanismMass` (the grab's M) ignores meshes.
   - `loadMasses` stays static and mesh-agnostic; this is intended.
   - `jointStates()` and `jointError()` do not report meshes.

## Recipe for DESIGN §5.1 "Gears"

**Data.**
- Per gear: body, hub centre and axis in body coordinates, r. Teeth T = 16·r, module 0.125, pitch p = π/8.
- Per candidate pair: engaged flag, joint handle, f64 unwrapped trackers θ1, θ2, ψ, the phase reference φ0 and its target φT, and stopMin.

**Recomputed before every world step.** With a = gear 1's world axis:
- par = ∠(a1, a2) mod π
- δ = (c2 − c1)·a
- d⊥ = c2 − c1 − a·δ, D = |d⊥|, n = d⊥/D, t = a × n
- gap = D − r1 − r2

**Engage** when all of these hold:
- par ≤ 0.035 rad;
- |δ| ≤ 0.6 (teeth overlap at least 0.4 of the face);
- −0.25 ≤ gap ≤ +0.125 (half the working depth);
- both bodies' linear speed ≤ 350 units/s.

**Release** when any of these holds:
- par > 0.087 rad;
- |δ| > 0.9;
- gap > +0.25 (tip contact);
- gap < −0.5;
- either body faster than 350 units/s.

**On engagement:**
- φ = r1·θ1 + r2·θ2 − (r1 + r2)·ψ, where θ is each body's twist about a and ψ is the angle of n in the plane basis of a.
- φT = round(φ/p)·p and φ0 = φ.
- stopMin = min(0, gap) − 0.005.
- Create `JointData.generic(…, LinX)`, set the frames, and set the LinY limit to [stopMin, 1e6] via `raw.jointSetLimits`. Contacts on.
- If both bodies are dynamic, `unionGroups` the two gears.

**Every engaged step:**
- φ0 moves toward φT by at most 0.96·h units of arc. This is the rate-limited snap, used on engagement only.
- e = φ − φ0.
- Lead: λ = D0(1 − κ²)·φstep/(2κ²), with D0 = r1 + r2, κ = D0/r2, φstep = (ω1·a − β̇)·h and β̇ = (v2(c2) − v1(c1))·t/D.
- Anchor 1 = c1 + r1·n + λ·t.
- Anchor 2 = c2 − r2·n + (λ − e)·t. This lies in gear 2's own plane.
- Both frames are X = t, Y = n, Z = −a, each in its own body's local coordinates, applied with `setLocalFrame1/2`.

**Teeth drawing convention.** Draw tooth centres at (k + ¼)·2π/T from e1. Then every pair built touching on a grid direction is compatible at φ ≡ 0 (mod p). Verified: every grid pair engaged with snap 0.000.

**Guard.** Merge on engagement; never split on release (like contacts). The engagement impact loss lowers the reference.

**Removal.** Rapier removes the mesh joints with the body. Mark the pair dead and never touch the stale handle. The remaining gears coast.

**Friction.** No mesh friction. Pivot loads unchanged.

**Step.** Choose k so that the fastest meshed gear turns ≤ 0.1 rad per world step.

## 1. Basics (`basics.ts`, `threshold.ts`, `feel.ts`; `out/q1_*.txt`)

### Verified

**Torque-driven from rest.**
- **Setup:** input torque = 20·I_eff + reflected friction, for 2 s; the input reaches 40 rad/s (0.083 rad/step at k 1).
- **Models:** 1:1, 1:3, 1:5, compound 1:25, a 5-gear idler, and a single-gear control. Each at μ 0 / 0.05 / 0.2 and k 1 / 2 / 4.
- **α0 against the reduced model:** +0.04 to +0.1 % at μ 0; up to +0.26 % (1:25) and +0.48 % (idler) at μ 0.2.
- **θ_in(2 s):** +0.7 to +1.0 %. The no-mesh control shows the same +0.71 %, so this is Rapier's f32 spin-up.
- **Ratio error:** k 1: 3e-6 to 3e-5; k 2: 4e-7; k 4: 5e-8.
- **Phase error:** k 1: 1.7e-4 to 7.6e-4 teeth; k 2: about 1e-4; k 4: about 1e-5.
- **Revolute joint error:** ≤ 2.4e-7.
- **Energy:** ΔE/(W − W_f) = 1.010 everywhere. That is the guard's 1 % band holding back the f32 gain.

**Static balance with friction.**
- **Setup:** a 7-hole arm on the output of 1:5, 1:25 and 1:125, starting horizontal. Constant input torque at 0.97 and 1.03 of the analytic fall and lift thresholds (balance ± reflected Σ friction), and at balance.
- **42 of 42 cases did what the thresholds predict.**
- **Holds:** ≤ 1e-5 rad in 1 s.
- **1:125 with a 7-hole arm at Real holds with no input at all:** fall threshold −169, measured −8.7e-8 rad.
- **The stiction holds never fight the mesh:** phase ≤ 5e-6 teeth in every hold.

### Feel

**Hand crank** (a 2-hole lever dragged by the grab spring at 1 rev/s):
- **1:5 unloaded:** 1.95 of 2 rev; lag 0.29 rad at Off and 0.30 at Real. Friction is imperceptible.
- **1:5 lifting a 7-hole arm:** 1.94 rev, lag 0.36 rad, ratio −0.2000.
- So a hand-cranked 1:5 turns freely at every level.

**1:25 back-driven by an arm, released horizontal:**

| Arm | Low (0.05) | Real (0.2) |
|---|---|---|
| 2 holes | creeps 1.27 rad in 4 s | holds (3e-8 rad) |
| 3 holes | vertical in 1.19 s | holds (1e-7 rad) |
| 5 holes | vertical in 0.73 s | slides to −1.55 rad and stops short of vertical |
| 7 holes | vertical in 0.65 s | vertical in 0.70 s |

- At Real, friction reflected to the output is about 9,700–10,000. The outcome follows that inequality exactly.
- A 7-hole arm falling almost freely through 1:25 is probably too free for a real 8:40 × 2 train. The missing terms are bearing friction from the tooth force (≈ 12 % of shaft torque per small-gear shaft) and tooth sliding friction (3–5 % per mesh). Both are estimates, not measurements, and need joint reactions that Rapier does not expose.
- **Recommendation:** keep the static loads and add no mesh friction, so thresholds stay predictable. If more hold is wanted, a per-mesh efficiency could be added as extra pivot friction. **Not tested.**

## 2. Energy guard (`guard.ts`, `swing.ts`, `slide.ts`; `out/q2_*.txt`)

### Verified

**Geared pendulums** (1:1 and 3:1, μ 0, 4 s):
- **With merge:**
  - (E − E0)/mgL stays in [−1e-5, +0.0101];
  - the period is exact (0.4104 against RK4 0.4104; 0.4312 against 0.4306);
  - guard-off rises +0.10 to +0.12 mgL (f32).
- **Without merge:**
  - −0.996 mgL in 4 s;
  - the period comes out 13–19 % short;
  - **so merging is mandatory.**
- **3:1 at k 1** loses 0.147 mgL even with the guard off. That is the speed limit, not the guard.

**Engage and release at run time (swing arm, slider):**
- max(E − E0 − W_drive) ≤ +0.27, which is ≤ 0.1 % of W, and occurred only at μ 0.
- The guard removed 1.7 % of drive work in the selector at Real.

**Spinning gears engaging** (`dbg_spinengage.ts`):
- post-impact ω within 0.3–0.7 % of the analytic plastic impact;
- ΔE within 1 % of the analytic loss;
- peak tooth impulse/dt within 0.5 % of J/dt;
- the exception is k 1 with ωA 50 (0.10 rad/step): −16 % speeds and +30 % loss.

**Unexplained removal after engagement.**
- After spinning engagement the guard removes 1.4–33 energy units per second (0.2–5 % of K/s).
- It is the same with snap off, so the snap is not the source.
- So the raw sim creates that energy after engagement. The source is not found; f32 spin-up is the likely cause, unproven.

**Removal of meshed bodies.**
- **Setup:** a free 1:5 gearbox spinning at 20, 50 and 100 rad/s falls from y 0, with bodies removed one by one at 1.169–1.175 s.
- No step threw; meshes became dead; `isValid()` was false; the remaining bodies kept falling and were removed.

**The 400 units/s clamp.**
- **Before the speed release existed,** the gearbox exploded on reaching Rapier's 400 units/s clamp at 0.33 s:
  - L jumped ×3–9;
  - phase errors reached 10–20 teeth;
  - the guard removed up to 6.6e8;
  - the box decelerated mid-fall.
- This happened at every k and at μ 0 and 0.2.
- The control without meshes does not explode.
- With the release above 350 units/s it is clean: the gears freewheel until they are removed.

## 3. The owner's two cases

### 3a. Swing-arm selector (`swing.ts`; `out/q3_swing.txt`)

**Setup.** Axes along Y. Sun r 1; planet r 1 on an arm; outputs r 1 at (±2, ·, 3). The planet engages at ±8.1°; the neutral gap is 0.236. The drive reverses every 1 s.

**Arm on the sun's axle (the normal build) works at all three levels.**
- **Real:**
  - one engagement per reversal, alternating A and B;
  - the arm stops at ±8.21°;
  - release 0.146 s after reversal;
  - snaps 0.07–0.44 teeth;
  - phase ≤ 0.006 teeth;
  - peak output α 2,918 rad/s².
- **Low:** the same, with snaps ≤ 0.24 teeth.
- **Off:** it selects, but the frictionless arm wanders and re-engages extra times. Already-spinning outputs are re-engaged, which covers engagement while both gears spin.
- **Correction:** an apparent "lock" at Real in an earlier run was my drive's torque cap (1,575 needed), not the mesh.

**Arm pinned to the frame, coaxial with the sun:**
- **Off:** works.
- **Low:** the first selection fails (the arm stopped at 2.8°); later selections work.
- **Real:** sticks (0.2° and −0.7°). The arm pivot's friction is 419 (load 5.51) against the planet bearing's drag of 203 (load 2.67).
- The ratio is the same at every μ > 0.

**Smallest change: none in the sim.** The frame-pinned build sticks because its own pivot friction exceeds the only torque that drives it, which is also true of a real build. Moving the arm's friction onto the coaxial sun is possible, but it would make two physically different builds behave the same. I recommend against it, and did not implement it.

### 3b. Gear sliding on its axle (`slide.ts`; `out/q3_slide*.txt`)

**Setup.** B is on an axle through a frame hole: a cylindrical joint with limits [−1, 2], built at |δ| = 1. The grab pushes B in and pulls it out; 3 cycles at μ 0 / 0.05 / 0.2 and k 1 / 2 / 4.

**Results.**
- Engages at δ 0.56–0.60 and releases at 0.90–0.91, exactly once per cycle.
- No jamming: B reaches the stop every time (δ ≈ 0.06, from grab sag against F_f 1,050 at Real).
- Tilt ≤ 1.05e-7 rad (the planar anchors work). Joint error ≤ 2e-7.
- Re-entry snaps 0.13–0.43 teeth.
- Phase error while engaged ≤ 0.0051 / 0.0025 / 0.0013 teeth at k 1 / 2 / 4.

**Axial band.**
- A wider band (engage 0.85, release 0.95) engaged earlier, but **never released**: grab sag left δ ≈ 0.93.
- **Recommendation:** engage at |δ| ≤ 0.6–0.75, release at > 0.9.

## 4. Gears on a vehicle (`cart.ts`; `out/q4_cart.txt`)

**Setup.** A free-root cart with r 2.5 wheels. The rear axle gear meshes a chassis gear above it, 1:3 or 3:1, plus a no-gear control.

**Coasting from 50 units/s for 5 s at μ 0:**
- No self-acceleration: v stays at 50.27–50.34 in every variant.
- Over 252 units, the 1:3 cart drifts −0.22 to −0.25 sideways with yaw 3.1e-3 to 3.6e-3 rad. The control drifts −0.09 to −0.11 with yaw 0.9e-3 to 1.1e-3, and 3:1 drifts −0.07 with yaw 0.7e-3.
- So the 1:3 cart turns about 3× the control, which is 0.2° over 250 units. This is the only trace of the skeptic's angular-momentum error I found, and it is invisible in practice.

**At rest for 5 s:** drift ≤ 5e-4, yaw ≤ 1.7e-4, the crank turned ≤ 3.4e-4 rad. The same as the control.

**Internal motor (±τ on the chassis gear and the chassis):**
- the cart rolls the kinematic distance within 0.06–0.4 % (for example 12.008 against 12.014);
- phase ≤ 2e-4 teeth;
- yaw ≤ 3e-4 rad.

**Harness finding.** A chassis gear whose disc touched the floor acted as a counter-rotating wheel. It braked the cart from 50 to 0 in 0.6 s and was counted as a ground sink. Builders will do this by accident.

## 5. Speed in ordinary use (`speed.ts`, `dbg_heavy.ts`; `out/q5_*.txt`)

**Crane drop, max |ω| of the fastest gear** (analytic value at the bottom in the second column):

| Train / arm | Analytic | k 1 | k 2 | k 4 |
|---|---|---|---|---|
| 1:5 / 7 | 92 | 75 (0.156 rad/step) | 92.5 | 92.5 |
| 1:25 / 7 | 152 | 70 | 138 | 153 |
| 1:25 / 15 | 251 | 77 | 147 | 252 (0.131) |
| 1:125 / 15 | 324 | 70 | 139 | 274 (0.143) |

**Share of world steps above 0.1 rad/step at k 1:**

| Train / arm | Share |
|---|---|
| 1:5 / 7 | 49 % |
| 1:5 / 15 | 49 % |
| 1:25 / 7 | 57 % |
| 1:25 / 15 | 64 % |
| 1:125 / 7 | 76 % |
| 1:125 / 15 | 94 % |

The maximum was 0.14–0.16 rad/step.

**Beyond 0.1 rad/step: energy only goes down**, and the guard-off runs are identical. Minimum (E − E0)/mgL at μ 0:

| Train / arm | k 1 | k 2 | k 4 |
|---|---|---|---|
| 1:5 / 7 | −0.46 | 0 | 0 |
| 1:25 / 7 | −0.80 | −0.22 | 0 |
| 1:25 / 15 | −0.93 | −0.71 | 0 |
| 1:125 / 7 | −0.60 | −0.26 | 0 |
| 1:125 / 15 | −0.83 | −0.83 | −0.31 |

- Phase stays ≤ 0.001 teeth and there are 0 reversed steps. It looks like viscous damping.
- A heavy arm (44.8 mass) on 1:25 also only loses energy (k 1 / 2 / 4: −0.95 / −0.81 / −0.23 mgL).
- **The skeptic's energy creation does not reproduce here.** I did not investigate why.

**Grab yank** (the target jumps 8 units up, Real):
- **1:5 / 7 at k 1:** the 377 rad/s clamp (0.78 rad/step), phase 0.67 teeth, and the tip goes 7 units *down*. At k 2 it is fine (0.19 rad/step, phase 0.002 teeth).
- **1:25 / 1:125:** 0.18–0.60 rad/step even at k 4, phase ≤ 0.022 teeth.

**Fast drag of a gear's rim** (3 or 10 rev/s): the input reaches only 41–76 rad/s, ≤ 0.15 rad/step. The spring has no leverage, and the brake caps the speed.

**Free gearbox at 0.21 rad/step:** the small gear reverses in one step (+100 → −109 rad/s). Clean at k 2.

**So:** k 2 covers 1:5 and short trains, k 4 covers 1:25 drops, and yanks and 1:125 need k ≈ 8 or a cap on meshed gears' ω.

## 6. Teeth against non-gears (analytic only, not simulated)

Tip radius = r + 0.125; root radius = r − 0.156.

**Hub height when resting on the floor.** The real value is r_tip·cos(π/T) to r_tip. Error of a cylinder at each radius:

| Radius | Error |
|---|---|
| tip | 0 to +0.048 |
| pitch | −0.08 to −0.125 |
| root | −0.24 to −0.28 |

**Rolling distance per revolution** (the gear rolls on its tips like a polygon):

| T | Real | Tip cylinder | Pitch cylinder |
|---|---|---|---|
| 8 | 3.83 | 3.93 (+2.6 %) | 3.14 (−18 %) |
| 40 | 16.48 | 16.49 | 15.71 (−4.7 %) |

**Brushing a beam.** The tip radius is the exact outer envelope.

**So the tip radius is least wrong for all three.** But it conflicts with today's rules: a disc may touch a cell at r, so a tip collider would start 0.085 inside a touching cell.

**Proposal:**
- gear×cell blocking at r + 0.125;
- collider radius r + 0.085;
- gear×gear rules unchanged at pitch;
- gear round colliders filtered from other gears' round colliders.

## 7. Cost and determinism (`cost.ts`, `hash.ts`; `out/q7_*.txt`)

**Cost** (interleaved, minimum of 3, load 35–50):
- N 5 idler chain: on/off 1.34, +45 ms per mesh per simulated second.
- N 11: on/off 1.57, +53 ms per mesh.
- A jointed body costs 85–105 ms, so a mesh costs about half a body.
- **Substep knob** on a falling 1:25 crane: k 2 costs ×1.16 and k 4 ×1.32.

**Determinism.**
- All 9 examples at μ 0 and 0.2 give bit-identical hashes in the copy and the product, and the 7 recorded frictionless hashes are reproduced.
- The cart example has 6 gear candidates that never engage, and is still identical.
- Two runs each of the swing selector, the slider and the 1:25 drop at k 2 are bit-identical.

## Failure envelope

| Fastest meshed gear | What happens |
|---|---|
| ≤ 0.1 rad/step | Clean |
| 0.1–0.18 rad/step | Brake: up to 95 % of mgL lost, no creation or reversal, phase < 0.001 teeth |
| ≥ 0.2 rad/step | Kicks, reversal, 377 rad/s clamp, 0.67 teeth, wrong-way motion |
| Linear speed ≥ 400 units/s | Explosion unless the release above 350 units/s is in place |

## Still wrong

- The k = 1 brake.
- The yank exceeds 0.2 rad/step even at k 4.
- 0.2–5 % per second guard removal after engagement, source unknown.
- `mechanismMass` ignores meshes.
- Friction is mesh-agnostic: a 7-hole arm falls through 1:25 at Real.
- Off-grid snap visuals (up to 0.46 teeth, 0.2 s).
- Pitch sums 1.5, 2.5 and 3.5 cannot mesh in-plane on the grid.

## Not tested

- The adaptive step (spike-step) and tooth colliders (spike-teeth).
- Browser timing.
- Gears whose axis rotates in 3D.
- Loops, and trains longer than 5 meshes, in the real sim.
- Worm, bevel and rack gears.
- Any collider radius other than the current one.
- `decoupleInertia` isolated.