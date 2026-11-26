// B10 cost (triple pendulum + 20-cube pile), determinism, and compile cost of a 20-body model.
// Run: node b10_cost_compile.mjs
import { mj, preset, header, v3, compile, step, prismVerts, HC } from './lib.mjs';

function sceneXml(p) {
  let chain = '', close = '';
  for (let i = 0; i < 3; i++) {
    chain += `<body pos="${i ? v3(p, 6, 0, 0) : v3(p, 0, 0, 30)}"><joint type="hinge" axis="0 1 0"/><geom type="box" size="${v3(p, 3.5, HC, HC)}" pos="${v3(p, 3, 0, 0)}" contype="0" conaffinity="0"/>`;
    close += '</body>';
  }
  let pile = '';
  let k = 0;
  for (let z = 0; z < 2; z++) for (let y = 0; y < 2; y++) for (let x = 0; x < 5; x++)
    pile += `<body name="c${k++}" pos="${v3(p, -20 + x * 0.95 + 0.02 * z, y * 0.95, HC + z * 0.93)}"><freejoint/><geom type="box" size="${v3(p, HC, HC, HC)}"/></body>`;
  return `${header(p)}<worldbody><geom type="plane" size="0 0 1"/>${chain}${close}${pile}</worldbody></mujoco>`;
}

function cost(p, T = 5) {
  const { m, d } = compile(sceneXml(p));
  step(m, d, 48); // warm-up
  const t0 = performance.now();
  step(m, d, Math.round(T / p.dt));
  const ms = (performance.now() - t0) / T;
  return { ms, perStep: ms / (1 / p.dt), qpos: Float64Array.from(d.qpos), ncon: d.ncon };
}

for (const [label, p] of [
  ['default (Euler)', preset('default', 1)],
  ['tuned (implicitfast, elliptic, impratio 10)', preset('tuned', 1)],
  ['tuned + RK4', preset('tuned', 1, { integrator: 'RK4' })],
  ['tuned + noslip 20', preset('tuned', 1, { extraOption: 'noslip_iterations="20"' })],
  ['tuned + RK4 + noslip 20', preset('tuned', 1, { integrator: 'RK4', extraOption: 'noslip_iterations="20"' })],
]) {
  const pp = p;
  const a = cost(pp), b = cost(pp);
  const same = a.qpos.every((x, i) => Object.is(x, b.qpos[i]));
  console.log(`B10 ${label}: ${a.ms.toFixed(1)} ms per simulated s (${(a.perStep * 1000).toFixed(1)} us per 1/480 step), ncon ${a.ncon}, bit-identical rerun: ${same}`);
}

// Compile cost of a 20-body model: 20 hinged links in a chain + floor.
function model20(p, meshes) {
  let assets = '', open = '', close = '';
  for (let i = 0; i < 20; i++) {
    if (meshes) assets += `<mesh name="m${i}" vertex="${prismVerts(p, 16 + (i % 3), 0.5, 0.92 + 0.001 * i)}"/>`;
    const g = meshes ? `<geom type="mesh" mesh="m${i}"/>` : `<geom type="box" size="${v3(p, 1.5, HC, HC)}" pos="${v3(p, 1, 0, 0)}"/><geom type="cylinder" size="${v3(p, 0.5, 0.46, 0)}"/>`;
    open += `<body pos="${i ? v3(p, 2, 0, 0) : v3(p, 0, 0, 10)}"><joint type="hinge" axis="0 1 0" range="-1 1"/>${g}`;
    close += '</body>';
  }
  return `${header(p)}<asset>${assets}</asset><worldbody><geom type="plane" size="0 0 1"/>${open}${close}</worldbody>
  <actuator><motor joint="${''}" /></actuator></mujoco>`.replace('<actuator><motor joint="" /></actuator>', '');
}
const p = preset('tuned', 1);
for (const meshes of [false, true]) {
  const xml = model20(p, meshes);
  const times = [], specTimes = [];
  for (let r = 0; r < 10; r++) {
    const t0 = performance.now();
    const m = mj.MjModel.from_xml_string(xml);
    const d = new mj.MjData(m);
    times.push(performance.now() - t0);
    d.delete(); m.delete();
    const t1 = performance.now();
    const spec = mj.parseXMLString(xml);
    const t2 = performance.now();
    const m2 = mj.mj_compile(spec);
    const t3 = performance.now();
    specTimes.push([t2 - t1, t3 - t2]);
    m2.delete(); spec.delete();
  }
  times.sort((a, b) => a - b);
  const med = (a) => a.sort((x, y) => x - y)[a.length >> 1];
  console.log(`compile 20-body ${meshes ? '(20 distinct 16-18-gon meshes)' : '(boxes+cylinders)'}: from_xml_string+MjData median ${med(times).toFixed(2)} ms (min ${times[0].toFixed(2)}); parseXMLString ${med(specTimes.map((s) => s[0])).toFixed(2)} ms + mj_compile(spec) ${med(specTimes.map((s) => s[1])).toFixed(2)} ms`);
}
process.exit(0);
