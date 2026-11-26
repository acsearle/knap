// Diagnosis of the falling gearbox at high spin: time series of energy, spins, phase, guard.
import { Simulation, energyTotal, f, out, phaseTeeth, putRims } from './lib';
import { ModelBuilder, beam } from '../../src/core/examples';
import { makeCell } from '../../src/core/model';
const spin = Number(process.argv[2] ?? 100);
const k = Number(process.argv[3] ?? 1);
const guard = process.argv[4] !== 'off';
const b = new ModelBuilder();
const root = b.add(beam([20, 0, 0], [22, 0, 0]));
const frame = b.add(beam([0, 0, 0], [0, 3, 0]));
const g1 = b.add([makeCell(0, 0, 1, 'pinHole', 2)]);
b.add([makeCell(0, 0, 0, 'frictionPin', 2), makeCell(0, 0, 1, 'pin', 2)]);
const g2 = b.add([makeCell(0, 3, 1, 'pinHole', 2)]);
b.add([makeCell(0, 3, 0, 'frictionPin', 2), makeCell(0, 3, 1, 'pin', 2)]);
let m = b.root(root).build();
m = putRims(m, [{ part: g1, pos: [0, 0, 1], r: 0.5 }, { part: g2, pos: [0, 3, 1], r: 2.5 }]);
const s = await Simulation.create(m, { substeps: k, energyGuard: guard, jointFriction: Number(process.env.MU ?? 0.2), gravity: [0, process.argv[5] === 'nog' ? 0 : -1226.25, 0], gears: process.argv[6] !== 'nogears', mesh: { maxLinSpeed: Number(process.env.VMAX ?? 350) } });
const ids = [frame, g1, g2].map((p) => s.bodyOf(p)!);
s.setBodyVelocity(ids[1]!, [0, 0, 0], [0, 0, spin]);
s.setBodyVelocity(ids[2]!, [0, 0, 0], [0, 0, -spin / 5]);
const E0 = energyTotal(s);
function Lrel() {
  let M = 0; const R: number[] = [0, 0, 0]; const V: number[] = [0, 0, 0];
  for (const id of ids) { const mi = s.massInfo(id)!; const v = s.bodyVelocity(id)!; M += mi.mass; for (let i = 0; i < 3; i++) { R[i]! += mi.mass * mi.com[i]!; V[i]! += mi.mass * v.v[i]!; } }
  for (let i = 0; i < 3; i++) { R[i]! /= M; V[i]! /= M; }
  let l = 0;
  for (const id of ids) { const mi = s.massInfo(id)!; const v = s.bodyVelocity(id)!; const rx = mi.com[0] - R[0]!, ry = mi.com[1] - R[1]!; const vx = v.v[0] - V[0]!, vy = v.v[1] - V[1]!; l += mi.inertia[8]! * v.w[2] + mi.mass * (rx * vy - ry * vx); }
  return l;
}
const L0 = Lrel();
for (let i = 1; i <= 480; i++) {
  s.stepFixed(1);
  if (i % 24 === 0 || i < 6) {
    const w = ids.map((id) => s.bodyVelocity(id)!.w[2]);
    out(`t ${(i / 480).toFixed(3)} ω frame ${f(w[0]!, 3)} g1 ${f(w[1]!, 2)} g2 ${f(w[2]!, 3)} rel ratio ${f((w[1]! - w[0]!) / (w[2]! - w[0]!), 3)} | L/L0 ${f(Lrel() / L0)} | E−E0 ${f(energyTotal(s) - E0, 1)} guardRemoved ${f(s.guardRemoved, 1)} | phase ${f(phaseTeeth(s).now, 4)} eng ${s.meshes[0]?.engagements}/${s.meshes[0]?.releases} gap ${f(s.meshes[0]?.gap ?? NaN)} vy ${f(s.bodyVelocity(ids[0]!)!.v[1], 1)}`);
  }
}
process.exit(0);
