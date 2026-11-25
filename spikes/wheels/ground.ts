// Experiment 3: where would a ground plane sit for the built-in examples? Prints, per example, the
// lowest cell centre, the root part's lowest cell, and the lowest point a part reaches during the
// first 10 s of simulation (centre of mass of each body, and bound = com − body radius).
import { EXAMPLES, buildExample } from '../../src/core/examples';
import { Simulation, initPhysics } from '../../src/physics/sim';

await initPhysics();
console.log('example\tmin cell y\troot min y\tcells below y=0\tlowest body com y in 10 s (μ 0.2)\tlowest geometry y in 10 s (bound)');
for (const ex of EXAMPLES) {
  const m = buildExample(ex.name);
  let minY = Infinity;
  let below = 0;
  for (const p of m.parts) for (const c of p.cells) {
    minY = Math.min(minY, c.y);
    if (c.y < 0) below++;
  }
  const rootId = m.rootPartId ?? Math.min(...m.parts.map((p) => p.id));
  const root = m.parts.find((p) => p.id === rootId)!;
  const rootMin = Math.min(...root.cells.map((c) => c.y));
  const sim = await Simulation.create(m, { stepBudgetMs: Infinity });
  // per body: max distance of any of its cell centres from its edit-time com, + 0.5 (cell half-size)
  const rad = new Map<number, number>();
  for (const p of m.parts) {
    const b = sim.bodyOf(p.id)!;
    const mi = sim.massInfo(b)!;
    for (const c of p.cells) rad.set(b, Math.max(rad.get(b) ?? 0, Math.hypot(c.x - mi.com[0], c.y - mi.com[1], c.z - mi.com[2]) + 0.87));
  }
  let lowCom = Infinity;
  let lowGeo = Infinity;
  for (let i = 0; i < 4800; i++) {
    sim.stepFixed(1);
    if (i % 24) continue;
    for (const b of sim.graph.bodies) {
      const mi = sim.massInfo(b.id);
      if (!mi) continue;
      lowCom = Math.min(lowCom, mi.com[1]);
      lowGeo = Math.min(lowGeo, mi.com[1] - rad.get(b.id)!);
    }
  }
  sim.dispose();
  console.log([ex.name, minY, rootMin, below, lowCom.toFixed(2), lowGeo.toFixed(2)].join('\t'));
}
