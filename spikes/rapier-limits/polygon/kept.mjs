// Which vertices of an n-gon face does parry keep, and what happens to a DYNAMIC n-gon prism
// resting on its n-gon face on (a) a HalfSpace, (b) a large fixed cuboid.
// Usage: node spikes/rapier-limits/polygon/kept.mjs [SI|KNAP]
import { RAPIER, SCALES, makeWorld, ngonPrism, ngonPrismIndices, readPair, fidStr, tiltDeg, f3, azDeg } from './common.mjs';

const scale = SCALES[process.argv[2] ?? 'SI'];
const R = 0.5, H = 0.5; // prism circumradius and height
const NS = [4, 5, 6, 8, 16, 32];

function buildShape(kind, n) {
  const pts = ngonPrism(n, R, -H / 2, H / 2);
  if (kind === 'convexHull') return RAPIER.ColliderDesc.convexHull(pts);
  if (kind === 'convexMesh') return RAPIER.ColliderDesc.convexMesh(pts, ngonPrismIndices(n));
  if (kind === 'roundConvexHull') return RAPIER.ColliderDesc.roundConvexHull(pts, 0.02);
}

function run(kind, n, ground, gravityOn) {
  const world = makeWorld(scale, gravityOn ? scale.g : 0);
  const gb = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
  let gc;
  if (ground === 'halfspace') gc = world.createCollider(new RAPIER.ColliderDesc(new RAPIER.HalfSpace({ x: 0, y: 1, z: 0 })), gb);
  else gc = world.createCollider(RAPIER.ColliderDesc.cuboid(5, 0.5, 5).setTranslation(0, -0.5, 0), gb);
  const border = kind === 'roundConvexHull' ? 0.02 : 0;
  const body = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(0, H / 2 + border + 0.001, 0).setCanSleep(false));
  const desc = buildShape(kind, n).setFriction(0.4).setDensity(1);
  const pc = world.createCollider(desc, body);
  const verts = pc.shape.vertices; // polyhedron points (checked against contact local points below)
  world.step();
  const man = readPair(world, pc, gc);
  const pts = man.flatMap((m) => m.pts);
  const kept = pts.map((p) => {
    const f = fidStr(p.fidA);
    let az = azDeg(p.pA);
    let vchk = '';
    if (f.startsWith('V')) {
      const vid = p.fidA & 0x3fffffff;
      const v = { x: verts[3 * vid], y: verts[3 * vid + 1], z: verts[3 * vid + 2] };
      vchk = ` vtx=${f3(v)} k=${Math.round(azDeg(v) / (360 / n)) % n}`;
    }
    return `${f}@az${az.toFixed(1)}${vchk}`;
  });
  let res = { n, kind, ground, npts: pts.length, kept };
  if (gravityOn) {
    let maxTilt = 0, minY = Infinity;
    const steps = Math.round(2 / scale.dt);
    for (let s = 0; s < steps; s++) {
      world.step();
      const t = body.translation();
      maxTilt = Math.max(maxTilt, tiltDeg(body.rotation()));
      minY = Math.min(minY, t.y);
    }
    const t = body.translation();
    res.after2s = `tiltMax=${maxTilt.toFixed(1)}deg tiltEnd=${tiltDeg(body.rotation()).toFixed(1)}deg centreY end=${t.y.toFixed(4)} min=${minY.toFixed(4)} (rest=${(H / 2 + border).toFixed(4)}) xz=(${t.x.toFixed(3)},${t.z.toFixed(3)})`;
  }
  world.free();
  return res;
}

console.log(`scale=${scale.name} g=${scale.g} dt=${scale.dt.toFixed(5)} iters=${scale.iters ?? 'default'}`);
for (const ground of ['halfspace', 'cuboid']) {
  for (const kind of ['convexHull', 'convexMesh', 'roundConvexHull']) {
    for (const n of NS) {
      const a = run(kind, n, ground, false);
      const b = run(kind, n, ground, true);
      console.log(`${ground.padEnd(9)} ${kind.padEnd(15)} n=${String(n).padStart(2)} pts=${a.npts} [${a.kept.join('; ')}]`);
      console.log(`${''.padEnd(28)} 2s with gravity: ${b.after2s}`);
    }
  }
}
process.exit(0);
