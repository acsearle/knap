// Review: emulate the suggested fix "create the ground's body and collider BEFORE the model's bodies"
// by patching Simulation's private build steps (spike only; src/ is unchanged).
import { RAPIER } from '../../src/physics/rapier';
import { Simulation } from '../../src/physics/sim';

type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any
const P = Simulation.prototype as Any;
const origBB = P.buildBodies;
const origBG = P.buildGround;
const GROUND = (0x1 << 16) | (0x2 | 0x8 | 0x10);

export function groundFirst(on: boolean): void {
  if (!on) {
    P.buildBodies = origBB;
    P.buildGround = origBG;
    return;
  }
  P.buildBodies = function (this: Any, model: unknown) {
    if (this.groundY !== null) {
      const n = this.groundNormal;
      const p0 = this.groundPoint;
      const rb = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
      const cd = new RAPIER.ColliderDesc(new RAPIER.HalfSpace({ x: n[0], y: n[1], z: n[2] }))
        .setTranslation(p0[0], p0[1], p0[2])
        .setFriction(this.opts.friction)
        .setRestitution(this.opts.restitution)
        .setCollisionGroups(GROUND);
      this.world.createCollider(cd, rb);
      this.__groundDone = true;
    }
    return origBB.call(this, model);
  };
  P.buildGround = function (this: Any, model: unknown) {
    if (!this.__groundDone) return origBG.call(this, model);
    const w = this.world;
    w.createRigidBody = () => ({});
    w.createCollider = () => null;
    try {
      origBG.call(this, model);
    } finally {
      delete w.createRigidBody;
      delete w.createCollider;
    }
  };
}
