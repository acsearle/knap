// Shared harness for the Jolt battery. Scenes are described in studs and real seconds;
// a "regime" maps them into Jolt's internal units. Everything reported is converted back.
import initJolt from 'jolt-physics/wasm';

export const Jolt = await initJolt();

export const G_REAL = 1226.25; // studs / s^2
export const DT_REAL = 1 / 480;
export const DENSITY = 586; // kg/m^3 -> a solid 1 stud cube weighs 0.30 g

// Regimes. L = internal metres per stud, T = internal seconds per real second.
//  si-def    : real size (1 stud = 8 mm), real time, Jolt default PhysicsSettings.
//  si-scaled : real size, every length tolerance in PhysicsSettings scaled by 0.008,
//              max angular velocity raised to 2000 rad/s.
//  metre     : 1 stud = 1 m, time dilated by sqrt(125) so that g is 9.81 m/s^2 and the
//              1/480 s real step is a 0.0233 s internal step (Jolt's "game" regime). Defaults.
export const REGIMES = {
  'si-def': { L: 0.008, T: 1, scaleTol: false },
  'si-scaled': { L: 0.008, T: 1, scaleTol: true, maxAng: 2000 },
  metre: { L: 1, T: Math.sqrt(125), scaleTol: false },
  //  metre-nc  : metre, plus mUseBodyPairContactCache = false (the cache freezes rolling contacts)
  'metre-nc': { L: 1, T: Math.sqrt(125), scaleTol: false, noCache: true },
};

export const LAYER_STATIC = 0, LAYER_MOVING = 1, LAYER_GHOST = 2;

export class World {
  constructor(regimeName, opts = {}) {
    const R = REGIMES[regimeName];
    this.name = regimeName;
    this.L = R.L; this.T = R.T; this.R = R;
    this.dtInt = DT_REAL * R.T;
    this.vSteps = opts.velocitySteps ?? 10;
    this.pSteps = opts.positionSteps ?? 2;
    this.cSteps = opts.collisionSteps ?? 1;
    const s = new Jolt.JoltSettings();
    const olp = new Jolt.ObjectLayerPairFilterTable(3);
    olp.EnableCollision(LAYER_STATIC, LAYER_MOVING);
    olp.EnableCollision(LAYER_MOVING, LAYER_MOVING);
    const bpi = new Jolt.BroadPhaseLayerInterfaceTable(3, 2);
    bpi.MapObjectToBroadPhaseLayer(LAYER_STATIC, new Jolt.BroadPhaseLayer(0));
    bpi.MapObjectToBroadPhaseLayer(LAYER_MOVING, new Jolt.BroadPhaseLayer(1));
    bpi.MapObjectToBroadPhaseLayer(LAYER_GHOST, new Jolt.BroadPhaseLayer(1));
    s.mObjectLayerPairFilter = olp;
    s.mBroadPhaseLayerInterface = bpi;
    s.mObjectVsBroadPhaseLayerFilter = new Jolt.ObjectVsBroadPhaseLayerFilterTable(bpi, 2, olp, 3);
    this.jolt = new Jolt.JoltInterface(s);
    Jolt.destroy(s);
    this.ps = this.jolt.GetPhysicsSystem();
    this.bi = this.ps.GetBodyInterface();
    const g = -G_REAL * this.L / (this.T * this.T);
    this.ps.SetGravity(new Jolt.Vec3(0, opts.gravity === false ? 0 : g, 0));
    const set = this.ps.GetPhysicsSettings();
    set.mAllowSleeping = false;
    set.mNumVelocitySteps = this.vSteps;
    set.mNumPositionSteps = this.pSteps;
    if (R.scaleTol) {
      const k = this.L; // metres per stud: scale every length tolerance from "1 m object" to "1 stud object"
      set.mSpeculativeContactDistance *= k;
      set.mPenetrationSlop *= k;
      set.mManifoldTolerance *= k;
      set.mMaxPenetrationDistance *= k;
      set.mBodyPairCacheMaxDeltaPositionSq *= k * k;
      set.mContactPointPreserveLambdaMaxDistSq *= k * k;
      set.mMinVelocityForRestitution *= k;
      set.mPointVelocitySleepThreshold *= k;
    }
    if (R.noCache) set.mUseBodyPairContactCache = false;
    if (opts.settings) opts.settings(set);
    this.ps.SetPhysicsSettings(set);
    this.settings = set;
    this.bodies = [];
    this.contactCounts = null;
    if (opts.contacts) this.enableContactListener();
  }
  // ---- unit conversion ----
  len(studs) { return studs * this.L; }
  vel(v) { return v * this.L / this.T; }
  ang(w) { return w / this.T; }
  cr(minHalfStuds) { return Math.min(0.05, 0.2 * minHalfStuds) * this.L; } // convex radius
  // ---- shapes (studs) ----
  box(hx, hy, hz, density = DENSITY) {
    const ss = new Jolt.BoxShapeSettings(new Jolt.Vec3(this.len(hx), this.len(hy), this.len(hz)), this.cr(Math.min(hx, hy, hz)));
    ss.mDensity = density; return ss;
  }
  cylinder(r, halfLen, density = DENSITY) { // axis along local Y
    const ss = new Jolt.CylinderShapeSettings(this.len(halfLen), this.len(r), this.cr(Math.min(r, halfLen)));
    ss.mDensity = density; return ss;
  }
  prism(n, r, halfLen, density = DENSITY) { // regular n-gon prism, axis along local Y
    const pts = new Jolt.ArrayVec3();
    for (let i = 0; i < n; i++) {
      const a = 2 * Math.PI * i / n;
      for (const y of [-halfLen, halfLen]) pts.push_back(new Jolt.Vec3(this.len(r * Math.cos(a)), this.len(y), this.len(r * Math.sin(a))));
    }
    const ss = new Jolt.ConvexHullShapeSettings();
    ss.mPoints = pts;
    ss.mMaxConvexRadius = this.cr(Math.min(r, halfLen));
    if (this.R.scaleTol) { ss.mHullTolerance *= this.L; ss.mMaxErrorConvexRadius *= this.L; }
    ss.mDensity = density; return ss;
  }
  plane() { return new Jolt.PlaneShapeSettings(new Jolt.Plane(new Jolt.Vec3(0, 1, 0), 0), null, this.len(20000)); }
  compound(parts) { // [{shape, pos:[studs]}]
    const ss = new Jolt.StaticCompoundShapeSettings();
    for (const p of parts) ss.AddShape(new Jolt.Vec3(...p.pos.map(v => this.len(v))), Jolt.Quat.prototype.sIdentity(), p.shape, 0);
    return ss;
  }
  // ---- bodies ----
  add(shapeSettings, o = {}) {
    const res = shapeSettings.Create();
    if (res.HasError()) throw new Error('shape: ' + res.GetError().c_str());
    const shape = res.Get();
    const pos = (o.pos ?? [0, 0, 0]).map(v => this.len(v));
    const q = o.rot ?? [0, 0, 0, 1];
    const dyn = o.dynamic !== false;
    const bcs = new Jolt.BodyCreationSettings(shape, new Jolt.RVec3(...pos), new Jolt.Quat(...q),
      dyn ? Jolt.EMotionType_Dynamic : Jolt.EMotionType_Static, o.layer ?? (dyn ? LAYER_MOVING : LAYER_STATIC));
    bcs.mFriction = o.friction ?? 0.5;
    bcs.mRestitution = o.restitution ?? 0;
    bcs.mAllowSleeping = false;
    bcs.mLinearDamping = 0; bcs.mAngularDamping = 0;
    if (o.gyro) bcs.mApplyGyroscopicForce = true;
    if (o.ccd) bcs.mMotionQuality = Jolt.EMotionQuality_LinearCast;
    if (this.R.maxAng) bcs.mMaxAngularVelocity = this.R.maxAng;
    if (o.maxAngInt) bcs.mMaxAngularVelocity = o.maxAngInt;
    if (o.vOverride) bcs.mNumVelocityStepsOverride = o.vOverride;
    if (o.linVel) bcs.mLinearVelocity = new Jolt.Vec3(...o.linVel.map(v => this.vel(v)));
    if (o.angVel) bcs.mAngularVelocity = new Jolt.Vec3(...o.angVel.map(v => this.ang(v)));
    const body = this.bi.CreateBody(bcs);
    Jolt.destroy(bcs);
    this.bi.AddBody(body.GetID(), Jolt.EActivation_Activate);
    this.bodies.push(body);
    return body;
  }
  hinge(b1, b2, pointStuds, axis, o = {}) { // b1 may be null = world
    const hs = new Jolt.HingeConstraintSettings();
    const p = new Jolt.RVec3(...pointStuds.map(v => this.len(v)));
    hs.mPoint1 = p; hs.mPoint2 = p;
    const ax = new Jolt.Vec3(...axis);
    const nrm = Math.abs(axis[0]) < 0.9 ? new Jolt.Vec3(1, 0, 0) : new Jolt.Vec3(0, 1, 0);
    hs.mHingeAxis1 = ax; hs.mHingeAxis2 = ax; hs.mNormalAxis1 = nrm; hs.mNormalAxis2 = nrm;
    if (o.vOverride) hs.mNumVelocityStepsOverride = o.vOverride;
    if (o.pOverride) hs.mNumPositionStepsOverride = o.pOverride;
    const c = hs.Create(b1 ?? this.jolt.sGetFixedToWorldBody(), b2);
    this.ps.AddConstraint(c);
    return Jolt.castObject(c, Jolt.HingeConstraint);
  }
  step(n = 1) { for (let i = 0; i < n; i++) { if (this.contactCounts) this.contactCounts.clear(); this.jolt.Step(this.dtInt, this.cSteps); } }
  // ---- readout in studs / real s ----
  pos(b) { const p = b.GetCenterOfMassPosition(); return [p.GetX() / this.L, p.GetY() / this.L, p.GetZ() / this.L]; }
  v(b) { const p = b.GetLinearVelocity(); const k = this.T / this.L; return [p.GetX() * k, p.GetY() * k, p.GetZ() * k]; }
  w(b) { const p = b.GetAngularVelocity(); return [p.GetX() * this.T, p.GetY() * this.T, p.GetZ() * this.T]; }
  quat(b) { const q = b.GetRotation(); return [q.GetX(), q.GetY(), q.GetZ(), q.GetW()]; }
  mass(b) { return 1 / b.GetMotionProperties().GetInverseMass(); } // internal kg
  // world-space inertia * vector, internal units
  Iw(b, wInt) {
    const inv = b.GetInverseInertia(); // world space inverse inertia (Mat44)
    // invert the 3x3 in JS
    const m = [];
    for (let r = 0; r < 3; r++) { m.push([]); for (let c = 0; c < 3; c++) m[r].push(inv.GetColumn3(c)[['GetX', 'GetY', 'GetZ'][r]]()); }
    const I = inv3(m);
    return [0, 1, 2].map(r => I[r][0] * wInt[0] + I[r][1] * wInt[1] + I[r][2] * wInt[2]);
  }
  // kinetic energy of a body, internal units
  ke(b) {
    const v = b.GetLinearVelocity(); const w = b.GetAngularVelocity();
    const wi = [w.GetX(), w.GetY(), w.GetZ()];
    const Iw = this.Iw(b, wi);
    return 0.5 * this.mass(b) * (v.GetX() ** 2 + v.GetY() ** 2 + v.GetZ() ** 2) + 0.5 * (wi[0] * Iw[0] + wi[1] * Iw[1] + wi[2] * Iw[2]);
  }
  pe(b) { return this.mass(b) * G_REAL * this.L / (this.T * this.T) * b.GetCenterOfMassPosition().GetY(); }
  enableContactListener() {
    this.contactCounts = new Map();
    const l = new Jolt.ContactListenerJS();
    const rec = (b1, b2, man) => {
      const m = Jolt.wrapPointer(man, Jolt.ContactManifold);
      const B1 = Jolt.wrapPointer(b1, Jolt.Body), B2 = Jolt.wrapPointer(b2, Jolt.Body);
      const key = B1.GetID().GetIndex() + '-' + B2.GetID().GetIndex();
      this.contactCounts.set(key, (this.contactCounts.get(key) ?? 0) + m.mRelativeContactPointsOn1.size());
    };
    l.OnContactValidate = () => Jolt.ValidateResult_AcceptAllContactsForThisBodyPair;
    l.OnContactAdded = (b1, b2, man) => rec(b1, b2, man);
    l.OnContactPersisted = (b1, b2, man) => rec(b1, b2, man);
    l.OnContactRemoved = () => {};
    this.ps.SetContactListener(l);
    this.listener = l;
  }
  contactsOf(b) { // total contact points involving body b during last step
    if (!this.contactCounts) return NaN;
    const id = b.GetID().GetIndex(); let n = 0;
    for (const [k, v] of this.contactCounts) { const [a, c] = k.split('-').map(Number); if (a === id || c === id) n += v; }
    return n;
  }
  destroy() { Jolt.destroy(this.jolt); }
}

export function inv3(m) {
  const [a, b, c] = m[0], [d, e, f] = m[1], [g, h, i] = m[2];
  const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g;
  const det = a * A + b * B + c * C;
  return [[A / det, -(b * i - c * h) / det, (b * f - c * e) / det],
    [B / det, (a * i - c * g) / det, -(a * f - c * d) / det],
    [C / det, -(a * h - b * g) / det, (a * e - b * d) / det]];
}

// quaternion helpers [x,y,z,w]
export function qAxis(ax, ang) { const s = Math.sin(ang / 2), n = Math.hypot(...ax); return [ax[0] / n * s, ax[1] / n * s, ax[2] / n * s, Math.cos(ang / 2)]; }
export function qRot(q, v) {
  const [x, y, z, w] = q; const [vx, vy, vz] = v;
  const tx = 2 * (y * vz - z * vy), ty = 2 * (z * vx - x * vz), tz = 2 * (x * vy - y * vx);
  return [vx + w * tx + (y * tz - z * ty), vy + w * ty + (z * tx - x * tz), vz + w * tz + (x * ty - y * tx)];
}
export function tiltDeg(q) { const u = qRot(q, [0, 1, 0]); return Math.acos(Math.min(1, Math.abs(u[1]))) * 180 / Math.PI; }
export const fmt = (x, d = 4) => (Math.abs(x) >= 1e4 || (Math.abs(x) < 1e-3 && x !== 0) ? x.toExponential(2) : x.toFixed(d));
export const REGIME_NAMES = ['si-def', 'si-scaled', 'metre']; // metre-nc is run explicitly
