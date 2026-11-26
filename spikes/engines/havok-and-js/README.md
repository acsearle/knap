# Havok (web WASM) and JS-native engines: battery spike

Engine run: `@babylonjs/havok` 1.3.14 (published 2026-07-29), driven through the raw `HP_*` API in
Node 20.11. Babylon.js is not used. A short check of `cannon-es` 0.20.0 is included.

## Install / run

```
cd spikes/engines/havok-and-js
npm install                # @babylonjs/havok@1.3.14, cannon-es@0.20.0
node contacts.mjs [U] [n]  # B1-B5. U = internal units per stud (0.008 = metres, default; 1 = studs); n = Havok steps per 1/480 s
node joints.mjs   [U] [n]  # B6-B10, determinism, f32 check
node sweep.mjs             # B2 / B5a over U = 0.008, 0.08, 0.25, 1
node yaw.mjs               # resting cube's self-spin over U
node pend.mjs              # B6a energy loss under different Havok settings
node cannon.mjs            # cannon-es check (B6a, B5a, B7)
```

The world runs at 1/480 s with `HP_World_SetIdealStepTime(dt)` and real gravity (1226.25·U internal
units/s²). Damping is 0, bodies are `ALWAYS_ACTIVE`, friction is 0.5 with MINIMUM combine and
restitution 0. The speed limit is raised to 1e6 (the default is 200 internal units/s and 100 rad/s).
All results are converted back to studs and seconds. Density is 752 kg/m³, so a cube weighs 0.3 g in
SI. At other U the same number is used per internal volume; mass is free.

## Results (1 Havok step per 1/480 s unless noted)

| test | metres (U 0.008) | U 0.08 (10x scale) | studs (U 1) | verdict |
|---|---|---|---|---|
| B1a cube on box floor | sink −1e-8, drift 0 | same | sink 5e-5 | PASS |
| B1b cube/loose beam/floor | 6.3e-4 / 5.3e-4 | 4.5e-4 / 8.9e-5 | 5.9e-4 / 1.6e-4 | PASS |
| B1c 5-stack (top ×10) | 0.0062 (0.026), stands | 0.0062 (0.026) | 0.011 (0.030), offset 0.04 | PASS |
| B2 flat drop 150 / 300 | no bounce, pen. 4e-6; **then the cube self-spins in yaw to 15 rad/s and keeps it** | rebound 0, sideways 0.01 / 0.47, spin 4 / 8 rad/s for <0.1 s | rebound 13.5 / 27, sideways 12.7 / 25.6, spin 70 / 139, flips at 300 | metres FAIL, 0.08 PASS, studs FAIL |
| B3 free fall 0.5/1/1.5 s | 612.7 / 1225.9 / 1839.0 | 613.1 / 1226.2 / 1839.2 | **clamped at 200** with the default limit; 613/1226/1839 when raised | PASS (limit is settable) |
| B4a box on 32-gon top, 7 spots | sink −2.4e-5, tilt 9e-4 everywhere, none fell | same | tilt 1.7e-3 | PASS (contact count not exposed) |
| B4b 16/32-gon on end | sink ≤ 5.5e-6, tilt 1e-4 | same | same | PASS |
| B5a wheel r1, gentle 1 stud/s roll | **stops dead in 0.04 s** (also stops at 10 studs/s) | stops at 1, keeps 99.3 % at 10 | keeps 99.3 %, no speed-up | metres FAIL, studs PASS |
| B5a self-acceleration | none at any scale | none | none | PASS |
| B5b roll 100 studs/s, 2 s | 99.2 % kept, sink 0.007 | 99.2 %, 0.007 | 98.5 %, 0.049 | PASS |
| B5c wheel r2.5 on loose beam | sink 0.0019, stays | 0.0016, stays | 0.0019, stays | PASS |
| B6a pendulum, 10 s | **−92 %** of m·g·L, sep 5e-5 | −85 % | −84 % | FAIL |
| B6a at 4 / 16 / 64 steps per 1/480 | −49 % / −21 % / −12 % | | | FAIL at any affordable cost |
| B6b triple pendulum, 10 s | **−74 %** of Σm·g·depth, sep 0.0095 | −72 % | −72 % | FAIL |
| B6b at 16 steps per 1/480 | −34 %, sep 1e-4, 47 ms/s | | | FAIL |
| B7 non-principal spin, 30 s | KE +2.6e-7 %/s, \|L\| −2.8e-7 %/s | ~same | ~same | PASS (no spin gain) |
| B8 gears (re-anchored LINEAR_X lock; no native gear) | KE/W 1.005; ω2/ω1 = −0.40000; coast at 100 −0.006 % per 2 s, at 300 +3e-4 %/s; phase drift 0.2 teeth in 7.7 s; 19 ms/s | KE/W 1.002 | KE/W 1.004 | PASS (needs f64 phase feedback as in knap) |
| B9 hinge extras | see below | | | mostly yes |
| B10 triple pendulum + 20 cubes | 10.2 ms CPU per real s | 37 ms/s | 33.5 ms/s | PASS (budget about 480 ms/s) |

B9 (raw API, measured on the B6a pendulum at U 1; metres in brackets where they differ):
- Joint friction: `HP_Constraint_SetAxisFriction`. At 1.2·m·g·L it holds, creeping 0.0017 studs in 10 s; at 0.8 it slips.
- Motor with max torque: `SetAxisMotorType(VELOCITY)`, `SetAxisMotorTarget`, `SetAxisMotorMaxForce`. At U 1 it reaches the target at the requested acceleration. At metres the acceleration was 7.5× too low (unexplained).
- Angle limits: `SetAxisMode(LIMITED)` plus `Min/MaxLimit`. ±0.5 held to −0.506.
- One-way limit: no ratchet. A one-sided limit with max = 1e9 did not hold: it reached −3.09, against a min of −0.5.
- Reaction: `HP_Constraint_GetAppliedImpulses` gives 0.997·m·g·dt on a hanging pendulum.
- Gear constraint: none. No user-constraint hook.

Other measured facts:
- Runs are bit-identical when repeated in the same process.
- Positions are f32 internally: 1000.1 reads back as 1000.0999755859375.
- `SetAxisStiffness` / `SetAxisDamping` on locked axes, `SetIdealStepTime(0)` and density ×1000 change neither the pendulum loss nor the B2 / B5a scale effects. `SetIdealStepTime(1/60)`, Havok's default, makes the pendulum lose 100 % in 6 s.

## Verdict

Havok is good on contacts and the free-body integrator: no 4-vertex face limit, no rolling runaway,
no spin gain, a native cylinder. But its hinges lose energy far faster than Rapier at knap's step
(−72 % against −3.7 % for Rapier at 240 substeps), and it fails for mm-sized parts in true SI. It
therefore does not replace Rapier for knap's mechanisms. The engine is closed source: the WASM is
MIT-licensed, but no fix or fork is possible.
