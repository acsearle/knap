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
function dirBetween(a2, b) {
  const dx = b.x - a2.x;
  const dy = b.y - a2.y;
  const dz = b.z - a2.z;
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
function connects(a2, b) {
  const dir = dirBetween(a2, b);
  if (dir === null) return false;
  const n = axisOfDir(dir);
  const ma = isMale(a2.kind);
  const mb = isMale(b.kind);
  if (!ma && !mb) return true;
  if (ma && mb) return a2.axis === n && b.axis === n;
  const male = ma ? a2 : b;
  const hole2 = ma ? b : a2;
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
  for (const c2 of part.cells) {
    if (c2.x < x) x = c2.x;
    if (c2.y < y) y = c2.y;
    if (c2.z < z) z = c2.z;
  }
  if (part.cells.length === 0) return [0, 0, 0];
  return [x, y, z];
}
function localCenter(c2, origin) {
  return [c2.x - origin[0], c2.y - origin[1], c2.z - origin[2]];
}
var PartGrid = class {
  constructor(part) {
    this.part = part;
    for (const c2 of part.cells) this.map.set(posKey(c2.x, c2.y, c2.z), c2);
  }
  map = /* @__PURE__ */ new Map();
  at(x, y, z) {
    return this.map.get(posKey(x, y, z));
  }
  /** Is there a hole cell of this part at c + d1 + d2 (d2 optional)? */
  holeAt(c2, d1, d2 = null) {
    let x = c2.x;
    let y = c2.y;
    let z = c2.z;
    for (const d of [d1, d2]) {
      if (d === null) continue;
      const v2 = DIRS[d];
      x += v2[0];
      y += v2[1];
      z += v2[2];
    }
    const n = this.at(x, y, z);
    return n !== void 0 && isHole(n.kind);
  }
};
function analyzeCells(part, grid = new PartGrid(part)) {
  return part.cells.map((cell, index) => {
    const faces = [];
    for (let d = 0; d < 6; d++) {
      const v2 = DIRS[d];
      const nb = grid.at(cell.x + v2[0], cell.y + v2[1], cell.z + v2[2]);
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
  const a2 = t.cell.axis;
  const hi = t.faces[plusDir(a2)].connected ? E_CONN : E_FREE;
  const lo = t.faces[minusDir(a2)].connected ? -E_CONN : -E_FREE;
  return [lo, hi];
}
function isHub(c2) {
  return c2.rim !== void 0 && isHole(c2.kind);
}

// src/geometry/colliders.ts
function partColliders(part) {
  const origin = partOrigin(part);
  const out2 = [];
  for (const t of analyzeCells(part)) {
    const c2 = t.cell;
    const ctr = localCenter(c2, origin);
    const a2 = c2.axis;
    if (isMale(c2.kind)) {
      const [lo2, hi2] = rodExtent(t);
      out2.push(cyl(ctr, a2, R_COLL_ROD, lo2, hi2, t.index, true));
      continue;
    }
    const hi = t.faces[plusDir(a2)].connected ? 0.5 : HC;
    const lo = t.faces[minusDir(a2)].connected ? -0.5 : -HC;
    out2.push(cyl(ctr, a2, HC, lo, hi, t.index, false));
    for (let d = 0; d < 6; d = d + 1) {
      if (axisOfDir(d) === a2 || !t.faces[d].connected) continue;
      const v2 = DIRS[d];
      const n = axisOfDir(d);
      const center = [ctr[0] + v2[0] * 0.25, ctr[1] + v2[1] * 0.25, ctr[2] + v2[2] * 0.25];
      const halfExtents = [HC, HC, HC];
      halfExtents[n] = 0.25;
      out2.push({ shape: "box", center, halfExtents, cell: t.index, male: false });
    }
    if (isHub(c2)) {
      out2.push({ shape: "disc", center: [ctr[0], ctr[1], ctr[2]], axis: a2, radius: c2.rim - RIM_COLL_INSET, halfLength: HC, innerRadius: HC, cell: t.index, male: false });
    }
  }
  return out2;
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
    const c2 = x0 * y1 - x1 * y0;
    A += c2 / 2;
    cu += (x0 + x1) * c2 / 6;
    cv += (y0 + y1) * c2 / 6;
    Su2 += (x0 * x0 + x0 * x1 + x1 * x1) * c2 / 12;
    Sv2 += (y0 * y0 + y0 * y1 + y1 * y1) * c2 / 12;
  }
  cu /= A;
  cv /= A;
  return { A, cu, cv, Iuu: Sv2 - A * cv * cv, Ivv: Su2 - A * cu * cu };
}
function bevelledPrism(center, axis, u, halfLength, poly, bevel = BEVEL) {
  const v2 = 3 - axis - u;
  const points = [];
  for (const q2 of poly)
    for (const s of [-1, 1]) {
      const p = [center[0], center[1], center[2]];
      p[u] += q2.u;
      p[v2] += q2.v;
      p[axis] += s * (q2.keep ? halfLength : halfLength - bevel);
      points.push(p);
    }
  const m = polyMoments(poly.map((q2) => [q2.u, q2.v]));
  const L = 2 * halfLength;
  const volume = m.A * L;
  const com = [center[0], center[1], center[2]];
  com[u] += m.cu;
  com[v2] += m.cv;
  const inertia = [0, 0, 0];
  inertia[axis] = (m.Iuu + m.Ivv) * L;
  inertia[u] = m.Iuu * L + volume * L * L / 12;
  inertia[v2] = m.Ivv * L + volume * L * L / 12;
  return { kind: "hull", points, mass: { volume, com, inertia } };
}
function gonVertex(R2, segments, i) {
  const a2 = (i + 0.5) / segments * 2 * Math.PI;
  return { u: R2 * Math.cos(a2), v: R2 * Math.sin(a2), a: a2 };
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
  const R2 = radius / Math.cos(Math.PI / segments);
  const n = segments;
  const j = runLength > 0 ? n / 4 - 1 : keepIndex(n);
  const keepSet = /* @__PURE__ */ new Set([j, n / 2 - 1 - j, n / 2 + j, n - 1 - j]);
  const poly = [];
  for (let i = 0; i < n; i++) {
    const g = gonVertex(R2, n, i);
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
  const w = (c2) => [c2[0] + origin[0], c2[1] + origin[1], c2[2] + origin[2]];
  const prims = partColliders(part);
  const cells = part.cells;
  const plain = /* @__PURE__ */ new Map();
  for (const p of prims) {
    if (p.shape !== "cylinder" || p.male) continue;
    const c2 = cells[p.cell];
    const ctr = w(p.center);
    if (Math.abs(p.halfLength - HC) < EPS2 && Math.abs(ctr[0] - c2.x) + Math.abs(ctr[1] - c2.y) + Math.abs(ctr[2] - c2.z) < EPS2)
      plain.set(p.cell, p);
  }
  const byPos = /* @__PURE__ */ new Map();
  cells.forEach((c2, i) => byPos.set(`${c2.x},${c2.y},${c2.z}`, i));
  const plainAt = (x, y, z, axis) => {
    const i = byPos.get(`${x},${y},${z}`);
    return i !== void 0 && plain.has(i) && cells[i].axis === axis ? i : void 0;
  };
  const out2 = [];
  const coveredBarrel = /* @__PURE__ */ new Set();
  const coveredWeb = /* @__PURE__ */ new Set();
  for (const [i] of plain) {
    const c2 = cells[i];
    for (let d = 0; d < 3; d = d + 1) {
      if (d === c2.axis) continue;
      const step = (k) => {
        const p = [c2.x, c2.y, c2.z];
        p[d] += k;
        return p;
      };
      if (plainAt(...step(-1), c2.axis) !== void 0) continue;
      let n = 0;
      while (plainAt(...step(n + 1), c2.axis) !== void 0) n++;
      if (n === 0) continue;
      const run = [];
      for (let k = 0; k <= n; k++) run.push(plainAt(...step(k), c2.axis));
      run.forEach((ci, k) => {
        coveredBarrel.add(ci);
        if (k > 0) coveredWeb.add(`${ci}:${d}:-1`);
        if (k < n) coveredWeb.add(`${ci}:${d}:1`);
      });
      const first = plain.get(run[0]);
      out2.push(prismShape(w(first.center), c2.axis, first.radius, first.halfLength, segments, d, n));
    }
  }
  for (const p of prims) {
    if (p.shape === "disc") {
      out2.push(wheelShape(w(p.center), p.axis, p.radius, p.halfLength, p.innerRadius, p.radius + RIM_COLL_INSET));
      continue;
    }
    if (p.shape === "cylinder") {
      if (!p.male && coveredBarrel.has(p.cell)) continue;
      out2.push(prismShape(w(p.center), p.axis, p.radius, p.halfLength, segments, (p.axis + 1) % 3));
      continue;
    }
    const c2 = cells[p.cell];
    const ctr = w(p.center);
    const off = [ctr[0] - c2.x, ctr[1] - c2.y, ctr[2] - c2.z];
    const d = off.findIndex((x) => Math.abs(x) > EPS2);
    if (d >= 0 && coveredWeb.has(`${p.cell}:${d}:${Math.sign(off[d])}`)) continue;
    out2.push({ kind: "box", center: ctr, halfExtents: [...p.halfExtents] });
  }
  return out2;
}

// spikes/teeth2/lib.ts
var G = 1226.25;
var DT = 1 / 480;
var ITER = 240;
var BASE_ITER = 30;
var HC2 = 0.46;
var R_BORE = 0.31;
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
  const c2 = (k + 0.5) * g.D;
  const loc = [
    [rb, -w(rb)],
    [g.tip, -w(g.tip)],
    [g.tip, w(g.tip)],
    [rb, w(rb)]
  ];
  return loc.map(([x, y]) => [x * Math.cos(c2) - y * Math.sin(c2), x * Math.sin(c2) + y * Math.cos(c2)]);
}
var prismPts = (poly, hz) => {
  const a2 = new Float32Array(poly.length * 6);
  poly.forEach(([x, y], i) => {
    a2.set([x, y, -hz], i * 6);
    a2.set([x, y, hz], i * 6 + 3);
  });
  return a2;
};
var hullPts = (sh) => new Float32Array(sh.points.flat());
var rootHull = (g) => hullPts(prismShape([0, 0, 0], 2, g.root, HC2, g.T, 0));
var smoothHull = (R2) => hullPts(prismShape([0, 0, 0], 2, R2, HC2, 32, 0, 0, 0.02 * R2));
function outline(g) {
  const out2 = [];
  const Rr = g.root / Math.cos(Math.PI / g.T);
  for (let k = 0; k < g.T; k++) {
    const a0 = k * g.D;
    out2.push([g.root * Math.cos(a0), g.root * Math.sin(a0)]);
    const t = toothPoly(g, k);
    const lift = (pt, toward) => {
      for (let s = 0; s <= 1; s += 0.02) {
        const q2 = [pt[0] + (toward[0] - pt[0]) * s, pt[1] + (toward[1] - pt[1]) * s];
        if (Math.hypot(q2[0], q2[1]) >= g.root + 0.01) return q2;
      }
      return toward;
    };
    out2.push(lift(t[0], t[1]), t[1], t[2], lift(t[3], t[2]));
  }
  void Rr;
  return out2;
}
function gearDescs(g, o) {
  const out2 = [];
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
      for (const h of hulls()) out2.push(fin(RAPIER.ColliderDesc.convexHull(h)));
      break;
    case "compound": {
      const shapes = hulls().map((h) => new RAPIER.ConvexPolyhedron(h, null));
      out2.push(fin(RAPIER.ColliderDesc.compound(shapes, shapes.map(() => ({ x: 0, y: 0, z: 0 })), shapes.map(() => ({ x: 0, y: 0, z: 0, w: 1 })))));
      break;
    }
    case "box":
    case "capsule": {
      out2.push(fin(RAPIER.ColliderDesc.convexHull(rootHull(g))));
      const p = MOD * Math.PI;
      const rb = g.root - 0.03;
      for (let k = 0; k < g.T; k++) {
        const c2 = (k + 0.5) * g.D;
        const q2 = { x: 0, y: 0, z: Math.sin(c2 / 2), w: Math.cos(c2 / 2) };
        if (o.rep === "box") {
          const hw = p / 4 - ((g.tip + rb) / 2 - g.r) * Math.tan(PA);
          const hr = (g.tip - rb) / 2;
          const m = (g.tip + rb) / 2;
          out2.push(fin(RAPIER.ColliderDesc.cuboid(hr, hw, HC2).setTranslation(m * Math.cos(c2), m * Math.sin(c2), 0).setRotation(q2)));
        } else {
          const rad = p / 4 - (g.tip - 0.06 - g.r) * Math.tan(PA) + 0.01;
          const m = g.tip - rad;
          const qz2 = { x: Math.SQRT1_2, y: 0, z: 0, w: Math.SQRT1_2 };
          out2.push(fin(RAPIER.ColliderDesc.capsule(HC2 - rad, rad).setTranslation(m * Math.cos(c2), m * Math.sin(c2), 0).setRotation(qz2)));
        }
      }
      break;
    }
    case "trimesh": {
      const ol = outline(g);
      const n = ol.length;
      const v2 = [];
      for (const [x, y] of ol) v2.push(x, y, -HC2);
      for (const [x, y] of ol) v2.push(x, y, HC2);
      v2.push(0, 0, -HC2, 0, 0, HC2);
      const cb = 2 * n, ct = 2 * n + 1;
      const idx = [];
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        idx.push(i, j, n + j, i, n + j, n + i);
        idx.push(cb, j, i);
        idx.push(ct, n + i, n + j);
      }
      out2.push(fin(RAPIER.ColliderDesc.trimesh(new Float32Array(v2), new Uint32Array(idx))));
      break;
    }
    case "polyline": {
      const ol = outline(g);
      const v2 = [];
      for (const [x, y] of ol) v2.push(x, y, 0);
      v2.push(ol[0][0], ol[0][1], 0);
      out2.push(fin(RAPIER.ColliderDesc.polyline(new Float32Array(v2))));
      break;
    }
    case "smooth":
      out2.push(fin(RAPIER.ColliderDesc.convexHull(smoothHull(g.tip))));
      break;
    case "none":
      break;
  }
  if (o.smooth) out2.push(RAPIER.ColliderDesc.convexHull(smoothHull(g.tip - 0.02)).setDensity(0).setFriction(0.4).setRestitution(0.1).setCollisionGroups(o.smoothGroup ?? G_SMOOTH));
  const qz = { x: Math.SQRT1_2, y: 0, z: 0, w: Math.SQRT1_2 };
  out2.push(RAPIER.ColliderDesc.cylinder(HC2, Math.max(g.r, 0.47)).setRotation(qz).setDensity(1).setCollisionGroups(G_NONE));
  return out2;
}
function partDescs(parts, o, group = G_PAWL, friction = 0.4) {
  const out2 = [];
  for (const part of parts)
    for (const sh of partShapes(part, 16)) {
      if (sh.kind === "hull") {
        const pts = new Float32Array(sh.points.flatMap((p) => [p[0] - o[0], p[1] - o[1], p[2] - o[2]]));
        out2.push(RAPIER.ColliderDesc.convexHull(pts));
      } else if (sh.kind === "box") {
        out2.push(RAPIER.ColliderDesc.cuboid(sh.halfExtents[0], sh.halfExtents[1], sh.halfExtents[2]).setTranslation(sh.center[0] - o[0], sh.center[1] - o[1], sh.center[2] - o[2]));
      } else throw new Error("wheel shape not expected");
    }
  return out2.map((d) => d.setDensity(1).setFriction(friction).setRestitution(0.1).setCollisionGroups(group));
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
var pawlReach = (kind, l) => kind === "end" ? l + 0.47 : kind === "rod" ? l + 0.3 : kind === "corner" ? l + 0.66 : l + 0.6;
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
  const c2 = Math.cos(-ang), s = Math.sin(-ang);
  const loc = { x: c2 * d[0] - s * d[1], y: s * d[0] + c2 * d[1], z: d[2] };
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
  const q2 = rb.rotation();
  return 2 * Math.atan2(q2.z, q2.w);
};
var Unwrap = class {
  v;
  last;
  constructor(a0) {
    this.v = a0;
    this.last = a0;
  }
  push(a2) {
    let d = a2 - this.last;
    d -= 2 * Math.PI * Math.round(d / (2 * Math.PI));
    this.last = a2;
    this.v += d;
    return this.v;
  }
};
function energy(bodies) {
  let e = 0;
  for (const b of bodies) {
    const v2 = b.linvel(), wv = b.angvel();
    const inv = b.effectiveWorldInvInertia().elements;
    const Izz = inv[5] > 0 ? 1 / inv[5] : 0;
    e += 0.5 * b.mass() * (v2.x * v2.x + v2.y * v2.y + v2.z * v2.z) + 0.5 * Izz * wv.z * wv.z + b.mass() * G * b.worldCom().y;
  }
  return e;
}
var cpu = () => {
  const u = process.cpuUsage();
  return (u.user + u.system) / 1e3;
};
var fmt = (x, d = 3) => x === void 0 || Number.isNaN(x) ? "-" : Number.isFinite(x) ? (+x).toPrecision(d) : x > 0 ? "inf" : "-inf";

// spikes/teeth2/ratchet.ts
import { writeFileSync } from "node:fs";
function scene(c2, o = {}) {
  const g = gear(c2.r);
  const w = makeWorld({ dt: o.dt, iters: o.iters });
  const f = fixed(w);
  const gb = body(w, [0, 0, 0], 0, gearDescs(g, { rep: o.rep ?? "hull", friction: o.contactFriction, toothGroup: o.rep === "smooth" ? G_TOOTH : void 0 }), o.iters);
  if (o.flywheel) w.createCollider(RAPIER.ColliderDesc.cylinder(0.46, 2.5).setRotation({ x: Math.SQRT1_2, y: 0, z: 0, w: Math.SQRT1_2 }).setDensity(o.flywheel).setCollisionGroups(0), gb);
  const jg = revZ(w, f, gb, [0, 0, 0]);
  const { parts, pivotZ } = pawlParts(c2.kind, c2.l);
  const pb = body(w, [c2.px, c2.py, pivotZ], c2.beta, partDescs(parts, [0, 0, pivotZ], grp(BIT.PAWL, BIT.TOOTH), o.contactFriction ?? 0.4), o.iters);
  const jp = revZ(w, f, pb, [c2.px, c2.py, pivotZ]);
  const mu = o.mu ?? 0.2;
  const muG = o.muGear ?? mu;
  const tfp = mu * pb.mass() * G * R_BORE;
  const tfg = muG * gb.mass() * G * R_BORE;
  vmotor(w, jp, 0, tfp);
  vmotor(w, jg, 0, 1e12);
  if (o.softCcd) {
    gb.setSoftCcdPrediction(o.softCcd);
    pb.setSoftCcdPrediction(o.softCcd);
  }
  return { w, f, g, gb, pb, jg, jp, tfp, tfg, tau0: pb.mass() * G };
}
function penetration(sc) {
  let d = 0;
  for (let i = 0; i < sc.gb.numColliders(); i++)
    for (let k = 0; k < sc.pb.numColliders(); k++)
      sc.w.contactPair(sc.gb.collider(i), sc.pb.collider(k), (m) => {
        for (let j = 0; j < m.numContacts(); j++) d = Math.max(d, -m.contactDist(j));
      });
  return d;
}
function touching(sc) {
  let n = 0;
  for (let i = 0; i < sc.gb.numColliders(); i++)
    for (let k = 0; k < sc.pb.numColliders(); k++)
      sc.w.contactPair(sc.gb.collider(i), sc.pb.collider(k), (m) => {
        n += m.numContacts();
      });
  return n;
}
function settle(sc, secs = 0.6) {
  const n = Math.round(secs / sc.w.timestep);
  for (let i = 0; i < n; i++) sc.w.step();
  const a2 = angleZ(sc.pb);
  if (!Number.isFinite(a2) || Math.abs(sc.pb.angvel().z) > 0.05) return null;
  return touching(sc) > 0 ? a2 : null;
}
function release(sc) {
  vmotor(sc.w, sc.jg, 0, sc.tfg);
}
function ramp(sc, s, dec = 0.4, tMax = 2.9, start = 1e-3, trackPen = false) {
  let pen = 0;
  const D = sc.g.D;
  const ug = new Unwrap(angleZ(sc.gb));
  const g0 = ug.v;
  const up = new Unwrap(angleZ(sc.pb));
  const p0 = up.v;
  let lift = 0;
  const dt = sc.w.timestep;
  const n = Math.round(tMax / dt);
  for (let i = 0; i < n; i++) {
    const tau = s * start * sc.tau0 * Math.pow(10, i * dt / dec);
    sc.gb.resetTorques(false);
    sc.gb.addTorque({ x: 0, y: 0, z: tau }, true);
    sc.w.step();
    const th = ug.push(angleZ(sc.gb));
    const pa = up.push(angleZ(sc.pb));
    if (!Number.isFinite(th) || !Number.isFinite(pa)) return { tau: NaN, lift, how: "nan" };
    lift = Math.max(lift, Math.abs(pa - p0));
    if (trackPen) pen = Math.max(pen, penetration(sc));
    if (s * (th - g0) > D) {
      const t = Math.abs(tau) / sc.tau0;
      const how = trackPen ? t < 0.3 ? "free" : pen > 0.1 ? "tunnel" : "skip" : t < 0.3 ? "free" : lift >= 0.05 ? "skip" : "tunnel";
      return { tau: t, lift, how, pen };
    }
  }
  sc.gb.resetTorques(false);
  return { tau: Infinity, lift, how: "held", pen };
}
function legalBetas(g, kind, l, px, py) {
  const out2 = [];
  for (const b of [0, 1, 2, 3]) {
    const [cx, cy] = [Math.round(Math.cos(b * Math.PI / 2)), Math.round(Math.sin(b * Math.PI / 2))];
    let ok = true;
    for (let k = 0; k <= l; k++) {
      if (kind === "rod" && k < l) continue;
      const du = px + k * cx, dv = py + k * cy;
      const m = Math.max(0, Math.abs(du) - 0.5) ** 2 + Math.max(0, Math.abs(dv) - 0.5) ** 2;
      if (m < g.r * g.r) ok = false;
      const mc = Math.max(0, Math.abs(du) - 0.47) ** 2 + Math.max(0, Math.abs(dv) - 0.47) ** 2;
      if (mc < (g.tip + 5e-3) ** 2) ok = false;
    }
    if (kind === "rod" && px === 0 && py === 0) ok = false;
    if (ok) out2.push(b * Math.PI / 2);
  }
  return out2;
}
async function search(args) {
  await RAPIER.init();
  const r = Number(args[0]);
  const kinds = (args[1] ?? "end,rod,corner,pinx").split(",");
  const lmax = Number(args[2] ?? 3);
  const g = gear(r);
  const rows = [];
  const t0 = cpu();
  let sims = 0;
  for (const kind of kinds)
    for (let l = 1; l <= lmax; l++) {
      const reach = pawlReach(kind, l) + g.tip;
      const R2 = Math.ceil(reach);
      for (let px = 0; px <= R2; px++)
        for (let py = -R2; py <= R2; py++) {
          if (Math.hypot(px, py) > reach) continue;
          const betas = legalBetas(g, kind, l, px, py);
          const rests = [];
          for (const beta of betas) {
            const c2 = { r, kind, l, px, py, beta };
            const sc = scene(c2);
            const a2 = settle(sc);
            sims++;
            sc.w.free();
            if (a2 === null) continue;
            if (rests.some((x) => Math.abs(Math.atan2(Math.sin(x - a2), Math.cos(x - a2))) < 0.05)) continue;
            rests.push(a2);
            const res = { r, T: g.T, kind, l, px, py, beta, rest: a2 };
            for (const [rep, tag] of [["hull", ""], ["smooth", "S"]]) {
              for (const s of [1, -1]) {
                const sc2 = scene(c2, { rep });
                const a22 = settle(sc2);
                if (a22 === null) {
                  res[`${tag}${s > 0 ? "p" : "m"}`] = { tau: NaN, lift: 0, how: "nosettle" };
                  sc2.w.free();
                  continue;
                }
                release(sc2);
                res[`${tag}${s > 0 ? "p" : "m"}`] = ramp(sc2, s);
                sc2.w.free();
                sims++;
              }
            }
            rows.push(res);
            const lo = Math.min(res.p.tau, res.m.tau), hi = Math.max(res.p.tau, res.m.tau);
            console.log(`${kind.padEnd(6)} l${l} pivot (${px},${py}) \u03B2${Math.round(beta * 180 / Math.PI)} rest ${fmt(a2 * 180 / Math.PI)}\xB0  teeth +:${fmt(res.p.tau)} ${res.p.how} \u2212:${fmt(res.m.tau)} ${res.m.how}  smooth +:${fmt(res.Sp.tau)} ${res.Sp.how} \u2212:${fmt(res.Sm.tau)} ${res.Sm.how}${hi >= 20 * lo && hi >= 3 ? "  <== RATCHET" : ""}`);
          }
        }
    }
  console.log(`r ${r}: ${rows.length} resting candidates, ${sims} simulations, ${fmt((cpu() - t0) / 1e3)} cpu-s`);
  writeFileSync(new URL(`./search-r${r}${args[1] ? "-" + kinds.join("_") : ""}.json`, import.meta.url), JSON.stringify(rows, (_k, v2) => v2 === Infinity ? "Infinity" : v2));
}
var [mode, ...rest] = process.argv.slice(2);
if (mode === "search") {
  await search(rest);
  process.exit(0);
}

// spikes/coupling/lib.mjs
import R from "@dimforge/rapier3d-compat";
await R.init();
var G2 = 9.81 / 8e-3;
var DT3 = 1 / 480;
var MODULE = 0.125;
var PITCH = Math.PI * MODULE;
var v = (o) => [o.x, o.y, o.z];
var q = (o) => [o.x, o.y, o.z, o.w];
var xyz = (a2) => ({ x: a2[0], y: a2[1], z: a2[2] });
var xyzw = (a2) => ({ x: a2[0], y: a2[1], z: a2[2], w: a2[3] });
var add = (a2, b) => [a2[0] + b[0], a2[1] + b[1], a2[2] + b[2]];
var sub = (a2, b) => [a2[0] - b[0], a2[1] - b[1], a2[2] - b[2]];
var scl = (a2, s) => [a2[0] * s, a2[1] * s, a2[2] * s];
var dot = (a2, b) => a2[0] * b[0] + a2[1] * b[1] + a2[2] * b[2];
var cross = (a2, b) => [a2[1] * b[2] - a2[2] * b[1], a2[2] * b[0] - a2[0] * b[2], a2[0] * b[1] - a2[1] * b[0]];
var len = (a2) => Math.hypot(a2[0], a2[1], a2[2]);
var unit = (a2) => scl(a2, 1 / len(a2));
var conj = (p) => [-p[0], -p[1], -p[2], p[3]];
function rot(p, a2) {
  const t = scl(cross(p, a2), 2);
  return add(add(a2, scl(t, p[3])), cross(p, t));
}
var irot = (p, a2) => rot(conj(p), a2);
function arc(u, w) {
  const d = dot(u, w);
  if (d < -1 + 1e-12) {
    let o = cross(u, [1, 0, 0]);
    if (len(o) < 1e-6) o = cross(u, [0, 1, 0]);
    return [...unit(o), 0];
  }
  const c2 = cross(u, w);
  const s = Math.sqrt((1 + d) * 2);
  return [c2[0] / s, c2[1] / s, c2[2] / s, s / 2];
}
function basisQuat(X, Y, Z) {
  const m00 = X[0], m10 = X[1], m20 = X[2], m01 = Y[0], m11 = Y[1], m21 = Y[2], m02 = Z[0], m12 = Z[1], m22 = Z[2];
  const tr = m00 + m11 + m22;
  let x, y, z, w;
  if (tr > 0) {
    const S = Math.sqrt(tr + 1) * 2;
    w = 0.25 * S;
    x = (m21 - m12) / S;
    y = (m02 - m20) / S;
    z = (m10 - m01) / S;
  } else if (m00 > m11 && m00 > m22) {
    const S = Math.sqrt(1 + m00 - m11 - m22) * 2;
    w = (m21 - m12) / S;
    x = 0.25 * S;
    y = (m01 + m10) / S;
    z = (m02 + m20) / S;
  } else if (m11 > m22) {
    const S = Math.sqrt(1 + m11 - m00 - m22) * 2;
    w = (m02 - m20) / S;
    x = (m01 + m10) / S;
    y = 0.25 * S;
    z = (m12 + m21) / S;
  } else {
    const S = Math.sqrt(1 + m22 - m00 - m11) * 2;
    w = (m10 - m01) / S;
    x = (m02 + m20) / S;
    y = (m12 + m21) / S;
    z = 0.25 * S;
  }
  return [x, y, z, w];
}
var wrap = (x) => x - 2 * Math.PI * Math.round(x / (2 * Math.PI));
function basis(a2) {
  const e1 = unit(Math.abs(a2[0]) < 0.9 ? cross(a2, [1, 0, 0]) : cross(a2, [0, 1, 0]));
  return [e1, cross(a2, e1)];
}
var NO_COLLIDE = 1 << 16 | 0;
function gearFrame(g) {
  const qq = q(g.body.rotation());
  return { c: add(v(g.body.translation()), rot(qq, g.lc)), a: rot(qq, g.la), q: qq };
}
function twist(qq, a2, st) {
  const raw = 2 * Math.atan2(dot([qq[0], qq[1], qq[2]], a2), qq[3]);
  if (st.prev === void 0) {
    st.prev = raw;
    st.acc = raw;
  } else {
    st.acc += wrap(raw - st.prev);
    st.prev = raw;
  }
  return st.acc;
}
function angleIn(nv, a2, st) {
  const [e1, e2] = basis(a2);
  const raw = Math.atan2(dot(nv, e2), dot(nv, e1));
  if (st.prev === void 0) {
    st.prev = raw;
    st.acc = raw;
  } else {
    st.acc += wrap(raw - st.prev);
    st.prev = raw;
  }
  return st.acc;
}
var Mesh = class {
  constructor(W, g1, g2, opts = {}) {
    this.W = W;
    this.g1 = g1;
    this.g2 = g2;
    this.o = { feedback: true, k: 1, frame: "both", reanchor: true, maxCorr: Infinity, snap: false, ...opts };
    this.s1 = {};
    this.s2 = {};
    this.sp = {};
    this.joint = null;
    this.phi0 = void 0;
    this.e = 0;
    this.maxAbsE = 0;
    this.update(true);
  }
  geom() {
    const f1 = gearFrame(this.g1);
    const f2 = gearFrame(this.g2);
    const a2 = f1.a;
    const d = sub(f2.c, f1.c);
    const dp = sub(d, scl(a2, dot(d, a2)));
    const D = len(dp);
    const n = scl(dp, 1 / D);
    const t = cross(a2, n);
    const r1 = this.g1.r;
    const r2 = this.g2.r;
    const P = add(f1.c, scl(dp, r1 / (r1 + r2)));
    return { f1, f2, a: a2, n, t, D, P, r1, r2 };
  }
  phase(G3) {
    const th1 = twist(G3.f1.q, G3.a, this.s1);
    const th2 = twist(G3.f2.q, G3.a, this.s2);
    const psi = angleIn(G3.n, G3.a, this.sp);
    return G3.r1 * th1 + G3.r2 * th2 - (G3.r1 + G3.r2) * psi;
  }
  /** Call before every world.step(). */
  update(first = false) {
    if (this.dead) return;
    if (!first && this.joint && !this.joint.isValid()) {
      this.dead = true;
      this.joint = null;
      return;
    }
    const G3 = this.geom();
    const phi = this.phase(G3);
    if (this.phi0 === void 0) {
      this.phi0 = this.o.snap ? (Math.round(phi / PITCH - 0.5) + 0.5) * PITCH : phi;
    }
    this.e = phi - this.phi0;
    if (!first) this.maxAbsE = Math.max(this.maxAbsE, Math.abs(this.e));
    this.lastG = G3;
    let off = this.o.feedback ? -this.o.k * this.e : 0;
    off = Math.max(-this.o.maxCorr, Math.min(this.o.maxCorr, off));
    const b1 = this.g1.body;
    const b2 = this.g2.body;
    const q1 = q(b1.rotation());
    const q2 = q(b2.rotation());
    let lam = 0;
    if (this.o.lead) {
      const D = G3.r1 + G3.r2;
      const k = D / G3.r2;
      const vc = sub(v(b2.velocityAtPoint(xyz(G3.f2.c))), v(b1.velocityAtPoint(xyz(G3.f1.c))));
      const betaDot = dot(vc, G3.t) / G3.D;
      const phiStep = (dot(v(b1.angvel()), G3.a) - betaDot) * (this.o.dt ?? 1 / 480);
      lam = (this.o.leadSign ?? 1) * (D * (1 - k * k) * phiStep / (2 * k * k));
    }
    this.lam = lam;
    const P1 = this.o.stop ? add(G3.f1.c, scl(G3.n, G3.r1)) : G3.P;
    const P2 = this.o.stop ? sub(G3.f2.c, scl(G3.n, G3.r2)) : G3.P;
    const A1 = irot(q1, sub(add(P1, scl(G3.t, lam)), v(b1.translation())));
    const A2 = irot(q2, sub(add(P2, scl(G3.t, off + lam)), v(b2.translation())));
    const x1 = this.o.frame === "two" ? G3.n : G3.t;
    const x2 = this.o.frame === "one" ? G3.n : G3.t;
    const F1 = this.o.stop ? basisQuat(irot(q1, G3.t), irot(q1, G3.n), irot(q1, scl(G3.a, -1))) : arc([1, 0, 0], irot(q1, x1));
    const F2 = this.o.stop ? basisQuat(irot(q2, G3.t), irot(q2, G3.n), irot(q2, scl(G3.a, -1))) : arc([1, 0, 0], irot(q2, x2));
    if (this.o.recreate && this.joint) {
      this.W.w.removeImpulseJoint(this.joint, false);
      this.joint = null;
    }
    if (!this.joint) {
      const data = R.JointData.generic(xyz(A1), xyz(A2), { x: 1, y: 0, z: 0 }, R.JointAxesMask.LinX);
      this.joint = this.W.w.createImpulseJoint(data, b1, b2, true);
      this.joint.setContactsEnabled(true);
      this.joint.setLocalFrame1(xyz(A1), xyzw(F1));
      this.joint.setLocalFrame2(xyz(A2), xyzw(F2));
      if (this.o.stop && this.o.stopMin !== "none") this.W.w.impulseJoints.raw.jointSetLimits(this.joint.handle, 1, this.o.stopMin ?? 0, 1e6);
      return;
    }
    if (!this.o.reanchor) return;
    this.joint.setLocalFrame1(xyz(A1), xyzw(F1));
    this.joint.setLocalFrame2(xyz(A2), xyzw(F2));
  }
  remove() {
    if (this.joint && this.joint.isValid()) this.W.w.removeImpulseJoint(this.joint, true);
    this.joint = null;
    this.dead = true;
  }
};

// spikes/skeptic/sk.mjs
var MeshPlanar = class extends Mesh {
  geom() {
    const G0 = super.geom();
    G0.delta = dot(sub(G0.f2.c, G0.f1.c), G0.a);
    return G0;
  }
  update(first = false) {
    super.update(first);
    if (this.dead || !this.joint || !this.lastG || this.o.stop) return;
    const d = this.lastG.delta;
    if (!d) return;
    const b2 = this.g2.body;
    const q2 = [b2.rotation().x, b2.rotation().y, b2.rotation().z, b2.rotation().w];
    const A2 = this.joint.anchor2();
    const ax = irot(q2, scl(this.lastG.a, d));
    this.joint.setAnchor2({ x: A2.x + ax[0], y: A2.y + ax[1], z: A2.z + ax[2] });
  }
};

// spikes/teeth2/mixed.ts
await RAPIER.init();
var a = process.argv.slice(2);
var c = { r: Number(a[0]), kind: a[1], l: Number(a[2]), px: Number(a[3]), py: Number(a[4]), beta: Number(a[5]) * Math.PI / 180 };
var lockS = Number(a[6]);
var rB = Number(a[7]);
var B = [Number(a[8]), Number(a[9])];
var gA = gear(c.r);
var gB = gear(rB);
if (Math.abs(Math.hypot(...B) - (c.r + rB)) > 1e-9) throw new Error("B must be at distance rA + rB");
function build(withMesh = true) {
  const sc = scene(c);
  const bb = body(sc.w, [B[0], B[1], 0], 0, gearDescs(gB, { rep: "none" }));
  const jb = revZ(sc.w, sc.f, bb, [B[0], B[1], 0]);
  const tfb = 0.2 * bb.mass() * 1226.25 * 0.31;
  vmotor(sc.w, jb, 0, tfb);
  if (settle(sc) === null) throw new Error("no settle");
  release(sc);
  const W = { w: sc.w, ground: sc.f };
  const mesh = withMesh ? new MeshPlanar(W, { body: sc.gb, lc: [0, 0, 0], la: [0, 0, 1], r: c.r, T: gA.T }, { body: bb, lc: [0, 0, 0], la: [0, 0, 1], r: rB, T: gB.T }, { lead: true }) : null;
  const step = () => {
    mesh?.update();
    sc.w.step();
  };
  return { sc, bb, jb, tfb, mesh, step };
}
var out = (s) => console.log(s);
out(`A: r${c.r} T${gA.T} with ${c.kind} l${c.l} pawl at (${c.px},${c.py}); B: r${rB} T${gB.T} at (${B}); A's lock direction ${lockS > 0 ? "+" : "\u2212"}; B turns \u2212rA/rB \xD7 A`);
{
  const m = build();
  const ua = new Unwrap(angleZ(m.sc.gb));
  const a0 = ua.v;
  const sB = -lockS;
  let tau = Infinity, maxE = 0;
  for (let i = 0; i < 1400; i++) {
    const t = sB * 1e-3 * m.sc.tau0 * Math.pow(10, i / 480 / 0.4);
    m.bb.resetTorques(false);
    m.bb.addTorque({ x: 0, y: 0, z: t }, true);
    m.step();
    maxE = Math.max(maxE, Math.abs(m.mesh.e));
    if (lockS * (ua.push(angleZ(m.sc.gb)) - a0) > gA.D) {
      tau = Math.abs(t);
      break;
    }
  }
  out(`  hold through the mesh: B torque at skip ${fmt(tau / m.sc.tau0)} \u03C40 = A-side ${fmt(tau / m.sc.tau0 * c.r / rB)} \u03C40; max |mesh phase error| while loaded ${fmt(maxE)} units (pitch 0.393)`);
}
for (const wA of [3, 10, 30, 60]) {
  for (const withMesh of [true]) {
    const m = build(withMesh);
    const wB = -wA * -lockS * c.r / rB;
    vmotor(m.sc.w, m.jb, wB, 1e6 * m.sc.tau0);
    let maxE = 0;
    for (let i = 0; i < 480; i++) {
      m.step();
      maxE = Math.max(maxE, Math.abs(m.mesh.e));
    }
    const wAmeas = m.sc.gb.angvel().z;
    vmotor(m.sc.w, m.jb, 0, m.tfb);
    const bodies = [m.sc.gb, m.bb, m.sc.pb];
    const E0 = energy(bodies);
    let Emin = E0, rise = 0, tStop = NaN, touchN = 0;
    for (let i = 0; i < 960; i++) {
      m.step();
      const E = energy(bodies);
      Emin = Math.min(Emin, E);
      rise = Math.max(rise, E - Emin);
      if (touching(m.sc) > 0) touchN++;
      if (Number.isNaN(tStop) && Math.abs(m.sc.gb.angvel().z) < 0.1) tStop = i / 480;
      maxE = Math.max(maxE, Math.abs(m.mesh.e));
    }
    const K0 = E0 - (m.sc.pb.mass() * 1226.25 * m.sc.pb.worldCom().y + 0);
    out(`  \u03C9A ${wA} (measured ${fmt(wAmeas)}): max |phase error| ${fmt(maxE)}; coast: energy rise above running minimum ${fmt(rise)} (= ${fmt(100 * rise / Math.max(E0 - Emin, 1e-9))}% of the energy lost), pawl touching ${fmt(100 * touchN / 960)}% of steps, A below 0.1 rad/s at ${fmt(tStop)} s, end \u03C9A ${fmt(m.sc.gb.angvel().z)}`);
    void K0;
    m.sc.w.free();
  }
}
process.exit(0);
