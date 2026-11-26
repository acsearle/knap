// Dynamic cases against inner step k: Rapier's own clamps, f32 spin gain, a pinned wheel spun up
// by an impulse, a fast pendulum, a fast cart, and the speed cap. Each case runs for fixed
// k = 1, 2, 4, 8 (iterations 240/k) and for the adaptive rule. SECTIONS=a,b,... selects cases.
// Run: npx vitest run --config spikes/adaptive/vitest.config.ts spikes/adaptive/dyn.test.ts
import { it } from 'vitest';
import { appendFileSync, writeFileSync } from 'node:fs';
import { ModelBuilder, beam, buildExample, pin } from '../../src/core/examples';
import { makeCell, setRim } from '../../src/core/model';
import type { Model } from '../../src/core/types';
import { cart, pushVehicle, rollRadius } from '../../tests/physics/wheelModels';
import { Simulation } from './sim';
import type { AdaptiveRule, CapRule, SimOptions } from './sim';
import type { Vec3 } from '../../src/physics/math';

const OUT = process.env.OUT ?? 'spikes/adaptive/out/dyn.jsonl';
const SECTIONS = (process.env.SECTIONS ?? 'clamp,gain,wheel,pend,cart,cap').split(',');
const KS = (process.env.KS ?? '1,2,4,8').split(',').map(Number);
export const RULE: AdaptiveRule = { levels: [1, 2, 4, 8], up: 0.08, down: 0.04, minHold: 48 };

function log(o: Record<string, unknown>): void {
  console.log(JSON.stringify(o));
  appendFileSync(OUT, JSON.stringify(o) + '\n');
}

/** Variants: fixed k, plus 'A' = adaptive. */
function variants(): { name: string; opts: SimOptions }[] {
  const v: { name: string; opts: SimOptions }[] = KS.map((k) => ({ name: `k${k}`, opts: { substeps: k } }));
  if (!process.env.NO_ADAPTIVE) v.push({ name: 'A', opts: { adaptive: RULE } });
  return v;
}

/** Fixed frame (holes along Z) with a smooth pin at the origin into a single pin hole at z = 1 carrying rim r. */
function pinnedWheel(r: number): Model {
  const b = new ModelBuilder();
  const frame = b.add(beam([-2, 0, 0], [0, 0, 0]));
  b.add(pin([0, 0, 0], [0, 0, 1]));
  const w = b.add([makeCell(0, 0, 1, 'pinHole', 2)]);
  return setRim(b.root(frame).build(), w, [0, 0, 1], r);
}

function stats(s: Simulation): Record<string, unknown> {
  return {
    kHist: Object.fromEntries(s.kHist),
    kChanges: s.kChanges,
    innerSteps: s.innerSteps,
    maxRot: +s.maxRotPerStep.toFixed(4),
    guard: +s.guardRemoved.toPrecision(4),
    msPerSimS: +(s.tTotal / s.time).toFixed(0),
    worldFrac: +(s.tWorld / s.tTotal).toFixed(3),
  };
}

function wz(s: Simulation, id: number): number {
  return s.bodyVelocity(id)!.w[2];
}

function kinetic(s: Simulation): number {
  return s.energy().kinetic;
}

function tot(s: Simulation): number {
  const e = s.energy();
  return e.kinetic + e.potential;
}

it('dyn', async () => {
  if (!process.env.APPEND) writeFileSync(OUT, '');

  // a. Rapier's clamps: one fixed step from |w| = 1000 rad/s and |v| = 1000 units/s, zero gravity.
  if (SECTIONS.includes('clamp')) {
    for (const k of [1, 2, 4, 8]) {
      for (const kind of ['loose', 'pinned']) {
        let m: Model;
        let id: number;
        if (kind === 'loose') {
          const b = new ModelBuilder();
          const f = b.add(beam([-20, 0, 0], [-18, 0, 0]));
          b.add(beam([0, 0, 0], [2, 0, 0]));
          m = b.root(f).build();
        } else m = pinnedWheel(1);
        const s = await Simulation.create(m, { substeps: k, gravity: [0, 0, 0], jointFriction: 0, energyGuard: false });
        id = 1;
        s.setBodyVelocity(id, kind === 'loose' ? [1000, 0, 0] : [0, 0, 0], [0, 0, 1000]);
        s.stepFixed(1);
        const v = s.bodyVelocity(id)!;
        log({ sec: 'clamp', k, kind, w: +Math.hypot(...v.w).toFixed(2), v: +Math.hypot(...v.v).toFixed(2), wPerInner: +(Math.hypot(...v.w) * s.innerDt).toFixed(4) });
        s.dispose();
      }
    }
  }

  // b. f32 spin gain: frictionless, no gravity, guard off. Pinned pendulum arm and pinned wheel
  //    r 2.5, |w0| 20 and 50 rad/s; K/K0 after 10 s.
  if (SECTIONS.includes('gain')) {
    for (const k of [1, 2, 4, 8]) {
      for (const [what, w0] of [['arm', 20], ['arm', 50], ['wheel2.5', 20], ['wheel2.5', 50], ['loose', 20]] as const) {
        let m: Model;
        if (what === 'arm') m = buildExample('pendulum');
        else if (what === 'loose') {
          // A free L-shaped part tumbling (no joints): rotation about a non-principal axis.
          const b = new ModelBuilder();
          const f = b.add(beam([-20, 0, 0], [-18, 0, 0]));
          b.add([...beam([0, 0, 0], [3, 0, 0]), makeCell(0, 1, 0, 'pinHole', 2), makeCell(0, 2, 0, 'pinHole', 2)]);
          m = b.root(f).build();
        } else m = pinnedWheel(2.5);
        const s = await Simulation.create(m, { substeps: k, gravity: [0, 0, 0], jointFriction: 0, energyGuard: false });
        const id = 1;
        const mi = s.massInfo(id)!;
        // Arm: pivot at the origin; set v = w × (com − pivot) so no joint impulse is needed.
        const c = mi.com;
        const w: Vec3 = what === 'loose' ? [w0 * 0.6, w0 * 0.8, 0.0] : [0, 0, w0];
        const v: Vec3 = what === 'loose' ? [0, 0, 0] : [-w0 * c[1], w0 * c[0], 0];
        s.setBodyVelocity(id, v, w);
        s.stepFixed(1);
        const K0 = kinetic(s);
        let jmax = 0;
        for (let i = 0; i < 4800; i++) {
          s.stepFixed(1);
          if (i % 16 === 0) jmax = Math.max(jmax, s.jointError());
        }
        log({ sec: 'gain', k, what, w0, KK0: +(kinetic(s) / K0).toFixed(5), jmax: +jmax.toExponential(2), msPerSimS: +(s.tTotal / s.time).toFixed(0) });
        s.dispose();
      }
    }
  }

  // c. Pinned wheel (r 2.5 and r 0.5), gravity, realistic friction, guard on: spun to w0 by an
  //    impulse, coast 3 s. Predicted constant deceleration tau_f / I.
  if (SECTIONS.includes('wheel')) {
    for (const r of [2.5, 1]) {
      for (const w0 of [50, 100, 200, 400]) {
        for (const vr of variants()) {
          const s = await Simulation.create(pinnedWheel(r), { ...vr.opts, adaptive: vr.opts.adaptive ? { ...RULE, bodies: [1] } : null });
          s.stepFixed(1);
          s.setBodyVelocity(1, [0, 0, 0], [0, 0, w0]);
          const I = s.massInfo(1)!.inertia[8]!;
          const tf = s.jointStates()[0]!.frictionTorque;
          const t0 = s.time;
          const w1s: number[] = [];
          let jmax = 0;
          let wAfter1 = 0;
          for (let i = 0; i < 480 * 3; i++) {
            s.stepFixed(1);
            if (i === 0) wAfter1 = wz(s, 1);
            if (i % 480 === 479) w1s.push(+wz(s, 1).toFixed(3));
            if (i % 8 === 0) jmax = Math.max(jmax, s.jointError());
          }
          const alphaPred = tf / I;
          const alpha = (wAfter1 - wz(s, 1)) / (s.time - t0 - s.fixedDt);
          log({ sec: 'wheel', r, w0, v: vr.name, wAfter1: +wAfter1.toFixed(2), w_1_2_3s: w1s, alpha: +alpha.toFixed(3), alphaPred: +alphaPred.toFixed(3), jmax: +jmax.toExponential(2), ...stats(s) });
          s.dispose();
        }
      }
    }
  }

  // d. Fast pendulum: the pendulum example's arm thrown at w0 about its pivot, gravity, realistic
  //    friction, guard on, 5 s. Energy (total) relative to the start, joint error.
  if (SECTIONS.includes('pend')) {
    for (const w0 of [30, 100, 200]) {
      for (const vr of variants()) {
        const s = await Simulation.create(buildExample('pendulum'), vr.opts);
        const c = s.massInfo(1)!.com;
        s.setBodyVelocity(1, [-w0 * c[1], w0 * c[0], 0], [0, 0, w0]);
        s.stepFixed(1);
        const E0 = tot(s);
        const tf = s.jointStates()[0]!.frictionTorque;
        let ang = 0;
        let prev = 0;
        let jmax = 0;
        let emaxRise = 0;
        for (let i = 0; i < 480 * 5; i++) {
          s.stepFixed(1);
          const t = s.partTransform(2)!;
          const a = 2 * Math.atan2(t.q[2], t.q[3]);
          let d = a - prev;
          while (d > Math.PI) d -= 2 * Math.PI;
          while (d < -Math.PI) d += 2 * Math.PI;
          ang += Math.abs(d);
          prev = a;
          if (i % 4 === 0) jmax = Math.max(jmax, s.jointError());
          emaxRise = Math.max(emaxRise, tot(s) - E0);
        }
        const fricWork = tf * ang; // what friction alone should take out
        log({ sec: 'pend', w0, v: vr.name, E_end_rel: +((tot(s) - E0) / E0).toFixed(4), lostByFriction_rel: +(fricWork / E0).toFixed(4), maxRise_rel: +(emaxRise / E0).toExponential(2), turns: +(ang / (2 * Math.PI)).toFixed(2), jmax: +jmax.toExponential(2), ...stats(s) });
        s.dispose();
      }
    }
  }

  // e. Fast cart: r 1 wheels pushed to 100 and 300 units/s, friction off, 3 s.
  if (SECTIONS.includes('cart')) {
    for (const v0 of [100, 300]) {
      for (const vr of variants()) {
        const c = cart(1);
        const probe = await Simulation.create(c.model, {});
        const wheels = c.wheels.map((p) => probe.bodyOf(p)!);
        const chassis = probe.bodyOf(c.chassis)!;
        probe.dispose();
        const s = await Simulation.create(c.model, { ...vr.opts, jointFriction: 0, adaptive: vr.opts.adaptive ? { ...RULE, bodies: wheels } : null });
        pushVehicle(s, v0, wheels, rollRadius(1));
        s.stepFixed(1);
        const E0 = kinetic(s);
        let jmax = 0;
        let lo = Infinity;
        let hi = -Infinity;
        let ymin = Infinity;
        let ymax = -Infinity;
        for (let i = 0; i < 480 * 3; i++) {
          s.stepFixed(1);
          const v = s.bodyVelocity(chassis)!.v[0];
          lo = Math.min(lo, v);
          hi = Math.max(hi, v);
          const y = s.massInfo(chassis)!.com[1];
          ymin = Math.min(ymin, y);
          ymax = Math.max(ymax, y);
          if (i % 8 === 0) jmax = Math.max(jmax, s.jointError());
        }
        log({ sec: 'cart', v0, v: vr.name, vMin: +lo.toFixed(2), vMax: +hi.toFixed(2), K_rel: +(kinetic(s) / E0).toFixed(4), bounceY: +(ymax - ymin).toFixed(3), jmax: +jmax.toExponential(2), ...stats(s) });
        s.dispose();
      }
    }
  }

  // g. k switching on a stuck joint: the pendulum example at realistic friction comes to rest in
  //    2–6 s; k forced to alternate 1 ↔ 8 every 7 fixed steps (worst case), with and without the
  //    stiction-target rescale, against fixed k. Rest angle and creep in the last 3 s, and on a
  //    link built hanging inside its dead zone (friction.test "stiction is exact" style).
  if (SECTIONS.includes('toggle')) {
    for (const mode of ['k1', 'k8', 'toggle', 'toggle-norescale', 'toggle2-4']) {
      const opts: SimOptions = mode === 'k8' ? { substeps: 8 } : mode === 'toggle-norescale' ? { rescaleHold: false } : {};
      const s = await Simulation.create(buildExample('pendulum'), opts);
      const angle = () => { const t = s.partTransform(2)!; return 2 * Math.atan2(t.q[2], t.q[3]); };
      let a5 = 0;
      for (let i = 0; i < 480 * 8; i++) {
        if (mode.startsWith('toggle') && i % 7 === 0) s.setK(mode === 'toggle2-4' ? ((i / 7) % 2 ? 2 : 4) : (i / 7) % 2 ? 1 : 8);
        s.stepFixed(1);
        if (i === 480 * 5) a5 = angle();
      }
      log({ sec: 'toggle', case: 'pendulum-rest', mode, restDeg: +((angle() * 180) / Math.PI).toFixed(4), creep5to8: +(angle() - a5).toExponential(2), guard: +s.guardRemoved.toPrecision(3), kChanges: s.kChanges });
      s.dispose();
    }
  }

  // h. Determinism of the adaptive rule: the fast pendulum twice; pose hash equal.
  if (SECTIONS.includes('det')) {
    const hashes: string[] = [];
    for (let rep = 0; rep < 2; rep++) {
      const s = await Simulation.create(buildExample('triple-pendulum'), { adaptive: RULE });
      const c = s.massInfo(1)!.com;
      s.setBodyVelocity(1, [-80 * c[1], 80 * c[0], 0], [0, 0, 80]);
      s.stepFixed(480 * 3);
      const { poseHash } = await import('../../tests/physics/wheelModels');
      hashes.push(poseHash(s) + ':' + s.kChanges);
      s.dispose();
    }
    log({ sec: 'det', hashes });
  }

  // i. Cap applied to one body of a jointed mechanism: triple pendulum released horizontal, cap 8
  //    rad/s on the middle link (body 2) only, modes body / group / damp; 3 s, friction off, guard on.
  if (SECTIONS.includes('cap2')) {
    for (const mode of ['none', 'body', 'group', 'damp'] as const) {
      const s = await Simulation.create(buildExample('triple-pendulum'), { jointFriction: 0, omegaCap: mode === 'none' ? null : { limit: 8, mode, bodies: [2] } });
      const E0 = tot(s);
      let jmax = 0;
      let w2 = 0;
      let wAll = 0;
      let rise = 0;
      for (let i = 0; i < 480 * 3; i++) {
        s.stepFixed(1);
        jmax = Math.max(jmax, s.jointError());
        w2 = Math.max(w2, Math.abs(wz(s, 2)));
        for (const b of [1, 2, 3]) wAll = Math.max(wAll, Math.abs(wz(s, b)));
        rise = Math.max(rise, tot(s) - E0);
      }
      log({ sec: 'cap2', mode, jmax: +jmax.toExponential(2), w2max: +w2.toFixed(2), wAllMax: +wAll.toFixed(1), E_end_rel: +((tot(s) - E0) / Math.abs(E0)).toFixed(3), maxRise: +rise.toPrecision(3), capRemoved: +s.capRemoved.toPrecision(3), capEvents: s.capEvents, guard: +s.guardRemoved.toPrecision(3) });
      s.dispose();
    }
  }

  // j. Switching with contacts: the cart (r 1.5) coasting from 100 units/s at realistic friction
  //    (wheels ≈ 68 rad/s → 0, so the adaptive rule steps down 2 → 1 while rolling), and the
  //    collision example with k forced to alternate 1 ↔ 8 every 7 fixed steps.
  if (SECTIONS.includes('contact')) {
    for (const vr of [...variants(), { name: 'toggle', opts: {} as SimOptions }]) {
      const c = cart(1.5);
      const probe = await Simulation.create(c.model, {});
      const wheels = c.wheels.map((p) => probe.bodyOf(p)!);
      const chassis = probe.bodyOf(c.chassis)!;
      probe.dispose();
      const s = await Simulation.create(c.model, { ...vr.opts, adaptive: vr.opts.adaptive ? { ...RULE, bodies: wheels } : null });
      pushVehicle(s, 100, wheels, rollRadius(1.5));
      const x0 = s.massInfo(chassis)!.com[0];
      let stopAt = -1;
      let jmax = 0;
      let ymin = Infinity;
      for (let i = 0; i < 480 * 12; i++) {
        if (vr.name === 'toggle' && i % 7 === 0) s.setK((i / 7) % 2 ? 1 : 8);
        s.stepFixed(1);
        if (stopAt < 0 && Math.abs(s.bodyVelocity(chassis)!.v[0]) < 0.01) stopAt = s.time;
        if (i % 8 === 0) jmax = Math.max(jmax, s.jointError());
        ymin = Math.min(ymin, s.massInfo(chassis)!.com[1]);
      }
      log({ sec: 'contact', case: 'cart-coast-100', v: vr.name, dist: +(s.massInfo(chassis)!.com[0] - x0).toFixed(3), stopAt: +stopAt.toFixed(3), chassisYmin: +ymin.toFixed(4), jmax: +jmax.toExponential(2), ...stats(s) });
      s.dispose();
    }
    for (const mode of ['k1', 'k8', 'toggle']) {
      const s = await Simulation.create(buildExample('collision'), mode === 'k8' ? { substeps: 8 } : {});
      let ymin = Infinity;
      for (let i = 0; i < 480 * 4; i++) {
        if (mode === 'toggle' && i % 7 === 0) s.setK((i / 7) % 2 ? 1 : 8);
        s.stepFixed(1);
        const last = s.graph.bodies.length - 1;
        if (s.hasBody(last)) ymin = Math.min(ymin, s.massInfo(last)!.com[1]);
      }
      const last = s.graph.bodies.length - 1;
      log({ sec: 'contact', case: 'collision-example', mode, looseYmin: +ymin.toFixed(4), looseYend: s.hasBody(last) ? +s.massInfo(last)!.com[1].toFixed(4) : null, guard: +s.guardRemoved.toPrecision(3), jerr: +s.jointError().toExponential(2) });
      s.dispose();
    }
  }

  // f. Speed cap on the pendulum arm released horizontal (it reaches ≈ 28 rad/s uncapped), and on a
  //    pinned wheel r 2.5 spun to 200 rad/s; modes body / group / damp; k = 1.
  if (SECTIONS.includes('cap')) {
    for (const mode of ['none', 'body', 'group', 'damp'] as const) {
      for (const limit of [5, 15]) {
        const cap: CapRule | null = mode === 'none' ? null : { limit, mode, bodies: [1] };
        // Weld test example: two beams welded hanging as one pendulum; use the plain pendulum.
        const s = await Simulation.create(buildExample('pendulum'), { omegaCap: cap });
        const E0 = tot(s);
        let tBottom = -1;
        let wmax = 0;
        let jmax = 0;
        for (let i = 0; i < 480 * 2; i++) {
          s.stepFixed(1);
          const t = s.partTransform(2)!;
          const a = 2 * Math.atan2(t.q[2], t.q[3]);
          if (tBottom < 0 && a < -Math.PI / 2 + 0.01) tBottom = s.time;
          wmax = Math.max(wmax, Math.abs(wz(s, 1)));
          if (i % 4 === 0) jmax = Math.max(jmax, s.jointError());
        }
        log({ sec: 'cap', case: 'pendulum', mode, limit, tBottom: +tBottom.toFixed(3), wmax: +wmax.toFixed(2), E_rel_2s: +((tot(s) - E0) / Math.abs(s.massInfo(1)!.mass * 1226.25 * 2)).toFixed(3), capRemoved: +s.capRemoved.toPrecision(3), capEvents: s.capEvents, jmax: +jmax.toExponential(2) });
        s.dispose();
        if (mode === 'none' && limit === 15) continue;
      }
    }
    for (const mode of ['body', 'group', 'damp'] as const) {
      const s = await Simulation.create(pinnedWheel(2.5), { omegaCap: { limit: 50, mode, bodies: [1] } });
      s.setBodyVelocity(1, [0, 0, 0], [0, 0, 200]);
      const ws: number[] = [];
      let jmax = 0;
      for (let i = 0; i < 480; i++) {
        s.stepFixed(1);
        if (i < 3 || i % 96 === 95) ws.push(+wz(s, 1).toFixed(2));
        jmax = Math.max(jmax, s.jointError());
      }
      log({ sec: 'cap', case: 'wheel200', mode, ws, jmax: +jmax.toExponential(2), capEvents: s.capEvents });
      s.dispose();
    }
  }
});
