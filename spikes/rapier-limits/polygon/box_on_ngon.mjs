// A small dynamic cuboid resting on the top n-gon face of a FIXED convexHull prism, at the centre
// and near the middle of each side. Reports the contact manifold after the first step and what
// the box does over 2 s.
// Usage: node spikes/rapier-limits/polygon/box_on_ngon.mjs [SI|KNAP] [n,n,...] [verbose]
import { RAPIER, SCALES, makeWorld, ngonPrism, readPair, fidStr, tiltDeg, f3, azDeg } from './common.mjs';

const scale = SCALES[process.argv[2] ?? 'SI'];
const NS = (process.argv[3] ?? '4,5,6,8,16,32').split(',').map(Number);
const verbose = process.argv[4] === 'verbose';
const R = 0.5, HX = 0.08, HY = 0.05, HZ = 0.08;
const Q180X = { x: 1, y: 0, z: 0, w: 0 }; // 180 deg about X

// Which top-face vertices does parry keep? Rotate the same hull 180 deg about X so its top face
// points down onto a HalfSpace; halfspace-vs-pfm emits exactly the support feature's vertices.
function keptTop(n) {
  const world = makeWorld(scale, 0);
  const gb = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
  const gc = world.createCollider(new RAPIER.ColliderDesc(new RAPIER.HalfSpace({ x: 0, y: 1, z: 0 })), gb);
  const b = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(0, 0.001, 0).setRotation(Q180X));
  const pc = world.createCollider(RAPIER.ColliderDesc.convexHull(ngonPrism(n, R, -0.5, 0)), b);
  world.step();
  const ks = readPair(world, pc, gc).flatMap((m) => m.pts).map((p) => {
    // p.pA is in the collider-local frame = hull frame
    return { k: Math.round(azDeg(p.pA) / (360 / n)) % n, y: p.pA.y, p: p.pA };
  });
  world.free();
  return ks;
}

function inConvex(poly, x, z) {
  let sign = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const c = (b.x - a.x) * (z - a.z) - (b.z - a.z) * (x - a.x);
    if (Math.abs(c) < 1e-9) continue;
    if (sign === 0) sign = Math.sign(c);
    else if (Math.sign(c) !== sign) return false;
  }
  return true;
}

function place(n, x, z, quad) {
  const world = makeWorld(scale);
  const fb = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
  const pc = world.createCollider(RAPIER.ColliderDesc.convexHull(ngonPrism(n, R, -0.5, 0)).setFriction(0.4), fb);
  const bb = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(x, HY + 0.0005, z).setCanSleep(false));
  const bc = world.createCollider(RAPIER.ColliderDesc.cuboid(HX, HY, HZ).setFriction(0.4).setDensity(1), bb);
  world.step();
  const pts = readPair(world, pc, bc).flatMap((m) => m.pts);
  const nWitness = pts.filter((p) => p.fidA === 0 && p.fidB === 0).length;
  const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sz]) => inConvex(quad, x + sx * HX, z + sz * HZ));
  const footprint = corners.every(Boolean) ? 'inside' : corners.some(Boolean) ? 'partial' : 'outside';
  const desc = pts.map((p) => `${fidStr(p.fidA)}/${fidStr(p.fidB)}${f3(p.pA, 3)}`).join(' ');
  let maxTilt = 0, minY = Infinity;
  const steps = Math.round(2 / scale.dt);
  for (let s = 0; s < steps; s++) {
    world.step();
    maxTilt = Math.max(maxTilt, tiltDeg(bb.rotation()));
    minY = Math.min(minY, bb.translation().y);
  }
  const t = bb.translation();
  const ptsEnd = readPair(world, pc, bc).flatMap((m) => m.pts).length;
  const tiltEnd = tiltDeg(bb.rotation());
  world.free();
  return { npts: pts.length, nWitness, footprint, desc, maxTilt, tiltEnd, yEnd: t.y, minY, dxz: Math.hypot(t.x - x, t.z - z), ptsEnd };
}

console.log(`scale=${scale.name} g=${scale.g} dt=${scale.dt.toFixed(5)} iters=${scale.iters ?? 'default'}  box half=(${HX},${HY},${HZ}) rest centre y=${HY}`);
for (const n of NS) {
  const kt = keptTop(n);
  const quad = kt.map((v) => ({ x: v.p.x, z: v.p.z })); // contact points are collider-local = hull frame
  const ks = kt.map((v) => {
    const az = (Math.atan2(v.p.z, v.p.x) * 180) / Math.PI;
    return Math.round(((az + 360) % 360) / (360 / n)) % n;
  });
  console.log(`\nn=${n}: top face keeps vertices k=[${ks.join(',')}] (vertex k at azimuth 360k/n)`);
  const apo = R * Math.cos(Math.PI / n);
  const spots = [{ name: 'centre', x: 0, z: 0 }];
  for (let j = 0; j < n; j++) {
    const a = ((j + 0.5) * 2 * Math.PI) / n;
    const r = apo - 0.15;
    spots.push({ name: `side${j}`, x: r * Math.cos(a), z: r * Math.sin(a) });
  }
  const tally = {};
  for (const s of spots) {
    const r = place(n, s.x, s.z, quad);
    const kind = r.nWitness === r.npts ? 'witness-only' : 'clipped+witness';
    const key = `${r.footprint}/${kind}/${r.npts}pts`;
    (tally[key] ??= []).push(r);
    if (verbose || s.name === 'centre' || s.name === 'side0' || s.name === `side${Math.floor(n / 2)}`)
      console.log(`  ${s.name.padEnd(7)} at (${s.x.toFixed(3)},${s.z.toFixed(3)}) footprint ${r.footprint.padEnd(7)} step1 pts=${r.npts} (witness ${r.nWitness}) [${r.desc}]\n` +
        `          2s: tiltMax=${r.maxTilt.toFixed(2)} tiltEnd=${r.tiltEnd.toFixed(2)}deg yEnd=${r.yEnd.toFixed(4)} yMin=${r.minY.toFixed(4)} slide=${r.dxz.toFixed(4)} ptsEnd=${r.ptsEnd}`);
  }
  for (const [k, rs] of Object.entries(tally)) {
    const mx = (f) => Math.max(...rs.map(f)), mn = (f) => Math.min(...rs.map(f));
    console.log(`  summary ${k.padEnd(32)} spots=${String(rs.length).padStart(2)} tiltMax<=${mx((r) => r.maxTilt).toFixed(2)} tiltEnd<=${mx((r) => r.tiltEnd).toFixed(2)}deg yEnd in [${mn((r) => r.yEnd).toFixed(4)},${mx((r) => r.yEnd).toFixed(4)}] yMin>=${mn((r) => r.minY).toFixed(4)} slide<=${mx((r) => r.dxz).toFixed(4)}`);
  }
}
process.exit(0);
