// Gears and the ground / loose parts: start gap at Play, rest, lying flat, rolling on the teeth, a
// gear on a loose beam (sink), a beam on a gear, a geared cart.
import { it } from 'vitest';
import { appendFileSync, writeFileSync } from 'node:fs';
import { ModelBuilder, beam } from '../../../src/core/examples';
import { makeCell, setFixRoot, setGround, setRim, validateModel } from '../../../src/core/model';
import type { Axis, Model } from '../../../src/core/types';
import { Simulation } from '../../../src/physics/sim';
import { looseGear } from '../../../tests/physics/gearModels';
import { energyOf, finish } from './lib';

const OUT = 'spikes/review-m8/simgeo/ground.out';
const log = (s: string) => {
  console.log(s);
  appendFileSync(OUT, s + '\n');
};
const R = [0.5, 1, 1.5, 2.5];

it('loose gear on the floor: start gap, 5 s rest (upright about Z and X, lying flat about Y)', async () => {
  writeFileSync(OUT, '');
  for (const r of R)
    for (const axis of [2, 0, 1] as Axis[]) {
      const m = looseGear(r, axis);
      const s = await Simulation.create(m);
      const t0 = s.bodyTransform(0)!;
      const lowest = axis === 1 ? 0 - 0.46 : 0 - (r + 0.085);
      const gap0 = lowest - s.groundY!;
      let ymin = Infinity;
      let drift = 0;
      let tilt = 0;
      for (let i = 0; i < 2400; i++) {
        s.stepFixed(1);
        const t = s.bodyTransform(0)!;
        ymin = Math.min(ymin, t.p[1]);
        drift = Math.max(drift, Math.hypot(t.p[0] - t0.p[0], t.p[2] - t0.p[2]));
        tilt = Math.max(tilt, 2 * Math.acos(Math.min(1, Math.abs(t.q[3]))));
      }
      log(`loose gear r ${r} axis ${axis}: start gap ${gap0.toExponential(2)} (groundY ${s.groundY!.toFixed(4)}), hub dropped ${(-ymin).toExponential(2)}, drift ${drift.toExponential(2)}, rotation ${tilt.toExponential(2)} rad`);
      s.dispose();
    }
});

it('gear rolling on its teeth at 40 units/s over 160 units (friction off)', async () => {
  for (const r of R) {
    const m = looseGear(r, 2);
    const s = await Simulation.create(m, { jointFriction: 0 });
    const Rc = r + 0.085;
    s.setBodyVelocity(0, [40, 0, 0], [0, 0, -40 / Rc]);
    let ymin = Infinity;
    let zdrift = 0;
    const n = Math.round((160 / 40) * 480);
    let vEnd = 0;
    let wEnd = 0;
    for (let i = 0; i < n; i++) {
      s.stepFixed(1);
      const t = s.bodyTransform(0)!;
      ymin = Math.min(ymin, t.p[1]);
      zdrift = Math.max(zdrift, Math.abs(t.p[2]));
    }
    const v = s.bodyVelocity(0)!;
    vEnd = v.v[0]!;
    wEnd = v.w[2]!;
    log(`gear r ${r} rolling: v end ${vEnd.toFixed(3)} (${((vEnd / 40 - 1) * 100).toFixed(2)} %), ω·Rc ${(-wEnd * Rc).toFixed(3)}, hub dropped ${(-ymin).toExponential(2)}, z drift ${zdrift.toExponential(2)}`);
    s.dispose();
  }
});

/** A loose 7-hole beam lying flat on the floor (holes along Y) and a loose gear resting on it. */
function gearOnBeam(r: number, axis: Axis, du = 0): Model {
  const b = new ModelBuilder();
  const bm = b.add(beam([-3, 0, 0], [3, 0, 0], 1)); // holes along Y: the beam lies flat
  let cell;
  if (axis === 1) cell = makeCell(du, 1, 0, 'pinHole', 1); // lying flat on the beam
  else cell = makeCell(du, Math.ceil(0.5 + r + 0.125), 0, 'pinHole', axis); // upright above it
  const g = b.add([cell]);
  return finish(b, bm, [[g, [cell.x, cell.y, cell.z], r]], { ground: true, free: true });
}

it('gear on a loose beam lying on the floor: sink at rest (DESIGN: ≤ 0.05 as for wheels)', async () => {
  for (const r of R)
    for (const [axis, du] of [[2, 0], [0, 0], [1, 0], [1, 1], [1, 2]] as [Axis, number][]) {
      let m: Model;
      try {
        m = gearOnBeam(r, axis, du);
      } catch (e) {
        log(`gear r ${r} axis ${axis} du ${du} on beam: invalid (${(e as Error).message})`);
        continue;
      }
      const s = await Simulation.create(m);
      const g = s.bodyOf(m.parts[1]!.id)!;
      const bb = s.bodyOf(m.parts[0]!.id)!;
      for (let i = 0; i < 480 * 4; i++) s.stepFixed(1);
      // sink: deepest contact between the gear and the beam (negative = penetration)
      const depth = s.contactDepth(g, bb);
      const tb = s.bodyTransform(bb)!;
      const tg = s.bodyTransform(g)!;
      // geometric: for an upright gear, beam top (y 0.5 → HC 0.46 collider) vs gear hub − (r+0.085)
      const beamTop = tb.p[1] + 0.46;
      const gearLow = axis === 1 ? tg.p[1] + 1 - 0.46 : tg.p[1] + m.parts[1]!.cells[0]!.y - (r + 0.085);
      log(`gear r ${r} axis ${axis} du ${du} on a loose beam: contact depth ${depth === null ? 'none' : depth.toFixed(4)}, gear lowest − beam top ${(gearLow - beamTop).toFixed(4)} (approx, untilted), beam dropped ${(-tb.p[1]).toFixed(4)}, gear dropped ${(-tg.p[1]).toFixed(4)}, E ${energyOf(s).toFixed(1)}`);
      s.dispose();
    }
});

it('beam dropped onto a fixed gear rests on the tip radius', async () => {
  for (const r of R) {
    const b = new ModelBuilder();
    const g = b.add([makeCell(0, 0, 0, 'pinHole', 2)]);
    const top = Math.ceil(r + 0.125 + 0.5) + 2;
    const bm = b.add(beam([-3, top, 0], [3, top, 0]));
    const m = finish(b, g, [[g, [0, 0, 0], r]]);
    const s = await Simulation.create(m);
    const B = s.bodyOf(bm)!;
    for (let i = 0; i < 480 * 3; i++) s.stepFixed(1);
    const t = s.bodyTransform(B)!;
    const beamBottom = top + t.p[1] - 0.46;
    log(`beam on fixed gear r ${r}: beam bottom ${beamBottom.toFixed(4)} vs tip collider ${(r + 0.085).toFixed(4)} (diff ${(beamBottom - r - 0.085).toFixed(4)}), drawn tip ${(r + 3 / 32).toFixed(4)}, beam slid ${t.p[0].toFixed(3)}, alive ${s.hasBody(B)}`);
    s.dispose();
  }
});

/** A free cart: chassis beams, wheels r 2.5 at x 0 and 6 on pins (layers −1 and 3), each with a 24 in layer −2 / 4; idler 24s at x 3 on the chassis. */
function gearedCart(idler = true): { model: Model; wheels: number[]; chassis: number; idlers: number[] } {
  const b = new ModelBuilder();
  const chassis = b.add([...beam([0, 0, 0], [6, 0, 0]), makeCell(3, 0, 1, 'pinHole', 2), ...beam([0, 0, 2], [6, 0, 2])]);
  const wheels: number[] = [];
  const idlers: number[] = [];
  const gears: [number, [number, number, number], number][] = [];
  for (const [zc, zw, zg] of [[0, -1, -2], [2, 3, 4]] as const) {
    for (const x of [0, 6]) {
      b.add([makeCell(x, 0, zc, 'frictionPin', 2), makeCell(x, 0, zw, 'pin', 2)]);
      const w = b.add([makeCell(x, 0, zw, 'pinHole', 2), makeCell(x, 0, zg, 'pinHole', 2)]);
      wheels.push(w);
      gears.push([w, [x, 0, zg], 1.5]);
    }
    if (idler) {
      b.add([makeCell(3, 0, zc, 'frictionPin', 2), makeCell(3, 0, zw, 'pin', 2)]);
      const id = b.add([makeCell(3, 0, zw, 'pinHole', 2), makeCell(3, 0, zg, 'pinHole', 2)]);
      idlers.push(id);
      gears.push([id, [3, 0, zg], 1.5]);
    }
  }
  let m = finish(b, chassis, gears);
  for (const w of wheels) {
    const c = m.parts.find((p) => p.id === w)!.cells[0]!;
    m = setRim(m, w, [c.x, c.y, c.z], 2.5);
  }
  m = setFixRoot(setGround(m, true), false);
  const errs = validateModel(m);
  if (errs.length) throw new Error(JSON.stringify(errs.slice(0, 3)));
  return { model: m, wheels, chassis, idlers };
}

it('geared cart: rest 20 s, push at 40 units/s friction off and Realistic', async () => {
  const c = gearedCart();
  for (const [label, mu, v] of [['rest', 0.2, 0], ['push μ 0', 0, 40], ['push μ 0.2', 0.2, 40], ['push μ 0.05', 0.05, 20]] as const) {
    const s = await Simulation.create(c.model, { jointFriction: mu });
    const ch = s.bodyOf(c.chassis)!;
    const wb = c.wheels.map((w) => s.bodyOf(w)!);
    const ib = c.idlers.map((w) => s.bodyOf(w)!);
    s.stepFixed(1);
    const engagedAtStart = s.meshStates().length;
    if (v) for (const b of s.graph.bodies) s.setBodyVelocity(b.id, [v, 0, 0], wb.includes(b.id) ? [0, 0, -v / 2.46] : ib.includes(b.id) ? [0, 0, v / 2.46] : [0, 0, 0]);
    const p0 = s.bodyTransform(ch)!.p;
    const E0 = energyOf(s);
    let ymin = Infinity;
    let eMax = E0;
    let jmax = 0;
    const T = label === 'rest' ? 20 : 5;
    let vAt5 = 0;
    for (let i = 1; i <= T * 480; i++) {
      s.stepFixed(1);
      const t = s.bodyTransform(ch)!;
      ymin = Math.min(ymin, t.p[1] - p0[1]);
      eMax = Math.max(eMax, energyOf(s));
      jmax = Math.max(jmax, s.jointError());
    }
    vAt5 = s.bodyVelocity(ch)!.v[0]!;
    const t = s.bodyTransform(ch)!;
    const yaw = 2 * Math.asin(Math.min(1, Math.abs(t.q[1])));
    log(`geared cart ${label}: engaged at start ${engagedAtStart}/${s.meshDiagnostics().length}, travelled ${(t.p[0] - p0[0]).toFixed(3)}, z drift ${(t.p[2] - p0[2]).toExponential(2)}, yaw ${yaw.toExponential(2)} rad, chassis sank ${(-ymin).toExponential(2)}, v end ${vAt5.toFixed(3)}, E max − E0 ${(eMax - E0).toFixed(2)} (E0 ${E0.toFixed(1)}), joint err max ${jmax.toExponential(2)}, releases ${s.meshDiagnostics().map((d) => d.releases).join(',')}`);
    s.dispose();
  }
});
