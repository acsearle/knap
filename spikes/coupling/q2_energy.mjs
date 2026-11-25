// Q2b: energy drift of a free-spinning meshed pair vs a single free rotor (no motor, axis Z, gravity on
// but in-plane torque-free since gears are symmetric). Raw Rapier and with the sim.ts energy guard.
// usage: node q2_energy.mjs [seconds]
import { makeWorld, makeGear, pinGear, Mesh, omega, kinetic, Guard, PITCH, DT, fmt } from './lib.mjs';

const secs = Number(process.argv[2] ?? 60);
const steps = Math.round(secs / DT);
const axis = [0, 0, 1];
for (const w0 of [10, 50]) {
  for (const [r1, r2] of [[1, 1], [0.5, 1.5], [0.5, 2.5]]) {
    for (const cfg of ['single', 'pair', 'pair-lead']) {
      for (const guard of [false, true]) {
        const W = makeWorld();
        const g1 = makeGear(W, { centre: [0, 0, 0], axis, r: r1 });
        pinGear(W, g1);
        g1.body.setAngvel({ x: 0, y: 0, z: w0 }, true);
        const bodies = [g1.body];
        let m = null;
        if (cfg !== 'single') {
          const g2 = makeGear(W, { centre: [r1 + r2, 0, 0], axis, r: r2 });
          pinGear(W, g2);
          g2.body.setAngvel({ x: 0, y: 0, z: (-w0 * r1) / r2 }, true);
          bodies.push(g2.body);
          m = new Mesh(W, g1, g2, { lead: cfg === 'pair-lead' });
        }
        const gd = guard ? new Guard(bodies, W.gravity) : null;
        const K = () => bodies.reduce((s, b) => s + kinetic(b), 0);
        const k0 = K();
        let kmin = Infinity, kmax = -Infinity;
        for (let i = 0; i < steps; i++) {
          m?.update();
          W.w.step();
          gd?.after();
          const k = K() / k0;
          kmin = Math.min(kmin, k);
          kmax = Math.max(kmax, k);
        }
        console.log(`w0=${w0} ${r1}:${r2} ${cfg.padEnd(9)} guard=${guard ? 'on ' : 'off'}  K(${secs}s)/K0 = ${fmt(K() / k0, 6)}  range [${fmt(kmin, 6)}, ${fmt(kmax, 6)}]  ω1=${fmt(omega(g1.body, axis), 4)}${m ? `  phase ${fmt(m.e / PITCH, 6)} teeth` : ''}${gd ? `  guard removed ${fmt(gd.removed / k0, 4)}·K0` : ''}`);
      }
    }
  }
}

// Exit explicitly: at exit Node 20 spins on Rapier wasm-bindgen finalizers (measured: minutes of CPU after the last line).
process.exit(0);
