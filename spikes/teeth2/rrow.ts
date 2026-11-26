// Alternative: the ratchet as a one-way joint row instead of tooth contacts.
// A second revolute between the frame and the gear (same axis) whose frame 1 is re-anchored before
// every step at the last tooth stop θs = floor(θ/Δ)·Δ (θ = unwrapped gear angle in the free
// direction), with an angular limit [0, π]: the gear turns freely forward and is stopped rigidly
// at the last tooth passed when driven back. No tooth colliders, no pawl body.
//   sh spikes/teeth2/run.sh rrow
import { RAPIER, gear, gearDescs, makeWorld, fixed, body, revZ, vmotor, angleZ, Unwrap, fmt, G, R_BORE, cpu, energy } from './lib';

await RAPIER.init();
const g = gear(1);
const TAU = 2.53 * G; // τ0 of the corner pawl, for comparison with the contact ratchets

function build(fly = 1) {
  const w = makeWorld();
  const f = fixed(w);
  const gb = body(w, [0, 0, 0], 0, gearDescs(g, { rep: 'none' }));
  if (fly) w.createCollider(RAPIER.ColliderDesc.cylinder(0.46, 2.5).setRotation({ x: Math.SQRT1_2, y: 0, z: 0, w: Math.SQRT1_2 }).setDensity(fly).setCollisionGroups(0), gb);
  const jg = revZ(w, f, gb, [0, 0, 0]);
  vmotor(w, jg, 0, 0.2 * gb.mass() * G * R_BORE);
  const jr = w.createImpulseJoint(RAPIER.JointData.revolute({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 }), f, gb, true);
  jr.setContactsEnabled(false);
  if (process.env.FLIP) jr.setLimits(-Math.PI, 0);
  else jr.setLimits(0, Math.PI);
  const uw = new Unwrap(angleZ(gb));
  let stop = Math.floor(uw.v / g.D) * g.D;
  const pre = () => {
    const th = uw.push(angleZ(gb));
    stop = Math.max(stop, Math.floor(th / g.D) * g.D); // ratchet: the stop only moves forward
    // frame 1 rotated by `stop` about Z: the joint angle is then θ − stop (∈ [0, Δ) while engaged)
    // the revolute's frames map the joint X axis to world Z (R0 = −90° about Y); frame 1 = Rz(stop)·R0
    const c = Math.cos(stop / 2), sn = Math.sin(stop / 2), h = Math.SQRT1_2;
    // q = (0,0,sn,c) ⊗ (0,−h,0,h)
    const q = { x: sn * h, y: -c * h, z: sn * h, w: c * h };
    jr.setLocalFrame1({ x: 0, y: 0, z: 0 }, q);
    jr.setLocalFrame2({ x: 0, y: 0, z: 0 }, { x: 0, y: -h, z: 0, w: h });
  };
  return { w, gb, jg, jr, pre, th: () => uw.v, stop: () => stop };
}
console.log(`r1 T16 gear (+ flywheel I≈56), one-way row; free direction +, lock direction −; τ0 = ${fmt(TAU)}`);
// 1. hold: constant load in the lock direction, 5 s
for (const L of [10, 100, 1000, 10000]) {
  const s = build();
  for (let i = 0; i < 2400; i++) {
    s.gb.resetTorques(false);
    s.gb.addTorque({ x: 0, y: 0, z: -L * TAU * Math.min(1, i / 240) }, true);
    s.pre();
    s.w.step();
  }
  console.log(`  hold ${L} τ0 for 5 s: gear ${fmt((s.th() - s.stop()) / g.D, 3)} pitch from the stop (negative = past it), stop moved ${fmt(s.stop() / g.D)} pitches`);
  s.w.free();
}
// 2. free spin forward at ω, then reverse impact at −ω with the flywheel: caught within a pitch?
for (const om of [10, 50, 100, 200, 350]) {
  const s = build();
  s.gb.setAngvel({ x: 0, y: 0, z: om }, true);
  let t0 = cpu();
  for (let i = 0; i < 240; i++) {
    s.pre();
    s.w.step();
  }
  const wFwd = s.gb.angvel().z;
  const ms = (cpu() - t0) / 240;
  s.gb.setAngvel({ x: 0, y: 0, z: -om }, true);
  const st = s.stop();
  const th0 = s.th();
  let minTh = th0;
  const E0 = energy([s.gb]);
  let Emax = 0;
  for (let i = 0; i < 240; i++) {
    s.pre();
    s.w.step();
    minTh = Math.min(minTh, s.th());
    Emax = Math.max(Emax, energy([s.gb]) - E0);
  }
  console.log(`  ω ${om}: forward coast keeps ω ${fmt(wFwd)} (drag from the row ≈ ${fmt(om - wFwd)} rad/s over 0.5 s, joint friction included); reversed at −${om}: went ${fmt((st - minTh) / g.D, 3)} pitch past the stop, energy rise ${fmt(Emax)} (KE0 ${fmt(E0)}), end ω ${fmt(s.gb.angvel().z)}; ${fmt(ms)} cpu ms/step`);
  s.w.free();
}
process.exit(0);
