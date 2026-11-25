// Sanity checks: hull construction, mass vs analytic, motor sign, collision-group layout, flat rest.
import { RAPIER, gearSpec, gearColliderDescs, gearPolys2D, makeWorld, fixedBody, jointedBody, revoluteZ, velocityMotor, angleZ, HC, DT, fmt, G_PART, pawlColliderDescs } from './lib';

function area(p: [number, number][]) {
  let a = 0;
  for (let i = 0; i < p.length; i++) {
    const [x0, y0] = p[i]!;
    const [x1, y1] = p[(i + 1) % p.length]!;
    a += x0 * y1 - x1 * y0;
  }
  return a / 2;
}

await RAPIER.init();
console.log('== hulls and mass (density 1, thickness 0.92) ==');
for (const set of ['fine', 'coarse'] as const)
  for (const prof of ['trap', 'saw'] as const)
    for (const r of [0.5, 1, 1.5, 2.5]) {
      const g = gearSpec(r, set, prof);
      const w = makeWorld();
      const rb = w.createRigidBody(RAPIER.RigidBodyDesc.dynamic());
      const descs = gearColliderDescs(g, 'teeth');
      for (const d of descs) w.createCollider(d, rb);
      // analytic: sum of piece volumes (pieces overlap; Rapier sums them the same way)
      const polys = gearPolys2D(g);
      const vol = polys.reduce((s, p) => s + area(p), 0) * 2 * HC;
      // collider vertex counts
      let maxV = 0;
      for (let i = 1; i < rb.numColliders() - 1; i++) maxV = Math.max(maxV, rb.collider(i).shape.vertices.length / 3);
      console.log(`${g.name.padEnd(22)} colliders ${rb.numColliders()} toothHullVerts ${maxV} mass ${fmt(rb.mass(), 5)} analytic ${fmt(vol, 5)} Izz ${fmt(rb.principalInertia().z, 4)}`);
      w.free();
    }

console.log('== motor sign ==');
{
  const g = gearSpec(1, 'fine');
  const w = makeWorld();
  const f = fixedBody(w);
  const gb = jointedBody(w, [0, 0, 0], 0, gearColliderDescs(g, 'teeth'));
  const j = revoluteZ(w, f, gb, [0, 0, 0]);
  velocityMotor(w, j, 10, 1e9);
  for (let i = 0; i < 48; i++) w.step();
  console.log(`target +10 rad/s → gear ωz ${fmt(gb.angvel().z)} angle ${fmt(angleZ(gb))} (expect +10, +1.0)`);
  w.free();
}

console.log('== collision groups: two toothed gears overlapping at mesh distance, then closer ==');
for (const dist of [2.0, 1.98, 1.9]) {
  const g = gearSpec(1, 'fine');
  const w = makeWorld();
  w.gravity = { x: 0, y: 0, z: 0 };
  const a = w.createRigidBody(RAPIER.RigidBodyDesc.fixed());
  const b = w.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(dist, 0, 0).setRotation({ x: 0, y: 0, z: Math.sin(Math.PI / 32), w: Math.cos(Math.PI / 32) }));
  // make b dynamic so contacts are computed
  const bd = w.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(dist, 0, 0));
  for (const d of gearColliderDescs(g, 'teeth')) w.createCollider(d, a);
  for (const d of gearColliderDescs(g, 'teeth')) w.createCollider(d, bd);
  w.step();
  let pairs = 0;
  let touching = 0;
  const seen = new Set<string>();
  for (let i = 0; i < a.numColliders(); i++)
    w.contactPairsWith(a.collider(i), (c2: any) => {
      pairs++;
      w.contactPair(a.collider(i), c2, (m: any) => {
        if (m.numContacts() > 0) {
          touching++;
          seen.add(`${a.collider(i).collisionGroups() >>> 16}-${c2.collisionGroups() >>> 16}`);
        }
      });
    });
  console.log(`centre distance ${dist}: contact pairs ${pairs}, with contacts ${touching}, member groups ${[...seen].join(',')}  (tip radius 1.125: teeth overlap by ${fmt(2.25 - dist)})`);
  void b;
  w.free();
}

console.log('== a pawl liftarm overlapping a gear: does it collide with teeth? ==');
{
  const g = gearSpec(1, 'fine');
  const w = makeWorld();
  w.gravity = { x: 0, y: 0, z: 0 };
  const a = w.createRigidBody(RAPIER.RigidBodyDesc.fixed());
  for (const d of gearColliderDescs(g, 'teeth')) w.createCollider(d, a);
  const p = w.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(1.5, 0, 0));
  for (const d of pawlColliderDescs('end', 2)) w.createCollider(d, p);
  w.step();
  const kinds: string[] = [];
  for (let i = 0; i < a.numColliders(); i++)
    w.contactPairsWith(a.collider(i), (c2: any) =>
      w.contactPair(a.collider(i), c2, (m: any) => {
        if (m.numContacts() > 0) kinds.push(i === 0 ? 'root' : i === a.numColliders() - 1 ? 'gearcyl' : 'tooth');
      }),
    );
  console.log(`pawl touches: ${[...new Set(kinds)].join(',')} (${kinds.length} manifolds); pawl group ${(G_PART >>> 16).toString(2)}`);
  w.free();
}

console.log('== flat rest: gear lying flat on a fixed plate, 2 s ==');
for (const kind of ['teeth', 'root', 'cylinder'] as const)
  for (const r of [0.5, 1, 1.5, 2.5]) {
    const g = gearSpec(r, 'fine');
    const w = makeWorld();
    const plate = w.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    w.createCollider(RAPIER.ColliderDesc.cuboid(10, 0.5, 10).setTranslation(0, -0.5, 0).setFriction(0.4), plate);
    // gear axis vertical: rotate +90° about X so local Z → world −Y
    const s = Math.SQRT1_2;
    const rb = w.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(0.13, HC + 0.01, 0.07).setRotation({ x: s, y: 0, z: 0, w: s }).setSoftCcdPrediction(1));
    for (const d of gearColliderDescs(g, kind, false)) w.createCollider(d, rb);
    for (let i = 0; i < 960; i++) w.step();
    const q = rb.rotation();
    // tilt of the gear axis from vertical: local Z in world
    const zx = 2 * (q.x * q.z + q.w * q.y);
    const zy = 2 * (q.y * q.z - q.w * q.x);
    const zz = 1 - 2 * (q.x * q.x + q.y * q.y);
    const tilt = (Math.acos(Math.min(1, Math.abs(zy))) * 180) / Math.PI;
    console.log(`${kind} r${r}: centre y ${fmt(rb.translation().y, 5)} (expect ${HC}), axis tilt ${fmt(tilt)}°, |v| ${fmt(Math.hypot(rb.linvel().x, rb.linvel().y, rb.linvel().z))}`);
    void zx;
    void zz;
    w.free();
  }
void DT;
