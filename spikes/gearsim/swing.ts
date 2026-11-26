// Q3a swing-arm selector. Axes along Y (gravity along the axes, so the arm is not biased). Frame
// (fixed, layer y = 0): a U of holes. Sun r 1 at (0, ·, 0); planet r 1 on an arm pivoting about the
// sun axis, built at (0, ·, 2) (neutral: pitch gap 0.236 to both outputs); outputs r 1 at
// (±2, ·, 3) on frame pins. The planet meshes output A at arm angle −8.1° and B at +8.1° from neutral.
//  variant 'shaft': the arm's pivot hole sits on the sun's axle (arm–sun joint);
//  variant 'frame': the arm pivots on a pin from an upper frame plate (arm–frame joint).
// The sun is driven by a speed-tracking torque to ±w rad/s, reversing every `half` seconds.
// Usage: sh spikes/gearsim/run.sh swing [variants=shaft,frame] [mus=0,0.05,0.2] [ks=1] [w=5] [half=1] [cycles=2] [loadFix=none|...]
import { ModelBuilder, beamPath } from '../../src/core/examples';
import { makeCell } from '../../src/core/model';
import type { Cell } from '../../src/core/types';
import { Angle, PITCH, Simulation, energyTotal, f, out, putRims } from './lib';

export function selector(variant: 'shaft' | 'frame') {
  const b = new ModelBuilder();
  const frameCells: Cell[] = beamPath([[-2, 0, 3], [-2, 0, 0], [2, 0, 0], [2, 0, 3]], 1);
  if (variant === 'frame') {
    // a post at (4, ·, 0) and an upper plate at y = 3 from x = 4 to x = 0 (holes along Y)
    frameCells.push(makeCell(3, 0, 0, 'pinHole', 1), makeCell(4, 0, 0, 'pinHole', 1));
    for (let y = 1; y <= 2; y++) frameCells.push(makeCell(4, y, 0, 'pinHole', 2));
    for (let x = 0; x <= 4; x++) frameCells.push(makeCell(x, 3, 0, 'pinHole', 1));
  }
  const frame = b.add(frameCells);
  let sun: number;
  if (variant === 'shaft') {
    sun = b.add([makeCell(0, 1, 0, 'axleHole', 1)]);
    b.add([0, 1, 2, 3].map((y) => makeCell(0, y, 0, 'axle', 1)));
    b.add([makeCell(0, 3, 0, 'axleHole', 1)]); // bush retaining the arm
  } else {
    sun = b.add([makeCell(0, 1, 0, 'pinHole', 1)]);
    b.add([makeCell(0, 0, 0, 'frictionPin', 1), makeCell(0, 1, 0, 'pin', 1)]);
    b.add([makeCell(0, 3, 0, 'frictionPin', 1), makeCell(0, 2, 0, 'pin', 1)]);
  }
  const arm = b.add([0, 1, 2].map((z) => makeCell(0, 2, z, 'pinHole', 1)));
  const planet = b.add([makeCell(0, 1, 2, 'pinHole', 1)]);
  b.add([makeCell(0, 1, 2, 'pin', 1), makeCell(0, 2, 2, 'frictionPin', 1)]);
  const outs: number[] = [];
  for (const x of [2, -2]) {
    outs.push(b.add([makeCell(x, 1, 3, 'pinHole', 1)]));
    b.add([makeCell(x, 0, 3, 'frictionPin', 1), makeCell(x, 1, 3, 'pin', 1)]);
  }
  let m = b.root(frame).build();
  m = putRims(m, [
    { part: sun, pos: [0, 1, 0], r: 1 },
    { part: planet, pos: [0, 1, 2], r: 1 },
    { part: outs[0]!, pos: [2, 1, 3], r: 1 },
    { part: outs[1]!, pos: [-2, 1, 3], r: 1 },
  ]);
  return { model: m, sun, arm, planet, outs, frame };
}

async function run(variant: 'shaft' | 'frame', mu: number, k: number, w: number, half: number, cycles: number, opts: Record<string, unknown>) {
  const sel = selector(variant);
  const s = await Simulation.create(sel.model, { jointFriction: mu, substeps: k, ...opts });
  const id = (p: number) => s.bodyOf(p)!;
  const sun = id(sel.sun);
  const arm = id(sel.arm);
  const A = id(sel.outs[0]!);
  const B = id(sel.outs[1]!);
  const ax: [number, number, number] = [0, 1, 0];
  const armAng = new Angle(s, arm, ax);
  const a0 = armAng.get();
  const jsInfo = s.jointStates().map((j) => `${j.type}(${j.bodyA}-${j.bodyB}) m ${f(j.loadMass, 2)} τf ${f(j.frictionTorque, 1)}`);
  const E0 = energyTotal(s);
  const Isun = s.massInfo(sun)!.inertia[4]!;
  let lastTau = 0;
  const n = Math.round(2 * half * cycles * 480);
  const log: string[] = [];
  let maxAlpha = 0;
  let prevW: number[] = [0, 0];
  const engLog: string[] = [];
  const prevEng = s.meshes.map((q) => q.engaged);
  let maxExcess = -Infinity;
  for (let i = 1; i <= n; i++) {
    const t = i / 480;
    const target = Math.floor(t / half) % 2 === 0 ? w : -w;
    const ws = s.bodyVelocity(sun)!.w[1];
    // speed-tracking drive: torque to reach the target in ~10 steps, limited to 50× Isun·w per s
    const tcap = Number(process.env.TCAP ?? 4000);
    const tau = Math.max(-tcap, Math.min(tcap, Isun * (target - ws) * 480));
    if (tau !== lastTau) {
      s.setDrive(sun, [0, tau, 0]);
      lastTau = tau;
    }
    s.stepFixed(1);
    const wo = [s.bodyVelocity(A)!.w[1], s.bodyVelocity(B)!.w[1]];
    for (let j = 0; j < 2; j++) maxAlpha = Math.max(maxAlpha, Math.abs(wo[j]! - prevW[j]!) * 480);
    prevW = wo;
    s.meshes.forEach((q, j) => {
      if (q.engaged !== prevEng[j]) {
        const nm = (b: number) => (b === sun ? 'sun' : b === arm ? 'arm' : b === A ? 'A' : b === B ? 'B' : 'planet');
        engLog.push(`${t.toFixed(3)} ${q.engaged ? 'ENG' : 'rel'} ${nm(q.g1.body)}-${nm(q.g2.body)}${q.engaged ? ` snap ${f(q.lastSnap, 3)} teeth` : ''} gap ${f(q.gap, 3)}`);
        prevEng[j] = q.engaged;
      }
    });
    const excess = energyTotal(s) - E0 - s.driveTotal;
    maxExcess = Math.max(maxExcess, excess);
    if (i % Math.round(480 * half / 4) === 0)
      log.push(`t ${t.toFixed(2)} sun ${f(ws, 2)} arm ${f(((armAng.get() - a0) * 180) / Math.PI, 2)}° A ${f(wo[0]!, 2)} B ${f(wo[1]!, 2)} | E−E0−W ${f(excess, 1)}`);
  }
  const planetMesh = s.meshes.filter((q) => q.engagements > 0);
  out(`== ${variant} mu ${mu} k ${k} w ${w} ${JSON.stringify(opts)}: Isun ${f(Isun, 3)} joints ${jsInfo.join('; ')}`);
  out(`   meshes engaged at some point: ${planetMesh.length}; engagements ${s.meshes.map((q) => q.engagements).join(',')}; max phase err ${f(Math.max(...s.meshes.map((q) => q.maxE)) / PITCH)} teeth; peak output α ${f(maxAlpha, 0)} rad/s²; max(E−E0−W_drive) ${f(maxExcess, 2)} (W_drive ${f(s.driveTotal, 1)}); guardRemoved ${f(s.guardRemoved, 2)}`);
  for (const l of log) out('   ' + l);
  for (const l of engLog.slice(0, 16)) out('   ' + l);
  s.dispose();
}

if (process.argv[1]?.endsWith('swing.mjs')) {
  const [variants = 'shaft,frame', mus = '0,0.05,0.2', ks = '1', w = '5', half = '1', cycles = '2', extra = '{}'] = process.argv.slice(2);
  for (const v of variants.split(','))
    for (const mu of mus.split(',').map(Number))
      for (const k of ks.split(',').map(Number)) await run(v as 'shaft' | 'frame', mu, k, Number(w), Number(half), Number(cycles), JSON.parse(extra));
  process.exit(0);
}
