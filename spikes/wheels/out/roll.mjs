// spikes/wheels/lib.ts
import RAPIER from "@dimforge/rapier3d-compat";

// src/geometry/dims.ts
var E_FREE = 0.48;
var EPS = 5e-3;
var E_CONN = 0.5 + EPS;
var HC = 0.46;
var R_COLL_ROD = 0.29;

// src/core/rules.ts
function isMale(kind) {
  return kind === "axle" || kind === "pin" || kind === "frictionPin";
}
function isHole(kind) {
  return kind === "pinHole" || kind === "axleHole";
}
var DIRS = [
  [1, 0, 0],
  [-1, 0, 0],
  [0, 1, 0],
  [0, -1, 0],
  [0, 0, 1],
  [0, 0, -1]
];
function axisOfDir(dir) {
  return dir >> 1;
}
function dirBetween(a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const dz = b.z - a.z;
  if (dy === 0 && dz === 0) {
    if (dx === 1) return 0;
    if (dx === -1) return 1;
  } else if (dx === 0 && dz === 0) {
    if (dy === 1) return 2;
    if (dy === -1) return 3;
  } else if (dx === 0 && dy === 0) {
    if (dz === 1) return 4;
    if (dz === -1) return 5;
  }
  return null;
}
function connects(a, b) {
  const dir = dirBetween(a, b);
  if (dir === null) return false;
  const n = axisOfDir(dir);
  const ma = isMale(a.kind);
  const mb = isMale(b.kind);
  if (!ma && !mb) return true;
  if (ma && mb) return a.axis === n && b.axis === n;
  const male = ma ? a : b;
  const hole = ma ? b : a;
  return male.axis === n && hole.axis !== n;
}

// src/core/model.ts
function posKey(x, y, z) {
  return `${x},${y},${z}`;
}
function makeCell(x, y, z, kind, axis) {
  return { x, y, z, kind, axis };
}
var EMPTY = Object.freeze([]);

// src/geometry/topology.ts
function partOrigin(part) {
  let x = Infinity;
  let y = Infinity;
  let z = Infinity;
  for (const c of part.cells) {
    if (c.x < x) x = c.x;
    if (c.y < y) y = c.y;
    if (c.z < z) z = c.z;
  }
  if (part.cells.length === 0) return [0, 0, 0];
  return [x, y, z];
}
function localCenter(c, origin) {
  return [c.x - origin[0], c.y - origin[1], c.z - origin[2]];
}
var PartGrid = class {
  constructor(part) {
    this.part = part;
    for (const c of part.cells) this.map.set(posKey(c.x, c.y, c.z), c);
  }
  map = /* @__PURE__ */ new Map();
  at(x, y, z) {
    return this.map.get(posKey(x, y, z));
  }
  /** Is there a hole cell of this part at c + d1 + d2 (d2 optional)? */
  holeAt(c, d1, d2 = null) {
    let x = c.x;
    let y = c.y;
    let z = c.z;
    for (const d of [d1, d2]) {
      if (d === null) continue;
      const v = DIRS[d];
      x += v[0];
      y += v[1];
      z += v[2];
    }
    const n = this.at(x, y, z);
    return n !== void 0 && isHole(n.kind);
  }
};
function analyzeCells(part, grid = new PartGrid(part)) {
  return part.cells.map((cell, index) => {
    const faces = [];
    for (let d = 0; d < 6; d++) {
      const v = DIRS[d];
      const nb = grid.at(cell.x + v[0], cell.y + v[1], cell.z + v[2]);
      faces.push({ neighbour: nb, connected: nb !== void 0 && connects(cell, nb) });
    }
    return { cell, index, faces };
  });
}
function plusDir(axis) {
  return axis * 2;
}
function minusDir(axis) {
  return axis * 2 + 1;
}
function rodExtent(t) {
  if (!isMale(t.cell.kind)) throw new Error("rodExtent: not a male cell");
  const a = t.cell.axis;
  const hi = t.faces[plusDir(a)].connected ? E_CONN : E_FREE;
  const lo = t.faces[minusDir(a)].connected ? -E_CONN : -E_FREE;
  return [lo, hi];
}

// src/geometry/colliders.ts
function partColliders(part) {
  const origin = partOrigin(part);
  const out = [];
  for (const t of analyzeCells(part)) {
    const c = t.cell;
    const ctr = localCenter(c, origin);
    const a = c.axis;
    if (isMale(c.kind)) {
      const [lo2, hi2] = rodExtent(t);
      out.push(cyl(ctr, a, R_COLL_ROD, lo2, hi2, t.index, true));
      continue;
    }
    const hi = t.faces[plusDir(a)].connected ? 0.5 : HC;
    const lo = t.faces[minusDir(a)].connected ? -0.5 : -HC;
    out.push(cyl(ctr, a, HC, lo, hi, t.index, false));
    for (let d = 0; d < 6; d = d + 1) {
      if (axisOfDir(d) === a || !t.faces[d].connected) continue;
      const v = DIRS[d];
      const n = axisOfDir(d);
      const center = [ctr[0] + v[0] * 0.25, ctr[1] + v[1] * 0.25, ctr[2] + v[2] * 0.25];
      const halfExtents = [HC, HC, HC];
      halfExtents[n] = 0.25;
      out.push({ shape: "box", center, halfExtents, cell: t.index, male: false });
    }
  }
  return out;
}
function cyl(ctr, axis, radius, lo, hi, cell, male) {
  const center = [ctr[0], ctr[1], ctr[2]];
  center[axis] += (lo + hi) / 2;
  return { shape: "cylinder", center, axis, radius, halfLength: (hi - lo) / 2, cell, male };
}

// src/physics/shapes.ts
var BEVEL = 0.01;
var KEEP_DEG = 56.25;
var EPS2 = 1e-9;
function polyMoments(P) {
  let A = 0;
  let cu = 0;
  let cv = 0;
  let Su2 = 0;
  let Sv2 = 0;
  for (let i = 0; i < P.length; i++) {
    const [x0, y0] = P[i];
    const [x1, y1] = P[(i + 1) % P.length];
    const c = x0 * y1 - x1 * y0;
    A += c / 2;
    cu += (x0 + x1) * c / 6;
    cv += (y0 + y1) * c / 6;
    Su2 += (x0 * x0 + x0 * x1 + x1 * x1) * c / 12;
    Sv2 += (y0 * y0 + y0 * y1 + y1 * y1) * c / 12;
  }
  cu /= A;
  cv /= A;
  return { A, cu, cv, Iuu: Sv2 - A * cv * cv, Ivv: Su2 - A * cu * cu };
}
function bevelledPrism(center, axis, u, halfLength, poly) {
  const v = 3 - axis - u;
  const points = [];
  for (const q of poly)
    for (const s of [-1, 1]) {
      const p = [center[0], center[1], center[2]];
      p[u] += q.u;
      p[v] += q.v;
      p[axis] += s * (q.keep ? halfLength : halfLength - BEVEL);
      points.push(p);
    }
  const m = polyMoments(poly.map((q) => [q.u, q.v]));
  const L = 2 * halfLength;
  const volume = m.A * L;
  const com = [center[0], center[1], center[2]];
  com[u] += m.cu;
  com[v] += m.cv;
  const inertia = [0, 0, 0];
  inertia[axis] = (m.Iuu + m.Ivv) * L;
  inertia[u] = m.Iuu * L + volume * L * L / 12;
  inertia[v] = m.Ivv * L + volume * L * L / 12;
  return { kind: "hull", points, mass: { volume, com, inertia } };
}
function gonVertex(R, segments, i) {
  const a = (i + 0.5) / segments * 2 * Math.PI;
  return { u: R * Math.cos(a), v: R * Math.sin(a), a };
}
function keepIndex(segments) {
  let best = 0;
  for (let i = 0; i < segments / 4; i++)
    if (Math.abs((i + 0.5) / segments * 360 - KEEP_DEG) < Math.abs((best + 0.5) / segments * 360 - KEEP_DEG)) best = i;
  return best;
}
function checkSegments(segments) {
  if (!Number.isInteger(segments) || segments < 4 || segments % 4 !== 0)
    throw new Error(`cylinderSegments must be a multiple of 4 (got ${segments})`);
}
function prismShape(center, axis, radius, halfLength, segments, u, runLength = 0) {
  checkSegments(segments);
  if (u === axis) throw new Error("u must be transverse to the axis");
  const R = radius / Math.cos(Math.PI / segments);
  const n = segments;
  const j = runLength > 0 ? n / 4 - 1 : keepIndex(n);
  const keepSet = /* @__PURE__ */ new Set([j, n / 2 - 1 - j, n / 2 + j, n - 1 - j]);
  const poly = [];
  for (let i = 0; i < n; i++) {
    const g = gonVertex(R, n, i);
    const plusU = g.u > 0;
    poly.push({ u: g.u + (plusU ? runLength : 0), v: g.v, keep: keepSet.has(i) });
  }
  return bevelledPrism(center, axis, u, halfLength, poly);
}
function partShapes(part, segments) {
  checkSegments(segments);
  const origin = partOrigin(part);
  const w = (c) => [c[0] + origin[0], c[1] + origin[1], c[2] + origin[2]];
  const prims = partColliders(part);
  const cells = part.cells;
  const plain = /* @__PURE__ */ new Map();
  for (const p of prims) {
    if (p.shape !== "cylinder" || p.male) continue;
    const c = cells[p.cell];
    const ctr = w(p.center);
    if (Math.abs(p.halfLength - HC) < EPS2 && Math.abs(ctr[0] - c.x) + Math.abs(ctr[1] - c.y) + Math.abs(ctr[2] - c.z) < EPS2)
      plain.set(p.cell, p);
  }
  const byPos = /* @__PURE__ */ new Map();
  cells.forEach((c, i) => byPos.set(`${c.x},${c.y},${c.z}`, i));
  const plainAt = (x, y, z, axis) => {
    const i = byPos.get(`${x},${y},${z}`);
    return i !== void 0 && plain.has(i) && cells[i].axis === axis ? i : void 0;
  };
  const out = [];
  const coveredBarrel = /* @__PURE__ */ new Set();
  const coveredWeb = /* @__PURE__ */ new Set();
  for (const [i] of plain) {
    const c = cells[i];
    for (let d = 0; d < 3; d = d + 1) {
      if (d === c.axis) continue;
      const step = (k) => {
        const p = [c.x, c.y, c.z];
        p[d] += k;
        return p;
      };
      if (plainAt(...step(-1), c.axis) !== void 0) continue;
      let n = 0;
      while (plainAt(...step(n + 1), c.axis) !== void 0) n++;
      if (n === 0) continue;
      const run = [];
      for (let k = 0; k <= n; k++) run.push(plainAt(...step(k), c.axis));
      run.forEach((ci, k) => {
        coveredBarrel.add(ci);
        if (k > 0) coveredWeb.add(`${ci}:${d}:-1`);
        if (k < n) coveredWeb.add(`${ci}:${d}:1`);
      });
      const first = plain.get(run[0]);
      out.push(prismShape(w(first.center), c.axis, first.radius, first.halfLength, segments, d, n));
    }
  }
  for (const p of prims) {
    if (p.shape === "cylinder") {
      if (!p.male && coveredBarrel.has(p.cell)) continue;
      out.push(prismShape(w(p.center), p.axis, p.radius, p.halfLength, segments, (p.axis + 1) % 3));
      continue;
    }
    const c = cells[p.cell];
    const ctr = w(p.center);
    const off = [ctr[0] - c.x, ctr[1] - c.y, ctr[2] - c.z];
    const d = off.findIndex((x) => Math.abs(x) > EPS2);
    if (d >= 0 && coveredWeb.has(`${p.cell}:${d}:${Math.sign(off[d])}`)) continue;
    out.push({ kind: "box", center: ctr, halfExtents: [...p.halfExtents] });
  }
  return out;
}

// src/core/examples.ts
function runBetween(from, to) {
  const d = [to[0] - from[0], to[1] - from[1], to[2] - from[2]];
  const nonZero = d.filter((v) => v !== 0).length;
  if (nonZero > 1) throw new Error(`run ${JSON.stringify(from)}\u2192${JSON.stringify(to)} is not axis-aligned`);
  const n = Math.max(...d.map(Math.abs));
  const step = d.map(Math.sign);
  const out = [];
  for (let i = 0; i <= n; i++) out.push([from[0] + step[0] * i, from[1] + step[1] * i, from[2] + step[2] * i]);
  return out;
}
function holes(from, to, holeAxis = 2, kind = "pinHole") {
  return runBetween(from, to).map((p) => makeCell(p[0], p[1], p[2], kind, holeAxis));
}
function beam(from, to, holeAxis = 2) {
  return holes(from, to, holeAxis, "pinHole");
}

// spikes/wheels/lib.ts
var G = 1226.25;
var DT = 1 / 480;
var SPEED_CAP = 400;
var FRICTION = 0.4;
var RESTITUTION = 0.1;
async function init() {
  await RAPIER.init();
}
function makeWorld(iterations, thetaDeg = 0) {
  const th = thetaDeg * Math.PI / 180;
  const w = new RAPIER.World({ x: G * Math.sin(th), y: -G * Math.cos(th), z: 0 });
  w.timestep = DT;
  w.numSolverIterations = iterations;
  w.numInternalPgsIterations = 1;
  w.integrationParameters.maxCcdSubsteps = 0;
  return w;
}
var Y_TO_Z = { x: Math.SQRT1_2, y: 0, z: 0, w: Math.SQRT1_2 };
var GRP = {
  GROUND: 1 << 16 | (2 | 8),
  ROUND: 2 << 16 | (1 | 2),
  HULL: 4 << 16 | 8,
  PARTS: 8 << 16 | (1 | 4 | 8)
};
var HULL_ORIGIN = process.env.HULL_ORIGIN ?? "centre";
var WHEEL_BEVEL = Number(process.env.WHEEL_BEVEL ?? 0.05);
function bevelPrism(r, h, n, bevel) {
  const R = r / Math.cos(Math.PI / n);
  let best = 0;
  for (let i = 0; i < n / 4; i++) if (Math.abs((i + 0.5) / n * 360 - 56.25) < Math.abs((best + 0.5) / n * 360 - 56.25)) best = i;
  const keep = /* @__PURE__ */ new Set([best, n / 2 - 1 - best, n / 2 + best, n - 1 - best]);
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = (i + 0.5) / n * 2 * Math.PI;
    for (const s of [-1, 1]) pts.push(R * Math.cos(a), R * Math.sin(a), s * (keep.has(i) ? h : h - bevel));
  }
  const A = 0.5 * n * R * R * Math.sin(2 * Math.PI / n);
  const L = 2 * h;
  const J = A * R * R * (2 + Math.cos(2 * Math.PI / n)) / 6;
  const volume = A * L;
  const Ixx = J / 2 * L + volume * L * L / 12;
  return { pts: new Float32Array(pts), volume, inertia: [Ixx, Ixx, J * L] };
}
var ROUND_BORDER = 0.05;
function wheelColliders(kind, r, at = [0, 0, 0]) {
  let cd;
  if (kind === "hyb") {
    const c = RAPIER.ColliderDesc.cylinder(0.5, r).setRotation(Y_TO_Z).setDensity(1).setCollisionGroups(GRP.ROUND);
    const p = bevelPrism(r, 0.5, 32, WHEEL_BEVEL);
    const h = RAPIER.ColliderDesc.convexHull(p.pts).setDensity(0).setCollisionGroups(GRP.HULL);
    for (const d of [c, h]) d.setTranslation(at[0], at[1], at[2]).setFriction(FRICTION).setRestitution(RESTITUTION);
    return [c, h];
  }
  if (kind.startsWith("b")) {
    const p = bevelPrism(r, 0.5, Number(kind.slice(1)), WHEEL_BEVEL);
    cd = RAPIER.ColliderDesc.convexHull(p.pts);
    cd.setMassProperties(p.volume, { x: 0, y: 0, z: 0 }, { x: p.inertia[0], y: p.inertia[1], z: p.inertia[2] }, { x: 0, y: 0, z: 0, w: 1 });
  } else if (kind === "cyl") cd = RAPIER.ColliderDesc.cylinder(0.5, r).setRotation(Y_TO_Z);
  else if (kind === "rcyl") cd = RAPIER.ColliderDesc.roundCylinder(0.5 - ROUND_BORDER, r - ROUND_BORDER, ROUND_BORDER).setRotation(Y_TO_Z);
  else {
    const round = kind.startsWith("r");
    const n = Number(kind.slice(round ? 2 : 1));
    const b = round ? ROUND_BORDER : 0;
    const sh = prismShape([0, 0, 0], 2, r - b, 0.5 - b, n, 0);
    const full = prismShape([0, 0, 0], 2, r, 0.5, n, 0);
    if (full.kind !== "hull") throw new Error("hull expected");
    if (sh.kind !== "hull") throw new Error("hull expected");
    const pts = new Float32Array(sh.points.length * 3);
    sh.points.forEach((q, i) => pts.set(q, i * 3));
    const d = round ? RAPIER.ColliderDesc.roundConvexHull(pts, b) : RAPIER.ColliderDesc.convexHull(pts);
    if (!d) throw new Error("hull failed");
    const mp = full.mass;
    d.setMassProperties(mp.volume, { x: mp.com[0], y: mp.com[1], z: mp.com[2] }, { x: mp.inertia[0], y: mp.inertia[1], z: mp.inertia[2] }, { x: 0, y: 0, z: 0, w: 1 });
    cd = d;
  }
  cd.setTranslation(at[0], at[1], at[2]);
  cd.setFriction(FRICTION).setRestitution(RESTITUTION);
  if (kind === "cyl" || kind === "rcyl") cd.setDensity(1);
  return [cd];
}
function addWheel(w, kind, r, pos, opts = {}) {
  const desc = RAPIER.RigidBodyDesc.dynamic().setCanSleep(false).setTranslation(pos[0], pos[1], pos[2]);
  if (opts.rot) desc.setRotation(opts.rot);
  if (opts.extraIters) desc.setAdditionalSolverIterations(opts.extraIters);
  const rb = w.createRigidBody(desc);
  for (const cd of wheelColliders(kind, r)) w.createCollider(cd, rb);
  if (opts.softCcd ?? process.env.CCD !== "0") rb.setSoftCcdPrediction(SPEED_CAP * DT * 1.25);
  return rb;
}
function addGround(w, kind, x0 = -20, length = 400, top = 0, seg = 15) {
  const rb = w.createRigidBody(RAPIER.RigidBodyDesc.fixed());
  const grp = kind === "half" || kind === "box" ? GRP.GROUND : GRP.PARTS;
  const fin = (cd) => w.createCollider(cd.setFriction(FRICTION).setRestitution(RESTITUTION).setCollisionGroups(grp), rb);
  if (kind === "half") {
    fin(new RAPIER.ColliderDesc(new RAPIER.HalfSpace({ x: 0, y: 1, z: 0 })).setTranslation(0, top, 0));
  } else if (kind === "box") {
    fin(RAPIER.ColliderDesc.cuboid(length / 2, 1, 50).setTranslation(x0 + length / 2, top - 1, 0));
  } else {
    const HC2 = 0.46;
    const rows = Number(process.env.ARM_ROWS ?? 5);
    for (let zr = -Math.floor(rows / 2); zr <= Math.floor((rows - 1) / 2); zr++)
      for (let x = Math.ceil(x0), id = 1; x < x0 + length; x += seg, id++) {
        const holeAxis = kind === "armFlat" ? 1 : 2;
        const part = { id, color: "#888888", cells: beam([x, 0, zr], [x + seg - 1, 0, zr], holeAxis) };
        for (const sh of partShapes(part, 16)) {
          if (sh.kind !== "hull") throw new Error("unexpected box");
          const ctr = [0, 0, 0];
          if (HULL_ORIGIN !== "world") {
            for (const q of sh.points) for (let k = 0; k < 3; k++) ctr[k] += q[k] / sh.points.length;
          }
          const pts = new Float32Array(sh.points.length * 3);
          sh.points.forEach((q, i) => pts.set([q[0] - ctr[0], q[1] - ctr[1], q[2] - ctr[2]], i * 3));
          fin(RAPIER.ColliderDesc.convexHull(pts).setTranslation(ctr[0], ctr[1] + top - HC2, ctr[2]));
        }
      }
  }
}
function worldInertia(rb) {
  const q = rb.rotation();
  const f = rb.principalInertiaLocalFrame();
  const qf = qmul([q.x, q.y, q.z, q.w], [f.x, f.y, f.z, f.w]);
  const d = rb.principalInertia();
  const D = [d.x, d.y, d.z];
  const cols = [rot(qf, [1, 0, 0]), rot(qf, [0, 1, 0]), rot(qf, [0, 0, 1])];
  const I = [];
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) I.push(cols.reduce((s, e, k) => s + D[k] * e[r] * e[c], 0));
  return I;
}
function qmul(a, b) {
  return [
    a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
    a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
    a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
    a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2]
  ];
}
function rot(q, v) {
  const [x, y, z, w] = q;
  const tx = 2 * (y * v[2] - z * v[1]);
  const ty = 2 * (z * v[0] - x * v[2]);
  const tz = 2 * (x * v[1] - y * v[0]);
  return [v[0] + w * tx + (y * tz - z * ty), v[1] + w * ty + (z * tx - x * tz), v[2] + w * tz + (x * ty - y * tx)];
}
function axisOf(rb, local = [0, 0, 1]) {
  const q = rb.rotation();
  return rot([q.x, q.y, q.z, q.w], local);
}
function stats(a) {
  const n = a.length;
  const mean = a.reduce((s, x) => s + x, 0) / n;
  const std = Math.sqrt(a.reduce((s, x) => s + (x - mean) ** 2, 0) / n);
  return { mean, std, min: Math.min(...a), max: Math.max(...a) };
}
function slope(x, y) {
  const n = x.length;
  const mx = x.reduce((s, v) => s + v, 0) / n;
  const my = y.reduce((s, v) => s + v, 0) / n;
  let sxy = 0;
  let sxx = 0;
  for (let i = 0; i < n; i++) {
    sxy += (x[i] - mx) * (y[i] - my);
    sxx += (x[i] - mx) ** 2;
  }
  return sxy / sxx;
}
function fmt(x, d = 3) {
  if (!Number.isFinite(x)) return String(x);
  if (x !== 0 && (Math.abs(x) < 1e-3 || Math.abs(x) >= 1e5)) return x.toExponential(2);
  return x.toFixed(d);
}
function now() {
  return performance.now();
}
function poseHash(bodies) {
  const f = new Float32Array(13 * bodies.length);
  bodies.forEach((b, i) => {
    const t = b.translation();
    const q = b.rotation();
    const v = b.linvel();
    const a = b.angvel();
    f.set([t.x, t.y, t.z, q.x, q.y, q.z, q.w, v.x, v.y, v.z, a.x, a.y, a.z], i * 13);
  });
  const u = new Uint8Array(f.buffer);
  let h = 2166136261;
  for (const b of u) h = Math.imul(h ^ b, 16777619) >>> 0;
  return h.toString(16);
}

// spikes/wheels/roll.ts
var argv = process.argv.slice(2);
var TEST = argv[0] ?? "all";
var KINDS = (argv[1] ?? "cyl,rcyl,p16,p32,p64").split(",");
var RADII = (argv[2] ?? "0.5,1,1.5,2,2.5,3,3.5,4").split(",").map(Number);
var GROUNDS = (argv[3] ?? "half,box,armFlat,armEdge").split(",");
var ITERS = Number(argv[4] ?? 30);
function massProps(rb) {
  return { m: rb.mass(), I: worldInertia(rb)[8] };
}
function flat(kind, r, ground) {
  const w = makeWorld(ITERS);
  addGround(w, ground, -20, 220);
  const v0 = 40;
  const rb = addWheel(w, kind, r, [0, r, 0]);
  rb.setLinvel({ x: v0, y: 0, z: 0 }, true);
  rb.setAngvel({ x: 0, y: 0, z: -v0 / r }, true);
  const ys = [];
  const vs = [];
  const slips = [];
  const t0 = now();
  const N = Math.round(4 / DT);
  for (let i = 0; i < N; i++) {
    w.step();
    if (i * DT < 0.25) continue;
    const t2 = rb.translation();
    const v = rb.linvel();
    const a = rb.angvel();
    ys.push(t2.y);
    vs.push(v.x);
    slips.push(v.x + a.z * r);
  }
  const ms = now() - t0;
  const t = rb.translation();
  const ax = axisOf(rb);
  const sy = stats(ys);
  const sv = stats(vs);
  const ss = stats(slips.map(Math.abs));
  const yaw = Math.atan2(ax[0], ax[2]);
  const camber = Math.asin(Math.max(-1, Math.min(1, ax[1])));
  w.free();
  return [kind, r, ground, fmt(sy.mean - r, 4), fmt(sy.max - sy.min, 4), fmt(sv.mean, 2), fmt(sv.std / sv.mean, 4), fmt(vs[vs.length - 1] / v0, 4), fmt(ss.mean, 4), fmt(t.x, 1), fmt(t.z, 4), fmt(yaw, 5), fmt(camber, 5), fmt(ms / 4, 1)].join("	");
}
function incline(kind, r, ground, deg) {
  const w = makeWorld(ITERS, deg);
  addGround(w, ground, -20, 420);
  const rb = addWheel(w, kind, r, [0, r, 0]);
  const { m, I } = massProps(rb);
  const th = deg * Math.PI / 180;
  const aTh = G * Math.sin(th) / (1 + I / (m * r * r));
  const T = Math.min(1, Math.sqrt(2 * 300 / Math.max(aTh, 1)), 300 / Math.max(aTh, 1));
  const ts = [];
  const vs = [];
  let maxSlip = 0;
  const N = Math.round(T / DT);
  for (let i = 1; i <= N; i++) {
    w.step();
    const t = i * DT;
    const v = rb.linvel();
    const a2 = rb.angvel();
    if (t > 0.1) {
      ts.push(t);
      vs.push(v.x);
    }
    maxSlip = Math.max(maxSlip, Math.abs(v.x + a2.z * r) / Math.max(1e-9, Math.abs(v.x)));
  }
  const a = slope(ts, vs);
  const ax = axisOf(rb);
  const z = rb.translation().z;
  w.free();
  return [kind, r, ground, deg, fmt(I / (m * r * r), 4), fmt(aTh, 2), fmt(a, 2), fmt(a / aTh - 1, 4), fmt(maxSlip, 4), fmt(Math.atan2(ax[0], ax[2]), 5), fmt(z, 4), fmt(T, 3)].join("	");
}
function rest(kind, r, ground) {
  const w = makeWorld(ITERS);
  addGround(w, ground, -20, 60);
  const rb = addWheel(w, kind, r, [0.3, r, 0]);
  let maxV = 0;
  for (let i = 0; i < Math.round(5 / DT); i++) {
    w.step();
    if (i * DT > 0.5) maxV = Math.max(maxV, Math.hypot(rb.linvel().x, rb.linvel().y, rb.linvel().z));
  }
  const t = rb.translation();
  const ax = axisOf(rb);
  w.free();
  return [kind, r, ground, fmt(t.x - 0.3, 6), fmt(t.y - r, 5), fmt(t.z, 6), fmt(maxV, 5), fmt(Math.acos(Math.min(1, Math.abs(ax[2]))), 6)].join("	");
}
function lie(kind, r, ground) {
  const w = makeWorld(ITERS);
  addGround(w, ground, -20, 60);
  const rb = addWheel(w, kind, r, [0.25, 0.5, 0], { rot: { x: -Math.SQRT1_2, y: 0, z: 0, w: Math.SQRT1_2 } });
  let maxV = 0;
  for (let i = 0; i < Math.round(3 / DT); i++) {
    w.step();
    if (i * DT > 0.5) maxV = Math.max(maxV, Math.hypot(rb.linvel().x, rb.linvel().y, rb.linvel().z));
  }
  const t = rb.translation();
  const ax = axisOf(rb);
  w.free();
  return [kind, r, ground, fmt(t.y - 0.5, 5), fmt(Math.acos(Math.min(1, Math.abs(ax[1]))), 6), fmt(Math.hypot(t.x - 0.25, t.z), 5), fmt(maxV, 5)].join("	");
}
function drop(kind, r, ground, tiltDeg) {
  const w = makeWorld(ITERS);
  addGround(w, ground, -40, 80);
  const th = tiltDeg * Math.PI / 180;
  const rotq = { x: -Math.sin(th / 2), y: 0, z: 0, w: Math.cos(th / 2) };
  const low = (ay2) => r * Math.sqrt(Math.max(0, 1 - ay2 * ay2)) + 0.5 * Math.abs(ay2);
  const rb = addWheel(w, kind, r, [0.2, 10 + low(Math.sin(th)), 0], { rot: rotq });
  let pen = 0;
  let hit = false;
  let rebound = 0;
  let vMaxAfter = 0;
  for (let i = 0; i < Math.round(3 / DT); i++) {
    w.step();
    const t2 = rb.translation();
    const ax2 = axisOf(rb);
    const bottom = t2.y - low(ax2[1]);
    if (bottom < 0.05) hit = true;
    pen = Math.min(pen, bottom);
    if (hit) rebound = Math.max(rebound, bottom);
    if (i * DT > 2.5) vMaxAfter = Math.max(vMaxAfter, Math.hypot(rb.linvel().x, rb.linvel().y, rb.linvel().z));
  }
  const t = rb.translation();
  const ax = axisOf(rb);
  const ay = Math.abs(ax[1]);
  w.free();
  return [kind, r, ground, tiltDeg, fmt(pen, 4), fmt(rebound, 3), fmt(t.y - low(ay), 4), ay > 0.99 ? "flat" : ay < 0.01 ? "edge" : `ax_y=${fmt(ay, 3)}`, fmt(vMaxAfter, 3), fmt(Math.hypot(t.x, t.z), 2)].join("	");
}
function spin(kind, r) {
  const w = makeWorld(ITERS);
  addGround(w, "half");
  const v0 = 380;
  const rb = addWheel(w, kind, r, [0, r, 0]);
  rb.setLinvel({ x: v0, y: 0, z: 0 }, true);
  rb.setAngvel({ x: 0, y: 0, z: -v0 / r }, true);
  for (let i = 0; i < 480; i++) w.step();
  const v = rb.linvel().x;
  const om = -rb.angvel().z;
  w.free();
  return [kind, r, fmt(v, 1), fmt(om, 1), fmt(om * r, 1), fmt((v - om * r) / v, 4)].join("	");
}
async function main() {
  await init();
  const want = (t) => TEST === "all" || TEST === t;
  console.log(`# iterations ${ITERS}`);
  if (want("flat")) {
    console.log("## flat: roll at v0 = 40 u/s for 4 s (stats after 0.25 s)");
    console.log("kind	r	ground	mean(y-r)	y p-p	mean vx	std(vx)/mean	v_end/v0	mean|slip|	x_end	z_end	yaw	camber	ms/sim-s");
    for (const k of KINDS) for (const r of RADII) for (const g of GROUNDS) console.log(flat(k, r, g));
  }
  if (want("incline")) {
    console.log("## incline: from rest; analytic a = g sin\u03B8 / (1 + I/(m r\xB2)) with the engine m, I");
    console.log("kind	r	ground	deg	I/mr\xB2	a_analytic	a_meas	rel.err	max slip/v	yaw	z_end	T");
    for (const k of KINDS) for (const r of RADII) for (const g of GROUNDS) for (const d of [5, 15, 30]) console.log(incline(k, r, g, d));
  }
  if (want("rest")) {
    console.log("## rest: placed at rest, 5 s");
    console.log("kind	r	ground	dx	y-r	dz	max|v| after 0.5s	axis tilt");
    for (const k of KINDS) for (const r of RADII) for (const g of GROUNDS) console.log(rest(k, r, g));
  }
  if (want("lie")) {
    console.log("## lie flat on its face, 3 s");
    console.log("kind	r	ground	y-0.5	tilt	drift	max|v| after 0.5s");
    for (const k of KINDS) for (const r of RADII) for (const g of GROUNDS) console.log(lie(k, r, g));
  }
  if (want("drop")) {
    console.log("## drop from 10 units (impact speed \u221A(2g\xB710) = 156.6 u/s)");
    console.log("kind	r	ground	tilt\xB0	min bottom	rebound	final bottom	final	max|v| 2.5-3s	drift");
    for (const k of KINDS) for (const r of RADII) for (const g of GROUNDS) for (const tl of [0, 30, 90]) console.log(drop(k, r, g, tl));
  }
  if (want("spin")) {
    console.log("## caps: v0 = 380 u/s on half-space, after 1 s");
    console.log("kind	r	v	\u03C9	\u03C9\xB7r	slip");
    for (const k of KINDS) for (const r of RADII) console.log(spin(k, r));
  }
  if (want("det")) {
    const run = () => {
      const w = makeWorld(ITERS, 15);
      addGround(w, "armFlat", -20, 220);
      const rb = addWheel(w, "cyl", 1.5, [0, 1.5, 0]);
      for (let i = 0; i < 960; i++) w.step();
      const h = poseHash([rb]);
      w.free();
      return h;
    };
    console.log("## determinism (cyl r 1.5 on armFlat 15\xB0, 2 s): hashes", run(), run());
  }
}
void main();
