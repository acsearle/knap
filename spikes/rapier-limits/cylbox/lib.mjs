// Pure-Rapier harness: one dynamic body resting on a floor, traced every step.
// No project code. Import run(cfg) and get a summary (and optionally a per-step trace).
import RAPIER from '@dimforge/rapier3d-compat';

export { RAPIER };
let ready = false;
export async function init() {
  if (!ready) { await RAPIER.init(); ready = true; }
}

export const KNAP = { g: 1226.25, dt: 1 / 480, iters: 30 };
export const SI = { g: 9.81, dt: 1 / 60, iters: null }; // null = leave Rapier's default

const S45 = Math.SQRT1_2;

function prismPoints(r, hh, n) {
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = (2 * Math.PI * (i + 0.5)) / n; // half-step: a facet (not a vertex) faces -x/+x/...
    for (const y of [-hh, hh]) pts.push(r * Math.cos(a), y, r * Math.sin(a));
  }
  return new Float32Array(pts);
}
function boxPoints(hx, hy, hz) {
  const p = [];
  for (const x of [-hx, hx]) for (const y of [-hy, hy]) for (const z of [-hz, hz]) p.push(x, y, z);
  return new Float32Array(p);
}

/**
 * cfg:
 *  g, dt, iters (null = default), pgs (null = default)
 *  r, hh, shape: 'cyl'|'prism32'|'prism64'|'ball'|'capsule', pose: 'roll'|'up'
 *  friction, density
 *  floor: 'cuboid'|'hull'|'halfspace', fhx, fhy, fhz, floorDynamic (bool), floorMass
 *  x0, z0 (offset from floor centre), gap (initial gap, default 0)
 *  nf (contact_natural_frequency; null = default), pred, err, lengthUnit
 *  softCcd (prediction distance or 0), canSleep (bool), noRecycle (bool, via hooks)
 *  T (s), trace (bool)
 */
export function run(cfgIn) {
  const c = {
    g: KNAP.g, dt: KNAP.dt, iters: KNAP.iters, pgs: null,
    r: 1, hh: 0.46, shape: 'cyl', pose: 'roll', friction: 0.8, density: 1,
    floor: 'cuboid', fhx: 20, fhy: 1, fhz: 20, floorDynamic: false, floorMass: 1e6,
    x0: 0, z0: 0, gap: 0,
    nf: null, pred: null, err: null, lengthUnit: null,
    softCcd: 0, canSleep: false, noRecycle: false, ccdSubsteps: null,
    T: 5, trace: false,
    ...cfgIn,
  };
  const world = new RAPIER.World({ x: 0, y: -c.g, z: 0 });
  world.timestep = c.dt;
  const ip = world.integrationParameters;
  if (c.iters != null) world.numSolverIterations = c.iters;
  if (c.pgs != null) world.numInternalPgsIterations = c.pgs;
  if (c.nf != null) ip.contact_natural_frequency = c.nf;
  if (c.pred != null) ip.normalizedPredictionDistance = c.pred;
  if (c.err != null) ip.normalizedAllowedLinearError = c.err;
  if (c.lengthUnit != null) ip.lengthUnit = c.lengthUnit;
  if (c.ccdSubsteps != null) ip.maxCcdSubsteps = c.ccdSubsteps;

  // Floor: top face at y = 0, centred at x = z = 0.
  let floorBody, floorCol, floorDesc;
  if (c.floor === 'halfspace') {
    floorBody = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    floorDesc = () => new RAPIER.ColliderDesc(new RAPIER.HalfSpace({ x: 0, y: 1, z: 0 })).setFriction(c.friction);
    floorCol = world.createCollider(floorDesc(), floorBody);
  } else {
    const bd = c.floorDynamic ? RAPIER.RigidBodyDesc.dynamic().setCanSleep(false).setGravityScale(0) : RAPIER.RigidBodyDesc.fixed();
    bd.setTranslation(0, -c.fhy, 0);
    floorBody = world.createRigidBody(bd);
    floorDesc = () => {
      const cd = c.floor === 'hull'
        ? RAPIER.ColliderDesc.convexHull(boxPoints(c.fhx, c.fhy, c.fhz))
        : RAPIER.ColliderDesc.cuboid(c.fhx, c.fhy, c.fhz);
      cd.setFriction(c.friction);
      if (c.floorDynamic) cd.setMass(c.floorMass);
      return cd;
    };
    floorCol = world.createCollider(floorDesc(), floorBody);
  }

  // Body.
  let cd;
  if (c.shape === 'cyl') cd = RAPIER.ColliderDesc.cylinder(c.hh, c.r);
  else if (c.shape.startsWith('prism')) cd = RAPIER.ColliderDesc.convexHull(prismPoints(c.r, c.hh, +c.shape.slice(5)));
  else if (c.shape === 'ball') cd = RAPIER.ColliderDesc.ball(c.r);
  else if (c.shape === 'capsule') cd = RAPIER.ColliderDesc.capsule(c.hh, c.r);
  else throw new Error('shape ' + c.shape);
  cd.setDensity(c.density).setFriction(c.friction);
  if (c.noRecycle) cd.setActiveHooks(RAPIER.ActiveHooks.FILTER_CONTACT_PAIRS);
  // Rolling pose: local Y axis turned onto world X (rotation of 90 deg about Z).
  const roll = c.pose === 'roll';
  let restH;
  if (c.shape === 'ball') restH = c.r;
  else if (roll) restH = c.shape.startsWith('prism') ? c.r * Math.cos(Math.PI / +c.shape.slice(5)) : c.r;
  else restH = c.hh + (c.shape === 'capsule' ? c.r : 0);
  const y0 = restH + c.gap;
  const bd = RAPIER.RigidBodyDesc.dynamic().setTranslation(c.x0, y0, c.z0).setCanSleep(c.canSleep);
  if (roll) bd.setRotation({ x: 0, y: 0, z: S45, w: S45 });
  if (c.softCcd) bd.setSoftCcdPrediction(c.softCcd);
  if (c.v0) { bd.setLinvel(0, 0, c.v0); if (roll) bd.setAngvel({ x: c.v0 / c.r, y: 0, z: 0 }); }
  const body = world.createRigidBody(bd);
  const col = world.createCollider(cd, body);
  const m = body.mass();

  const hooks = c.noRecycle
    ? { filterContactPair: () => RAPIER.SolverFlags.COMPUTE_IMPULSE, filterIntersectionPair: () => true }
    : undefined;

  const N = Math.round(c.T / c.dt);
  const energy = () => {
    const v = body.linvel(), w = body.angvel(), p = body.translation();
    // rotational KE: 0.5 w^T I w with world inertia; use principal inertia in local frame.
    const q = body.rotation();
    const wl = rotInv(q, w);
    const I = body.principalInertia(); // local principal axes; for these shapes aligned with body axes
    const krot = 0.5 * (I.x * wl.x * wl.x + I.y * wl.y * wl.y + I.z * wl.z * wl.z);
    return 0.5 * m * (v.x * v.x + v.y * v.y + v.z * v.z) + krot + m * c.g * (p.y - y0);
  };
  const E0 = energy();
  const s = {
    maxV: 0, maxW: 0, tFirstMove: null, maxDE: 0, minDist: Infinity, maxTilt: 0, maxTiltSlow: 0,
    nPts: {}, nSolver: {}, zeroContactSteps: 0, tunnelT: null, minY: Infinity, maxDrift: 0,
    lever1: null, offEdgeT: null, maxLeverSlow: 0, maxKE: 0,
  };
  const KE = () => energy() - m * c.g * (body.translation().y - y0);
  const trace = [];
  for (let k = 1; k <= N; k++) {
    if (c.recreateFloor && k > 1) {
      // fresh pair every step: no persistent manifold (and no warm start) between steps
      world.removeCollider(floorCol, false);
      floorCol = world.createCollider(floorDesc(), floorBody);
    }
    world.step(undefined, hooks);
    const t = k * c.dt;
    const p = body.translation(), v = body.linvel(), w = body.angvel();
    const sp = Math.hypot(v.x, v.y, v.z), wsp = Math.hypot(w.x, w.y, w.z);
    s.maxV = Math.max(s.maxV, sp); s.maxW = Math.max(s.maxW, wsp);
    if (s.tFirstMove == null && sp > 0.05 * restH) s.tFirstMove = t; // 5% of size per second
    const dE = energy() - E0; s.maxDE = Math.max(s.maxDE, dE);
    s.minY = Math.min(s.minY, p.y);
    s.maxDrift = Math.max(s.maxDrift, Math.hypot(p.x - c.x0, p.z - c.z0));
    // centre below the floor top: 'tunnel' if still over the floor's footprint, else 'offEdge'
    const fp = floorBody.translation();
    const over = c.floor === 'halfspace' || (Math.abs(p.x - fp.x) < c.fhx && Math.abs(p.z - fp.z) < c.fhz);
    if (p.y < y0 - restH) {
      if (over && s.tunnelT == null && s.offEdgeT == null) s.tunnelT = t;
      if (!over && s.offEdgeT == null && s.tunnelT == null) s.offEdgeT = t;
    }
    let man = null;
    world.narrowPhase.contactPair(floorCol.handle, col.handle, world.bodies, (mf, flipped) => {
      const n = mf.normal();
      const pts = [];
      for (let i = 0; i < mf.numContacts(); i++) {
        const lp = mf.localContactPoint1(i), lp2 = mf.localContactPoint2(i);
        // pf: point on the floor side, in the floor body's frame
        pts.push({ d: mf.contactDist(i), p1: lp, p2: lp2, pf: flipped ? lp2 : lp, fid1: mf.contactFid1(i), fid2: mf.contactFid2(i) });
      }
      const sol = [];
      for (let i = 0; i < mf.numSolverContacts(); i++) sol.push({ p: mf.solverContactPoint(i), d: mf.solverContactDist(i) });
      man = { n, flipped, pts, sol };
    });
    const np = man ? man.pts.length : 0, ns = man ? man.sol.length : 0;
    s.nPts[np] = (s.nPts[np] || 0) + 1; s.nSolver[ns] = (s.nSolver[ns] || 0) + 1;
    if (ns === 0) s.zeroContactSteps++;
    if (man && man.pts.length) {
      // normal from floor (collider1 = floorCol) toward body: should be +Y
      const ny = Math.abs(man.n.y) / Math.hypot(man.n.x, man.n.y, man.n.z);
      const tilt = Math.acos(Math.min(1, ny)) * 180 / Math.PI;
      s.maxTilt = Math.max(s.maxTilt, tilt);
      if (sp < 0.05 * restH) s.maxTiltSlow = Math.max(s.maxTiltSlow, tilt);
      for (const q of man.pts) s.minDist = Math.min(s.minDist, q.d);
      // lever: mean horizontal offset of the floor-side contact points from the body centre
      // (roll pose: along z, i.e. across the rolling axis; upright: |(x,z)|).
      const ft = floorBody.translation();
      let lx = 0, lz = 0;
      for (const q of man.pts) { lx += q.pf.x + ft.x - p.x; lz += q.pf.z + ft.z - p.z; }
      lx /= man.pts.length; lz /= man.pts.length;
      // the manifold was computed at the start of the step, before the body moved by v*dt:
      // measure the lever against the centre at that time
      lx += v.x * c.dt; lz += v.z * c.dt;
      const lever = roll ? lz : Math.hypot(lx, lz);
      man.lever = lever;
      // lever measured along the direction of travel (roll pose): negative = contact behind centre
      if (roll && Math.abs(v.z) > 1e-3) { s.leverAlongSum = (s.leverAlongSum || 0) + lever * Math.sign(v.z); s.leverAlongN = (s.leverAlongN || 0) + 1; }
      if (s.lever1 == null) s.lever1 = lever;
      if (sp < 0.05 * restH) s.maxLeverSlow = Math.max(s.maxLeverSlow, Math.abs(lever));
    }
    s.maxKE = Math.max(s.maxKE, KE());
    if (k > 0.75 * N) { s.plateauSum = (s.plateauSum || 0) + Math.hypot(v.x, v.z); s.plateauN = (s.plateauN || 0) + 1; }
    if (c.trace) trace.push({ t, p: { ...p }, v: { ...v }, w: { ...w }, dE, man });
  }
  s.final = body.translation(); s.finalV = body.linvel(); s.KEend = KE(); s.vPlateau = s.plateauN ? s.plateauSum / s.plateauN : 0;
  s.E0 = E0; s.mass = m; s.restH = restH; s.y0 = y0;
  world.free();
  return c.trace ? { s, trace } : { s };
}

function rotInv(q, v) {
  // rotate v by conjugate of q
  const x = -q.x, y = -q.y, z = -q.z, w = q.w;
  const tx = 2 * (y * v.z - z * v.y), ty = 2 * (z * v.x - x * v.z), tz = 2 * (x * v.y - y * v.x);
  return { x: v.x + w * tx + (y * tz - z * ty), y: v.y + w * ty + (z * tx - x * tz), z: v.z + w * tz + (x * ty - y * tx) };
}

export function fmt(s) {
  const f = (x, d = 3) => (x == null ? '-' : Math.abs(x) >= 1e4 || (Math.abs(x) < 1e-3 && x !== 0) ? x.toExponential(2) : x.toFixed(d));
  const hist = (h) => Object.entries(h).map(([k, v]) => `${k}:${v}`).join(' ');
  return `lever1 ${f(s.lever1, 5)} leverSlow ${f(s.maxLeverSlow, 5)} maxKE ${f(s.maxKE)} maxV ${f(s.maxV)} maxW ${f(s.maxW)} tMove ${f(s.tFirstMove, 2)} ` +
    `minDist ${f(s.minDist, 4)} tilt ${f(s.maxTilt, 2)}deg (slow ${f(s.maxTiltSlow, 2)}) ` +
    `drift ${f(s.maxDrift)} minY ${f(s.minY)} tunnel ${f(s.tunnelT, 2)} offEdge ${f(s.offEdgeT, 2)} pts[${hist(s.nPts)}] sol[${hist(s.nSolver)}]`;
}
