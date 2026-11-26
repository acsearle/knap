# refute: havok-and-js

These are independent checks of the Havok report in `../README.md`. Each script loads `@babylonjs/havok` 1.3.14 from `../node_modules` and calls the raw `HP_*` API directly, without `../hv.mjs`. Nothing new was installed. Every run uses Node 20.11 and steps at 1/480 s unless a row says otherwise.

| script | what it checks |
|---|---|
| `node pend2.mjs [U]` | B6a energy and the peak height of each swing; ball joint versus hinge; which axis is left free |
| `node spin.mjs [U]` | zero-g hinged beam spinning at 5 rad/s, tried against every constraint setting in the d.ts |
| `node triple.mjs U N sub...` | B6a/B6b swept over 1 to 240 Havok steps per 1/480 s, with CPU cost |
| `node slow.mjs [U...]` | SI yaw self-spin (box versus hull); slow roll, slow roll of a sphere, frictionless slide |
| `node deadband.mjs` | the low-speed cutoff in internal units, for contacts and for joints |
| `node drop.mjs` | B2 flat drop with a box versus a hull cube at each scale, and with substeps |

## Results

These are the measured numbers from the runs above. The internal unit is U per stud, so U = 0.008 is metres.

- **B6b, the triple pendulum:** energy change after 10 s at U 0.008 was −73.6 / −34.4 / −12.2 / −7.7 / −5.6 % at 1 / 16 / 64 / 128 / 240 steps per 1/480 s. The cost was 0.048 / 0.093 / 0.35 / 0.71 / 1.35 ms of CPU per 1/480 s step. At U 1 with 240 steps the loss was −4.0 %, against Rapier's −3.7 % at 240 substeps.
- **B6a, the single pendulum:** at U 1 the loss was −84.5 / −3.8 / −2.1 % at 1 / 64 / 240 steps. At U 0.008 it was −92.4 / −12.3 / −10.7 %, so it stops improving with more steps. A ball joint loses exactly as much as the hinge does, which points to the point constraint. No axis stiffness, damping or LIMITED setting removes the loss.
- **Zero-g hinged beam, 5 rad/s about a pivot 3 studs off the centre of mass:** |w| fell to 4.61 in 10 s. With the pivot at the centre of mass it stayed at 5.000. The loss comes from the centripetal load on the joint, so gears hinged at their centres are unaffected.
- **Low-speed cutoff:** any body in contact or in a joint that moves at 0.1 internal units/s or less comes to rest within about 0.04 s. A body at 0.2 units/s keeps moving. This held at every scale, at mu 0, and with every ideal-step-time and activation setting I tried.
- **B2, flat drop:** Havok's box primitive scaled to 0.008 or 0.08 behaves differently from a convex hull of the same cube. The hull cube bounces about 13.6 studs/s up and gets thrown about 12.8 studs/s sideways at 150 studs/s, and it does this at every scale. The box primitive at U 1 does the same. With 4 steps per 1/480 s at U 1, the rebound drops to 1.2 and the sideways speed to 1.0.
- **SI yaw self-spin:** a box primitive at U 0.008 spins up to 15.3 rad/s. A hull cube at the same scale reaches only 0.02 rad/s.
