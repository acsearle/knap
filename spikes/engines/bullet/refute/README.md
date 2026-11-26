# refute:bullet

These are independent checks of the Bullet battery report. They use the packages already in `../node_modules` (ammojs3 0.0.11, ammojs-typed 1.1.0) and do not use `../lib.mjs`. Run every command from this directory.

| script | command | what it checks |
|---|---|---|
| r5.mjs | `for i in $(seq 0 47); do node r5.mjs $i; done` | B5a at Bullet's own scale (r 0.5 m, 1 kg, 1/60 s, sleeping off), with 8 knobs on a box floor and on a plane |
| r6.mjs | `node r6.mjs <1\|3> <hinge\|p2p\|erp0\|erp08\|erp09\|erp1\|it100> [div]` | B6 rigid hinges and the solver ERP |
| r6mb.mjs | `node r6mb.mjs <n> [div] [colliders] [gyro] [rk4]` | B6 on btMultiBody. Energy comes from the engine's link frames, and RK4 integration is tested |
| r7.mjs / r7t.mjs | `node r7.mjs rigid <0\|2\|4\|8>`, `node r7.mjs mb <0\|1>` | B7 free spin with each gyroscopic flag, and on a floating multibody |
| r8.mjs | `node r8.mjs [maxv\|-] [erp] [colliders] [target]` | B8 btMultiBodyGearConstraint |

## Results

| claim | verdict | evidence |
|---|---|---|
| A cylinder self-accelerates at Bullet's defaults | CONFIRMED | Box floor from rest: 0 -> 1.13 m/s in 20 s. Plane: 0.05 -> 0.92 m/s. None of these knobs fixes it: margin 0.001, contact processing threshold 0, gyroscopic flags 0, 50 iterations. Rolling friction 0.001 only hides it at low speed (a box roll from 1 m/s still speeds up to 1.65 m/s). With mu = 0 on the box, the cylinder spins up to 2.6 rad/s from rest, so the contact force does not act through the axis. 1/480 s and a 64-gon hull reduce the effect but do not remove it. |
| Rigid hinge at 1/480 loses 21 % / 88 %, and iterations do not help | CONFIRMED as run, WEAKENED as a verdict | Setting solverInfo.m_erp from 0.2 to 0.8 (no extra cost): single pendulum -2.3 % (1.0: -1.6 %), tip within 0.005 studs of the release height. Triple pendulum -35 % at 1/480, -5.0 % at 1/960, -1.2 % at 1/1920 (22 ms of CPU per real second). The agent needed 1/7680 s for -0.4 %. |
| btMultiBody triple pendulum loses 82 % (possibly a setup error) | CONFIRMED independently, and FIXED by an exposed API | My own energy measure gives -81.6 %, so the agent's setup was not the cause. `mb.useRK4Integration(true)`: -0.19 % at 1/480 s (15 ms of CPU per real second), and 0.00 % at 1/1920. |
| B7: every gyroscopic mode is wrong | CONFIRMED | Body frame aligned to the world: flag 8 E -58 %, \|L\| -75 % (most of it in the first 5 s). Flag 4: the same. Flag 2: E +60 % in 30 s. Flag 0: \|L\| is constant but L is off by 165 %. A floating btMultiBody gives NaN, or with RK4 E -53 %. |
| B8 gear PASS | CONFIRMED | Ratio -0.400000, error 3.1e-4 teeth (erp 0.2), 1.6e-4 teeth at 300 rad/s. KE / (tau·dq) = 0.9979 at 100 rad/s and 0.9993 at 300. The default cap pins the small wheel at 100 rad/s. Without colliders the big gear stays at 0. |
| The gear ERP reads m_bodyA for linkB | CONFIRMED on bullet3 master | It is harmless when both links are in one multibody. |
