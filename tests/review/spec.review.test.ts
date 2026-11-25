// Review "spec" (completeness critic): requirement-level probes and scaling measurements.
// Logs with the prefix [spec]; run: npx vitest run tests/review/spec.review.test.ts --silent=false
import { beforeAll, describe, expect, it } from 'vitest';
import { ModelBuilder, axle, beam, bush, cell, pin } from '../../src/core/examples';
import { addCell, canAddCell, makeCell, validateModel } from '../../src/core';
import type { Cell, Model, Part } from '../../src/core';
import { analyze } from '../../src/core/kinematics';
import { buildPartMesh, initGeometry } from '../../src/geometry';
import { Simulation } from '../../src/physics/sim';

const log = (s: string) => console.log(`[spec] ${s}`);

function model(parts: Cell[][], root = 1): Model {
  const b = new ModelBuilder();
  for (const p of parts) b.add(p);
  return b.root(root).build();
}

beforeAll(async () => {
  await initGeometry();
});

describe('requirements: connection semantics', () => {
  it('a pin that merely ends at the mouth of another part’s coaxial hole makes no connection', () => {
    // beam (holes ∥ Z) at z=0, a pin ∥ Z at z=1..2 touching the hole mouth from outside
    const m = model([beam([0, 0, 0], [2, 0, 0]), pin([0, 0, 1], [0, 0, 2])]);
    const g = analyze(m);
    expect(g.mates).toHaveLength(0);
    expect(g.bodies).toHaveLength(2);
    expect(g.joints).toHaveLength(0);
  });

  it('in-part: a pin cannot grow coaxially out of a hole of its own part (end↔ring)', () => {
    const b = new ModelBuilder();
    const id = b.add(beam([0, 0, 0], [0, 0, 0]));
    const r = canAddCell(b.model, id, makeCell(0, 0, 1, 'pin', 2));
    expect(r.ok).toBe(false);
  });

  it('axle welded to a bush on one side of a fixed beam: one-sided slide; both sides: revolute', () => {
    const one = analyze(model([beam([0, 0, 0], [0, 0, 0], 1), axle([0, -2, 0], [0, 2, 0]), bush([0, 1, 0], 1)]));
    expect(one.joints).toHaveLength(1);
    expect(one.joints[0]!.type).toBe('cylindrical');
    expect(one.joints[0]!.limits![0] === 0 || one.joints[0]!.limits![1] === 0).toBe(true);
    const both = analyze(model([beam([0, 0, 0], [0, 0, 0], 1), axle([0, -2, 0], [0, 2, 0]), bush([0, 1, 0], 1), bush([0, -1, 0], 1)]));
    expect(both.joints.map((j) => j.type)).toEqual(['revolute']);
  });
});

describe('scaling (risk measurement: §2.4 says models up to a few thousand cells)', () => {
  it('geometry rebuild time of one growing part (every extend rebuilds the whole part)', () => {
    const rows: string[] = [];
    let worst = 0;
    for (const n of [4, 8, 16, 24, 32]) {
      const cells: Cell[] = [];
      for (let x = 0; x < n; x++) for (let y = 0; y < n; y++) cells.push(makeCell(x, y, 0, 'pinHole', 2));
      // a plate (2D path) and a mixed-axis plate (3D CSG path)
      const plate: Part = { id: 1, color: '#888888', cells };
      const mixed: Part = { id: 2, color: '#888888', cells: cells.map((c, i) => ({ ...c, axis: (i % 3 === 0 ? 0 : 2) as 0 | 2 })) };
      for (const [name, p] of [['plate', plate], ['mixed', mixed]] as const) {
        const t0 = performance.now();
        buildPartMesh(p);
        const ms = performance.now() - t0;
        if (name === 'mixed') worst = Math.max(worst, ms);
        rows.push(`${name} ${n}×${n} (${n * n} cells): ${ms.toFixed(0)} ms`);
      }
    }
    log(rows.join(' | '));
    expect(worst).toBeGreaterThan(0);
  }, 300000);

  it('analyze() time for long pinned chains', () => {
    const rows: string[] = [];
    for (const n of [25, 50, 100]) {
      const b = new ModelBuilder();
      const root = b.add(beam([-2, 0, 0], [0, 0, 0]));
      for (let i = 0; i < n; i++) {
        b.add(beam([i * 2, 0, (i % 2) + 1], [i * 2 + 2, 0, (i % 2) + 1]));
      }
      for (let i = 0; i < n; i++) {
        const z0 = i === 0 ? 0 : ((i - 1) % 2) + 1;
        const z1 = (i % 2) + 1;
        b.add(pin([i * 2, 0, Math.min(z0, z1)], [i * 2, 0, Math.max(z0, z1)]));
      }
      const m = b.root(root).build();
      expect(validateModel(m)).toEqual([]);
      const t0 = performance.now();
      const g = analyze(m);
      const ms = performance.now() - t0;
      rows.push(`${n} links: ${g.bodies.length} bodies ${g.joints.length} joints, ${ms.toFixed(0)} ms`);
    }
    log(rows.join(' | '));
  }, 300000);

  for (const n of [3, 6, 12, 24])
  it(`physics cost of a ${n}-link chain (ms of stepping per simulated second)`, async () => {
    const b = new ModelBuilder();
    const root = b.add(beam([-2, 0, 0], [0, 0, 0]));
    for (let i = 0; i < n; i++) b.add(beam([i * 2, 0, (i % 2) + 1], [i * 2 + 2, 0, (i % 2) + 1]));
    for (let i = 0; i < n; i++) {
      const z0 = i === 0 ? 0 : ((i - 1) % 2) + 1;
      const z1 = (i % 2) + 1;
      b.add(pin([i * 2, 0, Math.min(z0, z1)], [i * 2, 0, Math.max(z0, z1)]));
    }
    const s = await Simulation.create(b.root(root).build());
    const t0 = performance.now();
    s.stepFixed(240); // 0.5 s
    const msPerSimS = (performance.now() - t0) * 2;
    log(`${n}-link chain: ${msPerSimS.toFixed(0)} ms per simulated s (real time at 1× needs < 1000; at ¼× < 250), jointErr ${s.jointError().toExponential(2)}`);
    s.dispose();
  }, 300000);
});

describe('build: addCell keeps working near the edges of the rules', () => {
  it('a hole with a male of the same part stuck in it is refused', () => {
    const b = new ModelBuilder();
    const id = b.add([cell([0, 0, 0], 'pinHole', 2), cell([1, 0, 0], 'pinHole', 2)]);
    expect(canAddCell(b.model, id, makeCell(0, 0, 0, 'pin', 2)).ok).toBe(false);
    expect(() => addCell(b.model, id, makeCell(0, 0, 0, 'pin', 2))).toThrow();
  });
});
