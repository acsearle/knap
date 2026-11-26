// Quick cannon-es 0.20.0 check (studs as units): B6a pendulum, B5a gentle roll, B7 non-principal spin.
import * as C from "cannon-es";
const G = 1226.25, dt = 1 / 480;
const fmt = (x, d = 3) => x.toFixed(d);
function world(g = true) { const w = new C.World({ gravity: new C.Vec3(0, g ? -G : 0, 0) }); w.allowSleep = false; w.solver.iterations = 10; return w; }
// B6a
{
  const w = world(); const base = new C.Body({ mass: 0 }); w.addBody(base);
  const b = new C.Body({ mass: 1, shape: new C.Box(new C.Vec3(3.5, 0.46, 0.46)), position: new C.Vec3(3, 0, 0), linearDamping: 0, angularDamping: 0 });
  b.collisionFilterMask = 0; w.addBody(b);
  w.addConstraint(new C.HingeConstraint(base, b, { pivotA: new C.Vec3(0, 0, 0), axisA: new C.Vec3(0, 0, 1), pivotB: new C.Vec3(-3, 0, 0), axisB: new C.Vec3(0, 0, 1) }));
  const I = b.inertia.z; const E = () => 0.5 * b.velocity.lengthSquared() + 0.5 * I * b.angularVelocity.z ** 2 + G * b.position.y;
  const E0 = E(), tr = []; const t0 = performance.now();
  for (let i = 1; i <= 4800; i++) { w.step(dt); if (i % 960 === 0) tr.push((100 * (E() - E0)) / (G * 3)); }
  console.log(`cannon B6a pendulum (10 GS iterations, 1/480): dE at 2..10 s = ${tr.map((x) => fmt(x, 2)).join(" / ")} % of mgL; ${fmt((performance.now() - t0) / 10, 1)} ms wall per real s`);
}
// B5a: cylinder (cannon builds a convex polyhedron with N segments) on a box floor
for (const v0 of [1, 10]) {
  const w = world(); const fl = new C.Body({ mass: 0, shape: new C.Box(new C.Vec3(200, 0.5, 200)), position: new C.Vec3(0, -0.5, 0) }); w.addBody(fl);
  const cyl = new C.Cylinder(1, 1, 0.92, 32); // axis Y in cannon-es
  const b = new C.Body({ mass: 1, linearDamping: 0, angularDamping: 0 });
  b.addShape(cyl, new C.Vec3(), new C.Quaternion().setFromAxisAngle(new C.Vec3(1, 0, 0), Math.PI / 2));
  b.position.set(0, 1, 0); b.velocity.set(v0, 0, 0); b.angularVelocity.set(0, 0, -v0); w.addBody(b);
  const sp = []; for (let i = 1; i <= 2400; i++) { w.step(dt); if (i % 480 === 0) sp.push(b.velocity.x); }
  console.log(`cannon B5a 32-seg cylinder r1 rolled at ${v0}: vx at 1..5 s = ${sp.map((x) => fmt(x, 3)).join(", ")}; y=${fmt(b.position.y, 4)}`);
}
// B7
{
  const w = world(false); const b = new C.Body({ mass: 1, linearDamping: 0, angularDamping: 0 });
  b.addShape(new C.Box(new C.Vec3(2.5, 0.46, 0.46)), new C.Vec3(-0.34, -0.15, 0)); b.addShape(new C.Box(new C.Vec3(0.46, 0.46, 0.46)), new C.Vec3(1.7, 0.77, 0));
  b.angularVelocity.set(12, 12.8, 9.6); w.addBody(b);
  const K = () => { const wl = b.quaternion.conjugate().vmult(b.angularVelocity); return 0.5 * (b.inertia.x * wl.x ** 2 + b.inertia.y * wl.y ** 2 + b.inertia.z * wl.z ** 2); };
  const K0 = K(); for (let i = 0; i < 480 * 30; i++) w.step(dt);
  console.log(`cannon B7 (compound, cannon uses AABB-box inertia, not exact): rot KE change over 30 s ${fmt((100 * (K() - K0)) / K0, 3)} %, |w| ${fmt(b.angularVelocity.length(), 3)}`);
}
process.exit(0);
