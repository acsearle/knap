# Refutation pass on the Jolt battery (spikes/engines/jolt)

Uses the packages already in `../node_modules` (jolt-physics 1.1.2, single-thread WASM). Nothing installed.
`jinit.mjs`, `pendulum.mjs`, `roll.mjs`, `gear.mjs` are independent of `../lib.mjs`; `long.mjs`, `creep.mjs`,
`b5cfix.mjs`, `psteps.mjs` reuse `../lib.mjs` for longer runs. Run each with `node <file>` from this directory (each < 1 min).

| claim | verdict | evidence |
|---|---|---|
| headline numbers (B6a -73.9 %, B6b -70.7 %, B7, B8 pi snaps, contacts metre-nc) | reproduced | `node ../joints.mjs metre`, `node ../contacts.mjs metre-nc` (bit-identical to theirs) |
| B6a FAIL: hinged beam 7 loses ~74 % at 1/480 s | CONFIRMED | `pendulum.mjs`: swing peaks drop 5.6 % per half swing, 73.9 % after 10 s; damping read back 0/0; loss halves with each halving of dt (30720 Hz: 3.9 %, 222 ms/s); vsteps 1 = vsteps 10; psteps 0 makes it worse |
| B5a cache runaway | CONFIRMED | `roll.mjs`: real units cache on: 0.1/0.3/1/3 -> 16.8 studs/s (and wheel sinks 0.2 studs); metre cache on: 0.1 and 0.3 -> 0.48; cache off: held to 4 digits, 60 s runs within +-0.9 % |
| B5c PASS (metre-nc) | REFUTED | `long.mjs`, `creep.mjs`: the loose beam rests tilted 3.7e-6 rad and the wheel rolls down it at a constant 0.003 studs/s^2 (= 2/3 g sin tilt): moved 0.6 studs in 20 s, 1.36 in 30 s, off the end in ~50 s. `psteps.mjs`: slop 1e-4 + psteps 2 stops it; slop 1e-4 + psteps >= 4 rolls off within 20 s |
| B8 pi snap with SetConstraints | CONFIRMED | `gear.mjs`: phase jumps up to 1.13 rad in one step; source line verified (GearConstraint.cpp, fmod of hinge angles) |
| B8 16:32 with correction PASS | WEAKENED | phase 0.0002 teeth, but w1 100 -> 99.74 rad/s in 3 s (~0.17 %/s KE loss) |
| B8 no-correction PASS | CONFIRMED | 60 s: 0.0004 teeth at 100 rad/s, 0.0041 teeth at 300 rad/s |
| B1c PASS | CONFIRMED (marginal) | 20 s: tilt steady at 1.29 deg (metre) / 1.87 deg (metre-nc), no further lean |
| B10 cost, cache off +29 % | CONFIRMED | 50.0 vs 64.3 ms per real s |
| facts: MIT, 1.1.2 published 2026-11-21, 20,235 dl/week, 2.03 MB wasm, RackAndPinion/SixDOF/overrides/lambda exposed | CONFIRMED | `npm view`, api.npmjs.org, `ls`, runtime typeof checks |
