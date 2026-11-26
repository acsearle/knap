# review-m7 — verification sweeps of the post-review fixes (reviewer "verify-sim")

The quick checks are in `tests/review/m7-sim.review.test.ts` (part of `npm test`, about 7 s).
The files here are the heavier sweeps behind its numbers. They have their own vitest config and
never run in `npm test`:

    npx vitest run --config spikes/review-m7/vitest.config.ts <name>

Each sweep appends its results to `<name>.log` in `$VERIFY_SIM_LOG`. The default is the
reviewer's scratchpad (see `lib.ts`), so set `VERIFY_SIM_LOG=/some/dir` to keep the logs.
Wall-clock times are for a shared, heavily loaded machine (load average 70–117).

| file | item | what it does | time |
|---|---|---|---|
| `far.test.ts` | 1 | A lone r 1.5 wheel at x/z = 0, 100, 1000 and 5000, or with the floor's pivot that far away, on 0/5/15° floors: drift at rest, rolling distance against ½·a·t², and run-twice determinism. The Cart moved by (D, 0, D): its trajectory against the Cart at the origin. | ~10 min |
| `farroll.test.ts` | 1 | A wheel rolled 1000–5000 units (does its speed change?). The pivot 100/300/1000 away over 30 s. An armless Cart pushed away (does it rest?). The Cart at x + 0/1000/5000/20000 (f32 stall). | ~5 min |
| `floor.test.ts` + `floorlib.ts` | 2 | 16 models (pins, axles, beams, wheels in every orientation, mixed, Cart), each at 0/5/15°: the gap between the physics plane and the lowest ground-touching collider, the view floor against the sim plane, and KE and displacement in the first 0.05 s. | ~1 min |
| `bridges.test.ts` + `meshcheck.ts` | 3 | 672 single-crank solids (hub kind × r 1…4 × axis × edge positions × 8 crank kinds/axes) and 36 multi-cell solids: shells, closed manifold, volume bounds, vertices outside own cubes ∪ drawn rims, mid-plane samples outside the nominal disc or inside a free cell's 0.06 gap, bores open (ray-parity point-in-mesh). | ~6 min |
| `webclash.test.ts` | 3 | The parts of a crank web beyond the nominal disc, tested against every legal parallel wheel of another part nearby (r 1…4, integer centres). | ~2 min |
| `quick-male.test.ts` | 3 | The male-crank floating rod, 10 cases. | <1 s |
| `segcost.test.ts` + `oldseg/` | 4 | Triangles and build time per wheel r 1…4, for the Cart and for the Crank wheel, at the new rim segments vs the old ones (48 below r 2, 64 from r 2). `oldseg/geometry` is a copy of HEAD's `src/geometry` with only `rimSegments` changed. Pairs are interleaved and the median is taken. | ~15 s |
| `kfuzz.test.ts`, `kstats.test.ts`, `kgen.ts`, `kbrute.ts`, `m6/` | 5 | 20 000 random models × ground × fixRoot. Every fixed-root variant is compared with milestone 6's `analyze` (`m6/` = `git show 8b3a791:src/{core,geometry,physics}`). Pin/beam models are also compared with an independent brute-force §3.1. `kstats` measures how often the generator exercises the changed branch. | ~10 s |
| `limits.test.ts` + `depthlib.ts` | 6 | Lying wheel across a beam (r 1.5/2.5/4 × offset 0/1/2 × loose/fixed). The free 4-bar's creep over 10–40 s. An armless Cart driven at 10–120 u/s over a beam (across, along, on edge). A Cart parked with one wheel on a beam. 80 flat drops onto a loose beam. | ~25 min |
| `upright.test.ts` | 6 | An upright wheel resting on a beam: fixed beam, with and without a ground, and a loose beam on the floor. | ~1 min |

Node 20.11. The Rapier sweeps exit normally under vitest, so they need no `process.exit`.
