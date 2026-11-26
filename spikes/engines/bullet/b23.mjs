// B2 impacts and B3 free fall: node b23.mjs <regime>
import { ammo, World, RHO, G_REAL, f, regimeArg, norm } from './lib.mjs';
const A = await ammo();
const reg = regimeArg(), H = 0.46, mC = RHO * 0.92 ** 3;
for (const v of [150, 300]) for (const floor of ['box', 'plane']) {
  const w = new World({ regime: reg });
  if (floor === 'plane') w.body(w.planeShape(), 0, [0, 0, 0]); else w.body(w.boxShape(20, 0.5, 20), 0, [0, -0.5, 0]);
  const c = w.body(w.boxShape(H, H, H), mC, [0, H + 1.5, 0]); w.setVel(c, [0, -v, 0]); w.w.setGravity(w.v(0, 0, 0));
  let deep = 0, hit = false, tHit = 0; const out = {};
  for (let i = 0; i < 480; i++) {
    w.step(); const y = w.pos(c)[1]; deep = Math.max(deep, H - y);
    if (!hit && y < H + 0.01) { hit = true; tHit = i; }
    if (hit && i === tHit + 24) { out.vy = w.vel(c)[1]; out.side = Math.hypot(w.vel(c)[0], w.vel(c)[2]); out.spin = norm(w.angvel(c)); }
  }
  console.log(`B2 ${floor} at ${v}: deepest ${f(deep)} studs, 0.05 s after impact: rebound vy ${f(out.vy)}, sideways ${f(out.side)} studs/s, spin ${f(out.spin)} rad/s (no gravity during the test)`);
}
{ // with gravity: dropped from a height that gives v at impact
  for (const v of [150, 300]) {
    const w = new World({ regime: reg }); w.body(w.boxShape(20, 0.5, 20), 0, [0, -0.5, 0]);
    const hgt = (v * v) / (2 * G_REAL); const c = w.body(w.boxShape(H, H, H), mC, [0, H + hgt, 0]);
    let deep = 0; for (let i = 0; i < 480; i++) { w.step(); deep = Math.max(deep, H - w.pos(c)[1]); }
    console.log(`B2g box floor, dropped from ${f(hgt, 2)} studs (impact ~${v}): deepest ${f(deep)}, after 1 s |v| ${f(norm(w.vel(c)))} spin ${f(norm(w.angvel(c)))} y ${f(w.pos(c)[1])}`);
  }
}
{ // B3
  const w = new World({ regime: reg }); const c = w.body(w.boxShape(H, H, H), mC, [0, 0, 0], [0, 0, 0, 1], { mask: 0 });
  const out = []; for (let i = 1; i <= 720; i++) { w.step(); if (i % 240 === 0) out.push(`${i / 480}s ${f(-w.vel(c)[1], 2)} (gt ${f((G_REAL * i) / 480, 2)})`); }
  console.log(`B3 free fall speed: ${out.join(', ')}`);
}
process.exit(0);
