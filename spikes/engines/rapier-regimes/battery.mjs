// The engine battery (../BATTERY.md) in pure Rapier, in one unit regime, all reported in real units.
//   node battery.mjs <regime> [test ...]        e.g. node battery.mjs R0 B1 B5a
// Regimes: see lib.mjs REGIMES. Writes results/<regime>.json (merged with earlier runs).
import fs from 'node:fs';
import { init, RAPIER, regime, W, steps, Q_ID, Q_Y_TO_X, Q_Y_TO_Z, qaxis, qmul, qconj, qrot, upTilt, deg, len } from './lib.mjs';

await init();
const regName = process.argv[2] ?? 'R0';
const reg = regime(regName);
const want = process.argv.slice(3);
const H = 0.46; // half cube
const out = {};
const NOCOL = 0x0000ffff & 0; // membership 0 -> collides with nothing
const ALONE = (1 << 16) | 0; // member of group 1, filter none

// ---------------- B1 resting ----------------
function B1a() {
  const w = new W(reg);
  w.floorBox();
  const b = w.body({ pos: { x: 0, y: H, z: 0 } });
  w.add(b, w.cuboid(H, H, H));
  w.step(steps(reg, 2));
  const r = { sink: H - w.pos(b).y, drift: Math.hypot(w.vel(b).x, w.vel(b).z), vy: w.vel(b).y };
  w.free();
  return r;
}
function B1b() {
  const w = new W(reg);
  w.floorBox();
  const beam = w.body({ pos: { x: 0, y: H, z: 0 } });
  w.add(beam, w.cuboid(4.5, H, H));
  const c = w.body({ pos: { x: 0, y: 3 * H, z: 0 } });
  w.add(c, w.cuboid(H, H, H));
  w.step(steps(reg, 2));
  const by = w.pos(beam).y, cy = w.pos(c).y;
  const r = { cubeIntoBeam: by + 2 * H - cy, beamIntoFloor: H - by, drift: Math.hypot(w.vel(c).x, w.vel(c).z) };
  w.free();
  return r;
}
function B1c() {
  const res = {};
  for (const heavy of [1, 10]) {
    const w = new W(reg);
    w.floorBox();
    const bs = [];
    for (let i = 0; i < 5; i++) {
      const b = w.body({ pos: { x: 0, y: H + 2 * H * i, z: 0 } });
      w.add(b, w.cuboid(H, H, H), { dens: i === 4 ? heavy : 1 });
      bs.push(b);
    }
    w.step(steps(reg, 3));
    const top = w.pos(bs[4]);
    res[heavy === 1 ? 'uniform' : 'top10x'] = {
      compression: H + 8 * H - top.y,
      topOffset: Math.hypot(top.x, top.z),
      stands: Math.hypot(top.x, top.z) < 0.1 && upTilt(bs[4]) < 0.05,
    };
    w.free();
  }
  return res;
}
// ---------------- B2 impact ----------------
function B2() {
  const res = {};
  for (const vImp of [150, 300]) {
    const w = new W(reg);
    w.floorBox();
    const gap = 0.5;
    const v0 = Math.sqrt(vImp * vImp - 2 * 1226.25 * gap); // real units
    const b = w.body({ pos: { x: 0, y: H + gap, z: 0 }, linvel: { x: 0, y: -v0, z: 0 } });
    w.add(b, w.cuboid(H, H, H));
    let deepest = 0, rebound = 0, side = 0, spin = 0;
    const n = steps(reg, 0.3);
    for (let i = 0; i < n; i++) {
      w.step();
      const p = w.pos(b), v = w.vel(b), om = w.angvel(b);
      deepest = Math.max(deepest, H - p.y);
      rebound = Math.max(rebound, v.y);
      side = Math.max(side, Math.hypot(v.x, v.z));
      spin = Math.max(spin, len(om));
    }
    res['v' + vImp] = { deepest, rebound, side, spin, sideEnd: Math.hypot(w.vel(b).x, w.vel(b).z), spinEnd: len(w.angvel(b)) };
    w.free();
  }
  return res;
}
// ---------------- B3 free fall ----------------
function B3() {
  const w = new W(reg);
  const b = w.body({ pos: { x: 0, y: 0, z: 0 } });
  w.add(b, w.cuboid(H, H, H));
  const r = {};
  for (const T of [0.5, 1.0, 1.5]) {
    w.step(steps(reg, T) - steps(reg, w.t));
    r['v' + T] = -w.vel(b).y;
  }
  // linear clamp: launch at 1e5 studs/s horizontally in zero g
  const w2 = new W(reg, { gravity: false });
  const b2 = w2.body({ pos: { x: 0, y: 0, z: 0 }, linvel: { x: 1e5, y: 0, z: 0 } });
  w2.add(b2, w2.cuboid(H, H, H));
  w2.step(2);
  r.linClamp = len(w2.vel(b2));
  // angular clamp: spin a cube at 1e4 rad/s
  const b3 = w2.body({ pos: { x: 100, y: 0, z: 0 }, angvel: { x: 0, y: 1e4, z: 0 } });
  w2.add(b3, w2.cuboid(H, H, H));
  w2.step(2);
  r.angClamp = len(w2.angvel(b3));
  w.free(); w2.free();
  return r;
}
// ---------------- B4 n-gon faces ----------------
function B4a() {
  const spots = [[0, 0]];
  for (let k = 0; k < 6; k++) { const a = (k * 60 + 7) * Math.PI / 180; spots.push([0.33 * Math.cos(a), 0.33 * Math.sin(a)]); }
  const rows = [];
  for (const [x, z] of spots) {
    const w = new W(reg);
    const fc = w.world.createCollider(w.prism(32, 0.5, 0.25, -0.25).setFriction(0.5).setRestitution(0), w.fixed);
    const b = w.body({ pos: { x, y: 0.05, z } });
    const bc = w.add(b, w.cuboid(0.08, 0.05, 0.08));
    let fell = false, maxTilt = 0;
    const n = steps(reg, 2);
    for (let i = 0; i < n; i++) { w.step(); maxTilt = Math.max(maxTilt, upTilt(b)); if (w.pos(b).y < -0.2) fell = true; }
    rows.push({ x, z, tilt: deg(upTilt(b)), maxTilt: deg(maxTilt), sink: 0.05 - w.pos(b).y, fell, contacts: w.contacts(bc, fc) });
    w.free();
  }
  return {
    centre: rows[0],
    off: {
      fell: rows.slice(1).filter((r) => r.fell).length,
      maxTiltDeg: Math.max(...rows.slice(1).filter((r) => !r.fell).map((r) => r.maxTilt), 0),
      maxSinkHeld: Math.max(...rows.slice(1).filter((r) => !r.fell).map((r) => r.sink), 0),
      contacts: rows.slice(1).map((r) => r.contacts).join('/'),
    },
  };
}
function B4b() {
  const res = {};
  for (const n of [16, 32]) {
    const w = new W(reg);
    const fc = w.floorPlane();
    const b = w.body({ pos: { x: 0, y: H, z: 0 } });
    const bc = w.add(b, w.prism(n, 0.5, H));
    let maxTilt = 0;
    const N = steps(reg, 2);
    for (let i = 0; i < N; i++) { w.step(); maxTilt = Math.max(maxTilt, upTilt(b)); }
    res['n' + n] = { tiltDeg: deg(upTilt(b)), maxTiltDeg: deg(maxTilt), sink: H - w.pos(b).y, contacts: w.contacts(bc, fc) };
    w.free();
  }
  return res;
}
// ---------------- B5 wheels ----------------
function rollWheel(floor, v0, T, r = 1) {
  const w = new W(reg);
  const fast = v0 > 10; // slow rolls get a 40 x 120 floor so the 8 studs/s plateau stays on it
  const fc = floor === 'box' ? (fast ? w.floorBox(20, 0.5, 200) : w.floorBox(20, 0.5, 60)) : w.floorPlane();
  const b = w.body({ pos: { x: 0, y: r, z: fast ? -150 : 0 }, rot: Q_Y_TO_X, linvel: { x: 0, y: 0, z: v0 }, angvel: { x: v0 / r, y: 0, z: 0 } });
  w.add(b, w.cylinder(H, r));
  void fc;
  const trace = [];
  let maxSink = 0, maxV = 0;
  const N = steps(reg, T);
  const every = Math.max(1, Math.round(N / 10));
  for (let i = 1; i <= N; i++) {
    w.step();
    const p = w.pos(b);
    maxSink = Math.max(maxSink, r - p.y);
    maxV = Math.max(maxV, Math.abs(w.vel(b).z));
    if (i % every === 0) trace.push(+w.vel(b).z.toFixed(3));
  }
  const res = { vEnd: w.vel(b).z, maxV, maxSink, z: w.pos(b).z, trace };
  w.free();
  return res;
}
function B5a() {
  return {
    boxRest: rollWheel('box', 0, 5),
    boxRoll1: rollWheel('box', 1, 5),
    planeRest: rollWheel('plane', 0, 5),
    planeRoll1: rollWheel('plane', 1, 5),
    predictedPlateau: (1 * Math.PI / 180) * reg.sps, // r * 1 deg per world step, real studs/s
  };
}
function B5b() {
  const a = rollWheel('box', 100, 2);
  const b = rollWheel('plane', 100, 2);
  return { box: { kept: (100 * a.vEnd) / 100, maxSink: a.maxSink }, plane: { kept: b.vEnd, maxSink: b.maxSink } };
}
function B5c() {
  const w = new W(reg);
  w.floorBox();
  const beam = w.body({ pos: { x: 0, y: H, z: 0 } });
  w.add(beam, w.cuboid(4.5, H, H));
  const R = 2.5;
  const wh = w.body({ pos: { x: 0, y: 2 * H + R, z: 0 }, rot: Q_Y_TO_Z });
  w.add(wh, w.cylinder(H, R));
  // sink is measured only while the wheel is still over the beam; leftAt = real time it left
  const sinkNow = () => w.pos(beam).y + H - (w.pos(wh).y - R);
  const over = () => Math.abs(w.pos(wh).x - w.pos(beam).x) < 4.5;
  let maxSink = 0, leftAt = null, sink025 = null;
  const N = steps(reg, 2);
  for (let i = 1; i <= N; i++) {
    w.step();
    if (over()) maxSink = Math.max(maxSink, sinkNow()); else if (leftAt === null) leftAt = w.t;
    if (i === steps(reg, 0.25)) sink025 = sinkNow();
  }
  const r = { sink025, maxSinkOnBeam: maxSink, leftAt, xDrift: w.pos(wh).x - w.pos(beam).x, beamIntoFloor: H - w.pos(beam).y };
  w.free();
  return r;
}
// ---------------- B6 pendulums ----------------
function chain(nLinks, T) {
  const w = new W(reg);
  const links = [], joints = [];
  for (let i = 0; i < nLinks; i++) {
    const b = w.body({ pos: { x: 3 + 6 * i, y: 0, z: i } }, true);
    w.add(b, w.cuboid(3.5, H, H), { friction: 0 });
    links.push(b);
    const jd = i === 0
      ? RAPIER.JointData.revolute({ x: 0, y: 0, z: 0 }, w.P({ x: -3, y: 0, z: 0 }), { x: 0, y: 0, z: 1 })
      : RAPIER.JointData.revolute(w.P({ x: 3, y: 0, z: 0.5 }), w.P({ x: -3, y: 0, z: -0.5 }), { x: 0, y: 0, z: 1 });
    const j = w.world.createImpulseJoint(jd, i === 0 ? w.fixed : links[i - 1], b, true);
    j.setContactsEnabled(false);
    joints.push([i === 0 ? null : links[i - 1], b, i === 0 ? { x: 0, y: 0, z: 0 } : { x: 3, y: 0, z: 0.5 }, i === 0 ? { x: -3, y: 0, z: 0 } : { x: -3, y: 0, z: -0.5 }]);
  }
  const mg = links[0].mass() * reg.g * reg.L; // m g per stud of height (Rapier energy units)
  let ref = 0;
  for (let i = 0; i < nLinks; i++) ref += mg * (3 + 6 * i);
  const E0 = w.energy(links);
  const sep = () => {
    let m = 0;
    for (const [a, b, la, lb] of joints) {
      const pa = a ? (() => { const t = a.translation(); const q = qrot(a.rotation(), w.P(la)); return { x: t.x + q.x, y: t.y + q.y, z: t.z + q.z }; })() : w.P(la);
      const t = b.translation(); const q = qrot(b.rotation(), w.P(lb));
      m = Math.max(m, Math.hypot(pa.x - t.x - q.x, pa.y - t.y - q.y, pa.z - t.z - q.z) / reg.L);
    }
    return m;
  };
  let worstSep = 0;
  const N = steps(reg, T);
  const marks = {};
  for (let i = 1; i <= N; i++) {
    w.step();
    worstSep = Math.max(worstSep, sep());
    if (i === steps(reg, 1) || i === steps(reg, 5) || i === N) marks['t' + Math.round(w.t)] = (100 * (w.energy(links) - E0)) / ref;
  }
  const r = { dE_pct: (100 * (w.energy(links) - E0)) / ref, marks, worstSep, msPerRealS: w.stepMs / T };
  w.free();
  return r;
}
const B6a = () => chain(1, 10);
const B6b = () => chain(3, 10);
// ---------------- B7 free spin ----------------
function B7() {
  const w = new W(reg, { gravity: false });
  const b = w.body({ pos: { x: 0, y: 0, z: 0 } });
  w.add(b, w.cuboid(2.5, H, H));
  w.add(b, w.cuboid(H, H, H), { at: { x: 2.5 - H, y: 2 * H, z: 0 } });
  const om = 20 / Math.sqrt(3);
  b.setAngvel({ x: w.w(om), y: w.w(om), z: w.w(om) }, true);
  const r0 = w.rot(b);
  const T = 30;
  w.step(steps(reg, T));
  const r1 = w.rot(b);
  const res = { dE_pct_per_s: (100 * (r1.E / r0.E - 1)) / T, dL_pct_per_s: (100 * (r1.L / r0.L - 1)) / T, omegaEnd: len(w.angvel(b)) };
  w.free();
  return res;
}
// ---------------- B8 gears (no gear constraint: emulated) ----------------
function B8() {
  // Rapier has NO gear constraint. Emulation (as the product does, minus its phase feedback,
  // lead and adaptive step): a generic joint locking only LinX at the pitch point, X = tangent,
  // re-anchored every world step with setLocalFrame1/2.
  const w = new W(reg, { gravity: false });
  const r1 = 1, r2 = 2.5, d = 3.5;
  const g1 = w.body({ pos: { x: 0, y: 0, z: 0 }, rot: Q_Y_TO_Z }, true);
  w.add(g1, w.cylinder(H, r1), { groups: 0 });
  const g2 = w.body({ pos: { x: d, y: 0, z: 0 }, rot: Q_Y_TO_Z }, true);
  w.add(g2, w.cylinder(H, r2), { groups: 0 });
  for (const [b, x] of [[g1, 0], [g2, d]]) {
    // body frames are turned (Y->Z); the axis in body-local coords is Y, in world Z
    w.world.createImpulseJoint(RAPIER.JointData.revoluteWithAxes(w.P({ x, y: 0, z: 0 }), { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 }, { x: 0, y: 1, z: 0 }), w.fixed, b, true);
  }
  // world frame of the mesh row: X = t = +Y, Y = n = +X, Z = -a = -Z  (right-handed)
  const qT = qmul(qaxis(0, 0, 1, Math.PI / 2), Q_ID); // maps X->Y, Y->-X; need Y->+X: add 180 about X'
  const qRow = qmul(qT, qaxis(1, 0, 0, Math.PI)); // X->Y, Y->+X, Z->-Z
  const pitch = { x: r1, y: 0, z: 0 };
  const local = (b) => {
    const t = b.translation();
    const qi = qconj(b.rotation());
    const p = w.P(pitch);
    return { a: qrot(qi, { x: p.x - t.x, y: p.y - t.y, z: p.z - t.z }), r: qmul(qi, qRow) };
  };
  const l1 = local(g1), l2 = local(g2);
  const mesh = w.world.createImpulseJoint(RAPIER.JointData.generic(l1.a, l2.a, { x: 1, y: 0, z: 0 }, RAPIER.JointAxesMask.LinX), g1, g2, true);
  mesh.setContactsEnabled(false);
  const reanchor = () => { const a = local(g1), b = local(g2); mesh.setLocalFrame1(a.a, a.r); mesh.setLocalFrame2(b.a, b.r); };
  reanchor();
  const I1 = g1.principalInertia().x, I2 = g2.principalInertia().x; // about the disc axis (local Y): x,z are diametral
  const Iax = (b) => { const I = b.principalInertia(); return Math.max(I.x, I.y, I.z); };
  void I1; void I2;
  const Ia1 = Iax(g1), Ia2 = Iax(g2);
  const Ieff = Ia1 + Ia2 * (r1 / r2) ** 2;
  const alphaReal = 100; // rad/s^2 on the small gear -> 100 rad/s at 1 s, 300 at 3 s
  const tau = (Ieff * alphaReal) / reg.s ** 2;
  let th1 = 0, th2 = 0, work = 0;
  const ang = (b) => { const o = b.angvel(); return o.z; };
  const KE = () => 0.5 * Ia1 * g1.angvel().z ** 2 + 0.5 * Ia2 * g2.angvel().z ** 2;
  const tooth = (2 * Math.PI) / 16;
  const phases = {};
  const N = steps(reg, 5);
  const seg = (t) => (t < 1 ? 'drive' : t < 2 ? 'coast' : t < 4 ? 'drive' : 'coast');
  let maxErrTeeth = 0;
  let i = 0;
  const tstamp = (T) => steps(reg, T);
  for (i = 1; i <= N; i++) {
    const tr = (i - 1) / reg.sps;
    const driving = seg(tr) === 'drive';
    g1.resetTorques(true);
    if (driving) g1.addTorque({ x: 0, y: 0, z: tau }, true);
    reanchor();
    const w1a = ang(g1);
    w.step();
    const w1b = ang(g1), w2b = ang(g2);
    th1 += reg.dt * w1b; th2 += reg.dt * w2b; // Rapier integrates angle with end-of-step omega
    if (driving) work += tau * reg.dt * 0.5 * (w1a + w1b);
    const errTeeth = (th1 + th2 * (r2 / r1)) / tooth;
    maxErrTeeth = Math.max(maxErrTeeth, Math.abs(errTeeth));
    for (const T of [1, 2, 4, 5]) if (i === tstamp(T)) phases['t' + T] = { w1: w.rw(w1b), ratio: -w1b / w2b, errTeeth, KE_over_work: KE() / work };
  }
  w.free();
  return { phases, maxErrTeeth };
}
// ---------------- B9 API ----------------
function B9() {
  return {
    jointFriction: 'NO (emulate: velocity motor target 0 + setMotorMaxForce)',
    motorMaxTorque: 'YES RevoluteImpulseJoint.configureMotorVelocity + setMotorMaxForce',
    angleLimits: 'YES RevoluteImpulseJoint.setLimits (JointData.limits ignored for revolutes, per docs/RAPIER.md)',
    oneWayLimit: 'PARTIAL setLimits(lo, +big) is a one-sided angle stop, not a ratchet',
    reactionForce: 'NO (Rust ImpulseJoint.impulses not exposed in JS)',
    note: 'unit regime cannot change the API',
  };
}
// ---------------- B10 cost ----------------
function B10() {
  const w = new W(reg);
  w.floorBox();
  for (let i = 0; i < 20; i++) {
    const b = w.body({ pos: { x: 20 + (i % 2) * 1.0 + 0.05 * (i % 3), y: H + 0.92 * Math.floor(i / 4) + 0.01 * i, z: ((i >> 1) % 2) * 1.0 } });
    w.add(b, w.cuboid(H, H, H));
  }
  const links = [];
  for (let i = 0; i < 3; i++) {
    const b = w.body({ pos: { x: 3 + 6 * i, y: 30, z: i } }, true);
    w.add(b, w.cuboid(3.5, H, H), { friction: 0 });
    links.push(b);
    const jd = i === 0
      ? RAPIER.JointData.revolute(w.P({ x: 0, y: 30, z: 0 }), w.P({ x: -3, y: 0, z: 0 }), { x: 0, y: 0, z: 1 })
      : RAPIER.JointData.revolute(w.P({ x: 3, y: 0, z: 0.5 }), w.P({ x: -3, y: 0, z: -0.5 }), { x: 0, y: 0, z: 1 });
    w.world.createImpulseJoint(jd, i === 0 ? w.fixed : links[i - 1], b, true).setContactsEnabled(false);
  }
  const T = 3;
  w.step(steps(reg, T));
  const r = { msPerRealS: w.stepMs / T, stepsPerRealS: reg.sps };
  w.free();
  return r;
}

const ALL = { B1a, B1b, B1c, B2, B3, B4a, B4b, B5a, B5b, B5c, B6a, B6b, B7, B8, B9, B10 };
const sel = want.length ? Object.keys(ALL).filter((k) => want.some((x) => k === x || k.startsWith(x))) : Object.keys(ALL);
fs.mkdirSync(new URL('./results/', import.meta.url), { recursive: true });
const file = new URL(`./results/${regName}.json`, import.meta.url);
const prev = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
for (const k of sel) {
  const t0 = performance.now();
  out[k] = ALL[k]();
  out[k].wallMs = Math.round(performance.now() - t0);
  console.log(regName, k, JSON.stringify(out[k]));
}
fs.writeFileSync(file, JSON.stringify({ ...prev, ...out, regime: reg }, null, 1));
void NOCOL; void ALONE; void Q_ID;
process.exit(0);
