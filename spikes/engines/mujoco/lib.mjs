// Shared helpers for the MuJoCo battery. MuJoCo is Z-up; "up" below is +Z (knap's +Y).
// All geometry is written in studs and converted to metres with u = 0.008 * lam.
// lam = 1: real SI size (8 mm parts). lam = 125: "1 m bricks" with g scaled by 125 so the
// motion is the same in real seconds (g/L unchanged).
import load from '@mujoco/mujoco';

export const mj = await load();
export const STUD = 0.008;
export const G_STUDS = 1226.25;
export const HC = 0.46; // half cube
// 0.3 g per stud cube -> 0.3e-3 kg / (0.008 m)^3
export const DENSITY = 0.3e-3 / STUD ** 3; // 585.9 kg/m^3

/**
 * Settings presets.
 *  default: MuJoCo's own defaults (Euler, Newton, pyramidal cone, solref 0.02 1,
 *           solimp 0.9 0.95 0.001) with only the timestep set to knap's 1/480 s.
 *  tuned:   implicitfast, elliptic cone, impratio 10, contact solref 0.005 1 (about 2.4 dt,
 *           the documented lower bound is 2 dt), solimp width scaled to the part size.
 */
export function preset(name, lam = 1, extra = {}) {
  const base = {
    lam,
    dt: 1 / 480,
    integrator: 'Euler',
    cone: 'pyramidal',
    impratio: 1,
    solver: 'Newton',
    iterations: 100,
    solref: '0.02 1',
    solimp: '0.9 0.95 0.001',
    flags: '',
    gscale: lam,
  };
  if (name === 'tuned') {
    Object.assign(base, {
      integrator: 'implicitfast',
      cone: 'elliptic',
      impratio: 10,
      solref: '0.005 1',
      solimp: `0.95 0.99 ${1e-4 * lam}`,
    });
  }
  return Object.assign(base, extra);
}

export function header(p, { gravity = true, extraOption = '' } = {}) {
  const g = gravity ? -9.81 * p.gscale : 0;
  return `<mujoco>
  <compiler angle="radian" autolimits="true"/>
  <option timestep="${p.dt}" integrator="${p.integrator}" cone="${p.cone}" impratio="${p.impratio}"
          solver="${p.solver}" iterations="${p.iterations}" gravity="0 0 ${g}" ${extraOption} ${p.extraOption ?? ""}>
    <flag energy="enable" ${p.flags}/>
  </option>
  <default>
    <geom friction="0.5 0.005 0.0001" solref="${p.solref}" solimp="${p.solimp}" density="${DENSITY}"/>
    <joint damping="0" armature="0"/>
  </default>`;
}

export const f = (x) => Number(x.toPrecision(9));
export function v3(p, a, b, c) {
  const u = STUD * p.lam;
  return `${f(a * u)} ${f(b * u)} ${f(c * u)}`;
}

/** n-gon prism vertices, axis along local Z, radius r, length len (studs). */
export function prismVerts(p, n, r, len) {
  const out = [];
  for (const z of [-len / 2, len / 2]) {
    for (let i = 0; i < n; i++) {
      const a = (2 * Math.PI * i) / n;
      out.push(v3(p, r * Math.cos(a), r * Math.sin(a), z));
    }
  }
  return out.join('  ');
}

export function compile(xml) {
  const t0 = performance.now();
  const m = mj.MjModel.from_xml_string(xml);
  const t1 = performance.now();
  const d = new mj.MjData(m);
  mj.mj_forward(m, d);
  return { m, d, compileMs: t1 - t0 };
}

export function bodyId(m, name) {
  return mj.mj_name2id(m, mj.mjtObj.mjOBJ_BODY.value, name);
}
export function jointId(m, name) {
  return mj.mj_name2id(m, mj.mjtObj.mjOBJ_JOINT.value, name);
}

/** World position of body b in studs. */
export function pos(p, d, b) {
  const u = STUD * p.lam;
  const x = d.xpos;
  return [x[3 * b] / u, x[3 * b + 1] / u, x[3 * b + 2] / u];
}
/** Tilt of body's local Z (or given local axis column) from world Z, rad. */
export function tiltZ(d, b, col = 2) {
  const R = d.xmat; // row-major 3x3 per body
  const zz = R[9 * b + 6 + col];
  return Math.acos(Math.min(1, Math.abs(zz)));
}
/** cvel-free linear velocity of a free body: use qvel of its free joint (world frame). */
export function freeVel(p, m, d, b) {
  const j = m.body_jntadr[b];
  const a = m.jnt_dofadr[j];
  const u = STUD * p.lam;
  const v = d.qvel;
  return { lin: [v[a] / u, v[a + 1] / u, v[a + 2] / u], ang: [v[a + 3], v[a + 4], v[a + 5]] };
}
export const norm = (a) => Math.hypot(...a);

/** Total energy in joules (pot + kin) as computed by MuJoCo. */
export function energy(m, d) {
  mj.mj_energyPos(m, d);
  mj.mj_energyVel(m, d);
  return d.energy[0] + d.energy[1];
}

export function step(m, d, n = 1) {
  for (let i = 0; i < n; i++) mj.mj_step(m, d);
}

/** Deepest contact penetration in studs (positive = overlap) and count. */
export function contacts(p, d) {
  const u = STUD * p.lam;
  const n = d.ncon;
  let deepest = 0;
  if (n > 0) {
    const c = d.contact;
    for (let i = 0; i < n; i++) {
      const ci = c.get(i);
      deepest = Math.max(deepest, -ci.dist / u);
      ci.delete?.();
    }
    c.delete();
  }
  return { n, deepest };
}

export function pad(s, n) {
  s = String(s);
  return s.length >= n ? s : s + ' '.repeat(n - s.length);
}
