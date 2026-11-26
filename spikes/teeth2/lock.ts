// Locking a gear by pushing a part into its teeth, and a beam riding on the teeth (rack-like).
//   sh spikes/teeth2/run.sh lock plunge [r=1.5]
//   sh spikes/teeth2/run.sh lock rack [r=1.5]
import { RAPIER, gear, gearDescs, partDescs, mkPart, makeWorld, fixed, body, revZ, vmotor, angleZ, Unwrap, G, R_BORE, fmt, grp, BIT } from './lib';
import type { Rep } from './lib';

await RAPIER.init();
const [mode, rs] = process.argv.slice(2);
const r = Number(rs ?? 1.5);
const g = gear(r);
const C = (x: number, y: number, z: number, kind: string, axis: number) => ({ x, y, z, kind, axis }) as any;
// plungers: vertical, touching feature at the bottom of cell (0,0,0)
const PLUNGERS: Record<string, { parts: any[]; reach: number }> = {
  end: { parts: [mkPart([C(0, 0, 0, 'pinHole', 2), C(0, 1, 0, 'pinHole', 2), C(0, 2, 0, 'pinHole', 2)])], reach: 0.46 },
  corner: { parts: [mkPart([C(0, 0, 0, 'pinHole', 1), C(0, 1, 0, 'pinHole', 2), C(0, 2, 0, 'pinHole', 2)])], reach: 0.46 },
  pinx: { parts: [mkPart([C(0, 0, 0, 'pin', 1), C(0, 1, 0, 'pinHole', 2), C(0, 2, 0, 'pinHole', 2)])], reach: 0.48 },
  rod: { parts: [mkPart([C(0, 0, 1, 'axleHole', 2), C(0, 1, 1, 'pinHole', 2), C(0, 2, 1, 'pinHole', 2)]), mkPart([C(0, 0, 1, 'axle', 2), C(0, 0, 0, 'axle', 2)])], reach: 0.29 },
};

function plungeScene(name: string, rep: Rep, k: number, over: 'gap' | 'tip') {
  const w = makeWorld();
  const f = fixed(w);
  const gb = body(w, [0, 0, 0], 0, gearDescs(g, { rep }));
  const jg = revZ(w, f, gb, [0, 0, 0]);
  vmotor(w, jg, 0, 0.2 * gb.mass() * G * R_BORE);
  // gap centres at angles k·Δ; top of the gear is +90°: rotate the gear so a gap (or a tooth) is at the top
  const a0 = Math.PI / 2 - (over === 'gap' ? 0 : g.D / 2);
  gb.setRotation({ x: 0, y: 0, z: Math.sin(a0 / 2), w: Math.cos(a0 / 2) }, true);
  const P = PLUNGERS[name]!;
  const y0 = g.tip + P.reach + 0.02;
  const pb = body(w, [0, y0, 0], 0, partDescs(P.parts, [0, 0, 0], grp(BIT.PAWL, BIT.TOOTH)));
  const jd = RAPIER.JointData.prismatic({ x: 0, y: y0, z: 0 }, { x: 0, y: 0, z: 0 }, { x: 0, y: 1, z: 0 });
  w.createImpulseJoint(jd, f, pb, true).setContactsEnabled(false);
  const F = k * pb.mass() * G; // push down (in addition to its weight)
  pb.addForce({ x: 0, y: -F, z: 0 }, true);
  for (let i = 0; i < 240; i++) w.step();
  return { w, gb, pb, N: F + pb.mass() * G };
}

function plunge() {
  console.log(`r ${r} T ${g.T}: plunger on a vertical slider pushed onto the top of the gear with force N (its weight + k·weight); torque ramp on the gear (×10 per 0.4 s) until it turns one pitch. μ_eff = τ/(N·tip radius); pure contact friction would give ≈ 0.4.`);
  for (const name of Object.keys(PLUNGERS))
    for (const rep of ['hull', 'smooth'] as Rep[])
      for (const over of ['gap', 'tip'] as const) {
        const res: string[] = [];
        for (const k of [0, 10, 100]) {
          const sc = plungeScene(name, rep, k, over);
          const depth = g.tip - (sc.pb.translation().y - PLUNGERS[name]!.reach);
          const ug = new Unwrap(angleZ(sc.gb));
          const g0 = ug.v;
          let tau = Infinity;
          for (let i = 0; i < 1400; i++) {
            const t = 1e-3 * sc.N * g.tip * Math.pow(10, i / 480 / 0.4);
            sc.gb.resetTorques(false);
            sc.gb.addTorque({ x: 0, y: 0, z: t }, true);
            sc.w.step();
            if (ug.push(angleZ(sc.gb)) - g0 > g.D) {
              tau = t;
              break;
            }
          }
          res.push(`k${k}: depth ${fmt(depth, 2)} μ_eff ${fmt(tau / (sc.N * g.tip))}`);
          sc.w.free();
        }
        if (rep === 'smooth' && over === 'tip') continue;
        console.log(`  ${name.padEnd(6)} ${rep.padEnd(6)} over ${over.padEnd(3)}  ${res.join('   ')}`);
      }
}

function rack() {
  console.log(`r ${r} T ${g.T}: a free 15-hole liftarm lies on the gear's tooth tips (flat side down; it may slide in X and lift in Y, no rotation). The gear is driven at 2 rad/s; measured over 0.5 s after 0.25 s. Slip = 1 − v_beam/(ω·tip). Resisting force on the beam = k·m·g.`);
  for (const rep of ['hull', 'smooth'] as Rep[])
    for (const k of [0, 0.2, 0.35, 0.45, 0.6, 1]) {
      const w = makeWorld();
      const f = fixed(w);
      const gb = body(w, [0, 0, 0], 0, gearDescs(g, { rep }));
      const jg = revZ(w, f, gb, [0, 0, 0]);
      vmotor(w, jg, -2, 1e9);
      const cells = Array.from({ length: 15 }, (_, i) => C(i - 7, 0, 0, 'pinHole', 2));
      const y0 = g.tip + 0.465;
      const pb = body(w, [0, y0, 0], 0, partDescs([mkPart(cells)], [0, 0, 0], grp(BIT.PAWL, BIT.TOOTH)));
      const M = RAPIER.JointAxesMask;
      const jd = RAPIER.JointData.generic({ x: 0, y: y0, z: 0 }, { x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, M.LinZ | M.AngX | M.AngY | M.AngZ);
      w.createImpulseJoint(jd, f, pb, true).setContactsEnabled(false);
      pb.addForce({ x: -k * pb.mass() * G, y: 0, z: 0 }, true); // gear at −2 rad/s drives the top toward +X
      for (let i = 0; i < 120; i++) w.step();
      const x0 = pb.translation().x;
      let ymin = Infinity, ymax = -Infinity, vy2 = 0;
      const n = 240;
      for (let i = 0; i < n; i++) {
        w.step();
        const y = pb.translation().y;
        ymin = Math.min(ymin, y);
        ymax = Math.max(ymax, y);
        vy2 += pb.linvel().y ** 2;
      }
      const v = (pb.translation().x - x0) / (n / 480);
      console.log(`  ${rep.padEnd(6)} k ${String(k).padEnd(4)} beam speed ${fmt(v)} (rolling ${fmt(2 * g.tip)}) slip ${fmt(1 - v / (2 * g.tip))}  bounce y ${fmt(ymax - ymin)} units, rms vy ${fmt(Math.sqrt(vy2 / n))}`);
      w.free();
    }
}

if (mode === 'plunge') plunge();
if (mode === 'rack') rack();
process.exit(0);
