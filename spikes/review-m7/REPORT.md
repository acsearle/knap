VERDICT: The fixes do what they claim, but three of them are incomplete and the known-limit numbers in DEVIATIONS understate the problem. Verified: ground-first, the floor at a male's free end on a flat floor, the hole-crank webs, and the free-root pin. Still wrong: (a) a crank pin or axle in a wheel part is drawn as a separate floating piece, because rimBridges bridges only holes; (b) wheels sink into a loose beam on the floor far beyond the documented envelope: up to 0.458 lying flat, and even upright wheels sink 0.03–0.165; (c) the floor-pivot drift is reduced but still there, growing with distance and time; (d) a horizontal male rod that is the lowest part starts 0.17 above the floor.

HOW: new test file tests/review/m7-sim.review.test.ts (13 tests, 7.3 s on the loaded machine; 8 pass, 5 FAILS ON PURPOSE) plus sweeps in spikes/review-m7/ (README there; logs went to the scratchpad /private/tmp/claude-501/-Users-antony-Desktop-knap-nosync/7e685b98-2385-4c25-8c1e-9d77a71d1d8f/scratchpad/verify-sim/). Load average 70–117 throughout, so wall-clock numbers are noise; only counts, depths and ratios are reported. `npm run typecheck` is clean. The full `npm test` was not run.

VERIFIED
- Item 5, kinematics. Compared against milestone 6's analyze, copied from 8b3a791 into spikes/review-m7/m6/. The seven old examples build and analyse bit-identically, checked by JSON of mates, bodies, joints and bodyOfPart. kfuzz: 20 000 random models × ground × fixRoot; all 60 000 fixed-root variants are identical to milestone 6. 40 000 pin/beam variants were also compared with an independent brute-force §3.1 (kbrute.ts): 0 disagreements. 28 % of the generated models have a lone smooth root pin with mates (kstats). Free-root invariants hold over 1500 models: no fixed body, no lone free pin survives, and the other parts partition exactly as they do with the root fixed.
- Item 2, flat floor. Measured with floorlib on 16 models (pins and axles standing, beams in three orientations, a pin poking below a beam, wheels about X, Y and Z, wheel with crank, mixed models, Cart). Every model whose lowest point is a hole, a rim or a male end starts with gap exactly 0. The view floor sits 0.02 above the physics plane exactly when a male end is lowest, and 0 otherwise, as documented.
- Item 2, tilted floor (5°, 15°). Nothing starts penetrating (gap ≥ 0). Things float by up to 0.104 (a beam on edge at 15°, ignoring the horizontal-rod case), and the large t=0+ energies come from tipping onto the slope, not from a pop. A rim lowest with a pin end 0.02 lower: the wheel floats 0.02, which is correct, and it still counts as a sink.
- Item 1, distance from the origin, with the pivot under the wheel (far.test.ts):
  - At rest: drift ≤ 9e-6 in 10 s at x or z = 0, 100, 1000 and 5000.
  - Rolling down a slope: distance in 0.5 s against theory is 0.99918 (5°) and 0.99893 (15°) at the origin, and 0.99735 at x 5000 (15°).
  - Every one of 64 configurations ran twice with an identical state hash, so it is deterministic.
  - A wheel rolled 5000 units keeps its speed (50.22 from 1000 units on, 5.0235 constant).
  - An armless Cart pushed 329 units away rests afterwards (4e-6 drift in 20 s).
- Item 3, hole cranks (bridges.test.ts, 672 single-crank solids + 36 multi-cell solids). Hole cranks parallel or perpendicular at every edge position (r 1…4, pin- and axle-hole hubs, X/Y/Z, eight-at-once, two overlapping wheels, two wheels joined by a beam, a crank beside own cells): no shell, manifold, volume, bore or neighbour-gap problem. The review test re-checks the 18 bridged-band solids (one closed shell, bore open at 3 points). The webs reach up to 0.252 beyond the nominal disc (r 3, crank (2,3)), but only into cells the disc already owns. None of 389–474 legal parallel wheels of another part per case reaches into a web (webclash).
- Item 6, carts driving over a loose beam (armless Cart, 10/30/60/120 u/s; beam across the path, along it, on edge): worst wheel depth 0.065 (transient, at 120 u/s), never > 0.1 deep. An upright wheel on a fixed beam rests 0.0022–0.0035 deep.
- Item 4, cost (segcost.test.ts, interleaved A/B, medians; old = 48 below r 2, 64 from r 2):
  - Triangles per wheel: r 1 800→800, r 1.5 810→906, r 2 938→1066, r 2.5 936→1224, r 3 932→1380, r 3.5 928→1536, r 4 928→1696 (×1.83).
  - Cart example 14852→15236 (+2.6 %); Crank-wheel example 7050→7314 (+3.7 %).
  - Build-time ratios are not trustworthy under this load: single wheels ranged 0.46×–2.4×; Cart median 1.13×, Crank wheel 1.40×.

MEASURED BUT UNCERTAIN
- The lying-wheel sink and the drop rates depend on the sampling and the drop distribution I chose (offset within ±r, height 2–7 layers, 40 drops each).
- The Cart rolling 10 s down a 5° slope veers 228 units sideways in 2271, and the result depends on the offset. It runs at Rapier's 400 u/s speed cap, so I did not treat it as a finding.

NOT TESTED
- The view-side shadow level.
- Perpendicular foreign wheels against the webs, and gear teeth.
- Grab interaction near beams.
- Collision with the web of a turning crank.
- The full `npm test`.
- Any browser or e2e run.

FILES: /Users/antony/Desktop/knap.nosync/tests/review/m7-sim.review.test.ts, and /Users/antony/Desktop/knap.nosync/spikes/review-m7/ (README.md, plus far, farroll, floor, bridges, webclash, quick-male, segcost, kfuzz, kstats, limits and upright .test.ts; helpers kgen, kbrute, floorlib, meshcheck, depthlib, lib; reference copies m6/ = 8b3a791 and oldseg/geometry = HEAD's geometry with the old rimSegments).

## [major] Wheels sink into a loose beam on the floor well beyond the documented envelope, upright wheels included
An upright r 2.5 wheel resting on a loose 11-hole beam lying flat on the floor is 0.039 / 0.059 / 0.061 deep at 1 / 5 / 20 s, against a resting sink of ≤ 0.012 for ordinary parts in DEVIATIONS §5. r 1 sinks 0.026 and r 1.5 sinks 0.033. On a fixed beam the same wheels rest 0.0022–0.0035 deep (spikes/review-m7/upright.test.ts). An armless Cart parked with one wheel on a loose beam: 0.165 deep at 20 s, or 0.079 with the beam under both x 0 wheels (limits.test.ts). Driving over a beam at 10–120 u/s stays at most 0.065 deep (transient). Test: 'FAILS ON PURPOSE: an upright r 2.5 wheel resting on a loose beam …' (measured 0.0588).
FIX: Widen the documented failure envelope from 'a wheel lying across a beam' to 'any wheel on a loose part that lies on the floor'. Treat this with the hull replacement already planned (convex pieces with ≤ 4-vertex caps, or a native cylinder against parts) before gears depend on wheel–part contact.

## [major] Known limit 1 is understated: a lying wheel sinks up to 0.458 (99.6 % of HC), and the existing KNOWN LIMIT test's probe misses it
limits.test.ts, built in place, r 1.5/2.5/4, beam 1 or 2 off the hub, loose or fixed: worst depth 0.371–0.458. r 1.5, 1 off the hub, loose beam: 0.453 at 1 s and 0.458 worst; DEVIATIONS says 0.37. Flat drops onto a loose beam: 24/40 (r 1.5) and 31/40 (r 2.5) still embedded > 0.1 at 5 s, worst 0.457; DEVIATIONS says 33/180. The existing wheels-sim 'KNOWN LIMIT … sinks into the beam' test samples only the wheel's faces and mid-plane (axial −HC, 0, +HC); for r 1.5 that reads 0.250 where 5 axial samples read 0.458. Its bound is depth < HC = 0.46, so a 0.002 margin separates it from 'through'. Test: 'FAILS ON PURPOSE: a wheel lying across a beam … measured 0.458'.
FIX: Correct the DEVIATIONS numbers (0.37–0.46; 60–78 % of the drops in this distribution). Sample ±HC/2 in the existing KNOWN LIMIT probe, and do not call the case 'never through' while the margin is 0.002.

## [major] A male crank cell (pin, axle, friction pin) at the rim edge is drawn as a separate floating piece
Rule 1 joins every cell of the part that the disc overlaps, but rimBridges (src/geometry/solid.ts:499) skips anything that is not a hole (`!isHole(c.kind)`). Reproduce: buildPartMesh of a part with cells pinHole(0,0,0, axis Z, rim 2.5), pin(2,2,0, Z), pin(2,2,1, Z) gives meshShells = 2; the rod is about 0.06 clear of the drawn rim. Sweep (bridges.test.ts): male cranks parallel to the hub axis at edge positions are 2 shells in 54/84 solids, perpendicular ones in 18/84, at (1,1) of r 1, (2,2) of r 2.5, (2,3) and (3,2) of r 3, (2,4) of r 4 … The physics welds the rod to the wheel, so it moves with the wheel while drawn detached. A crank pin built straight into the wheel is a natural build. Test: 'FAILS ON PURPOSE: a crank *pin* in the wheel part …'.
FIX: Bridge male cells too: the same 2-D hull web from the rod's cell toward the hub, ±H thick, unioned before the bores. Or forbid a male cell in a disc-owned position whose rod the drawn rim does not reach.

## [minor] A horizontal male rod that is the lowest part starts 0.17 above the physics floor and drops at Play
The plane is only ever lowered (sim.ts constructor). A 2-pin lying along X on the floor: gap 0.170 (floorlib.initialGap), KE 110 in the first 0.05 s. An axle lying under a beam (not mated): gap 0.170, drops 0.40, KE 1.9e3. DESIGN §2.6 says a model 'always starts resting on the floor'. Test: 'FAILS ON PURPOSE: a male rod lying horizontally …' (measured 0.17000).
FIX: Set the plane to the minimum over every ground-touching collider point. For male cells use the circumscribed prism radius R_COLL_ROD/cos(π/16) transversally, and allow the plane to rise above groundLevel + 0.04, so it is no longer only lowered.

## [minor] Drift toward or away from a far floor pivot is reduced, not gone, and grows with time and distance
A loose r 1.5 wheel at the origin with a fixed root at x −2D, so the pivot is D away (farroll.test.ts):
- D 100: dx −6.6e-4 / −1.78e-3 / −3.31e-3 at 10 / 20 / 30 s
- D 300: +2.08e-3 / +5.49e-3 / +1.07e-2
- D 1000: +4.21e-3 / +1.29e-2 / +2.19e-2
- D 5000: 3.0e-2 in 10 s, |v| 4.4e-3 and rising (far.test.ts)
The §5.3 rest criterion (< 0.01) fails from about D 300 at 30 s. It needs a model 600+ units wide, because the pivot is the mean cell centre. A vehicle rolling away is fine (speed constant over 5000 units; a Cart pushed 329 units rests to 4e-6 in 20 s). Test: 'FAILS ON PURPOSE: a loose wheel 1000 units from the floor's pivot stays put' (measured 1.29e-2).
FIX: Put the half-space's local origin under each contact region, or re-centre the ground collider on the model's current centre each step. Or document the remaining envelope (≈ 1e-2 per 20 s at 1000 units).

## [minor] f32 positions freeze slow motion far from the origin: the Cart translated by 5000 stalls
Rapier stores positions in f32: ulp(5000) = 4.9e-4, so a body moving slower than about ulp/dt = 0.23 u/s does not move or moves in steps. The threshold is 0.03 u/s at 1000 and 3.7e-3 u/s at 100. The Cart example at x+5000: chassis dx at 1..6 s is 0.049, 0.0615, then 0.0615 frozen; at the origin it goes 0.097, −0.209, −0.067, −0.275 … An armless Cart parked at offset ≥ 100 shows dx exactly 0 over 10 s. Cart trajectory deviation from the origin run over 10 s: 0.054 (offset 100), 0.092 (1000), 0.22 (5000) (far.test.ts, farroll.test.ts). A user who builds thousands of units from the origin sees the slow sway and settling of a model stall.
FIX: Simulate in a frame centred on the model: subtract the mean cell centre (or the current bodies' centroid) from all Rapier positions and add it back for the view.

## [minor] Free 4-bar creep does not decay: a steady ≈ 4e-3 u/s
limits.test.ts, the free 4-bar on the floor. Max body drift per 10 s over 10–20 / 20–30 / 30–40 s: friction 0.2: 0.0375 / 0.0420 / 0.0424; friction 0: 0.0389 / 0.0386 / 0.0422. DEVIATIONS reports 0.037 per 10 s, which matches, but the rate is constant, so it adds up to about 2.5 units in 10 minutes.
FIX: Document it as a rate (≈ 4e-3 u/s, constant), not a 10 s figure.

## [nit] Crank webs extend up to 0.25 beyond the nominal disc
Mid-plane point-in-mesh sampling on a 0.02 grid (bridges.test.ts, webclash.test.ts):
- r 3, crank (2,3): 189 samples beyond r, max 0.252
- r 1, crank (1,1): 0.091
- r 4, crank (2,4): 0.102
All of it lies in cells the disc already owns. No free-cell gap violation in 708 solids, and no legal parallel wheel of another part reaches into a web (389–474 placements checked per case). Perpendicular wheels and gear teeth were not checked.
FIX: Re-check against meshing gears and perpendicular discs when gears arrive; clipping the web to the nominal disc ∪ the crank cell would remove the question.

## [nit] Tilted floor (test-only groundSlopeDeg) is not tangent to the lowest collider
floorlib.initialGap at 5° and 15°: every model starts floating by 0.0033–0.104 (beam on edge at 15° is the largest), never penetrating. The plane uses nominal cube corners + 0.04, not collider points.
FIX: If the option ever reaches users, compute the plane from collider points, as for the flat-floor male fix.

## [nit] Crank-hole mass spec gap measured
Mass vs drawn volume. r 2.5 + crank (1,1) (fully inside the disc): Δmass +0.620, Δdrawn −0.283, COM shifts 0.048 toward the hole. r 2.5 + (2,2): +0.620 / +0.329 (0.097). r 3 + (2,3): +0.620 / +0.521 (0.086). The direction matches DEVIATIONS, which says ≈ 0.1. Pinned by the passing test 'collider mass vs drawn solid for a crank hole'.
FIX: None needed now. Subtract the disc's overlap with the part's other cells when gears make the balance matter.

