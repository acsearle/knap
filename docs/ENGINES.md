# Physics engines: Rapier rescaled, and the alternatives

Written 2026-11-27. Two questions from the owner: would Rapier behave better in other units, and
what else could knap run on, including native engines that would need a browser port.

Everything marked *measured* was run in Node on this machine against one battery of scenes,
[`spikes/engines/BATTERY.md`](../spikes/engines/BATTERY.md), reported in real units (studs, real
seconds). Each engine has a directory under `spikes/engines/` with its scripts and a README; each
hands-on trial was re-run by a second agent whose corrections are in `<engine>/refute/README.md`
and are already folded in below. The native engines in the last section were surveyed from
documentation only. To re-run a trial, `npm install` inside its directory first.

## 1. Rapier in other units

**How deep a part sinks at rest is the contact spring sagging: depth = g / (2πf)²,** where f is
Rapier's contact frequency (60 Hz against fixed bodies, 30 Hz between moving ones) and g is
gravity in whatever units the simulation uses. Measured depths match this to two digits in every
regime. With g = 1226.25 studs/s² that is 0.0086 studs on the floor and 0.035 between moving
parts. Size and mass do not enter.

| Regime | What changes (measured) |
|---|---|
| **True SI** (0.008 m per stud, real masses, g 9.81, Rapier's length tolerances scaled by 0.008) | Nothing. It is the same computation as today with every length scaled: power-of-two scalings reproduce today's results bit for bit. The small differences at 0.008 are float32 rounding and one absolute tolerance inside parry. |
| **Naive SI** (same, tolerances not scaled) | Worse: impacts bounce, a triple pendulum loses 17.6 % through speculative contacts. |
| **Mass ×1000 or ÷1000** | Nothing. |
| **Time-scaled** (a stud is Rapier's "metre", simulated time runs 11.18× faster so g = 9.81; same 480 steps per real second, same iterations) | Contacts 125× stiffer at no CPU cost. Floor sink 0.0086 → 6.8e-5. Cube on a loose beam 0.036 → 2.8e-4. A stack of five cubes that collapses within 0.3 s stands. A wheel on a loose beam sinks 0.003 instead of 0.11. The linear speed clamp becomes 4472 studs/s, so free fall reaches its true speed. |
| **Time-scaled at Rapier's own defaults** (1/60 s, 4 iterations) | Joints fall apart (triple pendulum −60 %). Needs the 240 substeps anyway. |

**The same gain is available without time scaling, with setters the JS build already has**
(found by the refuter, re-measured in `spikes/engines/supervisor-check.mjs`):

- `contact_natural_frequency = 671` (or 335);
- world-anchored bodies created as `kinematicPositionBased` instead of `fixed`, because Rapier
  applies its unexposed, softer "static" setting only to fixed bodies;
- `lengthUnit = 11.18` with the two exposed length tolerances divided by 11.18, which lifts the
  speed clamp and leaves the tolerances where they are.

Measured: floor sink 6.8e-5, cube on loose beam 6.9e-5, free fall 1840 studs/s at 1.5 s (true
value 1839). Known cost: a 300 studs/s impact on the kinematic floor penetrates 0.123 studs
instead of 0.007. Not yet tested: joints to a kinematic ground under load, restitution, soft CCD,
the friction motors and the energy guard.

**What no choice of units changes** (identical to three digits in every regime): the
self-accelerating rolling cylinder, the four-vertex face, the 377 rad/s angular clamp, joint
energy drift, the float32 spin gain, and the absence of a gear constraint.

Either route changes every recorded trajectory, so adopting it means re-baselining the tests.

## 2. Engines with a browser build, tried on the same battery

| | Rapier 0.21 (today) | Jolt 1.1.2 | PhysX 5 (physx-js-webidl 2.9.1) | MuJoCo 4.0.1 | Bullet (ammojs3 0.0.11) | Havok 1.3.14 |
|---|---|---|---|---|---|---|
| Box on a many-sided face | falls through | rests, 4 points | rests, 4 points | rests, 4 points | needs hull-vs-hull with SAT on | rests |
| Slow-rolling cylinder on a box | speeds up by itself | speeds up by itself by default; fixed by a documented switch (+29 % cost) | speeds up, or falls through a large box | constant speed | speeds up by itself | constant, but any body slower than 0.1 unit/s is stopped dead |
| Triple pendulum, energy after 10 s at 1/480 s | −3.7 % to +1.3 % with 240 substeps | −71 %; 64 full substeps still −16 % | −0.54 % at 32 iterations, 0.19 ms/step | −0.25 % with RK4 (−92 % with the default integrators) | −35 % rigid; −0.19 % as a Featherstone tree with RK4 | about −4 % at 240 full steps (over budget) |
| Free spin about a non-principal axis | gains 0.2–1.4 %/s | loses 0.1 %/s | correct once the gyroscopic term is switched on | 1e-7 %/s with RK4 | wrong in every mode (−43 % in 10 s) | 3e-7 %/s |
| Gears | none (our re-anchored joint row) | velocity exact; position correction jumps 8 teeth for non-integer ratios | ratio exact; phase drifts 1 tooth in 30 s (float32 accumulator) | joint equality: 0.002 teeth, energy exact, fine at 300 rad/s | exact, but both gears must be in one tree | none (our trick ports) |
| Joint friction / motor with torque limit / limits / reaction force | none / raw API / raw API / none | all yes | no friction on revolutes; rest yes | all yes (friction needs the noslip solver) | yes on the tree path | all yes |
| Numbers | f32 | f32 (f64 needs own build) | f32 | **f64** | f32 | f32 |
| Deterministic re-runs | yes | yes | yes | yes | yes | not checked |
| Impacts | sideways kick at 300 studs/s | clean | within 0.002 studs | soft: 0.07–0.44 studs deep | sideways kick, spin | bounce and kick unless sub-stepped |
| Licence, source | Apache-2.0, open | MIT, open | BSD-3 + MIT bindings, open | Apache-2.0, open | zlib, open | binary only (closed) |
| Maintained | yes, fast-moving | yes, by the engine's author | yes (community bindings) | yes, by Google DeepMind, official npm package | engine last released 2022; JS builds are stale community ports | yes |
| wasm size | about 3.2 MB (4.3 MB as shipped, embedded in the JS) | 2.0 MB | 5.4 MB + 4.8 MB JS (web-only debug build) | 11.2 MB (2.8 MB gzipped) | 1.2 MB | 2.1 MB |

Things the table hides:

- **The rolling-cylinder defect is not Rapier's alone.** Rapier, Jolt (by default), PhysX and
  Bullet all show it; in Rapier and Jolt the cause is the same, a cache that reuses the previous
  step's contact points. These engines are tuned for games, where sleeping is on and hides it.
  Only MuJoCo and Havok were clean.
- **Jolt** has the best contacts of the game engines once its body-pair cache is off, and a rich
  constraint API, but its joints lose energy far faster than Rapier's and its substeps re-run
  collision detection, so they cannot be bought back cheaply.
- **PhysX** has good joints and polygon contacts, but wheels on parts are not solved (the native
  cylinder misbehaves on anything but a plane; a 127-sided polygon wheel stops at 1 stud/s), and
  its reduced-coordinate articulations gained energy (+124 % on one pendulum) with the default
  solver.
- **MuJoCo** is a different kind of engine: joints are coordinates, not constraints, so hinges
  cannot separate and gears are an exact coupling of two angles. Its weak points are different
  too. Contacts are soft by design. A closed loop such as a four-bar has to be cut and re-closed
  with a soft constraint, which lost 4–19 % of the energy in 10 s and left a 0.03–0.05 stud gap
  at 1/480 s (−0.22 % at a smaller step, 25 ms per simulated second). Friction creeps unless the
  noslip solver is on. There is no one-way joint. The JS bindings call themselves a work in
  progress. Rebuilding a 20-body model takes 2–11 ms, so recompiling on every Play is fine. Cost
  for a triple pendulum plus a 20-cube pile: 0.11–0.39 ms per 1/480 s step, about 1 ms with RK4
  and noslip.
- **Bullet** has an excellent Featherstone gear constraint, but the engine is effectively
  unmaintained and the only JS build exposing it has lost its repository.
- **Havok** cannot be patched, has the 0.1 unit/s stop, and each of its substeps is a full step.
- **Dismissed after a short look:** cannon-es (unmaintained since 2022; pendulum −72 %),
  oimophysics (no release since 2024), Avian (tied to Bevy, uses parry), Bepu (no web build),
  WebGPU engines (experimental). **Worth a later look:** Box3D (MIT, C, alpha since June 2026, has
  a wasm build; no cylinder shape or gear joint yet).

## 3. Native engines that would need a port (documentation survey, nothing run)

Full notes: [`spikes/engines/native-ports/README.md`](../spikes/engines/native-ports/README.md).

1. **Project Chrono** is the strongest. BSD-3, f64, active (10.0.0 in March 2026); gear,
   rack-and-pinion and pulley links, motors, joint limits, hard (complementarity) and penalty
   contact; an official "build Chrono for WASM" tutorial; the core needs only Eigen. Unknown:
   joint friction, cylinder and hull contact quality, wasm size, and whether its default stepper
   loses energy on a triple pendulum.
2. **Writing our own joint-space solver** fits knap's gears better than any engine, because the
   project already computes the mechanism graph (`src/core/kinematics.ts`, `gears.ts`) and a gear
   mesh is a linear relation between two hinge angles that can be eliminated exactly. Estimate:
   3–5 person-weeks without contact, 2.5–5 months with it. Contact is the cost and the risk.
   MuJoCo is the closest existing implementation of this design.
3. ODE has a transmission joint and is an easy C port, but is old and thinly maintained.
4. Not recommended: Drake (huge build), DART and Simbody (heavy dependencies, weak contact),
   Newton Dynamics 4 (one author, little documentation), Bepu (needs the .NET runtime in wasm).

## 4. Reading

- Rapier is not unusually bad. Every engine tried here failed something a person building toy
  mechanisms would notice; they fail different things.
- For what knap is (mechanisms: hinges, gears, friction, and soon motors), the engines built for
  mechanisms are a better match than the engines built for games. Of the ones that run in a
  browser today, that is MuJoCo. Its open questions for knap are closed loops, soft impacts and
  pins in holes; none was tested on a real knap model.
- Staying on Rapier, the stiffer-contact recipe in §1 is the one cheap improvement found.
