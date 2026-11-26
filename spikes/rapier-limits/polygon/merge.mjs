// Coplanar-facet merge tolerance of ConvexPolyhedron::from_convex_mesh (used by convexHull).
// Source: eps = sqrt(f32::EPSILON); an edge is deleted (its two triangles merged into one face)
// when n1.n2 > 1 - eps, i.e. dihedral deviation < acos(1 - eps).
// Probe: a box whose top is a flat part plus ONE facet tilted by theta (a single ridge edge).
// The body is turned upside down onto a HalfSpace; halfspace-vs-pfm emits exactly the vertices of
// the support face, so we see whether the "top face" is the 4-vertex flat part (not merged)
// or a 6-vertex merged face (low vertices at y = 0.5 - d appear among the kept ones).
// Second probe: a square top face surrounded by a bevel ring of width W dropping d (4 facets),
// the shape the project's notes describe.
// Usage: node spikes/rapier-limits/polygon/merge.mjs
import { RAPIER, SCALES, makeWorld, readPair } from './common.mjs';

const eps = Math.sqrt(Math.fround(2 ** -23));
const thetaC = (Math.acos(1 - eps) * 180) / Math.PI;
console.log(`sqrt(f32::EPSILON)=${eps.toExponential(5)}  merge if dihedral < acos(1-eps) = ${thetaC.toFixed(4)} deg` +
  `; bevel-bevel corner edge (normals (s,c,0),(0,c,s)) merges if sin^2 < eps: theta < ${((Math.asin(Math.sqrt(eps)) * 180) / Math.PI).toFixed(4)} deg`);

// y component of quaternion q applied to (x,y,z)
function rotY(q, x, y, z) {
  const { x: qx, y: qy, z: qz, w: qw } = q;
  // t = 2 * cross(q.xyz, v); v' = v + w t + cross(q.xyz, t)
  const tx = 2 * (qy * z - qz * y), ty = 2 * (qz * x - qx * z), tz = 2 * (qx * y - qy * x);
  return y + qw * ty + (qz * tx - qx * tz);
}
// rot: body rotation that turns the probed face normal to -Y. Prediction is raised to 0.1 so the
// halfspace manifold lists every vertex of the support feature, not only those within 0.002.
function keptFace(points, rot = { x: 1, y: 0, z: 0, w: 0 }) {
  const world = makeWorld(SCALES.SI, 0);
  world.integrationParameters.normalizedPredictionDistance = 0.1;
  const gb = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
  const gc = world.createCollider(new RAPIER.ColliderDesc(new RAPIER.HalfSpace({ x: 0, y: 1, z: 0 })), gb);
  // place the body so that its lowest vertex sits 0.001 above the plane
  let lo = Infinity;
  for (let i = 0; i < points.length; i += 3) lo = Math.min(lo, rotY(rot, points[i], points[i + 1], points[i + 2]));
  const b = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(0, -lo + 0.001, 0).setRotation(rot));
  const pc = world.createCollider(RAPIER.ColliderDesc.convexHull(new Float32Array(points)), b);
  world.step();
  let ys;
  ys = readPair(world, pc, gc).flatMap((m) => m.pts).map((p) => p.pA);
  world.free();
  return ys;
}

console.log('\nSingle ridge: flat top x in [-0.5,0.3] at y=0.5, facet to x=0.5 at y=0.5-d (run 0.2)');
for (const th of [1.0, 1.2, 1.4, 1.45, 1.48, 1.50, 1.505, 1.51, 1.52, 1.55, 1.6, 2.0]) {
  const d = 0.2 * Math.tan((th * Math.PI) / 180);
  const pts = [];
  for (const z of [-0.5, 0.5]) pts.push(-0.5, 0.5, z, 0.3, 0.5, z, 0.5, 0.5 - d, z, -0.5, -0.5, z, 0.5, -0.5, z);
  // probe 1: face toward +Y; probe 2: face toward the tilted facet normal (sin th, cos th, 0)
  const keptUp = keptFace(pts);
  const t = (th * Math.PI) / 180;
  // (sin t, cos t, 0) has polar angle pi/2 - t in the XY plane; rotating it about Z by a = pi + t
  // gives polar angle 3pi/2, i.e. (0,-1,0)
  const a = Math.PI + t;
  const keptTilt = keptFace(pts, { x: 0, y: 0, z: Math.sin(a / 2), w: Math.cos(a / 2) });
  const lowUp = keptUp.filter((p) => p.y < 0.5 - d / 2).length;
  const farTilt = keptTilt.filter((p) => p.x < -0.4).length;
  const merged = lowUp > 0 || farTilt > 0;
  const fmt = (k) => k.map((p) => `(${p.x.toFixed(2)},${p.y.toFixed(4)},${p.z.toFixed(2)})`).join(' ');
  console.log(`  theta=${th.toFixed(3)}deg d=${d.toFixed(5)} +Y face: ${keptUp.length} kept, ${lowUp} low | tilt face: ${keptTilt.length} kept, ${farTilt} at x=-0.5 -> ${merged ? 'MERGED' : 'separate'}\n      up[${fmt(keptUp)}]\n      tilt[${fmt(keptTilt)}]`);
}

console.log('\nBevel ring: top square half 0.5 at y=0.5, ring half 0.5+W at y=0.5-d, base half 0.5+W at y=-0.5');
for (const W of [0.2]) {
  for (const th of [0.9, 1.0, 1.06, 1.07, 1.1, 1.3, 1.5, 1.505, 1.51, 1.52, 1.55, 1.7]) {
    const d = W * Math.tan((th * Math.PI) / 180);
    const pts = [];
    for (const [h, y] of [[0.5, 0.5], [0.5 + W, 0.5 - d], [0.5 + W, -0.5]])
      for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) pts.push(sx * h, y, sz * h);
    const kept = keptFace(pts);
    const low = kept.filter((p) => p.y < 0.5 - d / 2).length;
    console.log(`  W=${W} theta=${th.toFixed(2)}deg d=${d.toFixed(5)} kept ${kept.length}, low ${low} -> ${low ? 'MERGED' : 'separate'}  [${kept.map((p) => `(${p.x.toFixed(2)},${p.y.toFixed(4)},${p.z.toFixed(2)})`).join(' ')}]`);
  }
}
process.exit(0);
