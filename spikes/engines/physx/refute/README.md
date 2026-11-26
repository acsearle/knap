# Refutation pass on the PhysX (physx-js-webidl 2.9.1) battery report

Uses the packages already installed in `../node_modules`; nothing new installed. `px.mjs` is an independent loader
(SI units: m, kg, s; PxTolerancesScale length 0.008, speed 9.81) that does not use `../lib.mjs`.

```
cd spikes/engines/physx/refute
node artic.mjs [pgs|pos1|pos32|vel0|vel4|sub4|dt60|noroot|cfm0|extf|noq|unwrapped]   # articulation pendulum, peak heights
node cyl.mjs [floor=box|plane|trimesh|box10|box500] [nopcm] [co=0.1] [margin=0.05] [pos=32]  # convex-core cylinder B5a
node hullwheel.mjs     # polygon wheel vs inelastic rolling-n-gon theory (planeTolerance scaled)
node cookcheck.mjs; PXU=m node cookcheck.mjs   # convex cooking in stud vs SI units (uses ../lib.mjs on purpose)
node gear.mjs 100 30   # PxGearJoint, 30 s coast; phase error from velocities AND from body poses  (args: W coast gyro sub)
node joints.mjs        # B6b revolute chain at 4/32 iterations; B9 drive-as-friction variants, D6 drive
```

## Results

| claim | verdict | what I ran / found |
|---|---|---|
| All original scripts reproduce | CONFIRMED | b1, b4, b5 core, b5box, b6 joint/artic, b7, b8 100/300, b9, b10, det: same numbers to the printed digits |
| B8 gear: phase error <= 0.05 teeth | REFUTED for long runs | gear.mjs: body-pose phase error at 100 rad/s random-walks to 1.03 teeth in 30 s (6.5 teeth at dt 1/1920); 0.02 at 300 rad/s. Velocity ratio is exact (velocity-integrated error 1e-4 teeth). Source: ExtGearJoint keeps `mVirtualAngle0/1` as float sums, same f32 accumulator problem knap fixed with f64 phase |
| Units make no difference | WEAKENED | convex cooking `PxCookingParams.planeTolerance` = 0.0007 absolute: in SI the 32- and 64-gon prisms cook to 16 vertices / 10 polygons (octagons) vs 64/34 and 128/66 in studs. Must be scaled by hand. B4/hull tests were never rerun in m |
| Articulation gains energy, maybe set-up | CONFIRMED (independent) | artic.mjs: single pendulum peaks climb ~0.1 stud per swing until it loops (+124 %). Not fixed by root shape, cfm 0, joint frame, vel iters, external-forces-every-iteration, unwrapped type. TGS with 1 position iteration = PGS (-0.64 %). Gain grows with dt (+300 % in 2 s at 1/60) |
| Native cylinder fails on boxes | CONFIRMED (independent) | cyl.mjs: 1 -> 1.47 studs/s on 40-box; PCM off, contact offset 0.1, pos 32 no cure (pos 32 stops it instead); trimesh floor: rest -> 0.79 studs/s; 500 box: falls through; margin 0.05: decelerates to 0.3-0.4 |
| Hull wheel 9-12 % kept / cannot roll slowly = PhysX defect | WEAKENED | mostly the physics of an inelastic 64-gon: theory 13.3 % kept, cannot tip over a facet at 1 stud/s. But a 127-gon (254 verts, under the 255 limit) also stops at 1 stud/s where theory says it should keep 97 %: that part is the engine |
| B6b PASS at 32 iters | CONFIRMED | -0.48 % in 10 s, links still reach release height; cheap |
| B9 drive creeps 0.24 rad/s | CONFIRMED, fix partial | POS 32 cuts creep to 0.01 rad/s; force limit still behaves as impulse per step (0.8x holds like 1.2x); D6 damping drive is worse |
| Facts: npm 2.9.1 2026-10-24, 2,617/wk, MIT; PhysX BSD-3 | CONFIRMED | registry + api.npmjs.org; LICENSE.md in NVIDIA-Omniverse/PhysX. Public SDK latest is 5.9.1; "PhysX 5.12" is mentioned in ovphysx 0.7.0 release notes |
