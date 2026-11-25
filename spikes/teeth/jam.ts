// Task 3: liftarms jammed into spinning gears, and a gear spinning against a liftarm's flat side.
// Raw Rapier (the project's energy guard is NOT applied), so any energy gain is Rapier's own.
//   sh spikes/teeth/build.sh jam
import { RAPIER, DT, G, HC, PIVOT_MU, R_BORE, angleZ, energy, fixedBody, frictionMotor, gearColliderDescs, gearSpec, jointedBody, makeWorld, pawlColliderDescs, revoluteZ, velocityMotor, tipR, rootR, fmt, G_PART } from './lib';
import type { GearColliders, GearSpec } from './lib';
import { prismShape } from '../../src/physics/shapes';

await RAPIER.init();

function freeArm(w: any, at: [number, number, number], alpha: number, holes: number): any {
  const rb = w.createRigidBody(
    RAPIER.RigidBodyDesc.dynamic()
      .setCanSleep(false)
      .setTranslation(...at)
      .setRotation({ x: 0, y: 0, z: Math.sin(alpha / 2), w: Math.cos(alpha / 2) })
      .setSoftCcdPrediction(400 * DT * 1.25),
  );
  const sh = prismShape([0, 0, 0], 2, HC, HC, 16, 0, holes - 1) as any;
  w.createCollider(RAPIER.ColliderDesc.convexHull(new Float32Array(sh.points.flat()))!.setCollisionGroups(G_PART).setDensity(1).setFriction(0.4).setRestitution(0.1), rb);
  return rb;
}

interface Run {
  name: string;
  maxRise: number; // max over t of (E(t) − min_{t'≤t} E(t')) / K0
  riseAbs: number;
  tRise: number;
  tStop: number; // first time the gear (bodies[0]) is below 0.5 rad/s
  e0: number;
  eEnd: number;
  maxOmega: number;
  maxV: number;
  nan: boolean;
  note: string;
}

function run(name: string, setup: (w: any) => { bodies: any[]; check?: () => string; driven?: boolean }, seconds: number): Run {
  const w = makeWorld();
  const s = setup(w);
  const E = () => {
    const e = energy(s.bodies);
    return e.K + e.U;
  };
  // potential energy reference: relative to start
  const e0 = E();
  const k0 = energy(s.bodies).K;
  let emin = e0;
  let maxRise = 0, riseAbs = 0, tRise = 0, tStop = NaN;
  let maxOmega = 0, maxV = 0;
  let nan = false;
  const n = Math.round(seconds / DT);
  for (let i = 0; i < n; i++) {
    w.step();
    const e = E();
    if (!Number.isFinite(e)) {
      nan = true;
      break;
    }
    emin = Math.min(emin, e);
    if (e - emin > riseAbs) {
      riseAbs = e - emin;
      tRise = (i + 1) * DT;
    }
    maxRise = riseAbs / Math.max(k0, 1e-9);
    if (Number.isNaN(tStop) && Math.abs(s.bodies[0].angvel().z) < 0.5) tStop = (i + 1) * DT;
    for (const b of s.bodies) {
      const av = b.angvel();
      const lv = b.linvel();
      maxOmega = Math.max(maxOmega, Math.hypot(av.x, av.y, av.z));
      maxV = Math.max(maxV, Math.hypot(lv.x, lv.y, lv.z));
    }
  }
  const r = { name, maxRise, riseAbs, tRise, tStop, e0: k0, eEnd: E() - e0 + k0, maxOmega, maxV, nan, note: s.check ? s.check() : '' };
  w.free();
  return r;
}

const out: Run[] = [];
for (const kind of ['teeth', 'cylinder'] as GearColliders[])
  for (const [set, r] of [['fine', 1.5], ['coarse', 1.5], ['fine', 0.5]] as ['fine' | 'coarse', number][]) {
    const g: GearSpec = gearSpec(r, set);
    if (kind === 'cylinder' && set === 'coarse') continue;
    const tag = `${kind === 'teeth' ? g.name : `cylinder r${r}`}`;
    const tr = kind === 'teeth' ? tipR(g) : tipR(g);
    // (i) free 5-hole liftarm dropped edge-on into a gear spinning at 60 rad/s (gear axle frictionless)
    out.push(
      run(`${tag}: free 5-hole arm dropped onto gear spinning 60 rad/s`, (w) => {
        const f = fixedBody(w);
        const gb = jointedBody(w, [0, 0, 0], 0, gearColliderDescs(g, kind));
        revoluteZ(w, f, gb, [0, 0, 0]);
        gb.setAngvel({ x: 0, y: 0, z: 60 }, true);
        const arm = freeArm(w, [-0.3, tr + HC + 0.6, 0], -1.2, 5); // steep, end-first
        return {
          bodies: [gb, arm],
          check: () => {
            const t = arm.translation();
            return `arm ends at (${fmt(t.x)}, ${fmt(t.y)}); fell clear: ${t.y < -5}`;
          },
        };
      }, 0.6),
    );
    // (ii) pivoted 4-hole arm released horizontal, swinging its end into a gear spinning at 60 rad/s
    out.push(
      run(`${tag}: pivoted arm swings into gear spinning 60 rad/s`, (w) => {
        const f = fixedBody(w);
        const gb = jointedBody(w, [0, 0, 0], 0, gearColliderDescs(g, kind));
        revoluteZ(w, f, gb, [0, 0, 0]);
        gb.setAngvel({ x: 0, y: 0, z: 60 }, true);
        const py = Math.ceil(tr + HC + 0.6);
        const arm = jointedBody(w, [-3, py, 0], 0, pawlColliderDescs('end', 3));
        const ja = revoluteZ(w, f, arm, [-3, py, 0]);
        frictionMotor(w, ja, PIVOT_MU * arm.mass() * G * R_BORE);
        return {
          bodies: [gb, arm],
          check: () => {
            const a = angleZ(arm);
            const e = { x: -3 + 3 * Math.cos(a), y: py + 3 * Math.sin(a) };
            const d = Math.hypot(e.x, e.y);
            return `arm end at r=${fmt(d)} from gear centre (root ${fmt(rootR(g))}, tip ${fmt(tr)}; ≥ ${fmt(tr + HC)} = resting outside)`;
          },
        };
      }, 3),
    );
    // (iii) motor-driven gear (30 rad/s, torque limit 50·m_arm·g·u) grinding against a pivoted arm resting on it
    out.push(
      run(`${tag}: driven gear 30 rad/s grinding a pivoted arm (motor adds energy)`, (w) => {
        const f = fixedBody(w);
        const gb = jointedBody(w, [0, 0, 0], 0, gearColliderDescs(g, kind));
        const jg = revoluteZ(w, f, gb, [0, 0, 0]);
        const py = Math.ceil(tr + HC + 0.6);
        const arm = jointedBody(w, [-3, py, 0], 0, pawlColliderDescs('end', 3));
        const ja = revoluteZ(w, f, arm, [-3, py, 0]);
        frictionMotor(w, ja, PIVOT_MU * arm.mass() * G * R_BORE);
        velocityMotor(w, jg, 30, 50 * arm.mass() * G);
        return {
          bodies: [gb, arm],
          check: () => {
            const a = angleZ(arm);
            const e = { x: -3 + 3 * Math.cos(a), y: py + 3 * Math.sin(a) };
            return `gear ω ${fmt(gb.angvel().z)} rad/s, arm end r=${fmt(Math.hypot(e.x, e.y))} (≥ ${fmt(tr + HC - 0.05)} ok)`;
          },
        };
      }, 3),
    );
    // (iv) gear spinning 60 rad/s under the straight flank of a pivoted 5-hole arm lying across its top
    out.push(
      run(`${tag}: gear spinning 60 rad/s under an arm's flat side`, (w) => {
        const f = fixedBody(w);
        const gb = jointedBody(w, [0, 0, 0], 0, gearColliderDescs(g, kind));
        revoluteZ(w, f, gb, [0, 0, 0]);
        gb.setAngvel({ x: 0, y: 0, z: 60 }, true);
        // pivot at (−2, y) on the integer grid; arm tilted down until its flank touches the gear top
        const py = Math.ceil(tr + HC);
        // centreline at distance tr + HC + 0.003 from the gear centre: |2 sin a + py cos a| = that
        let lo = -1.5, hi = 0;
        for (let k = 0; k < 60; k++) {
          const m = (lo + hi) / 2;
          if (2 * Math.sin(m) + py * Math.cos(m) > tr + HC + 0.003) hi = m;
          else lo = m;
        }
        const a0 = hi;
        const arm = jointedBody(w, [-2, py, 0], a0, pawlColliderDescs('end', 4));
        const ja = revoluteZ(w, f, arm, [-2, py, 0]);
        frictionMotor(w, ja, PIVOT_MU * arm.mass() * G * R_BORE);
        return { bodies: [gb, arm], check: () => `gear ω end ${fmt(gb.angvel().z)} rad/s, arm angle ${fmt(angleZ(arm))} (start ${fmt(a0)})` };
      }, 3),
    );
  }
for (const r of out)
  console.log(`${r.name.padEnd(78)} K0 ${fmt(r.e0)}  max rise ${fmt(r.riseAbs)} (${fmt(100 * r.maxRise)} % K0) at ${fmt(r.tRise)} s  gear<0.5rad/s at ${fmt(r.tStop)} s  max ω ${fmt(r.maxOmega)}  max v ${fmt(r.maxV)}  ${r.nan ? 'NaN!' : ''} ${r.note}`);
