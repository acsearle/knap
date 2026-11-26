import { it } from 'vitest';
import { compound25, gearPair, maxOmega, phaseNow } from '../../tests/physics/gearModels';
import { Simulation } from '../../src/physics/sim';
it('yank', async () => {
  for (const [name, mk, out, tip] of [['1:5', () => gearPair(0.5, 2.5, { armB: 6 }), 'B', [9, 0, 2]], ['1:25', () => compound25(6), 'C', [12, 0, 3]]] as const)
    for (const mu of [0, 0.05, 0.2]) {
      const rig = mk();
      const s = await Simulation.create(rig.model, { jointFriction: mu });
      s.grab(s.bodyOf(rig.part[out]!)!, [...tip]);
      s.stepFixed(144);
      const p0 = s.grabPoint()!;
      const target: [number, number, number] = [p0[0], p0[1] + 8, p0[2]];
      s.dragTo(target);
      const d = () => { const p = s.grabPoint()!; return Math.hypot(p[0] - target[0], p[1] - target[1], p[2] - target[2]); };
      const d0 = d(); let away = 0, ph = 0, w = 0, k = 1, t90 = NaN;
      for (let i = 0; i < 480; i++) { s.stepFixed(1); away = Math.max(away, d() - d0); ph = Math.max(ph, phaseNow(s)); w = Math.max(w, maxOmega(s)); k = Math.max(k, s.substeps); if (Number.isNaN(t90) && d() < 0.1 * d0 + 0.9 * 4.216) t90 = s.time - 0.3; }
      console.log(`Y ${name} μ ${mu}: start ${d0.toFixed(3)} end ${d().toFixed(3)} max increase ${away.toExponential(2)} phase ${ph.toExponential(2)} max|ω| ${w.toFixed(1)} k max ${k} cap removed ${s.capRemoved.toFixed(0)} jointErr ${s.jointError().toExponential(2)}`);
      s.dispose();
    }
}, 600000);
