// Crane drop: reversed world steps (sign of ω about Z per WORLD step, via a wrapped world.step).
import { it } from 'vitest';
import { Simulation } from '../../../src/physics/sim';
import { compound25, gearPair } from '../../../tests/physics/gearModels';
import { Twist } from './lib';
it('crane drop: per world step reversals', async () => {
  for (const [name, rig, out] of [['1:5', gearPair(0.5, 2.5, { armB: 6 }), 'B'], ['1:25', compound25(6), 'C']] as const) {
    for (const mu of [0, 0.05, 0.2]) {
      const s = await Simulation.create(rig.model, { jointFriction: mu });
      const bodies = Object.entries(rig.part).filter(([k]) => k !== 'frame').map(([, id]) => s.bodyOf(id)!);
      const world = (s as any).world;
      const step0 = world.step.bind(world);
      const sign = new Map<number, number>();
      let rev = 0;
      let worst = 0;
      let ws = 0;
      let bottom = false;
      world.step = (...a: unknown[]) => {
        step0(...a);
        ws++;
        if (bottom) return;
        for (const b of bodies) {
          const w = s.bodyVelocity(b)!.w[2]!;
          const sg = Math.sign(w);
          if (Math.abs(w) > 1e-3 && sign.has(b) && sign.get(b) !== sg) { rev++; worst = Math.max(worst, Math.abs(w)); }
          if (Math.abs(w) > 1e-3) sign.set(b, sg);
        }
      };
      const tw = new Twist(s, s.bodyOf(rig.part[out]!)!, [0, 0, 1]);
      tw.get();
      for (let i = 0; i < 960 && !bottom; i++) {
        s.stepFixed(1);
        if (tw.get() <= -Math.PI / 2) bottom = true;
      }
      console.log(`crane ${name} μ ${mu}: world steps to bottom ${ws}, reversed world steps ${rev} (largest |ω| after a reversal ${worst.toFixed(3)}), reached bottom ${bottom} at ${s.time.toFixed(3)} s`);
      s.dispose();
    }
  }
});
