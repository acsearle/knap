# refute:mujoco — adversarial re-check of the MuJoCo spike

Uses the packages already in `../node_modules` (`@mujoco/mujoco@4.0.1`); nothing new installed.
Independent scripts here do not import `../lib.mjs`.

```sh
cd spikes/engines/mujoco/refute
node r_contacts.mjs      # B4a (box on 32-gon mesh top, yawed box, rotated prism), B5a/B5b (wheel at a 0.6 rad heading, slip, speed), B2 + overdamped solref
node r_joints.mjs        # B6a/B6b with an energy computed from qpos/qvel only; B8 gears incl. a load torque
node r_cost_mesh.mjs     # 40-body pile, box primitives vs convex meshes (16-gon prisms, stadium beam hulls)
node r_yawspin.mjs       # the "unexplained fall-through" (b5_yawspin.mjs) with x,y logged
node r_cylbox_static.mjs [deep]   # static cylinder-on-box/plane contact counts
node r_flags.mjs         # default disable/enable flags in 4.0.1
```
Raw outputs are in `out/`. All original scripts were re-run (`out/b*.txt`); timings in the first
run were taken with 12 scripts in parallel and are not valid — `out/b10_alone.txt` and
`out/b9_noslip_alone.txt` are the single-process reruns.

## Result

| claim | verdict | evidence |
|---|---|---|
| B1a/b/c numbers, mass-independence, lam=125 identity | CONFIRMED | b1_rest.mjs rerun gives identical digits |
| B4a 4 contacts, no fall, 7 spots (multiccd on) | CONFIRMED | r_contacts.mjs: also with yawed box and rotated prism, out to r=0.40: sink 2.13e-3, 4 contacts |
| B4a fails with multiccd off | CONFIRMED | b4_prisms.mjs rerun |
| B5 no self-acceleration, speed kept 99.928 / 99.986 % | CONFIRMED | r_contacts.mjs at heading 0.6 rad on box and plane; steady speed flat to 6 digits; the 0.07 % loss is the initial settling into the soft contact |
| B2 default falls through, tuned 0.1–0.6 deep, rebound 6–16 % | CONFIRMED, but rebound is fixable | solref `0.005 2` → rebound 1–4 %, `0.005 4` → 0.3–1.1 %, at the cost of static sink 1.6e-3 / 4.9e-3 studs |
| B6b Euler/implicitfast −92 %, RK4 −0.245 % | CONFIRMED with own energy | r_joints.mjs: own planar energy −92.04 % / −0.245 %; Euler is +19 % at 1 s, then decays |
| B6a "energy conserved" is not damping | CONFIRMED | single pendulum COM reaches release height (+4.5e-4 studs Euler, −3e-7 RK4) in the last 2 s |
| B8 ratio error 1.28e-2 / 8.4e-4 rad, K/W 0.9998 / 0.99999 | CONFIRMED | r_joints.mjs; with a load torque on the big wheel: 1.38e-2 / 8.9e-4 rad, K/W 0.99974 / 0.99998 |
| B10 54–185 ms per sim s | CONFIRMED (alone: 56–58 / 72–74 / 176–181 / 113 / 509–538) | out/b10_alone.txt |
| Convex-mesh cost | NEW | 40-body pile: meshes 203–209 ms/sim s (422–435 µs/step) vs boxes 112–132 |
| "Unexplained fall-through" of the spinning wheel | REFUTED as a defect | the wheel slid off the side of the 40-stud-wide box floor (y = −21.7 when it dropped, floor spans ±20); static probes find contacts at every tilt/depth |
| libccd (nativeccd off) | NEW | the same spinning wheel was launched to z = 817 studs |
| multiccd/nativeccd on and sleep off by default; Apache-2.0; 4.0.1 on 2026-11-11; 50,203/week; 23.9 MB; wasm 11,201,302 B; mjSpec bound, no mj_recompile; README "still a WIP" | CONFIRMED | r_flags.mjs, package files, npm registry |
| API awkwardness | NEW | `mj_mulM(m, d, out, vec)` with a JS Float64Array as `out` leaves it zero (output not written back) |
