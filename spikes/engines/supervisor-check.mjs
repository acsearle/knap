// Supervisor's own check of the two Rapier results that matter, independent of the agents' helpers.
//   node spikes/engines/supervisor-check.mjs
// Scene: a 0.92-stud cube resting on a floor; a cube on a loose beam 9 lying on that floor;
// free fall speed after 1.5 s. Real units throughout (studs, seconds).
import RAPIER from '@dimforge/rapier3d-compat';
await RAPIER.init();
const G = 1226.25, H = 0.46, STEPS = 480;

function run(name, { s = 1, cnf = null, lengthUnit = 1, kinematicFloor = false }) {
  // s: simulated seconds per real second (time scaling). Gravity in sim units = G / s^2.
  const world = new RAPIER.World({ x: 0, y: -G / (s * s), z: 0 });
  world.timestep = s / STEPS;
  world.numSolverIterations = 30;
  const ip = world.integrationParameters;
  ip.maxCcdSubsteps = 0;
  if (lengthUnit !== 1) {
    ip.lengthUnit = lengthUnit;
    ip.normalizedAllowedLinearError = ip.normalizedAllowedLinearError / lengthUnit;
    ip.normalizedPredictionDistance = ip.normalizedPredictionDistance / lengthUnit;
  }
  if (cnf) ip.contact_natural_frequency = cnf;
  const fd = kinematicFloor ? RAPIER.RigidBodyDesc.kinematicPositionBased() : RAPIER.RigidBodyDesc.fixed();
  const floor = world.createRigidBody(fd);
  world.createCollider(RAPIER.ColliderDesc.cuboid(40, 1, 40).setTranslation(0, -1, 0), floor);
  const dyn = (x, y, z, hx, hy, hz) => {
    const b = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(x, y, z).setCanSleep(false));
    world.createCollider(RAPIER.ColliderDesc.cuboid(hx, hy, hz), b);
    return b;
  };
  const cube = dyn(-10, H, 0, H, H, H); // on the floor
  const beam = dyn(10, H, 0, 4.5, H, H); // loose beam on the floor
  const top = dyn(10, 3 * H, 0, H, H, H); // cube on the loose beam
  const faller = dyn(0, 5000, 30, H, H, H); // free fall, far above
  for (let i = 0; i < STEPS * 2; i++) {
    world.step();
    if (i === STEPS * 1.5 - 1) run.fall = -faller.linvel().y * s;
  }
  const f = (v) => v.toExponential(2);
  console.log(
    name.padEnd(46),
    'cube sink', f(H - cube.translation().y),
    '| cube into loose beam', f(2 * H - (top.translation().y - beam.translation().y)),
    '| beam into floor', f(H - beam.translation().y),
    '| fall speed at 1.5 s', run.fall.toFixed(0), '(true 1839)',
  );
}
const S = Math.sqrt(G / 9.81);
run('R0 current', {});
run('R1 contact frequency 335', { cnf: 335 });
run('R2 time-scaled x11.18 (g = 9.81)', { s: S });
run('RX no time scaling: kinematic floor, cnf 671, LU 11.18', { cnf: 671, lengthUnit: S, kinematicFloor: true });
run('RX without the kinematic floor', { cnf: 671, lengthUnit: S });
process.exit(0);
