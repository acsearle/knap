// Review "sim": simulate-mode plausibility, headless. Own mechanisms built through the core API,
// 60 s runs of every example and of the mechanisms with energy / joint-error / pin-tilt envelopes.
// Also writes the mechanisms as JSON to e2e/out/review-sim-models.json for the browser scripts
// (e2e/review-sim-*.mjs).
import { mkdirSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { EXAMPLES, ModelBuilder, axle, beam, beamPath, bush, cell, pin } from '../../src/core/examples';
import { analyze, describeGraph } from '../../src/core/kinematics';
import { emptyModel, validateModel } from '../../src/core/model';
import type { Model } from '../../src/core/types';
import { Simulation } from '../../src/physics/sim';
import { applyTransform, rotate } from '../../src/physics/math';
import type { Vec3 } from '../../src/physics/math';

// ---------------------------------------------------------------------------------------------
// Mechanisms

/** Crank-slider: crank (Z pin) + L conrod + slider = axle along X sliding in two X pin holes of the frame. */
function crankSlider(): Model {
  const b = new ModelBuilder();
  const frame = b.add([
    ...beam([0, 0, 0], [0, -2, 0]),
    ...beam([1, -2, 0], [6, -2, 0]),
    cell([6, -1, 0], 'pinHole', 2),
    cell([6, 0, 0], 'pinHole', 0),
    cell([7, 0, 0], 'pinHole', 0),
  ]);
  b.add(beam([-1, 0, 1], [0, 0, 1])); // crank, layer 1, horizontal (gravity turns it)
  b.add(beamPath([[-1, 0, 2], [-1, 1, 2], [4, 1, 2], [4, 0, 2]])); // conrod, layer 2
  b.add([cell([4, 0, 0], 'pinHole', 2), ...axle([5, 0, 0], [9, 0, 0])]); // slider
  b.add(pin([0, 0, 0], [0, 0, 1]));
  b.add(pin([-1, 0, 1], [-1, 0, 2]));
  b.add(pin([4, 0, 0], [4, 0, 2]));
  return b.root(frame).build();
}

/** Prismatic: a vertical sled on two parallel axles through a flat frame; drops 3 to its stop. */
function prismaticSled(): Model {
  const b = new ModelBuilder();
  const frame = b.add(beam([0, 0, 0], [2, 0, 0], 1));
  b.add([...axle([0, -3, 0], [0, 3, 0]), ...axle([2, -3, 0], [2, 3, 0]), ...beam([0, 4, 0], [2, 4, 0], 2)]);
  return b.root(frame).build();
}

/** Axle through the cross hole of an arm and a pin hole of the frame, bush behind: revolute. */
function axleArm(): Model {
  const b = new ModelBuilder();
  const frame = b.add(beam([-3, 0, 0], [0, 0, 0]));
  b.add(axle([0, 0, -2], [0, 0, 2]));
  b.add([cell([0, 0, 1], 'axleHole', 2), ...beam([1, 0, 1], [4, 0, 1])]); // arm, horizontal
  b.add(bush([0, 0, -1], 2));
  return b.root(frame).build();
}

/** Spatial chain: revolute about Y, then about X, then about Z. */
function spatial(): Model {
  const b = new ModelBuilder();
  const frame = b.add(beam([-2, 0, 0], [0, 0, 0], 1)); // holes along Y
  b.add([...beam([0, -1, 0], [2, -1, 0], 1), cell([3, -1, 0], 'pinHole', 0)]); // link 1: Y holes + an X hole
  b.add([...beam([4, -1, 0], [4, -3, 0], 0), cell([4, -4, 0], 'pinHole', 2)]); // link 2: X holes + a Z hole
  b.add(beam([4, -4, 1], [7, -4, 1], 2)); // link 3: Z holes
  b.add(pin([0, 0, 0], [0, -1, 0]));
  b.add(pin([3, -1, 0], [4, -1, 0]));
  b.add(pin([4, -4, 0], [4, -4, 1]));
  return b.root(frame).build();
}

/** Six-link chain, each link in its own layer, released horizontal. */
function chain6(): Model {
  const b = new ModelBuilder();
  const frame = b.add(beam([-2, 0, 0], [0, 0, 0]));
  let x = 0;
  for (let i = 1; i <= 6; i++) {
    b.add(beam([x, 0, i], [x + 3, 0, i]));
    x += 3;
  }
  x = 0;
  for (let i = 1; i <= 6; i++) {
    b.add(pin([x, 0, i - 1], [x, 0, i]));
    x += 3;
  }
  return b.root(frame).build();
}

/** Loose 3-hole beam lying flat (holes along Y) on a fixed flat 5-hole beam. */
function looseResting(): Model {
  const b = new ModelBuilder();
  const frame = b.add(beam([-2, 0, 0], [2, 0, 0], 1));
  b.add(beam([-1, 1, 0], [1, 1, 0], 1));
  return b.root(frame).build();
}

/** Pendulum whose root is the link (part 2): the 3-hole "frame" swings instead. */
function rootNotFirst(): Model {
  const b = new ModelBuilder();
  b.add(beam([-2, 0, 0], [0, 0, 0]));
  const link = b.add(beam([0, 0, 1], [4, 0, 1]));
  b.add(pin([0, 0, 0], [0, 0, 1]));
  return b.root(link).build();
}

/** No joints: a fixed beam and a separate beam beside it that falls away and is removed. */
function noJoints(): Model {
  const b = new ModelBuilder();
  const frame = b.add(beam([0, 0, 0], [3, 0, 0]));
  b.add(beam([0, 2, 2], [3, 2, 2]));
  return b.root(frame).build();
}

/** A one-hole body (the lightest possible) and a long link on one 3-long pin through the frame. */
function lightBody(): Model {
  const b = new ModelBuilder();
  const frame = b.add(beam([0, 0, 0], [3, 0, 0]));
  b.add(beam([3, 0, 1], [3, 0, 1])); // a single pin hole
  b.add(beam([3, 0, 2], [8, 0, 2]));
  b.add(pin([3, 0, 0], [3, 0, 2]));
  return b.root(frame).build();
}

export const MECHANISMS: Record<string, () => Model> = {
  'crank-slider': crankSlider,
  'prismatic-sled': prismaticSled,
  'axle-arm': axleArm,
  spatial,
  chain6,
  'loose-resting': looseResting,
  'root-not-first': rootNotFirst,
  'no-joints': noJoints,
  'light-body': lightBody,
  empty: emptyModel,
};

// ---------------------------------------------------------------------------------------------
// Envelope run

interface Envelope {
  name: string;
  summary: string;
  e0: number;
  eMin: number;
  eMax: number;
  keMax: number;
  jointErrMax: number;
  tiltMax: number;
  /** max over revolute joints of the separation of a second anchor point one unit along the axis. */
  anchor2Max: number;
  nan: boolean;
  removed: number[];
  ms: number;
}

async function envelope(name: string, model: Model, seconds: number): Promise<Envelope> {
  const s = await Simulation.create(model);
  const t0 = performance.now();
  const steps = Math.round(seconds / s.fixedDt);
  const tot = () => {
    const e = s.energy();
    return e.kinetic + e.potential;
  };
  const e0 = tot();
  let eMin = e0;
  let eMax = e0;
  let keMax = 0;
  let jmax = 0;
  let tilt = 0;
  let a2 = 0;
  let nan = false;
  const joints = s.graph.joints;
  for (let i = 1; i <= steps; i++) {
    s.stepFixed(1);
    if (i % 8 !== 0) continue;
    const e = s.energy();
    const t = e.kinetic + e.potential;
    if (!Number.isFinite(t)) nan = true;
    eMin = Math.min(eMin, t);
    eMax = Math.max(eMax, t);
    keMax = Math.max(keMax, e.kinetic);
    for (const js of s.jointStates()) {
      if (!js.alive) continue;
      if (Number.isNaN(js.error)) nan = true;
      jmax = Math.max(jmax, js.error);
      tilt = Math.max(tilt, js.tilt);
      const j = joints[js.index]!;
      if (j.type === 'revolute') {
        // A second point on the joint axis, one unit along it: both bodies must carry it to the same place.
        const p2: Vec3 = [...j.origin] as Vec3;
        p2[j.axis] += 1;
        const ta = s.bodyTransform(j.bodyA);
        const tb = s.bodyTransform(j.bodyB);
        if (ta && tb) {
          const pa = applyTransform(ta, p2);
          const pb = applyTransform(tb, p2);
          a2 = Math.max(a2, Math.hypot(pa[0] - pb[0], pa[1] - pb[1], pa[2] - pb[2]));
        }
      }
    }
  }
  const removed = s.graph.bodies.filter((b) => !b.fixed && !s.hasBody(b.id)).map((b) => b.id);
  const ms = performance.now() - t0;
  s.dispose();
  return { name, summary: describeGraph(s.graph), e0, eMin, eMax, keMax, jointErrMax: jmax, tiltMax: tilt, anchor2Max: a2, nan, removed, ms };
}

function fmt(e: Envelope): string {
  const ref = Math.max(e.keMax, 1e-12);
  return `${e.name.padEnd(16)} ${e.summary} | E0 ${e.e0.toExponential(3)} ΔEmax +${(((e.eMax - e.e0) / ref) * 100).toFixed(1)}% ΔEmin ${(((e.eMin - e.e0) / ref) * 100).toFixed(1)}% (of KEmax ${e.keMax.toExponential(2)}) | jerr ${e.jointErrMax.toExponential(2)} tilt ${e.tiltMax.toExponential(2)} rad anchor2 ${e.anchor2Max.toExponential(2)} | removed [${e.removed}] nan ${e.nan} | ${(e.ms / 1000).toFixed(1)} s`;
}

const SECONDS = Number(process.env.SIM_REVIEW_SECONDS ?? 60);

describe('review sim: models', () => {
  it('every own mechanism is a valid model; write JSON for the browser scripts', () => {
    const out: Record<string, Model> = {};
    for (const [name, f] of Object.entries(MECHANISMS)) {
      const m = f();
      expect(validateModel(m), name).toEqual([]);
      out[name] = m;
      console.log(`[sim] ${name.padEnd(16)} ${describeGraph(analyze(m), { detail: true }).replace(/\n/g, '\n                   ')}`);
    }
    mkdirSync('e2e/out', { recursive: true });
    writeFileSync('e2e/out/review-sim-models.json', JSON.stringify(out));
  });
});

describe(`review sim: ${SECONDS} s envelopes`, () => {
  for (const ex of EXAMPLES) {
    it(`example ${ex.name}`, { timeout: 600000 }, async () => {
      const e = await envelope(ex.name, ex.build(), SECONDS);
      console.log(`[sim] ${fmt(e)}`);
      expect(e.nan).toBe(false);
    });
  }
  for (const [name, f] of Object.entries(MECHANISMS)) {
    if (name === 'empty') continue;
    it(`mechanism ${name}`, { timeout: 600000 }, async () => {
      const e = await envelope(name, f(), SECONDS);
      console.log(`[sim] ${fmt(e)}`);
      expect(e.nan).toBe(false);
    });
  }
});

// DEVIATIONS §5 "Free rotation gains speed". Measured from a reference taken after transients (the
// sliding-axle's drop onto its stop dissipates energy and hides the gain in a whole-run figure), the
// rise was +44 % / +31 % / +50 % for these three before the energy guard (sim.ts guardEnergy); the
// guard caps it at 1 % of the peak KE (documented bound; 1.5 % allows for sampling).
describe('review sim: energy gain over 30 s stays within the documented 1 % of peak KE', () => {
  const cases: [string, () => Model, number][] = [
    ['sliding-axle example (reference after the 2 s drop)', () => EXAMPLES.find((e) => e.name === 'sliding-axle')!.build(), 2],
    ['arm on an axle with a bush (axle-arm)', axleArm, 0],
    ['spatial chain Y/X/Z (spatial)', spatial, 0],
  ];
  for (const [label, f, settle] of cases) {
    it(label, { timeout: 600000 }, async () => {
      const s = await Simulation.create(f());
      s.stepFixed(Math.round(settle / s.fixedDt));
      const tot = () => {
        const e = s.energy();
        return e.kinetic + e.potential;
      };
      const e0 = tot();
      let eMax = e0;
      let ke = 0;
      for (let i = 0; i < 30 * 480; i += 8) {
        s.stepFixed(8);
        const e = s.energy();
        ke = Math.max(ke, e.kinetic);
        eMax = Math.max(eMax, e.kinetic + e.potential);
      }
      s.dispose();
      const rise = (eMax - e0) / ke;
      console.log(`[sim] ${label}: energy rise over 30 s = ${(rise * 100).toFixed(1)} % of KEmax`);
      expect(rise).toBeLessThan(0.015);
    });
  }
});

void rotate;
