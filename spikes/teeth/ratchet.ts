// Ratchet spike: gear on a revolute (fixed frame) + gravity pawl pivoted on the integer grid.
//   sh spikes/teeth/build.sh ratchet search [set] [profile] [r] [kind]   → grid search (analytic all, sim subset)
//   sh spikes/teeth/build.sh ratchet one <set> <profile> <r> <kind> <l> <px> <py> <restIndex>
import { RAPIER, DT, G, PIVOT_MU, R_BORE, angleZ, Unwrap, fixedBody, frictionMotor, gearColliderDescs, gearSpec, jointedBody, makeWorld, pawlColliderDescs, revoluteZ, tipR, fmt, now } from './lib';
import type { GearSpec, PawlKind, Profile, GearColliders } from './lib';
import { Geo, sweep } from './analytic';
import type { P2, } from './lib';
import { writeFileSync, mkdirSync } from 'node:fs';

export interface Cand {
  g: GearSpec;
  kind: PawlKind;
  l: number;
  p: P2;
  alpha: number;
  sigma: number;
  mass: number;
  com: P2;
  onEnd: boolean;
}

const massCache = new Map<string, { mass: number; com: P2 }>();
export function pawlMass(kind: PawlKind, l: number) {
  const key = `${kind}${l}`;
  if (!massCache.has(key)) {
    const w = makeWorld();
    const rb = jointedBody(w, [0, 0, 0], 0, pawlColliderDescs(kind, l));
    const c = rb.localCom();
    massCache.set(key, { mass: rb.mass(), com: [c.x, c.y] });
    w.free();
  }
  return massCache.get(key)!;
}

export function candidates(g: GearSpec, kind: PawlKind, lmax = 4): Cand[] {
  const out: Cand[] = [];
  const tr = tipR(g);
  for (let l = 1; l <= lmax; l++) {
    if (kind === 'corner' && l < 1) continue;
    const { mass, com } = pawlMass(kind, l);
    const reach = l + 0.5 + tr;
    const R = Math.ceil(reach);
    for (let px = -R; px <= R; px++)
      for (let py = -R; py <= R; py++) {
        const d = Math.hypot(px, py);
        if (d > reach) continue;
        if (kind !== 'rod' && d < tr + 0.47) continue; // pivot barrel would overlap the gear
        if (kind === 'rod' && d < 1) continue;
        const geo = new Geo({ g, kind, l, p: [px, py], mass, comLocal: com });
        for (const r of geo.rests()) {
          const ct = geo.contact(r.alpha, 0);
          out.push({ g, kind, l, p: [px, py], alpha: r.alpha, sigma: r.sigma, mass, com, onEnd: ct.onEnd });
        }
      }
  }
  return out;
}

export function geoOf(c: Cand) {
  return new Geo({ g: c.g, kind: c.kind, l: c.l, p: c.p, mass: c.mass, comLocal: c.com });
}

// ---------------------------------------------------------------------------------------------
// Simulation

export interface SimOpts {
  ccd?: 'off' | 'hard' | 'soft';
  gearColliders?: GearColliders;
  pawlCcd?: boolean;
}
export function buildScene(c: Cand, o: SimOpts = {}) {
  const w = makeWorld({ ccd: o.ccd });
  const f = fixedBody(w);
  const gear = jointedBody(w, [0, 0, 0], 0, gearColliderDescs(c.g, o.gearColliders ?? 'teeth'));
  const jg = revoluteZ(w, f, gear, [0, 0, 0]);
  const a0 = c.alpha - c.sigma * 0.003;
  const pawl = jointedBody(w, [c.p[0], c.p[1], 0], a0, pawlColliderDescs(c.kind, c.l));
  const jp = revoluteZ(w, f, pawl, [c.p[0], c.p[1], 0]);
  const tfp = PIVOT_MU * pawl.mass() * G * R_BORE;
  frictionMotor(w, jp, tfp);
  if (o.ccd === 'hard') {
    gear.enableCcd(true);
    if (o.pawlCcd !== false) pawl.enableCcd(true);
  }
  if (o.ccd === 'soft') {
    gear.setSoftCcdPrediction(400 * DT * 1.25);
    pawl.setSoftCcdPrediction(400 * DT * 1.25);
  }
  return { w, f, gear, pawl, jg, jp, tfp };
}
export type Scene = ReturnType<typeof buildScene>;

/** Settle with the gear free; returns false if the pawl fell off or something blew up. */
export function settle(sc: Scene, c: Cand, steps = 120): boolean {
  for (let i = 0; i < steps; i++) sc.w.step();
  const a = angleZ(sc.pawl);
  if (!Number.isFinite(a)) return false;
  // still resting near the analytic rest (within 0.15 rad)?
  let d = a - c.alpha;
  d = Math.atan2(Math.sin(d), Math.cos(d));
  return Math.abs(d) < 0.15;
}

export interface RampResult {
  tau: number; // applied torque when the gear had moved one pitch in direction s (Infinity: never)
  lift: number; // max rise of the pawl against its weight during the run (rad)
  t: number;
}
/** Exponential torque ramp on the gear in direction s: τ = s·τa·10^(t/dec). */
export function ramp(sc: Scene, c: Cand, s: number, tauA: number, dec = 0.5, tMax = 3.5): RampResult {
  const D = (2 * Math.PI) / c.g.T;
  const ug = new Unwrap(angleZ(sc.gear));
  const g0 = ug.v;
  const up = new Unwrap(angleZ(sc.pawl));
  const p0 = up.v;
  let lift = 0;
  const n = Math.round(tMax / DT);
  for (let i = 0; i < n; i++) {
    const t = i * DT;
    const tau = s * tauA * Math.pow(10, t / dec);
    sc.gear.resetTorques(false);
    sc.gear.addTorque({ x: 0, y: 0, z: tau }, true);
    sc.w.step();
    const th = ug.push(angleZ(sc.gear));
    const pa = up.push(angleZ(sc.pawl));
    if (!Number.isFinite(th)) return { tau: NaN, lift, t };
    lift = Math.max(lift, -c.sigma * (pa - p0));
    if (s * (th - g0) > D) return { tau: Math.abs(tau), lift, t };
  }
  sc.gear.resetTorques(false);
  return { tau: Infinity, lift, t: tMax };
}

export function simRamp(c: Cand, s: number, o: SimOpts = {}, dec = 0.5): RampResult & { settled: boolean } {
  const sc = buildScene(c, o);
  const ok = settle(sc, c);
  if (!ok) {
    sc.w.free();
    return { tau: NaN, lift: 0, t: 0, settled: false };
  }
  const r = ramp(sc, c, s, 1e-3 * c.mass * G, dec);
  sc.w.free();
  return { ...r, settled: true };
}

// ---------------------------------------------------------------------------------------------
// CLI

const SETS: [('fine' | 'coarse'), Profile][] = [
  ['fine', 'trap'],
  ['coarse', 'trap'],
  ['fine', 'saw'],
  ['coarse', 'saw'],
];
const KINDS: PawlKind[] = ['end', 'rod', 'corner'];
const RS = [0.5, 1, 1.5, 2.5];

async function search(args: string[]) {
  await RAPIER.init();
  const setF = args[0], profF = args[1], rF = args[2] ? Number(args[2]) : undefined, kindF = args[3];
  mkdirSync(new URL('./results/', import.meta.url), { recursive: true });
  const all: any[] = [];
  for (const [set, prof] of SETS) {
    if (setF && setF !== set) continue;
    if (profF && profF !== prof) continue;
    for (const r of RS) {
      if (rF !== undefined && rF !== r) continue;
      const g = gearSpec(r, set, prof);
      for (const kind of KINDS) {
        if (kindF && kindF !== kind) continue;
        const t0 = now();
        const cs = candidates(g, kind);
        const rows: any[] = [];
        for (const c of cs) {
          const geo = geoOf(c);
          const rest = { alpha: c.alpha, sigma: c.sigma };
          const sp = sweep(geo, rest, +1, 0.4);
          const sm = sweep(geo, rest, -1, 0.4);
          const tau0 = c.mass * G;
          rows.push({ c, ap: sp.peak / tau0, am: sm.peak / tau0, ap0: sp.peakMu0 / tau0, am0: sm.peakMu0 / tau0, apU: sp.peakU / tau0, amU: sm.peakU / tau0, dip: Math.max(sp.dip, sm.dip) });
        }
        const tA = now() - t0;
        // simulate: every analytic ratchet (one direction jams or ≥ 10× the other), plus every 4th other
        let k = 0;
        for (const row of rows) {
          const lo = Math.min(row.ap, row.am), hi = Math.max(row.ap, row.am);
          row.analyticRatchet = hi >= 10 * Math.max(lo, 1e-3) && lo < 5;
          if (!row.analyticRatchet && k++ % 6 !== 0) continue;
          const tau0 = row.c.mass * G;
          const rp = simRamp(row.c, +1);
          const rm = simRamp(row.c, -1);
          row.sp = rp.tau / tau0;
          row.sm = rm.tau / tau0;
          row.liftP = rp.lift;
          row.liftM = rm.lift;
          row.settled = rp.settled && rm.settled;
        }
        const tS = now() - t0 - tA;
        let nR = 0, nSimR = 0, agree = 0, nSim = 0;
        for (const row of rows) {
          if (row.analyticRatchet) nR++;
          if (row.sp === undefined || !row.settled) continue;
          nSim++;
          const lo = Math.min(row.sp, row.sm), hi = Math.max(row.sp, row.sm);
          row.simRatchet = hi >= 10 * lo && lo < 5;
          if (row.simRatchet) nSimR++;
          if (row.simRatchet === row.analyticRatchet) agree++;
        }
        console.log(`${g.name.padEnd(20)} ${kind.padEnd(6)} cands ${String(rows.length).padStart(4)} analyticRatchets ${String(nR).padStart(3)} simulated ${String(nSim).padStart(3)} simRatchets ${String(nSimR).padStart(3)} agree ${agree}/${nSim}  (${(tA / 1000).toFixed(1)} s + ${(tS / 1000).toFixed(1)} s)`);
        for (const row of rows) {
          all.push({
            set, prof, r, T: g.T, kind, l: row.c.l, px: row.c.p[0], py: row.c.p[1], alpha: row.c.alpha, sigma: row.c.sigma, onEnd: row.c.onEnd, mass: row.c.mass,
            ap: row.ap, am: row.am, ap0: row.ap0, am0: row.am0, apU: row.apU, amU: row.amU, dip: row.dip,
            analyticRatchet: row.analyticRatchet, sp: row.sp, sm: row.sm, liftP: row.liftP, liftM: row.liftM, settled: row.settled, simRatchet: row.simRatchet,
          });
        }
      }
    }
  }
  const tag = [setF, profF, rF, kindF].filter((x) => x !== undefined).join('-') || 'all';
  writeFileSync(new URL(`./results/search-${tag}.json`, import.meta.url), JSON.stringify(all, (_k, v) => (v === Infinity ? 'Infinity' : v)));
}

async function one(args: string[]) {
  await RAPIER.init();
  const [set, prof, r, kind, l, px, py, ri] = args;
  const g = gearSpec(Number(r), set as any, prof as any);
  const cs = candidates(g, kind as PawlKind).filter((c) => c.l === Number(l) && c.p[0] === Number(px) && c.p[1] === Number(py));
  const c = cs[Number(ri ?? 0)]!;
  console.log(c);
  const geo = geoOf(c);
  for (const s of [1, -1]) {
    const sw = sweep(geo, c, s, 0.4);
    const sw0 = sweep(geo, c, s, 0);
    const r1 = simRamp(c, s);
    console.log(`s=${s}: analytic μ0.4 ${fmt(sw.peak / (c.mass * G))} τ0, μ0 ${fmt(sw0.peakMu0 / (c.mass * G))} τ0 (dU/dφ ${fmt(sw.peakU / (c.mass * G))}), dip ${fmt(sw.dip)}; sim ${fmt(r1.tau / (c.mass * G))} τ0 lift ${fmt(r1.lift)} rad`);
  }
}

const [mode, ...rest] = process.argv.slice(2);
if (mode === 'search') await search(rest);
else if (mode === 'one') await one(rest);
