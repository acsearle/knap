# MuJoCo spike (engine battery)

Engine: **MuJoCo 4.0.1** through the official Google DeepMind WASM bindings, npm
`@mujoco/mujoco@4.0.1` (published 2026-11-11, 50,203 downloads in the week of 2026-11-19..25,
Apache-2.0, unpacked 23.9 MB; `mujoco.wasm` 11.2 MB raw, 2.77 MB gzip -9; a multi-threaded
build in `mt/` needs cross-origin isolation). f64 throughout (`qpos` is a `Float64Array`).
The bindings README calls itself "still a WIP"; the mjSpec (editing) API is bound but "untested
in real web applications".

## Run

```sh
cd spikes/engines/mujoco
npm install            # installs @mujoco/mujoco@4.0.1 locally
node b1_rest.mjs       # B1a/b/c at default and tuned settings, at 8 mm and 1 m scale
node b2_b3_impact_fall.mjs
node b2_variants.mjs   # plane floor, speculative contacts, smaller dt
node b4_prisms.mjs     # 32-gon / 16-gon mesh prisms, multiccd on/off, libccd
node b5_wheels.mjs
node b5_yawspin.mjs    # an off-battery fall-through found by accident
node cap_on_box.mjs
node b6_pendulum.mjs
node b6_euler_dt.mjs
node b7_freespin.mjs
node b7_warn.mjs
node b8_gears.mjs
node b9_hinge_extras.mjs
node b9_stiff.mjs
node b9_noslip.mjs
node b10_cost_compile.mjs
node rk4_contacts_fourbar.mjs
```

Every script runs in under 2 s (Node 20.11, this machine).

## Units and settings

- MuJoCo is SI and Z-up. Parts are modelled at real size, so 1 stud = 0.008 m and gravity is
  9.81 m/s². Density is 585.9 kg/m³ (0.3 g per stud cube). Results are reported in studs,
  seconds and rad. `lam = 125` runs the same world at 1 m per stud with gravity × 125, so the
  motion in real seconds is the same.
- **default**: MuJoCo's own defaults, except `timestep` = 1/480 s: Euler, Newton solver,
  100 iterations, pyramidal cone, impratio 1, `solref` 0.02 1, `solimp` 0.9 0.95 0.001,
  nativeccd and multiccd on (multiccd is on by default in 4.0.x).
- **tuned**: implicitfast, elliptic cone, impratio 10, contact `solref` 0.005 1 (the documented
  floor is 2 × timestep = 0.0042), `solimp` 0.95 0.99 with a width of 1e-4 × lam m.
- Joints use `damping` 0, `armature` 0, `frictionloss` 0 unless stated. Sleeping is off
  (MuJoCo's default). Friction is 0.5 and condim is 3. MuJoCo has no restitution coefficient:
  bounce comes from the soft-contact spring.

## Does the scale (units) matter?

For MuJoCo, almost not at all, and how it works explains why:

- The constraint model is defined in acceleration space with a time constant in seconds.
  Mass does not enter it: B1a at density × 1000 gives the same sink to 4 digits (2.134e-3).
- Only parameters that are absolute lengths depend on scale: the `solimp` width (0.001 m by
  default), `margin` and `ccd_tolerance`. With default `solimp`, 8 mm and 1 m differ
  (B1a sink 2.13e-3 against 9.6e-4 studs). With the width scaled to the part size ("tuned"),
  B1, B4 and B5 give the same numbers in studs at lam 1 and lam 125.
- What does matter at 8 mm is that MuJoCo's default contact softness (solref 0.02 s) was chosen
  for robots: a cube hitting at 150 studs/s (1.2 m/s) passes through a 1-stud (8 mm) box floor.
  This is about time constant against part size and speed, not about units. Stiffer solref fixes
  it.

## Results (real units; studs, s, rad)

| test | setup | verdict | numbers |
|---|---|---|---|
| B1a cube on box floor | default / tuned | PASS | sink 2.13e-3 / 4.15e-4; drift 7e-11 / 1.4e-9 studs/s; 4 contacts |
| B1b cube on loose beam 9 | default / tuned | PASS | cube→beam 2.35e-3 / 3.3e-4; beam→floor 2.35e-3 / 4.6e-4 |
| B1c 5-stack (top 10×) | default | MARGINAL | compression 0.053 (0.182); stands |
| B1c | tuned | PASS | compression 0.0098 (0.026); stands, lateral 1e-8 |
| B2 drop 150 / 300 studs/s | default, box floor 1 thick | FAIL | falls through in 5 of 6 start phases |
| B2 | default, plane | FAIL | deepest 0.91–1.06 / 1.99–2.14; rebound 17–20 / 38–41 studs/s |
| B2 | tuned | MARGINAL | deepest 0.11–0.27 / 0.41–0.58; rebound 9–23 / 34–49 studs/s; sideways 0, spin 0 |
| B2 | tuned + `speculative` | MARGINAL | 300: deepest 0.045–0.24, rebound 4–20, sideways ≤ 2.5e-4 |
| B3 free fall | any | PASS | 613.125 / 1226.250 / 1839.375 at 0.5 / 1 / 1.5 s (exact); no clamp |
| B4a box on 32-gon top | default / tuned (multiccd on) | PASS | 7 of 7 spots: tilt 0, sink 2.13e-3 / 4.15e-4, 4 contacts |
| B4a | multiccd off | FAIL | 1 contact, falls off/through at all 7 spots |
| B4a | libccd (nativeccd off) | FAIL | 2 of 7 spots fall; 3–5 contacts at the others |
| B4b 16/32-gon on end | default / tuned | PASS | tilt ≤ 0.05° / ≤ 0.01°, sink 2.1e-3 / 4.2e-4, 4 contacts, plane and box |
| B4b | multiccd off, box | FAIL | 1 contact, sink 0.66–0.70 |
| B5a wheel r1 at rest / 1 stud/s, 5 s | default / tuned, box and plane | PASS | rest 1e-10 / 3e-9 studs/s; roll keeps 0.999 / 1.000; never speeds up; sink 4.3e-3 / 8.3e-4; 2 contacts |
| B5b roll 100 studs/s, 2 s | default / tuned | PASS | kept 99.93 % / 99.986 %; mean sink 4.7e-3 / 8.5e-4; max 2.0e-2 / 5.5e-3 |
| B5c r2.5 on loose beam | default / tuned | PASS | wheel→beam 0.014 / 0.0026; beam→floor 7e-3 / 1.4e-3; stays (x 1e-8) |
| B6a pendulum 10 s | Euler or implicitfast | PASS | ΔE +0.64 % (swing ±1.5 %); hinge gap 0 (by construction) |
| B6a | RK4 | PASS | ΔE 0.0000 %; gap 0 |
| B6b triple 10 s | Euler / implicitfast, 1/480 | FAIL | −92.2 % (−49.5 % at 1/1920, −15.7 % at 1/9600, −2.4 % at 1/48000) |
| B6b | implicit | FAIL | blows up (+238,000 % peak) |
| B6b | RK4 1/480 | PASS | −0.245 % (−0.0096 % at 1/960); gap 0; 3.3–3.6 ms per sim s |
| B7 free spin 30 s | Euler | FAIL | grows, NaN at 12.2 s, auto-reset (BADQACC warning) |
| B7 | implicitfast | FAIL | K −3.05 %/s, \|L\| −3.08 %/s (damping) |
| B7 | RK4 | PASS | K +1.3e-7 %/s, \|L\| −3.7e-7 %/s |
| B8 gears (joint equality) | solref 0.02 / 0.005 | PASS | ratio error while driven 1.28e-2 / 8.4e-4 rad (0.033 / 0.002 teeth of 16), decays to 1e-12 after release; K/work 0.9998 / 1.0000; 300 rad/s fine |
| B9 hinge extras | see below | PASS (with noslip) | friction, motor with max torque, limits, reaction force yes; one-way limit only emulated |
| B10 cost: triple + 20 cubes | default / tuned / tuned+RK4 / tuned+noslip / RK4+noslip | PASS (RK4+noslip MARGINAL) | 54 / 69 / 185 / 116 / 496 ms per sim s (113 / 144 / 386 / 242 / 1034 µs per 1/480 step); reruns bit-identical |

### B9 detail (beam-7 pendulum)

- **Joint friction**: `frictionloss` (constant torque). It is a soft constraint: at default
  settings a 1.2 × τ_g friction let the beam fall to 1.47 rad in 10 s. Stiffer
  `solreffriction`/`solimpfriction` slows the creep (7e-2 rad in 10 s). The **noslip** solver
  (`noslip_iterations` 20) holds it to 1e-14 rad, and below τ_g it still slips with the right
  energy (−ΔE / friction work 0.993–0.9995).
- **Motor with max torque**: actuators `motor`, `position` (kp, kv) and `velocity`, all with
  `forcerange`. A position servo with 2 τ_g holds at 0.02 rad (= τ_g/kp). With 0.5 τ_g it
  saturates and sags.
- **Angle limits**: `range`. Soft: a fall onto the limit overshoots 0.116 rad at defaults and
  0.025 with `solreflimit` 0.005. Resting error 4.9e-3 rad, 6e-5 with `solimplimit` 0.99 0.9999.
- **One-way (ratchet) limit**: none native. Emulated by rewriting `model.jnt_range` every step,
  which takes effect without a recompile: back-slip 0.022 rad.
- **Reaction force**: `mj_rnePostConstraint` → `cfrc_int` reads exactly m·g for a hanging link.
  Also `qfrc_constraint`, `efc_force`, `mj_contactForce`, and the `jointlimitfrc`,
  `jointactuatorfrc`, `force` and `torque` sensors.

### Extra findings

- **Compile cost** (`b10_cost_compile.mjs`, a 20-body hinged chain): from the XML string to
  `MjModel` + `MjData` takes 2.0–2.8 ms with primitives and 11 ms with 20 distinct 16–18-gon
  meshes. `parseXMLString` takes 2–3.5 ms and `mj_compile(spec)` 0.5–7.4 ms. Rebuilding on every
  Play costs nothing noticeable. Model fields such as `jnt_range` can be changed live.
- **Closed loop (four-bar) via `connect` equality** (`rk4_contacts_fourbar.mjs`): the soft loop
  closure dissipates. Over 10 s: implicitfast −3.9 %, gap 0.05 studs; RK4 with solref 0.005 −19 %,
  gap 0.026; RK4 with stiff solimp −5.7 %, gap 3.3e-3; RK4 at 1/1920 with solref 0.00105 −0.22 %,
  gap 1.8e-4, 25 ms per sim s.
- **RK4 with contacts**: B1a, B4a and B5a/b give the same numbers as tuned implicitfast.
- **Unexplained fall-through** (`b5_yawspin.mjs`): an r1 wheel lying on its side, sliding at
  100 studs/s and spinning at 100 rad/s about the vertical, falls over and then drops through
  the 1-stud box floor at tuned settings (−1386 studs). This happens with pyramidal, impratio 1
  and Euler too. It does not happen at defaults, on a plane, or at dt/4. `cap_on_box.mjs` (cap
  resting, sliding, spinning, tilted) did not reproduce it. Not investigated further.

## Not tested

B2 sideways throw for asymmetric impacts; gear meshing by contact (teeth); pins in real holes
(meshes are convexified, so a hole needs a convex decomposition; jointed bodies would normally
not collide at all); mjSpec incremental `recompile`, which I did not find in the JS bindings;
the multi-threaded build; browser timings (all numbers are from Node); the far-from-origin
f64 behaviour; long trains of joint equalities; the sleeping (`sleep`) flag.
