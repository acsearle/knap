// Constant-load hold diagnosis: load ramped up over 0.5 s to F × τ0, then held; gear angle and pawl
// angle sampled every 0.25 s, and slip events (gear passing a whole pitch) counted.
//   sh spikes/teeth2/run.sh creep <r> <kind> <l> <px> <py> <betaDeg> <lockSign> [fractions=1,2,4,8] [secs=10]
import { RAPIER, gear, angleZ, Unwrap, fmt, vmotor } from './lib';
import type { PawlKind } from './lib';
import { scene, settle, release, penetration } from './ratchet';
import type { Cand } from './ratchet';
await RAPIER.init();
const a = process.argv.slice(2);
const c: Cand = { r: Number(a[0]), kind: a[1] as PawlKind, l: Number(a[2]), px: Number(a[3]), py: Number(a[4]), beta: (Number(a[5]) * Math.PI) / 180 };
const s = Number(a[6]);
const Fs = (a[7] ?? '1,2,4,8').split(',').map(Number);
const secs = Number(a[8] ?? 10);
const g = gear(c.r);
const nf = Number(process.env.NF ?? 30);
for (const F of Fs) {
  const sc = scene(c, { rep: (process.env.REP ?? 'hull') as any, softCcd: Number(process.env.SOFT ?? 0), flywheel: Number(process.env.FLY ?? 0) });
  sc.w.integrationParameters.contact_natural_frequency = nf;
  if (settle(sc) === null) throw new Error('no settle');
  release(sc);
  const ug = new Unwrap(angleZ(sc.gb)); const g0 = ug.v;
  const up = new Unwrap(angleZ(sc.pb)); const p0 = up.v;
  const n = Math.round(secs * 480);
  let samples: string[] = [], maxPen = 0, maxLift = 0;
  for (let i = 0; i < n; i++) {
    const t = i / 480;
    const tau = s * F * sc.tau0 * Math.min(1, t / 0.5);
    sc.gb.resetTorques(false); sc.gb.addTorque({ x: 0, y: 0, z: tau }, true);
    sc.w.step();
    const th = s * (ug.push(angleZ(sc.gb)) - g0);
    maxLift = Math.max(maxLift, Math.abs(up.push(angleZ(sc.pb)) - p0));
    if (i % 24 === 0) maxPen = Math.max(maxPen, penetration(sc));
    if (i % 480 === 479) samples.push(`${fmt(th / g.D, 3)}`);
  }
  console.log(`load ${F} τ0 (NF ${nf}, flywheel ${process.env.FLY ?? 0}, pawl mass ${fmt(sc.pb.mass())}, gear Izz ${fmt(1 / sc.gb.effectiveWorldInvInertia().elements[5])}): gear position in pitches at 1 s intervals: ${samples.join(' ')}; max pawl lift ${fmt(maxLift)} rad, max penetration ${fmt(maxPen)}`);
  sc.w.free();
}
process.exit(0);
