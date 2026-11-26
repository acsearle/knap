# Tooth colliders against ordinary parts (spike-teeth2)

I did not write spikes/teeth2/REPORT.md: the harness refused it ("Subagents should return findings as text, not write report files"). This message is the full report; paste it into that file if you want it there. All scripts and raw outputs are in /Users/antony/Desktop/knap.nosync/spikes/teeth2/ and spikes/teeth2/out/.

Machine load ran at a load average of 40–93 on 10 cores throughout. All costs below are process CPU ms per step (`process.cpuUsage`), median of interleaved rounds. Treat ratios as ±20% and the absolute ms as inflated.

## Verdict

**(a) Ratchets made from tooth contacts work only for light loads. Don't use them as the ratchet mechanism.**
- **Geometry works.** A gravity pawl built on the grid from ordinary knap parts ratchets against real-pitch hull teeth. The pawl that works is a liftarm whose end presents a 90° corner:
  - a last hole cell with its axis along the arm (perpendicular-connector end), or
  - a pin growing out of the end wall along the arm.
- **Holding is the problem.** Rapier's soft contacts let the tooth crush through the pawl. Static hold at knap's 30 Hz contact softness, with no slip over 4–6 s (τ0 = the pawl's weight × 1 unit):

| Gear | Static hold | Tangential force at the tooth |
|---|---|---|
| r 0.5 (8 teeth) | < 1 τ0 | — |
| r 1 (16 teeth) | 2–4 τ0 | ≈ 2–4 pawl weights |
| r 1.5 (24 teeth) | ≈ 8 τ0 | ≈ 5 pawl weights |
| r 2.5 (40 teeth) | 16–32 τ0 | ≈ 6–12 pawl weights |

- **Sudden loads are worse.** A suddenly applied load on a gear with no load inertia gets half that or less. With a bare torque load, an r 1 ratchet fails 30–57 of 60 hold cycles even at 1–2 τ0.

**The practical alternative, which I tested, is a one-way joint row.**
- **What it is:** a second revolute on the gear's axle. Its frame is re-anchored every step at the last tooth stop, with a [0, π] angle limit.
- **Results:**
  - holds 10⁴ τ0 with a 7e-5 pitch error;
  - a reverse impact at 350 rad/s (load inertia ≈ 56) stops within 0.16 pitch, with zero energy gain;
  - no forward drag beyond joint friction;
  - no measurable extra cost.
- **Design:** the pawl becomes a declared sub-part (or a nominated part) that turns the row on while it is engaged. Tooth colliders can stay as cosmetics for nominated parts, at about one contact pair each, but must not be relied on to hold anything.

**(b) Which bodies feel teeth.** Only nominated pawl parts, through collision groups. Everything else meets the gear's smooth tip-radius disc, as wheels already do.
- **Cost of the rule:**
  - teeth on all 40 gears with the pawl-only rule cost +15% with separate hulls, +5% with one compound collider;
  - letting teeth meet every part cost ×3.4 when a beam lies near the tips;
  - a gear lying flat with teeth that see the ground costs ×7 (8 teeth) to ×35 (40 teeth) over the smooth disc.
- **Teeth add nothing for beams.** A beam lying on the teeth grips and slips exactly as on the smooth disc: friction limit μ 0.4, slip within 0.5%.

**(c) Failure envelope**, with numbers in the sections below:
- **Static hold:** above it the gear creeps and then slips continuously. Penetration reaches 0.1–0.28, the full tooth height.
- **Click-over in the free direction:**
  - clean below 10 rad/s;
  - from 30 rad/s the pawl bounces (touching about 11% of steps);
  - at 100 rad/s it is thrown (lift > 1 rad; on r 2.5 it spins over the top).
- **Impact tunnelling:** above 100–200 rad/s at dt 1/480. Soft CCD helps at 100 rad/s, not at 200. dt/2 holds to 200; nothing holds at 350.

## Method

- **Pawls use knap's own shapes:** `partShapes(part, 16)` from src/physics/shapes.ts.
- **Gears are my own**, since there is no gear collider in src:
  - bevelled root T-gon prism at r − 0.156;
  - one 8-vertex convex prism per tooth (trapezoid, 20° flanks, p/2 wide at the pitch circle, tip r + 0.125, ±0.46 thick);
  - mass from an invisible disc of radius r.
- **Settings as in sim.ts:**
  - dt 1/480;
  - 30 world iterations plus 210 additional iterations on jointed bodies;
  - 1 PGS iteration, hard CCD off;
  - friction 0.4, restitution 0.1.
- **Joint friction:** velocity motors with τ = μ·m·g·0.31. The stiction logic, the energy guard and the speed cap are not modelled; this is raw Rapier.
- **Ramp numbers are for ranking only.** The ramp tests (torque ×10 per 0.4 s) overestimate holding by 3–8×. All holding claims come from constant loads ramped in over 0.5 s (creep.ts).

## 1. Collider cost

Verified with cost.ts, output in out/cost.txt. Each figure is a range over the four gear sizes.

| Representation | Idle | Pawl touching | Flat on ground (8/16/24/40 teeth) | Beam on tips |
|---|---|---|---|---|
| none | 0.20–0.23 | 0.32–0.37 | — | 0.30–0.32 |
| smooth tip disc | 0.20–0.23 | 0.66–0.73 | 0.05 | 0.58–0.62 |
| hull per tooth | 0.21–0.26 | 0.62–0.68 | 0.33 / 0.67 / 1.00 / 1.67 | 0.65–0.92 |
| every second tooth | 0.21 | 0.64–0.67 | 0.19–0.82 | 0.64–0.69 |
| compound (one collider) | 0.20 | 0.64–0.69 | 0.05 | 0.59–0.71 |
| cuboid per tooth | ≈ hull | ≈ hull | ≈ hull | 0.71–1.00 |
| capsule per tooth | 0.21–0.23 | 0.58–0.67 | 0.26–1.17 | 0.58–0.79 |
| trimesh | 0.20–0.22 | 1.22–1.73 (×2) | 0.05 | 1.32–1.45 |
| polyline | 0.21–0.24 | 0.53–0.65 | sinks to the gear mid-plane | 0.52–0.64 |

- **Idle teeth cost nothing measurable.**
- **One pawl contact** costs one contact pair at 240 iterations, about +0.3 ms, whatever the representation. Trimesh is the exception at ×2.
- **Many teeth touching at once is where it hurts.** With separate colliders you get one pair per tooth (41 pairs, 205 points for 40 teeth) at ×8–35. A compound produces the same sub-manifolds at smooth-disc cost: 0.12 vs 4.1 ms in a direct check. I measured this but cannot explain it.
- **Heightfield** was not built: it is a single-valued height grid, so it cannot form a ring.
- **Every second tooth** puts a resting pawl inside a drawn tooth half the time, by up to 0.28. It only doubles holding (r 1 corner: 4 τ0 instead of 2), so it is not recommended.

## 2. Ratchet

### Geometry

Verified with geom.ts, output in out/geom.txt. Depth a feature reaches below the tip circle:

| Feature | r 0.5 | r 1 | r 1.5 | r 2.5 |
|---|---|---|---|---|
| Round beam end (r 0.46) | 0.069 (24% of tooth height) | 0.043 | 0.036 | 0.030 (11%) |
| Pin or axle side (r 0.29) | 0.099 (35%) | 0.065 | 0.055 | 0.048 (17%) |
| 90° corner | 0.218 (77%) | 0.179 | 0.167 | 0.157 (56%) |

The round end never enters a gap; the corner does. **The on-grid geometry needs nothing new.** A pointed sub-part would only add depth.

### Search

Done with ratchet.ts and summarize.mjs; output in out/search-r*.
- **Space searched:**
  - pivots on integer cells with x ≥ 0 (mirror symmetry), pawl length 1–3;
  - each legal edit-time arm direction under the §2.6 blocking rule, with no collider starting inside the tip circle;
  - the pawl dropped by gravity onto the gear.
- **Results:** 508 resting placements. Ratchets (lock ≥ 20 × free and lock ≥ 3 τ0 on the ramp), per pawl kind:

| Kind | r 0.5 | r 1 | r 1.5 | r 2.5 |
|---|---|---|---|---|
| round end | 2/25 | 6/31 | 8/28 | 8/37 |
| axle side, arm one layer up | 0/15 | 11/31 | 6/25 | 10/44 |
| corner end | 1/25 | 12/35 | 16/33 | 27/46 |
| pin out of end wall | 8/23 | 22/36 | 20/28 | 34/45 |

- **Round-end hits are mostly friction wedges.** On r 1.5 and r 2.5, 11 of 16 also lock on the smooth disc. The r 1 end pawl l2 at (1,3) falls from 27 τ0 to 3.6 τ0 at contact friction 0.2, and to 1.1 τ0 at friction 0.
- **Corner pawls are geometric.** Contact friction 0 / 0.2 / 0.8 gives 25.2 / 24.9 / 25.2 τ0 on r 1, and 215 / 215 / 187 τ0 on r 2.5.
- **Joint friction barely matters.** μ 0 / 0.05 / 0.2 changes lock by at most 3% and free drag by ×1.5–2.

### Working on-grid examples

Hub at (0,0,0), axis Z, all cells in layer z = 0, each pawl pinned at its first cell to a fixed frame.

| Gear | Pawl | Cells | Rest angle, lock direction |
|---|---|---|---|
| r 1 | corner | holes (1,3) and (2,3) along Z, hole (3,3) along X | −81°, locks + |
| r 1 | pin out of end | holes (1,3), (2,3), (3,3) along Z, pin (4,3) along X | −81°, locks + |
| r 1.5 | corner | holes (2,3) and (1,3) along Z, hole (0,3) along X | 205°, locks − |
| r 2.5 | corner | holes (0,5), (−1,5), (−2,5) along Z, hole (−3,5) along X | 236°, locks − |
| r 2.5 | pin out of end | holes (0,4) and (−1,4) along Z, pin (−2,4) along X | 225°, locks − |

### Static hold

Output in out/creep-*.txt. "Holds X" = less than 0.4 pitch after seating, then stopped. NF is Rapier's contact natural frequency; knap keeps 30 Hz.

| Case (gear inertia Izz) | NF 30 | NF 60 | NF 120 |
|---|---|---|---|
| r 0.5 pin-out-of-end l2 (Izz 0.09) | fails at 1 τ0 | — | holds 4, slips at 8 |
| r 0.5 corner (Izz 0.09) | fails at 1 | — | fails at 4 |
| r 1 corner l2 (1,3) (Izz 1.45) | holds 4, slips at 8 (2–3 pitch/s) | holds 8, slips at 16 | holds 32; 48–64 slips about 70 pitch then re-catches; at 128 the pawl is thrown and spins |
| r 1 corner, plus load inertia 58 | holds 8, slips at 16 | — | — |
| r 1 pin-out-of-end l3 | holds 2–4 (creeping), slips at 8 | — | holds 16, slips at 32 |
| r 1 axle side | holds 2, slips at 4 | — | holds 8 |
| r 1 corner, every second tooth | holds 4 (all teeth: 2) | — | holds 32, slips at 64 |
| r 1.5 corner and pin-out-of-end (Izz 7.3) | hold 8, slip at 16 | — | hold ≥ 64 |
| r 2.5 corner (Izz 56) | holds 16, creeps at 32 (1.3 pitch in 4 s) | — | holds ≥ 128 |
| r 2.5 pin-out-of-end | holds 32 (creeping 0.6 pitch) | — | — |

- **The failure is crush-through, not lift-over.** Pawl lift at failure is below 0.06 rad, and penetration reaches the full tooth height.
- **Single-tooth sink** (a beam end pressed on one tip, soft.ts, NF 30, 240 iterations):

| Force (× the beam's weight) | 1 | 4 | 11 | 31 | 101 |
|---|---|---|---|---|---|
| Sink (units) | 0.006 | 0.03 | 0.09 | 0.25 | 0.79 |

  NF 120 is about 10× stiffer.
- **Holding grows with effective contact mass.** That is why bigger gears hold more, and why load inertia helps.

### Click-over and catch

detail.ts speed; r 1 corner and r 2.5 corner, NF 30. The gear is driven, then the drive is cut and a sudden load applied.

| ω (rad/s) | Pawl lift, r 1 / r 2.5 | Pawl touching | r 2.5 catch at 4 τ0 |
|---|---|---|---|
| 1 | 0.033 / 0.055 rad | 97–100% | caught |
| 10 | 0.039 / 0.060 | 56–60% | caught |
| 30 | 0.13 / 0.19 | 11% | caught |
| 60 | 0.37 / 0.80 | 4–5% | caught |
| 100 | 1.2 / 85 (spins, +18 τ0·rad) | — | not caught (411 pitch) |
| 200 | pawl spinning | — | — |

- **r 1 with a bare torque load is not caught at any speed**, even at 2 τ0: the light gear slams in before the pawl seats. With load inertia 58 it is caught.
- Free-direction drag is 0.1–0.6 τ0 for r ≤ 1.5, and 1.2–2.2 τ0 for r 2.5 (inflated by the ramp).

### Long runs

60 cycles of 0.5 s driven then 0.5 s under a sudden load. Count = cycles where the load was not held.

| Case | at 10 rad/s | at 40 rad/s |
|---|---|---|
| r 2.5 corner, 4 τ0 | 0/60 | 0/60 |
| r 1 corner, 2 τ0, load inertia 58 | 0/60 | 0/60 |
| r 1 corner, bare torque, 1 τ0 | 57/60 | 38/60 |
| r 1 corner, bare torque, 2 τ0 | 30/60 | 48/60 |
| r 1 corner, bare torque, 4 τ0 at NF 120 | 59/60 | 60/60 |

There were no NaNs, and the pawl was lost off the gear in only 2 of 120 cycles.

## 3. Locking and rack-like contact

lock.ts, r 1.5.
- **Pushing a part radially into the teeth does not lock the gear.** Measured as μ_eff = τ/(N·tip), with N the push force:
  - with teeth, μ_eff is 0.8–1.9, against 0.5–1.0 on the smooth disc;
  - at 100× the part's weight it sinks 0.4–1.1 into the teeth.
- **A 15-hole beam lying on the tips** rides at the rolling speed (slip 0.2%). It grips up to 0.35·m·g and slips at 0.45·m·g, identical to the smooth disc, and it is stable (bounce 0.008).
- **It is not a rack.** No knap part has a 0.39 pitch, so a real rack would need toothed beams.

## 4. Mixed: mesh row and pawl contact on one gear

mixed.ts: an r 1 gear with a pawl, meshed by MeshPlanar to an r 1.5 gear. **No conflict found:**
- **Holding is unchanged.** Referred to the pawl gear: 45.4 vs 44.2 τ0 for the pin-out-of-end pawl, 25.5 vs 25.2 τ0 for the corner.
- **Phase error** stays ≤ 7e-7 while loaded, and ≤ 1.4e-3 with the pawl clicking at 60 rad/s.
- **Energy:** while coasting, the rise is ≤ 0.0015% of the energy dissipated.

Not tested above 60 rad/s, where the mesh row itself fails.

## 5. Tunnelling

r 1 corner and pin-out-of-end pawls, load inertia 56, spun into the pawl. Each cell: pitches travelled in 0.5 s, corner / pin-out-of-end.

| Variant | 60 rad/s | 100 | 200 | 350 |
|---|---|---|---|---|
| dt 1/480 | caught / 2.6 | 1.6 / caught | 9.5 / 7.4 | 69 / 140 |
| plus soft CCD | same | caught | 9.5 / 7.4 | 5.6 / 140 |
| dt/2, 120 iterations | caught | caught | caught | 57 / 130 |
| dt/4, 60 iterations | caught | caught | caught / 1.5 | 51 / 5.8 |

The threshold is ≈ 0.6–1.2 pitch of tip travel per step. Soft CCD is unreliable.

## 6. Cost per model

costN.ts: r 1.5 gears, one clicking pawl, and a fixed beam 0.03 under every gear's tips. CPU ms per step, ratio to "no teeth" in brackets.

| N gears | No teeth | Teeth on gear 0 only | Hull teeth on all | Compound on all | Teeth meet every part |
|---|---|---|---|---|---|
| 2 | 0.53 | 0.93 (×1.75, the pawl contact) | 0.92 | 0.91 | 2.08 (×3.9) |
| 10 | 1.63 | 2.05 | 2.17 (×1.33) | 2.15 | 5.9 (×3.6) |
| 40 | 6.4 | 6.4 | 7.3 (×1.15, 1082 colliders) | 6.7 (×1.05) | 21.8 (×3.4) |

## The one-way row

rrow.ts; r 1 gear, load inertia 56.
- **Pitfall:** the revolute's frame must be Rz(stop)·R0, where R0 maps the joint's X axis onto Z. A bare Rz locks the axis.
- **Results:**

| Test | Result |
|---|---|
| Hold 10 to 10⁴ τ0 for 5 s | ≤ 2e-7 pitch error (6.7e-5 at 10⁴) |
| Forward coast at 50–350 rad/s | loses 7–13 rad/s in 0.5 s, joint friction only |
| Reversed into the stop at 200 / 350 rad/s | 0.09 / 0.16 pitch overshoot, energy rise 0 |
| Cost | 0.36–0.45 ms per step, unchanged |

- **Not built:**
  - a row between the gear and the pawl's own body, for pawls on moving arms;
  - engaging and disengaging it from a geometric test (pawl tip inside the tip circle);
  - a one-sided contact-point row in the style of the mesh row.

## Still wrong, or not tested

**Still wrong:**
- **Holding:** contact ratchets on 8- and 16-tooth gears hold < 1–4 τ0 at knap's settings, and fail most sudden loads on a gear with no load inertia.
- **High speed:** at 100 rad/s and above, the pawl is thrown or spins.
- **Tunnelling:** above 100–200 rad/s.

**NF 120 Hz:**
- It gives about 8× the holding, but I did not check its effect on the rest of knap.
- DEVIATIONS §5 says 60 and 120 Hz "change none of the tested numbers" there. It also says, in another place, that the setter had "no measurable effect". Here it clearly does, for dynamic–dynamic contacts; fixed-body contacts keep 60 Hz.

**Edit-time overlap.** §2.6 blocks cells against the nominal disc r. A legally placed neighbour's collider then starts 0.085 inside the teeth. Gears should block non-gear parts with the tip radius, or knap must accept a pop at Play.

**Not tested:**
- ratchet behaviour of the box, capsule and compound representations (costed only);
- knap's energy guard, speed cap and stiction;
- pawls on moving arms;
- pawls lifted by the user mid-run;
- gears offset along the axle;
- a ratchet on the fast gear of a train;
- swinging gears in and out of mesh;
- browser cost;
- the real drawn tooth profile, which I modelled as a trapezoid.

## Files

All in /Users/antony/Desktop/knap.nosync/spikes/teeth2/. Run each with `sh spikes/teeth2/run.sh <name> …` from the project root.

| File | What it does |
|---|---|
| lib.ts | gears, collision groups, knap pawl parts, world |
| geom.ts | gap depths |
| cost.ts, costN.ts | collider cost per gear and per model |
| ratchet.ts | ratchet search |
| summarize.mjs | tables from the search |
| detail.ts | friction / hold / speed / long / impact tests; env NF, LOAD, FLY, REP |
| creep.ts | constant-load holding |
| soft.ts | sink against force |
| lock.ts | radial push and rack-like contact |
| mixed.ts | mesh row plus pawl |
| rrow.ts | the one-way row |

Raw outputs are in spikes/teeth2/out/*.txt and *.json. spikes/teeth/ was read but not modified.
