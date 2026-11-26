# cylbox/refute: trying to break the cylbox result

Standalone pure-Rapier scripts (`@dimforge/rapier3d-compat` 0.21.0). They do not import `../lib.mjs`.
Run them from the repo root with `node spikes/rapier-limits/cylbox/refute/<script>.mjs`. Each takes under 5 s.

| script | what it does |
|---|---|
| `shuttle.mjs` | One-switch test of the try_update cause. Each step it teleports the fixed floor ±d along the cylinder's axis. d = 0.1 is above parry's 1e-3 reuse threshold, so it forces a full manifold recompute every step. The control, d = 0.0003, is below it. Rapier recycling is off in every arm. The manifold, GJK warm start and solver warm start are all kept. |
| `sibox.mjs` | Rapier's true defaults (SI, sleeping on) on boxes of ordinary size (1.5–20 m), plus 200 m and a HalfSpace. |
| `diag3port.mjs` | Pure-Rapier port of `spikes/wheels/diag3.ts`, the set-up that reported tunnelling. Friction 0.4, restitution 0.1, axis along Z, 30×1×50 box at x = 10. |
| `uprightbeam.mjs` | "Upright" in the project's sense: a wheel standing on its rim on a beam (cuboid or hull). `../upright.mjs` tested it lying on its cap. |

## Results

| claim of the cylbox agent | verdict | evidence |
|---|---|---|
| The SI defaults run away: 0.05 → 0.52 m/s on a 200 m box; HalfSpace holds 0.0500 | CONFIRMED | `../sisleep.mjs` re-run: identical numbers. It also happens on ordinary boxes (`sibox`, sleeping on): 5 m box 0.05 → 0.513 m/s at 12 s; 20 m box 0.05 → 0.524 m/s. A 1.5 m box with v0 0.05 stops (it falls asleep). |
| Plateau v* = r·(π/180)/dt | CONFIRMED (approx.) | `../terminal.mjs` re-run: identical. `diag3port`: r1 8.39, r1.5 12.56 (v* 8.38, 12.57). The 10 m box overshoots to 0.78 m/s (v* 0.524). |
| Cause: stale points via try_update_contacts_eps | CONFIRMED, now SHOWN by a clean switch | `shuttle`, knap r1, 200 box, from rest, 5 s: d 0 → 8.83, d 0.0003 → 8.82, d 0.1 → 0.48 units/s. With v0 1 at 3 s: 8.64 / 8.74 / 1.91. Capsule: 8.39 / 8.41 / 0.008. SI 200 m, v0 0.05, 20 s: 0.519 / 0.519 / 0.054 m/s. |
| "No setting reachable from JS fixes it" | WEAKENED | No setting does. The shuttle trick, though, does it from JS, with a residual: knap from rest still reaches 0.48–1.0 units/s. |
| Tunnelling: NOT REPRODUCED | CONFIRMED | `diag3port`, 24 runs: the minimum (y − r) while over the box is −0.0243. Every drop is past an edge, at x ≈ −20.6…−21.6 or +41.1…41.5. |
| Upright runaway: NOT REPRODUCED | REFUTED (wrong pose tested) | `uprightbeam`, wheel standing on its rim on a 3.5/7.5-long beam: r1 cuboid reaches −13.35 units/s at 2 s and leaves the beam end at 1.61 s. On a hull beam it leaves at 1.45 s. 9 of 24 runs roll off the beam end within 2 s. |
| GJK tilt grows with box size | CONFIRMED, with one omission | `../gjkband.mjs`: 87.5° (200), 89.8° (2000). The listed 0.86° (1.5) / 0.61° (20) skip the 5 box, which gives 6.23°. |
| Flush-cap horizontal normal | CONFIRMED | `../capband.mjs`: (0.1303, 0, −0.9915) on the beam at depth 0, and (0.7071, 0, 0.7071) on the 2000 box. |

Not tested here:
- Cylinders against liftarm hulls (needs project code).
- The capsule at SI.
- Prisms.
- f64 builds.
- A patched parry.
- The residual drift after the shuttle switch. It is probably the GJK witness-offset lever, but that is not settled.
