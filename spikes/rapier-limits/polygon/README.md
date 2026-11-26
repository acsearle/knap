# spike: what "only the first four vertices of a polygon face" means

Engine: `@dimforge/rapier3d-compat` 0.21.0 (Rapier 0.36, parry 0.31, f32). Native Rapier API only.
Run each script from the repo root with `node spikes/rapier-limits/polygon/<script>`. Each finishes in under 3 s.

## Answer

The face is modelled as **one convex quadrilateral**: the first four *consecutive* vertices of the
face's boundary loop, closed by a **chord** from vertex 4 back to vertex 1. It is not two triangles
and not four separate points. The rest of the n-gon, beyond the chord, is missing from the clip.
In 3D, pfm-vs-pfm contact (any convex hull against a cuboid or another hull) also always adds
one GJK/EPA witness point, so a body over the missing part rests on **one point**. HalfSpace contact
adds no witness point. It emits only the four kept vertices.

### Source (parry 0.31 checkout)
- `src/shape/convex_polyhedron.rs:944-976` `local_support_feature`: picks the face with the largest `normal·dir`, then
  `:960` "TODO: if there are more than 4 vertices, we need to select four vertices that maximize the area."
  `:961` `face.num_vertices_or_edges.min(4)`. It copies `vertices_adj_to_face[first .. first+4]`: four consecutive loop entries.
- The face loop is built in `from_convex_mesh` (`:480-545`). The builder starts at the first triangle of the face, in triangle
  order, and at that triangle's first non-deleted edge, then walks the boundary. So which four are kept depends on the
  hull's triangle order (convexHull) or on your index order (convexMesh), but they are always consecutive.
- `src/shape/polygonal_feature3d.rs:16`: `vertices: [Vector; 4]`. In `contacts_face_face` (`:199-370`), the inside test
  is a sign test over edges j→j+1 *and the closing edge last→0* (`:251-257`). The edge-edge crossings use
  `(i+1) % num_vertices` (`:336-349`). Both treat the four points as a closed quad.
- `src/query/contact_manifolds/contact_manifolds_pfm_pfm.rs:115-127`: in dim3 it always pushes the GJK witness pair, with fids
  UNKNOWN ("TODO: We don't know what features are involved").
- `contact_manifolds_halfspace_pfm.rs:55-79`: `local_support_feature(-n)` (the same truncated face). It emits each feature
  vertex within `prediction` of the plane and nothing else, so there is no witness point.
- Dispatcher `src/query/default_query_dispatcher.rs:757` handles cuboid-cuboid specially. `:777-805` handles halfspace. Everything else,
  including cuboid vs hull, goes to pfm_pfm (`:807-815`).
- Builders: `ColliderDesc.convexHull` → `ConvexPolyhedron::from_convex_hull` = `try_convex_hull` + `from_convex_mesh`
  (`convex_polyhedron.rs:255-259`). `convexMesh` → `from_convex_mesh` directly (`shared_shape.rs:615`). The `round*` variants
  wrap the same polyhedron in `RoundShape` (`shared_shape.rs:621-663`). The border radius is only added along the normal
  (`pfm_pfm.rs:141-148`), so all three share the limit.
- Merge tolerance (`convex_polyhedron.rs:385`, `:472`): `eps = DEFAULT_EPSILON.sqrt()` with `DEFAULT_EPSILON = f32::EPSILON`
  (`src/math/mod.rs:43`). An edge is deleted, which merges its two triangles into one face, when `n1·n2 > 1 - eps`.
  That means a dihedral deviation below acos(1 - 3.4527e-4) = **1.5057°**. Two adjacent bevel facets
  (normals (s,c,0),(0,c,s)) merge below asin(√eps) = 1.0647°.
- Upstream awareness: there is only the TODO at `:960`. Neither CHANGELOG mentions it. parry 0.30.2 fixed the same
  symptom for cylinder/cone caps ("Fix single-point contact manifolds on cylinder and cone caps", rapier#810),
  but not for polyhedron faces. The issue tracker was not searched.

## Scripts

| script | what it does |
|---|---|
| `common.mjs` | world setup (SI: g 9.81, dt 1/60, default iterations; knap: g 1226.25, dt 1/480, 30 iterations, lengthUnit 1, maxCcdSubsteps 0), n-gon prism points, manifold reader, fid decoder |
| `kept.mjs [SI\|KNAP]` | DYNAMIC n-gon prism (R 0.5, h 0.5) lying on a HalfSpace and on a large fixed cuboid; convexHull / convexMesh / roundConvexHull; lists the contact fids (which vertices were kept), then 2 s under gravity |
| `box_on_ngon.mjs [SI\|KNAP] [n,..] [verbose]` | FIXED convexHull n-gon prism; cuboid (half 0.08,0.05,0.08) at the centre and near the middle of every side; step-1 manifold (points, witness count, footprint vs kept quad), then 2 s |
| `chord.mjs` | places boxes so they straddle the closing chord or a diagonal of the kept quad, and measures where the edge-crossing contact points lie |
| `trace.mjs [SI\|KNAP] n x z` | time trace of one box: pose and full manifold |
| `scaleswitch.mjs` | box at the centre of a 32-gon: switches g, dt and iterations one at a time; n=4 control |
| `merge.mjs` | merge tolerance: a single ridge (flat top plus one facet tilted θ), and a bevel ring of width 0.2 around a square top; θ swept across 1.5057° |

## Results (all from the commands above)

| behaviour | numbers | class |
|---|---|---|
| Face of n>4 vertices kept as a quad of 4 consecutive loop vertices | `kept.mjs SI`: bottom face keeps k=9,10,11,12 (n=16) and k=27..30 (n=32), consecutive; convexMesh with a fan from vertex 0 keeps k=0..3. `chord.mjs`: edge-crossing points lie at distance 0.00000 from the chord (hexagon chord k2→k5 through the centre; 16-gon chord k6→k9 at (-0.3948, 0.1460), 0.0747 inside the true boundary). A box straddling a diagonal (n=4) gives the 4 box corners plus the witness point and nothing on the diagonal, so this is not two triangles | DESIGN LIMIT |
| Box on fixed n-gon top, outside the kept quad: witness point only | `box_on_ngon.mjs SI`: witness-only at 0/5 spots (n=4), 0/6 (n=5), 3/7 (n=6), 6/9 (n=8), 16/17 (n=16), 33/33 (n=32, centre included). Every witness-only spot: SI tilts 7.49° and sinks to centre y −0.0132 (box bottom 0.063 into the prism, rest 0.05); `scaleswitch.mjs` still −0.0132 at 20 s. Knap (`box_on_ngon.mjs KNAP`): falls through to y ≈ −700. Clipped spots: SI tilt ≤0.03°, y 0.0499. Knap 16-gon side7 (corner overlap only, 4 pts) also fell through (−507.7); at SI it held | MIXED: DESIGN LIMIT (sink at SI) + SCALE (fall-through) |
| Which knap setting causes fall-through | `scaleswitch.mjs`: SI −0.0132 (sunk). dt 1/480 alone: 0.0013 (sunk). iters 30 alone: −0.0208 (sunk). **g 1226.25 alone: −712 (fell through)**. Full knap: −702. Control n=4: SI 0.0499, knap 0.0385 (rest) | SCALE (gravity) |
| Dynamic n-gon prism on HalfSpace (4 vertices, no witness) | `kept.mjs SI`: n=4,5 flat (tilt 0.0°). n=6 (centre exactly on the chord) tips to 47°. n=8/16/32 tip about 45–50° and sink to centre y 0.075 / −0.118 / −0.150 (rest 0.25). Knap: same tipping, y −0.22 / −0.57 / −0.67. Switch ground → large cuboid: SI tilt ≤0.8°, y ≥0.2467 | DESIGN LIMIT |
| Dynamic n-gon prism on large fixed cuboid | 5 points (4 kept vertices plus the witness near the centre). SI tilt ≤0.8°, sink ≤0.003. Knap tilt ≤1.2° (n=32 transient 4.5°), y ≥0.2184 vs rest 0.25 (rest deflection 0.011) | NOT REPRODUCED (no failure) |
| convexMesh / roundConvexHull | same 4-vertex window and the same outcomes (`kept.mjs`); only the start vertex differs (index order) | DESIGN LIMIT (same code) |
| Coplanar merge tolerance 1.5057° | `merge.mjs`: ring W 0.2 merged at θ 1.505° (d 0.00525), separate at 1.510° (d 0.00527). Single ridge: merged ≤1.505°, separate ≥1.510°. Ring corner edges merge too below 1.0647° (θ 1.06: all 4 kept vertices on the outer ring; 1.07: mixed) | DESIGN LIMIT |

The notes' "0.005 merged, 0.006 held" is consistent with this tolerance if the bevel facet's horizontal run
lies between 0.190 and 0.228 (0.005/tan 1.5057° and 0.006/tan 1.5057°). The project's actual bevel geometry was not tested.

## Not tested
- The project's own bevelled shapes (`shapes.ts`); its "r > 80–100 × bevel" rule.
- Hull vs hull (both n-gon faces), and compound/trimesh/heightfield paths.
- The effect of `contact_natural_frequency` or the prediction distance on the witness-only sink.
- The Rapier/parry issue trackers.
