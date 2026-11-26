// Shared helpers for the polygon spike. Native Rapier API only.
import RAPIER from '@dimforge/rapier3d-compat';
await RAPIER.init();
export { RAPIER };

// Scales. SI = Rapier defaults as tuned by its authors; KNAP = the product's world settings.
export const SCALES = {
  SI: { name: 'SI', g: 9.81, dt: 1 / 60, iters: null },
  KNAP: { name: 'knap', g: 1226.25, dt: 1 / 480, iters: 30 },
};

export function makeWorld(scale, g = scale.g) {
  const world = new RAPIER.World({ x: 0, y: -g, z: 0 });
  world.timestep = scale.dt;
  if (scale.iters) world.integrationParameters.numSolverIterations = scale.iters;
  if (scale === SCALES.KNAP) {
    world.integrationParameters.lengthUnit = 1;
    world.integrationParameters.maxCcdSubsteps = 0;
  }
  return world;
}

// Points of a prism whose cross-section is a regular n-gon of circumradius R, vertex k at
// azimuth phase + 2*pi*k/n (azimuth measured in the XZ plane from +X toward +Z), y in [y0, y1].
export function ngonPrism(n, R, y0, y1, phase = 0) {
  const pts = [];
  for (const y of [y0, y1]) {
    for (let k = 0; k < n; k++) {
      const a = phase + (2 * Math.PI * k) / n;
      pts.push(R * Math.cos(a), y, R * Math.sin(a));
    }
  }
  return new Float32Array(pts);
}

// Explicit triangulation (fan caps + side quads) for convexMesh. Outward winding (CCW from outside).
export function ngonPrismIndices(n) {
  const idx = [];
  // bottom ring 0..n-1 (y0), top ring n..2n-1 (y1). Vertex azimuth increases from +X toward +Z,
  // which, seen from +Y, is clockwise. Top cap normal +Y: winding k, k+2, k+1 ... use fan 0,(k+1),k.
  for (let k = 1; k < n - 1; k++) idx.push(n + 0, n + k + 1, n + k); // top
  for (let k = 1; k < n - 1; k++) idx.push(0, k, k + 1); // bottom
  for (let k = 0; k < n; k++) {
    const k1 = (k + 1) % n;
    idx.push(k, n + k, n + k1, k, n + k1, k1);
  }
  return new Uint32Array(idx);
}

const HDR = 0x3fffffff;
export function fidStr(f) {
  if (f === 0) return 'UNKNOWN';
  const h = f >>> 30;
  const c = f & HDR;
  return ({ 1: 'V', 2: 'E', 3: 'F' })[h] + c;
}

// Read the manifold(s) between colliders a and b; returns per-point data with fids and local
// points expressed for collider a (fidA, pA) and b (fidB, pB), plus world solver points.
export function readPair(world, a, b) {
  const out = [];
  world.contactPair(a, b, (m, flipped) => {
    const n = m.numContacts();
    const pts = [];
    for (let i = 0; i < n; i++) {
      const p1 = m.localContactPoint1(i), p2 = m.localContactPoint2(i);
      const f1 = m.contactFid1(i), f2 = m.contactFid2(i);
      pts.push({
        fidA: flipped ? f2 : f1, fidB: flipped ? f1 : f2,
        pA: flipped ? p2 : p1, pB: flipped ? p1 : p2,
        dist: m.contactDist(i), impulse: m.contactImpulse(i),
      });
    }
    const sp = [];
    for (let i = 0; i < m.numSolverContacts(); i++) sp.push(m.solverContactPoint(i));
    out.push({ pts, solver: sp, flipped });
  });
  return out;
}

export function tiltDeg(q) {
  // angle between body up (+Y rotated by q) and world +Y
  const { x, y, z, w } = q;
  const upY = 1 - 2 * (x * x + z * z);
  return (Math.acos(Math.max(-1, Math.min(1, upY))) * 180) / Math.PI;
}

export const f3 = (v, d = 3) => `(${v.x.toFixed(d)},${v.y.toFixed(d)},${v.z.toFixed(d)})`;
export const azDeg = (p) => ((Math.atan2(p.z, p.x) * 180) / Math.PI + 360) % 360;
