// B9 hinge extras on a beam-7 pendulum (pivot at end hole, COM 3 studs out, axis world Y).
// Run: node b9_hinge_extras.mjs
import { mj, preset, header, v3, compile, step, STUD, HC } from './lib.mjs';

const P = preset('default', 1, { integrator: 'implicitfast' });
const u = STUD;
function pend(jointAttrs = '', extra = '', q0 = 0) {
  const xml = `${header(P)}<worldbody><body name="l"><joint name="h" type="hinge" axis="0 1 0" ${jointAttrs}/>
    <geom type="box" size="${v3(P, 3.5, HC, HC)}" pos="${v3(P, 3, 0, 0)}" contype="0" conaffinity="0"/></body></worldbody>${extra}</mujoco>`;
  const r = compile(xml);
  r.d.qpos[0] = q0;
  mj.mj_forward(r.m, r.d);
  return r;
}
// gravity torque at horizontal
const { m: m0 } = pend();
const tauG = m0.body_mass[1] * 9.81 * 3 * u;
console.log(`mass ${(m0.body_mass[1] * 1e3).toFixed(3)} g, gravity torque at horizontal ${tauG.toExponential(3)} N m`);

// 1. joint friction (frictionloss = constant Coulomb torque), from horizontal at rest.
//    Note: +q about +Y rotates +X toward -Z, so gravity drives q positive.
for (const k of [1.2, 1.05, 0.9]) {
  const { m, d } = pend(`frictionloss="${k * tauG}"`);
  step(m, d, 4800);
  console.log(`frictionloss ${k} x tauG: q after 10 s = ${d.qpos[0].toExponential(3)} rad, qdot ${d.qvel[0].toExponential(2)}`);
}
// frictionloss + slow creep check under default solref (frictionloss is a soft constraint too)
// 2. motor with max torque: position servo (kp) with forcerange, holding horizontal.
for (const k of [2, 0.5]) {
  const act = `<actuator><position joint="h" kp="${50 * tauG}" kv="${2 * tauG}" forcerange="${-k * tauG} ${k * tauG}"/></actuator>`;
  const { m, d } = pend('', act);
  d.ctrl[0] = 0;
  step(m, d, 4800);
  console.log(`position servo forcerange ${k} x tauG: q after 10 s = ${d.qpos[0].toExponential(3)} rad, actuator force ${(d.actuator_force[0] / tauG).toFixed(3)} tauG`);
}
{
  const act = `<actuator><velocity joint="h" kv="${10 * tauG}" forcerange="${-3 * tauG} ${3 * tauG}"/></actuator>`;
  const { m, d } = pend('', act, -Math.PI / 2);
  d.ctrl[0] = 2;
  step(m, d, 960);
  console.log(`velocity motor target 2 rad/s, max 3 tauG: qdot after 2 s = ${d.qvel[0].toFixed(4)}, force ${(d.actuator_force[0] / tauG).toFixed(3)} tauG`);
}
// 3. angle limits
{
  const { m, d } = pend(`range="-0.5 0.5"`);
  let maxQ = 0;
  for (let i = 0; i < 4800; i++) { step(m, d); maxQ = Math.max(maxQ, d.qpos[0]); }
  console.log(`range [-0.5, 0.5]: max q ${maxQ.toFixed(4)} (overshoot ${(maxQ - 0.5).toExponential(2)} rad), end q ${d.qpos[0].toFixed(5)}`);
}
// 4. one-way limit (ratchet): no native joint type. Emulation: limited joint whose range is
//    rewritten every step (model fields are live, no recompile): lower = max(lower, q - slack).
{
  const { m, d } = pend(`range="-10 1e6"`, '', 0);
  const jr = m.jnt_range;
  let lower = -1e-3, minAfter = Infinity, q = [];
  for (let i = 0; i < 4800; i++) {
    // push forward (+q) for 0.5 s, then backward hard
    const t = d.time;
    d.qfrc_applied[0] = t < 0.5 ? 0 : -3 * tauG;
    lower = Math.max(lower, d.qpos[0] - 1e-3);
    jr[0] = lower;
    step(m, d);
    if (t > 0.5) minAfter = Math.min(minAfter, d.qpos[0] - lower);
  }
  console.log(`ratchet emulation (rewrite m.jnt_range each step): range written=${m.jnt_range[0].toFixed(4)}, worst back-slip below the pawl ${(-minAfter).toExponential(2)} rad, end q ${d.qpos[0].toFixed(4)}`);
}
// 5. reaction force: hanging at rest, force from parent via mj_rnePostConstraint -> cfrc_int
{
  const { m, d } = pend('', '', Math.PI / 2);
  step(m, d, 480);
  mj.mj_rnePostConstraint(m, d);
  const c = d.cfrc_int; // per body: [torque(3), force(3)] in COM-based frame
  const F = [c[6 + 3], c[6 + 4], c[6 + 5]];
  console.log(`hanging reaction force via cfrc_int: (${F.map((x) => (x / (m.body_mass[1] * 9.81)).toFixed(4)).join(', ')}) x m g`);
  const s = `<sensor><jointlimitfrc joint="h"/></sensor>`;
  console.log('sensors available: jointlimitfrc, jointactuatorfrc, force/torque sites, qfrc_constraint, efc_force, mj_contactForce');
}
process.exit(0);
