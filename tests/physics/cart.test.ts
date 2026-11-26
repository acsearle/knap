// A free cart on the ground (DESIGN §2.6 "Free root", §5.1 "Free root", §5.3 "Cart",
// "Determinism"): chassis, four r = 1.5 wheels each on its own axle (wheelModels.cart), nothing
// fixed. Also the joint-friction load with ground sinks and an off-centre crank on a free vehicle.
import { describe, expect, it } from 'vitest';
import { addPart, makeCell } from '../../src/core/model';
import { G, Simulation } from '../../src/physics/sim';
import { R_BORE } from '../../src/geometry/dims';
import { report, total } from './helpers';
import { axialInertia, cart, poseHash, pushVehicle, rollRadius, totalMass } from './wheelModels';

const r = 1.5;
const R = rollRadius(r);

async function make(opts: Parameters<typeof Simulation.create>[1] = {}) {
  const c = cart(r);
  const s = await Simulation.create(c.model, opts);
  const wheels = c.wheels.map((id) => s.bodyOf(id)!);
  const chassis = s.bodyOf(c.chassis)!;
  const M = totalMass(s);
  const sumI = wheels.reduce((a, id) => a + axialInertia(s, id, 2), 0);
  return { s, wheels, chassis, M, sumI };
}

describe('free cart', () => {
  it('no body is fixed; the four wheels touching the ground are the load sinks; each axle carries a quarter of the chassis', async () => {
    const { s, wheels, chassis, M } = await make();
    expect(s.graph.bodies.every((b) => !b.fixed)).toBe(true);
    for (const w of wheels) expect(s.isGroundSink(w)).toBe(true);
    expect(s.isGroundSink(chassis)).toBe(false);
    const mc = s.massInfo(chassis)!.mass;
    const mw = s.massInfo(wheels[0]!)!.mass;
    const js = s.jointStates();
    expect(js.length).toBe(4);
    for (const j of js) {
      expect(j.loadMass).toBeCloseTo(mc / 4, 9); // analytic quarter chassis = (M − Σ m_wheel)/4
      expect(j.frictionTorque).toBeCloseTo(0.2 * (mc / 4) * G * R_BORE, 6);
    }
    expect(mc / 4).toBeCloseTo((M - 4 * mw) / 4, 9);
    report(`cart: M ${M.toFixed(3)}, chassis ${mc.toFixed(3)}, wheel ${mw.toFixed(3)}; axle load ${js[0]!.loadMass.toFixed(4)} = chassis/4 (the lighter-body fallback would give ${Math.min(mw, mc).toFixed(3)}, ×${(Math.min(mw, mc) / (mc / 4)).toFixed(2)})`);
    s.dispose();
  });

  it('at rest for 30 s: drifts < 0.01 units, joint error ≤ 1e-3, nothing removed', async () => {
    const { s, chassis } = await make();
    const c0 = s.massInfo(chassis)!.com;
    let jerr = 0;
    for (let i = 0; i < 480 * 30; i++) {
      s.stepFixed(1);
      if (i % 8 === 0) jerr = Math.max(jerr, s.jointError());
    }
    const c = s.massInfo(chassis)!.com;
    const drift = Math.hypot(c[0] - c0[0], c[2] - c0[2]);
    report(`cart at rest 30 s: drift ${drift.toExponential(2)} units, sank ${(c0[1] - c[1]).toExponential(2)}, joint error ≤ ${jerr.toExponential(1)}`);
    expect(drift).toBeLessThan(0.01);
    expect(Math.abs(c[1] - c0[1])).toBeLessThan(0.03);
    expect(jerr).toBeLessThan(1e-3);
    expect(s.graph.bodies.every((b) => s.hasBody(b.id))).toBe(true);
    s.dispose();
  }, 120000);

  it('friction off, pushed to 40 units/s: keeps its speed within 2 % for 5 s', async () => {
    const { s, wheels, chassis } = await make({ jointFriction: 0 });
    pushVehicle(s, 40, wheels, R);
    let lo = Infinity;
    let hi = -Infinity;
    let jerr = 0;
    for (let i = 0; i < 480 * 5; i++) {
      s.stepFixed(1);
      const v = s.bodyVelocity(chassis)!.v[0];
      lo = Math.min(lo, v);
      hi = Math.max(hi, v);
      if (i % 8 === 0) jerr = Math.max(jerr, s.jointError());
    }
    report(`cart pushed to 40, friction off: chassis speed ${lo.toFixed(3)}…${hi.toFixed(3)} over 5 s, joint error ≤ ${jerr.toExponential(1)}, guard removed ${s.guardRemoved.toFixed(0)}`);
    expect(Math.abs(lo - 40) / 40).toBeLessThan(0.02);
    expect(Math.abs(hi - 40) / 40).toBeLessThan(0.02);
    s.dispose();
  }, 60000);

  it('friction Realistic: coasts to a stop within ±10 % of v₀²/(2·decel) (corrected load) and then does not creep', async () => {
    for (const v0 of [10, 40]) {
      const { s, wheels, chassis, M, sumI } = await make();
      const tau = s.jointStates().reduce((a, j) => a + j.frictionTorque, 0); // = 4·τ_f
      const decel = tau / (R * (M + sumI / (R * R)));
      const want = (v0 * v0) / (2 * decel);
      pushVehicle(s, v0, wheels, R);
      const x0 = s.massInfo(chassis)!.com[0];
      let stopAt = -1;
      let xStop = 0;
      for (let i = 0; i < 480 * 10; i++) {
        s.stepFixed(1);
        if (stopAt < 0 && Math.abs(s.bodyVelocity(chassis)!.v[0]) < 0.01) {
          stopAt = s.time;
          xStop = s.massInfo(chassis)!.com[0] - x0;
        }
        if (stopAt >= 0 && s.time > stopAt + 5) break;
      }
      const creep = s.massInfo(chassis)!.com[0] - x0 - xStop;
      report(`cart coasting from ${v0}: stops after ${xStop.toFixed(3)} units at ${stopAt.toFixed(2)} s, predicted ${want.toFixed(3)} (${(((xStop - want) / want) * 100).toFixed(2)} %), then moves ${creep.toExponential(1)} in 5 s`);
      expect(stopAt).toBeGreaterThan(0);
      expect(Math.abs(xStop - want) / want).toBeLessThan(0.1);
      expect(Math.abs(creep)).toBeLessThan(1e-3);
      s.dispose();
    }
  }, 120000);

  it('friction off on a 15° incline: accelerates within 2 % of M·g·sinθ/(M + ΣI/r²)', async () => {
    // The slope is applied by tilting gravity (exactly equivalent to tilting the floor, and the
    // cart starts on its four wheels). With groundSlopeDeg the level cart first tips onto the
    // tilted floor at its rear wheels and lands on the front ones (see DEVIATIONS §5).
    for (const deg of [5, 15]) {
      const th = (deg * Math.PI) / 180;
      const { s, chassis, M, sumI } = await make({ jointFriction: 0, gravity: [G * Math.sin(th), -G * Math.cos(th), 0] });
      const a0 = (M * G * Math.sin(th)) / (M + sumI / (R * R));
      s.stepFixed(24);
      const ts: number[] = [];
      const vs: number[] = [];
      for (let i = 0; i < 240; i++) {
        s.stepFixed(1);
        ts.push(s.time);
        vs.push(s.bodyVelocity(chassis)!.v[0]);
      }
      const n = ts.length;
      const mt = ts.reduce((a, b) => a + b) / n;
      const mv = vs.reduce((a, b) => a + b) / n;
      let sxy = 0;
      let sxx = 0;
      for (let i = 0; i < n; i++) {
        sxy += (ts[i]! - mt) * (vs[i]! - mv);
        sxx += (ts[i]! - mt) ** 2;
      }
      const a = sxy / sxx;
      report(`cart on ${deg}°, friction off: a ${a.toFixed(2)} vs ${a0.toFixed(2)} (${(((a - a0) / a0) * 100).toFixed(2)} %)`);
      expect(Math.abs(a - a0) / a0).toBeLessThan(0.02);
      s.dispose();
    }
  }, 60000);

  it('friction off, rolling at 100 units/s for 10 s: the energy guard keeps the energy within 1 % (it only removes)', async () => {
    const { s, wheels } = await make({ jointFriction: 0 });
    pushVehicle(s, 100, wheels, R);
    s.stepFixed(1);
    const e0 = total(s.energy());
    let eMax = e0;
    for (let i = 0; i < 480 * 10; i++) {
      s.stepFixed(1);
      if (i % 8 === 0) eMax = Math.max(eMax, total(s.energy()));
    }
    const e1 = total(s.energy());
    report(`cart at 100 units/s, friction off, 10 s: energy ${(((e1 - e0) / e0) * 100).toFixed(2)} % (max ${(((eMax - e0) / e0) * 100).toFixed(2)} %), guard removed ${s.guardRemoved.toFixed(0)} of ${e0.toFixed(0)}`);
    expect((eMax - e0) / e0).toBeLessThan(0.01);
    expect(e1).toBeLessThanOrEqual(eMax);
    s.dispose();
  }, 60000);

  it('is deterministic: the same run twice gives identical pose hashes', async () => {
    const hashes: string[] = [];
    for (let k = 0; k < 2; k++) {
      const { s, wheels } = await make();
      pushVehicle(s, 20, wheels, R);
      s.stepFixed(960);
      hashes.push(poseHash(s));
      s.dispose();
    }
    expect(hashes[0]).toBe(hashes[1]);
  });

  it('a free vehicle with an off-centre crank (a friction pin sticking out of a crank hole of one wheel) stays bounded', async () => {
    // DESIGN §5.1 "Products of inertia … only dropped for mechanisms attached to a fixed body. A
    // free vehicle with an off-centre crank is a known risk: test it, and record what happens."
    // The wheel at (6, 0, 3) gets a crank hole next to its hub, at (7, 0, 3) in its own layer, and
    // a 2-cell friction pin welded in it that sticks out to z = 4, so the wheel body has products
    // of inertia with its axle's axis (Z).
    const c = cart(r);
    const hub = c.model.parts.find((p) => p.id === c.wheels[3])!.cells[0]!;
    let m = c.model;
    const wheel = m.parts.find((p) => p.id === c.wheels[3])!;
    m = { ...m, parts: m.parts.map((p) => (p === wheel ? { ...p, cells: [...p.cells, makeCell(hub.x + 1, hub.y, hub.z, 'pinHole', 2)] } : p)) };
    m = addPart(m, [makeCell(hub.x + 1, hub.y, hub.z, 'frictionPin', 2), makeCell(hub.x + 1, hub.y, hub.z + 1, 'frictionPin', 2)]).model;
    const s = await Simulation.create(m, { jointFriction: 0 });
    const wb = s.bodyOf(c.wheels[3]!)!;
    const I = s.massInfo(wb)!.inertia;
    const products = Math.hypot(I[2]!, I[5]!);
    const chassis = s.bodyOf(c.chassis)!;
    pushVehicle(s, 40, c.wheels.map((id) => s.bodyOf(id)!), R);
    s.stepFixed(1);
    const e0 = total(s.energy());
    let eMax = e0;
    let wMax = 0;
    let tilt = 0;
    for (let i = 0; i < 480 * 10; i++) {
      s.stepFixed(1);
      if (i % 4) continue;
      eMax = Math.max(eMax, total(s.energy()));
      wMax = Math.max(wMax, Math.hypot(...s.bodyVelocity(wb)!.w));
      const q = s.bodyTransform(chassis)!.q;
      tilt = Math.max(tilt, 2 * Math.asin(Math.min(1, Math.hypot(q[0], q[1]))));
    }
    const v = s.bodyVelocity(chassis)!.v[0];
    report(`free cart with an off-centre crank (products of inertia ${products.toFixed(3)}), friction off, pushed to 40: after 10 s chassis speed ${v.toFixed(2)}, crank wheel |ω| ≤ ${wMax.toFixed(1)} rad/s (rolling: ${(40 / R).toFixed(1)}), energy ≤ ${(((eMax - e0) / e0) * 100).toFixed(2)} % above start, chassis tilt ≤ ${tilt.toFixed(3)} rad, joint error ${s.jointError().toExponential(1)}`);
    expect(products).toBeGreaterThan(0.01);
    expect(Number.isFinite(v)).toBe(true);
    expect((eMax - e0) / e0).toBeLessThan(0.01);
    expect(wMax).toBeLessThan(1.5 * (40 / R));
    expect(s.jointError()).toBeLessThan(1e-3);
    s.dispose();
  }, 60000);
});
