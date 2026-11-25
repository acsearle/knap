// Experiment 4: cost per wheel in ms of stepping per simulated second (min of 3 runs × 2 s; the
// machine is shared with other jobs, so treat these as upper bounds), plus a determinism hash that
// can be compared across processes (run twice).
// Usage: node spikes/wheels/out/cost.mjs
import { DT, RAPIER, addGround, addWheel, fmt, init, makeWorld, now, poseHash, wheelColliders } from './lib';
import type { RigidBody, World } from '@dimforge/rapier3d-compat';

function best(setup: () => { w: World; bodies: RigidBody[] }, seconds = 2): { ms: number; hash: string } {
  let ms = Infinity;
  let hash = '';
  for (let k = 0; k < 3; k++) {
    const { w, bodies } = setup();
    const t0 = now();
    for (let i = 0; i < Math.round(seconds / DT); i++) w.step();
    ms = Math.min(ms, (now() - t0) / seconds);
    hash = poseHash(bodies);
    w.free();
  }
  return { ms, hash };
}

function wheels(n: number, iters: number, extra: number, kind: 'cyl' | 'hyb', ground: 'half' | 'armFlat', v: number) {
  return () => {
    const w = makeWorld(iters);
    addGround(w, ground, -20, 400);
    const bodies: RigidBody[] = [];
    for (let i = 0; i < n; i++) {
      const rb = addWheel(w, kind, 1.5, [0, 1.5, i * 3], { extraIters: extra });
      rb.setLinvel({ x: v, y: 0, z: 0 }, true);
      rb.setAngvel({ x: 0, y: 0, z: -v / 1.5 }, true);
      bodies.push(rb);
    }
    return { w, bodies };
  };
}

function drivePair(gap: number) {
  return () => {
    const w = makeWorld(240);
    w.gravity = { x: 0, y: 0, z: 0 };
    const A = w.createRigidBody(RAPIER.RigidBodyDesc.kinematicVelocityBased());
    for (const cd of wheelColliders('cyl', 1.5)) w.createCollider(cd, A);
    A.setAngvel({ x: 0, y: 0, z: 20 }, true);
    const B = addWheel(w, 'cyl', 1.5, [3 + gap, 0, 0], { softCcd: false });
    const fixed = w.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    w.createImpulseJoint(RAPIER.JointData.revolute({ x: 3 + gap, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 }), fixed, B, true);
    if (gap === 0) B.addForce({ x: -1000, y: 0, z: 0 }, true);
    return { w, bodies: [B] };
  };
}

async function main(): Promise<void> {
  await init();
  console.log('case\tms/sim-s\thash');
  const cases: [string, () => { w: World; bodies: RigidBody[] }][] = [
    ['empty world + half-space', () => { const w = makeWorld(30); addGround(w, 'half'); return { w, bodies: [] }; }],
    ['1 loose cyl wheel rolling on half-space, 30 substeps', wheels(1, 30, 0, 'cyl', 'half', 40)],
    ['4 loose cyl wheels rolling on half-space, 30 substeps', wheels(4, 30, 0, 'cyl', 'half', 40)],
    ['1 cyl wheel on half-space, 240 substeps (as if jointed)', wheels(1, 30, 210, 'cyl', 'half', 40)],
    ['4 cyl wheels on half-space, 240 substeps', wheels(4, 30, 210, 'cyl', 'half', 40)],
    ['1 hybrid wheel at rest on liftarm floor (hull contact), 30 substeps', wheels(1, 30, 0, 'hyb', 'armFlat', 0)],
    ['1 hybrid wheel at rest on liftarm floor, 240 substeps', wheels(1, 30, 210, 'hyb', 'armFlat', 0)],
    ['friction-drive pair, cylinders pressed together, 240', drivePair(0)],
    ['same pair 0.01 apart (AABBs overlap, no contact), 240', drivePair(0.01)],
    ['same pair 5 apart (no narrow phase), 240', drivePair(5)],
  ];
  for (const [name, f] of cases) {
    const r = best(f);
    console.log(`${name}\t${fmt(r.ms, 1)}\t${r.hash}`);
  }
}

void main();
