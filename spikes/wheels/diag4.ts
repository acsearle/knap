// Is tunnelling on a 10-unit drop wheel-specific? Drop a plain 5-hole liftarm (project hull) onto
// the liftarm track and onto a half-space, on edge (holes Z) and flat (holes Y), and the b32 wheel
// for comparison; also with 240 substeps.
import { DT, RAPIER, SPEED_CAP, addGround, addWheel, fmt, init, makeWorld } from './lib';
import type { GroundKind } from './lib';
import { partShapes } from '../../src/physics/shapes';
import { beam } from '../../src/core/examples';
await init();
for (const iters of [30, 240])
  for (const g of ['armFlat', 'armEdge', 'half'] as GroundKind[])
    for (const what of ['beamEdge', 'beamFlat', 'b32', 'hyb'] as const)
      for (const h of [2, 5, 10]) {
        const w = makeWorld(iters);
        addGround(w, g, -40, 80);
        let rb;
        let half = 0.46;
        if (what.startsWith('beam')) {
          const ax = what === 'beamEdge' ? 2 : 1;
          rb = w.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setCanSleep(false).setTranslation(0, h + 0.46, 0));
          for (const sh of partShapes({ id: 9, color: '#000000', cells: beam([-2, 0, 0], [2, 0, 0], ax) }, 16)) {
            if (sh.kind !== 'hull') continue;
            const pts = new Float32Array(sh.points.flatMap((p) => p));
            w.createCollider(RAPIER.ColliderDesc.convexHull(pts)!.setFriction(0.4).setRestitution(0.1), rb);
          }
          rb.setSoftCcdPrediction(SPEED_CAP * DT * 1.25);
        } else {
          rb = addWheel(w, what, 1.5, [0, h + 1.5, 0]);
          half = 1.5;
        }
        let low = Infinity;
        for (let i = 0; i < 1440; i++) {
          w.step();
          low = Math.min(low, rb.translation().y - half);
        }
        console.log([iters, g, what, h, fmt(low, 4), fmt(rb.translation().y - half, 4)].join('\t'));
        w.free();
      }
