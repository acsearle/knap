# knap

Browser 3D editor + rigid-body simulator for a Technic-like system of liftarms, pins and axles.

- **`docs/DESIGN.md` is the source of truth** for the model rules, kinematic analysis, geometry,
  physics mapping, rendering and editor behaviour. Read the sections relevant to your task before
  writing code. If you must deviate, record what and why in `docs/DEVIATIONS.md`.
- Units: 1 unit = 1 stud = 8 mm, +Y up, integer cell centres.
- `src/core` is pure TypeScript (no DOM, three, rapier or manifold imports) and fully unit-tested.
- Node is 20.11 — pick dependency versions that support it.
- Commands: `npm test` (vitest run), `npm run typecheck`, `npm run build`, `npm run dev`, `npm run e2e`.
- Stay inside the files/directories your task names; other agents may be editing the rest of the
  tree concurrently. Do not run `git commit`, `git add`, `git stash`, or `git checkout` unless your
  task explicitly says to — the supervisor commits at milestones.
- Not an official LEGO product; the UI must not use the names LEGO or Technic outside the disclaimer.
