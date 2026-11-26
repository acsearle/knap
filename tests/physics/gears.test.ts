// DESIGN §5.3 "Gears" (part 1): mesh basics, ratio, collisions, smaller steps, removal, locked
// trains. Friction off and the energy guard on unless stated. Motion tests: gears-motion.test.ts.
import { describe, expect, it } from 'vitest';
import { RAPIER, initPhysics } from '../../src/physics/rapier';
import { GEAR_PITCH, GEAR_SPEED_CAP, MESH, Simulation } from '../../src/physics/sim';
import { groundPlane, partShapes } from '../../src/physics/shapes';
import { ModelBuilder, beam } from '../../src/core/examples';
import { makeCell, setGear } from '../../src/core/model';
import { HC } from '../../src/geometry/dims';
import { AngleZ, compound25, finish, freeGearbox, gearPair, idlerChain, izAbout, lockedTrain, looseGear, maxOmega, omega, phaseNow, totalEnergy } from './gearModels';
import { report } from './helpers';

const DT = 1 / 480;

describe('gear colliders and mass (DESIGN §4.3, §5.1 "Gears")', () => {
  it('a gear part yields the wheel shape at the tip radius with the solid pitch-disc mass', () => {
    const { model, part } = gearPair(0.5, 2.5);
    const B = model.parts.find((p) => p.id === part.B!)!;
    const shapes = partShapes(B, 16);
    const wheels = shapes.filter((s) => s.kind === 'wheel');
    expect(wheels).toHaveLength(1);
    const w = wheels[0]!;
    if (w.kind !== 'wheel') throw new Error('unreachable');
    expect(w.radius).toBeCloseTo(2.5 + 0.085, 12);
    expect(w.gear).toEqual({ pitch: 2.5 });
    expect(w.mass.volume).toBeCloseTo(Math.PI * 2.5 ** 2 * 2 * HC, 12);
    expect(w.mass.inertia[2]).toBeCloseTo((w.mass.volume * 2.5 ** 2) / 2, 9);
  });

  it('engine mass of a lone gear column = pivot barrel + solid pitch disc; Rapier enum LinY = 1', async () => {
    await initPhysics();
    expect(RAPIER.JointAxis.LinY).toBe(1); // sim.ts LIN_Y
    const { model, part } = gearPair(0.5, 2.5);
    const s = await Simulation.create(model, { jointFriction: 0 });
    const mB = s.massInfo(s.bodyOf(part.B!)!)!.mass;
    const disc = Math.PI * 2.5 ** 2 * 2 * HC;
    report(`gear mass: 40-tooth column ${mB.toFixed(4)} (disc ${disc.toFixed(4)})`);
    expect(mB).toBeGreaterThan(disc);
    expect(mB).toBeLessThan(disc + 1); // + the pivot barrel (≈ 0.6)
    s.dispose();
  });

  it('collision groups: gear colliders never meet another gear; gear round meets ground and plain rounds; gear hull meets parts', async () => {
    const gr = (0x20 << 16) | (0x1 | 0x2);
    const gh = (0x40 << 16) | 0x8;
    const groups = { ground: (0x1 << 16) | (0x2 | 0x8 | 0x10 | 0x20), round: (0x2 << 16) | (0x1 | 0x2 | 0x20), hull: (0x4 << 16) | 0x8, part: (0x8 << 16) | (0x1 | 0x4 | 0x8 | 0x40), guard: (0x10 << 16) | 0x1, gearRound: gr, gearHull: gh };
    const meets = (a: number, b: number) => ((a >>> 16) & (b & 0xffff)) !== 0 && ((b >>> 16) & (a & 0xffff)) !== 0;
    expect(meets(gr, gr)).toBe(false);
    expect(meets(gr, gh)).toBe(false);
    expect(meets(gh, gh)).toBe(false);
    expect(meets(gr, groups.guard)).toBe(false);
    expect(meets(gr, groups.ground)).toBe(true);
    expect(meets(gr, groups.round)).toBe(true);
    expect(meets(gr, groups.part)).toBe(false);
    expect(meets(gr, groups.hull)).toBe(false);
    expect(meets(gh, groups.part)).toBe(true);
    expect(meets(gh, groups.ground)).toBe(false);
    expect(meets(gh, groups.round)).toBe(false);
    expect(meets(gh, groups.hull)).toBe(false);
    const { model } = gearPair(0.5, 2.5);
    const s = await Simulation.create(model, { jointFriction: 0 });
    const world = (s as unknown as { world: { forEachCollider(f: (c: { collisionGroups(): number; friction(): number; density(): number; shape: { type: number } }) => void): void } }).world;
    const seen = new Map<number, number>();
    let roundFriction: number[] = [];
    world.forEachCollider((c) => {
      seen.set(c.collisionGroups(), (seen.get(c.collisionGroups()) ?? 0) + 1);
      if (c.collisionGroups() === gr) roundFriction.push(c.friction());
    });
    expect(seen.get(gr)).toBe(2);
    expect(seen.get(gh)).toBe(2 * 64);
    expect(seen.get(groups.guard)).toBeUndefined(); // no ground: no guard
    roundFriction = roundFriction.map((f) => Math.round(f * 1e6) / 1e6);
    expect(roundFriction).toEqual([0.4, 0.4]);
    s.dispose();
  });

  it('groundPlane counts a gear: a horizontal-axis gear on the ground is tangent at r + 0.085', () => {
    for (const r of [0.5, 1, 1.5, 2.5]) {
      const pl = groundPlane(looseGear(r, 2))!;
      expect(pl.d).toBeCloseTo(-(r + 0.085), 12);
      const flat = groundPlane(looseGear(r, 1))!; // axis vertical: the hub barrel's height
      expect(flat.d).toBeCloseTo(-HC, 12);
    }
  });
});

describe('mesh engagement (DESIGN §5.1 "Gears")', () => {
  it('every pair built in mesh engages on the first step with snap 0 and no phase error', async () => {
    for (const [name, rig] of [
      ['1:1', gearPair(1, 1)],
      ['1:3', gearPair(0.5, 1.5)],
      ['1:5', gearPair(0.5, 2.5)],
      ['1:25', compound25(0)],
      ['idler', idlerChain(5)],
      ['locked', lockedTrain()],
    ] as const) {
      const s = await Simulation.create(rig.model, { jointFriction: 0 });
      s.stepFixed(1);
      const d = s.meshDiagnostics();
      const engaged = d.filter((m) => m.engaged);
      report(`built in mesh ${name}: ${engaged.length} of ${d.length} candidates engaged, snaps ${engaged.map((m) => m.lastSnap).join(',')}`);
      expect(engaged.length, name).toBe(name === '1:25' ? 2 : name === 'idler' ? 4 : name === 'locked' ? 2 : 1);
      for (const m of engaged) {
        expect(m.lastSnap, name).toBe(0);
        expect(Math.abs(m.gap), name).toBeLessThan(1e-6);
        expect(m.engagements).toBe(1);
      }
      expect(s.meshStates()).toHaveLength(engaged.length);
      s.dispose();
    }
  });

  it('meshStates reports part ids, hub cell indices, tooth counts and the phase error', async () => {
    const { model, part } = gearPair(0.5, 2.5);
    const s = await Simulation.create(model, { jointFriction: 0 });
    expect(s.meshStates()).toEqual([]); // before the first step nothing is engaged
    s.stepFixed(1);
    expect(s.meshStates()).toEqual([{ a: { partId: part.A, cell: 1 }, b: { partId: part.B, cell: 1 }, teethA: 8, teethB: 40, phaseErrorTeeth: 0 }]);
    s.dispose();
  });

  it('the grab mechanism mass counts bodies linked through engaged meshes', async () => {
    const { model, part } = gearPair(0.5, 2.5, { armB: 3 });
    const s = await Simulation.create(model, { jointFriction: 0 });
    const A = s.bodyOf(part.A!)!;
    const B = s.bodyOf(part.B!)!;
    const mm = (id: number) => (s as unknown as { mechanismMass(id: number): number }).mechanismMass(id);
    const mA = s.massInfo(A)!.mass;
    const mB = s.massInfo(B)!.mass;
    expect(mm(A)).toBeCloseTo(mA, 9); // not engaged yet
    s.stepFixed(1);
    expect(mm(A)).toBeCloseTo(mA + mB, 9);
    expect(mm(B)).toBeCloseTo(mA + mB, 9);
    s.dispose();
  });

  it('an 8 and a 40 built in mesh start with no contact between them (gear colliders never meet)', async () => {
    const { model, part } = gearPair(0.5, 2.5, { armB: 3 });
    const s = await Simulation.create(model, { jointFriction: 0 });
    const A = s.bodyOf(part.A!)!;
    const B = s.bodyOf(part.B!)!;
    let contact: number | null = null;
    for (let i = 0; i < 240; i++) {
      s.stepFixed(1);
      const c = s.contactDepth(A, B);
      if (c !== null) contact = contact === null ? c : Math.min(contact, c);
    }
    report(`8 + 40 in mesh: contact between the gear bodies over 0.5 s: ${contact}`);
    expect(contact).toBeNull();
    s.dispose();
  });
});

/** Drive the input of a train from rest with τ = 40·I_eff for 1 s (→ 40 rad/s), measure ratio and phase. */
async function ratioRun(name: string, rig: { model: Parameters<typeof Simulation.create>[0]; part: Record<string, number> }, input: string, outs: [string, number][]) {
  const s = await Simulation.create(rig.model, { jointFriction: 0 });
  const inB = s.bodyOf(rig.part[input]!)!;
  const bodies = outs.map(([p, r]) => [s.bodyOf(rig.part[p]!)!, r] as const);
  s.stepFixed(1);
  let Ieff = s.massInfo(inB)!.inertia[8]!;
  for (const [b, r] of bodies) Ieff += r * r * s.massInfo(b)!.inertia[8]!;
  s.setDriveTorque(inB, [0, 0, 40 * Ieff]);
  const aIn = new AngleZ(s, inB);
  const aOut = bodies.map(([b]) => new AngleZ(s, b));
  aIn.get();
  aOut.forEach((a) => a.get());
  let phase = 0;
  let jerr = 0;
  let ratioErr = 0;
  let kMax = 1;
  for (let i = 1; i <= 480; i++) {
    s.stepFixed(1);
    phase = Math.max(phase, phaseNow(s));
    jerr = Math.max(jerr, s.jointError());
    kMax = Math.max(kMax, s.substeps);
    const th = aIn.get();
    if (Math.abs(th) > 1)
      bodies.forEach(([, r], j) => {
        ratioErr = Math.max(ratioErr, Math.abs(aOut[j]!.get() / th / r - 1));
      });
  }
  const wIn = omega(s, inB);
  report(`ratio ${name}: ω_in ${wIn.toFixed(2)} rad/s after 1 s, ratio error ${ratioErr.toExponential(2)}, phase ${phase.toExponential(2)} teeth, joint error ${jerr.toExponential(2)}, k max ${kMax}`);
  s.dispose();
  return { wIn, ratioErr, phase, jerr };
}

describe('ratio (DESIGN §5.3: < 1e-4, phase < 0.005 teeth, joint error < 1e-5)', () => {
  const cases: [string, () => { model: Parameters<typeof Simulation.create>[0]; part: Record<string, number> }, string, [string, number][]][] = [
    ['1:1', () => gearPair(1, 1), 'A', [['B', -1]]],
    ['1:3', () => gearPair(0.5, 1.5), 'A', [['B', -1 / 3]]],
    ['1:5', () => gearPair(0.5, 2.5), 'A', [['B', -1 / 5]]],
    ['1:25', () => compound25(0), 'A', [['B', -1 / 5], ['C', 1 / 25]]],
    ['idler ×5', () => idlerChain(5), 'G0', [['G1', -1], ['G2', 1], ['G3', -1], ['G4', 1]]],
  ];
  for (const [name, mk, input, outs] of cases)
    it(name, { timeout: 120000 }, async () => {
      const r = await ratioRun(name, mk(), input, outs);
      expect(r.wIn).toBeGreaterThan(38);
      expect(r.wIn).toBeLessThan(42);
      expect(r.ratioErr).toBeLessThan(1e-4);
      expect(r.phase).toBeLessThan(0.005);
      expect(r.jerr).toBeLessThan(1e-5);
    });
});

describe('smaller steps at speed (DESIGN §5.1)', () => {
  it('k is 1 at rest and while slow, rises with the meshed gears’ speed and comes back down', async () => {
    const { model, part } = gearPair(0.5, 2.5);
    const s = await Simulation.create(model, { jointFriction: 0 });
    const A = s.bodyOf(part.A!)!;
    s.stepFixed(10);
    expect(s.substeps).toBe(1);
    const seen: number[] = [];
    // Spin the input up past every band (k 8 above 0.08·480·4 = 153.6 rad/s).
    s.setDriveTorque(A, [0, 0, 3000]);
    let prevK = 1;
    let upAt = 0;
    for (let i = 0; i < 960 && omega(s, A) < 250; i++) {
      s.stepFixed(1);
      if (s.substeps !== prevK) {
        seen.push(s.substeps);
        if (s.substeps > prevK) upAt = s.stepCount;
        prevK = s.substeps;
      }
      // The band rule: the rotation per world step of the fastest meshed gear stays ≤ 0.08 rad (+ one step of rise).
      expect((Math.abs(omega(s, A)) * DT) / s.substeps).toBeLessThan(0.1);
    }
    report(`k sequence spinning up: ${seen.join(' → ')} (ω_in ${omega(s, A).toFixed(1)} rad/s)`);
    expect(seen).toEqual([2, 4, 8]);
    s.setDriveTorque(A, [0, 0, 0]);
    s.setBodyVelocity(A, [0, 0, 0], [0, 0, 0]);
    s.setBodyVelocity(s.bodyOf(part.B!)!, [0, 0, 0], [0, 0, 0]);
    s.stepFixed(1);
    expect(s.substeps).toBe(8); // within 0.1 s of the last step up it stays
    let downAt = -1;
    for (let i = 0; i < 96; i++) {
      s.stepFixed(1);
      if (s.substeps === 1 && downAt < 0) downAt = s.stepCount;
    }
    report(`k stepped down to 1 at ${((downAt - upAt) * DT).toFixed(4)} s after the last step up`);
    expect(downAt).toBeGreaterThan(0);
    expect((downAt - upAt) * DT).toBeGreaterThanOrEqual(0.1 - 1e-9);
    s.dispose();
  });

  it('no gears or no engaged mesh: k stays 1; the substeps option pins k', async () => {
    const { model } = gearPair(1, 1);
    const s = await Simulation.create(model, { jointFriction: 0, substeps: 4 });
    expect(s.substeps).toBe(4);
    s.stepFixed(5);
    expect(s.substeps).toBe(4);
    s.dispose();
    await expect(Simulation.create(model, { substeps: 3 })).rejects.toThrow();
    // A spinning gear alone (its partner far away): no mesh, k = 1.
    const b = new ModelBuilder();
    const frame = b.add(beam([0, 0, -1], [6, 0, -1]));
    const A = b.add([makeCell(0, 0, 0, 'pinHole', 2), makeCell(0, 0, 1, 'pinHole', 2)]);
    b.add([makeCell(0, 0, -1, 'frictionPin', 2), makeCell(0, 0, 0, 'pin', 2)]);
    const B = b.add([makeCell(6, 0, 0, 'pinHole', 2), makeCell(6, 0, 1, 'pinHole', 2)]);
    b.add([makeCell(6, 0, -1, 'frictionPin', 2), makeCell(6, 0, 0, 'pin', 2)]);
    const m = finish(b, frame, [
      [A, [0, 0, 1], 1],
      [B, [6, 0, 1], 1],
    ]);
    const t = await Simulation.create(m, { jointFriction: 0 });
    t.setBodyVelocity(t.bodyOf(A)!, [0, 0, 0], [0, 0, 200]);
    t.stepFixed(20);
    expect(t.meshStates()).toEqual([]);
    expect(t.substeps).toBe(1);
    t.dispose();
  });

  it(`speed cap: a meshed train never exceeds ${GEAR_SPEED_CAP} rad/s; the cap scales the whole group`, async () => {
    const { model, part } = gearPair(0.5, 2.5);
    const s = await Simulation.create(model, { jointFriction: 0 });
    const A = s.bodyOf(part.A!)!;
    const B = s.bodyOf(part.B!)!;
    s.stepFixed(1);
    s.setDriveTorque(A, [0, 0, 20000]);
    let wMax = 0;
    let ratio = 0;
    for (let i = 0; i < 480; i++) {
      s.stepFixed(1);
      wMax = Math.max(wMax, maxOmega(s));
      if (Math.abs(omega(s, A)) > 100) ratio = Math.max(ratio, Math.abs(omega(s, B) / omega(s, A) + 0.2));
    }
    report(`cap: driven 1:5 input max |ω| ${wMax.toFixed(3)} rad/s, k ${s.substeps}, ratio deviation ${ratio.toExponential(2)}, cap removed ${s.capRemoved.toFixed(0)}, phase ${phaseNow(s).toExponential(2)} teeth`);
    expect(wMax).toBeLessThanOrEqual(GEAR_SPEED_CAP * (1 + 1e-5));
    expect(wMax).toBeGreaterThan(GEAR_SPEED_CAP * 0.99);
    expect(s.substeps).toBe(8);
    expect(ratio).toBeLessThan(1e-3);
    expect(phaseNow(s)).toBeLessThan(0.05);
    s.dispose();
  });
});

describe('removal and speed (DESIGN §5.3)', () => {
  for (const w0 of [20, 50, 100])
    it(`a meshed free gearbox spinning at ${w0} rad/s falls out of the world without throwing`, { timeout: 60000 }, async () => {
      const g = freeGearbox();
      const s = await Simulation.create(g.model, { jointFriction: 0 });
      const A = s.bodyOf(g.part.A!)!;
      const B = s.bodyOf(g.part.B!)!;
      s.stepFixed(1);
      expect(s.meshStates()).toHaveLength(1);
      s.setBodyVelocity(A, [0, 0, 0], [0, 0, w0]);
      s.setBodyVelocity(B, [0, 0, 0], [0, 0, -w0 / 5]);
      let wMax = 0;
      let phase = 0;
      let releasedAt = -1;
      let jerr = 0;
      for (let i = 0; i < 1440; i++) {
        s.stepFixed(1);
        if (releasedAt < 0 && s.meshStates().length === 0) releasedAt = s.time;
        wMax = Math.max(wMax, maxOmega(s));
        phase = Math.max(phase, phaseNow(s));
        const je = s.jointError();
        expect(Number.isFinite(je)).toBe(true);
        jerr = Math.max(jerr, je);
      }
      const d = s.meshDiagnostics()[0]!;
      report(`free gearbox ω0 ${w0}: mesh released at ${releasedAt.toFixed(3)} s, max |ω| ${wMax.toFixed(2)}, phase ${phase.toExponential(2)} teeth, joint error ${jerr.toExponential(2)}, mesh dead ${d.dead}, bodies left ${s.graph.bodies.filter((b) => !b.fixed && s.hasBody(b.id)).length}`);
      expect(releasedAt).toBeGreaterThan(0);
      expect(wMax).toBeLessThan(w0 * 1.5); // the frame is free: momentum redistributes, but nothing explodes
      expect(phase).toBeLessThan(0.01);
      expect(s.hasBody(A) || s.hasBody(B)).toBe(false);
      expect(d.dead).toBe(true);
      s.dispose();
    });
});

describe('locked train (DESIGN §5.3)', () => {
  it('a loop whose ratios disagree stays at rest, energy bounded, joint error < 1e-3', { timeout: 60000 }, async () => {
    const g = lockedTrain(4);
    for (const mu of [0, 0.2]) {
      const s = await Simulation.create(g.model, { jointFriction: mu });
      const P = s.bodyOf(g.part.P!)!;
      const a = new AngleZ(s, P);
      a.get();
      const E0 = totalEnergy(s);
      const m = s.massInfo(P)!.mass;
      let moved = 0;
      let dE = 0;
      let jerr = 0;
      for (let i = 0; i < 2400; i++) {
        s.stepFixed(1);
        moved = Math.max(moved, Math.abs(a.get()));
        dE = Math.max(dE, Math.abs(totalEnergy(s) - E0));
        jerr = Math.max(jerr, s.jointError());
      }
      report(`locked train μ ${mu}: arm turned ${moved.toExponential(2)} rad in 5 s, |ΔE| ${dE.toExponential(2)} (m·g·1 = ${(m * 1226.25).toFixed(0)}), joint error ${jerr.toExponential(2)}, meshes ${s.meshStates().length}`);
      expect(s.meshStates()).toHaveLength(2);
      expect(moved).toBeLessThan(1e-2);
      expect(dE).toBeLessThan(0.01 * m * 1226.25);
      expect(jerr).toBeLessThan(1e-3);
      s.dispose();
    }
  });
});

describe('collisions with gears (DESIGN §5.3)', () => {
  it('a beam dropped onto a gear rests on its tip radius', { timeout: 60000 }, async () => {
    // The gear is part of the fixed root (on a free pin a centred beam slowly rolls off, as on a
    // plain wheel: measured, it lands at the same height and leaves after ≈ 0.5 s).
    for (const r of [1.5, 2.5]) {
      const b = new ModelBuilder();
      const G = b.add([makeCell(0, 0, 0, 'pinHole', 2), makeCell(0, 0, 1, 'pinHole', 2)]);
      const beamId = b.add(beam([-3, 5, 1], [3, 5, 1]));
      const m = finish(b, G, [[G, [0, 0, 1], r]]);
      const s = await Simulation.create(m);
      const bb = s.bodyOf(beamId)!;
      for (let i = 0; i < 960; i++) s.stepFixed(1);
      const y = s.massInfo(bb)!.com[1];
      const want = r + 0.085 + HC; // tip collider + the beam's half-thickness
      report(`beam on a ${16 * r}-tooth gear: beam centre y ${y.toFixed(4)} (tip rest ${want.toFixed(4)}; pitch rest ${(r - 0.04 + HC).toFixed(4)}), |v| ${Math.hypot(...s.bodyVelocity(bb)!.v).toExponential(2)}`);
      expect(Math.abs(y - want)).toBeLessThan(0.02);
      s.dispose();
    }
  });

  it('a gear with a horizontal axis rests on the ground at Play with gap 0', { timeout: 60000 }, async () => {
    for (const r of [0.5, 1, 1.5, 2.5]) {
      const s = await Simulation.create(looseGear(r, 2));
      expect(s.groundY).toBeCloseTo(-(r + 0.085), 9);
      expect(s.isGroundSink(0)).toBe(true);
      let dy = 0;
      let dx = 0;
      for (let i = 0; i < 960; i++) {
        s.stepFixed(1);
        const p = s.bodyTransform(0)!.p;
        dy = Math.max(dy, Math.abs(p[1]));
        dx = Math.max(dx, Math.abs(p[0]));
      }
      report(`gear r ${r} on the ground 2 s: max |Δy| ${dy.toExponential(2)}, max |Δx| ${dx.toExponential(2)}`);
      expect(dy).toBeLessThan(0.03); // the wheels' rest tolerance (§5.3 "Rest": sinks < 0.03)
      expect(dx).toBeLessThan(0.01);
      s.dispose();
    }
  });
});

describe('mesh constants', () => {
  it('match DESIGN §5.1', () => {
    expect(GEAR_PITCH).toBe(Math.PI / 8);
    expect(MESH).toMatchObject({ parIn: 0.035, axialIn: 0.6, engageGap: 0.125, minGap: -0.25, parOut: 0.087, axialOut: 0.9, releaseGap: 0.25, releaseMinGap: -0.5, maxLinSpeed: 350, snapRate: 0.96, stopSlack: 0.005 });
    void setGear;
    void izAbout;
  });
});
