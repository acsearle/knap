// Q2 energy guard with meshes.
//  pend:   geared pendulum (arm on gear 2), μ = 0, released horizontal: E(t) with merged groups /
//          unmerged groups / guard off, against the RK4 reduced model's period.
//  fall:   a free gearbox (frame + two meshed spinning gears, not the root) falls below the removal
//          depth; bodies are removed one by one while meshed.
// Usage: sh spikes/gearsim/run.sh guard [pend|fall] [ks=1,2,4]
import { Angle, G, PITCH, Simulation, energyTotal, f, izAbout, out, phaseTeeth, putRims, train } from './lib';
import { ModelBuilder, beam } from '../../src/core/examples';
import { makeCell } from '../../src/core/model';

const which = process.argv[2] ?? 'pend';
const ks = (process.argv[3] ?? '1,2,4').split(',').map(Number);

if (which === 'pend') {
  for (const [name, cols] of [
    ['1:1', [{ x: 0, col: [1] }, { x: 2, col: [1], arm: { len: 5 } }]],
    ['3:1 (arm on r 1.5)', [{ x: 0, col: [0.5] }, { x: 2, col: [1.5], arm: { len: 5 } }]],
  ] as const) {
    const t = train(cols as never);
    for (const k of ks)
      for (const mode of ['merge', 'nomerge', 'guardoff'] as const) {
        const s = await Simulation.create(t.model, { jointFriction: 0, substeps: k, energyGuard: mode !== 'guardoff', mesh: { mergeGroups: mode === 'merge' } });
        const b1 = s.bodyOf(t.parts[0]!)!;
        const b2 = s.bodyOf(t.parts[1]!)!;
        const E0 = energyTotal(s);
        const mi = s.massInfo(b2)!;
        const mgL = mi.mass * G * (mi.com[0] - 2);
        const I1 = izAbout(s, b1, [0, 0, 0]);
        const I2 = izAbout(s, b2, [2, 0, 0]);
        const ratio = cols[1]!.col[0]! / cols[0]!.col[0]!; // ω1/ω2 magnitude
        const Ieff = I2 + I1 * ratio * ratio;
        const a2 = new Angle(s, b2);
        const th0 = a2.get();
        let minE = Infinity;
        let maxE = -Infinity;
        let lastCross = -1;
        let crossings: number[] = [];
        let prevA = 0;
        for (let i = 1; i <= 480 * 4; i++) {
          s.stepFixed(1);
          const e = (energyTotal(s) - E0) / mgL;
          minE = Math.min(minE, e);
          maxE = Math.max(maxE, e);
          const a = a2.get() - th0;
          // upward crossings of −π/2 (bottom) give the period
          if (i > 1 && prevA > -Math.PI / 2 && a <= -Math.PI / 2) crossings.push(i / 480);
          prevA = a;
        }
        void lastCross;
        // RK4 reduced model: Ieff θ'' = −mgL cos θ (θ from horizontal, arm along +x)
        let th = 0;
        let w = 0;
        const h = 1 / 4800;
        const acc = (x: number) => (-mgL * Math.cos(x)) / Ieff;
        const cr: number[] = [];
        let pa = 0;
        for (let i = 1; i <= 4800 * 4; i++) {
          const k1 = acc(th), l1 = w;
          const k2 = acc(th + (h / 2) * l1), l2 = w + (h / 2) * k1;
          const k3 = acc(th + (h / 2) * l2), l3 = w + (h / 2) * k2;
          const k4 = acc(th + h * l3), l4 = w + h * k3;
          th += (h / 6) * (l1 + 2 * l2 + 2 * l3 + l4);
          w += (h / 6) * (k1 + 2 * k2 + 2 * k3 + k4);
          if (pa > -Math.PI / 2 && th <= -Math.PI / 2) cr.push(i / 4800);
          pa = th;
        }
        const per = crossings.length > 1 ? crossings[1]! - crossings[0]! : NaN;
        const perA = cr.length > 1 ? cr[1]! - cr[0]! : NaN;
        out(
          `${name} k ${k} ${mode.padEnd(8)}: (E−E0)/mgL min ${f(minE)} max ${f(maxE)} end ${f((energyTotal(s) - E0) / mgL)} | guardRemoved/mgL ${f(s.guardRemoved / mgL)} | same group ${s.sameGuardGroup(b1, b2)} | period ${f(per)} vs RK4 ${f(perA)} | phase max ${f(phaseTeeth(s).max)} teeth`,
        );
        s.dispose();
      }
  }
}

if (which === 'fall') {
  // Root: a lone beam far away (fixed). Gearbox: frame beam (dynamic) + two pinned gears 1:5, spun up.
  for (const k of ks)
    for (const spin of [20, 50, 100]) {
      const b = new ModelBuilder();
      const root = b.add(beam([20, 0, 0], [22, 0, 0]));
      const frame = b.add(beam([0, 0, 0], [0, 3, 0]));
      const g1 = b.add([makeCell(0, 0, 1, 'pinHole', 2)]);
      b.add([makeCell(0, 0, 0, 'frictionPin', 2), makeCell(0, 0, 1, 'pin', 2)]);
      const g2 = b.add([makeCell(0, 3, 1, 'pinHole', 2)]);
      b.add([makeCell(0, 3, 0, 'frictionPin', 2), makeCell(0, 3, 1, 'pin', 2)]);
      let m = b.root(root).build();
      m = putRims(m, [
        { part: g1, pos: [0, 0, 1], r: 0.5 },
        { part: g2, pos: [0, 3, 1], r: 2.5 },
      ]);
      const s = await Simulation.create(m, { substeps: k });
      const bf = s.bodyOf(frame)!;
      const b1 = s.bodyOf(g1)!;
      const b2 = s.bodyOf(g2)!;
      // Spin: gear 1 at +spin, gear 2 at −spin/5 (consistent), frame at rest.
      s.setBodyVelocity(b1, [0, 0, 0], [0, 0, spin]);
      s.setBodyVelocity(b2, [0, 0, 0], [0, 0, -spin / 5]);
      const L = () => {
        // angular momentum about the gearbox's centre of mass (live bodies)
        let M = 0;
        const R: number[] = [0, 0, 0];
        const V: number[] = [0, 0, 0];
        const live = [bf, b1, b2].filter((id) => s.hasBody(id));
        for (const id of live) {
          const mi = s.massInfo(id)!;
          const v = s.bodyVelocity(id)!;
          M += mi.mass;
          for (let i = 0; i < 3; i++) {
            R[i]! += mi.mass * mi.com[i]!;
            V[i]! += mi.mass * v.v[i]!;
          }
        }
        for (let i = 0; i < 3; i++) {
          R[i]! /= M;
          V[i]! /= M;
        }
        let l = 0;
        for (const id of live) {
          const mi = s.massInfo(id)!;
          const v = s.bodyVelocity(id)!;
          l += mi.inertia[8]! * v.w[2] + mi.mass * ((mi.com[0] - R[0]!) * (v.v[1] - V[1]!) - (mi.com[1] - R[1]!) * (v.v[0] - V[0]!));
        }
        return l;
      };
      const L0 = L();
      const Ispin = s.massInfo(b1)!.inertia[8]! * spin;
      const events: string[] = [];
      let prevAlive = [true, true, true];
      let maxKrel = 0;
      const K0 = s.energy().kinetic;
      const Ks0 = 0.5 * s.massInfo(b1)!.inertia[8]! * spin ** 2 + 0.5 * s.massInfo(b2)!.inertia[8]! * (spin / 5) ** 2;
      let errs = 0;
      let i = 0;
      let L05 = NaN;
      for (; i < 480 * 2; i++) {
        try {
          s.stepFixed(1);
        } catch (e) {
          errs++;
          events.push(`step ${i} threw ${(e as Error).message}`);
          break;
        }
        if (i === 239) L05 = L();
        const alive = [bf, b1, b2].map((id) => s.hasBody(id));
        alive.forEach((a, j) => {
          if (prevAlive[j] && !a) events.push(`${['frame', 'g1', 'g2'][j]} removed at ${((i + 1) / 480).toFixed(4)} s; meshes engaged ${s.meshJointCount()}, dead ${s.meshes.filter((q) => q.dead).length}, joints alive ${s.jointStates().filter((q) => q.alive).length}`);
        });
        prevAlive = alive;
        // kinetic energy in the frame of the falling box: spin energy only
        let kr = 0;
        for (const id of [bf, b1, b2]) {
          const mi = s.massInfo(id);
          const v = s.bodyVelocity(id);
          if (!mi || !v) continue;
          kr += 0.5 * mi.inertia[8]! * v.w[2] ** 2;
        }
        maxKrel = Math.max(maxKrel, kr);
        if (!alive.some(Boolean)) break;
      }
      const w1 = s.bodyVelocity(b1)?.w[2];
      const w2 = s.bodyVelocity(b2)?.w[2];
      out(`fall k ${k} spin ${spin}: L(0.5 s)/L0 ${f(L05 / L0)} (spin share of L0 ${f(Ispin / L0, 3)}) | maxSpinK/K0spin ${f(maxKrel / Ks0)} | errors ${errs} | end: ω1 ${w1 === undefined ? 'gone' : f(w1, 2)} ω2 ${w2 === undefined ? 'gone' : f(w2, 2)} | phase max ${f(phaseTeeth(s).max)} | K0 ${f(K0, 1)}`);
      for (const e of events) out('   ' + e);
      s.dispose();
    }
}
process.exit(0);
