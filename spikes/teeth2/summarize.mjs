// node spikes/teeth2/summarize.mjs  — tables from out/search-r*.json
import { readFileSync, existsSync } from 'node:fs';
const num = (v) => (v === 'Infinity' ? Infinity : v);
const f = (x) => (Number.isFinite(x) ? x.toPrecision(3) : String(x));
for (const r of [0.5, 1, 1.5, 2.5]) {
  const p = new URL(`./out/search-r${r}.json`, import.meta.url);
  if (!existsSync(p)) continue;
  const rows = JSON.parse(readFileSync(p, 'utf8')).filter((x) => x.kind !== 'rod');
  const pr = new URL(`./out/search-r${r}-rod.json`, import.meta.url);
  if (existsSync(pr)) rows.push(...JSON.parse(readFileSync(pr, 'utf8')));
  console.log(`\nr ${r} (T ${rows[0]?.T}): ${rows.length} resting placements`);
  for (const kind of ['end', 'rod', 'corner', 'pinx']) {
    const rs = rows.filter((x) => x.kind === kind);
    const rat = [];
    for (const x of rs) {
      const P = num(x.p.tau), M = num(x.m.tau), SP = num(x.Sp.tau), SM = num(x.Sm.tau);
      const lockS = P > M ? 1 : -1;
      const lock = Math.max(P, M), free = Math.min(P, M);
      const sl = lockS > 0 ? SP : SM;
      if (!(lock >= 20 * free && lock >= 3)) continue;
      rat.push({ ...x, lock, free, lockS, smoothLock: sl, mech: sl >= 0.5 * lock ? 'friction-sprag' : sl >= 3 ? 'mixed' : 'tooth' });
    }
    rat.sort((a, b) => b.lock - a.lock);
    const tooth = rat.filter((x) => x.mech === 'tooth');
    console.log(`  ${kind.padEnd(6)} placements ${String(rs.length).padStart(3)}  ratchets ${String(rat.length).padStart(3)} (tooth-locked ${tooth.length}, friction-sprag ${rat.filter((x) => x.mech === 'friction-sprag').length})  best: ${rat.slice(0, 3).map((x) => `l${x.l} (${x.px},${x.py}) β${Math.round((x.beta * 180) / Math.PI)} rest ${Math.round((x.rest * 180) / Math.PI)}° lock ${f(x.lock)}${x.lockS > 0 ? '+' : '−'} free ${f(x.free)} smooth ${f(x.smoothLock)} [${x.mech}]`).join('; ') || '-'}`);
  }
}
