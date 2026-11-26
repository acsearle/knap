// Adversarial review "sim" of wheels, ground and free root (DESIGN §2.4–§2.6, §4.3, §5.1, §5.3).
//
// Tests marked FAILS ON PURPOSE demonstrated a finding: they stated what DESIGN (or plain physics)
// expects and failed on the tree as reviewed. After the fixer: three are FIXED (they pass unchanged
// but for the title), two are rewritten as KNOWN LIMIT tests asserting the documented envelope (after
// the milestone-7 verification one of those, the wheel lying across a beam, is FIXED with the
// wedge hull and a five-position probe). Everything else passes and pins down behaviour that was
// checked. Long sweeps behind these cases are in spikes/review-wheels/ (own vitest config).
import { describe, expect, it } from 'vitest';
import { ModelBuilder, EXAMPLES, beam, pin } from '../../src/core/examples';
import {
  addCell, addPart, canAddCell, canRemoveCell, canSetRim, deserialize, emptyModel, makeCell, movePart,
  removeCell, rotatePart, serialize, setFixRoot, setGround, setRim, validateModel,
} from '../../src/core/model';
import type { Axis, Cell, Kind, Model } from '../../src/core/types';
import { Simulation } from '../../src/physics/sim';
import { applyTransform, conj, rotate, sub } from '../../src/physics/math';
import type { Vec3 } from '../../src/physics/math';
import { partShapes } from '../../src/physics/shapes';
import { buildPartMesh, initGeometry } from '../../src/geometry';
import { meshShells } from '../geometry/helpers';

const HC = 0.46;

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Edit-time collider points of a part (hull vertices, box corners, a wheel's round collider sampled at 64 angles). */
function colliderPoints(cells: Cell[]): Vec3[] {
  const out: Vec3[] = [];
  for (const sh of partShapes({ id: 1, color: '#888888', cells }, 16)) {
    if (sh.kind === 'hull') out.push(...sh.points);
    else if (sh.kind === 'box')
      for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1])
        out.push([sh.center[0] + sx * sh.halfExtents[0], sh.center[1] + sy * sh.halfExtents[1], sh.center[2] + sz * sh.halfExtents[2]]);
  }
  return out;
}

describe('model rules with rims (§2.6)', () => {
  it('random edit sequences with rims stay valid, canX agrees with X, nothing crashes; files round-trip', () => {
    const KINDS: Kind[] = ['pinHole', 'axleHole', 'axle', 'pin', 'frictionPin'];
    const RIMS = [undefined, 1, 1.5, 2, 2.5, 3, 4, 0.5, 4.5, 1.25];
    const problems: string[] = [];
    for (let seed = 1; seed <= 120; seed++) {
      const R = rng(seed);
      const ri = (n: number) => Math.floor(R() * n);
      const pick = <T,>(a: readonly T[]): T => a[ri(a.length)]!;
      let m: Model = emptyModel();
      for (let step = 0; step < 60; step++) {
        const before = m;
        const op = m.parts.length === 0 ? 0 : ri(6);
        try {
          if (op === 0) {
            const k = pick(KINDS);
            const c = makeCell(ri(9) - 4, ri(9) - 4, ri(3) - 1, k, ri(3) as Axis, k === 'pinHole' || k === 'axleHole' ? pick(RIMS) : undefined);
            try { m = addPart(m, [c]).model; } catch { /* refused */ }
          } else if (op === 1) {
            const p = pick(m.parts);
            const base = pick(p.cells);
            const off = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1], [2, 1, 0], [1, 2, 0]][ri(8)]!;
            const k = pick(KINDS);
            const c = makeCell(base.x + off[0]!, base.y + off[1]!, base.z + off[2]!, k, ri(3) as Axis, k === 'pinHole' || k === 'axleHole' ? pick(RIMS) : undefined);
            const can = canAddCell(m, p.id, c);
            let threw = false;
            try { m = addCell(m, p.id, c); } catch { threw = true; }
            if (can.ok === threw) problems.push(`seed ${seed}: canAddCell ${can.ok}, addCell threw ${threw}`);
          } else if (op === 2) {
            const p = pick(m.parts);
            const c = pick(p.cells);
            const r = pick(RIMS);
            const can = canSetRim(m, p.id, [c.x, c.y, c.z], r);
            let threw = false;
            const n = m.parts.reduce((a, q) => a + q.cells.length, 0);
            try { m = setRim(m, p.id, [c.x, c.y, c.z], r); } catch { threw = true; }
            if (can.ok === threw) problems.push(`seed ${seed}: canSetRim ${can.ok}, setRim threw ${threw}`);
            if (m.parts.reduce((a, q) => a + q.cells.length, 0) !== n) problems.push(`seed ${seed}: setRim changed the cell count`);
          } else if (op === 3) {
            const p = pick(m.parts);
            const c = pick(p.cells);
            const can = canRemoveCell(m, p.id, [c.x, c.y, c.z]);
            let threw = false;
            try { m = removeCell(m, p.id, [c.x, c.y, c.z]); } catch { threw = true; }
            if (can.ok === threw) problems.push(`seed ${seed}: canRemoveCell ${can.ok}, removeCell threw ${threw}`);
          } else if (op === 4) {
            const p = pick(m.parts);
            const c = pick(p.cells);
            m = (R() < 0.5 ? movePart(m, p.id, [ri(3) - 1, ri(3) - 1, ri(3) - 1]) : rotatePart(m, p.id, ri(3) as Axis, 1 + ri(3), [c.x, c.y, c.z])) ?? m;
          } else {
            m = R() < 0.5 ? setGround(m, R() < 0.7) : setFixRoot(m, R() < 0.5);
            const text = serialize(m);
            if (serialize(deserialize(text)) !== text) problems.push(`seed ${seed}: round trip differs`);
          }
        } catch (e) {
          problems.push(`seed ${seed} step ${step}: crash ${(e as Error).message}`);
          m = before;
        }
        const errs = validateModel(m);
        if (errs.length) {
          problems.push(`seed ${seed} step ${step}: invalid: ${errs[0]!.message}`);
          m = before;
        }
      }
    }
    expect(problems).toEqual([]);
  });

  it('every example saves, loads and saves again byte for byte; v1 stays v1', () => {
    for (const ex of EXAMPLES) {
      const m = ex.build();
      const text = serialize(m);
      expect(serialize(deserialize(text))).toBe(text);
      if (!m.parts.some((p) => p.cells.some((c) => c.rim !== undefined)) && m.ground === undefined) expect(m.version).toBe(1);
    }
  });

  it('malformed rims are rejected with a message that names the cell and the rule', () => {
    const file = (cell: string, version = 2) =>
      `{"version":${version},"rootPartId":null,"nextPartId":2,"parts":[{"id":1,"color":"#aabbcc","cells":[${cell}]}]}`;
    const msg = (s: string) => { try { deserialize(s); return 'accepted'; } catch (e) { return (e as Error).message; } };
    expect(msg(file('{"x":0,"y":0,"z":0,"kind":"pin","axis":2,"rim":2}'))).toMatch(/a pin cannot carry a rim/);
    expect(msg(file('{"x":0,"y":0,"z":0,"kind":"pinHole","axis":2,"rim":"2"}'))).toMatch(/rim must be a multiple of ½ from 1 to 4/);
    expect(msg(file('{"x":0,"y":0,"z":0,"kind":"pinHole","axis":2,"rim":2.0000000000000004}'))).toMatch(/rim must be/);
    expect(msg(file('{"x":0,"y":0,"z":0,"kind":"pinHole","axis":2,"rim":2}', 1))).toMatch(/must be version 2/);
  });

  it('validateModel stays cheap: 2000 cells and 8 r = 4 wheels in well under 50 ms', () => {
    let m: Model = emptyModel();
    for (let z = 0; z < 20; z++) for (let y = 0; y < 10; y++) m = addPart(m, beam([0, y * 3, z * 2], [9, y * 3, z * 2])).model;
    for (let k = 0; k < 8; k++) {
      const r = addPart(m, [makeCell(-20 - k * 10, 0, 0, 'pinHole', 2)]);
      m = setRim(r.model, r.partId, [-20 - k * 10, 0, 0], 4);
    }
    const t = performance.now();
    for (let i = 0; i < 5; i++) expect(validateModel({ ...m })).toEqual([]);
    expect((performance.now() - t) / 5).toBeLessThan(50); // measured ≈ 2.7 ms
  });
});

describe('geometry vs rule 1', () => {
  it('FIXED (was FAILS ON PURPOSE) — a crank hole that rule 1 joins to its wheel is fused to it in the solid (r 3, hole at (2, 3))', async () => {
    // discOverlapsCell((0,0), r 3, (2,3)) is true (1.5² + 2.5² = 8.5 < 9), so the hole belongs to the
    // wheel without a bridge, but the rendered disc (radius 2.97) ends 0.17 short of the hole's barrel
    // (√13 − 0.47 = 3.14): the part renders as two separate pieces that move together. The same at
    // (2, 4) of an r 4 wheel (gap 0.03), for pin- and axle-hole hubs and cranks (8 of 270 solids swept
    // in spikes/review-wheels/solids.test.ts; every other one is a single closed shell).
    await initGeometry();
    const mesh = buildPartMesh({ id: 1, color: '#888888', cells: [makeCell(0, 0, 0, 'pinHole', 2, 3), makeCell(2, 3, 0, 'pinHole', 2)] });
    expect(meshShells(mesh)).toBe(1); // measured 2
  });
});

describe('ground and wheels: findings', () => {
  it('FIXED (was FAILS ON PURPOSE) — a loose wheel at rest 100 units from the floor\'s pivot stays put (§5.3 "Rest": < 0.01 units)', async () => {
    // The floor's half-space is placed through the mean cell centre (groundPoint). A far fixed root
    // moves that pivot 100 units away from the wheel; the wheel then accelerates toward the pivot like
    // a ball in a bowl (measured: 0.35 units in 20 s, 0.17 units/s² growing; ∝ distance). Cause
    // (spikes/review-wheels/bowl7.test.ts): the half-space collider is created after the model's
    // colliders; a bare Rapier cylinder shows the same drift only when the half-space is created
    // after it. Creating the ground first (spikes/review-wheels/groundfirst.ts) cuts it to 1.6e-3.
    const b = new ModelBuilder();
    const root = b.add([makeCell(-200, 0, 0, 'pinHole', 2)]);
    const w = b.add([makeCell(0, 0, 0, 'pinHole', 2)]);
    const m = setGround(setRim(b.root(root).build(), w, [0, 0, 0], 1.5), true);
    const s = await Simulation.create(m);
    const bw = s.bodyOf(w)!;
    const x0 = s.massInfo(bw)!.com[0];
    s.stepFixed(480 * 20);
    const dx = s.massInfo(bw)!.com[0] - x0;
    s.dispose();
    expect(Math.abs(dx)).toBeLessThan(0.01); // measured −0.346
  }, 60000);

  it('FIXED (was KNOWN LIMIT, before that FAILS ON PURPOSE) — a wheel lying flat across a beam that lies on the floor rests on top of it (≤ 0.05 deep)', async () => {
    // Built in place (no drop): an r = 2.5 wheel lying flat one layer above a 15-hole beam lying
    // flat on the floor, the beam under the disc 1 unit off the hub. The wheel tips toward the floor
    // and leans on the beam's edge. With the first hull (one bevelled 32-gon prism) parry gave a
    // single contact point there, the wheel pivoted on it and sank 0.36–0.45 (of HC = 0.46). The
    // hull is now 32 wedges × 2 slabs (shapes.ts wheelHullPieces; DEVIATIONS §5). The probe samples
    // five axial positions (−HC, −HC/2, 0, +HC/2, +HC): with only −HC, 0, +HC an r 1.5 wheel read
    // 0.250 where five read 0.458 (review m7).
    const b = new ModelBuilder();
    const bm = b.add(beam([-7, 0, 1], [7, 0, 1], 1));
    const wl = b.add([makeCell(0, 1, 0, 'pinHole', 1)]);
    const m = setFixRoot(setGround(setRim(b.root(bm).build(), wl, [0, 1, 0], 2.5), true), false);
    expect(validateModel(m)).toEqual([]);
    const s = await Simulation.create(m);
    const bw = s.bodyOf(wl)!;
    const bb = s.bodyOf(bm)!;
    const depthNow = (): number => {
      const tw = s.bodyTransform(bw)!;
      const tb = s.bodyTransform(bb)!;
      let depth = -Infinity;
      for (const k of [0, 0.25, 0.5, 0.75, 1])
        for (let i = 0; i < 48; i++)
          for (const a of [-HC, -HC / 2, 0, HC / 2, HC]) {
            const q: Vec3 = [2.46 * k * Math.cos((i / 48) * 2 * Math.PI), 1 + a, 2.46 * k * Math.sin((i / 48) * 2 * Math.PI)];
            const e = rotate(conj(tb.q), sub(applyTransform(tw, q), tb.p));
            const t = Math.max(-7, Math.min(7, e[0]));
            depth = Math.max(depth, Math.min(HC - Math.hypot(e[0] - t, e[2] - 1), HC - Math.abs(e[1])));
          }
      return depth;
    };
    let worst = -Infinity;
    for (let k = 0; k < 20; k++) {
      s.stepFixed(480);
      worst = Math.max(worst, depthNow());
    }
    const v = s.bodyVelocity(bw)!;
    const speed = Math.hypot(...v.v);
    const hubY = s.massInfo(bw)!.com[1];
    const removed = [bw, bb].filter((id) => !s.hasBody(id)).length;
    s.dispose();
    console.log(`wheel across a beam on the floor, 20 s: worst depth ${worst.toFixed(3)} (of HC ${HC}), hub y ${hubY.toFixed(3)}, final speed ${speed.toExponential(2)}`);
    expect(worst).toBeLessThan(0.05); // first hull: 0.36–0.45
    expect(hubY).toBeGreaterThan(0);
    expect(speed).toBeLessThan(0.01); // at rest, not jittering
    expect(removed).toBe(0);
  }, 120000);

  it('FIXED (was FAILS ON PURPOSE) — the lowest collider starts in exact contact with the floor (§5.1 "Ground"): a pin standing on end', async () => {
    // groundLevel takes every cell's bottom as y − ½ and the plane sits ½ − HC = 0.04 above it, which
    // is exact for hole cells (±HC) but a male cell's free end reaches E_FREE = 0.48: a pin or axle
    // standing on end (or a pin protruding below a beam) starts 0.02 inside the floor and is popped up
    // (a lone 2-pin standing gains 11 energy units in its first steps; a free 4-bar lying on its pins
    // starts 0.02–0.04 deep).
    const cells = pin([0, 0, 0], [0, 1, 0]);
    const b = new ModelBuilder();
    b.add(cells);
    const m = setFixRoot(setGround(b.build(), true), false);
    const s = await Simulation.create(m);
    let low = Infinity;
    for (const q of colliderPoints(cells)) low = Math.min(low, q[1]);
    const pen = s.groundY! - low;
    s.dispose();
    expect(pen).toBeLessThan(1e-6); // measured 0.02
  });

  it('KNOWN LIMIT (DEVIATIONS §5 "Known failure envelope") — a free linkage with no wheels lying on the floor creeps slowly', async () => {
    // Was "FAILS ON PURPOSE — … comes to rest" (< 1e-3). Still 0.037 after the fixer's ground-first
    // and pin-end changes, which removed the other suspects: Rapier contact creep of a jointed group
    // resting on small contact patches (sleeping is off for determinism). Asserted as its envelope.
    // A 4-bar of 5-hole beams lying flat (holes along Y, smooth pins along Y), free root, ground on,
    // friction Realistic: between 10 and 20 s it still wanders 0.033 units (|v| up to 0.013 units/s);
    // the same with friction off and with the ground created first. A loose 3-beam on the floor moves
    // 4e-5 in 25 s, a cart 5e-7 in 30 s.
    const b = new ModelBuilder();
    const g = b.add(beam([0, 0, 0], [4, 0, 0], 1));
    b.add(beam([0, 1, 0], [0, 1, 3], 1));
    b.add(beam([4, 1, 0], [4, 1, 3], 1));
    b.add(beam([0, 2, 3], [4, 2, 3], 1));
    b.add(pin([0, 0, 0], [0, 1, 0], 1));
    b.add(pin([4, 0, 0], [4, 1, 0], 1));
    b.add(pin([0, 1, 3], [0, 2, 3], 1));
    b.add(pin([4, 1, 3], [4, 2, 3], 1));
    const m = setFixRoot(setGround(b.root(g).build(), true), false);
    const s = await Simulation.create(m);
    s.stepFixed(480 * 10);
    const c0 = s.graph.bodies.map((x) => s.massInfo(x.id)!.com);
    s.stepFixed(480 * 10);
    const drift = Math.max(...s.graph.bodies.map((x, i) => {
      const c = s.massInfo(x.id)!.com;
      return Math.hypot(c[0] - c0[i]![0], c[1] - c0[i]![1], c[2] - c0[i]![2]);
    }));
    s.dispose();
    console.log(`free 4-bar on the floor: drift between 10 and 20 s ${drift.toFixed(4)} units`);
    expect(drift).toBeLessThan(0.1); // measured 3.7e-2 (was 3.3e-2 before the fixes)
  }, 120000);
});

describe('ground and wheels: checked and holding', () => {
  it('a lone wheel at rest on the floor near the pivot stays put for 60 s (r 1 … 4, axis X and Z)', async () => {
    for (const axis of [0, 2] as Axis[])
      for (const r of [1, 2.5, 4]) {
        const b = new ModelBuilder();
        b.add([makeCell(0, 0, 0, 'pinHole', axis)]);
        const m = setFixRoot(setGround(setRim(b.build(), 1, [0, 0, 0], r), true), false);
        const s = await Simulation.create(m);
        s.stepFixed(480 * 5);
        const c0 = s.massInfo(0)!.com;
        s.stepFixed(480 * 55);
        const c = s.massInfo(0)!.com;
        s.dispose();
        expect(Math.hypot(c[0] - c0[0], c[1] - c0[1], c[2] - c0[2])).toBeLessThan(1e-3); // measured ≤ 5.4e-5
      }
  }, 120000);

  it('wheel–wheel: perpendicular wheels rolling across each other neither interpenetrate nor gain energy', async () => {
    const A = makeCell(-8, 0, 0, 'pinHole', 2, 2);
    const B = makeCell(0, 0, -8, 'pinHole', 0, 2);
    const b = new ModelBuilder();
    const ia = b.add([A]);
    const ib = b.add([B]);
    const m = setFixRoot(setGround(b.build(), true), false);
    const s = await Simulation.create(m);
    const ba = s.bodyOf(ia)!;
    const bb = s.bodyOf(ib)!;
    s.setBodyVelocity(ba, [20, 0, 0], [0, 0, -20 / 1.96]);
    s.setBodyVelocity(bb, [0, 0, 20], [20 / 1.96, 0, 0]);
    /** Deepest sample of wheel `c` (body `bc`) inside wheel `d` (body `bd`): min(axial, radial) depth. */
    const overlap = (c: Cell, bc: number, d: Cell, bd: number): number => {
      const tc = s.bodyTransform(bc)!;
      const td = s.bodyTransform(bd)!;
      const u = ((c.axis + 1) % 3) as Axis;
      const v = ((c.axis + 2) % 3) as Axis;
      let worst = -Infinity;
      for (const k of [0, 0.5, 0.8, 1])
        for (let i = 0; i < 32; i++)
          for (const a of [-HC, 0, HC]) {
            const q: Vec3 = [c.x, c.y, c.z];
            q[u] += 1.96 * k * Math.cos((i / 32) * 2 * Math.PI);
            q[v] += 1.96 * k * Math.sin((i / 32) * 2 * Math.PI);
            q[c.axis] += a;
            const e = rotate(conj(td.q), sub(applyTransform(tc, q), td.p));
            const rel = [e[0] - d.x, e[1] - d.y, e[2] - d.z];
            let r2 = 0;
            for (let j = 0; j < 3; j++) if (j !== d.axis) r2 += rel[j]! ** 2;
            worst = Math.max(worst, Math.min(HC - Math.abs(rel[d.axis]!), 1.96 - Math.sqrt(r2)));
          }
      return worst;
    };
    const e = () => { const x = s.energy(); return x.kinetic + x.potential; };
    const e0 = e();
    let eMax = e0;
    let worst = -Infinity;
    for (let i = 0; i < 480 * 2; i++) {
      s.stepFixed(1);
      eMax = Math.max(eMax, e());
      if (i % 4 === 0) worst = Math.max(worst, overlap(A, ba, B, bb), overlap(B, bb, A, ba));
    }
    s.dispose();
    expect(eMax - e0).toBeLessThanOrEqual(1e-6 * Math.abs(e0));
    expect(worst).toBeLessThan(0.1); // measured 0.022 (transient)
  }, 60000);

  it('wheel mass and inertia: a plain hub carries the solid collision disc (within 0.3 %) and I ≈ ½ m R² (within 0.2 %)', async () => {
    for (const r of [1, 2.5, 4]) {
      const b = new ModelBuilder();
      b.add([makeCell(0, 0, 0, 'pinHole', 2, r)]);
      const s = await Simulation.create(setFixRoot(setGround(b.build(), true), false));
      const mi = s.massInfo(0)!;
      const R = r - 0.04;
      s.dispose();
      expect(Math.abs(mi.mass / (Math.PI * R * R * 0.92) - 1)).toBeLessThan(0.003);
      expect(Math.abs(mi.inertia[8]! / (0.5 * mi.mass * R * R) - 1)).toBeLessThan(0.002);
    }
  });
});
