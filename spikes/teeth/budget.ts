// Collider budget: ten r = 2.5 gears spinning freely on revolutes, touching nothing; then with a
// gravity pawl resting on each. Toothed (T+1 colliders + gear-gear cylinder), the same pieces as
// ONE compound collider, and a plain 16-gon cylinder at tip radius (a wheel).
//   sh spikes/teeth/build.sh budget [reps]
import { RAPIER, DT, angleZ, fixedBody, gearColliderDescs, gearSpec, jointedBody, makeWorld, pawlColliderDescs, revoluteZ, frictionMotor, velocityMotor, PIVOT_MU, G, R_BORE, median, now, fmt } from './lib';
import type { GearColliders } from './lib';
import { candidates, geoOf } from './ratchet';
import { sweep } from './analytic';

await RAPIER.init();
const reps = Number(process.argv[2] ?? 5);
const SP = 7;

const gFine = gearSpec(2.5, 'fine');
// a pawl that works on the r = 2.5 fine gear (first analytic ratchet with a short arm)
const cands = candidates(gFine, 'end', 2);
let pawl = cands[0]!;
let sFree = 1;
for (const c of cands) {
  const geo = geoOf(c);
  const a = sweep(geo, c, 1, 0.4).peak, b = sweep(geo, c, -1, 0.4).peak;
  if (Math.max(a, b) === Infinity && Math.min(a, b) < 2 * c.mass * G) {
    pawl = c;
    sFree = a < b ? 1 : -1;
    break;
  }
}
console.log(`pawl: 'end' l=${pawl.l} pivot (${pawl.p}) rest α=${fmt(pawl.alpha)} σ=${pawl.sigma}`);

function scene(kind: GearColliders | 'none', withPawls: boolean, gearCyl = true) {
  const t0 = now();
  const w = makeWorld();
  const f = fixedBody(w);
  const gears: any[] = [];
  for (let i = 0; i < 10; i++) {
    const x = i * SP;
    if (kind !== 'none') {
      const gb = jointedBody(w, [x, 0, 0], 0, gearColliderDescs(gFine, kind, gearCyl));
      const jg = revoluteZ(w, f, gb, [x, 0, 0]);
      if (withPawls) velocityMotor(w, jg, 20 * sFree, 1e6); // driven the free way: pawls click
      else gb.setAngvel({ x: 0, y: 0, z: 20 }, true);
      gears.push(gb);
    }
    if (withPawls) {
      const pb = jointedBody(w, [x + pawl.p[0], pawl.p[1], 0], pawl.alpha - pawl.sigma * 0.003, pawlColliderDescs('end', pawl.l));
      const jp = revoluteZ(w, f, pb, [x + pawl.p[0], pawl.p[1], 0]);
      frictionMotor(w, jp, PIVOT_MU * pb.mass() * G * R_BORE);
    }
  }
  const tBuild = now() - t0;
  const t1 = now();
  w.step();
  const tFirst = now() - t1;
  return { w, gears, tBuild, tFirst };
}

const variants: [string, GearColliders | 'none', boolean][] = [
  ['teeth (T+1 colliders + gear cyl)', 'teeth', true],
  ['teeth, no gear-gear cyl', 'teeth', false],
  ['compound (1 collider) + gear cyl', 'compound', true],
  ['plain cylinder (16-gon, 1 collider)', 'cylinder', false],
];
for (const withPawls of [false, true]) {
  console.log(withPawls ? '\n== with a resting pawl on each gear (gears motor-driven the free way at 20 rad/s) ==' : '== ten gears spinning at 20 rad/s, touching nothing ==');
  const rows: Record<string, { b: number[]; f: number[]; s: number[]; nc: number; spin: number }> = {};
  if (withPawls) variants.push(['pawls only (no gears)', 'none', false]);
  for (let rep = 0; rep < reps; rep++)
    for (const [name, kind, gc] of variants) {
      if (!withPawls && kind === 'none') continue;
      const sc = scene(kind, withPawls, gc);
      const t0 = now();
      for (let i = 0; i < 480; i++) sc.w.step();
      const ts = now() - t0;
      let nc = 0;
      sc.w.forEachCollider(() => nc++);
      const row = (rows[name] ??= { b: [], f: [], s: [], nc, spin: 0 });
      row.b.push(sc.tBuild);
      row.f.push(sc.tFirst);
      row.s.push(ts);
      row.spin = sc.gears.length ? sc.gears[0].angvel().z : 0;
      void angleZ;
      sc.w.free();
    }
  for (const [name, r] of Object.entries(rows))
    console.log(`${name.padEnd(38)} colliders ${String(r.nc).padStart(4)}  build ${fmt(median(r.b))} ms  first step ${fmt(median(r.f))} ms  1 s simulated: ${fmt(median(r.s))} ms (min ${fmt(Math.min(...r.s))})  gear0 ω after 1 s ${fmt(r.spin)}`);
}
void DT;
