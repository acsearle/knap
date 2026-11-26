// Review sweep: free root — cart variants, free models without wheels, loads, energy guard, examples 60 s.
import { it } from 'vitest';
import { mkdirSync } from 'node:fs';
import { ModelBuilder, beam, buildExample, pin } from '../../src/core/examples';
import { makeCell, rotatePart, setFixRoot, setGround, setRim, validateModel } from '../../src/core/model';
import type { Model } from '../../src/core/types';
import { JOINT_FRICTION } from '../../src/physics/sim';
import type { Simulation } from '../../src/physics/sim';
import { LOGDIR, Probe, com, dist, logger, make, maxSpeed, removedCount, totalE } from './lib';
import { cart, pushVehicle, poseHash } from '../../tests/physics/wheelModels';

mkdirSync(LOGDIR, { recursive: true });
const log = logger('free');

function loads(s: Simulation): string {
  return s.jointStates().map((j) => `${j.bodyA}-${j.bodyB}:${j.loadMass.toFixed(3)}`).join(' ');
}
function masses(s: Simulation): string {
  return s.graph.bodies.map((b) => `${b.id}:${s.massInfo(b.id)?.mass.toFixed(3)}${s.isGroundSink(b.id) ? 'S' : ''}`).join(' ');
}

/** Run t seconds; report drift of every body over the last `win` seconds, energy rise, joint error, lowest point. */
async function rest(name: string, m: Model, t: number, win: number, mu = JOINT_FRICTION.realistic) {
  const s = await make(m, { jointFriction: mu });
  const P = new Probe(s, m);
  const e0 = totalE(s);
  let eMax = e0;
  let jmax = 0;
  let deep = 0;
  s.stepFixed(480 * (t - win));
  const c0 = s.graph.bodies.map((b) => (s.hasBody(b.id) ? com(s, b.id) : [0, 0, 0] as [number, number, number]));
  const q0 = s.graph.bodies.map((b) => s.bodyTransform(b.id)?.q);
  for (let i = 0; i < win * 48; i++) {
    s.stepFixed(10);
    eMax = Math.max(eMax, totalE(s));
    jmax = Math.max(jmax, s.jointError());
    deep = Math.max(deep, s.groundY! - P.lowAll());
  }
  const drift = Math.max(...s.graph.bodies.map((b, i) => (s.hasBody(b.id) ? dist(com(s, b.id), c0[i]!) : 0)));
  const rot = Math.max(...s.graph.bodies.map((b, i) => {
    const q = s.bodyTransform(b.id)?.q;
    const p = q0[i];
    if (!q || !p) return 0;
    const d = Math.abs(q[0] * p[0] + q[1] * p[1] + q[2] * p[2] + q[3] * p[3]);
    return 2 * Math.acos(Math.min(1, d));
  }));
  log(`${name} mu ${mu}: last ${win} s drift ${drift.toExponential(2)} rot ${rot.toExponential(2)} rad; Emax-E0 ${(eMax - e0).toExponential(2)}; jointErr ${jmax.toExponential(2)}; deepest ${deep.toFixed(4)}; removed ${removedCount(s)}; maxSpeed ${JSON.stringify(maxSpeed(s))}; loads ${loads(s)}; masses ${masses(s)}`);
  s.dispose();
}

it('cart variants at rest', async () => {
  await rest('5.3 cart 60 s', cart().model, 60, 30);
  await rest('5.3 cart 60 s friction off', cart().model, 60, 30, 0);
  // mixed radii: front r 1.5, rear r 2.5 (front starts 1 above the floor)
  {
    const c = cart(1.5);
    let m = c.model;
    for (const id of c.wheels.slice(2)) {
      const cell = m.parts.find((p) => p.id === id)!.cells[0]!;
      m = setRim(m, id, [cell.x, cell.y, cell.z], 2.5);
    }
    await rest('mixed radii 1.5 / 2.5 cart', m, 20, 10);
  }
  // three wheels: remove one wheel part
  {
    const c = cart(1.5);
    const m = { ...c.model, parts: c.model.parts.filter((p) => p.id !== c.wheels[0]) };
    if (validateModel(m).length) throw new Error('3-wheel invalid');
    await rest('three-wheel cart', m, 20, 10);
  }
  // upside down: rotate every part 180° about X through (3, 0, 1)
  {
    const c = cart(1.5);
    let m = c.model;
    // rotate parts one by one into a scratch model: rotate the whole set by mapping cells
    m = { ...m, parts: m.parts.map((p) => ({ ...p, cells: p.cells.map((q) => makeCell(q.x, -q.y, 2 - q.z, q.kind, q.axis, q.rim)) })) };
    if (validateModel(m).length) throw new Error('upside-down invalid ' + JSON.stringify(validateModel(m)[0]));
    await rest('upside-down cart (no-op flip in y; wheels still at the bottom)', m, 10, 5);
    // a real upside-down: wheels above the chassis: lift wheels+axles by translating the chassis down 3 and putting a post?
  }
  // free model, no wheels: a 4-bar lying flat on the floor (holes along Y), smooth pins along Y
  {
    const b = new ModelBuilder();
    const g = b.add(beam([0, 0, 0], [4, 0, 0], 1));
    const l1 = b.add(beam([0, 1, 0], [0, 1, 3], 1));
    const l2 = b.add(beam([4, 1, 0], [4, 1, 3], 1));
    const cpl = b.add(beam([0, 2, 3], [4, 2, 3], 1));
    void l1; void l2; void cpl;
    b.add(pin([0, 0, 0], [0, 1, 0], 1));
    b.add(pin([4, 0, 0], [4, 1, 0], 1));
    b.add(pin([0, 1, 3], [0, 2, 3], 1));
    b.add(pin([4, 1, 3], [4, 2, 3], 1));
    const m = setFixRoot(setGround(b.root(g).build(), true), false);
    await rest('free 4-bar lying on the floor', m, 20, 10);
    await rest('free 4-bar lying on the floor', m, 20, 10, 0);
    // push it
    const s = await make(m);
    for (const bd of s.graph.bodies) s.setBodyVelocity(bd.id, [20, 0, 0]);
    s.stepFixed(480 * 5);
    log(`free 4-bar pushed at 20 units/s: after 5 s maxSpeed ${JSON.stringify(maxSpeed(s))} jointErr ${s.jointError().toExponential(2)} removed ${removedCount(s)} loads ${loads(s)}`);
    s.dispose();
  }
  // free root whose root part is a single pin: two beams joined by a smooth pin, the pin is the root
  {
    const b = new ModelBuilder();
    const a = b.add(beam([0, 0, 0], [4, 0, 0]));
    const c2 = b.add(beam([4, 0, 1], [8, 0, 1]));
    const p = b.add(pin([4, 0, 0], [4, 0, 1]));
    void a; void c2;
    const m = setFixRoot(setGround(b.root(p).build(), true), false);
    const s = await make(m);
    log(`root = single pin, free: bodies ${s.graph.bodies.length} fixed ${s.graph.bodies.filter((x) => x.fixed).length} joints ${s.graph.joints.length} loads ${loads(s)}`);
    s.dispose();
    await rest('root = single pin, free, beams on the floor', m, 10, 5);
    const mf = setFixRoot(m, true);
    const s2 = await make(mf);
    log(`root = single pin, FIXED: bodies ${s2.graph.bodies.map((x) => `${x.id}[${x.partIds}]${x.fixed ? 'F' : ''}`).join(' ')}`);
    s2.dispose();
  }
}, 3600_000);

it('cart: pendulum on top (Cart example) loads; thrown cart energy; determinism; coast', async () => {
  {
    const m = buildExample('cart');
    const s = await make(m);
    log(`Cart example loads ${loads(s)} masses ${masses(s)}`);
    s.dispose();
  }
  // thrown: up 30 units/s, sideways 40, spinning, friction off: total energy never above the start
  for (const mu of [0, 0.2]) {
    const c = cart(1.5);
    const s = await make(c.model, { jointFriction: mu });
    for (const b of s.graph.bodies) s.setBodyVelocity(b.id, [40, 30, 5], [1, 0.5, -2]);
    const e0 = totalE(s);
    let eMax = e0;
    let jmax = 0;
    const P = new Probe(s, c.model);
    let deep = 0;
    for (let i = 0; i < 480 * 20; i++) {
      s.stepFixed(1);
      if (i % 4 === 0) {
        eMax = Math.max(eMax, totalE(s));
        jmax = Math.max(jmax, s.jointError());
        deep = Math.max(deep, s.groundY! - P.lowAll());
      }
    }
    log(`thrown cart mu ${mu}: E0 ${e0.toFixed(0)} Emax-E0 ${(eMax - e0).toExponential(2)}, jointErr max ${jmax.toExponential(2)}, deepest ${deep.toFixed(3)}, end maxSpeed ${JSON.stringify(maxSpeed(s))} removed ${removedCount(s)} guardRemoved ${s.guardRemoved.toExponential(2)}`);
    s.dispose();
  }
  // determinism: cart example 5 s twice; §5.3 cart pushed twice
  for (const name of ['example', 'pushed']) {
    const h: string[] = [];
    for (let k = 0; k < 2; k++) {
      const c = cart(1.5);
      const m = name === 'example' ? buildExample('cart') : c.model;
      const s = await make(m);
      if (name === 'pushed') pushVehicle(s, 40, c.wheels.map((id) => s.bodyOf(id)!), 1.46);
      s.stepFixed(480 * 5);
      h.push(poseHash(s));
      s.dispose();
    }
    log(`determinism ${name}: ${h.join(' ')} ${h[0] === h[1] ? 'same' : 'DIFFERENT'}`);
  }
}, 3600_000);

it('examples 60 s at each friction level', async () => {
  for (const name of ['crank-wheel', 'cart'])
    for (const mu of [0, JOINT_FRICTION.low, JOINT_FRICTION.realistic]) {
      const m = buildExample(name);
      const s = await make(m, { jointFriction: mu });
      const e0 = totalE(s);
      let eMax = e0;
      let jmax = 0;
      let lastMove = 0;
      let prev = s.graph.bodies.map((b) => com(s, b.id));
      for (let t = 1; t <= 60; t++) {
        for (let i = 0; i < 48; i++) {
          s.stepFixed(10);
          eMax = Math.max(eMax, totalE(s));
          jmax = Math.max(jmax, s.jointError());
        }
        const now = s.graph.bodies.map((b) => (s.hasBody(b.id) ? com(s, b.id) : prev[b.id]!));
        const mv = Math.max(...now.map((c, i) => dist(c, prev[i]!)));
        if (mv > 1e-3) lastMove = t;
        prev = now;
      }
      const e = totalE(s);
      log(`EXAMPLE ${name} mu ${mu}: last second with > 1e-3 motion: ${lastMove} s; Emax-E0 ${(eMax - e0).toExponential(2)} (E0 ${e0.toFixed(0)}, E60 ${e.toFixed(0)}); jointErr ${jmax.toExponential(2)}; removed ${removedCount(s)}; maxSpeed@60 ${JSON.stringify(maxSpeed(s))}; guardRemoved ${s.guardRemoved.toExponential(2)}`);
      s.dispose();
    }
}, 3600_000);
