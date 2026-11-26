// B6a variants: hinge vs point constraint, Baumgarte, warm start
import { World, Jolt, fmt, G_REAL } from './lib.mjs';
function run(label, kind, settings, cs = 1) {
  const w = new World('metre', { settings, collisionSteps: cs });
  const b = w.add(w.box(3.5, 0.46, 0.46), { pos: [3, 0, 0] });
  if (kind === 'hinge') w.hinge(null, b, [0, 0, 0], [0, 0, 1]);
  else { const s = new Jolt.PointConstraintSettings(); s.mPoint1 = new Jolt.RVec3(0, 0, 0); s.mPoint2 = new Jolt.RVec3(0, 0, 0); w.ps.AddConstraint(s.Create(w.jolt.sGetFixedToWorldBody(), b)); }
  const E = () => w.ke(b) + w.pe(b); const E0 = E(); const sc = w.mass(b) * 9.81 * 3;
  const r = [];
  for (let i = 1; i <= 10 * 480; i++) { w.step(); if (i % 960 === 0) r.push(fmt(100 * (E() - E0) / sc, 2)); }
  console.log(label.padEnd(36), r.join(' / '), '% of mgL at 2,4,6,8,10 s');
  w.destroy();
}
run('hinge default', 'hinge');
run('point default', 'point');
run('hinge baumgarte 1.0', 'hinge', s => { s.mBaumgarte = 1.0; });
run('hinge baumgarte 0.05', 'hinge', s => { s.mBaumgarte = 0.05; });
run('hinge no warmstart', 'hinge', s => { s.mConstraintWarmStart = false; });
run('hinge dt/4 (csteps 4)', 'hinge', null, 4);
process.exit(0);
