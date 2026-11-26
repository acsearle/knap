// Q3b a gear sliding along its axle into and out of mesh. Axis Z. Frame beam x 0..2 at z 0.
// Gear A r 1 at (0,0,1) on a frame pin, driven at w rad/s (speed-tracking torque).
// Gear B r 1 (axle hole) on an axle (2,0,−2..3) through the frame hole (2,0,0): cylindrical joint,
// slide limits [−1, 2]; built at z 2 (|delta| 1: teeth do not overlap). The grab spring on B's axle
// end pushes B to z 1 (in mesh, against the stop) and pulls it back to z 2, `cycles` times.
// Usage: sh spikes/gearsim/run.sh slide [mus=0,0.05,0.2] [ks=1,2,4] [w=5] [cycles=3] [period=1]
import { ModelBuilder, beam } from '../../src/core/examples';
import { makeCell } from '../../src/core/model';
import { Angle, PITCH, Simulation, energyTotal, f, out, putRims } from './lib';

export function slider() {
  const b = new ModelBuilder();
  const frame = b.add(beam([0, 0, 0], [2, 0, 0]));
  const A = b.add([makeCell(0, 0, 1, 'pinHole', 2)]);
  b.add([makeCell(0, 0, 0, 'frictionPin', 2), makeCell(0, 0, 1, 'pin', 2)]);
  const B = b.add([makeCell(2, 0, 2, 'axleHole', 2)]);
  const shaft = b.add([-2, -1, 0, 1, 2, 3].map((z) => makeCell(2, 0, z, 'axle', 2)));
  let m = b.root(frame).build();
  m = putRims(m, [
    { part: A, pos: [0, 0, 1], r: 1 },
    { part: B, pos: [2, 0, 2], r: 1 },
  ]);
  return { model: m, A, B, shaft, frame };
}

async function run(mu: number, k: number, w: number, cycles: number, period: number) {
  const sl = slider();
  const s = await Simulation.create(sl.model, { jointFriction: mu, substeps: k, mesh: JSON.parse(process.env.MESH ?? '{}') });
  const A = s.bodyOf(sl.A)!;
  const B = s.bodyOf(sl.B)!;
  const js = s.jointStates();
  const cyl = js.find((j) => j.type === 'cylindrical');
  const lim = s.graph.joints.find((j) => j.type === 'cylindrical')?.limits;
  const IA = s.massInfo(A)!.inertia[8]!;
  const aA = new Angle(s, A);
  const aB = new Angle(s, B);
  const E0 = energyTotal(s);
  const grabPt: [number, number, number] = [2, 0, 3];
  s.grab(B, grabPt);
  const n = Math.round(cycles * period * 480);
  let maxTilt = 0;
  let maxJerr = 0;
  let maxExcessFree = -Infinity;
  const ev: string[] = [];
  const m = s.meshes[0]!;
  let prevEng = m.engaged;
  let ratioSum = 0;
  let ratioN = 0;
  let prevA = aA.get();
  let prevB = aB.get();
  const zs: string[] = [];
  let lastTau = NaN;
  for (let i = 1; i <= n; i++) {
    const t = i / 480;
    const phaseT = (t % period) / period;
    const z = phaseT < 0.5 ? 2 : 3; // target for the grab point: 2 → B hub at z 1; 3 → back to z 2
    s.dragTo([2, 0, z]);
    const wA = s.bodyVelocity(A)!.w[2];
    const tau = Math.max(-4000, Math.min(4000, IA * (w - wA) * 480));
    if (tau !== lastTau) {
      s.setDrive(A, [0, 0, tau]);
      lastTau = tau;
    }
    s.stepFixed(1);
    const tr = s.bodyTransform(B)!;
    const q = tr.q;
    // tilt of B's axis from +Z
    const ax = [2 * (q[0] * q[2] + q[3] * q[1]), 2 * (q[1] * q[2] - q[3] * q[0]), 1 - 2 * (q[0] * q[0] + q[1] * q[1])];
    maxTilt = Math.max(maxTilt, Math.acos(Math.min(1, ax[2]!)));
    maxJerr = Math.max(maxJerr, s.jointError());
    const hubZ = 2 + tr.p[2] + (tr.q[3] ? 0 : 0); // B's displacement along z (pure slide + rotation about z keeps z)
    if (m.engaged !== prevEng) {
      ev.push(`${t.toFixed(3)} ${m.engaged ? 'ENG' : 'rel'} hub z ${f(hubZ, 3)} delta ${f(m.delta, 3)}${m.engaged ? ` snap ${f(m.lastSnap, 3)} teeth` : ''}`);
      prevEng = m.engaged;
    }
    const a1 = aA.get();
    const b1 = aB.get();
    if (m.engaged && Math.abs(a1 - prevA) > 1e-6) {
      ratioSum += (b1 - prevB) / (a1 - prevA);
      ratioN++;
    }
    prevA = a1;
    prevB = b1;
    if (i % Math.round(period * 480 / 4) === 0) zs.push(`t ${t.toFixed(2)} hub z ${f(hubZ, 3)} ωA ${f(wA, 2)} ωB ${f(s.bodyVelocity(B)!.w[2], 2)} eng ${m.engaged} ph ${f(m.e / PITCH, 4)}`);
    void maxExcessFree;
    void E0;
  }
  s.release();
  out(`== slide mu ${mu} k ${k} w ${w}: cylindrical limits ${JSON.stringify(lim)} F_f ${f(cyl?.frictionForce ?? 0, 1)} τf ${f(cyl?.frictionTorque ?? 0, 1)} | engagements ${m.engagements} releases ${m.releases} | mean ratio while engaged ${f(ratioSum / Math.max(1, ratioN), 5)} | max phase err ${f(m.maxE / PITCH)} teeth | max tilt ${f(maxTilt)} rad | max joint error ${f(maxJerr)}`);
  for (const e of ev) out('   ' + e);
  for (const z of zs) out('   ' + z);
  s.dispose();
}

if (process.argv[1]?.endsWith('slide.mjs')) {
  const [mus = '0,0.05,0.2', ks = '1,2,4', w = '5', cycles = '3', period = '1'] = process.argv.slice(2);
  for (const mu of mus.split(',').map(Number)) for (const k of ks.split(',').map(Number)) await run(mu, k, Number(w), Number(cycles), Number(period));
  process.exit(0);
}
