// Simulation lifecycle, stepping, removal of fallen bodies, grabbing, dispose.
import { describe, expect, it } from 'vitest';
import type { RigidBody, World } from '@dimforge/rapier3d-compat';
import { beam, buildExample, pin } from '../../src/core/examples';
import { emptyModel } from '../../src/core/model';
import { initPhysics } from '../../src/physics/rapier';
import { Simulation } from '../../src/physics/sim';
import { G, angleZ, maxSpeeds, mk, report, sim, unwrap, where } from './helpers';

// Capture Rapier's WASM memory (to measure leaks) by observing instantiation. Runs before any
// test initialises Rapier in this file's module context.
let wasmMemory: WebAssembly.Memory | null = null;
const origInstantiate = WebAssembly.instantiate;
WebAssembly.instantiate = (async (...args: Parameters<typeof WebAssembly.instantiate>) => {
  const r = (await (origInstantiate as (...a: unknown[]) => Promise<unknown>)(...args)) as
    | WebAssembly.Instance
    | WebAssembly.WebAssemblyInstantiatedSource;
  const inst = r instanceof WebAssembly.Instance ? r : r.instance;
  for (const v of Object.values(inst.exports)) if (v instanceof WebAssembly.Memory) wasmMemory = v;
  return r;
}) as typeof WebAssembly.instantiate;

describe('initPhysics', () => {
  it('is idempotent (same promise every call)', async () => {
    const a = initPhysics();
    const b = initPhysics();
    expect(a).toBe(b);
    await a;
  });
});

describe('degenerate models', () => {
  it('a model with zero parts works', async () => {
    const s = await Simulation.create(emptyModel());
    expect(s.graph.bodies).toHaveLength(0);
    s.stepFixed(10);
    expect(s.step(1 / 60)).toBeGreaterThanOrEqual(0);
    expect(s.energy()).toEqual({ kinetic: 0, potential: 0 });
    expect(s.jointError()).toBe(0);
    expect(s.bodyTransform(0)).toBeNull();
    expect(s.partTransform(1)).toBeNull();
    expect(s.grab(0, [0, 0, 0])).toBe(false);
    s.dispose();
  });

  it('a model with only the fixed body works and nothing moves', async () => {
    const s = await sim(mk([beam([0, 0, 0], [4, 0, 0])], 1));
    s.stepFixed(100);
    expect(s.partTransform(1)).toEqual({ p: [0, 0, 0], q: [0, 0, 0, 1] });
    expect(s.energy()).toEqual({ kinetic: 0, potential: 0 });
    expect(s.grab(0, [0, 0, 0])).toBe(false); // fixed bodies cannot be grabbed
    expect(s.grabbed).toBeNull();
    s.dispose();
  });
});

describe('fallen bodies', () => {
  it('an un-jointed dynamic body falls freely and is removed below y = −400', async () => {
    // Part 1 is the fixed root; part 2 is a loose beam far to the side.
    const s = await sim(mk([beam([0, 0, 0], [2, 0, 0]), beam([10, 0, 0], [12, 0, 0])], 1));
    const loose = s.bodyOf(2)!;
    s.stepFixed(Math.round(0.2 / s.fixedDt));
    const y = where(s, loose, [11, 0, 0])[1];
    const t = s.time;
    expect(y).toBeCloseTo(-0.5 * G * t * t, 0); // free fall (|Δ| < 0.5 of ≈ 24.5)
    let removedAt = -1;
    for (let i = 0; i < Math.round(2 / s.fixedDt) && removedAt < 0; i++) {
      s.stepFixed(1);
      if (!s.hasBody(loose)) removedAt = s.time;
    }
    // Free fall would reach y = −400 at t = √(800 / G) ≈ 0.808 s, but Rapier caps linear speed
    // at 400 units/s (reached at 0.326 s, y = −65.2): then 335 more units at 400/s → 1.164 s.
    expect(removedAt).toBeGreaterThan(1.14);
    expect(removedAt).toBeLessThan(1.19);
    expect(s.bodyTransform(loose)).toBeNull();
    expect(s.partTransform(2)).toBeNull();
    expect(s.bodyVelocity(loose)).toBeNull();
    expect(s.grab(loose, [0, 0, 0])).toBe(false);
    expect(s.energy()).toEqual({ kinetic: 0, potential: 0 });
    s.stepFixed(10); // still fine
    s.dispose();
  });

  it('the removal depth is relative to the model: a pendulum built at y = −450 stays, and is removed 400 below it', async () => {
    // Frame at y = −450 holding a link; a loose beam beside it falls from −450.
    const s = await sim(
      mk([beam([-2, -450, 0], [0, -450, 0]), beam([0, -450, 1], [4, -450, 1]), pin([0, -450, 0], [0, -450, 1]), beam([20, -450, 0], [22, -450, 0])], 1),
    );
    expect(s.removalY).toBe(-850);
    const link = s.bodyOf(2)!;
    const loose = s.bodyOf(4)!;
    s.stepFixed(Math.round(0.5 / s.fixedDt));
    expect(s.hasBody(link)).toBe(true);
    expect(s.hasBody(loose)).toBe(true);
    for (let i = 0; i < Math.round(1.5 / s.fixedDt) && s.hasBody(loose); i++) s.stepFixed(1);
    expect(s.hasBody(loose)).toBe(false); // fell 400 below the model
    expect(s.hasBody(link)).toBe(true); // still hanging from the frame
    s.dispose();
    // A model at y ≥ 0 keeps the plain −400 of DESIGN §5.1.
    const t = await sim(mk([beam([0, 0, 0], [2, 0, 0])], 1));
    expect(t.removalY).toBe(-400);
    t.dispose();
  });

  it('a falling jointed pair loses its joint when one body is removed', async () => {
    // No fixed part holds the pendulum: root is a separate beam; the pair falls together.
    const s = await sim(mk([beam([0, 0, 0], [1, 0, 0]), beam([10, 0, 0], [12, 0, 0]), beam([12, 0, 1], [14, 0, 1]), pin([12, 0, 0], [12, 0, 1])], 1));
    expect(s.graph.joints).toHaveLength(1);
    s.stepFixed(Math.round(1.2 / s.fixedDt));
    expect(s.hasBody(s.bodyOf(2)!)).toBe(false);
    expect(s.hasBody(s.bodyOf(3)!)).toBe(false);
    expect(s.jointStates()[0]!.alive).toBe(false);
    expect(s.jointError()).toBe(0);
    s.dispose();
  });
});

describe('stepping', () => {
  it('step(dtReal) advances dtReal × speed in fixed steps with an accumulator', async () => {
    // Wall-clock budget off so the result does not depend on machine load.
    const s = await sim(buildExample('pendulum'), { stepBudgetMs: Infinity }); // default speed ¼
    expect(s.speed).toBe(0.25);
    for (let i = 0; i < 60; i++) s.step(1 / 60);
    expect(s.time).toBeCloseTo(0.25, 9);
    expect(s.stepCount).toBe(120);
    expect(s.droppedSteps).toBe(0);
    s.setSpeed(0);
    s.step(1);
    expect(s.stepCount).toBe(120);
    s.setSpeed(1);
    expect(s.step(-1)).toBe(0);
    expect(s.step(NaN)).toBe(0);
    expect(() => s.setSpeed(-1)).toThrow();
    s.dispose();
  });

  it('caps fixed steps per call and counts what it drops', async () => {
    const s = await sim(buildExample('pendulum'), { speed: 1, maxStepsPerCall: 16, stepBudgetMs: Infinity });
    const ran = s.step(1); // wants 480 steps
    expect(ran).toBe(16);
    expect(s.droppedSteps).toBe(464);
    expect(s.droppedTime).toBeCloseTo(464 / 480, 9);
    s.dispose();
  });

  it('stops at the wall-clock budget', async () => {
    const s = await sim(buildExample('four-bar'), { speed: 1, maxStepsPerCall: 1000, stepBudgetMs: 5 });
    const t0 = performance.now();
    const ran = s.step(1);
    const ms = performance.now() - t0;
    expect(ran).toBeGreaterThan(0);
    expect(ran).toBeLessThan(480);
    expect(s.droppedSteps).toBe(480 - ran);
    // It overruns by at most the last step (< 3 ms normally; generous for a loaded test machine).
    expect(ms).toBeLessThan(5 + 30);
    s.dispose();
  });
});

describe('substeps per body (DEVIATIONS §5 "Integration settings")', () => {
  type Priv = { world: World; bodies: { fixed: boolean; rb: RigidBody }[] };
  it('jointed bodies run solverIterations substeps, unjointed bodies freeSolverIterations', async () => {
    const s = await sim(buildExample('collision'));
    const p = s as unknown as Priv;
    expect(p.world.numSolverIterations).toBe(30);
    const jointed = new Set(s.graph.joints.flatMap((j) => [j.bodyA, j.bodyB]));
    const loose = s.bodyOf(6)!;
    expect(jointed.has(loose)).toBe(false);
    for (const b of s.graph.bodies) {
      const extra = p.bodies[b.id]!.rb.additionalSolverIterations();
      expect(extra, `body ${b.id}`).toBe(!b.fixed && jointed.has(b.id) ? 210 : 0);
    }
    s.dispose();
    const t = await sim(buildExample('four-bar'), { solverIterations: 20, freeSolverIterations: 50 });
    expect((t as unknown as Priv).world.numSolverIterations).toBe(20); // clamped to solverIterations
    t.dispose();
  });

  it('the free-body count does not change a mechanism at all', async () => {
    // Jointed bodies run world count + additional = solverIterations whatever the split.
    const run = async (freeSolverIterations: number) => {
      const s = await sim(buildExample('collision'), { freeSolverIterations });
      s.stepFixed(240);
      const out = s.graph.bodies.map((b) => s.bodyTransform(b.id));
      s.dispose();
      return out;
    };
    const [a, b] = [await run(30), await run(240)];
    const probe = await sim(buildExample('collision'));
    const loose = probe.bodyOf(6)!;
    probe.dispose();
    for (let i = 0; i < a.length; i++) if (i !== loose) expect(a[i], `body ${i}`).toEqual(b[i]);
    expect(a[loose]).not.toEqual(b[loose]); // the loose beam does run at a different substep
  });
});

describe('grab / dragTo / release', () => {
  it('dragging the four-bar coupler moves the linkage, joints hold, and it swings freely after release', async () => {
    const s = await sim(buildExample('four-bar'));
    const crank = s.bodyOf(2)!;
    const coupler = s.bodyOf(3)!;
    // A reachable target: the coupler's middle in the pose with the crank at φ = −30°.
    const phiT = (-30 * Math.PI) / 180;
    const B: [number, number] = [-2 * Math.sin(phiT), 2 * Math.cos(phiT)];
    const D: [number, number] = [6, 0];
    const [l1, l2] = [4, 2 * Math.SQRT2];
    const dx = D[0] - B[0];
    const dy = D[1] - B[1];
    const dist = Math.hypot(dx, dy);
    const a = (l1 * l1 - l2 * l2 + dist * dist) / (2 * dist);
    const h = Math.sqrt(l1 * l1 - a * a);
    const C: [number, number] = [B[0] + (a * dx + h * dy) / dist, B[1] + (a * dy - h * dx) / dist]; // branch above B–D, like the start
    const target: [number, number, number] = [(B[0] + C[0]) / 2, (B[1] + C[1]) / 2, 2];
    const start: [number, number, number] = [2, 2, 2]; // middle of the coupler at t = 0
    expect(s.grab(coupler, start)).toBe(true);
    expect(s.grabbed).toBe(coupler);
    let jerr = 0;
    const n = Math.round(1 / s.fixedDt);
    for (let i = 1; i <= n; i++) {
      const k = Math.min(1, i / (0.3 * n)); // move the cursor over 0.3 s, then hold
      s.dragTo([start[0] + k * (target[0] - start[0]), start[1] + k * (target[1] - start[1]), 2]);
      s.stepFixed(1);
      jerr = Math.max(jerr, s.jointError());
    }
    const g = s.grabPoint()!;
    const off = Math.hypot(g[0] - target[0], g[1] - target[1]);
    const phi = angleZ(s.bodyTransform(crank)!);
    report(`grab four-bar coupler: target (${target.slice(0, 2).map((x) => x.toFixed(2))}), off by ${off.toFixed(3)}, crank at ${((phi * 180) / Math.PI).toFixed(1)}° (target −30°), max joint error ${jerr.toExponential(2)}`);
    expect(off).toBeLessThan(0.35); // sag of the other links' weight < g/ω²
    expect(Math.abs(phi - phiT)).toBeLessThan((10 * Math.PI) / 180);
    expect(jerr).toBeLessThan(0.02);
    expect(maxSpeeds(s).v).toBeLessThan(100);
    s.release();
    expect(s.grabbed).toBeNull();
    const before = angleZ(s.bodyTransform(crank)!);
    let moved = 0;
    let jerr2 = 0;
    for (let i = 0; i < Math.round(0.5 / s.fixedDt); i++) {
      s.stepFixed(1);
      jerr2 = Math.max(jerr2, s.jointError());
      moved = Math.max(moved, Math.abs(unwrap(0, angleZ(s.bodyTransform(crank)!) - before)));
    }
    expect(moved).toBeGreaterThan(0.2); // swings under gravity once released
    expect(jerr2).toBeLessThan(0.02);
    s.dispose();
  });

  for (const [label, cells, point, target] of [
    ['light (2-cell pin)', pin([0, 0, 0], [1, 0, 0]), [1, 0, 0], [3, 2, 1]],
    ['heavy (7-hole beam)', beam([0, 0, 0], [6, 0, 0]), [6, 0, 0], [4, 3, -1]],
  ] as const) {
    it(`a ${label} free body settles on the cursor without exploding`, async () => {
      const s = await sim(mk([beam([0, -50, 0], [0, -50, 0]), cells], 1)); // root far away
      const body = s.bodyOf(2)!;
      expect(s.grab(body, [...point])).toBe(true);
      s.dragTo([...target]);
      let vmax = 0;
      for (let i = 0; i < Math.round(1.5 / s.fixedDt); i++) {
        s.stepFixed(1);
        vmax = Math.max(vmax, Math.hypot(...s.bodyVelocity(body)!.v));
      }
      const g = s.grabPoint()!;
      const err = Math.hypot(g[0] - target[0], g[1] - target[1], g[2] - target[2]);
      report(`grab ${label} (m=${s.massInfo(body)!.mass.toFixed(2)}): off target ${err.toExponential(2)} after 1.5 s, max |v| ${vmax.toFixed(1)}`);
      expect(err).toBeLessThan(0.05);
      expect(vmax).toBeLessThan(100);
      s.release();
      s.dispose();
    });
  }
});

describe('dispose', () => {
  it('is idempotent and later calls throw', async () => {
    const s = await sim(buildExample('pendulum'));
    s.dispose();
    s.dispose();
    expect(s.isDisposed).toBe(true);
    expect(() => s.stepFixed(1)).toThrow(/disposed/);
    expect(() => s.bodyTransform(0)).toThrow(/disposed/);
  });

  it('creating and disposing 200 simulations does not leak WASM memory', async () => {
    const run = async (k: number) => {
      for (let i = 0; i < k; i++) {
        const s = await sim(buildExample(i % 2 ? 'collision' : 'four-bar'));
        s.stepFixed(5);
        s.energy();
        s.jointStates();
        s.dispose();
      }
    };
    expect(wasmMemory).not.toBeNull(); // the instantiation hook saw Rapier's memory
    const size = () => wasmMemory!.buffer.byteLength;
    await run(20); // warm up: let the WASM heap reach its working size
    const before = size();
    await run(200);
    const after = size();
    // Sensitivity check: 20 simulations kept alive do grow the heap.
    const kept = [];
    for (let i = 0; i < 20; i++) kept.push(await sim(buildExample('collision')));
    const withKept = size();
    for (const s of kept) s.dispose();
    report(`200 create/dispose: WASM memory ${(before / 1e6).toFixed(2)} MB → ${(after / 1e6).toFixed(2)} MB (20 kept alive: ${(withKept / 1e6).toFixed(2)} MB)`);
    expect(after).toBe(before);
    expect(withKept).toBeGreaterThan(after);
  }, 120000);
});
