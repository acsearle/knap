# cylhull/refute: trying to break the cylhull result

Rapier JS 0.21.0 (`@dimforge/rapier3d-compat`), native API only. Run everything from the repo root.
Each script ends with `process.exit(0)`.

## Scripts

| script | what it does |
|---|---|
| `selfroll.mjs [cfg] [r] [T] [x0]` | Native cylinder (axis Z, hl 0.46 or env `HL`) placed touching a WIDE cuboid (100 x 100), so it cannot fall off. Prints dx, wz, and y-r over time. cfg: `knap`, `si` (all Rapier defaults), `g981_dt480`, `si_dt480`, `si_equiv` |
| `si_long.mjs [T] [si\|g981] [floors] [body]` | The original agent's own `lib.run` and interior positions (as in `matrix.mjs`), run for longer than 3 s |
| `onehole.mjs [r] [n] [ccd] [x0] [every] [T] [g] [dtInv]` | Native replica of `spikes/wheels/out/diag2.mjs cyl r n 2` for any n, printing x. `DEFAULTS=1` keeps Rapier's default iterations and CCD substeps |
| `hullcap.mjs [g] [dtInv] [T] [r] [iters]` | Unbevelled n-gon prism hull (n = 3 to 64) lying on its cap on a WIDE cuboid. Prints points per step and sink |
| `yawcap.mjs [knap\|si] [r] [T]` | hull32 (unbevelled) on its cap on the original's narrow cuboid (0.92 wide) or a wide one, turned about Y |

## Results

| claim (original) | my run | verdict |
|---|---|---|
| Fall-through not reproduced; the cylinder rolls off the end first | `endcase.mjs 1 2 1 0 1 0,1,2,3,7,12,13,14` and `spikes/wheels/out/diag2.mjs cyl 1 15 2` agree to 4 decimals (-182.7594, -90.4187). In `onehole.mjs 1 1 1 0 24 1` the 1-hole-on-edge case (diag2 n=1: -44.0798) also reproduces exactly: x reaches -1.12 while still in contact (step 360), and the pair is lost only after that | CONFIRMED (now also for the 1-hole case) |
| Self-rolling is SCALE (gravity) | `selfroll.mjs si 1 34`, all Rapier defaults on a wide cuboid: dx -22.9 m in 34 s, wz 1.05 rad/s, \|dx\| > 0.05 r after 2.68 s. With HL=1, r=1: dx 19.5 m in 30 s. `si_long.mjs 34 si`: **0/112 stay** (their 3 s run gave 112/112). `si_long.mjs 34 g981 cuboid,armFlat`: 0/56. `DEFAULTS=1 onehole.mjs 1 15 0 7 300 34 9.81 60`: the project's own floor at SI defaults; the cylinder rolls off the beam end and falls by about 20 s. Controls at SI 34 s: hull32, ball, and cuboid stay 56/56; roundcyl 2/56 | **REFUTED**. It is a DEFECT: it happens at SI defaults. The 3 s window was too short, because at g 9.81 the motion is about 11x slower |
| A hull on a >4-vertex face gets 1 point per step and sinks through | `hullcap.mjs`: on a wide floor, unbevelled n = 5 to 64 prisms get 5 points per step and stay (knap: sink 0.011 to 0.038). `yawcap.mjs knap 1`: on the narrow floor, yaw 0, 45, 90, 180 and 270 give 1 point and THROUGH; yaw -22.5 and 157.5 give 5 to 6 points and STAYED | DESIGN LIMIT holds (TODO at convex_polyhedron.rs:960). The "1 point" holds only when the kept 4-vertex sliver lies off the other shape's face |
| Empty manifold 1 to 2 steps at SI | `miss.mjs` SI cuboid case reproduces: step 120, localNormal1 [1,0,0], query -0.0014, fresh manifold 4 points. The body centre is at x -0.796, past the floor end | CONFIRMED |
| Soft CCD: no pair at step 1 | `miss.mjs` knap and SI reproduce: found:false, -0.0027 and -0.0017 | CONFIRMED |
