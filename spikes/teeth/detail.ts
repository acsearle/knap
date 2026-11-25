// Detailed measurements of the best ratchet found per (tooth set, gear size, pawl kind).
//   sh spikes/teeth/build.sh detail <set> <profile> [r] [kind]
// Reads out/results/search-<set>-<profile>.json (written by `ratchet search <set> <profile>`).
import { readFileSync, writeFileSync } from 'node:fs';
import { RAPIER, DT, G, Unwrap, angleZ, gearSpec, velocityMotor, fmt } from './lib';
import type { PawlKind } from './lib';
import { buildScene, candidates, geoOf, pawlMass, ramp, settle } from './ratchet';
import type { Cand, SimOpts } from './ratchet';
import { sweep } from './analytic';

await RAPIER.init();
const [set, prof, rArg, kindArg] = process.argv.slice(2) as [string, string, string?, string?];
const rows: any[] = JSON.parse(readFileSync(new URL(`./results/search-${set}-${prof}.json`, import.meta.url), 'utf8'), (_k, v) => (v === 'Infinity' ? Infinity : v));
const L5 = pawlMass('end', 4).mass * G * 2; // torque of a horizontal 5-hole liftarm hanging off the axle

function pick(r: number, kind: string) {
  const ok = rows.filter((x) => x.r === r && x.kind === kind && x.simRatchet);
  if (!ok.length) return null;
  const score = (x: any) => {
    const lo = Math.min(x.sp, x.sm), hi = Math.max(x.sp, x.sm);
    return Math.min(hi, 300) / Math.max(lo, 0.05) - 0.01 * x.l;
  };
  ok.sort((a, b) => score(b) - score(a));
  return ok[0];
}

function findCand(x: any): Cand {
  const g = gearSpec(x.r, x.set, x.prof);
  const cs = candidates(g, x.kind as PawlKind, x.l).filter((c) => c.l === x.l && c.p[0] === x.px && c.p[1] === x.py && c.sigma === x.sigma);
  cs.sort((a, b) => Math.abs(a.alpha - x.alpha) - Math.abs(b.alpha - x.alpha));
  return cs[0]!;
}

function holding(c: Cand, s: number, o: SimOpts = {}, dec = 2, start = 0.1) {
  const sc = buildScene(c, o);
  settle(sc, c);
  const r = ramp(sc, c, s, start * c.mass * G, dec, dec * 4.5);
  sc.w.free();
  return r;
}

/** Smallest constant torque that turns the gear ≥ 3 pitches within 1.5 s (bisection). */
function drag(c: Cand, s: number, hi0: number) {
  const D = (2 * Math.PI) / c.g.T;
  const turns = (tau: number) => {
    const sc = buildScene(c);
    settle(sc, c);
    const u = new Unwrap(angleZ(sc.gear));
    const g0 = u.v;
    let ok = false;
    for (let i = 0; i < 720; i++) {
      sc.gear.resetTorques(false);
      sc.gear.addTorque({ x: 0, y: 0, z: s * tau }, true);
      sc.w.step();
      if (s * (u.push(angleZ(sc.gear)) - g0) > 3 * D) {
        ok = true;
        break;
      }
    }
    sc.w.free();
    return ok;
  };
  let lo = 0, hi = hi0;
  if (!turns(hi)) return Infinity;
  for (let k = 0; k < 9; k++) {
    const m = (lo + hi) / 2;
    if (turns(m)) hi = m;
    else lo = m;
  }
  return hi;
}

/** Drive the free direction at ω; count pawl clicks (lift cycles) per tooth passed. */
function clicks(c: Cand, s: number, omega: number, amp?: number) {
  const D = (2 * Math.PI) / c.g.T;
  const sc = buildScene(c);
  settle(sc, c);
  velocityMotor(sc.w, sc.jg, s * omega, 1e4 * c.mass * G);
  const up = new Unwrap(angleZ(sc.pawl));
  const p0 = up.v;
  const ug = new Unwrap(angleZ(sc.gear));
  const g0 = ug.v;
  const n = Math.min(Math.round((14 * D) / omega / DT), 4800);
  const lifts: number[] = [];
  for (let i = 0; i < n; i++) {
    sc.w.step();
    lifts.push(-c.sigma * (up.push(angleZ(sc.pawl)) - p0));
    ug.push(angleZ(sc.gear));
  }
  const teeth = Math.abs(ug.v - g0) / D;
  sc.w.free();
  const tail = lifts.slice(Math.floor(lifts.length / 7));
  const mn = Math.min(...tail), mx = Math.max(...tail);
  const A = amp ?? mx - mn; // tooth lift amplitude (from the slow run)
  // a click = the pawl falls by ≥ ½ A from a local maximum, re-armed once it rises ¼ A again
  let cnt = 0, hi = -Infinity, lo = Infinity, seekDrop = true;
  for (const l of tail) {
    if (seekDrop) {
      hi = Math.max(hi, l);
      if (hi - l >= 0.5 * A) {
        cnt++;
        seekDrop = false;
        lo = l;
      }
    } else {
      lo = Math.min(lo, l);
      if (l - lo >= 0.25 * A) {
        seekDrop = true;
        hi = l;
      }
    }
  }
  return { perTooth: cnt / (teeth * (tail.length / lifts.length)), teeth, mn, mx, A };
}

/** Gear thrown into the pawl (lock direction s) at ω0: caught? */
function catchAt(c: Cand, s: number, w0: number, o: SimOpts) {
  const D = (2 * Math.PI) / c.g.T;
  const sc = buildScene(c, o);
  settle(sc, c);
  const u = new Unwrap(angleZ(sc.gear));
  const g0 = u.v;
  const up = new Unwrap(angleZ(sc.pawl));
  const p0 = up.v;
  sc.gear.setAngvel({ x: 0, y: 0, z: s * w0 }, true);
  let maxTravel = 0, lift = 0;
  for (let i = 0; i < 240; i++) {
    sc.w.step();
    maxTravel = Math.max(maxTravel, s * (u.push(angleZ(sc.gear)) - g0));
    lift = Math.max(lift, -c.sigma * (up.push(angleZ(sc.pawl)) - p0));
  }
  sc.w.free();
  return { caught: maxTravel < 1.5 * D, travel: maxTravel / D, lift };
}

/** Gear driven the free way at ω for 0.25 s (pawl chattering), then reversed to the lock way at ω:
 *  travel (pitches) before it is stopped; Infinity if it is not stopped within 0.5 s. */
function reversal(c: Cand, sLock: number, w0: number, o: SimOpts) {
  const D = (2 * Math.PI) / c.g.T;
  const sc = buildScene(c, o);
  settle(sc, c);
  velocityMotor(sc.w, sc.jg, -sLock * w0, 1e4 * c.mass * G);
  for (let i = 0; i < 120; i++) sc.w.step();
  velocityMotor(sc.w, sc.jg, 0, 0);
  sc.gear.setAngvel({ x: 0, y: 0, z: sLock * w0 }, true);
  const u = new Unwrap(angleZ(sc.gear));
  const g0 = u.v;
  let travel = 0, stopped = false;
  for (let i = 0; i < 240; i++) {
    sc.w.step();
    travel = Math.max(travel, sLock * (u.push(angleZ(sc.gear)) - g0));
    if (sLock * sc.gear.angvel().z < 0.5) {
      stopped = true;
      break;
    }
  }
  sc.w.free();
  return stopped ? travel / D : Infinity;
}

/** 60 s under a steady back-torque in the lock direction. */
function hold60(c: Cand, s: number, tau: number, seconds = 60) {
  const sc = buildScene(c);
  settle(sc, c);
  const u = new Unwrap(angleZ(sc.gear));
  const up = new Unwrap(angleZ(sc.pawl));
  const n = Math.round(seconds / DT);
  let g1 = 0, gmin = Infinity, gmax = -Infinity, pmin = Infinity, pmax = -Infinity, wmax = 0;
  let sum = 0, sum2 = 0, cnt = 0;
  let broke = false;
  for (let i = 0; i < n; i++) {
    sc.gear.resetTorques(false);
    sc.gear.addTorque({ x: 0, y: 0, z: s * tau }, true);
    sc.w.step();
    const g = u.push(angleZ(sc.gear));
    const p = up.push(angleZ(sc.pawl));
    if (!Number.isFinite(g)) {
      broke = true;
      break;
    }
    if (i === 240) g1 = g;
    if (i >= 240) {
      gmin = Math.min(gmin, g);
      gmax = Math.max(gmax, g);
      pmin = Math.min(pmin, p);
      pmax = Math.max(pmax, p);
      wmax = Math.max(wmax, Math.abs(sc.gear.angvel().z));
      sum += g;
      sum2 += g * g;
      cnt++;
    }
  }
  const drift = u.v - g1;
  const std = Math.sqrt(Math.max(0, sum2 / cnt - (sum / cnt) ** 2));
  sc.w.free();
  const D = (2 * Math.PI) / c.g.T;
  return { broke: broke || Math.abs(drift) > 0.5 * D, drift, gRange: gmax - gmin, std, pRange: pmax - pmin, wmax };
}

const out: any[] = [];
const rep = (_k: string, v: any) => (typeof v === 'number' && !Number.isFinite(v) ? String(v) : v);
for (const r of [0.5, 1, 1.5, 2.5]) {
  if (rArg && Number(rArg) !== r) continue;
  for (const kind of ['end', 'rod', 'corner']) {
    if (kindArg && kindArg !== kind) continue;
    const x = pick(r, kind);
    const tag = `${set}-${prof} r${r} T${gearSpec(r, set as any, prof as any).T} ${kind}`;
    if (!x) {
      console.log(`${tag}: no working ratchet found in the search`);
      out.push({ set, prof, r, kind, none: true });
      continue;
    }
    const c = findCand(x);
    const tau0 = c.mass * G;
    const sLock = x.sp > x.sm ? 1 : -1;
    const geo = geoOf(c);
    const aFree = sweep(geo, c, -sLock, 0.4, 2, 80);
    const aFree0 = sweep(geo, c, -sLock, 0, 2, 80);
    const aLock = sweep(geo, c, sLock, 0.4, 2, 80);
    const h = holding(c, sLock);
    const hFast = (() => {
      const sc = buildScene(c);
      settle(sc, c);
      const r = ramp(sc, c, sLock, 1e-3 * tau0, 0.5, 4);
      sc.w.free();
      return r;
    })();
    const dr = drag(c, -sLock, Math.max(4 * Math.min(x.sp, x.sm), 0.05) * tau0);
    const cl2 = clicks(c, -sLock, 2);
    const cl = [2, 10, 40, 120].map((w) => clicks(c, -sLock, w, cl2.A));
    const ws = [5, 10, 20, 40, 80, 160, 320];
    const ccd: Record<string, any[]> = {};
    for (const mode of ['off', 'hard', 'soft'] as const) ccd[mode] = ws.map((w) => catchAt(c, sLock, w, { ccd: mode }));
    const maxCatch = (m: string) => {
      let best = 0;
      for (let i = 0; i < ws.length; i++) {
        if (ccd[m]![i]!.caught) best = ws[i]!;
        else break;
      }
      return best;
    };
    const rev: Record<string, string> = {};
    for (const mode of ['off', 'hard', 'soft'] as const) rev[mode] = [5, 20, 80, 320].map((w) => `${w}:${fmt(reversal(c, sLock, w, { ccd: mode }), 2)}`).join(' ');
    const tauHold = Math.min(0.5 * h.tau, 1e3 * tau0);
    const h20 = hold60(c, sLock, tauHold, 20);
    const h60 = hold60(c, sLock, L5, 60);
    const row = {
      tag, l: c.l, pivot: c.p, sigma: c.sigma, alphaDeg: (c.alpha * 180) / Math.PI, onEnd: c.onEnd, mPawl: c.mass, tau0, L5,
      dipAnalytic: aFree.dip,
      lockAnalytic: aLock.peak / tau0, lockSlow: h.tau / tau0, lockSlowLift: h.lift, lockFast: hFast.tau / tau0,
      freeAnalytic: aFree.peak / tau0, freeAnalytic0: aFree0.peakMu0 / tau0, freeU: aFree0.peakU / tau0, freeSim: dr / tau0,
      clicks: cl.map((q, i) => ({ w: [2, 10, 40, 120][i], perTooth: q.perTooth, liftMax: q.mx, liftMin: q.mn })),
      catch: Object.fromEntries(Object.entries(ccd).map(([m, a]) => [m, a.map((q, i) => `${ws[i]}:${q.caught ? 'Y' : 'n'}${fmt(q.travel, 2)}/${fmt(q.lift, 2)}`).join(' ')])),
      maxCatch: { off: maxCatch('off'), hard: maxCatch('hard'), soft: maxCatch('soft') },
      reversalPitches: rev,
      hold20half: { tau: tauHold / tau0, ...h20 },
      hold60L5: { tau: L5 / tau0, ...h60 },
    };
    out.push(row);
    console.log(JSON.stringify(row, rep));
  }
}
writeFileSync(new URL(`./results/detail${process.env.NF ? '-nf' + process.env.NF : ''}-${set}-${prof}${rArg ? '-' + rArg : ''}${kindArg ? '-' + kindArg : ''}.json`, import.meta.url), JSON.stringify(out, rep, 1));
