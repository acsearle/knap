// Pure-Rapier helpers for the cylinder-on-hull rest tests. No project code is imported: the point
// sets below re-create src/physics/shapes.ts prismShape/bevelledPrism with plain numbers.
import RAPIER from '@dimforge/rapier3d-compat';
await RAPIER.init();
export { RAPIER };

export const HC = 0.46; // barrel radius and half-length (src/geometry/dims.ts HC)
export const BEVEL = 0.01;

// --- point sets (same construction as shapes.ts prismShape) ---------------------------------
function gonVertex(R, n, i) {
  const a = ((i + 0.5) / n) * 2 * Math.PI;
  return { u: R * Math.cos(a), v: R * Math.sin(a) };
}
function keepIndex(n, keepDeg = 56.25) {
  let best = 0;
  for (let i = 0; i < n / 4; i++)
    if (Math.abs(((i + 0.5) / n) * 360 - keepDeg) < Math.abs(((best + 0.5) / n) * 360 - keepDeg)) best = i;
  return best;
}
/** Prism along `axis` (0/1/2) over the circumscribed n-gon of `radius`, or a stadium run of
 *  `run`+1 barrels along u; cap vertices not kept pulled in by `bevel`. Returns flat Float32Array. */
export function prismPoints(center, axis, u, radius, hl, n, run = 0, bevel = BEVEL) {
  const v = 3 - axis - u;
  const R = radius / Math.cos(Math.PI / n);
  const j = run > 0 ? n / 4 - 1 : keepIndex(n);
  const keep = new Set([j, n / 2 - 1 - j, n / 2 + j, n - 1 - j]);
  const pts = [];
  for (let i = 0; i < n; i++) {
    const g = gonVertex(R, n, i);
    const uu = g.u + (g.u > 0 ? run : 0);
    for (const s of [-1, 1]) {
      const p = [...center];
      p[u] += uu;
      p[v] += g.v;
      p[axis] += s * (keep.has(i) ? hl : hl - bevel);
      pts.push(p);
    }
  }
  return new Float32Array(pts.flat());
}
export function boxPoints(c, h) {
  const out = [];
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) out.push(c[0] + sx * h[0], c[1] + sy * h[1], c[2] + sz * h[2]);
  return new Float32Array(out);
}

// --- floors: fixed body at the origin, top surface at y = 0 --------------------------------
// All dimensions are multiplied by `k` (size scale).
export function floorDesc(name, k = 1) {
  const c = [0, -HC * k, 0];
  const hl = HC * k, r = HC * k, bev = BEVEL * k;
  switch (name) {
    case 'cuboid': return RAPIER.ColliderDesc.cuboid(4.46 * k, HC * k, HC * k).setTranslation(4 * k, -HC * k, 0);
    case 'boxhull': return RAPIER.ColliderDesc.convexHull(boxPoints([4 * k, -HC * k, 0], [4.46 * k, HC * k, HC * k]));
    case 'armFlat': return RAPIER.ColliderDesc.convexHull(prismPoints(c, 1, 0, r, hl, 16, 8 * k, bev));
    case 'armFlat0': return RAPIER.ColliderDesc.convexHull(prismPoints(c, 1, 0, r, hl, 16, 8 * k, 0));
    case 'armEdge': return RAPIER.ColliderDesc.convexHull(prismPoints(c, 2, 0, r, hl, 16, 8 * k, bev));
    case 'armEdge0': return RAPIER.ColliderDesc.convexHull(prismPoints(c, 2, 0, r, hl, 16, 8 * k, 0));
    case 'barrelFlat': return RAPIER.ColliderDesc.convexHull(prismPoints(c, 1, 2, r, hl, 16, 0, bev));
    case 'barrelFlat0': return RAPIER.ColliderDesc.convexHull(prismPoints(c, 1, 2, r, hl, 16, 0, 0));
    case 'barrelEdge': return RAPIER.ColliderDesc.convexHull(prismPoints(c, 2, 0, r, hl, 16, 0, bev));
    case 'barrelEdge0': return RAPIER.ColliderDesc.convexHull(prismPoints(c, 2, 0, r, hl, 16, 0, 0));
    case 'ngon0': return RAPIER.ColliderDesc.convexHull(prismPoints([0, -HC * k, 0], 1, 2, 3 * k, hl, 16, 0, 0)); // wide 16-gon slab, no bevel
    default: throw new Error('floor ' + name);
  }
}
/** x range of the floor's top, for position sweeps (unscaled). */
export function floorSpan(name) {
  if (name.startsWith('arm') || name === 'cuboid' || name === 'boxhull') return [-0.46, 8.46];
  if (name === 'ngon0') return [-3, 3];
  return [-0.46, 0.46];
}

// --- the resting body ------------------------------------------------------------------------
const ROLL = { x: Math.SQRT1_2, y: 0, z: 0, w: Math.SQRT1_2 }; // local Y (cylinder axis) -> world -Z/Z
export function bodyDesc(kind, r, pose, k = 1) {
  const R = r * k, hl = HC * k;
  switch (kind) {
    case 'cyl': return RAPIER.ColliderDesc.cylinder(hl, R);
    case 'roundcyl': return RAPIER.ColliderDesc.roundCylinder(hl - 0.02 * k, R - 0.02 * k, 0.02 * k);
    case 'cuboid': return RAPIER.ColliderDesc.cuboid(R, hl, R);
    case 'ball': return RAPIER.ColliderDesc.ball(pose === 'roll' ? R : hl);
    case 'hull32': return RAPIER.ColliderDesc.convexHull(prismPoints([0, 0, 0], 1, 2, R, hl, 32, 0, 0));
    // same 32-gon prism, caps bevelled (4 kept rim vertices, others pulled in by 0.02*R) so each cap is a 4-vertex face
    case 'hull32b': return RAPIER.ColliderDesc.convexHull(prismPoints([0, 0, 0], 1, 2, R, hl, 32, 0, 0.02 * R));
    default: throw new Error('body ' + kind);
  }
}
export function restHeight(kind, r, pose, k = 1) {
  if (kind === 'ball') return (pose === 'roll' ? r : HC) * k;
  if (pose === 'roll') return r * k; // cuboid(R, hl, R) turned about X stands R tall too
  return HC * k;
}

/**
 * Run one rest test. Options:
 *  floor, body, r, pose ('roll'|'cap'), x, z (unscaled positions), k (size scale),
 *  g, dt, iters (null = Rapier default), freq (contact_natural_frequency or null), pred
 *  (normalizedPredictionDistance or null), hooks (true: contact-filter hook on the pair, disables
 *  recycling), softCcd (0 = off), T (seconds), gap (initial gap, unscaled), trace (log per step).
 */
export function run(o) {
  const k = o.k ?? 1;
  const world = new RAPIER.World({ x: 0, y: -(o.g ?? 1226.25), z: 0 });
  world.timestep = o.dt ?? 1 / 480;
  if (o.iters != null) world.numSolverIterations = o.iters;
  if (o.freq != null) world.integrationParameters.contact_natural_frequency = o.freq;
  if (o.pred != null) world.integrationParameters.normalizedPredictionDistance = o.pred;
  if (o.ccdSub != null) world.integrationParameters.maxCcdSubsteps = o.ccdSub;
  const fb = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
  const fd = floorDesc(o.floor, k);
  if (o.hooks) fd.setActiveHooks(RAPIER.ActiveHooks.FILTER_CONTACT_PAIRS);
  const floor = world.createCollider(fd, fb);
  const y0 = restHeight(o.body, o.r, o.pose, k) + (o.gap ?? 0) * k;
  const bd = RAPIER.RigidBodyDesc.dynamic().setCanSleep(false).setTranslation(o.x * k, y0, (o.z ?? 0) * k);
  if (o.pose === 'roll') bd.setRotation(ROLL);
  if (o.softCcd) bd.setSoftCcdPrediction(o.softCcd * k);
  const body = world.createRigidBody(bd);
  const cyl = world.createCollider(bodyDesc(o.body, o.r, o.pose, k), body);
  const hooks = o.hooks ? { filterContactPair: () => RAPIER.SolverFlags.COMPUTE_IMPULSE, filterIntersectionPair: () => true } : undefined;
  const pred = world.integrationParameters.normalizedPredictionDistance * world.integrationParameters.lengthUnit;

  const steps = Math.round((o.T ?? 3) / world.timestep);
  const res = { y0, firstZero: null, zeroKind: null, zeroSteps: 0, maxSink: 0, fellAt: null, tippedAt: null, offAt: null, diag: null, trace: [] };
  const axis0 = rotY(body.rotation());
  for (let s = 1; s <= steps; s++) {
    world.step(undefined, hooks);
    const t = body.translation();
    let found = false, n = 0, ns = 0, minDist = Infinity, normal = null, pts = [];
    world.contactPair(cyl, floor, (m, flipped) => {
      found = true;
      n = m.numContacts();
      ns = m.numSolverContacts();
      const nn = m.normal();
      normal = flipped ? [-nn.x, -nn.y, -nn.z] : [nn.x, nn.y, nn.z];
      for (let i = 0; i < n; i++) {
        minDist = Math.min(minDist, m.contactDist(i));
        if (o.trace) { const p = m.localContactPoint1(i); pts.push([+p.x.toFixed(3), +p.y.toFixed(3), +p.z.toFixed(3), +m.contactDist(i).toFixed(4)]); }
      }
    });
    const sink = y0 - t.y;
    if (res.fellAt == null) res.maxSink = Math.max(res.maxSink, sink);
    const zero = !found || n === 0 || ns === 0;
    if (zero) {
      // The pair's shapes overlap (GJK intersection test) yet the manifold is empty: a real miss.
      if (cyl.intersectsShape(floor.shape, floor.translation(), floor.rotation())) {
        res.zeroPen = (res.zeroPen ?? 0) + 1;
        if (!res.firstZeroPen) { const c = cyl.contactCollider(floor, pred); res.firstZeroPen = { step: s, found, n, ns, x: +(t.x / k).toFixed(3), y: +(t.y / k).toFixed(4), z: +(t.z / k).toFixed(3), contactQuery: c ? +c.distance.toFixed(4) : null }; }
      }
      const [sx0, sx1] = floorSpan(o.floor);
      if (t.x >= sx0 * k && t.x <= sx1 * k && Math.abs(t.z) <= 0.46 * k && sink < 0.1 * k) {
        res.zeroOver = (res.zeroOver ?? 0) + 1;
        if (!res.firstZeroOver) res.firstZeroOver = { step: s, found, n, ns, x: +(t.x / k).toFixed(3), sink: +(sink / k).toFixed(4) };
      }
    }
    if (zero && res.fellAt == null) {
      res.zeroSteps++;
      if (res.firstZero == null) {
        res.firstZero = s;
        res.zeroKind = !found ? 'no-manifold' : n === 0 ? 'manifold-0-points' : 'points-but-0-solver-contacts(minDist=' + minDist.toFixed(4) + ')';
        const fp = floor.translation(), fr = floor.rotation();
        const pen = cyl.intersectsShape(floor.shape, fp, fr);
        const c = cyl.contactCollider(floor, pred);
        res.diag = { step: s, x: +(t.x / k).toFixed(3), z: +(t.z / k).toFixed(3), sink: +sink.toFixed(4), penetrating: pen, contactQuery: c ? { dist: +c.distance.toFixed(4), n: [+c.normal1.x.toFixed(3), +c.normal1.y.toFixed(3), +c.normal1.z.toFixed(3)] } : null, vy: +body.linvel().y.toFixed(3) };
      }
    }
    if (o.trace && (s <= o.trace || zero)) res.trace.push({ s, x: +t.x.toFixed(3), y: +t.y.toFixed(4), z: +t.z.toFixed(3), found, n, ns, minDist: n ? +minDist.toFixed(4) : null, normal: normal && normal.map((v) => +v.toFixed(3)), pts });
    const ang = Math.acos(Math.min(1, Math.abs(dot(rotY(body.rotation()), axis0)))) * 180 / Math.PI;
    if (res.fellAt == null && t.y < -0.5 * k) { res.fellAt = s; res.fellXZ = [+(t.x / k).toFixed(3), +(t.z / k).toFixed(3)]; }
    if (res.tippedAt == null && ang > 15) res.tippedAt = s;
    if (res.offAt == null && (Math.abs(t.x - o.x * k) > 0.5 * k || Math.abs(t.z - (o.z ?? 0) * k) > 0.5 * k)) res.offAt = s;
  }
  const t = body.translation();
  res.final = { x: +(t.x / k).toFixed(3), y: +(t.y / k).toFixed(3), z: +(t.z / k).toFixed(3) };
  const [sx0, sx1] = floorSpan(o.floor);
  const over = res.fellXZ && res.fellXZ[0] >= sx0 && res.fellXZ[0] <= sx1 && Math.abs(res.fellXZ[1]) <= (o.floor === 'ngon0' ? 3 : 0.46);
  res.outcome = res.fellAt != null ? (over ? 'THROUGH' : 'OFF') : res.tippedAt != null ? 'TIPPED' : res.offAt != null ? 'SLID/ROLLED' : 'STAYED';
  world.free();
  return res;
}
function rotY(q) { // world image of local +Y
  const { x, y, z, w } = q;
  return [2 * (x * y - w * z), 1 - 2 * (x * x + z * z), 2 * (y * z + w * x)];
}
function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }

/** Count the hull's faces/vertices the way parry sees them is not exposed to JS; report the
 *  hull's vertex count instead (convexHull drops interior points). */
export function hullVertexCount(desc) {
  const w = new RAPIER.World({ x: 0, y: 0, z: 0 });
  const c = w.createCollider(desc);
  const v = c.shape.vertices ? c.shape.vertices.length / 3 : null;
  w.free();
  return v;
}
