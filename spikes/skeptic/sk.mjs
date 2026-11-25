// Skeptic spike helpers. Re-uses the coupling spike's Mesh (the recipe under test) read-only.
export * from '../coupling/lib.mjs';
import { R, makeWorld, arc, xyzw, v, q, sub, scl, dot, irot, qmul, weight, revolute, kinetic, potential, G } from '../coupling/lib.mjs';

export const NO = 0x00010000; // collides with nothing
export const AXZ = [0, 0, 1];

/** Dynamic body at `centre` with a gear cylinder of radius r (axis `axis`), optional point mass {m, at}. */
export function gearBody(W, centre, r, { axis = AXZ, arm, density = 1, angDamp = 0, fixed = false, extra = [] } = {}) {
  const d = fixed ? R.RigidBodyDesc.fixed() : R.RigidBodyDesc.dynamic().setCanSleep(false).setAngularDamping(angDamp);
  const body = W.w.createRigidBody(d.setTranslation(...centre));
  W.w.createCollider(R.ColliderDesc.cylinder(0.5, r).setRotation(xyzw(arc([0, 1, 0], axis))).setDensity(density).setCollisionGroups(NO), body);
  if (arm) W.w.createCollider(weight(arm.at, arm.m).setCollisionGroups(NO), body);
  for (const e of extra) W.w.createCollider(e.setCollisionGroups(NO), body);
  return { body, g: { body, lc: [0, 0, 0], la: [...axis], r, T: Math.round(16 * r) } };
}

/** Moment of inertia of body b about the world axis a through point p. */
export function inertiaAbout(b, a, p = v(b.translation())) {
  const I = v(b.principalInertia());
  const fr = qmul(q(b.rotation()), q(b.principalInertiaLocalFrame()));
  const al = irot(fr, a);
  const com = sub(v(b.worldCom()), p);
  const perp = sub(com, scl(a, dot(com, a)));
  return I[0] * al[0] ** 2 + I[1] * al[1] ** 2 + I[2] * al[2] ** 2 + b.mass() * dot(perp, perp);
}

export function energy(bodies, grav = [0, -G, 0]) {
  let e = 0;
  for (const b of bodies) e += kinetic(b) + potential(b, grav);
  return e;
}

/** Angular momentum of bodies about origin. */
export function angMom(bodies) {
  const L = [0, 0, 0];
  for (const b of bodies) {
    const m = b.mass();
    const c = v(b.worldCom());
    const lv = v(b.linvel());
    const I = v(b.principalInertia());
    const fr = qmul(q(b.rotation()), q(b.principalInertiaLocalFrame()));
    const wl = irot(fr, v(b.angvel()));
    const Lw = [I[0] * wl[0], I[1] * wl[1], I[2] * wl[2]];
    // rotate back to world
    const Lworld = irot([-fr[0], -fr[1], -fr[2], fr[3]], Lw);
    const cr = [c[1] * lv[2] - c[2] * lv[1], c[2] * lv[0] - c[0] * lv[2], c[0] * lv[1] - c[1] * lv[0]];
    for (let i = 0; i < 3; i++) L[i] += Lworld[i] + m * cr[i];
  }
  return L;
}

export { makeWorld, revolute };
export const out = (...a) => console.log(...a);

// ---- Variant of the coupling spike's Mesh with each anchor in ITS OWN gear's plane. ----
// The original puts both anchors at P in gear 1's plane; for an axially offset gear 2 the row then
// acts on gear 2 with a lever δ along the axis (a tilting moment δ·F about n), and the row can be
// satisfied by tilting gear 2 instead of spinning it. Here anchor 2 = P + a·δ, δ = (c2 − c1)·a.
import { Mesh as BaseMesh, add as _add, scl as _scl, dot as _dot, sub as _sub } from '../coupling/lib.mjs';
export class MeshPlanar extends BaseMesh {
  geom() {
    const G0 = super.geom();
    G0.delta = _dot(_sub(G0.f2.c, G0.f1.c), G0.a);
    return G0;
  }
  update(first = false) {
    // run the base update, then move anchor 2 axially into gear 2's plane
    super.update(first);
    if (this.dead || !this.joint || !this.lastG || this.o.stop) return;
    const d = this.lastG.delta;
    if (!d) return;
    const b2 = this.g2.body;
    const q2 = [b2.rotation().x, b2.rotation().y, b2.rotation().z, b2.rotation().w];
    const A2 = this.joint.anchor2();
    const ax = rotInv(q2, _scl(this.lastG.a, d));
    this.joint.setAnchor2({ x: A2.x + ax[0], y: A2.y + ax[1], z: A2.z + ax[2] });
  }
}
import { irot as rotInv } from '../coupling/lib.mjs';
