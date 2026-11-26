// Engagement of two spinning gears in the real sim: the slider model, μ 0, gear A at wA, gear B at
// wB (both about +Z), B sliding into mesh at 3 units/s (no grab). Post-engagement speeds against the
// analytic plastic impact at the pitch point, and the energy change against the analytic loss.
import { PITCH, Simulation, energyTotal, f, out } from './lib';
import { slider } from './slide';
for (const k of [1, 2, 4])
  for (const [wA, wB] of [[20, 10], [20, -5], [50, 0], [0, 40]] as const) {
    const sl = slider();
    const s = await Simulation.create(sl.model, { jointFriction: 0, substeps: k, mesh: { snapRate: Number(process.env.SNAP ?? 0.96) } });
    const A = s.bodyOf(sl.A)!;
    const B = s.bodyOf(sl.B)!;
    s.setBodyVelocity(A, [0, 0, 0], [0, 0, wA]);
    s.setBodyVelocity(B, [0, 0, -3], [0, 0, wB]);
    const IA = s.massInfo(A)!.inertia[8]!;
    const IB = s.massInfo(B)!.inertia[8]!;
    const J = (wA + wB) / (1 / IA + 1 / IB); // r1 = r2 = 1
    const wA2 = wA - J / IA;
    const wB2 = wB - J / IB;
    const lossAn = 0.5 * IA * wA ** 2 + 0.5 * IB * wB ** 2 - (0.5 * IA * wA2 ** 2 + 0.5 * IB * wB2 ** 2);
    const m = s.meshes[0]!;
    let eBefore = NaN, eAfter = NaN, at = -1, snap = 0, peakF = 0;
    let prev: number[] = [wA, wB];
    for (let i = 1; i <= 480; i++) {
      const e = energyTotal(s);
      const was = m.engaged;
      s.stepFixed(1);
      if (!was && m.engaged) { eBefore = e; at = i; snap = m.lastSnap; }
      if (at > 0 && i === at + 2) eAfter = energyTotal(s);
      const w = [s.bodyVelocity(A)!.w[2], s.bodyVelocity(B)!.w[2]];
      if (at > 0 && i <= at + 2) peakF = Math.max(peakF, Math.abs(w[0]! - prev[0]!) * IA * 480);
      prev = w;
      if (at > 0 && i === at + 2) {
        out(`k ${k} wA ${wA} wB ${wB}: engaged at ${(at / 480).toFixed(4)} s (snap ${f(snap, 3)} teeth) | after: ωA ${f(w[0]!, 3)} ωB ${f(w[1]!, 3)} vs analytic ${f(wA2, 3)} ${f(wB2, 3)} (err ${f(w[0]! / wA2 - 1, 4)}, ${f(w[1]! / wB2 - 1, 4)}) | ΔE ${f(eAfter - eBefore, 2)} vs analytic −${f(lossAn, 2)} | peak tooth impulse/dt ${f(peakF, 0)} vs J/dt ${f(Math.abs(J) * 480, 0)}`);
      }
    }
    let maxE = m.maxE / PITCH;
    out(`   then 1 s: ratio ωB/ωA ${f(s.bodyVelocity(B)!.w[2] / s.bodyVelocity(A)!.w[2], 5)}, phase max ${f(maxE, 4)} teeth, engaged ${m.engaged}, δ ${f(m.delta, 3)}, guardRemoved ${f(s.guardRemoved, 3)}`);
    s.dispose();
  }
process.exit(0);
