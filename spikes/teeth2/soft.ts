// Contact softness: steady penetration of a 3-hole liftarm (on a vertical slider, as a pawl/plunger)
// pressed onto a fixed flat box by its weight plus k × its weight. NF = Rapier contact natural
// frequency (sim.ts keeps the default 30 Hz). Also: the same against a gear tooth tip (hull teeth,
// gear held by a motor) — the pressure a single tooth can take.
//   sh spikes/teeth2/run.sh soft
import { RAPIER, gear, gearDescs, partDescs, mkPart, makeWorld, fixed, body, revZ, vmotor, fmt, grp, BIT } from './lib';

await RAPIER.init();
const C = (x: number, y: number, z: number, kind: string, axis: number) => ({ x, y, z, kind, axis }) as any;
const beam = (cellAxis0: number) => [mkPart([C(0, 0, 0, 'pinHole', cellAxis0), C(0, 1, 0, 'pinHole', 2), C(0, 2, 0, 'pinHole', 2)])];
for (const target of ['flat', 'tooth'] as const)
  for (const [shape, ax] of [['round end', 2], ['square end', 1]] as [string, number][])
    for (const nf of [30, 120])
      for (const iters of [240, 60]) {
        const res: string[] = [];
        for (const k of [0, 1, 3, 10, 30, 100]) {
          const w = makeWorld({ iters });
          w.integrationParameters.contact_natural_frequency = nf;
          const f = fixed(w);
          let top = 0;
          if (target === 'flat') {
            w.createCollider(RAPIER.ColliderDesc.cuboid(3, 0.5, 0.5).setTranslation(0, -0.5, 0).setCollisionGroups(grp(BIT.TOOTH, BIT.PAWL)), f);
          } else {
            const g = gear(1.5);
            const gb = body(w, [0, -g.tip, 0], Math.PI / 2 - (g.D * 0.5), gearDescs(g, { rep: 'hull' }), iters); // a tooth tip at the top
            vmotor(w, revZ(w, f, gb, [0, -g.tip, 0]), 0, 1e12);
          }
          const y0 = top + 0.46 + 0.005;
          const pb = body(w, [0, y0, 0], 0, partDescs(beam(ax), [0, 0, 0], grp(BIT.PAWL, BIT.TOOTH)), iters);
          w.createImpulseJoint(RAPIER.JointData.prismatic({ x: 0, y: y0, z: 0 }, { x: 0, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }), f, pb, true).setContactsEnabled(false);
          pb.addForce({ x: 0, y: -k * pb.mass() * 1226.25, z: 0 }, true);
          for (let i = 0; i < 480; i++) w.step();
          const pen = top - (pb.translation().y - 0.46);
          res.push(`k${k}:${fmt(pen, 2)}`);
          w.free();
        }
        console.log(`${target.padEnd(5)} ${shape.padEnd(10)} NF ${String(nf).padStart(3)} Hz, ${iters} it: penetration (units) at force (1+k)·weight  ${res.join('  ')}`);
      }
process.exit(0);
