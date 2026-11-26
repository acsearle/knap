// Ratio and phase for every meshing pair, every axis, both senses, 30 s; long trains; loops.
import { it } from 'vitest';
import { appendFileSync, writeFileSync } from 'node:fs';
import { Simulation } from '../../../src/physics/sim';
import type { Axis } from '../../../src/core/types';
import { Twist, allFinite, chain, compound, energyOf, maxV, unitAxis } from './lib';
import type { P } from './lib';

const OUT = 'spikes/review-m8/simgeo/ratio.out';
const log = (s: string) => {
  console.log(s);
  appendFileSync(OUT, s + '\n');
};

function iAbout(s: Simulation, body: number, hub: P, ax: Axis): number {
  const mi = s.massInfo(body)!;
  const d = [mi.com[0] - hub[0], mi.com[1] - hub[1], mi.com[2] - hub[2]];
  d[ax] = 0;
  return mi.inertia[ax * 4]! + mi.mass * (d[0]! ** 2 + d[1]! ** 2 + d[2]! ** 2);
}

/** Drive body 0 of `bodies` to |ω| = target (sign `sense`), then freewheel; total T seconds. */
async function runTrain(label: string, model: import('../../../src/core/types').Model, partIds: number[], ratios: number[], ax: Axis, hubs: P[], sense: number, T: number, target = 40, mu = 0) {
  const s = await Simulation.create(model, { jointFriction: mu });
  const bodies = partIds.map((p) => s.bodyOf(p)!);
  const a = unitAxis(ax);
  const tw = bodies.map((b) => new Twist(s, b, a));
  tw.forEach((t) => t.get());
  // Start every gear at its ratio's speed (a drive then freewheel would run with the guard
  // disabled: the drive's last work keeps being credited to the guard, see the review report).
  bodies.forEach((b, i) => {
    const w: P = [0, 0, 0];
    w[ax] = sense * target * ratios[i]!;
    s.setBodyVelocity(b, [0, 0, 0], w);
  });
  const driving = false;
  void iAbout;
  let maxPhase = 0;
  let maxJ = 0;
  let kmax = 1;
  const E: number[] = [];
  const n = Math.round(T * 480);
  let worst = 0;
  let nonFinite = false;
  let engagedMin = Infinity;
  for (let i = 1; i <= n; i++) {
    s.stepFixed(1);
    kmax = Math.max(kmax, s.substeps);
    const w0 = s.bodyVelocity(bodies[0]!)!.w[ax]!;
    void w0;
    for (const st of s.meshStates()) maxPhase = Math.max(maxPhase, Math.abs(st.phaseErrorTeeth));
    engagedMin = Math.min(engagedMin, s.meshStates().length);
    maxJ = Math.max(maxJ, s.jointError());
    if (!driving) E.push(energyOf(s));
    if (i % 480 === 0) {
      const th = tw.map((t) => t.get());
      for (let k = 1; k < th.length; k++) {
        const exp = ratios[k]! / ratios[0]!;
        const err = Math.abs(th[k]! / th[0]! / exp - 1);
        worst = Math.max(worst, err);
      }
    } else tw.forEach((t) => t.get());
    if (!allFinite(s)) {
      nonFinite = true;
      break;
    }
  }
  const th = tw.map((t) => t.get());
  const w = bodies.map((b) => s.bodyVelocity(b)!.w[ax]!);
  const e0 = E[0] ?? NaN;
  const eMax = Math.max(...E);
  const eMin = Math.min(...E);
  const diag = s.meshDiagnostics();
  log(
    `${label} sense ${sense > 0 ? '+' : '-'}: θ0 ${th[0]!.toFixed(1)} rad, ω ${w.map((x) => x.toFixed(2)).join('/')}, worst ratio err ${worst.toExponential(2)}, phase max ${maxPhase.toExponential(2)} teeth, jointErr ${maxJ.toExponential(2)}, k max ${kmax}, engaged min ${engagedMin}/${diag.length}, E free-run [${((eMin / e0 - 1) * 100).toFixed(3)} %, ${((eMax / e0 - 1) * 100).toFixed(3)} %], releases ${diag.map((d) => d.releases).join(',')}, finite ${!nonFinite}, maxω ${maxV(s).w.toFixed(1)}`,
  );
  s.dispose();
  return { worst, maxPhase, maxJ, eMax: eMax / e0 - 1, eMin: eMin / e0 - 1 };
}

it('every meshing pair × axis × sense, 30 s', async () => {
  writeFileSync(OUT, '');
  const pairs: [number, number][] = [
    [0.5, 0.5], [0.5, 1.5], [1, 1], [0.5, 2.5], [1.5, 1.5], [1.5, 2.5], [2.5, 2.5], [2.5, 0.5], [1.5, 0.5], [2.5, 1.5],
  ];
  for (const ax of [0, 1, 2] as Axis[])
    for (const [ra, rb] of pairs)
      for (const sense of [1, -1]) {
        const { model, parts, pos } = chain(ax, [ra, rb]);
        const hubs = pos.map((u) => {
          const p: P = [0, 0, 0];
          const b = ax === 0 ? [1, 2] : ax === 1 ? [2, 0] : [0, 1];
          p[b[0]!] = u;
          p[ax] = 1;
          return p;
        });
        await runTrain(`pair ${ra}+${rb} axis ${ax}`, model, parts, [1, -ra / rb], ax, hubs, sense, 30);
      }
});

it('idler chains and long compound trains 1:5, 1:25, 1:125 (axis Z and X)', async () => {
  for (const ax of [2, 0] as Axis[]) {
    for (const radii of [[1, 1, 1, 1, 1, 1], [0.5, 1.5, 0.5, 2.5, 2.5, 1.5]]) {
      const { model, parts, pos } = chain(ax, radii);
      const ratios = [1];
      for (let i = 1; i < radii.length; i++) ratios.push(-ratios[i - 1]! * (radii[i - 1]! / radii[i]!));
      const hubs = pos.map((u) => {
        const p: P = [0, 0, 0];
        const b = ax === 0 ? [1, 2] : ax === 1 ? [2, 0] : [0, 1];
        p[b[0]!] = u;
        p[ax] = 1;
        return p;
      });
      for (const sense of [1, -1]) await runTrain(`chain ${radii.join(',')} axis ${ax}`, model, parts, ratios, ax, hubs, sense, 30);
    }
    for (const N of [1, 2, 3]) {
      const { model, parts } = compound(ax, N);
      const ratios = parts.map((_, i) => (-1 / 5) ** i);
      const hubs = parts.map((_, i) => {
        const p: P = [0, 0, 0];
        const b = ax === 0 ? [1, 2] : ax === 1 ? [2, 0] : [0, 1];
        p[b[0]!] = 3 * i;
        p[ax] = N;
        return p;
      });
      for (const sense of [1, -1]) await runTrain(`compound 1:${5 ** N} axis ${ax}`, model, parts, ratios, ax, hubs, sense, 30, 100);
    }
  }
});
