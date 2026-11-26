// Independent check of the articulation single/triple pendulum energy gain. Beam 7 links (7 x 0.92 x 0.92 studs),
// hinge 3 studs from the link centre, axis Z, released horizontal. Energy measured two ways:
//  (a) peak COM height reached by link 1 each swing (no KE computation needed: release height is y = 0)
//  (b) KE from joint velocities via the articulation's own link velocities + PE.
// node artic.mjs [variant...]  variants: pgs, noroot (no shape on root), cfm0, pos32, armature, sub4
import { PX, phys, S, g, T, V, aa, scene, shape, ms } from './px.mjs';
const vars = new Set(process.argv.slice(2));
const dens = 0.3e-3 / (S * S * S);
const qz = aa([0, 1, 0], -Math.PI / 2); // joint X -> world Z
const NOQ = vars.has('noq'); // twist axis X stays world X; beams lie along Z instead
const Q = NOQ ? [0,0,0,1] : qz; const at = (d) => NOQ ? [0, 0, d * S] : [d * S, 0, 0];
function run(n) {
  const s = scene({ pgs: vars.has('pgs'), flags: vars.has('extf') ? ['eENABLE_EXTERNAL_FORCES_EVERY_ITERATION_TGS'] : [] });
  const art = phys.createArticulationReducedCoordinate();
  art.setArticulationFlag(PX.PxArticulationFlagEnum.eFIX_BASE, true);
  art.setArticulationFlag(PX.PxArticulationFlagEnum.eDISABLE_SELF_COLLISION, true);
  art.setSolverIterationCounts(vars.has('pos32') ? 32 : (vars.has('pos1') ? 1 : 4), vars.has('vel4') ? 4 : (vars.has('vel0') ? 0 : 1));
  art.setSleepThreshold(0); art.setStabilizationThreshold(0);
  const root = art.createLink(null, T());
  if (!vars.has('noroot')) { root.attachShape(shape(new PX.PxBoxGeometry(0.1 * S, 0.1 * S, 0.1 * S), { group: 2, mask: 0 })); PX.PxRigidBodyExt.prototype.updateMassAndInertia(root, dens); }
  const links = []; let prev = root;
  for (let i = 0; i < n; i++) {
    const b = art.createLink(prev, T(at(3 + 6 * i)));
    b.attachShape(shape(NOQ ? new PX.PxBoxGeometry(0.46 * S, 0.46 * S, 3.5 * S) : new PX.PxBoxGeometry(3.5 * S, 0.46 * S, 0.46 * S), { group: 2, mask: 0 }));
    PX.PxRigidBodyExt.prototype.updateMassAndInertia(b, dens);
    b.setLinearDamping(0); b.setAngularDamping(0); b.setMaxLinearVelocity(1e6); b.setMaxAngularVelocity(1e6);
    if (vars.has('cfm0')) b.setCfmScale(0);
    const j = b.getInboundJoint();
    j.setJointType(PX.PxArticulationJointTypeEnum.eREVOLUTE);
    j.setMotion(PX.PxArticulationAxisEnum.eTWIST, PX.PxArticulationMotionEnum.eFREE);
    j.setParentPose(T(at(prev === root ? 0 : 3), Q)); j.setChildPose(T(at(-3), Q));
    if (vars.has('unwrapped')) j.setJointType(PX.PxArticulationJointTypeEnum.eREVOLUTE_UNWRAPPED);
    j.setMaxJointVelocity(PX.PxArticulationAxisEnum.eTWIST, 1e6);
    if (vars.has('armature')) j.setArmature(PX.PxArticulationAxisEnum.eTWIST, 1e-9);
    links.push(b); prev = b;
  }
  s.addArticulation(art);
  const m = links[0].getMass();
  const sub = vars.has('sub4') ? 4 : (vars.has('dt60') ? 0.125 : 1), dt = 1 / (480 * sub);
  const PE = () => links.reduce((a, b) => a + b.getMass() * g * b.getGlobalPose().p.y, 0);
  const KE = () => links.reduce((a, b) => {
    const v = b.getLinearVelocity(), w = b.getAngularVelocity(), I = b.getMassSpaceInertiaTensor(); // links are boxes: principal frame = body frame, w about Z
    return a + 0.5 * b.getMass() * (v.x ** 2 + v.y ** 2 + v.z ** 2) + 0.5 * I.z * w.z ** 2 + 0.5 * I.x * w.x ** 2 + 0.5 * I.y * w.y ** 2;
  }, 0);
  const swing = links.reduce((a, b, i) => a + b.getMass() * g * (3 + 6 * i) * S, 0);
  const E0 = KE() + PE();
  let peak = -1e9, peaks = [], prevVy = 0, minY = 1e9; const recE = [];
  const t0 = ms();
  for (let i = 1; i <= 4800 * sub; i++) {
    s.step(dt);
    const y = links[0].getGlobalPose().p.y / S; minY = Math.min(minY, y);
    const vy = links[0].getLinearVelocity().y;
    if (prevVy > 0 && vy <= 0) peaks.push(y.toFixed(3)); // top of a swing (link 1 COM)
    prevVy = vy;
    if (i % (960 * sub) === 0) recE.push((100 * (KE() + PE() - E0) / swing).toFixed(2));
  }
  console.log(`n=${n} [${[...vars].join(',') || 'default TGS 4/1'}] link1 COM peak heights (studs, release = 0): ${peaks.slice(0, 8).join(' ')} ... ${peaks.slice(-3).join(' ')}; lowest ${minY.toFixed(3)}; dE every 2 s (% swing) ${recE.join(' ')}; root mass ${root.getMass().toExponential(2)} kg vs link ${m.toExponential(2)}; ${((ms() - t0) / 10).toFixed(1)} ms/sim s`);
}
run(1); run(3);
process.exit(0);
