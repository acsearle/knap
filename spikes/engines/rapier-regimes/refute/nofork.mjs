// Can R2's gains be had at R0's units with setters the JS build already has (no fork, no time
// conversion layer)? Recipe "RX": real units, g 1226.25, dt 1/480, plus
//   contact_natural_frequency = f (dynamic-dynamic AND dynamic-kinematic contacts),
//   world-anchored parts as kinematicPositionBased bodies instead of fixed (Rapier treats only
//     bodies without a solver velocity -- fixed -- as "static"; see contact_with_coulomb_friction.rs:370),
//   lengthUnit = L (lifts the 400*L speed clamp and the 3*L corrective-velocity cap, as R2 does),
//   normalizedAllowedLinearError / normalizedPredictionDistance divided by L (absolute tolerances kept).
//   node nofork.mjs
import RAPIER from '@dimforge/rapier3d-compat';
await RAPIER.init();
const G = 1226.25, S = Math.sqrt(G / 9.81);
const CFG = process.argv[2] === "ablate" ? [
  { name: "R0+kin", s: 1, dt: 1 / 480, g: G, kin: true },
  { name: "R0+L11.18", s: 1, dt: 1 / 480, g: G, L: S },
  { name: "R0+f671", s: 1, dt: 1 / 480, g: G, cnf: 671 },
  { name: "R0+kin+f671", s: 1, dt: 1 / 480, g: G, cnf: 671, kin: true },
  { name: "R2+kin", s: S, dt: S / 480, g: 9.81, kin: true },
] : [
  { name: 'R0', s: 1, dt: 1 / 480, g: G },
  { name: 'R2 (time x11.18)', s: S, dt: S / 480, g: 9.81 },
  { name: 'RX f335 L11.18 kin', s: 1, dt: 1 / 480, g: G, cnf: 335, L: S, kin: true },
  { name: 'RX f671 L11.18 kin', s: 1, dt: 1 / 480, g: G, cnf: 671, L: S, kin: true },
];
function mk(r, grav = true) {
  const w = new RAPIER.World({ x: 0, y: grav ? -r.g : 0, z: 0 });
  w.timestep = r.dt;
  w.numSolverIterations = 30;
  if (r.cnf) w.integrationParameters.contact_natural_frequency = r.cnf;
  if (r.L) {
    const e = w.integrationParameters.normalizedAllowedLinearError, p = w.integrationParameters.normalizedPredictionDistance;
    w.lengthUnit = r.L;
    w.integrationParameters.normalizedAllowedLinearError = e / r.L;
    w.integrationParameters.normalizedPredictionDistance = p / r.L;
  }
  return w;
}
const ground = (w, r) => w.createRigidBody(r.kin ? RAPIER.RigidBodyDesc.kinematicPositionBased() : RAPIER.RigidBodyDesc.fixed());
const N = (r, T) => Math.round((T * r.s) / r.dt);
const fr = (d) => d.setFriction(0.5).setRestitution(0);
const cube = (w, x, y, z, v = 0, s = 1, dens = 1) => {
  const b = w.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setCanSleep(false).setTranslation(x, y, z).setLinvel(0, v / s, 0));
  w.createCollider(fr(RAPIER.ColliderDesc.cuboid(0.46, 0.46, 0.46)).setDensity(dens), b);
  return b;
};
const floor = (w, r) => w.createCollider(fr(RAPIER.ColliderDesc.cuboid(20, 0.5, 20)).setTranslation(0, -0.5, 0), ground(w, r));
for (const r of CFG) {
  const o = [];
  // B1a
  { const w = mk(r); floor(w, r); const b = cube(w, 0, 0.46, 0); for (let i = 0; i < N(r, 2); i++) w.step(); o.push(`B1a sink ${(0.46 - b.translation().y).toExponential(2)}`); w.free(); }
  // B1b
  { const w = mk(r); floor(w, r);
    const beam = w.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setCanSleep(false).setTranslation(0, 0.46, 0));
    w.createCollider(fr(RAPIER.ColliderDesc.cuboid(4.5, 0.46, 0.46)), beam);
    const c = cube(w, 0, 1.38, 0); for (let i = 0; i < N(r, 2); i++) w.step();
    o.push(`B1b cube/beam ${(beam.translation().y + 0.92 - c.translation().y).toExponential(2)} beam/floor ${(0.46 - beam.translation().y).toExponential(2)}`); w.free(); }
  // B1c (top 10x)
  { const w = mk(r); floor(w, r); const bs = []; for (let i = 0; i < 5; i++) bs.push(cube(w, 0, 0.46 + 0.92 * i, 0, 0, 1, i === 4 ? 10 : 1));
    for (let i = 0; i < N(r, 3); i++) w.step(); const t = bs[4].translation();
    o.push(`B1c(10x) compr ${(4.14 - t.y).toFixed(3)} off ${Math.hypot(t.x, t.z).toFixed(3)}`); w.free(); }
  // B2 300 studs/s impact
  { const w = mk(r); floor(w, r); const b = cube(w, 0, 0.46 + 0.5, 0, -Math.sqrt(300 ** 2 - 2 * G * 0.5), r.s);
    let deep = 0, reb = 0, side = 0; for (let i = 0; i < N(r, 0.3); i++) { w.step(); const v = b.linvel(); deep = Math.max(deep, 0.46 - b.translation().y); reb = Math.max(reb, v.y * r.s); side = Math.max(side, Math.hypot(v.x, v.z) * r.s); }
    o.push(`B2(300) deep ${deep.toFixed(3)} rebound ${reb.toFixed(1)} side ${side.toFixed(1)}`); w.free(); }
  // B3 fall speed at 1.5 s
  { const w = mk(r); const b = cube(w, 0, 0, 0); for (let i = 0; i < N(r, 1.5); i++) w.step(); o.push(`B3 v1.5 ${(-b.linvel().y * r.s).toFixed(0)}`); w.free(); }
  // B4a convex-hull 32-gon, centre
  { const w = mk(r); const pts = []; for (let i = 0; i < 32; i++) { const a = (2 * Math.PI * (i + 0.5)) / 32; pts.push(0.5 * Math.cos(a), -0.5, 0.5 * Math.sin(a), 0.5 * Math.cos(a), 0, 0.5 * Math.sin(a)); }
    w.createCollider(fr(RAPIER.ColliderDesc.convexHull(new Float32Array(pts))), ground(w, r));
    const b = w.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setCanSleep(false).setTranslation(0, 0.05, 0));
    w.createCollider(fr(RAPIER.ColliderDesc.cuboid(0.08, 0.05, 0.08)), b); for (let i = 0; i < N(r, 2); i++) w.step();
    o.push(`B4a box y ${b.translation().y.toFixed(3)} (rest 0.05)`); w.free(); }
  // B6a pendulum energy (hinge to the ground body)
  { const w = mk(r); const g = ground(w, r);
    const b = w.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setCanSleep(false).setTranslation(3, 0, 0).setAdditionalSolverIterations(210));
    w.createCollider(RAPIER.ColliderDesc.cuboid(3.5, 0.46, 0.46).setFriction(0), b);
    w.createImpulseJoint(RAPIER.JointData.revolute({ x: 0, y: 0, z: 0 }, { x: -3, y: 0, z: 0 }, { x: 0, y: 0, z: 1 }), g, b, true).setContactsEnabled(false);
    const E = () => { const v = b.linvel(), om = b.angvel(); return 0.5 * b.mass() * (v.x ** 2 + v.y ** 2) + 0.5 * b.principalInertia().z * om.z ** 2 * 0 + 0.5 * Math.max(b.principalInertia().x, b.principalInertia().y, b.principalInertia().z) * om.z ** 2 + b.mass() * r.g * b.translation().y; };
    const E0 = E(); const t0 = performance.now(); for (let i = 0; i < N(r, 10); i++) w.step();
    o.push(`B6a dE ${((100 * (E() - E0)) / (b.mass() * r.g * 3)).toFixed(2)}% (${((performance.now() - t0) / 10).toFixed(0)} ms/real s)`); w.free(); }
  // B5a wheel 1 stud/s on box 40x1x40
  { const w = mk(r); floor(w, r); const h = Math.SQRT1_2;
    const b = w.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setCanSleep(false).setTranslation(0, 1, -15).setRotation({ w: h, x: 0, y: 0, z: -h }).setLinvel(0, 0, 1 / r.s).setAngvel({ x: 1 / r.s, y: 0, z: 0 }));
    w.createCollider(fr(RAPIER.ColliderDesc.cylinder(0.46, 1)), b); const tr = []; for (let k = 1; k <= 3; k++) { for (let i = 0; i < N(r, 1); i++) w.step(); tr.push((b.linvel().z * r.s).toFixed(2)); }
    o.push(`B5a v 1/2/3 s ${tr.join(' ')}`); w.free(); }
  console.log(`${r.name}:\n  ` + o.join('\n  '));
}
process.exit(0);
