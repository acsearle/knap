// Experiment 2: a free cart on the ground, built with the project's own Simulation (sim.ts
// settings: 1/480 s, 240 substeps for jointed bodies, joint friction motors, energy guard, speed cap).
// Model: chassis = two 7-hole liftarms (z = 0 and z = 2, holes along Z) joined by a hole at
// (3,0,1); four axles = frictionPin (welded in the chassis) + pin (revolute in the wheel hub);
// four wheel hubs = single pin-hole parts at (0|6, 0, −1|3). A dummy root part far away is the
// fixed body the kinematic analysis insists on, so the cart itself has NO path to a fixed body.
// After construction each wheel body gets a hybrid wheel collider (native cylinder in the ROUND
// group for the ground, bevelled 32-gon in the HULL group for parts) through the Simulation's
// private world; every collider Simulation made is put in the PARTS group. Ground: half-space at
// y = −r (the wheels' bottom), plus a cuboid platform for the step test.
//
// Usage: node spikes/wheels/out/cart.mjs [test] [r]
//   test ∈ incline | coast | rest | step | guard | cost   (default all)
import { Simulation, initPhysics } from '../../src/physics/sim';
import { addPart, emptyModel, makeCell, setRoot } from '../../src/core/model';
import { beam } from '../../src/core/examples';
import type { Model } from '../../src/core/types';
import { DT, G, GRP, RAPIER, fmt, now, poseHash, stats, wheelColliders, worldInertia } from './lib';
import type { RigidBody, World } from '@dimforge/rapier3d-compat';

const TEST = process.argv[2] ?? 'all';
const R = Number(process.argv[3] ?? 1.5);

interface Cart {
  sim: Simulation;
  world: World;
  chassis: RigidBody;
  wheels: RigidBody[];
  all: RigidBody[];
  M: number;
  sumI: number;
  r: number;
}

function cartModel(): { model: Model; chassisId: number; wheelIds: number[] } {
  let m = emptyModel();
  const root = addPart(m, [makeCell(-50, 40, 0, 'pinHole', 2)]);
  m = root.model;
  const ch = addPart(m, [...beam([0, 0, 0], [6, 0, 0]), makeCell(3, 0, 1, 'pinHole', 2), ...beam([0, 0, 2], [6, 0, 2])]);
  m = ch.model;
  const wheelIds: number[] = [];
  for (const x of [0, 6])
    for (const [zc, zw] of [[0, -1], [2, 3]] as const) {
      m = addPart(m, [makeCell(x, 0, zc, 'frictionPin', 2), makeCell(x, 0, zw, 'pin', 2)]).model;
      const w = addPart(m, [makeCell(x, 0, zw, 'pinHole', 2)]);
      m = w.model;
      wheelIds.push(w.partId);
    }
  m = setRoot(m, root.partId);
  return { model: m, chassisId: ch.partId, wheelIds };
}

type Priv = {
  world: World;
  bodies: { id: number; fixed: boolean; rb: RigidBody | null }[];
  joints: { mj: number }[];
  applyFriction(): void;
};

async function makeCart(opts: { r?: number; theta?: number; mu?: number; guard?: boolean; mjRule?: 'sim' | 'share'; ground?: 'half' | 'step' | 'none'; iters?: number }): Promise<Cart> {
  const r = opts.r ?? R;
  const th = ((opts.theta ?? 0) * Math.PI) / 180;
  const { model, chassisId, wheelIds } = cartModel();
  const sim = await Simulation.create(model, {
    gravity: [G * Math.sin(th), -G * Math.cos(th), 0],
    jointFriction: opts.mu ?? 0.2,
    energyGuard: opts.guard ?? true,
    solverIterations: opts.iters ?? 240,
  });
  const p = sim as unknown as Priv;
  const world = p.world;
  world.forEachCollider((c) => c.setCollisionGroups(GRP.PARTS));
  const rbOf = (part: number) => p.bodies[sim.bodyOf(part)!]!.rb!;
  const wheels = wheelIds.map(rbOf);
  for (const wb of wheels) {
    const t = wb.translation();
    // the wheel body's frame origin is its cell centre (single cell), so the hub is at local 0
    void t;
    for (const cd of wheelColliders('hyb', r)) world.createCollider(cd, wb);
  }
  const chassis = rbOf(chassisId);
  // Ground
  const g = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
  const gr = (cd: ReturnType<typeof RAPIER.ColliderDesc.cuboid>) => world.createCollider(cd.setFriction(0.4).setRestitution(0.1).setCollisionGroups(GRP.GROUND), g);
  if ((opts.ground ?? 'half') === 'half') gr(new RAPIER.ColliderDesc(new RAPIER.HalfSpace({ x: 0, y: 1, z: 0 })).setTranslation(0, -r, 0));
  if (opts.ground === 'step') {
    // platform top at y = −r for x ≤ 12, half-space 2 units lower everywhere
    gr(RAPIER.ColliderDesc.cuboid(30, 1, 20).setTranslation(12 - 30, -r - 1, 1));
    gr(new RAPIER.ColliderDesc(new RAPIER.HalfSpace({ x: 0, y: 1, z: 0 })).setTranslation(0, -r - 2, 0));
  }
  const all = p.bodies.filter((b) => !b.fixed && b.rb).map((b) => b.rb!);
  const M = all.reduce((s, b) => s + b.mass(), 0);
  const sumI = wheels.reduce((s, b) => s + worldInertia(b)[8]!, 0);
  // Joint-friction load: sim.ts's rule for a group with no path to a fixed body is the lighter
  // body's mass — computed BEFORE the wheel colliders were added, i.e. the bare hub. 'sim' redoes
  // that rule with the real wheel mass; 'share' uses what a free vehicle's axle really carries:
  // its share of everything above it, (M − Σ m_wheel)/4 (+ the wheel's own weight on the ground
  // is not carried by the axle).
  const mw = wheels[0]!.mass();
  const mj = (opts.mjRule ?? 'sim') === 'sim' ? Math.min(mw, chassis.mass()) : (M - 4 * mw) / 4;
  for (const j of p.joints) j.mj = mj;
  p.applyFriction();
  return { sim, world, chassis, wheels, all, M, sumI, r };
}

function setSpeed(c: Cart, v: number): void {
  for (const b of c.all) b.setLinvel({ x: v, y: 0, z: 0 }, true);
  for (const w of c.wheels) w.setAngvel({ x: 0, y: 0, z: -v / c.r }, true);
}

function wheelSlip(c: Cart): number {
  let s = 0;
  for (const w of c.wheels) s = Math.max(s, Math.abs(w.linvel().x + w.angvel().z * c.r));
  return s;
}

async function incline(): Promise<void> {
  console.log('## cart down an incline from rest (gravity tilted θ about Z), 1 s or until v ≥ 300');
  console.log('r\tθ°\tμ\tmj rule\tM\tΣI/r²\ta_analytic\ta_meas\trel.err\tmax slip\tchassis tilt\tguard removed / KE\tms/sim-s');
  for (const r of [1, 1.5, 2.5])
    for (const theta of [5, 15, 30])
      for (const [mu, rule] of [[0, 'sim'], [0.2, 'sim'], [0.2, 'share']] as const) {
        const c = await makeCart({ r, theta, mu, mjRule: rule });
        const th = (theta * Math.PI) / 180;
        const tauF = mu * (c.sim.jointStates()[0]!.loadMass) * G * 0.31; // τ_f = μ m_j |g| R_BORE
        const aTh = Math.max(0, (c.M * G * Math.sin(th) - (4 * tauF) / r) / (c.M + c.sumI / (r * r)));
        const ts: number[] = [];
        const vs: number[] = [];
        let slip = 0;
        let tilt = 0;
        const t0 = now();
        let n = 0;
        for (; n < 480; n++) {
          c.sim.stepFixed(1);
          const v = c.chassis.linvel().x;
          if (n * DT > 0.1) {
            ts.push(n * DT);
            vs.push(v);
          }
          slip = Math.max(slip, wheelSlip(c));
          const q = c.chassis.rotation();
          tilt = Math.max(tilt, 2 * Math.asin(Math.min(1, Math.hypot(q.x, q.y, q.z))));
          if (v > 300) break;
        }
        const ms = (now() - t0) / ((n + 1) * DT);
        let a = NaN;
        if (ts.length > 2) {
          const mx = ts.reduce((s, x) => s + x, 0) / ts.length;
          const my = vs.reduce((s, x) => s + x, 0) / vs.length;
          let sxy = 0;
          let sxx = 0;
          ts.forEach((t, i) => {
            sxy += (t - mx) * (vs[i]! - my);
            sxx += (t - mx) ** 2;
          });
          a = sxy / sxx;
        }
        const ke = c.sim.energy().kinetic;
        console.log([r, theta, mu, rule, fmt(c.M, 2), fmt(c.sumI / (r * r), 2), fmt(aTh, 2), fmt(a, 2), fmt(a / aTh - 1, 4), fmt(slip, 3), fmt(tilt, 4), fmt(c.sim.guardRemoved / Math.max(ke, 1e-9), 4), fmt(ms, 0)].join('\t'));
        c.sim.dispose();
      }
}

async function coast(): Promise<void> {
  console.log('## coast to a stop on flat ground from v0 (joint friction only; Rapier has no rolling resistance)');
  console.log('r\tμ\tmj rule\tm_j\tv0\tdecel analytic\tstop dist analytic\tstop dist meas\tt_stop meas\tdrift after stop (5 s)\tguard removed');
  for (const r of [1.5])
    for (const [mu, rule] of [[0.2, 'sim'], [0.2, 'share'], [1, 'share'], [0, 'sim']] as const)
      for (const v0 of [20, 100]) {
        const c = await makeCart({ r, mu, mjRule: rule });
        setSpeed(c, v0);
        const mj = c.sim.jointStates()[0]!.loadMass;
        const tauF = mu * mj * G * 0.31;
        const dec = (4 * tauF) / r / (c.M + c.sumI / (r * r));
        const x0 = c.chassis.translation().x;
        let tStop = NaN;
        let xStop = NaN;
        const T = Math.min(30, mu > 0 ? (v0 / dec) * 1.5 + 1 : 3);
        for (let i = 0; i < Math.round(T / DT); i++) {
          c.sim.stepFixed(1);
          if (Number.isNaN(tStop) && Math.abs(c.chassis.linvel().x) < 0.01) {
            tStop = i * DT;
            xStop = c.chassis.translation().x;
          }
        }
        let drift = NaN;
        if (!Number.isNaN(tStop)) {
          const xa = c.chassis.translation().x;
          c.sim.stepFixed(Math.round(5 / DT));
          drift = c.chassis.translation().x - xa;
        }
        console.log([r, mu, rule, fmt(mj, 2), v0, fmt(dec, 3), fmt(dec > 0 ? (v0 * v0) / (2 * dec) : Infinity, 2), fmt(xStop - x0, 2), fmt(tStop, 3), fmt(drift, 6), fmt(c.sim.guardRemoved, 3)].join('\t'));
        c.sim.dispose();
      }
}

async function rest(): Promise<void> {
  console.log('## cart placed at rest on flat ground, 30 s (μ = 0.2)');
  console.log('r\tguard\tchassis y−0 mean\ty p-p after 1 s\t|dx| 30 s\t|dz| 30 s\tmax |v| after 1 s\tmax wheel |ω|\tms/sim-s');
  for (const r of [1, 1.5, 2.5])
    for (const guard of [true, false]) {
      const c = await makeCart({ r, guard });
      const ys: number[] = [];
      let vmax = 0;
      let wmax = 0;
      const t0 = now();
      for (let i = 0; i < Math.round(30 / DT); i++) {
        c.sim.stepFixed(1);
        if (i * DT < 1) continue;
        ys.push(c.chassis.translation().y);
        for (const b of c.all) vmax = Math.max(vmax, Math.hypot(b.linvel().x, b.linvel().y, b.linvel().z));
        for (const w of c.wheels) wmax = Math.max(wmax, Math.abs(w.angvel().z));
      }
      const ms = (now() - t0) / 30;
      const s = stats(ys);
      const t = c.chassis.translation();
      console.log([r, guard, fmt(s.mean, 5), fmt(s.max - s.min, 6), fmt(Math.abs(t.x - 3), 6), fmt(Math.abs(t.z - 1), 6), fmt(vmax, 5), fmt(wmax, 5), fmt(ms, 0)].join('\t'));
      c.sim.dispose();
    }
}

async function step(): Promise<void> {
  console.log('## drive off a 2-unit step at v0 (platform = cuboid, lower level = half-space), 3 s');
  console.log('r\tv0\tmin wheel-bottom clearance (penetration <0)\tmax chassis tilt\tfinal v\tfinal y (expect −2)\tmax joint error\tbodies removed');
  for (const r of [1, 1.5, 2.5])
    for (const v0 of [10, 40, 150]) {
      const c = await makeCart({ r, ground: 'step', mu: 0.2 });
      setSpeed(c, v0);
      let pen = 0;
      let tilt = 0;
      let jerr = 0;
      for (let i = 0; i < Math.round(3 / DT); i++) {
        c.sim.stepFixed(1);
        for (const w of c.wheels) {
          // wheel bottom vs the surface under it: platform (top −r) while the hub is at x ≤ 12,
          // lower half-space (top −r − 2) once the whole wheel is past the edge (x ≥ 12 + r)
          const t = w.translation();
          if (t.x <= 12) pen = Math.min(pen, t.y - r + r);
          else if (t.x >= 12 + r) pen = Math.min(pen, t.y - r + r + 2);
        }
        const q = c.chassis.rotation();
        tilt = Math.max(tilt, 2 * Math.asin(Math.min(1, Math.hypot(q.x, q.y, q.z))));
        jerr = Math.max(jerr, c.sim.jointError());
      }
      console.log([r, v0, fmt(pen, 4), fmt(tilt, 4), fmt(c.chassis.linvel().x, 2), fmt(c.chassis.translation().y, 4), fmt(jerr, 5), (c.sim as unknown as Priv).bodies.filter((b) => !b.fixed && !b.rb).length].join('\t'));
      c.sim.dispose();
    }
}

async function guard(): Promise<void> {
  // Long free roll on flat ground with joint friction off: energy must stay constant (no rolling
  // resistance); what does the energy guard do as the cart travels far from the origin?
  console.log('## guard: μ = 0, flat, v0 = 100 u/s for 20 s (2000 units)');
  console.log('guard\tv_end/v0\tguard removed/KE0\tE_end/E0−1\tms/sim-s');
  for (const gOn of [true, false]) {
    const c = await makeCart({ r: 1.5, mu: 0, guard: gOn });
    setSpeed(c, 100);
    const e0 = c.sim.energy();
    const t0 = now();
    c.sim.stepFixed(Math.round(20 / DT));
    const ms = (now() - t0) / 20;
    const e1 = c.sim.energy();
    console.log([gOn, fmt(c.chassis.linvel().x / 100, 5), fmt(c.sim.guardRemoved / e0.kinetic, 5), fmt((e1.kinetic + e1.potential - e0.kinetic - e0.potential) / e0.kinetic, 5), fmt(ms, 0)].join('\t'));
    c.sim.dispose();
  }
}

async function cost(): Promise<void> {
  console.log('## cost: ms of stepping per simulated second (Node, machine shared with other jobs; min of 3 × 2 s)');
  console.log('case\tms/sim-s');
  const cases: [string, () => Promise<Cart>, number][] = [
    ['cart r1.5 rolling 40 u/s, 240 it', async () => makeCart({ r: 1.5 }), 40],
    ['cart r1.5 at rest, 240 it', async () => makeCart({ r: 1.5 }), 0],
  ];
  for (const [name, mk, v] of cases) {
    let best = Infinity;
    for (let k = 0; k < 3; k++) {
      const c = await mk();
      setSpeed(c, v);
      const t0 = now();
      c.sim.stepFixed(960);
      best = Math.min(best, (now() - t0) / 2);
      c.sim.dispose();
    }
    console.log(`${name}\t${fmt(best, 1)}`);
  }
  // Same model without wheel colliders and without ground (only the joints): the cart's base cost.
  {
    const { model } = cartModel();
    let best = Infinity;
    for (let k = 0; k < 3; k++) {
      const sim = await Simulation.create(model, {});
      const t0 = now();
      sim.stepFixed(960);
      best = Math.min(best, (now() - t0) / 2);
      sim.dispose();
    }
    console.log(`same model, no wheels/ground (falls freely)\t${fmt(best, 1)}`);
  }
  // determinism
  const hash = async () => {
    const c = await makeCart({ r: 1.5, theta: 15 });
    c.sim.stepFixed(960);
    const h = poseHash(c.all);
    c.sim.dispose();
    return h;
  };
  console.log(`determinism (cart 15°, 2 s): ${await hash()} ${await hash()}`);
}

async function iters(): Promise<void> {
  // The cart is jointed, so sim.ts runs it (and everything touching it) at solverIterations = 240.
  // What do fewer substeps cost in accuracy? 15° incline (μ = 0), rest 5 s, cost.
  console.log('## cart substeps: 15° incline μ=0 accuracy, rest 5 s on flat, cost');
  console.log('iters\ta_analytic\ta_meas\trel.err\trest y p-p\trest |dx| 5 s\tmax joint err (rest)\tms/sim-s (incline)');
  for (const it of [30, 60, 120, 240]) {
    const c = await makeCart({ r: 1.5, theta: 15, mu: 0, iters: it });
    const th = (15 * Math.PI) / 180;
    const aTh = (c.M * G * Math.sin(th)) / (c.M + c.sumI / (c.r * c.r));
    const ts: number[] = [];
    const vs: number[] = [];
    const t0 = now();
    for (let n = 0; n < 480; n++) {
      c.sim.stepFixed(1);
      if (n * DT > 0.1) {
        ts.push(n * DT);
        vs.push(c.chassis.linvel().x);
      }
    }
    const ms = now() - t0;
    const mx = ts.reduce((a, b) => a + b, 0) / ts.length;
    const my = vs.reduce((a, b) => a + b, 0) / vs.length;
    let sxy = 0;
    let sxx = 0;
    ts.forEach((t, i) => {
      sxy += (t - mx) * (vs[i]! - my);
      sxx += (t - mx) ** 2;
    });
    const a = sxy / sxx;
    c.sim.dispose();
    const d = await makeCart({ r: 1.5, iters: it });
    const ys: number[] = [];
    let je = 0;
    for (let n = 0; n < Math.round(5 / DT); n++) {
      d.sim.stepFixed(1);
      if (n * DT > 1) {
        ys.push(d.chassis.translation().y);
        je = Math.max(je, d.sim.jointError());
      }
    }
    const st = stats(ys);
    console.log([it, fmt(aTh, 2), fmt(a, 2), fmt(a / aTh - 1, 4), fmt(st.max - st.min, 6), fmt(Math.abs(d.chassis.translation().x - 3), 6), fmt(je, 6), fmt(ms, 0)].join('\t'));
    d.sim.dispose();
  }
}

async function cuboidRest(): Promise<void> {
  // The single-wheel tests found a native cylinder resting on a CUBOID creeping and then running
  // away; does the cart (μ = 0.2 on its axles) show it? 10 s at rest on a cuboid ground.
  console.log('## cart at rest on a cuboid ground (not a half-space), 10 s');
  console.log('r\t|dx|\tfinal y\tmax |v|');
  for (const r of [1, 1.5, 2.5]) {
    const c = await makeCart({ r, ground: 'none' });
    const g = c.world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    c.world.createCollider(RAPIER.ColliderDesc.cuboid(30, 1, 20).setTranslation(3, -r - 1, 1).setFriction(0.4).setRestitution(0.1).setCollisionGroups(GRP.GROUND), g);
    let vmax = 0;
    for (let n = 0; n < Math.round(10 / DT); n++) {
      c.sim.stepFixed(1);
      for (const b of c.all) vmax = Math.max(vmax, Math.hypot(b.linvel().x, b.linvel().y, b.linvel().z));
    }
    console.log([r, fmt(Math.abs(c.chassis.translation().x - 3), 5), fmt(c.chassis.translation().y, 4), fmt(vmax, 4)].join('\t'));
    c.sim.dispose();
  }
}

async function main(): Promise<void> {
  await initPhysics();
  const want = (t: string) => TEST === 'all' || TEST === t;
  if (want('incline')) await incline();
  if (want('coast')) await coast();
  if (want('rest')) await rest();
  if (want('step')) await step();
  if (want('guard')) await guard();
  if (want('cost')) await cost();
  if (want('iters')) await iters();
  if (want('cuboid')) await cuboidRest();
}

void main();
