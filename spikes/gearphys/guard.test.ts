// Investigation: the energy guard's removal after spinning gears engage (spikes/gearsim REPORT §2).
import { it } from 'vitest';
import { slider, omega } from '../../tests/physics/gearModels';
import { Simulation } from '../../src/physics/sim';
const tot = (s: Simulation) => { const e = s.energy(); return e.kinetic + e.potential; };
it('guard', async () => {
  for (const guard of [true, false]) for (const k of [undefined, 1, 2, 4] as const) for (const mesh of [true, false]) for (const grav of [true, false]) {
    const rig = slider();
    const s = await Simulation.create(rig.model, { jointFriction: 0, energyGuard: guard, substeps: k, gravity: grav ? undefined : [0, 0, 0] });
    const A = s.bodyOf(rig.part.A!)!, B = s.bodyOf(rig.part.B!)!;
    s.setBodyVelocity(A, [0, 0, 0], [0, 0, 20]);
    s.setBodyVelocity(B, [0, 0, mesh ? -3 : 0], [0, 0, 10]);
    let engAt = -1;
    for (let i = 0; i < 240; i++) { s.stepFixed(1); if (engAt < 0 && s.meshStates().length) engAt = i; if (mesh && engAt >= 0 && s.meshDiagnostics()[0]!.delta > -0.0) {} }
    // stop B's slide
    const v = s.bodyVelocity(B)!; s.setBodyVelocity(B, [0, 0, 0], v.w);
    s.stepFixed(48);
    const g0 = s.guardRemoved, E0 = tot(s), K0 = s.energy().kinetic;
    for (let i = 0; i < 960; i++) s.stepFixed(1);
    const rem = (s.guardRemoved - g0) / 2, dE = (tot(s) - E0) / 2;
    console.log(`G guard ${guard} k ${k ?? 'auto'} mesh ${mesh && s.meshStates().length > 0} grav ${grav}: K ${K0.toFixed(1)} guard removes ${(100 * rem / K0).toFixed(3)} %K/s, E change ${(100 * dE / K0).toFixed(3)} %K/s, wA ${omega(s, A).toFixed(3)} wB ${omega(s, B).toFixed(3)} k now ${s.substeps}`);
    s.dispose();
  }
}, 600000);
