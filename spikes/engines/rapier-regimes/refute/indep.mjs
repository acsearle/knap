// Independent re-check of the headline results of ../README.md, written without ../lib.mjs.
//   node indep.mjs [sink|clamp|roll|b4a|stack|all]
// Units: everything printed is REAL (studs, real s). A regime is {s, dt, g, cnf, it}: s = simulated
// seconds per real second; Rapier gravity g (studs/sim s^2); dt in sim s.
import RAPIER from '@dimforge/rapier3d-compat';
await RAPIER.init();
const G = 1226.25, S = Math.sqrt(G / 9.81);
const R0 = { name: 'R0', s: 1, dt: 1 / 480, g: G, cnf: null, it: 30 };
const R1 = { ...R0, name: 'R1', cnf: 335 };
const R2 = { name: 'R2', s: S, dt: S / 480, g: 9.81, cnf: null, it: 30 };
const which = process.argv[2] ?? 'all';

function mk(r, grav = true) {
  const w = new RAPIER.World({ x: 0, y: grav ? -r.g : 0, z: 0 });
  w.timestep = r.dt;
  w.numSolverIterations = r.it;
  if (r.cnf) w.integrationParameters.contact_natural_frequency = r.cnf;
  return w;
}
const nsteps = (r, T) => Math.round((T * r.s) / r.dt);
const dyn = (w, x, y, z) => w.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setCanSleep(false).setTranslation(x, y, z));
const fr = (d) => d.setFriction(0.5).setRestitution(0);

// ---- 1. resting sink against a fixed floor, a kinematic floor, and a dynamic beam ----
if (which === 'sink' || which === 'all') {
  for (const r of [R0, R1, R2]) {
    for (const floorKind of ['fixed', 'kinematic']) {
      const w = mk(r);
      const fb = w.createRigidBody(floorKind === 'fixed' ? RAPIER.RigidBodyDesc.fixed() : RAPIER.RigidBodyDesc.kinematicPositionBased());
      w.createCollider(fr(RAPIER.ColliderDesc.cuboid(20, 0.5, 20)).setTranslation(0, -0.5, 0), fb);
      const b = dyn(w, 0, 0.46, 0);
      w.createCollider(fr(RAPIER.ColliderDesc.cuboid(0.46, 0.46, 0.46)), b);
      for (let i = 0; i < nsteps(r, 2); i++) w.step();
      const f = floorKind === 'fixed' || r.cnf == null ? (floorKind === 'fixed' ? 60 : 30) : r.cnf;
      const pred = r.g / (2 * Math.PI * f) ** 2;
      console.log(`sink ${r.name} ${floorKind} floor: ${(0.46 - b.translation().y).toExponential(3)} studs   g/(2pi f)^2 with f=${f}: ${pred.toExponential(3)}`);
      w.free();
    }
  }
}

// ---- 2. speed clamps ----
if (which === 'clamp' || which === 'all') {
  for (const r of [R0, R2, { ...R0, name: 'R0 lengthUnit 10' }]) {
    const w = mk(r, false);
    if (r.name.includes('lengthUnit')) w.lengthUnit = 10;
    const b = w.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setCanSleep(false).setLinvel(1e5 / r.s, 0, 0));
    w.createCollider(RAPIER.ColliderDesc.cuboid(0.46, 0.46, 0.46), b);
    const c = w.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setCanSleep(false).setTranslation(50, 0, 0).setAngvel({ x: 0, y: 1e4 / r.s, z: 0 }));
    w.createCollider(RAPIER.ColliderDesc.cuboid(0.46, 0.46, 0.46), c);
    w.step(); w.step();
    // free fall reading in real units after 1 real s from rest
    const w2 = mk(r);
    if (r.name.includes('lengthUnit')) w2.lengthUnit = 10;
    const d = dyn(w2, 0, 0, 0);
    w2.createCollider(RAPIER.ColliderDesc.cuboid(0.46, 0.46, 0.46), d);
    for (let i = 0; i < nsteps(r, 1); i++) w2.step();
    console.log(`clamp ${r.name}: linear ${(b.linvel().x * r.s).toFixed(1)} studs/s, angular ${(c.angvel().y * r.s).toFixed(1)} rad/s, fall speed at 1 s ${(-d.linvel().y * r.s).toFixed(1)} (g t = 1226.3)`);
    w.free(); w2.free();
  }
}

// ---- 3. wheel r 1 on its side on a fixed box floor 40x1x40 (B5a), at rest and at 1 stud/s ----
function roll(r, { v0 = 0, floor = 'box', shape = 'cyl', y0 = 1, T = 5 } = {}) {
  const w = mk(r);
  const fb = w.createRigidBody(RAPIER.RigidBodyDesc.fixed());
  if (floor === 'box') w.createCollider(fr(RAPIER.ColliderDesc.cuboid(20, 0.5, 20)).setTranslation(0, -0.5, 0), fb);
  else if (floor === 'bigbox') w.createCollider(fr(RAPIER.ColliderDesc.cuboid(20, 0.5, 100)).setTranslation(0, -0.5, 0), fb);
  else w.createCollider(fr(new RAPIER.ColliderDesc(new RAPIER.HalfSpace({ x: 0, y: 1, z: 0 }))), fb);
  // axis along X: rotate cylinder Y axis to X by -90 deg about Z (exact quaternion)
  const h = Math.SQRT1_2;
  const b = w.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setCanSleep(false).setTranslation(0, y0, 0)
    .setRotation({ w: h, x: 0, y: 0, z: -h }).setLinvel(0, 0, v0 / r.s).setAngvel({ x: v0 / r.s, y: 0, z: 0 }));
  let desc;
  if (shape === 'cyl') desc = RAPIER.ColliderDesc.cylinder(0.46, 1);
  else if (shape === 'roundcyl') desc = RAPIER.ColliderDesc.roundCylinder(0.41, 0.95, 0.05);
  else if (shape === 'hull64') {
    const p = [];
    for (let i = 0; i < 64; i++) { const a = (2 * Math.PI * i) / 64; for (const y of [-0.46, 0.46]) p.push(Math.cos(a), y, Math.sin(a)); }
    desc = RAPIER.ColliderDesc.convexHull(new Float32Array(p));
  }
  w.createCollider(fr(desc), b);
  const out = [];
  for (const t of [1, 2, 3, 4, 5].filter((x) => x <= T)) {
    while (Math.round(w.timestep) >= 0 && out.length < 99) { break; }
    const n = nsteps(r, t) - nsteps(r, t - 1);
    for (let i = 0; i < n; i++) w.step();
    out.push((b.linvel().z * r.s).toFixed(2));
  }
  const res = `${out.join(' ')}  (z ${b.translation().z.toFixed(1)}, y ${b.translation().y.toFixed(4)})`;
  w.free();
  return res;
}
if (which === 'roll' || which === 'all') {
  for (const r of [R0, R2]) {
    console.log(`roll ${r.name} box, rest       vz at 1..5 s:`, roll(r));
    console.log(`roll ${r.name} box, 1 stud/s   vz at 1..5 s:`, roll(r, { v0: 1 }));
    console.log(`roll ${r.name} plane, rest     vz at 1..5 s:`, roll(r, { floor: 'plane' }));
    console.log(`roll ${r.name} plane, 1 stud/s vz at 1..5 s:`, roll(r, { floor: 'plane', v0: 1 }));
  }
  // documented-shape alternatives at R0
  console.log('roll R0 box, rest, roundCylinder  :', roll(R0, { shape: 'roundcyl' }));
  console.log('roll R0 box, 1/s,  roundCylinder  :', roll(R0, { shape: 'roundcyl', v0: 1 }));
  console.log('roll R0 box, rest, 64-gon hull    :', roll(R0, { shape: 'hull64' }));
  console.log('roll R0 box, rest, start 0.01 high:', roll(R0, { y0: 1.01 }));
}

// ---- 4. B4a: small box on the top face of a fixed 32-gon prism ----
function b4a(r, { kind = 'hull', x = 0, z = 0, y0 = 0.05 } = {}) {
  const w = mk(r);
  const fb = w.createRigidBody(RAPIER.RigidBodyDesc.fixed());
  const pts = [], idx = [];
  for (let i = 0; i < 32; i++) { const a = (2 * Math.PI * (i + 0.5)) / 32; pts.push(0.5 * Math.cos(a), -0.5, 0.5 * Math.sin(a), 0.5 * Math.cos(a), 0, 0.5 * Math.sin(a)); }
  let d;
  if (kind === 'hull') d = RAPIER.ColliderDesc.convexHull(new Float32Array(pts));
  else if (kind === 'roundhull') d = RAPIER.ColliderDesc.roundConvexHull(new Float32Array(pts), 0.01);
  else if (kind === 'cyl') d = RAPIER.ColliderDesc.cylinder(0.25, 0.5).setTranslation(0, -0.25, 0);
  else if (kind === 'trimesh') {
    // closed prism trimesh: top fan, bottom fan, sides
    const v = [...pts, 0, 0, 0, 0, -0.5, 0];
    const top = 64, bot = 65;
    for (let i = 0; i < 32; i++) {
      const j = (i + 1) % 32;
      idx.push(top, 2 * j + 1, 2 * i + 1, bot, 2 * i, 2 * j, 2 * i, 2 * i + 1, 2 * j, 2 * j, 2 * i + 1, 2 * j + 1);
    }
    d = RAPIER.ColliderDesc.trimesh(new Float32Array(v), new Uint32Array(idx));
  }
  const fc = w.createCollider(fr(d), fb);
  const b = dyn(w, x, y0, z);
  const bc = w.createCollider(fr(RAPIER.ColliderDesc.cuboid(0.08, 0.05, 0.08)), b);
  for (let i = 0; i < nsteps(r, 2); i++) w.step();
  let nc = 0; w.contactPair(fc, bc, (m) => { nc += m.numSolverContacts(); });
  const q = b.rotation();
  const tilt = (2 * Math.acos(Math.min(1, Math.hypot(q.w, q.y))) * 180) / Math.PI;
  const res = `y ${b.translation().y.toFixed(4)} tilt ${tilt.toFixed(1)} deg, ${nc} contacts${b.translation().y < -0.2 ? '  FELL' : ''}`;
  w.free();
  return res;
}
if (which === 'b4a' || which === 'all') {
  for (const r of [R0, R2]) for (const kind of ['hull', 'roundhull', 'cyl', 'trimesh']) for (const y0 of [0.05, 0.06]) {
    console.log(`b4a ${r.name} ${kind} start y ${y0}: centre ${b4a(r, { kind, y0 })} | off(0.33,0.04) ${b4a(r, { kind, y0, x: 0.33, z: 0.04 })}`);
  }
}

// ---- 5. B1c: stack of 5 cubes ----
if (which === 'stack' || which === 'all') {
  for (const r of [R0, { ...R0, name: 'R0 it4', it: 4 }, { ...R0, name: 'R0 it8', it: 8 }, R1, R2]) {
    for (const gap of [0, 0.01]) {
      const w = mk(r);
      const fb = w.createRigidBody(RAPIER.RigidBodyDesc.fixed());
      w.createCollider(fr(RAPIER.ColliderDesc.cuboid(20, 0.5, 20)).setTranslation(0, -0.5, 0), fb);
      const bs = [];
      for (let i = 0; i < 5; i++) { const b = dyn(w, 0, 0.46 + (0.92 + gap) * i, 0); w.createCollider(fr(RAPIER.ColliderDesc.cuboid(0.46, 0.46, 0.46)), b); bs.push(b); }
      let fellAt = null;
      for (let i = 1; i <= nsteps(r, 3); i++) { w.step(); const t = bs[4].translation(); if (fellAt === null && Math.hypot(t.x, t.z) > 0.2) fellAt = i / nsteps(r, 1); }
      const t = bs[4].translation();
      console.log(`stack ${r.name} gap ${gap}: top y ${t.y.toFixed(4)} (ideal 4.14), offset ${Math.hypot(t.x, t.z).toFixed(3)}, leaves 0.2 at ${fellAt?.toFixed(2) ?? '-'} s`);
      w.free();
    }
  }
}
process.exit(0);
