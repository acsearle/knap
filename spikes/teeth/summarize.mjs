// Summarise ratchet search results: node spikes/teeth/summarize.mjs
import { readFileSync, readdirSync } from 'node:fs';
const dir = new URL('./out/results/', import.meta.url);
const files = readdirSync(dir).filter((f) => /^search-(fine|coarse)-(trap|saw)\.json$/.test(f));
const num = (v) => (v === 'Infinity' ? Infinity : v);
const med = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : NaN; };
const f = (x, d = 3) => (x === undefined || Number.isNaN(x) ? '-' : Number.isFinite(x) ? (+x).toPrecision(d) : 'inf');
console.log('combo                    kind   cands simd ratchets(sim) agree  lock τ0 med[min..max]   free τ0 med   free sim/analytic med   best (l pivot σ lock/free)');
for (const file of files.sort()) {
  const rows = JSON.parse(readFileSync(new URL(file, dir), 'utf8')).map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, num(v)])));
  const keys = [...new Set(rows.map((r) => `${r.set}-${r.prof} r${r.r} T${r.T}|${r.kind}`))];
  for (const key of keys) {
    const [combo, kind] = key.split('|');
    const rs = rows.filter((r) => `${r.set}-${r.prof} r${r.r} T${r.T}` === combo && r.kind === kind);
    const sim = rs.filter((r) => r.sp !== undefined && r.settled);
    const good = sim.filter((r) => r.simRatchet);
    const agree = sim.filter((r) => r.simRatchet === r.analyticRatchet).length;
    const locks = good.map((r) => Math.max(r.sp, r.sm));
    const frees = good.map((r) => Math.min(r.sp, r.sm));
    const ratio = good.map((r) => { const s = r.sp < r.sm ? 1 : -1; const a = s > 0 ? r.ap : r.am; return Math.min(r.sp, r.sm) / a; }).filter(Number.isFinite);
    const best = [...good].sort((a, b) => Math.min(Math.max(b.sp, b.sm), 300) / Math.max(Math.min(b.sp, b.sm), 0.05) - Math.min(Math.max(a.sp, a.sm), 300) / Math.max(Math.min(a.sp, a.sm), 0.05))[0];
    console.log(`${combo.padEnd(24)} ${kind.padEnd(6)} ${String(rs.length).padStart(5)} ${String(sim.length).padStart(4)} ${String(good.length).padStart(5)} ${String(agree).padStart(10)}/${sim.length}  ${f(med(locks))} [${f(Math.min(...locks))}..${f(Math.max(...locks))}]  ${f(med(frees))}  ${f(med(ratio))}  ${best ? `${best.l} (${best.px},${best.py}) ${best.sigma} ${f(Math.max(best.sp, best.sm))}/${f(Math.min(best.sp, best.sm))}` : '-'}`);
  }
}
