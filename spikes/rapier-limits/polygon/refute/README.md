# refute: polygon

An attempt to break the `spikes/rapier-limits/polygon` report. Rapier JS 0.21.0 (Rapier 0.36, parry 0.31). Native API only.
Run from the repo root: `node spikes/rapier-limits/polygon/refute/<script>`. Each script finishes in under 30 s.

| script | what it does |
|---|---|
| `witness.mjs` | box on a fixed 32-gon hull top: baseline, contact recycling switched off (a contact-filter hook makes the pair un-recyclable), dropped vs started in contact, 20 s, density, thin plates, large sizes, the n=4 control at g 1226 with dt 1/60, and traces of the single contact point |
| `sink.mjs` | sweeps the starting gap, gravity, dt and box size; thin tiles on thin plates at SI defaults |
| `controls.mjs` | thin-plate fall-through at SI with the n=4 control; dropped boxes; which knap setting makes the 16-gon side7 spot fall through |

I also re-ran every script of the original spike (`kept.mjs SI/KNAP`, `box_on_ngon.mjs SI/KNAP`, `scaleswitch.mjs`, `chord.mjs`, `merge.mjs`). Every headline number came out the same.

## Results

| claim | my result | verdict |
|---|---|---|
| The face is a quad of 4 consecutive loop vertices, closed by a chord | Reproduced. The source quotes check out | CONFIRMED |
| Witness-only box sinks at SI (7.49°, y −0.0132) | Reproduced. Recycling off: same (−0.0132). Density 100: same. **Exception:** a box dropped from 0.02, 0.2 or 0.5 above the *centre* rests at y 0.0499, on one point directly under its COM. Dropped off-centre, it sinks as claimed | CONFIRMED, except that "every spot" fails at the dropped centre |
| The fall-through is SCALE, caused by gravity alone | The switch reproduces for the 0.5-deep prism. **But at SI defaults** a 32-gon plate 0.02 thick (box half-height 0.05), or a 0.04 tile on a 0.05 plate, **falls through** (y −7.4, −17.0). The n=4 controls rest. The sink grows steadily with g (0.023 at g 2.45, 0.175 at g 78.5; falls through at g 157). g 1226 at dt 1/60 with n=4 rests (0.0385), so a large per-step drop is not what causes it | SCALE **REFUTED**: it is the same DESIGN LIMIT, and depth decides when it shows |
| 16-gon side7 falls through at knap only | Gravity alone flips it (SI 0.0499 vs g 1226 −670). dt and iterations alone do not | CONFIRMED (answers one of their open questions) |
| HalfSpace prism tips and sinks; cuboid ground holds | Reproduced | CONFIRMED |
| Merge tolerance 1.5057° (merged at 1.505°, separate at 1.510°) | Reproduced | CONFIRMED |
