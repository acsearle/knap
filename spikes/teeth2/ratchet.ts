// Ratchet search over on-grid gravity pawls built from knap parts.
//   sh spikes/teeth2/run.sh ratchet search <r> [kinds=end,rod,corner,pinx] [lmax=3]
//     → out/search-r<r>.json + a table on stdout
// For every pivot (px ≥ 0 by mirror symmetry, integer grid, gear at the origin, axis Z, gravity −Y),
// pawl kind and length l, and each of the 4 edit-time arm directions that is legal (no pawl cell in
// the gear layer overlaps the pitch disc by the §2.6 rule, and no pawl collider overlaps the tip
// circle), the pawl is dropped under gravity onto the gear (gear held), then the gear is released
// and an exponential torque ramp (×10 per 0.4 s from 1e-3·τ0, τ0 = m_pawl·g·1 unit) is applied in
// each direction until the gear has turned one tooth pitch. Joint friction: velocity motors with
// τ = μ·m·g·R_BORE on both pivots (μ = 0.2, sim.ts 'realistic', load = own weight).
import { writeFileSync } from 'node:fs';
import { RAPIER, gear, gearDescs, partDescs, pawlParts, pawlReach, makeWorld, fixed, body, revZ, vmotor, angleZ, Unwrap, G, DT, R_BORE, fmt, cpu, G_TOOTH, BIT, grp } from './lib';
import type { Gear, PawlKind, Rep } from './lib';

export interface Cand {
  r: number;
  kind: PawlKind;
  l: number;
  px: number;
  py: number;
  beta: number; // edit-time arm direction (rad)
}
export interface SceneOpts {
  rep?: Rep;
  mu?: number; // joint friction level
  muGear?: number;
  dt?: number;
  iters?: number;
  softCcd?: number; // soft-CCD prediction distance on gear and pawl (0 = off, as for jointed bodies in sim.ts)
  contactFriction?: number;
  flywheel?: number; // density of an extra invisible disc of radius 2.5 on the gear (inertia load), 0 = none
}
export function scene(c: Cand, o: SceneOpts = {}) {
  const g = gear(c.r);
  const w = makeWorld({ dt: o.dt, iters: o.iters });
  const f = fixed(w);
  const gb = body(w, [0, 0, 0], 0, gearDescs(g, { rep: o.rep ?? 'hull', friction: o.contactFriction, toothGroup: o.rep === 'smooth' ? G_TOOTH : undefined }), o.iters);
  if (o.flywheel) w.createCollider(RAPIER.ColliderDesc.cylinder(0.46, 2.5).setRotation({ x: Math.SQRT1_2, y: 0, z: 0, w: Math.SQRT1_2 }).setDensity(o.flywheel).setCollisionGroups(0), gb);
  const jg = revZ(w, f, gb, [0, 0, 0]);
  const { parts, pivotZ } = pawlParts(c.kind, c.l);
  const pb = body(w, [c.px, c.py, pivotZ], c.beta, partDescs(parts, [0, 0, pivotZ], grp(BIT.PAWL, BIT.TOOTH), o.contactFriction ?? 0.4), o.iters);
  const jp = revZ(w, f, pb, [c.px, c.py, pivotZ]);
  const mu = o.mu ?? 0.2;
  const muG = o.muGear ?? mu;
  const tfp = mu * pb.mass() * G * R_BORE;
  const tfg = muG * gb.mass() * G * R_BORE;
  vmotor(w, jp, 0, tfp);
  vmotor(w, jg, 0, 1e12); // held while the pawl settles
  if (o.softCcd) {
    gb.setSoftCcdPrediction(o.softCcd);
    pb.setSoftCcdPrediction(o.softCcd);
  }
  return { w, f, g, gb, pb, jg, jp, tfp, tfg, tau0: pb.mass() * G };
}
export type Scene = ReturnType<typeof scene>;

/** Deepest penetration (units, ≥ 0) among gear–pawl contact points right now. */
export function penetration(sc: Scene): number {
  let d = 0;
  for (let i = 0; i < sc.gb.numColliders(); i++)
    for (let k = 0; k < sc.pb.numColliders(); k++)
      sc.w.contactPair(sc.gb.collider(i), sc.pb.collider(k), (m: any) => {
        for (let j = 0; j < m.numContacts(); j++) d = Math.max(d, -m.contactDist(j));
      });
  return d;
}
export function touching(sc: Scene): number {
  let n = 0;
  for (let i = 0; i < sc.gb.numColliders(); i++)
    for (let k = 0; k < sc.pb.numColliders(); k++)
      sc.w.contactPair(sc.gb.collider(i), sc.pb.collider(k), (m: any) => {
        n += m.numContacts();
      });
  return n;
}

/** Drop the pawl; returns its rest angle or null if it is not resting on the gear. */
export function settle(sc: Scene, secs = 0.6): number | null {
  const n = Math.round(secs / sc.w.timestep);
  for (let i = 0; i < n; i++) sc.w.step();
  const a = angleZ(sc.pb);
  if (!Number.isFinite(a) || Math.abs(sc.pb.angvel().z) > 0.05) return null;
  return touching(sc) > 0 ? a : null;
}
export function release(sc: Scene) {
  vmotor(sc.w, sc.jg, 0, sc.tfg);
}

export interface Ramp {
  tau: number; // τ/τ0 when the gear passed one pitch (Infinity = never)
  lift: number; // max pawl rotation away from rest (rad, unsigned)
  pen?: number; // deepest gear–pawl penetration seen (units), when tracked
  how: string; // 'free' | 'skip' (pawl lifted ≥ 0.05 rad before passing) | 'tunnel' (passed without lifting) | 'held' | 'nan'
}
export function ramp(sc: Scene, s: number, dec = 0.4, tMax = 2.9, start = 1e-3, trackPen = false): Ramp {
  let pen = 0;
  const D = sc.g.D;
  const ug = new Unwrap(angleZ(sc.gb));
  const g0 = ug.v;
  const up = new Unwrap(angleZ(sc.pb));
  const p0 = up.v;
  let lift = 0;
  const dt = sc.w.timestep;
  const n = Math.round(tMax / dt);
  for (let i = 0; i < n; i++) {
    const tau = s * start * sc.tau0 * Math.pow(10, (i * dt) / dec);
    sc.gb.resetTorques(false);
    sc.gb.addTorque({ x: 0, y: 0, z: tau }, true);
    sc.w.step();
    const th = ug.push(angleZ(sc.gb));
    const pa = up.push(angleZ(sc.pb));
    if (!Number.isFinite(th) || !Number.isFinite(pa)) return { tau: NaN, lift, how: 'nan' };
    lift = Math.max(lift, Math.abs(pa - p0));
    if (trackPen) pen = Math.max(pen, penetration(sc));
    if (s * (th - g0) > D) {
      const t = Math.abs(tau) / sc.tau0;
      const how = trackPen ? (t < 0.3 ? 'free' : pen > 0.1 ? 'tunnel' : 'skip') : t < 0.3 ? 'free' : lift >= 0.05 ? 'skip' : 'tunnel';
      return { tau: t, lift, how, pen };
    }
  }
  sc.gb.resetTorques(false);
  return { tau: Infinity, lift, how: 'held', pen };
}

/** Legal edit-time directions for a candidate pivot (see header). */
export function legalBetas(g: Gear, kind: PawlKind, l: number, px: number, py: number): number[] {
  const out: number[] = [];
  for (const b of [0, 1, 2, 3]) {
    const [cx, cy] = [Math.round(Math.cos((b * Math.PI) / 2)), Math.round(Math.sin((b * Math.PI) / 2))];
    let ok = true;
    for (let k = 0; k <= l; k++) {
      if (kind === 'rod' && k < l) continue; // arm is one layer up
      const du = px + k * cx, dv = py + k * cy;
      const m = Math.max(0, Math.abs(du) - 0.5) ** 2 + Math.max(0, Math.abs(dv) - 0.5) ** 2;
      if (m < g.r * g.r) ok = false; // §2.6 blocking (nominal disc r)
      const mc = Math.max(0, Math.abs(du) - 0.47) ** 2 + Math.max(0, Math.abs(dv) - 0.47) ** 2;
      if (mc < (g.tip + 0.005) ** 2) ok = false; // collider would start inside the teeth
    }
    if (kind === 'rod' && px === 0 && py === 0) ok = false;
    if (ok) out.push((b * Math.PI) / 2);
  }
  return out;
}

async function search(args: string[]) {
  await RAPIER.init();
  const r = Number(args[0]);
  const kinds = (args[1] ?? 'end,rod,corner,pinx').split(',') as PawlKind[];
  const lmax = Number(args[2] ?? 3);
  const g = gear(r);
  const rows: any[] = [];
  const t0 = cpu();
  let sims = 0;
  for (const kind of kinds)
    for (let l = 1; l <= lmax; l++) {
      const reach = pawlReach(kind, l) + g.tip;
      const R = Math.ceil(reach);
      for (let px = 0; px <= R; px++)
        for (let py = -R; py <= R; py++) {
          if (Math.hypot(px, py) > reach) continue;
          const betas = legalBetas(g, kind, l, px, py);
          const rests: number[] = [];
          for (const beta of betas) {
            const c: Cand = { r, kind, l, px, py, beta };
            const sc = scene(c, { rep: (process.env.REP ?? 'hull') as Rep });
            const a = settle(sc);
            sims++;
            sc.w.free();
            if (a === null) continue;
            if (rests.some((x) => Math.abs(Math.atan2(Math.sin(x - a), Math.cos(x - a))) < 0.05)) continue;
            rests.push(a);
            const res: any = { r, T: g.T, kind, l, px, py, beta, rest: a };
            for (const [rep, tag] of [[(process.env.REP ?? 'hull') as Rep, ''], ['smooth', 'S']] as [Rep, string][]) {
              for (const s of [1, -1]) {
                const sc2 = scene(c, { rep });
                const a2 = settle(sc2);
                if (a2 === null) {
                  res[`${tag}${s > 0 ? 'p' : 'm'}`] = { tau: NaN, lift: 0, how: 'nosettle' };
                  sc2.w.free();
                  continue;
                }
                release(sc2);
                res[`${tag}${s > 0 ? 'p' : 'm'}`] = ramp(sc2, s);
                sc2.w.free();
                sims++;
              }
            }
            rows.push(res);
            const lo = Math.min(res.p.tau, res.m.tau), hi = Math.max(res.p.tau, res.m.tau);
            console.log(`${kind.padEnd(6)} l${l} pivot (${px},${py}) β${Math.round((beta * 180) / Math.PI)} rest ${fmt((a * 180) / Math.PI)}°  teeth +:${fmt(res.p.tau)} ${res.p.how} −:${fmt(res.m.tau)} ${res.m.how}  smooth +:${fmt(res.Sp.tau)} ${res.Sp.how} −:${fmt(res.Sm.tau)} ${res.Sm.how}${hi >= 20 * lo && hi >= 3 ? '  <== RATCHET' : ''}`);
          }
        }
    }
  console.log(`r ${r}: ${rows.length} resting candidates, ${sims} simulations, ${fmt((cpu() - t0) / 1000)} cpu-s`);
  writeFileSync(new URL(`./search-r${r}${args[1] ? '-' + kinds.join('_') : ''}${process.env.REP ? '-' + process.env.REP : ''}.json`, import.meta.url), JSON.stringify(rows, (_k, v) => (v === Infinity ? 'Infinity' : v)));
}

const [mode, ...rest] = process.argv.slice(2);
if (mode === 'search') {
  await search(rest);
  process.exit(0);
}
