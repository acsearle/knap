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
function makeCell(x, y, z, kind2, axis) {
  return { x, y, z, kind: kind2, axis };
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
  const w2 = (c) => [c[0] + origin[0], c[1] + origin[1], c[2] + origin[2]];
  const prims = partColliders(part);
  const cells = part.cells;
  const plain = /* @__PURE__ */ new Map();
  for (const p of prims) {
    if (p.shape !== "cylinder" || p.male) continue;
    const c = cells[p.cell];
    const ctr = w2(p.center);
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
      out.push(prismShape(w2(first.center), c.axis, first.radius, first.halfLength, segments, d, n));
    }
  }
  for (const p of prims) {
    if (p.shape === "cylinder") {
      if (!p.male && coveredBarrel.has(p.cell)) continue;
      out.push(prismShape(w2(p.center), p.axis, p.radius, p.halfLength, segments, (p.axis + 1) % 3));
      continue;
    }
    const c = cells[p.cell];
    const ctr = w2(p.center);
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
  const w2 = new RAPIER.World({ x: G * Math.sin(th), y: -G * Math.cos(th), z: 0 });
  w2.timestep = DT;
  w2.numSolverIterations = iterations;
  w2.numInternalPgsIterations = 1;
  w2.integrationParameters.maxCcdSubsteps = 0;
  return w2;
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
function bevelPrism(r2, h, n, bevel) {
  const R = r2 / Math.cos(Math.PI / n);
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
    const n = Number(kind2.slice(round ? 2 : 1));
    const b = round ? ROUND_BORDER : 0;
    const sh = prismShape([0, 0, 0], 2, r2 - b, 0.5 - b, n, 0);
    const full = prismShape([0, 0, 0], 2, r2, 0.5, n, 0);
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
function addWheel(w2, kind2, r2, pos, opts = {}) {
  const desc = RAPIER.RigidBodyDesc.dynamic().setCanSleep(false).setTranslation(pos[0], pos[1], pos[2]);
  if (opts.rot) desc.setRotation(opts.rot);
  if (opts.extraIters) desc.setAdditionalSolverIterations(opts.extraIters);
  const rb2 = w2.createRigidBody(desc);
  for (const cd of wheelColliders(kind2, r2)) w2.createCollider(cd, rb2);
  if (opts.softCcd ?? process.env.CCD !== "0") rb2.setSoftCcdPrediction(SPEED_CAP * DT * 1.25);
  return rb2;
}
function addGround(w2, kind2, x0 = -20, length = 400, top = 0, seg = 15) {
  const rb2 = w2.createRigidBody(RAPIER.RigidBodyDesc.fixed());
  const grp = kind2 === "half" || kind2 === "box" ? GRP.GROUND : GRP.PARTS;
  const fin = (cd) => w2.createCollider(cd.setFriction(FRICTION).setRestitution(RESTITUTION).setCollisionGroups(grp), rb2);
  if (kind2 === "half") {
    fin(new RAPIER.ColliderDesc(new RAPIER.HalfSpace({ x: 0, y: 1, z: 0 })).setTranslation(0, top, 0));
  } else if (kind2 === "box") {
    fin(RAPIER.ColliderDesc.cuboid(length / 2, 1, 50).setTranslation(x0 + length / 2, top - 1, 0));
  } else {
    const HC2 = 0.46;
    const rows = Number(process.env.ARM_ROWS ?? 5);
    for (let zr = -Math.floor(rows / 2); zr <= Math.floor((rows - 1) / 2); zr++)
      for (let x = Math.ceil(x0), id = 1; x < x0 + length; x += seg, id++) {
        const holeAxis = kind2 === "armFlat" ? 1 : 2;
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
function fmt(x, d = 3) {
  if (!Number.isFinite(x)) return String(x);
  if (x !== 0 && (Math.abs(x) < 1e-3 || Math.abs(x) >= 1e5)) return x.toExponential(2);
  return x.toFixed(d);
}

// spikes/wheels/diag.ts
var [kind, rs, ground, v0s, its] = process.argv.slice(2);
var r = Number(rs);
var v0 = Number(v0s ?? 40);
await init();
var w = makeWorld(Number(its ?? 30));
addGround(w, ground, -20, 220);
var rb = addWheel(w, kind, r, [0, r, 0]);
rb.setLinvel({ x: v0, y: 0, z: 0 }, true);
rb.setAngvel({ x: 0, y: 0, z: -v0 / r }, true);
var prevY = r;
for (let i = 0; i < 1920; i++) {
  w.step();
  const t = rb.translation();
  const v = rb.linvel();
  if (Math.abs(t.y - prevY) > 4e-3 || i % 96 === 0) console.log(fmt(i * DT, 4), "x", fmt(t.x, 3), "y-r", fmt(t.y - r, 4), "vx", fmt(v.x, 2), "vy", fmt(v.y, 2), "wz*r", fmt(rb.angvel().z * r, 2));
  prevY = t.y;
  if (t.y < -3) break;
}
