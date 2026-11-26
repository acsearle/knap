## Spike "wheels": report

All files are under spikes/wheels/. I edited nothing under src/, tests/, e2e/ or docs/ and ran no git commands. Every measurement uses Rapier 0.21.0 in Node with sim.ts's settings: 1/480 s step, 30 substeps for loose bodies and 240 for jointed ones, 1 PGS iteration, hard CCD off, lengthUnit 1, friction 0.4, restitution 0.1, density 1. Wheels are 1 unit thick. The machine was shared with other jobs throughout, so treat costs as upper bounds.

**Short version:**
- A plain cylinder wheel only works against a half-space ground. Against a cuboid or against liftarm colliders it runs away or falls through.
- The project's polygon prisms cannot roll: they lose energy at every facet.
- For that half-space-only case (free cart, no fixed body) the numbers match the analytic values within 0.8 %.
- Wheels touching other parts are not solved. No collider I tried was reliable there.

### How to run
- Build: `spikes/wheels/build.sh` (esbuild bundles to spikes/wheels/out/*.mjs; Rapier stays external).
- Run from spikes/wheels/:
  - `node out/roll.mjs [flat|incline|rest|lie|drop|spin|det] [kinds] [radii] [grounds] [iters]`
  - `node out/drive.mjs [kinds]`
  - `node out/cart.mjs [incline|coast|rest|step|guard|cost|iters|cuboid]`
  - `node out/cost.mjs`, `node out/ground.mjs`, `node out/disc-table.mjs`
- Environment variables:
  - `CCD=0` turns soft CCD off.
  - `WHEEL_BEVEL=` sets the prism cap bevel (default 0.05).
  - `ARM_ROWS=` sets the liftarm floor width (default 5).
  - `HULL_ORIGIN=world` puts hull points in world coordinates instead of centring them.
- diag*.ts are failure repros.
- Tests: `npx vitest run --config spikes/wheels/vitest.config.ts` — 8 tests pass. `npm test` does not pick them up and tsconfig does not include spikes/.
- Raw outputs are in results/ and results/v2/. The v2 files are the authoritative ones: wide liftarm floor, with and without soft CCD.
- vitest left a small spikes/wheels/node_modules cache.

### 1. Which collider for the wheel
Kinds tested:
- `cyl`: native cylinder.
- `rcyl`: round cylinder.
- `pN` / `bN`: the circumscribed N-gon prism from shapes.ts, with cap bevel 0.01 or 0.05.
- `rpN`: round convex hull.
- `hyb`: native cylinder in a ROUND collision group plus a b32 prism in a HULL group.

Grounds tested: half-space, a cuboid (half-height 1), and floors made of liftarm hulls (lying flat, or on edge with the flat web on top; seams every 15 units, 5 rows wide).

**Polygon prisms do not roll (analytic, and confirmed).**
- At every vertex change, angular momentum about the new contact vertex is conserved, so ω₊/ω₋ = (I_c + mR²cos(2π/n))/(I_c + mR²). The energy factor per edge is that ratio squared.
- For a disc with n = 64 that leaves about 66 % of the kinetic energy per revolution.
- A prism stays still on any slope below π/n. That is 11.25° for 16 sides and 5.6° for 32.
- Measured, starting at 40 units/s:
  - p16 stops within 7–30 units, p32 within 12–57, p64 within 20–73.
  - On a 5° slope p16 and p32 have a ≈ 0 (r ≥ 1.5); p64 reaches only 24–58 % of the analytic acceleration.
- Rounding the corners (rp16/32/64) gives the same losses. Pivoting between corner arcs is still an impact.

**Native cylinder on a half-space: everything passes.**
- Rolling at 40 units/s over 160 units (≥ 20 diameters):
  - Speed loss ≤ 0.43 % (r = 0.5), ≤ 0.1 % for r ≥ 1.
  - Speed ripple (std/mean) ≤ 1.8e-4.
  - Vertical jitter of the axle, peak-to-peak: 4e-4 to 2.2e-3 units.
  - Sink below exact touching: 0.005–0.014 units. This shrinks the effective rolling radius, giving slip of v·δ/r (0.56 units/s at r = 0.5, 0.024 at r = 4).
  - Yaw ≤ 3e-5 rad and sideways drift ≤ 0.004 units for r ≥ 1. For r = 0.5: yaw 3.3e-3 rad, drift 0.5 units.
- Incline from rest, compared with a = g·sinθ/(1 + I/(m r²)) using the engine's own m and I (I/(m r²) = 0.5000):

  | r | 5° | 15° | 30° |
  |---|---|---|---|
  | ≥ 1.5 | −0.14 % … −0.02 % | −0.5 % … −0.07 % | −0.8 % … −0.12 % |
  | 1 | −0.3 % | −1.1 % | −1.7 % |
  | 0.5 | −1.0 % | −10 % | −25 % |

  - The r = 0.5 shortfall is explained: Rapier caps angular speed at π/4 per step, which is 377 rad/s. A wheel therefore skids above v = 377·r, i.e. 188 units/s for r = 0.5.
  - Confirmed at 380 units/s: r = 0.5 is held at v = 175 units/s with ω = 377 rad/s.
  - Yaw on inclines reaches up to 0.024 rad, with sideways drift up to 1.05 units over about 200 units travelled.
- At rest for 5 s: forward creep 1.2e-8 units, axial creep ≤ 6e-3 units, speed ≤ 2.5e-3 units/s.
- Lying flat on its face: sink 0.006–0.011 units, tilt 0, drift ≤ 1.3e-3 units.
- Dropped from 10 units (impact 156.6 units/s), on edge, tilted 30° and flat: penetration ≤ 0.034 units (≤ 0.24 with CCD = 0), no failures in 24/24 cases.

**Native cylinder against anything else fails.**
- On a cuboid: a cylinder placed at rest creeps, accelerates on its own, and in most runs at r ≥ 1 tunnels through, reaching the 400 units/s cap.
  - Trace for r = 1: still for 1 s, then 0 → 8.4 units/s within 1.6 s.
  - Soft CCD on or off makes no difference.
  - Rolling on a cuboid loses 1–6 % speed.
  - The cart (see §2) did not show this, because axle stiction holds the wheels.
- Against liftarm hulls: a cylinder placed at rest falls straight through at several positions, with zero contacts reported.
  - This happens near hull ends and on a 1-hole cell standing on edge.
  - Sideways drift stays ≤ 0.05 units, so this is not tipping off a narrow floor.
  - Rest tests on the liftarm floor fail in almost every case, with or without CCD.
  - Rolling on it: armFlat loses 4–25 %, armEdge 18–99 %.
- Round cylinder behaves the same.
- Repros: `node out/diag2.mjs cyl 1 15 2` and `node out/diag3.mjs cyl 1 30 50 0.3`.

**Cap bevel for wheel prisms (a new finding about shapes.ts's method at large radius).**
- With the project's BEVEL of 0.01, the prisms fall through when lying flat for r ≥ 1.
- The hull builder merges the shallow cap facets back into one face with more than 4 vertices, which hits parry's 4-vertex limit.
- Measured failure threshold: r > ~80–100 × bevel.
  - Bevel 0.02 fails at r ≥ 2; 0.03 at r ≥ 3; 0.05 passes all r ≤ 4 and fails at 4.5; 0.06 passes up to 6 except 16-gon on a cuboid.
- Rule: bevel ≥ 0.0125·r. I recommend 0.02·r.

**Hull wheel landing on liftarms is unreliable.**
- A b32 prism (or the hull half of the hybrid) dropped from 2–10 units onto the liftarm floor falls through in 11–12/24 cases with sim.ts's soft CCD, and 7–8/24 without.
- The cause is soft CCD's predictive contacts (1.04 units, as sim.ts gives unjointed bodies). Same isolated test: 17/24 failures with soft CCD, 2/24 without.
- Rolling on the liftarm floor never fell through with soft CCD off, but it is lossy (the hull is a polygon).
- Plain liftarms dropped in the real Simulation from 2–10 units onto a fixed 15-hole liftarm did not tunnel in any orientation. The apparent failures were the loose arm bouncing off sideways.
- Repro: `node out/diag5.mjs p64 1.5 armFlat 2`.

**Wheel–wheel friction drive.**
- Setup: wheel A spins at a fixed rate; wheel B is free to slide toward A and rotate, pressed by force F_N; a braking torque on B is ramped up.
- Cylinder against cylinder (36 cases, μ 0.4/0.8/1.2, radius pairs 1.5/1.5, 2.5/1, 1/2.5, 0.5/0.5):
  - Measured μ_eff = τ_crit/(F_N·r_B) is μ −10 % to +13 % in 33 of 36 cases.
  - The exception is a large driven wheel (r_B 2.5 from r_A 1) at F_N = 10× its weight: −35 % … −36 %.
  - Slip below half the limit: ≤ 0.2 %, rising to 1.7 % at 10× weight.
  - Measured normal force matched the applied force within 0.2 %.
- Polygon against polygon (b32): no usable drive, μ_eff ≈ 0–0.08 and 13–58 % slip.
- So drive rims must be cylinders.
- Friction combine rule is Average (μ 0.4 with 0.4 gives 0.4).
- Tyre: there is no fixed "needed" μ. A drive transmits τ ≤ μ·F_N·r and the measured μ is honoured. A rubber-like tyre with μ ≈ 0.8–1.0 against the 0.4 parts (combine rule Max, or Average if both are tyres) doubles what a light spring can transmit.

### 2. Free cart in the real Simulation
**Model:**
- Chassis: two 7-hole liftarms joined by a pin hole.
- Axles: frictionPin welded to the chassis plus a pin in a one-cell wheel hub (revolute).
- Each wheel body also gets the hybrid wheel colliders.
- Every collider Simulation creates goes into the PARTS group.
- Ground: half-space.
- A dummy root part far away is fixed, so the cart has no path to a fixed body.

| Test | Result |
|---|---|
| Incline 5/15/30°, r 1/1.5/2.5, joint μ 0 and 0.2 | Error −0.8 % … +0.6 % (27 runs). Analytic a = (M·g·sinθ − 4τ_f/r)/(M + ΣI/r²), with τ_f = μ·m_j·g·R_BORE |
| Coast to stop (μ 0.2, r 1.5) | Stop distance within 0.4–0.7 % of v₀²/(2·decel): 7.95 vs 7.92 and 199.4 vs 198.0 (m_j = 7.69); 14.69 vs 14.57 and 367.0 vs 364.4 (m_j = 4.18). No creep after stopping (Δx = 0 over 5 s) |
| At rest 30 s | Sink 0.009–0.017 units; chassis y peak-to-peak 2.2e-3 … 5.0e-3; drift ≤ 3e-5 units; speed ≤ 0.014 units/s; no body removed |
| At rest on a cuboid, 10 s | No runaway (axle friction holds the wheels) |
| Off a 2-unit step | 40 and 150 units/s: lands at y = −2.01 … −2.02, penetration ≤ 0.12, joint error ≤ 5e-5, nothing removed. r = 1 at 40 units/s gets stuck high-centred on the edge (clearance 0.53 < 2; physically plausible). At 10 units/s the cart stops before the edge |
| Determinism | Bit-identical within a process and across processes (pose hashes) |

**What breaks with nothing fixed, and what sim.ts would need to change:**
1. **The analysis always fixes a root.** Today `rootPartId: null` means "lowest part id". A ground/free-root model needs an explicit "no fixed part" option.
2. **Joint-friction load (loadMasses).** With no path to a fixed body it uses the lighter body's mass. In this cart that is 7.69 (the wheel) against the true axle load of 4.18 = (M − 4·m_wheel)/4. The friction motor itself works exactly (the coast numbers above). Only the load estimate is wrong.
   - Fix options: treat wheels touching the ground as the "fixed" sinks in the ranking; or set each axle's motor limit every step from the measured wheel–ground normal impulse (`world.contactPair` → `contactImpulse`, one query per wheel per step).
   - Rapier has no rolling resistance. A free wheel with no axle friction never stops.
3. **Energy guard: needed, and it works.** μ = 0, rolling at 100 units/s for 20 s:
   - Guard off: speed rises 20 % and energy 45 % (f32 spin gain).
   - Guard on: speed +0.5 %, energy +0.9 %; the guard removed 37 % of the initial kinetic energy over the run.
   - On inclines it removed nothing.
   - Grouping and the energy reference work unchanged; ground contacts are ignored because the ground is not a model body.
4. **Soft CCD.** sim.ts gives it to unjointed bodies. A loose wheel would get it, and that causes the hull wheel to fall through liftarms. Exclude wheel bodies from soft CCD.
5. **decoupleInertia** is skipped for free groups (it only applies when attached to a fixed body). Symmetric wheels are fine. A wheel carrying an off-centre crank pin is untested and could show the documented spin-up.
6. **Speed caps.** 400 units/s for the body (a cart reaches it within about 1 s down 30°) and 377 rad/s for wheels (wheels with r < 1.06 skid first).
7. **Substeps.** The cart is jointed, so it runs at 240 substeps. At 30 substeps it is as accurate on the 15° incline (−0.42 % vs +0.14 %), with rest creep 0.011 units in 5 s against 3e-5. Cost was 390 against 1339 ms per simulated second in that run, with the machine heavily loaded.
8. **Removal rule.** It never fires above a half-space; it only catches tunnelled bodies.

### 3. Ground plane
- **Half-space is the only ground that worked.** The cuboid has the cylinder runaway and deeper impacts (up to 0.37 units). With no ground, a free cart falls and is removed about 0.81 s later (400 units).
- **The examples rule out an always-on ground.** Lowest cell y and the lowest point reached in the first 10 s (approximate):

  | Example | Lowest cell y | Lowest point in 10 s |
  |---|---|---|
  | pendulum | 0 | −4.9 |
  | triple pendulum | 0 | −9.9 |
  | four-bar | 0 | −5.2 |
  | parallelogram | −2 | −5.2 |
  | sliding axle | −2 | −4.9 |
  | weld test | 0 | −6.3 |
  | collision | −6 | −7.8 |

  - Every example swings below its own lowest point. Three of them already have cells below the grid plane (y = −0.5).
  - So both "ground at the model's lowest point at Play" and "fixed ground at −0.5" break all seven examples.
- **Proposed rule:** ground is a per-model toggle, off by default, so existing files and examples are unchanged.
  - When it is on, the ground is the half-space at the drawn grid plane, y = −0.5, and stays drawn while simulating.
  - The editor refuses cells with y < 0 and wheels whose bottom (hub y − r) is below −0.5.
  - The root may then be "none" (a free vehicle).
  - Consequence: on integer hubs only wheels with r = k + ½ sit exactly on the ground. Integer radii start 0.5 units (4 mm) above it and drop about 29 ms at Play; the step test shows such drops are harmless.
  - The alternative "ground follows the lowest wheel bottom" avoids the drop, but the floor then moves with every edit.

### 4. Cost (ms of stepping per simulated second, best of 3 × 2 s, shared machine)

| Case | ms per simulated s |
|---|---|
| Empty world + half-space | 2.5 |
| 1 loose wheel rolling, 30 substeps | 33 |
| 4 loose wheels rolling, 30 substeps | 39 |
| 1 wheel at 240 substeps | 163 |
| 4 wheels at 240 substeps | 251 |
| Hybrid wheel resting on liftarms, 30 substeps | 38 |
| Hybrid wheel resting on liftarms, 240 substeps | 283 |
| Cart (5 bodies, 4 revolutes, 4 wheels on the ground) | 483 |
| Same cart model without wheel colliders | 215 |

- The four ground contacts at 240 substeps therefore add about 67 ms per wheel.
- A cylinder–cylinder drive pair costs about +190–230 ms whenever the two bounding boxes overlap, even without contact: 326 in contact, 368 at a 0.01 gap, 139 when far apart. This matches the known ~0.5 ms per step for cylinder–cylinder.
- At ¼× playback the cart needs about 120 ms per real second; at 1× it exceeds the 8 ms-per-frame step budget and runs slower than real time.

### 5. Edit-time overlap rule (disc.ts, tested in disc.test.ts)
- A wheel is a disc of radius r in its hub's layer. A grid cell is a closed unit cube. Only intersections with positive volume count as overlap; touching is allowed.
- **Disc against a cell:**
  - Overlap is only possible in the same layer.
  - It overlaps iff near² = max(0,|du|−½)² + max(0,|dv|−½)² < r².
  - It fully covers the cell iff (|du|+½)² + (|dv|+½)² ≤ r².
  - Equality with r² means touch.
- **Disc against disc, parallel axes:** overlap iff same layer and distance < r1 + r2. Equal to r1 + r2 is "touch", which is the mesh / friction-drive distance.
- **Disc against disc, perpendicular axes (a, b; third axis k):**
  - m_b = max(0,|d_b|−½)², m_a = max(0,|d_a|−½)².
  - Overlap iff m_b < r1², m_a < r2² and |d_k| < √(r1²−m_b) + √(r2²−m_a). The last comparison is done squared so it stays exact.
- `wheelBlockers` lists the cells that would block placement; a male cell in the hub itself (its axle or pin) is allowed.
- The tests check against dense sampling (one random perpendicular case in 600 may be missed by sampling) and include known cases.
- **Cells of the wheel's own layer covered (one octant u ≥ v ≥ 0; hub excluded, it is "full" for r ≥ 1):**

  | r | Full | Partial | Touch only |
  |---|---|---|---|
  | 0.5 | – | – | (1,0) |
  | 1 | – | (1,0), (1,1) — 8 cells | – |
  | 1.5 | – | 8 cells | (2,0) |
  | 2 | (1,0) — 4 cells | (1,1), (2,0), (2,1) — 16 cells | – |
  | 2.5 | (1,0), (1,1) — 8 | (2,0), (2,1), (2,2) — 16 | (3,0) |
  | 3 | 20 | 24, out to (3,2) | – |
  | 3.5 | 20 | 24 | (4,0) |
  | 4 | 36 | 32, out to (4,2) | – |

  - So a crank-pin hole fuses fully inside the wheel only from r = 2 (at (1,0)), and from r = 2.5 at (1,1).
- Aside for gears: integer grid centres only allow integer mesh distances (5 = hypot(3,4) also works). So r1 + r2 must be an integer: 8T+24T at 2 units works, 8T+16T does not.

### Verdict: works with limits
**What works:** native-cylinder wheels on a half-space ground, including free carts with no fixed body, under sim.ts's joints, joint friction, energy guard and settings.
- Accuracy: inclines −0.8 … +0.6 %; coast distance within 0.7 %; no creep at rest; deterministic.
- Wheel–wheel friction drives work: μ_eff −10 … +13 % of μ in 33 of 36 cases (down to −36 % with a large driven wheel under 10× load).

**What does not work** (I would not ship wheels until there is a fix or a deliberate scope cut):
- Wheels rolling on, resting on or landing on parts or a cuboid.
- Polygon-prism wheels in general.

**Best recipe:**
- Ground: fixed body with `new RAPIER.ColliderDesc(new RAPIER.HalfSpace({x:0,y:1,z:0}))`, friction 0.4, groups `(0x1<<16)|(0x2|0x8)`.
- Wheel round collider: `ColliderDesc.cylinder(0.5, r).setRotation(<local Y → wheel axis>)`, density 1, groups `(0x2<<16)|(0x1|0x2)`. It meets only the ground and other wheels.
- Wheel hull for contact with parts: a 32-gon prism with bevel ≥ 0.0125·r (0.05 used), density 0, groups `(0x4<<16)|0x8`.
- All other part colliders: groups `(0x8<<16)|(0x1|0x4|0x8)`.
- No soft CCD on wheel bodies.
- Axles: sim.ts revolute plus its friction motors (acceleration-based, gain 1e9, maxForce μ·m_j·g·R_BORE), but with a corrected free-vehicle load.
- Energy guard on.

**Known failure modes:**
- Cylinder against a cuboid: self-propelled runaway.
- Cylinder against a convex hull: falls through at rest.
- Hull wheel landing on liftarms: falls through about 30–50 % of the time from ≥ 2 units.
- Hull wheel rolling on parts: polygonal losses, stops within 10–58 units from 40 units/s.
- Angular cap of 377 rad/s: small wheels skid above 377·r units/s.
- Linear cap of 400 units/s.
- Effective rolling radius is r minus a sink of about 0.005–0.014 units.
- Without the energy guard a free-rolling cart gains about 1 % speed per second.

**Engine question:** if wheels or gears must roll on or collide with liftarms reliably, these are parry 0.21 narrow-phase defects (cylinder against polyhedron or cuboid, predictive contacts), not tuning problems. I recommend trying a newer Rapier/parry first. If that does not fix them, evaluate Jolt, which has robust cylinder and convex contacts.

**Not tested:**
- Gears, spatial wheel axes, steering.
- Wheels with an off-centre mass (decoupleInertia).
- Tyres with combine rules other than Average.
- Long runs over 30 s on inclines.
- Browser or WASM-in-Chromium timing.
- Contact-impulse-based axle friction.
- Newer Rapier versions.
- Carts with r = 0.5 wheels.
- The hybrid wheel's hull against pins and axles specifically.
