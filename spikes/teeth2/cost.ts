// Narrow-phase / step cost of candidate tooth colliders.
//   sh spikes/teeth2/run.sh cost [rounds=5] [steps=150]
// Per gear size × representation × scenario: ms per world.step() (median of interleaved rounds),
// colliders, active contact pairs and contact points (after the warm-up).
// Scenarios:
//   idle   gear on a revolute driven at 20 rad/s, nothing near it
//   pawl   gear driven at 3 rad/s, a 3-hole liftarm pawl (knap shapes) resting on its top, clicking
//   ground gear lying flat (axis Y) on a ground box, free body; teeth see the ground ('teeth') —
//          for the 'smooth' rep the smooth disc sees it, i.e. the "teeth only for pawls" rule
//   beam   gear on a revolute driven at 3 rad/s, a free 7-hole liftarm lying across its top (beam's
//          flat side on the tooth tips), teeth see ordinary parts
import { RAPIER, gear, gearDescs, partDescs, pawlParts, mkPart, makeWorld, fixed, body, revZ, vmotor, contactStats, cpu, median, fmt, grp, BIT, G_PAWL, G_GROUND, DT } from './lib';
import type { Rep, Gear } from './lib';

await RAPIER.init();
const ROUNDS = Number(process.argv[2] ?? 5);
const STEPS = Number(process.argv[3] ?? 150);
const REPS: Rep[] = ['none', 'smooth', 'hull', 'half', 'compound', 'box', 'capsule', 'trimesh', 'polyline'];
const SC = ['idle', 'pawl', 'ground', 'beam'] as const;
type Sc = (typeof SC)[number];
const T_ALL = grp(BIT.TOOTH, BIT.PAWL | BIT.PART | BIT.GROUND);

function build(g: Gear, rep: Rep, sc: Sc) {
  const w = makeWorld();
  const f = fixed(w);
  if (sc === 'ground') {
    w.createCollider(RAPIER.ColliderDesc.cuboid(20, 0.5, 20).setTranslation(0, -0.5, 0).setCollisionGroups(grp(BIT.GROUND, 0xffff)).setFriction(0.4), f);
    const descs = gearDescs(g, { rep, toothGroup: rep === 'smooth' ? grp(BIT.SMOOTH, BIT.GROUND) : T_ALL });
    const rb = w.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic().setCanSleep(false).setTranslation(0.3, 0.465, 0.2).setRotation({ x: -Math.SQRT1_2, y: 0, z: 0, w: Math.SQRT1_2 }).setSoftCcdPrediction(400 * DT * 1.25),
    );
    for (const d of descs) w.createCollider(d, rb);
    rb.setAngvel({ x: 0, y: 3, z: 0 }, true);
    return w;
  }
  const descs = gearDescs(g, { rep, toothGroup: T_ALL });
  const gb = body(w, [0, 0, 0], 0, descs);
  const j = revZ(w, f, gb, [0, 0, 0]);
  vmotor(w, j, sc === 'idle' ? 20 : 3, 1e6);
  if (sc === 'pawl') {
    const Y = Math.ceil(g.tip + 0.47);
    const { parts } = pawlParts('end', 2);
    const pb = body(w, [2, Y, 0], Math.PI, partDescs(parts, [0, 0, 0], G_PAWL));
    revZ(w, f, pb, [2, Y, 0]);
  }
  if (sc === 'beam') {
    const Y = g.tip + 0.47;
    const cells = Array.from({ length: 7 }, (_, k) => ({ x: k - 3, y: 0, z: 0, kind: 'pinHole', axis: 2 }) as any);
    const rb = w.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setCanSleep(false).setTranslation(0, Y, 0).setAdditionalSolverIterations(210));
    for (const d of partDescs([mkPart(cells)], [0, 0, 0], grp(BIT.PART, BIT.TOOTH | BIT.PART))) w.createCollider(d, rb);
    // keep it from walking off: a revolute at its centre to a slider-free pin far above would add a joint; instead
    // a prismatic-free pin: fix x by a generic joint locking LinX/LinZ/AngX/AngY
    const jd = RAPIER.JointData.generic({ x: 0, y: Y, z: 0 }, { x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, RAPIER.JointAxesMask.LinX | RAPIER.JointAxesMask.LinZ | RAPIER.JointAxesMask.AngX | RAPIER.JointAxesMask.AngY);
    w.createImpulseJoint(jd, f, rb, true).setContactsEnabled(false);
  }
  return w;
}

const rows: string[] = [];
console.log(`load: ${(await import('node:os')).loadavg().map((x) => x.toFixed(1)).join(' ')}`);
for (const r of [0.5, 1, 1.5, 2.5]) {
  const g = gear(r);
  for (const sc of SC) {
    const worlds = REPS.map((rep) => build(g, rep, sc));
    for (const w of worlds) for (let i = 0; i < 240; i++) w.step(); // warm-up / settle 0.5 s
    const times: number[][] = REPS.map(() => []);
    for (let k = 0; k < ROUNDS; k++)
      for (let i = 0; i < worlds.length; i++) {
        const w = worlds[i]!;
        const t0 = cpu();
        for (let s = 0; s < STEPS; s++) w.step();
        times[i]!.push((cpu() - t0) / STEPS);
      }
    const base = median(times[0]!);
    for (let i = 0; i < worlds.length; i++) {
      const w = worlds[i]!;
      const cs = contactStats(w);
      let nc = 0;
      w.colliders.forEach(() => nc++);
      const ms = median(times[i]!);
      const line = `r${r} T${g.T} ${sc.padEnd(6)} ${REPS[i]!.padEnd(8)} colliders ${String(nc).padStart(3)}  cpu ms/step ${fmt(ms)}  (x${fmt(ms / base)} of no-collider gear)  pairs ${cs.pairs} points ${cs.points}`;
      console.log(line);
      rows.push(line);
      w.free();
    }
  }
}
process.exit(0);
