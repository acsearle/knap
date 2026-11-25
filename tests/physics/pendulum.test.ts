// §5.3 pendulum period, and exactness of the part transforms.
import { describe, expect, it } from 'vitest';
import { axle, beam, cell, holes, pin } from '../../src/core/examples';
import type { Cell } from '../../src/core/types';
import { axisAngle, rotate, sub, add } from '../../src/physics/math';
import type { Vec3 } from '../../src/physics/math';
import { G, mk, report, sim, where } from './helpers';

// Frame (−2..0, 0) layer 0, fixed; a 5-hole link hanging straight down from (0,0) in layer 1.
const hanging = () => mk([beam([-2, 0, 0], [0, 0, 0]), beam([0, 0, 1], [0, -4, 1]), pin([0, 0, 0], [0, 0, 1])], 1);

describe('pendulum period', () => {
  it('matches 2π√(I_pivot/(m·g·d)) from the engine mass properties within 3%', async () => {
    // Tilt gravity by α instead of tilting the link (cells are grid-aligned): the link starts
    // α from its equilibrium, released from rest.
    const alpha = (5 * Math.PI) / 180;
    const s = await sim(hanging(), { gravity: [G * Math.sin(alpha), -G * Math.cos(alpha), 0] });
    expect(s.graph.bodies).toHaveLength(2);
    expect(s.graph.joints.map((j) => j.type)).toEqual(['revolute']);
    const link = 1;
    const mi = s.massInfo(link)!;
    const pivot: Vec3 = [0, 0, 1];
    const r = sub(mi.com, pivot);
    const d = Math.hypot(r[0], r[1]);
    const Ip = mi.inertia[8]! + mi.mass * d * d; // I_zz about the COM + parallel axis
    const T0 = 2 * Math.PI * Math.sqrt(Ip / (mi.mass * G * d));
    const Tpred = T0 * (1 + alpha ** 2 / 16); // finite-amplitude correction (≈ 0.05%)

    // Zero crossings of ω_z, linearly interpolated, = half periods.
    const crossings: number[] = [];
    let prevW = s.bodyVelocity(link)!.w[2];
    let prevT = s.time;
    while (crossings.length < 11 && s.time < 5) {
      s.stepFixed(1);
      const w = s.bodyVelocity(link)!.w[2];
      if (s.stepCount > 1 && Math.sign(w) !== Math.sign(prevW) && prevW !== 0) {
        crossings.push(prevT + (s.time - prevT) * (prevW / (prevW - w)));
      }
      prevW = w;
      prevT = s.time;
    }
    expect(crossings.length).toBe(11);
    const T = ((crossings[10]! - crossings[0]!) / 10) * 2;
    const err = (T - Tpred) / Tpred;
    report(`pendulum: m=${mi.mass.toFixed(3)} d=${d.toFixed(4)} I_pivot=${Ip.toFixed(3)} T_pred=${(Tpred * 1000).toFixed(2)} ms T_sim=${(T * 1000).toFixed(2)} ms error=${(err * 100).toFixed(3)}%`);
    expect(Math.abs(err)).toBeLessThan(0.03);
    // ~0.4 s for a 4-unit (32 mm) pendulum (§5.1 "real scale means real speed").
    expect(T).toBeGreaterThan(0.25);
    expect(T).toBeLessThan(0.45);
    s.dispose();
  });
});

describe('free spin (known limitation, DEVIATIONS §5)', () => {
  // Rapier's per-substep gyroscopic correction rotates ω into the principal frame and back with
  // the body's f32 rotation quaternion, whose norm after Rapier's normalisation is ≈ 1 + 6.7e-8 on
  // average, so ω grows by ≈ 1e-7 per substep (independent of ω; present on a free body without
  // any joint). Jointed bodies run 240 substeps per 1/480 s step, so a freely spinning link speeds
  // up by roughly 0.3–1.4 % of ω per second; unjointed bodies run 30 and drift ≈ 8× less. The
  // energy guard (sim.ts guardEnergy) caps the gain at 1 % of the peak kinetic energy, i.e. ≈ 0.5 %
  // of ω, whatever the run length; the bound 0.75 % is that cap plus margin.
  const block: Cell[] = [];
  for (let x = 0; x < 3; x++) for (let y = 0; y < 3; y++) for (let z = 0; z < 3; z++) block.push(cell([x + 20, y, z], 'pinHole', 2));
  const spinCases = [
    { label: 'symmetric axle in a pin hole (cylindrical)', parts: () => [holes([0, 0, 0], [1, 0, 0], 2), axle([0, 0, -2], [0, 0, 2])], pivot: [0, 0, 0] as Vec3, w0: 100, bound: 0.0075 },
    { label: 'centred 5-hole link on a pin', parts: () => [beam([0, 0, 0], [0, -1, 0]), beam([-2, 0, 1], [2, 0, 1]), pin([0, 0, 0], [0, 0, 1])], pivot: [0, 0, 1] as Vec3, w0: 100, bound: 0.0075 },
    { label: 'end-pinned 5-hole link', parts: () => [beam([0, 0, 0], [0, -1, 0]), beam([0, 0, 1], [4, 0, 1]), pin([0, 0, 0], [0, 0, 1])], pivot: [0, 0, 1] as Vec3, w0: 30, bound: 0.0075 },
    // Unjointed bodies (freeSolverIterations = 30 substeps): +1.2 % and +0.84 % in 5 s without the guard.
    // The block's inertia is isotropic, so Rapier's principal frame is arbitrary and the f32
    // round trip also leaks 0.5–2.5e-3 rad/s into the other axes; it wanders with the step count
    // (sampled every 0.5 s over 5 s, with or without the energy guard), bound 3e-3.
    { label: 'free 3×3×3 block (no joint)', parts: () => [beam([0, 0, 0], [1, 0, 0]), block], pivot: null, w0: 100, bound: 0.0075, offAxis: 3e-3 },
    { label: 'free 5-hole beam (no joint)', parts: () => [beam([0, 0, 0], [1, 0, 0]), beam([20, 0, 0], [24, 0, 0])], pivot: null, w0: 100, bound: 0.0075 },
  ];
  for (const c of spinCases)
    it(`${c.label}: ω drift over 5 s without gravity stays within ${c.bound * 100}%`, async () => {
      const s = await sim(mk(c.parts(), 1), { gravity: [0, 0, 0] });
      const rb = (s as unknown as { bodies: { rb: { setAngvel(v: object, w: boolean): void; setLinvel(v: object, w: boolean): void } }[] }).bodies[1]!.rb;
      rb.setAngvel({ x: 0, y: 0, z: c.w0 }, true);
      if (c.pivot) {
        const r = sub(s.massInfo(1)!.com, c.pivot);
        rb.setLinvel({ x: -c.w0 * r[1], y: c.w0 * r[0], z: 0 }, true);
      }
      s.stepFixed(Math.round(5 / s.fixedDt));
      const w = s.bodyVelocity(1)!.w;
      const drift = w[2] / c.w0 - 1;
      report(`free spin, ${c.label}: ω ${c.w0} → ${w[2].toFixed(3)} rad/s in 5 s (${(drift * 100).toFixed(2)}%)`);
      expect(Math.abs(drift)).toBeLessThan(c.bound);
      expect(Math.hypot(w[0], w[1])).toBeLessThan(('offAxis' in c ? c.offAxis : undefined) ?? 1e-3);
      s.dispose();
    });
});

describe('part transforms', () => {
  it('are the identity at t = 0', async () => {
    const s = await sim(hanging());
    for (const p of [1, 2, 3]) {
      const t = s.partTransform(p)!;
      expect(t.p).toEqual([0, 0, 0]);
      expect(t.q).toEqual([0, 0, 0, 1]);
    }
    expect(s.partTransform(99)).toBeNull();
    s.dispose();
  });

  it('a body rotated 90° about its joint maps a known cell centre exactly', async () => {
    const s = await sim(hanging());
    // Put the link's Rapier body at the pose "rotated +90° about Z through the pivot (0,0)":
    // a cell centre at (0,−4,1) must then be at (4,0,1).
    const body = (s as unknown as { bodies: { ref: Vec3; rb: import('@dimforge/rapier3d-compat').RigidBody }[] }).bodies[1]!;
    const q = axisAngle([0, 0, 1], Math.PI / 2);
    const pivot: Vec3 = [0, 0, 1];
    const t = add(pivot, rotate(q, sub(body.ref, pivot)));
    body.rb.setRotation({ x: q[0], y: q[1], z: q[2], w: q[3] }, true);
    body.rb.setTranslation({ x: t[0], y: t[1], z: t[2] }, true);
    for (const [from, to] of [
      [[0, -4, 1], [4, 0, 1]],
      [[0, -1, 1], [1, 0, 1]],
      [[0, 0, 1], [0, 0, 1]],
    ] as [Vec3, Vec3][]) {
      const got = where(s, s.bodyOf(2)!, from);
      for (let i = 0; i < 3; i++) expect(got[i]).toBeCloseTo(to[i]!, 6);
    }
    // The fixed frame never moves.
    expect(s.partTransform(1)).toEqual({ p: [0, 0, 0], q: [0, 0, 0, 1] });
    s.dispose();
  });

  it('agree with where Rapier has each collider while the link swings', async () => {
    const s = await sim(mk([beam([-2, 0, 0], [0, 0, 0]), beam([0, 0, 1], [4, 0, 1]), pin([0, 0, 0], [0, 0, 1])], 1));
    const world = (s as unknown as { world: import('@dimforge/rapier3d-compat').World }).world;
    const rb = (s as unknown as { bodies: { rb: import('@dimforge/rapier3d-compat').RigidBody }[] }).bodies[1]!.rb;
    // Edit-time world centres of the link's colliders.
    const t0: Vec3[] = [];
    for (let i = 0; i < rb.numColliders(); i++) {
      const c = rb.collider(i).translation();
      t0.push([c.x, c.y, c.z]);
    }
    let worst = 0;
    for (let k = 0; k < 20; k++) {
      s.stepFixed(12);
      for (let i = 0; i < rb.numColliders(); i++) {
        const c = rb.collider(i).translation();
        const p = where(s, 1, t0[i]!);
        worst = Math.max(worst, Math.hypot(p[0] - c.x, p[1] - c.y, p[2] - c.z));
      }
    }
    expect(world.bodies.len()).toBe(2);
    const angle = 2 * Math.acos(Math.min(1, Math.abs(s.bodyTransform(1)!.q[3])));
    expect(angle).toBeGreaterThan(0.5); // it did swing
    expect(worst).toBeLessThan(1e-5);
    s.dispose();
  });
});
