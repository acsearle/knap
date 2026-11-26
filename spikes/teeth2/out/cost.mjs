// spikes/teeth2/lib.ts
import RAPIER from "@dimforge/rapier3d-compat";

// src/geometry/dims.ts
var H = 0.47;
var E_FREE = 0.48;
var EPS = 5e-3;
var E_CONN = 0.5 + EPS;
var HC = 0.46;
var R_COLL_ROD = 0.29;
var RIM_INSET = 0.5 - H;
var RIM_COLL_INSET = 0.5 - HC;

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
  const hole2 = ma ? b : a;
  return male.axis === n && hole2.axis !== n;
}

// src/core/model.ts
function posKey(x, y, z) {
  return `${x},${y},${z}`;
}
var RIM_MAX = 4;
var EMPTY = Object.freeze([]);
var RIM_BUCKET = 2 * RIM_MAX;

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
function isHub(c) {
  return c.rim !== void 0 && isHole(c.kind);
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
    if (isHub(c)) {
      out.push({ shape: "disc", center: [ctr[0], ctr[1], ctr[2]], axis: a, radius: c.rim - RIM_COLL_INSET, halfLength: HC, innerRadius: HC, cell: t.index, male: false });
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
var WHEEL_SEGMENTS = 32;
var WHEEL_BEVEL = 0.02;
var GUARD_INSET_R = 0.12;
var GUARD_INSET_A = 0.02;
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
function bevelledPrism(center, axis, u, halfLength, poly, bevel = BEVEL) {
  const v = 3 - axis - u;
  const points = [];
  for (const q of poly)
    for (const s of [-1, 1]) {
      const p = [center[0], center[1], center[2]];
      p[u] += q.u;
      p[v] += q.v;
      p[axis] += s * (q.keep ? halfLength : halfLength - bevel);
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
function prismShape(center, axis, radius, halfLength, segments, u, runLength = 0, bevel = BEVEL) {
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
  return bevelledPrism(center, axis, u, halfLength, poly, bevel);
}
function wheelShape(center, axis, radius, halfLength, innerRadius, rim) {
  const L = 2 * halfLength;
  const volume = Math.PI * (radius * radius - innerRadius * innerRadius) * L;
  const r2 = radius * radius + innerRadius * innerRadius;
  const inertia = [0, 0, 0];
  for (let k = 0; k < 3; k++) inertia[k] = k === axis ? volume * r2 / 2 : volume * (3 * r2 + L * L) / 12;
  const u = (axis + 1) % 3;
  const hull = prismShape(center, axis, radius, halfLength, WHEEL_SEGMENTS, u, 0, WHEEL_BEVEL * rim).points;
  const inR = (radius - GUARD_INSET_R) * Math.cos(Math.PI / WHEEL_SEGMENTS);
  const guard = prismShape(center, axis, inR, halfLength - GUARD_INSET_A, WHEEL_SEGMENTS, u, 0, WHEEL_BEVEL * rim).points;
  return { kind: "wheel", center: [...center], axis, radius, halfLength, innerRadius, rim, mass: { volume, com: [...center], inertia }, hull, guard };
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
    if (p.shape === "disc") {
      out.push(wheelShape(w(p.center), p.axis, p.radius, p.halfLength, p.innerRadius, p.radius + RIM_COLL_INSET));
      continue;
    }
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

// spikes/teeth2/lib.ts
var G = 1226.25;
var DT = 1 / 480;
var ITER = 240;
var BASE_ITER = 30;
var HC2 = 0.46;
var ANG_X = 3;
var BIT = { GROUND: 1, TOOTH: 2, SMOOTH: 4, PART: 8, PAWL: 16, NONE: 0 };
var grp = (m, f) => (m & 65535) << 16 | f & 65535;
var G_TOOTH = grp(BIT.TOOTH, BIT.PAWL);
var G_SMOOTH = grp(BIT.SMOOTH, BIT.GROUND | BIT.PART);
var G_PART = grp(BIT.PART, BIT.GROUND | BIT.PART | BIT.SMOOTH | BIT.PAWL);
var G_PAWL = grp(BIT.PAWL, BIT.GROUND | BIT.PART | BIT.TOOTH | BIT.PAWL);
var G_GROUND = grp(BIT.GROUND, BIT.PART | BIT.SMOOTH | BIT.PAWL);
var G_NONE = grp(0, 0);
var MOD = 0.125;
function gear(r, T = Math.round(16 * r)) {
  return { r, T, tip: r + MOD, root: r - 1.25 * MOD, D: 2 * Math.PI / T };
}
var PA = 20 * Math.PI / 180;
function toothPoly(g, k) {
  const p = MOD * Math.PI;
  const w = (rho) => p / 4 - (rho - g.r) * Math.tan(PA);
  const rb = g.root - 0.03;
  const c = (k + 0.5) * g.D;
  const loc = [
    [rb, -w(rb)],
    [g.tip, -w(g.tip)],
    [g.tip, w(g.tip)],
    [rb, w(rb)]
  ];
  return loc.map(([x, y]) => [x * Math.cos(c) - y * Math.sin(c), x * Math.sin(c) + y * Math.cos(c)]);
}
var prismPts = (poly, hz) => {
  const a = new Float32Array(poly.length * 6);
  poly.forEach(([x, y], i) => {
    a.set([x, y, -hz], i * 6);
    a.set([x, y, hz], i * 6 + 3);
  });
  return a;
};
var hullPts = (sh) => new Float32Array(sh.points.flat());
var rootHull = (g) => hullPts(prismShape([0, 0, 0], 2, g.root, HC2, g.T, 0));
var smoothHull = (R) => hullPts(prismShape([0, 0, 0], 2, R, HC2, 32, 0, 0, 0.02 * R));
function outline(g) {
  const out = [];
  const Rr = g.root / Math.cos(Math.PI / g.T);
  for (let k = 0; k < g.T; k++) {
    const a0 = k * g.D;
    out.push([g.root * Math.cos(a0), g.root * Math.sin(a0)]);
    const t = toothPoly(g, k);
    const lift = (pt, toward) => {
      for (let s = 0; s <= 1; s += 0.02) {
        const q = [pt[0] + (toward[0] - pt[0]) * s, pt[1] + (toward[1] - pt[1]) * s];
        if (Math.hypot(q[0], q[1]) >= g.root + 0.01) return q;
      }
      return toward;
    };
    out.push(lift(t[0], t[1]), t[1], t[2], lift(t[3], t[2]));
  }
  void Rr;
  return out;
}
function gearDescs(g, o) {
  const out = [];
  const tg = o.toothGroup ?? G_TOOTH;
  const fin = (d) => d.setFriction(o.friction ?? 0.4).setRestitution(0.1).setDensity(0).setCollisionGroups(tg);
  const hulls = () => {
    const hs = [rootHull(g)];
    for (let k = 0; k < g.T; k += o.rep === "half" ? 2 : 1) hs.push(prismPts(toothPoly(g, k), HC2));
    return hs;
  };
  switch (o.rep) {
    case "hull":
    case "half":
      for (const h of hulls()) out.push(fin(RAPIER.ColliderDesc.convexHull(h)));
      break;
    case "compound": {
      const shapes = hulls().map((h) => new RAPIER.ConvexPolyhedron(h, null));
      out.push(fin(RAPIER.ColliderDesc.compound(shapes, shapes.map(() => ({ x: 0, y: 0, z: 0 })), shapes.map(() => ({ x: 0, y: 0, z: 0, w: 1 })))));
      break;
    }
    case "box":
    case "capsule": {
      out.push(fin(RAPIER.ColliderDesc.convexHull(rootHull(g))));
      const p = MOD * Math.PI;
      const rb = g.root - 0.03;
      for (let k = 0; k < g.T; k++) {
        const c = (k + 0.5) * g.D;
        const q = { x: 0, y: 0, z: Math.sin(c / 2), w: Math.cos(c / 2) };
        if (o.rep === "box") {
          const hw = p / 4 - ((g.tip + rb) / 2 - g.r) * Math.tan(PA);
          const hr = (g.tip - rb) / 2;
          const m = (g.tip + rb) / 2;
          out.push(fin(RAPIER.ColliderDesc.cuboid(hr, hw, HC2).setTranslation(m * Math.cos(c), m * Math.sin(c), 0).setRotation(q)));
        } else {
          const rad = p / 4 - (g.tip - 0.06 - g.r) * Math.tan(PA) + 0.01;
          const m = g.tip - rad;
          const qz2 = { x: Math.SQRT1_2, y: 0, z: 0, w: Math.SQRT1_2 };
          out.push(fin(RAPIER.ColliderDesc.capsule(HC2 - rad, rad).setTranslation(m * Math.cos(c), m * Math.sin(c), 0).setRotation(qz2)));
        }
      }
      break;
    }
    case "trimesh": {
      const ol = outline(g);
      const n = ol.length;
      const v = [];
      for (const [x, y] of ol) v.push(x, y, -HC2);
      for (const [x, y] of ol) v.push(x, y, HC2);
      v.push(0, 0, -HC2, 0, 0, HC2);
      const cb = 2 * n, ct = 2 * n + 1;
      const idx = [];
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        idx.push(i, j, n + j, i, n + j, n + i);
        idx.push(cb, j, i);
        idx.push(ct, n + i, n + j);
      }
      out.push(fin(RAPIER.ColliderDesc.trimesh(new Float32Array(v), new Uint32Array(idx))));
      break;
    }
    case "polyline": {
      const ol = outline(g);
      const v = [];
      for (const [x, y] of ol) v.push(x, y, 0);
      v.push(ol[0][0], ol[0][1], 0);
      out.push(fin(RAPIER.ColliderDesc.polyline(new Float32Array(v))));
      break;
    }
    case "smooth":
      out.push(fin(RAPIER.ColliderDesc.convexHull(smoothHull(g.tip))));
      break;
    case "none":
      break;
  }
  if (o.smooth) out.push(RAPIER.ColliderDesc.convexHull(smoothHull(g.tip - 0.02)).setDensity(0).setFriction(0.4).setRestitution(0.1).setCollisionGroups(o.smoothGroup ?? G_SMOOTH));
  const qz = { x: Math.SQRT1_2, y: 0, z: 0, w: Math.SQRT1_2 };
  out.push(RAPIER.ColliderDesc.cylinder(HC2, Math.max(g.r, 0.47)).setRotation(qz).setDensity(1).setCollisionGroups(G_NONE));
  return out;
}
function partDescs(parts, o, group = G_PAWL, friction = 0.4) {
  const out = [];
  for (const part of parts)
    for (const sh of partShapes(part, 16)) {
      if (sh.kind === "hull") {
        const pts = new Float32Array(sh.points.flatMap((p) => [p[0] - o[0], p[1] - o[1], p[2] - o[2]]));
        out.push(RAPIER.ColliderDesc.convexHull(pts));
      } else if (sh.kind === "box") {
        out.push(RAPIER.ColliderDesc.cuboid(sh.halfExtents[0], sh.halfExtents[1], sh.halfExtents[2]).setTranslation(sh.center[0] - o[0], sh.center[1] - o[1], sh.center[2] - o[2]));
      } else throw new Error("wheel shape not expected");
    }
  return out.map((d) => d.setDensity(1).setFriction(friction).setRestitution(0.1).setCollisionGroups(group));
}
var pid = 1;
var mkPart = (cells) => ({ id: pid++, color: "#888888", cells });
var hole = (x, y, z, axis = 2, kind = "pinHole") => ({ x, y, z, kind, axis });
function pawlParts(kind, l) {
  const cells = [];
  if (kind === "end") {
    for (let k = 0; k <= l; k++) cells.push(hole(k, 0, 0));
    return { parts: [mkPart(cells)], pivotZ: 0 };
  }
  if (kind === "rod") {
    for (let k = 0; k <= l; k++) cells.push(hole(k, 0, 1, 2, k === l ? "axleHole" : "pinHole"));
    const axle = mkPart([{ x: l, y: 0, z: 1, kind: "axle", axis: 2 }, { x: l, y: 0, z: 0, kind: "axle", axis: 2 }]);
    return { parts: [mkPart(cells), axle], pivotZ: 1 };
  }
  if (kind === "corner") {
    for (let k = 0; k < l; k++) cells.push(hole(k, 0, 0));
    cells.push(hole(l, 0, 0, 0));
    return { parts: [mkPart(cells)], pivotZ: 0 };
  }
  for (let k = 0; k < l; k++) cells.push(hole(k, 0, 0));
  cells.push({ x: l, y: 0, z: 0, kind: "pin", axis: 0 });
  return { parts: [mkPart(cells)], pivotZ: 0 };
}
function makeWorld(o = {}) {
  const w = new RAPIER.World({ x: 0, y: -G, z: 0 });
  w.timestep = o.dt ?? DT;
  w.numSolverIterations = Math.min(BASE_ITER, o.iters ?? ITER);
  w.numInternalPgsIterations = 1;
  w.integrationParameters.maxCcdSubsteps = 0;
  return w;
}
var fixed = (w) => w.createRigidBody(RAPIER.RigidBodyDesc.fixed());
function body(w, p, alpha, descs, iters = ITER) {
  const rb = w.createRigidBody(
    RAPIER.RigidBodyDesc.dynamic().setCanSleep(false).setTranslation(p[0], p[1], p[2]).setRotation({ x: 0, y: 0, z: Math.sin(alpha / 2), w: Math.cos(alpha / 2) }).setAdditionalSolverIterations(Math.max(0, iters - BASE_ITER))
  );
  for (const d of descs) w.createCollider(d, rb);
  return rb;
}
function revZ(w, f, b, at) {
  const bt = b.translation();
  const ang = angleZ(b);
  const d = [at[0] - bt.x, at[1] - bt.y, at[2] - bt.z];
  const c = Math.cos(-ang), s = Math.sin(-ang);
  const loc = { x: c * d[0] - s * d[1], y: s * d[0] + c * d[1], z: d[2] };
  const j = w.createImpulseJoint(RAPIER.JointData.revolute({ x: at[0], y: at[1], z: at[2] }, loc, { x: 0, y: 0, z: 1 }), f, b, true);
  j.setContactsEnabled(false);
  return j;
}
function vmotor(w, j, omega, maxTorque) {
  const raw = w.impulseJoints.raw;
  raw.jointConfigureMotorModel(j.handle, ANG_X, 0);
  raw.jointConfigureMotorVelocity(j.handle, ANG_X, omega, 1e9);
  raw.jointSetMotorMaxForce(j.handle, ANG_X, maxTorque);
}
var angleZ = (rb) => {
  const q = rb.rotation();
  return 2 * Math.atan2(q.z, q.w);
};
function contactStats(w) {
  let pairs = 0, points = 0;
  w.colliders.forEach((c1) => {
    w.contactPairsWith(c1, (c2) => {
      if (c1.handle >= c2.handle) return;
      w.contactPair(c1, c2, (m) => {
        const n = m.numContacts();
        if (n > 0) pairs++;
        points += n;
      });
    });
  });
  return { pairs, points };
}
var cpu = () => {
  const u = process.cpuUsage();
  return (u.user + u.system) / 1e3;
};
var median = (a) => {
  const s = [...a].sort((x, y) => x - y);
  return s[Math.floor(s.length / 2)];
};
var fmt = (x, d = 3) => x === void 0 || Number.isNaN(x) ? "-" : Number.isFinite(x) ? (+x).toPrecision(d) : x > 0 ? "inf" : "-inf";

// spikes/teeth2/cost.ts
await RAPIER.init();
var ROUNDS = Number(process.argv[2] ?? 5);
var STEPS = Number(process.argv[3] ?? 150);
var REPS = ["none", "smooth", "hull", "half", "compound", "box", "capsule", "trimesh", "polyline"];
var SC = ["idle", "pawl", "ground", "beam"];
var T_ALL = grp(BIT.TOOTH, BIT.PAWL | BIT.PART | BIT.GROUND);
function build(g, rep, sc) {
  const w = makeWorld();
  const f = fixed(w);
  if (sc === "ground") {
    w.createCollider(RAPIER.ColliderDesc.cuboid(20, 0.5, 20).setTranslation(0, -0.5, 0).setCollisionGroups(grp(BIT.GROUND, 65535)).setFriction(0.4), f);
    const descs2 = gearDescs(g, { rep, toothGroup: rep === "smooth" ? grp(BIT.SMOOTH, BIT.GROUND) : T_ALL });
    const rb = w.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic().setCanSleep(false).setTranslation(0.3, 0.465, 0.2).setRotation({ x: -Math.SQRT1_2, y: 0, z: 0, w: Math.SQRT1_2 }).setSoftCcdPrediction(400 * DT * 1.25)
    );
    for (const d of descs2) w.createCollider(d, rb);
    rb.setAngvel({ x: 0, y: 3, z: 0 }, true);
    return w;
  }
  const descs = gearDescs(g, { rep, toothGroup: T_ALL });
  const gb = body(w, [0, 0, 0], 0, descs);
  const j = revZ(w, f, gb, [0, 0, 0]);
  vmotor(w, j, sc === "idle" ? 20 : 3, 1e6);
  if (sc === "pawl") {
    const Y = Math.ceil(g.tip + 0.47);
    const { parts } = pawlParts("end", 2);
    const pb = body(w, [2, Y, 0], Math.PI, partDescs(parts, [0, 0, 0], G_PAWL));
    revZ(w, f, pb, [2, Y, 0]);
  }
  if (sc === "beam") {
    const Y = g.tip + 0.47;
    const cells = Array.from({ length: 7 }, (_, k) => ({ x: k - 3, y: 0, z: 0, kind: "pinHole", axis: 2 }));
    const rb = w.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setCanSleep(false).setTranslation(0, Y, 0).setAdditionalSolverIterations(210));
    for (const d of partDescs([mkPart(cells)], [0, 0, 0], grp(BIT.PART, BIT.TOOTH | BIT.PART))) w.createCollider(d, rb);
    const jd = RAPIER.JointData.generic({ x: 0, y: Y, z: 0 }, { x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, RAPIER.JointAxesMask.LinX | RAPIER.JointAxesMask.LinZ | RAPIER.JointAxesMask.AngX | RAPIER.JointAxesMask.AngY);
    w.createImpulseJoint(jd, f, rb, true).setContactsEnabled(false);
  }
  return w;
}
var rows = [];
console.log(`load: ${(await import("node:os")).loadavg().map((x) => x.toFixed(1)).join(" ")}`);
for (const r of [0.5, 1, 1.5, 2.5]) {
  const g = gear(r);
  for (const sc of SC) {
    const worlds = REPS.map((rep) => build(g, rep, sc));
    for (const w of worlds) for (let i = 0; i < 240; i++) w.step();
    const times = REPS.map(() => []);
    for (let k = 0; k < ROUNDS; k++)
      for (let i = 0; i < worlds.length; i++) {
        const w = worlds[i];
        const t0 = cpu();
        for (let s = 0; s < STEPS; s++) w.step();
        times[i].push((cpu() - t0) / STEPS);
      }
    const base = median(times[0]);
    for (let i = 0; i < worlds.length; i++) {
      const w = worlds[i];
      const cs = contactStats(w);
      let nc = 0;
      w.colliders.forEach(() => nc++);
      const ms = median(times[i]);
      const line = `r${r} T${g.T} ${sc.padEnd(6)} ${REPS[i].padEnd(8)} colliders ${String(nc).padStart(3)}  cpu ms/step ${fmt(ms)}  (x${fmt(ms / base)} of no-collider gear)  pairs ${cs.pairs} points ${cs.points}`;
      console.log(line);
      rows.push(line);
      w.free();
    }
  }
}
process.exit(0);
