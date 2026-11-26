// Steps where the cylinder/floor manifold is EMPTY although the shapes overlap. For each such step,
// print the pose, the pair's cached normal, a direct contact query (collider.contactCollider, the same
// GJK+EPA routine without the manifold's cached direction), and a FRESH manifold: the same two
// shapes at the same poses in a new world (no cache, no recycling), both bodies fixed/kinematic.
// node spikes/rapier-limits/cylhull/miss.mjs '<json lib.run options>' [maxPrint=10]
import { RAPIER, floorDesc, bodyDesc } from './lib.mjs';
import * as L from './lib.mjs';
const o = JSON.parse(process.argv[2]);
const maxPrint = +(process.argv[3] ?? 10);
const S = o.scale === 'si' ? { g: 9.81, dt: 1 / 60, iters: null } : { g: 1226.25, dt: 1 / 480, iters: 30, ccdSub: 0 };
const k = o.k ?? 1;

function freshManifold(pos, rot, initDirTrick) {
  const w = new RAPIER.World({ x: 0, y: 0, z: 0 });
  const f = w.createCollider(floorDesc(o.floor, k), w.createRigidBody(RAPIER.RigidBodyDesc.fixed()));
  const b = w.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(pos.x, pos.y, pos.z).setRotation(rot));
  const c = w.createCollider(bodyDesc(o.body, o.r, o.pose, k), b);
  w.step();
  let out = { found: false, n: 0 };
  w.contactPair(c, f, (m, fl) => { const nn = m.normal(); out = { found: true, n: m.numContacts(), minDist: m.numContacts() ? Math.min(...Array.from({ length: m.numContacts() }, (_, i) => m.contactDist(i))).toFixed(4) : null, normal: [nn.x, nn.y, nn.z].map((v) => +(fl ? -v : v).toFixed(3)) }; });
  w.free();
  return out;
}

// re-run the simulation inline (same as lib.run) so that we can inspect state at the miss step
const world = new RAPIER.World({ x: 0, y: -(o.g ?? S.g), z: 0 });
world.timestep = o.dt ?? S.dt;
if ((o.iters ?? S.iters) != null) world.numSolverIterations = o.iters ?? S.iters;
if (o.freq != null) world.integrationParameters.contact_natural_frequency = o.freq;
if (o.pred != null) world.integrationParameters.normalizedPredictionDistance = o.pred;
if ((o.ccdSub ?? S.ccdSub) != null) world.integrationParameters.maxCcdSubsteps = o.ccdSub ?? S.ccdSub;
const fd = floorDesc(o.floor, k);
if (o.hooks) fd.setActiveHooks(RAPIER.ActiveHooks.FILTER_CONTACT_PAIRS);
const floor = world.createCollider(fd, world.createRigidBody(RAPIER.RigidBodyDesc.fixed()));
const y0 = L.restHeight(o.body, o.r, o.pose, k);
const bd = RAPIER.RigidBodyDesc.dynamic().setCanSleep(false).setTranslation(o.x * k, y0, (o.z ?? 0) * k);
if (o.pose === 'roll') bd.setRotation({ x: Math.SQRT1_2, y: 0, z: 0, w: Math.SQRT1_2 });
if (o.softCcd) bd.setSoftCcdPrediction(o.softCcd * k);
const body = world.createRigidBody(bd);
const cyl = world.createCollider(bodyDesc(o.body, o.r, o.pose, k), body);
const hooks = o.hooks ? { filterContactPair: () => RAPIER.SolverFlags.COMPUTE_IMPULSE, filterIntersectionPair: () => true } : undefined;
const pred = world.integrationParameters.normalizedPredictionDistance;
let printed = 0, misses = 0, freshHas = 0;
const steps = Math.round((o.T ?? 3) / world.timestep);
let prevN = null;
for (let s = 1; s <= steps; s++) {
  world.step(undefined, hooks);
  let found = false, n = 0, normal = null;
  let ln1 = null, flipped = null;
  world.contactPair(cyl, floor, (m, fl) => { found = true; flipped = fl; n = m.numContacts(); const nn = m.normal(); normal = [nn.x, nn.y, nn.z].map((v) => +(fl ? -v : v).toFixed(3)); const l = m.localNormal1(); ln1 = [l.x, l.y, l.z]; });
  if (n === 0 && cyl.intersectsShape(floor.shape, floor.translation(), floor.rotation())) {
    misses++;
    const t = body.translation(), q = body.rotation();
    const c = cyl.contactCollider(floor, pred);
    const fresh = freshManifold(t, q);
    if (fresh.n > 0) freshHas++;
    if (printed++ < maxPrint)
      console.log(JSON.stringify({ step: s, prevStepPoints: prevN, pos: [t.x, t.y, t.z].map((v) => +(v / k).toFixed(4)), v: [body.linvel().x, body.linvel().y].map((v) => +v.toFixed(2)), found, flipped, localNormal1: ln1, cachedNormal: normal, contactQuery: c ? { dist: +c.distance.toFixed(4), n1: [c.normal1.x, c.normal1.y, c.normal1.z].map((v) => +v.toFixed(3)) } : null, freshManifold: fresh }));
  }
  prevN = n;
}
console.log(`misses(empty manifold while overlapping)=${misses} of ${steps} steps; fresh manifold at same pose had points in ${freshHas}`);
process.exit(0);
