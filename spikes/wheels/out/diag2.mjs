// spikes/wheels/lib.ts
import RAPIER from "@dimforge/rapier3d-compat";

// src/geometry/dims.ts
var E_FREE = 0.48;
var EPS = 5e-3;
var E_CONN = 0.5 + EPS;
var HC = 0.46;
var R_COLL_ROD = 0.29;

// src/core/rules.ts
function isMale(kind2) {
  return kind2 === "axle" || kind2 === "pin" || kind2 === "frictionPin";
}
function isHole(kind2) {
  return kind2 === "pinHole" || kind2 === "axleHole";
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
  const n2 = axisOfDir(dir);
  const ma = isMale(a.kind);
  const mb = isMale(b.kind);
  if (!ma && !mb) return true;
  if (ma && mb) return a.axis === n2 && b.axis === n2;
  const male = ma ? a : b;
  const hole = ma ? b : a;
  return male.axis === n2 && hole.axis !== n2;
}

// src/core/model.ts
function posKey(x, y, z) {
  return `${x},${y},${z}`;
}
function makeCell(x, y, z, kind2, axis2) {
  return { x, y, z, kind: kind2, axis: axis2 };
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
    const n2 = this.at(x, y, z);
    return n2 !== void 0 && isHole(n2.kind);
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
function plusDir(axis2) {
  return axis2 * 2;
}
function minusDir(axis2) {
  return axis2 * 2 + 1;
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
      const n2 = axisOfDir(d);
      const center = [ctr[0] + v[0] * 0.25, ctr[1] + v[1] * 0.25, ctr[2] + v[2] * 0.25];
      const halfExtents = [HC, HC, HC];
      halfExtents[n2] = 0.25;
      out.push({ shape: "box", center, halfExtents, cell: t.index, male: false });
    }
  }
  return out;
}
function cyl(ctr, axis2, radius, lo, hi, cell, male) {
  const center = [ctr[0], ctr[1], ctr[2]];
  center[axis2] += (lo + hi) / 2;
  return { shape: "cylinder", center, axis: axis2, radius, halfLength: (hi - lo) / 2, cell, male };
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
function bevelledPrism(center, axis2, u, halfLength, poly) {
  const v = 3 - axis2 - u;
  const points = [];
  for (const q of poly)
    for (const s of [-1, 1]) {
      const p = [center[0], center[1], center[2]];
      p[u] += q.u;
      p[v] += q.v;
      p[axis2] += s * (q.keep ? halfLength : halfLength - BEVEL);
      points.push(p);
    }
  const m = polyMoments(poly.map((q) => [q.u, q.v]));
  const L = 2 * halfLength;
  const volume = m.A * L;
  const com = [center[0], center[1], center[2]];
  com[u] += m.cu;
  com[v] += m.cv;
  const inertia = [0, 0, 0];
  inertia[axis2] = (m.Iuu + m.Ivv) * L;
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
function prismShape(center, axis2, radius, halfLength, segments, u, runLength = 0) {
  checkSegments(segments);
  if (u === axis2) throw new Error("u must be transverse to the axis");
  const R = radius / Math.cos(Math.PI / segments);
  const n2 = segments;
  const j = runLength > 0 ? n2 / 4 - 1 : keepIndex(n2);
  const keepSet = /* @__PURE__ */ new Set([j, n2 / 2 - 1 - j, n2 / 2 + j, n2 - 1 - j]);
  const poly = [];
  for (let i = 0; i < n2; i++) {
    const g = gonVertex(R, n2, i);
    const plusU = g.u > 0;
    poly.push({ u: g.u + (plusU ? runLength : 0), v: g.v, keep: keepSet.has(i) });
  }
  return bevelledPrism(center, axis2, u, halfLength, poly);
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
  const plainAt = (x, y, z, axis2) => {
    const i = byPos.get(`${x},${y},${z}`);
    return i !== void 0 && plain.has(i) && cells[i].axis === axis2 ? i : void 0;
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
      let n2 = 0;
      while (plainAt(...step(n2 + 1), c.axis) !== void 0) n2++;
      if (n2 === 0) continue;
      const run = [];
      for (let k = 0; k <= n2; k++) run.push(plainAt(...step(k), c.axis));
      run.forEach((ci, k) => {
        coveredBarrel.add(ci);
        if (k > 0) coveredWeb.add(`${ci}:${d}:-1`);
        if (k < n2) coveredWeb.add(`${ci}:${d}:1`);
      });
      const first = plain.get(run[0]);
      out.push(prismShape(w(first.center), c.axis, first.radius, first.halfLength, segments, d, n2));
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
  const n2 = Math.max(...d.map(Math.abs));
  const step = d.map(Math.sign);
  const out = [];
  for (let i = 0; i <= n2; i++) out.push([from[0] + step[0] * i, from[1] + step[1] * i, from[2] + step[2] * i]);
  return out;
}
function holes(from, to, holeAxis = 2, kind2 = "pinHole") {
  return runBetween(from, to).map((p) => makeCell(p[0], p[1], p[2], kind2, holeAxis));
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
function bevelPrism(r2, h, n2, bevel) {
  const R = r2 / Math.cos(Math.PI / n2);
  let best = 0;
  for (let i = 0; i < n2 / 4; i++) if (Math.abs((i + 0.5) / n2 * 360 - 56.25) < Math.abs((best + 0.5) / n2 * 360 - 56.25)) best = i;
  const keep = /* @__PURE__ */ new Set([best, n2 / 2 - 1 - best, n2 / 2 + best, n2 - 1 - best]);
  const pts = [];
  for (let i = 0; i < n2; i++) {
    const a = (i + 0.5) / n2 * 2 * Math.PI;
    for (const s of [-1, 1]) pts.push(R * Math.cos(a), R * Math.sin(a), s * (keep.has(i) ? h : h - bevel));
  }
  const A = 0.5 * n2 * R * R * Math.sin(2 * Math.PI / n2);
  const L = 2 * h;
  const J = A * R * R * (2 + Math.cos(2 * Math.PI / n2)) / 6;
  const volume = A * L;
  const Ixx = J / 2 * L + volume * L * L / 12;
  return { pts: new Float32Array(pts), volume, inertia: [Ixx, Ixx, J * L] };
}
var ROUND_BORDER = 0.05;
function wheelColliders(kind2, r2, at = [0, 0, 0]) {
  let cd;
  if (kind2 === "hyb") {
    const c = RAPIER.ColliderDesc.cylinder(0.5, r2).setRotation(Y_TO_Z).setDensity(1).setCollisionGroups(GRP.ROUND);
    const p = bevelPrism(r2, 0.5, 32, WHEEL_BEVEL);
    const h = RAPIER.ColliderDesc.convexHull(p.pts).setDensity(0).setCollisionGroups(GRP.HULL);
    for (const d of [c, h]) d.setTranslation(at[0], at[1], at[2]).setFriction(FRICTION).setRestitution(RESTITUTION);
    return [c, h];
  }
  if (kind2.startsWith("b")) {
    const p = bevelPrism(r2, 0.5, Number(kind2.slice(1)), WHEEL_BEVEL);
    cd = RAPIER.ColliderDesc.convexHull(p.pts);
    cd.setMassProperties(p.volume, { x: 0, y: 0, z: 0 }, { x: p.inertia[0], y: p.inertia[1], z: p.inertia[2] }, { x: 0, y: 0, z: 0, w: 1 });
  } else if (kind2 === "cyl") cd = RAPIER.ColliderDesc.cylinder(0.5, r2).setRotation(Y_TO_Z);
  else if (kind2 === "rcyl") cd = RAPIER.ColliderDesc.roundCylinder(0.5 - ROUND_BORDER, r2 - ROUND_BORDER, ROUND_BORDER).setRotation(Y_TO_Z);
  else {
    const round = kind2.startsWith("r");
    const n2 = Number(kind2.slice(round ? 2 : 1));
    const b = round ? ROUND_BORDER : 0;
    const sh = prismShape([0, 0, 0], 2, r2 - b, 0.5 - b, n2, 0);
    const full = prismShape([0, 0, 0], 2, r2, 0.5, n2, 0);
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
  if (kind2 === "cyl" || kind2 === "rcyl") cd.setDensity(1);
  return [cd];
}
function addWheel(w, kind2, r2, pos, opts = {}) {
  const desc = RAPIER.RigidBodyDesc.dynamic().setCanSleep(false).setTranslation(pos[0], pos[1], pos[2]);
  if (opts.rot) desc.setRotation(opts.rot);
  if (opts.extraIters) desc.setAdditionalSolverIterations(opts.extraIters);
  const rb = w.createRigidBody(desc);
  for (const cd of wheelColliders(kind2, r2)) w.createCollider(cd, rb);
  if (opts.softCcd ?? process.env.CCD !== "0") rb.setSoftCcdPrediction(SPEED_CAP * DT * 1.25);
  return rb;
}
function fmt(x, d = 3) {
  if (!Number.isFinite(x)) return String(x);
  if (x !== 0 && (Math.abs(x) < 1e-3 || Math.abs(x) >= 1e5)) return x.toExponential(2);
  return x.toFixed(d);
}

// spikes/wheels/diag2.ts
await init();
var kind = process.argv[2] ?? "cyl";
var r = Number(process.argv[3] ?? 1);
var n = Number(process.argv[4] ?? 15);
var axis = Number(process.argv[5] ?? 2);
for (const x of [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14].filter((x2) => x2 < n)) {
  const w = makeWorld(30);
  w.gravity = { x: 0, y: -1226.25, z: 0 };
  const g = w.createRigidBody(RAPIER.RigidBodyDesc.fixed());
  const ROWS = Number(process.env.ARM_ROWS ?? 5);
  let gc = null;
  for (let zr = -Math.floor(ROWS / 2); zr <= Math.floor((ROWS - 1) / 2); zr++) {
    const sh = partShapes({ id: 1, color: "#888888", cells: beam([0, 0, zr], [n - 1, 0, zr], axis) }, 16)[0];
    if (sh.kind !== "hull") throw 0;
    const pts = new Float32Array(sh.points.flatMap((p) => [p[0], p[1] - 0.46, p[2]]));
    const c = w.createCollider(RAPIER.ColliderDesc.convexHull(pts), g);
    if (zr === 0) gc = c;
  }
  const rb = addWheel(w, kind, r, [x, r, 0], { softCcd: process.env.CCD !== "0" });
  let nc = 0;
  for (let i = 0; i < 480; i++) w.step();
  w.contactPair(gc, rb.collider(0), (m) => nc = m.numContacts());
  console.log("x", x, "y-r", fmt(rb.translation().y - r, 4), "z", fmt(rb.translation().z, 3), "contacts", nc);
  w.free();
}
