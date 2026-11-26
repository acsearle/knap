// Detailed tests of one ratchet candidate.
//   sh spikes/teeth2/run.sh detail <test> <r> <kind> <l> <px> <py> <betaDeg> [lockSign]
// tests: friction | hold | speed | long | impact | all
import { RAPIER, gear, angleZ, Unwrap, vmotor, energy, fmt, cpu } from './lib';
import type { PawlKind } from './lib';
import { scene, settle, release, ramp, touching } from './ratchet';
import type { Cand, SceneOpts, Scene } from './ratchet';

await RAPIER.init();
const [test, r, kind, l, px, py, bdeg, ls] = process.argv.slice(2);
const c: Cand = { r: Number(r), kind: kind as PawlKind, l: Number(l), px: Number(px), py: Number(py), beta: (Number(bdeg) * Math.PI) / 180 };
const rep = (process.env.REP ?? 'hull') as any;
const base: SceneOpts = { rep, flywheel: Number(process.env.FLY ?? 0) };
let lockS = Number(ls ?? 0);
/** Settle at the default friction (μ 0.2), then switch both pivots to the requested level. */
const mk = (o: SceneOpts = {}): Scene => {
  const { mu, muGear, ...rest } = o;
  const sc = scene(c, { ...base, ...rest });
  if (settle(sc) === null) throw new Error('pawl did not settle on the gear');
  const m = mu ?? 0.2;
  sc.tfp = m * sc.pb.mass() * 1226.25 * 0.31;
  sc.tfg = (muGear ?? m) * sc.gb.mass() * 1226.25 * 0.31;
  vmotor(sc.w, sc.jp, 0, sc.tfp);
  release(sc);
  return sc;
};
if (!lockS) {
  const a = ramp(mk(), 1), b = ramp(mk(), -1);
  lockS = a.tau > b.tau ? 1 : -1;
}
const g = gear(c.r);
const out = (s: string) => console.log(s);
out(`candidate r${c.r} T${g.T} ${c.kind} l${c.l} pivot (${c.px},${c.py}) β${bdeg}° rep ${rep}; lock direction ${lockS > 0 ? '+' : '−'}`);

function friction() {
  for (const mu of [0, 0.05, 0.2]) {
    const L = ramp(mk({ mu }), lockS, 0.4, 2.9, 1e-3, true), F = ramp(mk({ mu }), -lockS);
    out(`  μ ${mu}: lock ${fmt(L.tau)} τ0 (${L.how}, pawl lift ${fmt(L.lift)} rad, max penetration ${fmt(L.pen!)})  free ${fmt(F.tau)} τ0 (${F.how})  ratio ${fmt(L.tau / F.tau)}`);
  }
  for (const cf of [0, 0.2, 0.8]) {
    const L = ramp(mk({ contactFriction: cf }), lockS), F = ramp(mk({ contactFriction: cf }), -lockS);
    out(`  contact friction ${cf}: lock ${fmt(L.tau)} τ0 (${L.how})  free ${fmt(F.tau)} τ0 (${F.how})`);
  }
}

/** constant load at fractions of the ramp's lock torque for 20 s: creep and skips */
function hold() {
  const L = ramp(mk(), lockS);
  const lim = Number.isFinite(L.tau) ? L.tau : 1e4;
  out(`  ramp lock torque ${fmt(L.tau)} τ0 (${L.how})`);
  for (const frac of [0.25, 0.5, 0.8]) {
    const sc = mk();
    const ug = new Unwrap(angleZ(sc.gb));
    const g0 = ug.v;
    const n = Math.round(20 / sc.w.timestep);
    let maxDev = 0, skips = 0, last = g0;
    const t0 = cpu();
    for (let i = 0; i < n; i++) {
      sc.gb.resetTorques(false);
      sc.gb.addTorque({ x: 0, y: 0, z: lockS * frac * lim * sc.tau0 }, true);
      sc.w.step();
      const th = ug.push(angleZ(sc.gb));
      maxDev = Math.max(maxDev, lockS * (th - g0));
      if (lockS * (th - last) > g.D * 0.9) {
        skips++;
        last = th;
      }
    }
    out(`  hold ${frac}×: 20 s, gear moved ${fmt(maxDev)} rad in the lock direction (${fmt(maxDev / g.D)} pitch), skips ${skips}, ${fmt((cpu() - t0) / n)} cpu ms/step`);
    sc.w.free();
  }
}

/** drive in the free direction at ω for 2 s, then cut the drive with a load in the lock direction */
function speed() {
  // LOAD = load torque in τ0 (default: the static hold limit must be found first with creep.ts)
  const LOAD = Number(process.env.LOAD ?? 2);
  out(`  load ${LOAD} τ0, NF ${process.env.NF ?? 30}`);
  for (const om of [1, 3, 10, 30, 60, 100, 200]) {
    const sc = mk();
    vmotor(sc.w, sc.jg, -lockS * om, 1e4 * sc.tau0);
    const up = new Unwrap(angleZ(sc.pb));
    const p0 = up.v;
    let maxLift = 0, maxW = 0, tTouch = 0;
    const n = Math.round(2 / sc.w.timestep);
    const e0 = energy([sc.pb]);
    let eMax = -Infinity;
    for (let i = 0; i < n; i++) {
      sc.w.step();
      const pa = up.push(angleZ(sc.pb));
      maxLift = Math.max(maxLift, Math.abs(pa - p0));
      maxW = Math.max(maxW, Math.abs(sc.pb.angvel().z));
      if (touching(sc) > 0) tTouch++;
      eMax = Math.max(eMax, energy([sc.pb]) - e0);
    }
    // cut the drive; load at 0.3 × lock torque in the lock direction
    release(sc);
    const ug = new Unwrap(angleZ(sc.gb));
    const g0 = ug.v;
    let back = 0;
    let caught = false;
    for (let i = 0; i < Math.round(1 / sc.w.timestep); i++) {
      sc.gb.resetTorques(false);
      sc.gb.addTorque({ x: 0, y: 0, z: lockS * LOAD * sc.tau0 }, true);
      sc.w.step();
      const th = ug.push(angleZ(sc.gb));
      back = Math.max(back, lockS * (th - g0));
    }
    caught = back < 3 * g.D;
    out(
      `  ω ${String(om).padStart(3)} rad/s (${fmt(om * sc.w.timestep)} rad/step, tooth passing ${fmt((om * g.T) / (2 * Math.PI))} Hz): pawl max lift ${fmt(maxLift)} rad, max |ω_pawl| ${fmt(maxW)}, touching ${fmt((100 * tTouch) / n)}% of steps, pawl max energy rise ${fmt(eMax / sc.tau0)} τ0·rad; after cut, gear ran back ${fmt(back / g.D)} pitch → ${caught ? 'caught' : 'NOT caught'}`,
    );
    sc.w.free();
  }
}

/** 60 cycles: 0.5 s driven at 10 rad/s in the free direction, 0.5 s loaded at 0.5 × lock torque */
function long() {
  // LOAD = load torque in τ0 (default: the static hold limit must be found first with creep.ts)
  const LOAD = Number(process.env.LOAD ?? 2);
  out(`  load ${LOAD} τ0, NF ${process.env.NF ?? 30}`);
  for (const om of [10, 40]) {
    const sc = mk();
    let fails = 0, lost = 0, nan = 0;
    const t0 = cpu();
    let steps = 0;
    for (let cyc = 0; cyc < 60; cyc++) {
      vmotor(sc.w, sc.jg, -lockS * om, 1e4 * sc.tau0);
      for (let i = 0; i < 240; i++, steps++) sc.w.step();
      release(sc);
      const ug = new Unwrap(angleZ(sc.gb));
      const g0 = ug.v;
      let back = 0;
      for (let i = 0; i < 240; i++, steps++) {
        sc.gb.resetTorques(false);
        sc.gb.addTorque({ x: 0, y: 0, z: lockS * LOAD * sc.tau0 }, true);
        sc.w.step();
        back = Math.max(back, lockS * (ug.push(angleZ(sc.gb)) - g0));
      }
      sc.gb.resetTorques(false);
      if (!Number.isFinite(back)) nan++;
      if (back > 1.5 * g.D) fails++;
      if (touching(sc) === 0) lost++;
    }
    out(`  long ω ${om}: 60 cycles → load not held (ran back > 1.5 pitch) ${fails}, pawl not touching at end of hold ${lost}, NaN ${nan}; ${fmt((cpu() - t0) / steps)} cpu ms/step`);
    sc.w.free();
  }
}

/** gear spun in the lock direction at ω (no drive, no load): does the pawl stop it within 2 pitches? */
function impact() {
  const fw = Number(process.env.FLYWHEEL ?? 1);
  out(`  gear carries an invisible disc r 2.5 of density ${fw} (I ≈ ${fmt(fw * Math.PI * 2.5 ** 4 * 0.46)})`);
  const variants: [string, SceneOpts][] = [
    ['dt 1/480, 240 it', {}],
    ['dt 1/480, 240 it, soft CCD 1.04', { softCcd: 400 * (1 / 480) * 1.25 }],
    ['dt 1/960, 120 it', { dt: 1 / 960, iters: 120 }],
    ['dt 1/1920, 60 it', { dt: 1 / 1920, iters: 60 }],
  ];
  for (const [name, o] of variants) {
    const res: string[] = [];
    for (const om of [1, 3, 10, 30, 60, 100, 200, 350]) {
      const sc = mk({ ...o, flywheel: fw });
      sc.gb.setAngvel({ x: 0, y: 0, z: lockS * om }, true);
      const ug = new Unwrap(angleZ(sc.gb));
      const g0 = ug.v;
      let mx = 0;
      for (let i = 0; i < Math.round(0.5 / sc.w.timestep); i++) {
        sc.w.step();
        mx = Math.max(mx, lockS * (ug.push(angleZ(sc.gb)) - g0));
      }
      res.push(`${om}:${fmt(mx / g.D, 2)}`);
      sc.w.free();
    }
    out(`  impact [${name}] ω:pitches travelled in 0.5 s  ${res.join('  ')}`);
  }
}

const tests: Record<string, () => void> = { friction, hold, speed, long, impact };
for (const [k, f] of Object.entries(tests)) if (test === k || test === 'all') {
  out(`[${k}]`);
  f();
}
process.exit(0);
