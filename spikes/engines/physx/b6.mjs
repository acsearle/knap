// B6a single pendulum, B6b triple pendulum: beam-7 links, hinge holes at +-3 (6 apart), axis Z, released horizontal, 10 s.
// node b6.mjs joint|artic     (env POS, VEL, SUB)
import * as P from './lib.mjs';
const { PX, TL, physics } = P;
const mode = process.argv[2] ?? 'joint';
console.log('B6', mode, P.settingsLine());
const H = 0.46, qz = P.qAxisAngle([0, 1, 0], -Math.PI / 2); // joint frame: twist axis X -> world Z
const beam = () => P.boxGeom(3.5, H, H);
function energy(links) {
  let E = 0; for (const b of links) E += P.kinetic(b) + P.massG(b) * 1226.25 * P.comWorld(b)[1]; return E;
}
function run(n) {
  const s = P.makeScene();
  const links = [], anchors = []; // anchors: [bodyA|null, localA, bodyB, localB]
  let art;
  if (mode === 'joint') {
    let prev = null;
    for (let i = 0; i < n; i++) {
      const b = P.addDynamic(s, [{ geom: beam() }], [3 + 6 * i, 0, 0], undefined, P.bodyOpts());
      const la = prev ? [3, 0, 0] : [0, 0, 0];
      const j = TL.RevoluteJointCreate(physics, prev, P.tf(la.map((x) => x * P.L), qz), b, P.tf([-3 * P.L, 0, 0], qz));
      anchors.push([prev, la, b, [-3, 0, 0]]);
      links.push(b); prev = b;
    }
  } else {
    art = physics.createArticulationReducedCoordinate();
    art.setArticulationFlag(PX.PxArticulationFlagEnum.eFIX_BASE, true);
    art.setSolverIterationCounts(P.SET.pos, P.SET.vel);
    art.setSleepThreshold(0); art.setStabilizationThreshold(0);
    const root = art.createLink(null, P.tf([0, 0, 0])); root.setLinearDamping(0); root.setAngularDamping(0);
    root.attachShape(P.shapeOf(P.boxGeom(0.1, 0.1, 0.1))); PX.PxRigidBodyExt.prototype.updateMassAndInertia(root, P.DENS);
    let prev = root;
    for (let i = 0; i < n; i++) {
      const b = art.createLink(prev, P.tf([(3 + 6 * i) * P.L, 0, 0]));
      b.attachShape(P.shapeOf(beam()));
      PX.PxRigidBodyExt.prototype.updateMassAndInertia(b, P.DENS);
      const j = b.getInboundJoint();
      j.setJointType(PX.PxArticulationJointTypeEnum.eREVOLUTE);
      j.setMotion(PX.PxArticulationAxisEnum.eTWIST, PX.PxArticulationMotionEnum.eFREE);
      const la = prev === root ? [0, 0, 0] : [3, 0, 0];
      j.setParentPose(P.tf(la.map((x) => x * P.L), qz)); j.setChildPose(P.tf([-3 * P.L, 0, 0], qz));
      anchors.push([prev === root ? null : prev, la, b, [-3, 0, 0]]);
      links.push(b); prev = b;
      b.setLinearDamping(0); b.setAngularDamping(0); // links default to 0.05 / 0.05
      if (process.env.CFM) b.setCfmScale(+process.env.CFM); // default 0.025
      if (process.env.CLAMP !== "default") { b.setMaxAngularVelocity(1e4); b.setMaxLinearVelocity(1e7); } // link defaults: 100 units/s and 50 rad/s
      j.setMaxJointVelocity(PX.PxArticulationAxisEnum.eTWIST, 1e4); // default 100 rad/s
    }
    // links must not collide with each other / root: articulation self-collision off
    art.setArticulationFlag(PX.PxArticulationFlagEnum.eDISABLE_SELF_COLLISION, true);
    s.addArticulation(art);
  }
  // joint-connected beams overlap at the shared hole: disable collision between jointed pairs (PhysX joints do this by default: eCOLLISION_ENABLED is off)
  for (const b of links) P.setGroup(b, 2); // links never collide with each other (a planar pendulum test, not a contact test)
  const m = links.reduce((a, b) => a + P.massG(b), 0);
  const E0 = energy(links);
  const swing = n === 1 ? P.massG(links[0]) * 1226.25 * 3 : links.reduce((a, b, i) => a + P.massG(b) * 1226.25 * (3 + 6 * i), 0);
  let sepMax = 0; const rec = [];
  const t0 = P.ms();
  P.stepReal(s, 10, (t, i) => {
    for (const [A, la, B, lb] of anchors) {
      const pa = A ? P.worldPoint(A, la) : la; const pb = P.worldPoint(B, lb);
      sepMax = Math.max(sepMax, Math.hypot(pa[0] - pb[0], pa[1] - pb[1], pa[2] - pb[2]));
    }
    if (process.env.TRACE && n === 3 && i % 24 === 0 && t < 1.6) console.log(`  t ${t.toFixed(2)} dE ${P.f(100 * (energy(links) - E0) / swing, 2)}% w ${links.map((b) => P.f(P.av(b)[2], 1)).join(",")}`);
    if (i % (480 * P.SET.sub * 2) === 0) rec.push(P.f(100 * (energy(links) - E0) / swing, 2));
  });
  const cost = (P.ms() - t0) / 10;
  console.log(`B6${n === 1 ? 'a' : 'b'} ${mode} n=${n}: mass ${P.f(m, 3)} g; dE every 2 s (% of swing energy ${P.f(swing, 1)}): ${rec.join(' ')}; worst hinge separation ${P.f(sepMax)} studs; cost ${P.f(cost, 1)} ms per simulated s (incl. JS readout each step)`);
}
run(1); run(3);
process.exit(0);
