# knap

A browser-based 3D editor and rigid-body physics simulator for a Technic-like construction system
of liftarms, pins and axles. Everything is built from one-stud *sub-parts* — pin holes, axle holes,
axles, pins and friction pins — placed on a cubic grid; parts are welded, pinned or slid together
and simulated as connected rigid bodies under gravity.

> **Disclaimer.** knap is an independent project. It is not affiliated with, endorsed by, or an
> official product of the LEGO Group. "LEGO" and "Technic" are trademarks of the LEGO Group.

Status: early development. See `docs/DESIGN.md` for the specification.

## Running

Requires Node 20.11+.

```sh
npm install
npx playwright install chromium   # only needed for npm run e2e
npm run dev        # development server
npm run build      # typecheck + production build into dist/
npm run preview    # serve dist/
npm test           # unit + headless physics tests (vitest)
npm run typecheck
npm run e2e        # build, serve, drive headless Chromium; screenshots in e2e/out/
```

## Technology

- [three.js](https://threejs.org/) for rendering (orthographic, outlined instruction-style look).
- [Rapier](https://rapier.rs/) (`@dimforge/rapier3d-compat`, Rust → WASM) for rigid-body physics —
  chosen over ammo.js (stale Bullet port), cannon-es (weak joints, unmaintained) and Jolt (heavier,
  manual-memory API).
- [manifold-3d](https://github.com/elalish/manifold) (WASM) for robust CSG of part meshes.
- TypeScript (strict), Vite, Vitest, Playwright.

All assets, including WASM, are bundled; no network access at runtime.

## Layout

```
src/core/      pure model, rules, kinematic analysis (no DOM / WASM)
src/geometry/  part solids (manifold) and collision primitives
src/physics/   Rapier simulation
src/view/      rendering, camera, view cube
src/editor/    tools, picking, history
src/ui/        toolbar, inspector, status bar, menus
tests/         vitest tests
e2e/           Playwright scripts (see e2e/lib.mjs)
```

## License

TBD.
