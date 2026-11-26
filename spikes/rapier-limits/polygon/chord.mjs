// Is the truncated face a quad, two triangles, or four points? Rest a box so that it straddles
// the closing chord (kept vertex 4 -> kept vertex 1) of the truncated n-gon face and check where
// the edge-edge contact points land: on the chord (quad model) or on the real n-gon boundary.
// Also: a box fully inside the quad but straddling its diagonal (two-triangle model would put
// edge-crossing points on the diagonal).
// Usage: node spikes/rapier-limits/polygon/chord.mjs
import { RAPIER, SCALES, makeWorld, ngonPrism, readPair, fidStr, f3, azDeg } from './common.mjs';

const scale = SCALES.SI;
const R = 0.5, HX = 0.08, HY = 0.05, HZ = 0.08;

function keptTop(n) {
  const world = makeWorld(scale, 0);
  const gb = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
  const gc = world.createCollider(new RAPIER.ColliderDesc(new RAPIER.HalfSpace({ x: 0, y: 1, z: 0 })), gb);
  const b = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(0, 0.001, 0).setRotation({ x: 1, y: 0, z: 0, w: 0 }));
  const pc = world.createCollider(RAPIER.ColliderDesc.convexHull(ngonPrism(n, R, -0.5, 0)), b);
  world.step();
  // halfspace manifold emits the feature's vertices in feature order
  const v = readPair(world, pc, gc).flatMap((m) => m.pts).map((p) => ({ x: p.pA.x, z: p.pA.z, k: Math.round(azDeg(p.pA) / (360 / n)) % n }));
  world.free();
  return v;
}
const distLine = (p, a, b) => {
  const dx = b.x - a.x, dz = b.z - a.z;
  return Math.abs(dx * (p.z - a.z) - dz * (p.x - a.x)) / Math.hypot(dx, dz);
};
const distPolyBoundary = (p, n) => {
  let best = Infinity;
  for (let k = 0; k < n; k++) {
    const a = { x: R * Math.cos((2 * Math.PI * k) / n), z: R * Math.sin((2 * Math.PI * k) / n) };
    const b = { x: R * Math.cos((2 * Math.PI * (k + 1)) / n), z: R * Math.sin((2 * Math.PI * (k + 1)) / n) };
    // segment distance
    const dx = b.x - a.x, dz = b.z - a.z;
    let t = ((p.x - a.x) * dx + (p.z - a.z) * dz) / (dx * dx + dz * dz);
    t = Math.max(0, Math.min(1, t));
    best = Math.min(best, Math.hypot(p.x - a.x - t * dx, p.z - a.z - t * dz));
  }
  return best;
};

function probe(n, x, z, label) {
  const kept = keptTop(n);
  const world = makeWorld(scale);
  const fb = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
  const pc = world.createCollider(RAPIER.ColliderDesc.convexHull(ngonPrism(n, R, -0.5, 0)), fb);
  const bb = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(x, HY + 0.0005, z));
  const bc = world.createCollider(RAPIER.ColliderDesc.cuboid(HX, HY, HZ), bb);
  world.step();
  const pts = readPair(world, pc, bc).flatMap((m) => m.pts);
  const loop = kept.map((v) => v.k);
  console.log(`\n${label}: n=${n} box at (${x},${z}); kept loop k=[${loop.join(',')}]`);
  for (let i = 0; i < kept.length; i++) {
    const a = kept[i], b = kept[(i + 1) % kept.length];
    const isChord = (b.k - a.k + n) % n !== 1 && (a.k - b.k + n) % n !== 1;
    console.log(`  quad edge ${i}: k${a.k}->k${b.k} ${isChord ? 'CHORD (not an n-gon edge)' : 'real n-gon edge'}`);
  }
  for (const p of pts) {
    const f = `${fidStr(p.fidA)}/${fidStr(p.fidB)}`;
    let extra = '';
    if (f.startsWith('E')) {
      const ds = kept.map((a, i) => distLine(p.pA, a, kept[(i + 1) % kept.length]).toFixed(5));
      extra = ` dist to quad edge lines [${ds.join(', ')}], to true n-gon boundary ${distPolyBoundary(p.pA, n).toFixed(4)}`;
      // diagonals (two-triangle model)
      const d02 = distLine(p.pA, kept[0], kept[2]).toFixed(4), d13 = distLine(p.pA, kept[1], kept[3]).toFixed(4);
      extra += `, to diagonals 0-2 ${d02} / 1-3 ${d13}`;
    }
    console.log(`  ${f.padEnd(18)} prismLocal${f3(p.pA, 4)}${extra}`);
  }
  world.free();
}

probe(6, 0, 0, 'A hexagon, box at centre (straddles chord k2-k5 through the centre)');
probe(16, -0.334, 0.066, 'B 16-gon, box near side 7 (overlaps the quad only at a corner)');
probe(4, 0.12, 0.12, 'C square (n=4, no truncation), box straddling a diagonal');
probe(5, 0.0, -0.1, 'D pentagon, box straddling the quad diagonal');
process.exit(0);
