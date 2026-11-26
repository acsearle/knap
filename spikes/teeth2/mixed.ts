// Mixed regime: gear A carries tooth colliders and a pawl, and is meshed to gear B (no tooth
// colliders) by the constraint row (spikes/skeptic MeshPlanar = spikes/coupling Mesh with the
// anchor-plane fix, lead on, k = 1).
//   sh spikes/teeth2/run.sh mixed <r> <kind> <l> <px> <py> <betaDeg> <lockSign> <rB> <bx> <by>
import { RAPIER, gear, vmotor, angleZ, Unwrap, energy, fmt, revZ, body, gearDescs } from './lib';
import type { PawlKind } from './lib';
import { scene, settle, release, touching } from './ratchet';
import type { Cand } from './ratchet';
// @ts-ignore (plain JS)
import { MeshPlanar } from '../skeptic/sk.mjs';

await RAPIER.init();
const a = process.argv.slice(2);
const c: Cand = { r: Number(a[0]), kind: a[1] as PawlKind, l: Number(a[2]), px: Number(a[3]), py: Number(a[4]), beta: (Number(a[5]) * Math.PI) / 180 };
const lockS = Number(a[6]);
const rB = Number(a[7]);
const B: [number, number] = [Number(a[8]), Number(a[9])];
const gA = gear(c.r), gB = gear(rB);
if (Math.abs(Math.hypot(...B) - (c.r + rB)) > 1e-9) throw new Error('B must be at distance rA + rB');

function build(withMesh = true) {
  const sc = scene(c);
  // gear B: mass disc only, no colliders that meet anything
  const bb = body(sc.w, [B[0], B[1], 0], 0, gearDescs(gB, { rep: 'none' }));
  const jb = revZ(sc.w, sc.f, bb, [B[0], B[1], 0]);
  const tfb = 0.2 * bb.mass() * 1226.25 * 0.31;
  vmotor(sc.w, jb, 0, tfb);
  if (settle(sc) === null) throw new Error('no settle');
  release(sc);
  const W = { w: sc.w, ground: sc.f };
  const mesh = withMesh ? new MeshPlanar(W, { body: sc.gb, lc: [0, 0, 0], la: [0, 0, 1], r: c.r, T: gA.T }, { body: bb, lc: [0, 0, 0], la: [0, 0, 1], r: rB, T: gB.T }, { lead: true }) : null;
  const step = () => {
    mesh?.update();
    sc.w.step();
  };
  return { sc, bb, jb, tfb, mesh, step };
}
const out = (s: string) => console.log(s);
out(`A: r${c.r} T${gA.T} with ${c.kind} l${c.l} pawl at (${c.px},${c.py}); B: r${rB} T${gB.T} at (${B}); A's lock direction ${lockS > 0 ? '+' : '−'}; B turns −rA/rB × A`);

// 1. hold: torque ramp on B in the direction that turns A in its lock direction
{
  const m = build();
  const ua = new Unwrap(angleZ(m.sc.gb));
  const a0 = ua.v;
  const sB = -lockS;
  let tau = Infinity, maxE = 0;
  for (let i = 0; i < 1400; i++) {
    const t = sB * 1e-3 * m.sc.tau0 * Math.pow(10, i / 480 / 0.4);
    m.bb.resetTorques(false);
    m.bb.addTorque({ x: 0, y: 0, z: t }, true);
    m.step();
    maxE = Math.max(maxE, Math.abs(m.mesh.e));
    if (lockS * (ua.push(angleZ(m.sc.gb)) - a0) > gA.D) {
      tau = Math.abs(t);
      break;
    }
  }
  out(`  hold through the mesh: B torque at skip ${fmt(tau / m.sc.tau0)} τ0 = A-side ${fmt(((tau / m.sc.tau0) * c.r) / rB)} τ0; max |mesh phase error| while loaded ${fmt(maxE)} units (pitch 0.393)`);
}
// 1b. constant load on B at 50% of that for 10 s
// 2. drive B so A turns in its free direction at ωA; then cut the drive and let the train coast
for (const wA of [3, 10, 30, 60]) {
  for (const withMesh of [true]) {
    const m = build(withMesh);
    const wB = (-wA * -lockS * c.r) / rB; // A free direction = −lockS; ωB = −ωA·rA/rB
    vmotor(m.sc.w, m.jb, wB, 1e6 * m.sc.tau0);
    let maxE = 0;
    for (let i = 0; i < 480; i++) {
      m.step();
      maxE = Math.max(maxE, Math.abs(m.mesh.e));
    }
    const wAmeas = m.sc.gb.angvel().z;
    // coast: remove drive (B back to its friction), no load; energy must not rise
    vmotor(m.sc.w, m.jb, 0, m.tfb);
    const bodies = [m.sc.gb, m.bb, m.sc.pb];
    const E0 = energy(bodies);
    let Emin = E0, rise = 0, tStop = NaN, touchN = 0;
    for (let i = 0; i < 960; i++) {
      m.step();
      const E = energy(bodies);
      Emin = Math.min(Emin, E);
      rise = Math.max(rise, E - Emin);
      if (touching(m.sc) > 0) touchN++;
      if (Number.isNaN(tStop) && Math.abs(m.sc.gb.angvel().z) < 0.1) tStop = i / 480;
      maxE = Math.max(maxE, Math.abs(m.mesh.e));
    }
    const K0 = E0 - (m.sc.pb.mass() * 1226.25 * m.sc.pb.worldCom().y + 0); // rough: KE + pawl PE offset (gears' COM on axes)
    out(`  ωA ${wA} (measured ${fmt(wAmeas)}): max |phase error| ${fmt(maxE)}; coast: energy rise above running minimum ${fmt(rise)} (= ${fmt((100 * rise) / Math.max(E0 - Emin, 1e-9))}% of the energy lost), pawl touching ${fmt((100 * touchN) / 960)}% of steps, A below 0.1 rad/s at ${fmt(tStop)} s, end ωA ${fmt(m.sc.gb.angvel().z)}`);
    void K0;
    m.sc.w.free();
  }
}
process.exit(0);
