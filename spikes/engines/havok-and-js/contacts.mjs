// B1-B5 contact tests on raw Havok. Usage: node contacts.mjs [U] [substeps]
//   U = internal units per stud (0.008 = metres [default], 1 = studs)
//   substeps = number of Havok steps per 1/480 s (default 1)
import { World, DT, G, sub, len, tilt, fmt, rot, qaxis } from "./hv.mjs";
const U = Number(process.argv[2] ?? 0.008);
const SUB = Number(process.argv[3] ?? 1);
const dt = DT / SUB;
const mk = (o = {}) => new World({ U, dt, ideal: dt, ...o });
const HC = 0.46;
const out = (...a) => console.log(...a);
out(`# Havok contacts, U=${U} internal units per stud, ${SUB} step(s) per 1/480 s`);

function floor(w, big = false) { // top at y = 0
  const e = big ? [4000, 20, 4000] : [40, 1, 40];
  return w.body(w.box(e), { pos: [0, -e[1] / 2, 0], dynamic: false });
}
const run = (w, secs, cb) => { const n = Math.round(secs * 480); for (let i = 0; i < n; i++) { w.step(SUB); cb && cb(i + 1, (i + 1) / 480); } };
const hspeed = (v) => Math.hypot(v[0], v[2]);

// B1a
{
  const w = mk(); floor(w); const c = w.body(w.box([0.92, 0.92, 0.92]), { pos: [0, HC, 0] });
  run(w, 2);
  const { p, q } = w.pose(c);
  out(`B1a cube on fixed box floor 2s: sink=${fmt(HC - p[1], 5)} studs, drift speed=${fmt(hspeed(w.vel(c)))} studs/s, x drift=${fmt(p[0], 5)}, tilt=${fmt(tilt(q))} rad`);
}
// B1b
{
  const w = mk(); floor(w); const b = w.body(w.box([9, 0.92, 0.92]), { pos: [0, HC, 0] });
  const c = w.body(w.box([0.92, 0.92, 0.92]), { pos: [0, 3 * HC, 0] });
  run(w, 2);
  const pb = w.pose(b).p, pc = w.pose(c).p;
  out(`B1b cube on loose beam9: cube into beam=${fmt(2 * HC - (pc[1] - pb[1]), 5)}, beam into floor=${fmt(HC - pb[1], 5)}, cube speed=${fmt(len(w.vel(c)))}`);
}
// B1c
for (const heavy of [1, 10]) {
  const w = mk(); floor(w); const cs = [];
  for (let i = 0; i < 5; i++) cs.push(w.body(w.box([0.92, 0.92, 0.92]), { pos: [0, HC + 0.92 * i, 0], densityScale: i === 4 ? heavy : 1 }));
  run(w, 3);
  const top = w.pose(cs[4]).p;
  const comp = HC + 0.92 * 4 - top[1];
  const maxOff = Math.max(...cs.map((c) => hspeed(w.pose(c).p)));
  out(`B1c stack of 5 (top x${heavy} denser) 3s: total compression=${fmt(comp, 5)} studs, max horizontal offset=${fmt(maxOff, 5)}, stands=${maxOff < 0.2 && comp < 0.1}`);
}
// B2
for (const v0 of [150, 300]) {
  const w = mk(); floor(w);
  const c = w.body(w.box([0.92, 0.92, 0.92]), { pos: [0, HC + v0 * DT * 0.5, 0] });
  w.setVel(c, [0, -v0, 0]);
  let minY = 1e9, maxUp = 0, side = 0, spin = 0, tSpin = 0;
  run(w, 0.5, (i, t) => {
    const { p } = w.pose(c); const v = w.vel(c);
    minY = Math.min(minY, p[1]); maxUp = Math.max(maxUp, v[1]); side = Math.max(side, hspeed(v)); const sp=len(w.ang(c)); if (sp>spin){spin=sp;tSpin=t;}
  });
  out(`B2 drop at ${v0} studs/s: deepest penetration=${fmt(HC - minY, 4)} studs, max rebound=${fmt(maxUp)} studs/s, max sideways=${fmt(side)} studs/s, max spin=${fmt(spin)} rad/s, final y=${fmt(w.pose(c).p[1], 4)}, final tilt=${fmt(tilt(w.pose(c).q), 4)}, spin at 0.5 s=${fmt(len(w.ang(c)))}, t of max spin=${fmt(tSpin,4)} s`);
}
// B3
for (const lim of [true, false]) {
  const w = mk(lim ? { speed: null } : {});
  const c = w.body(w.box([0.92, 0.92, 0.92]), { pos: [0, 0, 0] });
  const s = [];
  run(w, 1.5, (i) => { if (i % 240 === 0) s.push(-w.vel(c)[1]); });
  out(`B3 free fall (${lim ? `default speed limit ${w.defaultSpeed[0]} int.units/s=${fmt(w.defaultSpeed[0] / U)} studs/s, ang ${w.defaultSpeed[1]} rad/s` : "limit raised to 1e6"}): v at 0.5/1.0/1.5 s = ${[s[0], s[1], s[2]].map((x) => fmt(x, 1)).join(" / ")} (g*t 613/1226/1839)`);
}
// B4a box on fixed 32-gon top face
{
  const spots = [[0, 0], [0.15, 0], [0.3, 0], [0.38, 0], [0, 0.3], [0.21, 0.21], [-0.3, -0.15]];
  const res = [];
  for (const [x, z] of spots) {
    const w = mk(); floor(w, true);
    w.body(w.prism(32, 0.5, -0.5, 0), { pos: [0, 2, 0], dynamic: false });
    const b = w.body(w.box([0.16, 0.1, 0.16]), { pos: [x, 2.05, z] });
    run(w, 2);
    const { p, q } = w.pose(b);
    res.push(`(${x},${z}): sink=${fmt(2.05 - p[1], 4)} tilt=${fmt(tilt(q), 4)}${p[1] < 1.9 ? " FELL" : ""}`);
  }
  out(`B4a box on 32-gon top 2s: ${res.join("; ")}`);
}
// B4b dynamic n-gon prisms on flat end
for (const n of [16, 32]) for (const big of [false, true]) {
  const w = mk(); floor(w, big);
  const b = w.body(w.prism(n, 0.5, -0.46, 0.46), { pos: [0, 0.46, 0] });
  run(w, 2);
  const { p, q } = w.pose(b);
  out(`B4b ${n}-gon prism on end, ${big ? "4000-stud floor box" : "40-stud floor box"} 2s: sink=${fmt(0.46 - p[1], 5)} tilt=${fmt(tilt(q), 5)} rad, x/z drift=${fmt(p[0], 4)}/${fmt(p[2], 4)}`);
}
// B5a/B5b wheel r1 on its side
const qWheel = [0, 0, 0, 1]; // cylinder built along Z
function wheel(w, r, pos, opts = {}) { return w.body(w.cyl([0, 0, -HC], [0, 0, HC], r), { pos, ...opts }); }
for (const big of [false, true]) for (const v0 of [0, 1]) {
  const w = mk(); floor(w, big);
  const c = wheel(w, 1, [0, 1, 0]);
  w.setVel(c, [v0, 0, 0]); w.setAng(c, [0, 0, -v0 / 1]);
  const sp = [];
  run(w, 5, (i) => { if (i % 480 === 0) sp.push(w.vel(c)[0]); });
  out(`B5a wheel r1 v0=${v0} on ${big ? "4000-stud box (plane stand-in)" : "40x1x40 box"}: vx at 1..5 s = ${sp.map((x) => fmt(x, 4)).join(", ")} studs/s; sink=${fmt(1 - w.pose(c).p[1], 5)}`);
}
for (const big of [false, true]) {
  const w = mk(); floor(w, big);
  const c = wheel(w, 1, [-100, 1, 0]);
  w.setVel(c, [100, 0, 0]); w.setAng(c, [0, 0, -100]);
  let maxSink = 0;
  run(w, 2, (i) => { if (i > 48) maxSink = Math.max(maxSink, 1 - w.pose(c).p[1]); });
  const vx = w.vel(c)[0];
  out(`B5b wheel r1 rolling 100 studs/s 2s on ${big ? "4000" : "40"}-stud box: kept ${fmt(vx, 2)}% (vx=${fmt(vx, 2)}), max sink while rolling=${fmt(maxSink, 4)}, final x=${fmt(w.pose(c).p[0], 2)}, y=${fmt(w.pose(c).p[1], 3)}`);
}
// B5c wheel r2.5 standing on rim on loose beam 9
{
  const w = mk(); floor(w);
  const b = w.body(w.box([9, 0.92, 0.92]), { pos: [0, HC, 0] });
  // cylinder axis along X so it rolls along Z across the beam? Stand it with axis along Z, rolling along X (along the beam).
  const c = wheel(w, 2.5, [0, 0.92 + 2.5, 0]);
  let maxSink = 0;
  run(w, 2, () => { maxSink = Math.max(maxSink, 0.92 + 2.5 - (w.pose(c).p[1] - (w.pose(b).p[1] - HC))); });
  const pc = w.pose(c).p, pb = w.pose(b).p;
  out(`B5c wheel r2.5 on rim on loose beam9 2s: sink into beam=${fmt(pb[1] + HC + 2.5 - pc[1], 5)} (max ${fmt(maxSink, 5)}), beam into floor=${fmt(HC - pb[1], 5)}, wheel x drift=${fmt(pc[0], 5)} speed=${fmt(len(w.vel(c)), 5)}, stays=${Math.abs(pc[0]) < 4.5 && pc[1] > 3}`);
}
process.exit(0);
