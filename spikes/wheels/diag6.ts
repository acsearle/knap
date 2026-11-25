// Repro in the real Simulation: a loose 5-hole liftarm dropped flat (holes along Y) onto a fixed
// 15-hole liftarm on edge (holes along Z), from heights 2..10 units, and the reverse orientations.
import { Simulation, initPhysics } from '../../src/physics/sim';
import { addPart, emptyModel, setRoot } from '../../src/core/model';
import { beam } from '../../src/core/examples';
await initPhysics();
console.log('fixed\tloose\tdrop h\tfinal loose com y (rest ≈ 0.92)\tremoved?');
for (const [fa, la] of [[2, 1], [2, 2], [1, 1], [1, 2]] as const)
  for (const h of [2, 3, 5, 8, 10]) {
    let m = emptyModel();
    const X0 = Number(process.env.X0 ?? -7);
    const f = addPart(m, beam([X0, 0, 0], [X0 + 14, 0, 0], fa));
    m = f.model;
    const l = addPart(m, beam([-2, h + 1, 0], [2, h + 1, 0], la));
    m = setRoot(l.model, f.partId);
    const sim = await Simulation.create(m, { stepBudgetMs: Infinity });
    const b = sim.bodyOf(l.partId)!;
    let through = '';
    for (let i = 0; i < 1440 && !through; i++) {
      sim.stepFixed(1);
      const q = sim.massInfo(b);
      // below the fixed beam's top while its com is still over the fixed beam (not tipped off)
      if (q && q.com[1] < 0.3 && q.com[0] > X0 + 0.5 && q.com[0] < X0 + 13.5) {
        const t = sim.bodyTransform(b)!;
        through = `THROUGH at t=${(i / 480).toFixed(3)} com=(${q.com.map((v) => v.toFixed(2)).join(',')}) tilt=${(2 * Math.asin(Math.min(1, Math.hypot(t.q[0], t.q[1], t.q[2])))).toFixed(3)}`;
      }
    }
    const mi = sim.massInfo(b);
    console.log([fa === 2 ? 'edge' : 'flat', la === 2 ? 'edge' : 'flat', h, mi ? mi.com[1].toFixed(3) : '-', sim.hasBody(b) ? 'no' : 'yes', through].join('\t'));
    sim.dispose();
  }
