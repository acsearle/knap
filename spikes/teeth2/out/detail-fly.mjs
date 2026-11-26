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
    const a = c2.axis;
    if (isMale(c2.kind)) {
      const [lo2, hi2] = rodExtent(t);
      out2.push(cyl(ctr, a, R_COLL_ROD, lo2, hi2, t.index, true));
      continue;
    }
    const hi = t.faces[plusDir(a)].connected ? 0.5 : HC;
    const lo = t.faces[minusDir(a)].connected ? -0.5 : -HC;
    out2.push(cyl(ctr, a, HC, lo, hi, t.index, false));
    for (let d = 0; d < 6; d = d + 1) {
      if (axisOfDir(d) === a || !t.faces[d].connected) continue;
      const v = DIRS[d];
      const n = axisOfDir(d);
      const center = [ctr[0] + v[0] * 0.25, ctr[1] + v[1] * 0.25, ctr[2] + v[2] * 0.25];
      const halfExtents = [HC, HC, HC];
      halfExtents[n] = 0.25;
      out2.push({ shape: "box", center, halfExtents, cell: t.index, male: false });
    }
    if (isHub(c2)) {
      out2.push({ shape: "disc", center: [ctr[0], ctr[1], ctr[2]], axis: a, radius: c2.rim - RIM_COLL_INSET, halfLength: HC, innerRadius: HC, cell: t.index, male: false });
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
    const g2 = gonVertex(R, n, i);
    const plusU = g2.u > 0;
    poly.push({ u: g2.u + (plusU ? runLength : 0), v: g2.v, keep: keepSet.has(i) });
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
function gear(r2, T = Math.round(16 * r2)) {
  return { r: r2, T, tip: r2 + MOD, root: r2 - 1.25 * MOD, D: 2 * Math.PI / T };
}
var PA = 20 * Math.PI / 180;
function toothPoly(g2, k) {
  const p = MOD * Math.PI;
  const w = (rho) => p / 4 - (rho - g2.r) * Math.tan(PA);
  const rb = g2.root - 0.03;
  const c2 = (k + 0.5) * g2.D;
  const loc = [
    [rb, -w(rb)],
    [g2.tip, -w(g2.tip)],
    [g2.tip, w(g2.tip)],
    [rb, w(rb)]
  ];
  return loc.map(([x, y]) => [x * Math.cos(c2) - y * Math.sin(c2), x * Math.sin(c2) + y * Math.cos(c2)]);
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
var rootHull = (g2) => hullPts(prismShape([0, 0, 0], 2, g2.root, HC2, g2.T, 0));
var smoothHull = (R) => hullPts(prismShape([0, 0, 0], 2, R, HC2, 32, 0, 0, 0.02 * R));
function outline(g2) {
  const out2 = [];
  const Rr = g2.root / Math.cos(Math.PI / g2.T);
  for (let k = 0; k < g2.T; k++) {
    const a0 = k * g2.D;
    out2.push([g2.root * Math.cos(a0), g2.root * Math.sin(a0)]);
    const t = toothPoly(g2, k);
    const lift = (pt, toward) => {
      for (let s = 0; s <= 1; s += 0.02) {
        const q = [pt[0] + (toward[0] - pt[0]) * s, pt[1] + (toward[1] - pt[1]) * s];
        if (Math.hypot(q[0], q[1]) >= g2.root + 0.01) return q;
      }
      return toward;
    };
    out2.push(lift(t[0], t[1]), t[1], t[2], lift(t[3], t[2]));
  }
  void Rr;
  return out2;
}
function gearDescs(g2, o) {
  const out2 = [];
  const tg = o.toothGroup ?? G_TOOTH;
  const fin = (d) => d.setFriction(o.friction ?? 0.4).setRestitution(0.1).setDensity(0).setCollisionGroups(tg);
  const hulls = () => {
    const hs = [rootHull(g2)];
    for (let k = 0; k < g2.T; k += o.rep === "half" ? 2 : 1) hs.push(prismPts(toothPoly(g2, k), HC2));
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
      out2.push(fin(RAPIER.ColliderDesc.convexHull(rootHull(g2))));
      const p = MOD * Math.PI;
      const rb = g2.root - 0.03;
      for (let k = 0; k < g2.T; k++) {
        const c2 = (k + 0.5) * g2.D;
        const q = { x: 0, y: 0, z: Math.sin(c2 / 2), w: Math.cos(c2 / 2) };
        if (o.rep === "box") {
          const hw = p / 4 - ((g2.tip + rb) / 2 - g2.r) * Math.tan(PA);
          const hr = (g2.tip - rb) / 2;
          const m = (g2.tip + rb) / 2;
          out2.push(fin(RAPIER.ColliderDesc.cuboid(hr, hw, HC2).setTranslation(m * Math.cos(c2), m * Math.sin(c2), 0).setRotation(q)));
        } else {
          const rad = p / 4 - (g2.tip - 0.06 - g2.r) * Math.tan(PA) + 0.01;
          const m = g2.tip - rad;
          const qz2 = { x: Math.SQRT1_2, y: 0, z: 0, w: Math.SQRT1_2 };
          out2.push(fin(RAPIER.ColliderDesc.capsule(HC2 - rad, rad).setTranslation(m * Math.cos(c2), m * Math.sin(c2), 0).setRotation(qz2)));
        }
      }
      break;
    }
    case "trimesh": {
      const ol = outline(g2);
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
      out2.push(fin(RAPIER.ColliderDesc.trimesh(new Float32Array(v), new Uint32Array(idx))));
      break;
    }
    case "polyline": {
      const ol = outline(g2);
      const v = [];
      for (const [x, y] of ol) v.push(x, y, 0);
      v.push(ol[0][0], ol[0][1], 0);
      out2.push(fin(RAPIER.ColliderDesc.polyline(new Float32Array(v))));
      break;
    }
    case "smooth":
      out2.push(fin(RAPIER.ColliderDesc.convexHull(smoothHull(g2.tip))));
      break;
    case "none":
      break;
  }
  if (o.smooth) out2.push(RAPIER.ColliderDesc.convexHull(smoothHull(g2.tip - 0.02)).setDensity(0).setFriction(0.4).setRestitution(0.1).setCollisionGroups(o.smoothGroup ?? G_SMOOTH));
  const qz = { x: Math.SQRT1_2, y: 0, z: 0, w: Math.SQRT1_2 };
  out2.push(RAPIER.ColliderDesc.cylinder(HC2, Math.max(g2.r, 0.47)).setRotation(qz).setDensity(1).setCollisionGroups(G_NONE));
  return out2;
}
function partDescs(parts, o, group = G_PAWL, friction2 = 0.4) {
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
  return out2.map((d) => d.setDensity(1).setFriction(friction2).setRestitution(0.1).setCollisionGroups(group));
}
var pid = 1;
var mkPart = (cells) => ({ id: pid++, color: "#888888", cells });
var hole = (x, y, z, axis = 2, kind2 = "pinHole") => ({ x, y, z, kind: kind2, axis });
function pawlParts(kind2, l2) {
  const cells = [];
  if (kind2 === "end") {
    for (let k = 0; k <= l2; k++) cells.push(hole(k, 0, 0));
    return { parts: [mkPart(cells)], pivotZ: 0 };
  }
  if (kind2 === "rod") {
    for (let k = 0; k <= l2; k++) cells.push(hole(k, 0, 1, 2, k === l2 ? "axleHole" : "pinHole"));
    const axle = mkPart([{ x: l2, y: 0, z: 1, kind: "axle", axis: 2 }, { x: l2, y: 0, z: 0, kind: "axle", axis: 2 }]);
    return { parts: [mkPart(cells), axle], pivotZ: 1 };
  }
  if (kind2 === "corner") {
    for (let k = 0; k < l2; k++) cells.push(hole(k, 0, 0));
    cells.push(hole(l2, 0, 0, 0));
    return { parts: [mkPart(cells)], pivotZ: 0 };
  }
  for (let k = 0; k < l2; k++) cells.push(hole(k, 0, 0));
  cells.push({ x: l2, y: 0, z: 0, kind: "pin", axis: 0 });
  return { parts: [mkPart(cells)], pivotZ: 0 };
}
var pawlReach = (kind2, l2) => kind2 === "end" ? l2 + 0.47 : kind2 === "rod" ? l2 + 0.3 : kind2 === "corner" ? l2 + 0.66 : l2 + 0.6;
function makeWorld(o = {}) {
  const w = new RAPIER.World({ x: 0, y: -G, z: 0 });
  w.timestep = o.dt ?? DT;
  w.numSolverIterations = Math.min(BASE_ITER, o.iters ?? ITER);
  w.numInternalPgsIterations = 1;
  w.integrationParameters.maxCcdSubsteps = 0;
  if (process.env.NF) w.integrationParameters.contact_natural_frequency = Number(process.env.NF);
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
  const q = rb.rotation();
  return 2 * Math.atan2(q.z, q.w);
};
var Unwrap = class {
  v;
  last;
  constructor(a0) {
    this.v = a0;
    this.last = a0;
  }
  push(a) {
    let d = a - this.last;
    d -= 2 * Math.PI * Math.round(d / (2 * Math.PI));
    this.last = a;
    this.v += d;
    return this.v;
  }
};
function energy(bodies) {
  let e = 0;
  for (const b of bodies) {
    const v = b.linvel(), wv = b.angvel();
    const inv = b.effectiveWorldInvInertia().elements;
    const Izz = inv[5] > 0 ? 1 / inv[5] : 0;
    e += 0.5 * b.mass() * (v.x * v.x + v.y * v.y + v.z * v.z) + 0.5 * Izz * wv.z * wv.z + b.mass() * G * b.worldCom().y;
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
  const g2 = gear(c2.r);
  const w = makeWorld({ dt: o.dt, iters: o.iters });
  const f = fixed(w);
  const gb = body(w, [0, 0, 0], 0, gearDescs(g2, { rep: o.rep ?? "hull", friction: o.contactFriction, toothGroup: o.rep === "smooth" ? G_TOOTH : void 0 }), o.iters);
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
  return { w, f, g: g2, gb, pb, jg, jp, tfp, tfg, tau0: pb.mass() * G };
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
  const a = angleZ(sc.pb);
  if (!Number.isFinite(a) || Math.abs(sc.pb.angvel().z) > 0.05) return null;
  return touching(sc) > 0 ? a : null;
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
function legalBetas(g2, kind2, l2, px2, py2) {
  const out2 = [];
  for (const b of [0, 1, 2, 3]) {
    const [cx, cy] = [Math.round(Math.cos(b * Math.PI / 2)), Math.round(Math.sin(b * Math.PI / 2))];
    let ok = true;
    for (let k = 0; k <= l2; k++) {
      if (kind2 === "rod" && k < l2) continue;
      const du = px2 + k * cx, dv = py2 + k * cy;
      const m = Math.max(0, Math.abs(du) - 0.5) ** 2 + Math.max(0, Math.abs(dv) - 0.5) ** 2;
      if (m < g2.r * g2.r) ok = false;
      const mc = Math.max(0, Math.abs(du) - 0.47) ** 2 + Math.max(0, Math.abs(dv) - 0.47) ** 2;
      if (mc < (g2.tip + 5e-3) ** 2) ok = false;
    }
    if (kind2 === "rod" && px2 === 0 && py2 === 0) ok = false;
    if (ok) out2.push(b * Math.PI / 2);
  }
  return out2;
}
async function search(args) {
  await RAPIER.init();
  const r2 = Number(args[0]);
  const kinds = (args[1] ?? "end,rod,corner,pinx").split(",");
  const lmax = Number(args[2] ?? 3);
  const g2 = gear(r2);
  const rows = [];
  const t0 = cpu();
  let sims = 0;
  for (const kind2 of kinds)
    for (let l2 = 1; l2 <= lmax; l2++) {
      const reach = pawlReach(kind2, l2) + g2.tip;
      const R = Math.ceil(reach);
      for (let px2 = 0; px2 <= R; px2++)
        for (let py2 = -R; py2 <= R; py2++) {
          if (Math.hypot(px2, py2) > reach) continue;
          const betas = legalBetas(g2, kind2, l2, px2, py2);
          const rests = [];
          for (const beta of betas) {
            const c2 = { r: r2, kind: kind2, l: l2, px: px2, py: py2, beta };
            const sc = scene(c2, { rep: process.env.REP ?? "hull" });
            const a = settle(sc);
            sims++;
            sc.w.free();
            if (a === null) continue;
            if (rests.some((x) => Math.abs(Math.atan2(Math.sin(x - a), Math.cos(x - a))) < 0.05)) continue;
            rests.push(a);
            const res = { r: r2, T: g2.T, kind: kind2, l: l2, px: px2, py: py2, beta, rest: a };
            for (const [rep2, tag] of [[process.env.REP ?? "hull", ""], ["smooth", "S"]]) {
              for (const s of [1, -1]) {
                const sc2 = scene(c2, { rep: rep2 });
                const a2 = settle(sc2);
                if (a2 === null) {
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
            console.log(`${kind2.padEnd(6)} l${l2} pivot (${px2},${py2}) \u03B2${Math.round(beta * 180 / Math.PI)} rest ${fmt(a * 180 / Math.PI)}\xB0  teeth +:${fmt(res.p.tau)} ${res.p.how} \u2212:${fmt(res.m.tau)} ${res.m.how}  smooth +:${fmt(res.Sp.tau)} ${res.Sp.how} \u2212:${fmt(res.Sm.tau)} ${res.Sm.how}${hi >= 20 * lo && hi >= 3 ? "  <== RATCHET" : ""}`);
          }
        }
    }
  console.log(`r ${r2}: ${rows.length} resting candidates, ${sims} simulations, ${fmt((cpu() - t0) / 1e3)} cpu-s`);
  writeFileSync(new URL(`./search-r${r2}${args[1] ? "-" + kinds.join("_") : ""}${process.env.REP ? "-" + process.env.REP : ""}.json`, import.meta.url), JSON.stringify(rows, (_k, v) => v === Infinity ? "Infinity" : v));
}
var [mode, ...rest] = process.argv.slice(2);
if (mode === "search") {
  await search(rest);
  process.exit(0);
}

// spikes/teeth2/detail.ts
await RAPIER.init();
var [test, r, kind, l, px, py, bdeg, ls] = process.argv.slice(2);
var c = { r: Number(r), kind, l: Number(l), px: Number(px), py: Number(py), beta: Number(bdeg) * Math.PI / 180 };
var rep = process.env.REP ?? "hull";
var base = { rep, flywheel: Number(process.env.FLY ?? 0) };
var lockS = Number(ls ?? 0);
var mk = (o = {}) => {
  const { mu, muGear, ...rest2 } = o;
  const sc = scene(c, { ...base, ...rest2 });
  if (settle(sc) === null) throw new Error("pawl did not settle on the gear");
  const m = mu ?? 0.2;
  sc.tfp = m * sc.pb.mass() * 1226.25 * 0.31;
  sc.tfg = (muGear ?? m) * sc.gb.mass() * 1226.25 * 0.31;
  vmotor(sc.w, sc.jp, 0, sc.tfp);
  release(sc);
  return sc;
};
if (!lockS) {
  const a = ramp(mk(), 1), b = ramp(mk(), -1);
  lockS = a.tau > b.tau ? 1 : -1;
}
var g = gear(c.r);
var out = (s) => console.log(s);
out(`candidate r${c.r} T${g.T} ${c.kind} l${c.l} pivot (${c.px},${c.py}) \u03B2${bdeg}\xB0 rep ${rep}; lock direction ${lockS > 0 ? "+" : "\u2212"}`);
function friction() {
  for (const mu of [0, 0.05, 0.2]) {
    const L = ramp(mk({ mu }), lockS, 0.4, 2.9, 1e-3, true), F = ramp(mk({ mu }), -lockS);
    out(`  \u03BC ${mu}: lock ${fmt(L.tau)} \u03C40 (${L.how}, pawl lift ${fmt(L.lift)} rad, max penetration ${fmt(L.pen)})  free ${fmt(F.tau)} \u03C40 (${F.how})  ratio ${fmt(L.tau / F.tau)}`);
  }
  for (const cf of [0, 0.2, 0.8]) {
    const L = ramp(mk({ contactFriction: cf }), lockS), F = ramp(mk({ contactFriction: cf }), -lockS);
    out(`  contact friction ${cf}: lock ${fmt(L.tau)} \u03C40 (${L.how})  free ${fmt(F.tau)} \u03C40 (${F.how})`);
  }
}
function hold() {
  const L = ramp(mk(), lockS);
  const lim = Number.isFinite(L.tau) ? L.tau : 1e4;
  out(`  ramp lock torque ${fmt(L.tau)} \u03C40 (${L.how})`);
  for (const frac of [0.25, 0.5, 0.8]) {
    const sc = mk();
    const ug = new Unwrap(angleZ(sc.gb));
    const g0 = ug.v;
    const n = Math.round(20 / sc.w.timestep);
    let maxDev = 0, skips = 0, last = g0;
    const t0 = cpu();
    for (let i = 0; i < n; i++) {
      sc.gb.resetTorques(false);
      sc.gb.addTorque({ x: 0, y: 0, z: lockS * frac * lim * sc.tau0 }, true);
      sc.w.step();
      const th = ug.push(angleZ(sc.gb));
      maxDev = Math.max(maxDev, lockS * (th - g0));
      if (lockS * (th - last) > g.D * 0.9) {
        skips++;
        last = th;
      }
    }
    out(`  hold ${frac}\xD7: 20 s, gear moved ${fmt(maxDev)} rad in the lock direction (${fmt(maxDev / g.D)} pitch), skips ${skips}, ${fmt((cpu() - t0) / n)} cpu ms/step`);
    sc.w.free();
  }
}
function speed() {
  const LOAD = Number(process.env.LOAD ?? 2);
  out(`  load ${LOAD} \u03C40, NF ${process.env.NF ?? 30}`);
  for (const om of [1, 3, 10, 30, 60, 100, 200]) {
    const sc = mk();
    vmotor(sc.w, sc.jg, -lockS * om, 1e4 * sc.tau0);
    const up = new Unwrap(angleZ(sc.pb));
    const p0 = up.v;
    let maxLift = 0, maxW = 0, tTouch = 0;
    const n = Math.round(2 / sc.w.timestep);
    const e0 = energy([sc.pb]);
    let eMax = -Infinity;
    for (let i = 0; i < n; i++) {
      sc.w.step();
      const pa = up.push(angleZ(sc.pb));
      maxLift = Math.max(maxLift, Math.abs(pa - p0));
      maxW = Math.max(maxW, Math.abs(sc.pb.angvel().z));
      if (touching(sc) > 0) tTouch++;
      eMax = Math.max(eMax, energy([sc.pb]) - e0);
    }
    release(sc);
    const ug = new Unwrap(angleZ(sc.gb));
    const g0 = ug.v;
    let back = 0;
    let caught = false;
    for (let i = 0; i < Math.round(1 / sc.w.timestep); i++) {
      sc.gb.resetTorques(false);
      sc.gb.addTorque({ x: 0, y: 0, z: lockS * LOAD * sc.tau0 }, true);
      sc.w.step();
      const th = ug.push(angleZ(sc.gb));
      back = Math.max(back, lockS * (th - g0));
    }
    caught = back < 3 * g.D;
    out(
      `  \u03C9 ${String(om).padStart(3)} rad/s (${fmt(om * sc.w.timestep)} rad/step, tooth passing ${fmt(om * g.T / (2 * Math.PI))} Hz): pawl max lift ${fmt(maxLift)} rad, max |\u03C9_pawl| ${fmt(maxW)}, touching ${fmt(100 * tTouch / n)}% of steps, pawl max energy rise ${fmt(eMax / sc.tau0)} \u03C40\xB7rad; after cut, gear ran back ${fmt(back / g.D)} pitch \u2192 ${caught ? "caught" : "NOT caught"}`
    );
    sc.w.free();
  }
}
function long() {
  const LOAD = Number(process.env.LOAD ?? 2);
  out(`  load ${LOAD} \u03C40, NF ${process.env.NF ?? 30}`);
  for (const om of [10, 40]) {
    const sc = mk();
    let fails = 0, lost = 0, nan = 0;
    const t0 = cpu();
    let steps = 0;
    for (let cyc = 0; cyc < 60; cyc++) {
      vmotor(sc.w, sc.jg, -lockS * om, 1e4 * sc.tau0);
      for (let i = 0; i < 240; i++, steps++) sc.w.step();
      release(sc);
      const ug = new Unwrap(angleZ(sc.gb));
      const g0 = ug.v;
      let back = 0;
      for (let i = 0; i < 240; i++, steps++) {
        sc.gb.resetTorques(false);
        sc.gb.addTorque({ x: 0, y: 0, z: lockS * LOAD * sc.tau0 }, true);
        sc.w.step();
        back = Math.max(back, lockS * (ug.push(angleZ(sc.gb)) - g0));
      }
      sc.gb.resetTorques(false);
      if (!Number.isFinite(back)) nan++;
      if (back > 1.5 * g.D) fails++;
      if (touching(sc) === 0) lost++;
    }
    out(`  long \u03C9 ${om}: 60 cycles \u2192 load not held (ran back > 1.5 pitch) ${fails}, pawl not touching at end of hold ${lost}, NaN ${nan}; ${fmt((cpu() - t0) / steps)} cpu ms/step`);
    sc.w.free();
  }
}
function impact() {
  const fw = Number(process.env.FLYWHEEL ?? 1);
  out(`  gear carries an invisible disc r 2.5 of density ${fw} (I \u2248 ${fmt(fw * Math.PI * 2.5 ** 4 * 0.46)})`);
  const variants = [
    ["dt 1/480, 240 it", {}],
    ["dt 1/480, 240 it, soft CCD 1.04", { softCcd: 400 * (1 / 480) * 1.25 }],
    ["dt 1/960, 120 it", { dt: 1 / 960, iters: 120 }],
    ["dt 1/1920, 60 it", { dt: 1 / 1920, iters: 60 }]
  ];
  for (const [name, o] of variants) {
    const res = [];
    for (const om of [1, 3, 10, 30, 60, 100, 200, 350]) {
      const sc = mk({ ...o, flywheel: fw });
      sc.gb.setAngvel({ x: 0, y: 0, z: lockS * om }, true);
      const ug = new Unwrap(angleZ(sc.gb));
      const g0 = ug.v;
      let mx = 0;
      for (let i = 0; i < Math.round(0.5 / sc.w.timestep); i++) {
        sc.w.step();
        mx = Math.max(mx, lockS * (ug.push(angleZ(sc.gb)) - g0));
      }
      res.push(`${om}:${fmt(mx / g.D, 2)}`);
      sc.w.free();
    }
    out(`  impact [${name}] \u03C9:pitches travelled in 0.5 s  ${res.join("  ")}`);
  }
}
var tests = { friction, hold, speed, long, impact };
for (const [k, f] of Object.entries(tests)) if (test === k || test === "all") {
  out(`[${k}]`);
  f();
}
process.exit(0);
