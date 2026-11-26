// Independent minimal Jolt setup (does not use ../lib.mjs). Loads the package from ../node_modules.
import initJolt from '../node_modules/jolt-physics/dist/jolt-physics.wasm.js';
export const J = await initJolt();
export function makeWorld({ g = -9.81, vsteps = 10, psteps = 2, cache = true, tweak } = {}) {
  const s = new J.JoltSettings();
  const olp = new J.ObjectLayerPairFilterTable(2);
  olp.EnableCollision(0, 1); olp.EnableCollision(1, 1);
  const bpi = new J.BroadPhaseLayerInterfaceTable(2, 2);
  bpi.MapObjectToBroadPhaseLayer(0, new J.BroadPhaseLayer(0));
  bpi.MapObjectToBroadPhaseLayer(1, new J.BroadPhaseLayer(1));
  s.mObjectLayerPairFilter = olp; s.mBroadPhaseLayerInterface = bpi;
  s.mObjectVsBroadPhaseLayerFilter = new J.ObjectVsBroadPhaseLayerFilterTable(bpi, 2, olp, 2);
  const ji = new J.JoltInterface(s);
  const ps = ji.GetPhysicsSystem(); const bi = ps.GetBodyInterface();
  ps.SetGravity(new J.Vec3(0, g, 0));
  const st = ps.GetPhysicsSettings();
  st.mAllowSleeping = false; st.mNumVelocitySteps = vsteps; st.mNumPositionSteps = psteps;
  st.mUseBodyPairContactCache = cache;
  if (tweak) tweak(st);
  ps.SetPhysicsSettings(st);
  return { ji, ps, bi };
}
export function body(W, shapeSettings, pos, { q = [0, 0, 0, 1], dyn = true, lv, av, gyro = false, maxW } = {}) {
  const sh = shapeSettings.Create().Get();
  const b = new J.BodyCreationSettings(sh, new J.RVec3(...pos), new J.Quat(...q), dyn ? J.EMotionType_Dynamic : J.EMotionType_Static, dyn ? 1 : 0);
  b.mFriction = 0.5; b.mRestitution = 0; b.mAllowSleeping = false; b.mLinearDamping = 0; b.mAngularDamping = 0;
  b.mApplyGyroscopicForce = gyro; if (maxW) b.mMaxAngularVelocity = maxW;
  if (lv) b.mLinearVelocity = new J.Vec3(...lv); if (av) b.mAngularVelocity = new J.Vec3(...av);
  const B = W.bi.CreateBody(b); W.bi.AddBody(B.GetID(), J.EActivation_Activate); return B;
}
export const P = v => [v.GetX(), v.GetY(), v.GetZ()];
