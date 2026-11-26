// DESIGN §5.3 "Gears" (part 2): geared pendulum, static balance with friction, crane drop, yank,
// engage / release while running, determinism. Friction off and the energy guard on unless stated.
import { describe, expect, it } from 'vitest';
import { exampleByName } from '../../src/core/examples';
import type { Model } from '../../src/core/types';
import { G, GEAR_SPEED_CAP, Simulation } from '../../src/physics/sim';
import { AngleZ, compound25, gearPair, izAbout, maxOmega, omega, phaseNow, selector, slider, totalEnergy, trajHash } from './gearModels';
import type { GearRig } from './gearModels';
import { report } from './helpers';

const DT = 1 / 480;

/** Period of θ'' = −(M·g·ℓ/I)·cos θ released at θ = 0 from rest (RK4): twice the time to θ̇ = 0 again. */
function reducedPeriod(Mgl: number, I: number): number {
  const f = (th: number) => (-Mgl / I) * Math.cos(th);
  let th = 0;
  let w = 0;
  let t = 0;
  const h = 1e-6;
  for (;;) {
    const k1t = w;
    const k1w = f(th);
    const k2t = w + (h / 2) * k1w;
    const k2w = f(th + (h / 2) * k1t);
    const k3t = w + (h / 2) * k2w;
    const k3w = f(th + (h / 2) * k2t);
    const k4t = w + h * k3w;
    const k4w = f(th + h * k3t);
    const wn = w + (h / 6) * (k1w + 2 * k2w + 2 * k3w + k4w);
    th += (h / 6) * (k1t + 2 * k2t + 2 * k3t + k4t);
    t += h;
    if (t > 1e-3 && wn >= 0 && w < 0) return 2 * t;
    w = wn;
  }
}

describe('geared pendulum (DESIGN §5.3: period within 1 % of the reduced model, energy in [−1 %, +1.1 %] of mgL over 4 s)', () => {
  for (const [name, rA, rB] of [
    ['1:1', 1, 1],
    ['3:1', 0.5, 1.5],
  ] as const)
    it(name, { timeout: 120000 }, async () => {
      const { model, part } = gearPair(rA, rB, { armB: 4 });
      const s = await Simulation.create(model, { jointFriction: 0 });
      const A = s.bodyOf(part.A!)!;
      const B = s.bodyOf(part.B!)!;
      const d = rA + rB;
      const mi = s.massInfo(B)!;
      const ell = mi.com[0] - d;
      const Mgl = mi.mass * G * ell;
      const I = izAbout(s, B, [d, 0, 0]) + (rB / rA) ** 2 * izAbout(s, A, [0, 0, 0]);
      const Tref = reducedPeriod(Mgl, I);
      const E0 = totalEnergy(s);
      let lo = 0;
      let hi = 0;
      const turns: number[] = [];
      let prevW = 0;
      for (let i = 1; i <= 1920; i++) {
        s.stepFixed(1);
        const r = (totalEnergy(s) - E0) / Mgl;
        lo = Math.min(lo, r);
        hi = Math.max(hi, r);
        const w = omega(s, B);
        if (i > 5 && w * prevW < 0 && w > 0) turns.push(s.time - (w / (w - prevW)) * DT); // θ̇ crosses 0 upward: back at the start side
        prevW = w;
      }
      const T = turns.length >= 2 ? (turns[turns.length - 1]! - turns[0]!) / (turns.length - 1) : NaN;
      report(`geared pendulum ${name}: period ${T.toFixed(5)} s vs reduced ${Tref.toFixed(5)} s (${((T / Tref - 1) * 100).toFixed(3)} %), (E − E0)/mgL in [${lo.toFixed(5)}, ${hi.toFixed(5)}], guard removed ${s.guardRemoved.toFixed(1)}, k max seen ${s.substeps}`);
      expect(Math.abs(T / Tref - 1)).toBeLessThan(0.01);
      expect(lo).toBeGreaterThan(-0.01);
      expect(hi).toBeLessThan(0.011);
      s.dispose();
    });
});

/** Gravity torque about +Z on a body about the axis line through `pivot` (x, y). */
function gravityTorque(s: Simulation, body: number, pivot: [number, number]): number {
  const mi = s.massInfo(body)!;
  return (mi.com[0] - pivot[0]) * mi.mass * -G;
}

describe('static balance through 1:5 and 1:25 at friction Realistic (holds at 0.97 of the threshold, moves at 1.03)', () => {
  const rigs: [string, () => GearRig, string, [string, number, [number, number]][]][] = [
    ['1:5', () => gearPair(0.5, 2.5, { armB: 6 }), 'B', [['A', 1, [0, 0]], ['B', -1 / 5, [3, 0]]]],
    ['1:25', () => compound25(6), 'C', [['A', 1, [0, 0]], ['B', -1 / 5, [3, 0]], ['C', 1 / 25, [6, 0]]]],
  ];
  for (const [name, mk, outName, chain] of rigs)
    it(name, { timeout: 300000 }, async () => {
      const results: string[] = [];
      for (const side of [1, -1])
        for (const f of [0.97, 1.03]) {
          const rig = mk();
          const s = await Simulation.create(rig.model, { jointFriction: 0.2 });
          const ratio = new Map(chain.map(([p, r]) => [s.bodyOf(rig.part[p]!)!, r]));
          const out = chain.find(([p]) => p === outName)!;
          const outB = s.bodyOf(rig.part[outName]!)!;
          const inB = s.bodyOf(rig.part.A!)!;
          // Torque at the input that balances the arm: τ_in·ω_in + T_out·ω_out = 0.
          const tauBal = -gravityTorque(s, outB, out[2]) * out[1];
          let F = 0;
          for (const j of s.jointStates()) {
            const dyn = ratio.has(j.bodyB) ? j.bodyB : j.bodyA;
            F += j.frictionTorque * Math.abs(ratio.get(dyn) ?? 0);
          }
          const tau = tauBal + side * f * F;
          s.setDriveTorque(inB, [0, 0, tau]);
          const a = new AngleZ(s, outB);
          a.get();
          let moved = 0;
          for (let i = 0; i < 480; i++) {
            s.stepFixed(1);
            moved = Math.max(moved, Math.abs(a.get()));
          }
          results.push(`${side} ${f}: ${moved.toExponential(2)} rad`);
          report(`balance ${name} τ_bal ${side > 0 ? '+' : '−'} friction at ${f}×: τ_bal ${tauBal.toFixed(1)}, reflected friction ${F.toFixed(1)}, τ ${tau.toFixed(1)} → output turned ${moved.toExponential(2)} rad in 1 s, phase ${phaseNow(s).toExponential(2)} teeth`);
          if (f < 1) expect(moved, `${name} ${side} ${f}`).toBeLessThan(1e-4);
          else expect(moved, `${name} ${side} ${f}`).toBeGreaterThan(1e-3);
          s.dispose();
        }
      void results;
    });
});

describe('crane drop (DESIGN §5.3: ≥ 95 % of the frictionless energy at the bottom, k rises and returns to 1, no reversal)', () => {
  const rigs: [string, () => GearRig, string, number][] = [
    ['1:5', () => gearPair(0.5, 2.5, { armB: 6 }), 'B', 3],
    ['1:25', () => compound25(6), 'C', 6],
  ];
  for (const [name, mk, outName, px] of rigs)
    it(name, { timeout: 300000 }, async () => {
      const rig = mk();
      const s = await Simulation.create(rig.model, { jointFriction: 0 });
      const outB = s.bodyOf(rig.part[outName]!)!;
      const gearBodies = Object.entries(rig.part)
        .filter(([k]) => k !== 'frame')
        .map(([, id]) => s.bodyOf(id)!);
      const a = new AngleZ(s, outB);
      a.get();
      const U0 = s.energy().potential;
      let kMax = 1;
      let reversed = 0;
      const sign = new Map<number, number>();
      let ratioAtBottom = NaN;
      let tBottom = NaN;
      let maxRot = 0;
      for (let i = 1; i <= 960 && Number.isNaN(ratioAtBottom); i++) {
        s.stepFixed(1);
        kMax = Math.max(kMax, s.substeps);
        for (const b of gearBodies) {
          const w = omega(s, b);
          maxRot = Math.max(maxRot, (Math.abs(w) * DT) / s.substeps);
          if (Math.abs(w) < 1e-2) continue;
          const sg = Math.sign(w);
          if (sign.has(b) && sign.get(b) !== sg) reversed++;
          sign.set(b, sg);
        }
        if (a.get() <= -Math.PI / 2) {
          const e = s.energy();
          ratioAtBottom = e.kinetic / (U0 - e.potential);
          tBottom = s.time;
        }
      }
      report(`crane drop ${name}: K at the bottom / mgΔh = ${ratioAtBottom.toFixed(4)} at ${tBottom.toFixed(4)} s, k max ${kMax}, max rotation per world step ${maxRot.toFixed(4)} rad, reversed steps ${reversed}, guard removed ${s.guardRemoved.toFixed(1)}`);
      expect(ratioAtBottom).toBeGreaterThanOrEqual(0.95);
      expect(kMax).toBeGreaterThan(1);
      expect(reversed).toBe(0);
      s.dispose();
      // With friction the arm comes to rest and k returns to 1.
      const r = await Simulation.create(mk().model, { jointFriction: 0.2 });
      let kSeen = 1;
      for (let i = 0; i < 480 * 20; i++) {
        r.stepFixed(1);
        kSeen = Math.max(kSeen, r.substeps);
      }
      const w = maxOmega(r);
      report(`crane drop ${name} at Realistic: k max ${kSeen}, after 20 s max |ω| ${w.toExponential(2)} rad/s, k ${r.substeps}`);
      expect(kSeen).toBeGreaterThan(1);
      expect(w).toBeLessThan(0.05);
      expect(r.substeps).toBe(1);
      r.dispose();
      void px;
    });
});

describe('yank (DESIGN §5.3)', () => {
  it('the grab target jumped 8 units on a 1:5 arm: the arm never moves away from it, phase < 0.05 teeth, no gear above 300 rad/s', { timeout: 120000 }, async () => {
    const { model, part } = gearPair(0.5, 2.5, { armB: 6 });
    const s = await Simulation.create(model);
    const B = s.bodyOf(part.B!)!;
    const tip: [number, number, number] = [9, 0, 2];
    s.grab(B, tip);
    for (let i = 0; i < 144; i++) s.stepFixed(1); // held at the tip, settles
    const p0 = s.grabPoint()!;
    const target: [number, number, number] = [p0[0], p0[1] + 8, p0[2]];
    s.dragTo(target);
    const dist = () => {
      const p = s.grabPoint()!;
      return Math.hypot(p[0] - target[0], p[1] - target[1], p[2] - target[2]);
    };
    const d0 = dist();
    let away = 0;
    let phase = 0;
    let wMax = 0;
    let kMax = 1;
    let prev = d0;
    for (let i = 0; i < 480; i++) {
      s.stepFixed(1);
      const d = dist();
      away = Math.max(away, d - d0);
      prev = d;
      phase = Math.max(phase, phaseNow(s));
      wMax = Math.max(wMax, maxOmega(s));
      kMax = Math.max(kMax, s.substeps);
    }
    report(`yank 1:5: start distance ${d0.toFixed(3)}, largest increase ${away.toExponential(2)}, end distance ${prev.toFixed(3)}, phase ${phase.toExponential(2)} teeth, max |ω| ${wMax.toFixed(2)} rad/s, k max ${kMax}, cap removed ${s.capRemoved.toFixed(0)}`);
    expect(away).toBeLessThan(1e-3);
    expect(phase).toBeLessThan(0.05);
    expect(wMax).toBeLessThanOrEqual(GEAR_SPEED_CAP * (1 + 1e-5));
    s.dispose();
  });
});

/** Speed-tracking drive: τ = clamp(I·(target − ω)/dt, ±cap) about the axis. */
function track(s: Simulation, body: number, axis: 0 | 1 | 2, I: number, target: number, cap: number): void {
  const w = omega(s, body, axis);
  const tau = Math.max(-cap, Math.min(cap, (I * (target - w)) / DT));
  const v: [number, number, number] = [0, 0, 0];
  v[axis] = tau;
  s.setDriveTorque(body, v);
}

describe('engage and release while running (DESIGN §5.3)', () => {
  for (const mu of [0.05, 0.2])
    it(`swing arm on the sun axle selects A and B once per stroke (μ ${mu})`, { timeout: 120000 }, async () => {
      const rig = selector();
      const s = await Simulation.create(rig.model, { jointFriction: mu });
      const sun = s.bodyOf(rig.part.sun!)!;
      const I = s.massInfo(sun)!.inertia[4]! + 4 * s.massInfo(s.bodyOf(rig.part.planet!)!)!.inertia[4]!;
      const pairOf = (p: number) => s.meshDiagnostics().find((m) => (m.a.partId === rig.part.planet && m.b.partId === p) || (m.b.partId === rig.part.planet && m.a.partId === p))!;
      const events: string[] = [];
      const prev = new Map<string, boolean>();
      let phase = 0;
      for (let i = 1; i <= 480 * 4; i++) {
        const stroke = Math.floor((i - 1) / 480);
        track(s, sun, 1, I, stroke % 2 === 0 ? 5 : -5, 4000);
        s.stepFixed(1);
        for (const [n, p] of [['A', rig.part.A!], ['B', rig.part.B!]] as const) {
          const m = pairOf(p);
          if (m.engaged !== (prev.get(n) ?? false)) events.push(`${s.time.toFixed(3)} ${n} ${m.engaged ? 'engaged' : 'released'}${m.engaged ? ` (snap ${m.lastSnap.toFixed(3)} teeth)` : ''}`);
          prev.set(n, m.engaged);
        }
        phase = Math.max(phase, phaseNow(s));
      }
      const A = pairOf(rig.part.A!);
      const B = pairOf(rig.part.B!);
      const sp = s.meshDiagnostics().find((m) => m.a.partId === rig.part.sun || m.b.partId === rig.part.sun)!;
      report(`selector μ ${mu}: A ${A.engagements}/${A.releases}, B ${B.engagements}/${B.releases} engagements/releases, sun–planet engaged ${sp.engaged} (snap ${sp.lastSnap}), phase ${phase.toExponential(2)} teeth; ${events.join('; ')}`);
      expect(sp.engagements).toBe(1);
      expect(sp.lastSnap).toBe(0);
      expect(A.engagements + B.engagements).toBe(4);
      expect(A.engagements).toBe(2);
      expect(B.engagements).toBe(2);
      expect(phase).toBeLessThan(0.05);
      s.dispose();
    });

  it('a gear sliding along its axle engages and releases once per stroke', { timeout: 120000 }, async () => {
    for (const mu of [0, 0.2]) {
      const rig = slider();
      const s = await Simulation.create(rig.model, { jointFriction: mu });
      const A = s.bodyOf(rig.part.A!)!;
      const B = s.bodyOf(rig.part.B!)!;
      const I = s.massInfo(A)!.inertia[8]!;
      s.grab(B, [2, 0, 3]);
      let phase = 0;
      let jerr = 0;
      const cycles = 3;
      for (let i = 1; i <= 480 * cycles; i++) {
        const ph = ((i - 1) % 480) / 480;
        s.dragTo([2, 0, ph < 0.5 ? 2 : 3]);
        track(s, A, 2, I, 5, 4000);
        s.stepFixed(1);
        phase = Math.max(phase, phaseNow(s));
        jerr = Math.max(jerr, s.jointError());
      }
      const m = s.meshDiagnostics()[0]!;
      report(`slider μ ${mu}: engagements ${m.engagements}, releases ${m.releases}, last snap ${m.lastSnap.toFixed(3)} teeth, phase ${phase.toExponential(2)} teeth, joint error ${jerr.toExponential(2)}, δ now ${m.delta.toFixed(3)}`);
      expect(m.engagements).toBe(cycles);
      expect(m.releases).toBe(cycles);
      expect(phase).toBeLessThan(0.01);
      expect(jerr).toBeLessThan(1e-3);
      s.release();
      s.dispose();
      void B;
    }
  });
});

describe('determinism (DESIGN §5.3)', () => {
  it('a geared model run twice gives identical hashes, k changes included', { timeout: 300000 }, async () => {
    const ex = exampleByName('gear-train');
    expect(ex).toBeDefined();
    const runs: [string, () => Model][] = [['Gear train example', () => ex!.build()], ['compound 1:25 crane', () => compound25(6).model]];
    for (const [name, build] of runs) {
      const hashes: string[] = [];
      const ks: number[] = [];
      for (let r = 0; r < 2; r++) {
        const s = await Simulation.create(build(), { jointFriction: 0 });
        let changes = 0;
        let k = s.substeps;
        const h = trajHash(
          {
            ...s,
            graph: s.graph,
            stepFixed: () => {
              s.stepFixed(1);
              if (s.substeps !== k) changes++;
              k = s.substeps;
            },
            bodyTransform: (id: number) => s.bodyTransform(id),
            bodyVelocity: (id: number) => s.bodyVelocity(id),
          } as unknown as Simulation,
          1440,
          8,
        );
        hashes.push(h);
        ks.push(changes);
        s.dispose();
      }
      report(`determinism ${name}: hashes ${hashes.join(' ')}, k changes ${ks.join(' ')}`);
      expect(hashes[0]).toBe(hashes[1]);
      expect(ks[0]).toBe(ks[1]);
      expect(ks[0]).toBeGreaterThan(0);
    }
  });
});
