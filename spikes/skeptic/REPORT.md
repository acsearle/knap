## Skeptic report: gear–gear mesh coupling (`spikes/coupling/`, checked from `spikes/skeptic/`)

**Verdict: works with limits. The limits are narrower than the coupling report says, and the high-speed failure is worse.** At low speed the construction is sound. Below about 0.1 rad of rotation per fixed step on the fastest meshed gear (about 50 rad/s at dt = 1/480 s), almost every claim in the report reproduces, and my added stress tests also pass:
- moving carriers;
- long trains under heavy static load;
- extreme ratios up to 1:625;
- sim.ts friction;
- joint limits;
- redundant meshes.

I found four problems the report missed or understated.

1. **High speed (most serious).** At 0.2 rad/step the energy error is ±10% per second. At 0.42 rad/step (small gear at 200 rad/s) a free-spinning pair loses 93% of its kinetic energy in 1 s and reverses direction. Back-driving a 1:25 train with a falling arm (input about 300 rad/s) gains up to +2.3·mgL of energy, so the arm spins over the top. The report's "works to about 300 rad/s / 377 rad/s clamp" is misleading: its high-speed cases had a velocity motor imposing the speed, which hides the loss.
2. **The anchor placement is wrong for gears offset along the axis.** Both anchors sit in gear 1's plane. When gear 2 slides axially, the row can be satisfied by tilting gear 2 instead of turning it. Once the offset is about r2, the pair jams: gear 2 tilts 3.3°, the axial slide stalls, and a 0.76-tooth phase error freezes in place. Fix: put anchor 2 in gear 2's own plane. Measured: tilt stays below 1e-7 rad and the slide matches ½(F/m)t².
3. **A free-floating gearbox does not conserve angular momentum.** The error depends on the mesh and on the substep count: 5% of the spin momentum in 2 s for 0.5:2.5 at 240 iterations, and more than 100% at 960. The control without a mesh is within 0.1%.
4. **The proximity band does not match the tooth geometry.** The recipe releases at +0.13, but tooth tips stay in contact up to +0.25. Gears that are physically still meshed therefore release and re-engage, and each re-engagement re-snaps the phase by up to 0.19 teeth.

None of these is fatal. Problem 1 needs an engineering answer before gears ship, because ordinary builds reach those speeds: a crane arm falling through 1:25 does.

I touched nothing under `src/`, `tests/`, `e2e/`, `docs/` or `spikes/coupling/`, and ran no git commands. My files are all `.mjs` under `spikes/skeptic/`, which `npm test` does not include. The load average was 15–35 on 10 cores throughout, so all ms figures are inflated; the ratios between them are more reliable.

### How to run
From the project root, each with `node spikes/skeptic/<script>`:
- `s1_pendulum.mjs [secs=120]`
- `s2_load.mjs [stiff] [thresh] [backdrive]`
- `s3_backdrive_energy.mjs`
- `s4_carriers.mjs [carrier] [axial] [engage]`
- `s5_friction_loops.mjs [friction] [redundant] [limit]`
- `s6_speed.mjs [free] [yank] [long]`
- `s7_misc.mjs [float] [band] [cost]`
- the `dbg_*.mjs` diagnosis scripts

Details:
- **Outputs:** `spikes/skeptic/out/`. Use `s5_limit.txt` for the limit test; the limit section of `s5_friction_loops.txt` predates a bug fix.
- **Re-runs of the coupling scripts:** `spikes/skeptic/rerun/`.
- **Shared code:** `spikes/skeptic/sk.mjs`. It re-exports the coupling `Mesh` read-only and adds `MeshPlanar`, the anchor fix.
- **Recipe under test:** every test uses the coupling `Mesh` with `{lead: true}` and the default feedback (k = 1), at dt 1/480 s, 240 iterations, g = 1226.25 units/s².

### Claim by claim
**Q1 (joint expressible, single row, in-place updates): reproduced.** Re-run numbers:
- Frame 1 defines the locked axis: v1 = (0.5, 0, 0), v2 = (0.5, 1, 0).
- Single-step residual against the analytic single-row impulse: 3e-4 to 2e-3.
- Linear momentum change: 9.8e-7.
- Locked component over 2 s of free tumbling: 5.6e-7.
- In-place update takes effect in one step: 0.10000.
- Recreate and re-anchor give identical ratio and phase.

**Q2 low-speed ratio and phase: reproduced where I re-ran it** (I did not re-run the 304-run sweep):
- Planetary with a fixed sun: ratio errors ≤ 7e-7, phase ≤ 3.6e-4 teeth.
- Moving carriers, which are new: gear 2 on a kinematic carrier with the centre distance varying by ±0.1 and the line-of-centres angle by ±0.3 rad. θ2 follows the rolling law within 1e-4 rad (≤ 4.3e-4 teeth) for 1:1, 0.5:2.5 and 2.5:0.5, with gear 1 fixed or driven. This supports the "emergent" claim for non-rigid carriers.

**Q2 "up to ~300 rad/s, 377 rad/s clamp is the limit": reproduced but misleading.** Free 0.5:2.5 pair, no motor, zero gravity; K must stay constant. K/K0 after 5 s, with lead / without lead:

| Small-gear speed | With lead | Without lead |
|---|---|---|
| 50 rad/s | 1.047 | 1.029 |
| 100 rad/s | 1.083 | 0.674 |
| 200 rad/s | 0.076, direction reversed (ω −55) | 0.18 |
| 300 rad/s | 0.082 | 1.5e-4 |
| 370 rad/s | 1e-5 | 0.016 |

- **Control:** a lone rotor at the same speeds ends at K/K0 between 1.00 and 1.04.
- **Cause, confirmed by `dbg_dt`:** the rotation per step. At 200 rad/s with dt 1/1920 and 60 iterations (the same substep budget), K/K0 is 1.006 after 1 s and the phase error is 0.003 teeth. At 0.208 rad/step the result is the same at either speed: about +1% with lead and −12% without. At ≤ 0.1 rad/step it is clean.

**Lead correction: reproduced but misleading.** It fixes the end-of-step ratio, but at high speed it can pump energy. In the 1:25 back-drive (arm m=20, L=10, dropped from horizontal, input peak 303 rad/s), raw (E − E0)/mgL reaches +2.34 and the arm goes round about 3 times in 1.6 s. Without lead it is −0.88 instead: 88% of the drop energy is gone in 0.4 s. With the sim.ts-style guard, E stays within +0.013·mgL and the motion looks like a plausible pendulum (0 to −3.14 rad), but the guard removed 155·mgL over 3 s.

**Q2 energy at 10 rad/s: reproduced** (q2_energy re-run gives identical numbers). It is Rapier's artefact, not the mesh's:
- Free 5-gear train over 120 s: ×3.21, against ×4.03 for the control rotor.
- Geared pendulums over 120 s: 1:1 gives ×29.2, the same as the single-pendulum control (×29.3); 1:3 gives ×3.3.
- The guard is mandatory either way.

**Pendulum periods: new, passes.** Geared pendulums against an RK4 nonlinear reduced model, early in the run:
- 1:1: +1.0e-4;
- 1:3 and 3:1: +3e-5 (+0.1% at θ0 = 1.2 rad).

The late-run error (+0.5% to +8%) comes from the Rapier energy gain, and the control shows it identically.

**Q3 torque transmission: reproduced.** Re-run (α0 error, static offset):
- 1:1: α0 −0.15%;
- 0.5:1.5: α0 −4.5e-4;
- 1:5: α0 7.5e-5;
- compound 1:25: α0 5.2e-5, with the same 1.2% deviation at 1 s;
- idler5: α0 −0.36%, static 1.1e-4 rad.

New tests:
- **Torque threshold through compound 1:5, 1:25, 1:125 and 1:625.** The input is a velocity motor whose maximum torque is f·τ_out/ratio. f = 0.98 falls and f = 1.02 lifts at every ratio; the kinematic residual is ≤ 1.2e-5 rad.
- **Back-drive while the input stays ≤ ~80 rad/s:**
  - 1:5 matches 1-DOF RK4 within 0.03 rad over 1.5 s (−3.121 vs −3.116 at 1 s);
  - 1:125 matches to 0.2 s (−0.1129 vs −0.1126) and then falls behind (−0.84 vs −2.27 at 1 s, dissipative);
  - 1:25 is the energy-gain case above.
- **Gear-driven motor control: invalid.** The n = 0 control (motor directly on a disc-less arm body) fell even at f = 2, while the same arm with a small disc added lifts at f = 1.1 (`dbg_motor.mjs`). I did not explain this Rapier motor anomaly. The gear-train thresholds calibrate themselves.

**Compliance: reproduced, and it grows with train length and load.** Gear 0 is fixed; the last gear of N carries the static torque. Peak (settled) deflection of the last gear:

| N | m=50, L=10 (τ = 6.1e5) | m=100, L=30 (τ = 3.7e6) |
|---|---|---|
| 2 | 3e-5 (1.8e-5) rad | 1.9e-4 rad |
| 5 | 4.8e-4 rad | 0.003 rad |
| 10 | 0.001 rad | 0.007 rad |
| 20 | 0.003 (0.001) rad | 0.017 (0.013) rad, 0.5-unit tip sag |
| 40 | 0.006 rad | 0.035 rad, 1.05-unit tip sag |

- Phase error stays ≤ 0.003 teeth in all of these.
- Without feedback the load collapses: 1.57 rad (falls to vertical) within 1–10 s for N ≥ 5.
- **Verdict on this claim:** "effectively rigid" holds for short trains. Rigidity degrades roughly linearly with N; the cause is the end-of-step non-convergence the report noted.

**Q3 sim.ts friction: reproduced and extended.** μ 0.2 with the stiction hold on every revolute of 2-, 6- and 12-gear trains, input torque f·Στ_f:
- f = 0.9 holds: |θ| ≤ 3e-6 rad.
- f = 1.1 turns: θ(1 s) = 7.626 / 7.640 / 7.663 against analytic 7.603 (+0.3% to +0.8%).
- Phase error ≤ 4.3e-5 teeth.
- I saw no fighting between the stiction holds.

**Joint limits on a meshed gear: new, passes.** This uses `ImpulseJoint.setLimits`; `JointData.limits` is silently ignored for revolutes (`dbg_limit.mjs`). The driver stops at θ1 = 0.5·r2/r1 exactly (0.5000, 2.5000, 0.1000) and holds; phase error ≤ 1.6e-4 teeth.

**Q4 planetary: reproduced.** Fixed-sun ratios match within 7e-7. Free-sun arm speed is −2.7%, −3.6% and −3.1% off analytic, identical to the report.

**Q4 swing selector: partly re-tested, in a different form.** I drove a kinematic carrier through the recipe's proximity band at 5 Hz:
- Distance range 2.02–2.14: 10 engagements and 9 releases in 2 s. Each engagement re-snaps the phase (up to 0.19 teeth), and the peak α is 2456 rad/s², i.e. 0 to 5 rad/s in one step, which is the analytic plastic impact. The gears never leave tooth contact (tip contact extends to 2.25).
- Distance range 1.98–2.08: the stop row fights the imposed inward motion; peak α is 23,068 rad/s².

I did not re-run the sim.ts-friction stick case.

**Engagement of already-spinning gears: new; snap with rate limit and no snap both reproduce the analytic impact.** With a rate-limited snap, or without snap, the post-impact ω matches the analytic plastic impact at the pitch point within 0.2%, and the peak tangential force equals J/dt exactly (examples: 9062 and 15080). With full (rate-unlimited) snap:
- 0.5:2.5 at 100 rad/s goes to ω −200 rad/s and K = 2114 against 491 before engagement: energy is created, ×4.3;
- 2.5:0.5 goes to −337 rad/s, with a peak force of 8.1e5 against 9062.

The report's "full snap kicks hard" holds; the effect is non-physical energy creation, not just a jerk.

**Q5 loops: reproduced.**
- Triangle: locks with a limited motor; with an unlimited motor it runs away (4.49 rad, 399 rad/s, 10.9 teeth).
- Square: ±100.0000 rad.
- Inconsistent redundant pair (new: two shafts with meshes 1:1 and 1.5:0.5 at the same centre distance):
  - with a gravity load or a motor limited to 1e4 it locks (|θ| ≤ 8e-6);
  - with an unlimited motor it runs away (84 rad, 214 rad/s, 100 teeth of phase error).
- Consistent redundant pair: turns at exactly ±50.0000 rad.

The product has no unlimited drives. The grab is a mass-scaled 10 Hz spring, so the runaway needs a future motor feature.

**20-mesh train: reproduced.** End-of-step ω is 9.748 vs 10 (−2.5%), and it costs 2696 ms per simulated second.

**Cost: reproduced** (interleaved, minimum of 2 runs, load about 25):

| N gears | Revolutes only (per body) | Per mesh added |
|---|---|---|
| 2 | 180 ms/sim s (90) | 36.5 ms/sim s |
| 6 | 455 ms/sim s (76) | 31.9 ms/sim s |
| 11 | 659 ms/sim s (60) | 22.9 ms/sim s |

The 40-gear stiffness train ran at 6.6–7.4 s per simulated second. Bodies, not meshes, dominate the cost.

**Not in the report, now tested:**
- Axial sliding (problem 2, measured in `dbg_axial2/3/4`).
- Free-floating gearbox (problem 3): internal torque 50 for 0.5 s.
  - |L| relative error: 1:1 0.2%, 2.5:0.5 1.3%, 0.5:2.5 12%; no mesh 0.1%.
  - Independent of lead and feedback. It grows with iterations: at 960 iterations |L| reaches 4.9 against a spin momentum of 3.5. This matters for free-rolling vehicles.
- Grab-spring yank of a 1:5^n output at 2 rad/s:
  - 1:5 is clean;
  - 1:25 spikes the input to 370 rad/s (kinematic 50) with 0.25 teeth of phase error;
  - 1:625 cannot follow (output reaches 0.70 of 4.0 rad) and the input saturates at the clamp.

### Recipe that worked best (amended)
- **Keep:** the coupling recipe (generic joint with `JointAxesMask.LinX`, `setLocalFrame1/2` every step, f64 phase feedback k = 1, guard on).
- **Change, measured:**
  - anchor 2 at P + a·((c2 − c1)·a), i.e. `MeshPlanar` in `sk.mjs`;
  - never use rate-unlimited snap;
  - add a coplanarity release rule (the `Mesh` class has none: a gear 7.7 units out of plane stayed coupled).
- **Change, not measured:**
  - widen the release threshold toward the tip-contact distance r1 + r2 + 0.25;
  - keep max(|ω|·r-independent rotation per step) ≤ 0.1 rad over meshed gears. The way to do that is an adaptive step (dt/k with iterations/k when needed; same substep budget, about k× more JS overhead per simulated second). I measured this only on the free pair, not on the full sim or on long-train stiffness.

### Single most serious risk
High rotation per step. Ordinary builds hit it: a back-driven 1:25 with a falling arm reaches about 300 rad/s. Above about 0.1 rad/step the mesh either destroys or creates energy by O(mgL) per 0.1 s, and the guard hides only the creation. Ship gears only together with an adaptive or smaller step, or an explicit speed cap on meshed gears, and test it.

### Not tested
- I did not re-run the q2 304-run sweep, the swing-arm sweeps or the sim.ts friction-on-selector case.
- Ratchets, tooth colliders, racks, bevel and worm gears, non-parallel or tilting axes.
- Integration with sim.ts itself (guard grouping, `decoupleInertia`); browser timing.
- Whether dt 1/1920 with 60 iterations keeps the existing jointed-model stiffness the 240-iteration choice was made for.
- The cause of the motor anomaly on the disc-less arm body.
