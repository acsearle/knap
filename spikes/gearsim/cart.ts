// Q4 gears on a vehicle: a free-root cart on the ground. Chassis: 7-hole beams at z 0 and z 4
// (holes along Z) joined by a cross beam at x 5, with a tower above the rear axle. Rear axle at x 0
// (wheels r 2.5 at z −1 and 5, gear at z 2), front axle at x 6 (wheels only). A chassis gear at
// (0, 2, 2) on a pin from the tower meshes the rear gear (centre distance 2, above it):
//   '1:3'  rear r 0.5, chassis r 1.5 (the chassis gear turns 1/3 as fast as the axle: a crank)
//   '3:1'  rear r 1.5, chassis r 0.5 (the chassis gear turns 3× as fast: a flywheel-ish spinner)
//   'none' the same cart without the chassis gear (control)
// Tests: coast from a push (v 50 units/s) for `secs`; at rest; a crank drag with the grab spring.
// Usage: sh spikes/gearsim/run.sh cart [variants=none,1:3,3:1] [mus=0,0.2] [ks=1] [secs=5] [tests=coast,rest,crank]
import { ModelBuilder, beam } from '../../src/core/examples';
import { makeCell, setFixRoot, setGround } from '../../src/core/model';
import type { Cell } from '../../src/core/types';
import { Angle, PITCH, Simulation, energyTotal, f, out, putRims } from './lib';
import type { Vec3 } from '../../src/physics/math';

export const WHEEL_R = 2.5;

export function gearCart(variant: 'none' | '1:3' | '3:1') {
  const b = new ModelBuilder();
  const cells: Cell[] = [...beam([0, 0, 0], [6, 0, 0]), ...beam([0, 0, 4], [6, 0, 4])];
  for (let z = 1; z <= 3; z++) cells.push(makeCell(5, 0, z, 'pinHole', 0));
  // tower above the rear axle carrying the chassis gear at (0, 2, 2)
  cells.push(makeCell(0, 1, 0, 'pinHole', 2), makeCell(0, 2, 0, 'pinHole', 2), makeCell(0, 2, 1, 'pinHole', 2));
  const chassis = b.add(cells);
  const rims: { part: number; pos: [number, number, number]; r: number }[] = [];
  const axles: number[] = [];
  const wheelParts: number[] = [];
  for (const x of [0, 6]) {
    const hubs = [-1, 5];
    const ax = b.add([-1, 0, 1, 2, 3, 4, 5].map((z) => makeCell(x, 0, z, 'axle', 2)));
    axles.push(ax);
    for (const z of hubs) {
      const w = b.add([makeCell(x, 0, z, 'axleHole', 2)]);
      wheelParts.push(w);
      rims.push({ part: w, pos: [x, 0, z], r: WHEEL_R });
    }
  }
  let rear = -1;
  let crank = -1;
  if (variant !== 'none') {
    rear = b.add([makeCell(0, 0, 2, 'axleHole', 2)]);
    rims.push({ part: rear, pos: [0, 0, 2], r: variant === '1:3' ? 0.5 : 1.5 });
    crank = b.add([makeCell(0, 2, 2, 'pinHole', 2)]);
    rims.push({ part: crank, pos: [0, 2, 2], r: variant === '1:3' ? 1.5 : 0.5 });
    b.add([makeCell(0, 2, 1, 'frictionPin', 2), makeCell(0, 2, 2, 'pin', 2)]);
  }
  let m = b.root(chassis).build();
  m = putRims(m, rims);
  m = setFixRoot(setGround(m, true), false);
  return { model: m, chassis, axles, wheelParts, rear, crank, rRear: variant === '1:3' ? 0.5 : 1.5, rCrank: variant === '1:3' ? 1.5 : 0.5 };
}

const R_ROLL = WHEEL_R - 0.04;

async function make(variant: 'none' | '1:3' | '3:1', mu: number, k: number) {
  const c = gearCart(variant);
  const s = await Simulation.create(c.model, { jointFriction: mu, substeps: k });
  return { c, s };
}

function yaw(s: Simulation, body: number): number {
  const t = s.bodyTransform(body)!;
  const v = [1 - 2 * (t.q[1] ** 2 + t.q[2] ** 2), 2 * (t.q[0] * t.q[1] + t.q[3] * t.q[2]), 2 * (t.q[0] * t.q[2] - t.q[3] * t.q[1])];
  return Math.atan2(-v[2]!, v[0]!);
}

async function coast(variant: 'none' | '1:3' | '3:1', mu: number, k: number, secs: number, v0: number) {
  const { c, s } = await make(variant, mu, k);
  const ch = s.bodyOf(c.chassis)!;
  const axB = c.axles.map((p) => s.bodyOf(p)!);
  const crankB = c.crank >= 0 ? s.bodyOf(c.crank)! : -1;
  const wAxle = -v0 / R_ROLL;
  for (const bd of s.graph.bodies) {
    let w: Vec3 = [0, 0, 0];
    if (axB.includes(bd.id)) w = [0, 0, wAxle];
    if (bd.id === crankB) w = [0, 0, (-wAxle * c.rRear) / c.rCrank];
    s.setBodyVelocity(bd.id, [v0, 0, 0], w);
  }
  const p0 = s.massInfo(ch)!.com;
  const y0 = yaw(s, ch);
  const n = Math.round(secs * 480);
  const vs: string[] = [];
  let maxPhase = 0;
  for (let i = 1; i <= n; i++) {
    s.stepFixed(1);
    if (i % Math.round(n / 5) === 0) {
      const v = s.bodyVelocity(ch)!.v;
      vs.push(`${(i / 480).toFixed(1)}s v ${f(v[0], 2)}`);
    }
  }
  for (const m of s.meshes) maxPhase = Math.max(maxPhase, m.maxE / PITCH);
  const p = s.massInfo(ch)!.com;
  const eng = s.meshes.filter((m) => m.engagements > 0).length;
  out(`coast ${variant} mu ${mu} k ${k} v0 ${v0}: dist x ${f(p[0] - p0[0], 2)} lateral z ${f(p[2] - p0[2], 4)} yaw ${f(yaw(s, ch) - y0, 5)} rad | ${vs.join(', ')} | meshes ${eng} phase max ${f(maxPhase)} teeth | guardRemoved ${f(s.guardRemoved, 1)}`);
  s.dispose();
}

async function rest(variant: 'none' | '1:3' | '3:1', mu: number, k: number, secs: number) {
  const { c, s } = await make(variant, mu, k);
  const ch = s.bodyOf(c.chassis)!;
  const p0 = s.massInfo(ch)!.com;
  const y0 = yaw(s, ch);
  const crankB = c.crank >= 0 ? s.bodyOf(c.crank)! : -1;
  const ang = crankB >= 0 ? new Angle(s, crankB) : null;
  const a0 = ang?.get() ?? 0;
  for (let i = 1; i <= secs * 480; i++) s.stepFixed(1);
  const p = s.massInfo(ch)!.com;
  out(`rest ${variant} mu ${mu} k ${k} ${secs}s: drift x ${f(p[0] - p0[0])} z ${f(p[2] - p0[2])} sank ${f(p0[1] - p[1])} yaw ${f(yaw(s, ch) - y0)} | crank turned ${f((ang?.get() ?? 0) - a0)} rad | phase ${f(Math.max(0, ...s.meshes.map((m) => m.maxE / PITCH)))} teeth`);
  s.dispose();
}

async function motor(variant: '1:3' | '3:1', mu: number, k: number, secs: number, tau: number) {
  // an internal motor: +τ on the chassis gear, −τ on the chassis (reaction), for secs; then coast secs
  const { c, s } = await make(variant, mu, k);
  const ch = s.bodyOf(c.chassis)!;
  const crankB = s.bodyOf(c.crank)!;
  const ang = new Angle(s, crankB);
  const chA = new Angle(s, ch);
  const a0 = ang.get();
  const c0 = chA.get();
  const p0 = s.massInfo(ch)!.com;
  const y0 = yaw(s, ch);
  s.setDrive(crankB, [0, 0, tau]);
  s.setDrive(ch, [0, 0, -tau]);
  const rows: string[] = [];
  for (let i = 1; i <= 2 * secs * 480; i++) {
    if (i === secs * 480 + 1) {
      s.setDrive(crankB, [0, 0, 0]);
      s.setDrive(ch, [0, 0, 0]);
    }
    s.stepFixed(1);
    const aNow = ang.get();
    const cNow = chA.get();
    if (i % (secs * 240) === 0) {
      const rel = aNow - a0 - (cNow - c0);
      const p = s.massInfo(ch)!.com;
      const expect = (rel * c.rCrank / c.rRear) * R_ROLL; // crank +θ (rel. chassis) → axle −θ·rC/rR → cart rolls +x by θ·rC/rR·R
      rows.push(`${(i / 480).toFixed(1)}s crank(rel) ${f(rel, 2)} rad, x ${f(p[0] - p0[0], 3)} (rolling ${f(expect, 3)}), z ${f(p[2] - p0[2], 4)}, yaw ${f(yaw(s, ch) - y0, 5)}, v ${f(s.bodyVelocity(ch)!.v[0], 2)}`);
    }
  }
  out(`motor ${variant} mu ${mu} k ${k} τ ${tau}: phase ${f(Math.max(...s.meshes.map((m) => m.maxE / PITCH)))} teeth, guardRemoved ${f(s.guardRemoved, 1)}`);
  for (const r of rows) out('   ' + r);
  s.dispose();
}

const [variants = 'none,1:3,3:1', mus = '0,0.2', ks = '1', secs = '5', tests = 'coast,rest,motor'] = process.argv.slice(2);
for (const t of tests.split(','))
  for (const v of variants.split(','))
    for (const mu of mus.split(',').map(Number))
      for (const k of ks.split(',').map(Number)) {
        if (t === 'coast') await coast(v as never, mu, k, Number(secs), 50);
        if (t === 'rest') await rest(v as never, mu, k, Number(secs));
        if (t === 'motor' && v !== 'none') await motor(v as never, mu, k, 2, Number(process.env.TAU ?? 2000));
      }
process.exit(0);
