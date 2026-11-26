// src/core/disc.ts
function planeAxes(axis) {
  return [(axis + 1) % 3, (axis + 2) % 3];
}
function checkDisc(hub, axis, r) {
  if (!(r > 0) || !Number.isInteger(r * 2)) throw new Error(`disc radius must be a positive multiple of \xBD (got ${r})`);
  if (!(hub[0] !== void 0 && Number.isSafeInteger(hub[0]) && Number.isSafeInteger(hub[1]) && Number.isSafeInteger(hub[2]))) {
    throw new Error(`disc hub must be an integer cell (got ${JSON.stringify(hub)})`);
  }
  if (axis !== 0 && axis !== 1 && axis !== 2) throw new Error(`disc axis must be 0, 1 or 2 (got ${JSON.stringify(axis)})`);
  return r * 2;
}
function checkPos(pos) {
  if (!(Number.isSafeInteger(pos[0]) && Number.isSafeInteger(pos[1]) && Number.isSafeInteger(pos[2]))) {
    throw new Error(`cell position must be three integers (got ${JSON.stringify(pos)})`);
  }
}
function discCellContact(hub, axis, r, pos) {
  const R = checkDisc(hub, axis, r);
  checkPos(pos);
  if (pos[axis] !== hub[axis]) return "none";
  const [u, v] = planeAxes(axis);
  const DU = 2 * Math.abs(pos[u] - hub[u]);
  const DV = 2 * Math.abs(pos[v] - hub[v]);
  if (DU > R + 1 || DV > R + 1) return "none";
  const nu = Math.max(0, DU - 1);
  const nv = Math.max(0, DV - 1);
  const near2 = nu * nu + nv * nv;
  const R2 = R * R;
  if (near2 > R2) return "none";
  if (near2 === R2) return "touch";
  const far2 = (DU + 1) * (DU + 1) + (DV + 1) * (DV + 1);
  return far2 <= R2 ? "full" : "partial";
}
function discOverlapsCell(hub, axis, r, pos) {
  const c = discCellContact(hub, axis, r, pos);
  return c === "partial" || c === "full";
}
function discDiscContact(hubA, axisA, rA, hubB, axisB, rB) {
  const R1 = checkDisc(hubA, axisA, rA);
  const R2 = checkDisc(hubB, axisB, rB);
  const D = [2 * (hubB[0] - hubA[0]), 2 * (hubB[1] - hubA[1]), 2 * (hubB[2] - hubA[2])];
  for (let i = 0; i < 3; i++) {
    const ea = i === axisA ? 1 : R1;
    const eb = i === axisB ? 1 : R2;
    if (Math.abs(D[i]) > ea + eb) return "none";
  }
  if (axisA === axisB) {
    if (D[axisA] !== 0) return "none";
    const [u, v] = planeAxes(axisA);
    const dist2 = D[u] * D[u] + D[v] * D[v];
    const s2 = (R1 + R2) * (R1 + R2);
    return dist2 < s2 ? "overlap" : dist2 === s2 ? "touch" : "none";
  }
  const a = axisA;
  const b = axisB;
  const k = 3 - a - b;
  const nb = Math.max(0, Math.abs(D[b]) - 1);
  const na = Math.max(0, Math.abs(D[a]) - 1);
  const A2 = R1 * R1 - nb * nb;
  const B2 = R2 * R2 - na * na;
  if (A2 < 0 || B2 < 0) return "none";
  const dk2 = D[k] * D[k];
  if (A2 === 0 || B2 === 0) {
    return dk2 <= A2 + B2 ? "touch" : "none";
  }
  const e = dk2 - A2 - B2;
  if (e < 0) return "overlap";
  const lhs = e * e;
  const rhs = 4 * A2 * B2;
  return lhs < rhs ? "overlap" : lhs === rhs ? "touch" : "none";
}
function discsOverlap(hubA, axisA, rA, hubB, axisB, rB) {
  return discDiscContact(hubA, axisA, rA, hubB, axisB, rB) === "overlap";
}
function discReach(r) {
  return Math.ceil(r + 0.5) - 1;
}
function discCells(hub, axis, r) {
  checkDisc(hub, axis, r);
  const [u, v] = planeAxes(axis);
  const n = discReach(r);
  const out2 = [];
  for (let du = -n; du <= n; du++) {
    for (let dv = -n; dv <= n; dv++) {
      const p = [hub[0], hub[1], hub[2]];
      p[u] += du;
      p[v] += dv;
      if (discOverlapsCell(hub, axis, r, p)) out2.push(p);
    }
  }
  return out2;
}

// src/core/rules.ts
var KINDS = ["pinHole", "axleHole", "axle", "pin", "frictionPin"];
function isKind(k) {
  return typeof k === "string" && KINDS.includes(k);
}
function isAxis(a) {
  return a === 0 || a === 1 || a === 2;
}
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
var FRICTION_PIN_IN_PIN_HOLE = "weld";
var MATE_TABLE = {
  axle: { pinHole: "cylindrical", axleHole: "weld" },
  pin: { pinHole: "revolute", axleHole: null },
  frictionPin: { pinHole: FRICTION_PIN_IN_PIN_HOLE, axleHole: null }
};
function mateType(male, hole) {
  if (!isMale(male) || !isHole(hole)) return null;
  return MATE_TABLE[male][hole];
}
function shareResult(a, b) {
  const ma = isMale(a.kind);
  const mb = isMale(b.kind);
  if (ma && mb) return { ok: false, reason: "two pins/axles cannot share a cell" };
  if (!ma && !mb) return { ok: false, reason: "two holes cannot share a cell" };
  const male = ma ? a : b;
  const hole = ma ? b : a;
  if (male.axis !== hole.axis) return { ok: false, reason: `${kindLabel(male.kind)} is not coaxial with the ${kindLabel(hole.kind)}` };
  const mate = mateType(male.kind, hole.kind);
  if (!mate) return { ok: false, reason: `${kindLabel(male.kind)} does not fit an ${kindLabel(hole.kind)}` };
  return { ok: true, mate };
}
var KIND_LABELS = {
  pinHole: "pin hole",
  axleHole: "axle hole",
  axle: "axle",
  pin: "pin",
  frictionPin: "friction pin"
};
function kindLabel(kind) {
  return KIND_LABELS[kind];
}

// src/core/model.ts
function posKey(x, y, z) {
  return `${x},${y},${z}`;
}
function cellKey(c) {
  return `${c.x},${c.y},${c.z}`;
}
function cellPos(c) {
  return [c.x, c.y, c.z];
}
function fmtPos(p) {
  return "x" in p ? `(${p.x}, ${p.y}, ${p.z})` : `(${p[0]}, ${p[1]}, ${p[2]})`;
}
function makeCell(x, y, z, kind, axis, rim) {
  return rim === void 0 ? { x, y, z, kind, axis } : { x, y, z, kind, axis, rim };
}
function copyCell(c) {
  return makeCell(c.x, c.y, c.z, c.kind, c.axis, c.rim);
}
function emptyModel() {
  return { version: 1, parts: [], rootPartId: null, nextPartId: 1 };
}
function partById(m, partId) {
  return m.parts.find((p) => p.id === partId);
}
function requirePart(m, partId) {
  const p = partById(m, partId);
  if (!p) throw new Error(`no part with id ${partId}`);
  return p;
}
function cellAt(part, pos) {
  return part.cells.find((c) => c.x === pos[0] && c.y === pos[1] && c.z === pos[2]);
}
function effectiveRootId(m) {
  if (m.rootPartId !== null && m.parts.some((p) => p.id === m.rootPartId)) return m.rootPartId;
  let best = null;
  for (const p of m.parts) if (best === null || p.id < best) best = p.id;
  return best;
}
var HEX_COLOR = /^#[0-9a-fA-F]{6}$/;
var DEFAULT_COLORS = {
  pinHole: "#e0b43c",
  // the UI normally passes its current palette colour for holes
  axleHole: "#e0b43c",
  axle: "#a8adb2",
  // light grey
  pin: "#d9c9a3",
  // tan
  frictionPin: "#2f63c4"
  // blue
};
function defaultColorFor(kind) {
  return DEFAULT_COLORS[kind];
}
var RIM_MIN = 1;
var RIM_MAX = 4;
var RIM_STEP = 0.5;
function isValidRim(r) {
  return typeof r === "number" && Number.isInteger(r / RIM_STEP) && r >= RIM_MIN && r <= RIM_MAX;
}
function hasRim(c) {
  return c.rim !== void 0;
}
function fmtRim(r) {
  return `radius ${r}`;
}
var EMPTY = Object.freeze([]);
var RIM_BUCKET = 2 * RIM_MAX;
var RIM_LINEAR = 32;
var WorldIndex = class {
  map = /* @__PURE__ */ new Map();
  /** Every hub cell (hole cell with a valid rim) in the model, in part order then cell order. */
  rims = [];
  rimBuckets = /* @__PURE__ */ new Map();
  constructor(m) {
    for (const part of m.parts) {
      part.cells.forEach((cell, index) => {
        const k = cellKey(cell);
        const list = this.map.get(k);
        const e = { partId: part.id, cell, index };
        if (list) list.push(e);
        else this.map.set(k, [e]);
        if (cell.rim !== void 0 && isValidRim(cell.rim) && isHole(cell.kind)) {
          const re = { partId: part.id, cell, index, r: cell.rim, hub: cellPos(cell) };
          this.rims.push(re);
          const bk = bucketKey(cell.x, cell.y, cell.z);
          const b = this.rimBuckets.get(bk);
          if (b) b.push(re);
          else this.rimBuckets.set(bk, [re]);
        }
      });
    }
  }
  at(pos) {
    return this.map.get(posKey(pos[0], pos[1], pos[2])) ?? EMPTY;
  }
  atXYZ(p) {
    return this.map.get(cellKey(p)) ?? EMPTY;
  }
  /** Does part `partId` have a hole cell at `p`? */
  holeOfPartAt(partId, p) {
    const list = "x" in p ? this.atXYZ(p) : this.at(p);
    return list.some((e) => e.partId === partId && isHole(e.cell.kind));
  }
  /**
   * Hubs whose position is within `reach` cells of `pos` on every axis (a superset filter; callers
   * apply the exact disc tests). reach ≤ 2·RIM_MAX.
   */
  rimsNear(pos, reach = RIM_BUCKET) {
    if (this.rims.length === 0) return [];
    const near = (e) => Math.abs(e.hub[0] - pos[0]) <= reach && Math.abs(e.hub[1] - pos[1]) <= reach && Math.abs(e.hub[2] - pos[2]) <= reach;
    if (this.rims.length <= RIM_LINEAR || reach > RIM_BUCKET) return this.rims.filter(near);
    const out2 = [];
    const bx = Math.floor(pos[0] / RIM_BUCKET);
    const by = Math.floor(pos[1] / RIM_BUCKET);
    const bz = Math.floor(pos[2] / RIM_BUCKET);
    for (let i = -1; i <= 1; i++)
      for (let j = -1; j <= 1; j++)
        for (let k = -1; k <= 1; k++) {
          const b = this.rimBuckets.get(`${bx + i},${by + j},${bz + k}`);
          if (b) {
            for (const e of b) if (near(e)) out2.push(e);
          }
        }
    return out2;
  }
  /** Hubs (of any part) whose disc overlaps the cell at `pos` with positive volume (§2.6). */
  discsOverlapping(pos) {
    const out2 = [];
    for (const e of this.rimsNear(pos, discReach(RIM_MAX))) if (discOverlapsCell(e.hub, e.cell.axis, e.r, pos)) out2.push(e);
    return out2;
  }
};
function bucketKey(x, y, z) {
  return `${Math.floor(x / RIM_BUCKET)},${Math.floor(y / RIM_BUCKET)},${Math.floor(z / RIM_BUCKET)}`;
}
var indexCache = /* @__PURE__ */ new WeakMap();
function worldIndex(m) {
  let w = indexCache.get(m);
  if (!w) {
    w = new WorldIndex(m);
    indexCache.set(m, w);
  }
  return w;
}
function components(cells) {
  const at = /* @__PURE__ */ new Map();
  cells.forEach((c, i) => {
    const k = cellKey(c);
    if (!at.has(k)) at.set(k, i);
  });
  const parent = new Int32Array(cells.length);
  for (let i = 0; i < cells.length; i++) parent[i] = i;
  const find = (a) => {
    while (parent[a] !== a) {
      parent[a] = parent[parent[a]];
      a = parent[a];
    }
    return a;
  };
  const union = (a, b) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[Math.max(ra, rb)] = Math.min(ra, rb);
  };
  const hubs = [];
  for (let i = 0; i < cells.length; i++) {
    const c = cells[i];
    for (let d = 0; d < 6; d += 2) {
      const v = DIRS[d];
      const j = at.get(posKey(c.x + v[0], c.y + v[1], c.z + v[2]));
      if (j !== void 0 && connects(c, cells[j])) union(i, j);
    }
    if (c.rim !== void 0 && isValidRim(c.rim) && isAxis(c.axis) && Number.isSafeInteger(c.x) && Number.isSafeInteger(c.y) && Number.isSafeInteger(c.z)) {
      hubs.push(i);
      for (const q of discCells(cellPos(c), c.axis, c.rim)) {
        const j = at.get(posKey(q[0], q[1], q[2]));
        if (j !== void 0) union(i, j);
      }
    }
  }
  for (let a = 0; a < hubs.length; a++)
    for (let b = a + 1; b < hubs.length; b++) {
      const ca = cells[hubs[a]];
      const cb = cells[hubs[b]];
      if (discsOverlap(cellPos(ca), ca.axis, ca.rim, cellPos(cb), cb.axis, cb.rim)) union(hubs[a], hubs[b]);
    }
  const byRoot = /* @__PURE__ */ new Map();
  const out2 = [];
  for (let i = 0; i < cells.length; i++) {
    const r = find(i);
    let list = byRoot.get(r);
    if (!list) {
      list = [];
      byRoot.set(r, list);
      out2.push(list);
    }
    list.push(i);
  }
  return out2;
}
function cellStructureError(c) {
  if (typeof c !== "object" || c === null || Array.isArray(c)) return "expected an object {x,y,z,kind,axis}";
  const o = c;
  for (const f2 of ["x", "y", "z"]) {
    if (typeof o[f2] !== "number" || !Number.isSafeInteger(o[f2])) return `${f2} must be an integer (got ${JSON.stringify(o[f2])})`;
  }
  if (!isKind(o.kind)) return `kind must be one of pinHole, axleHole, axle, pin, frictionPin (got ${JSON.stringify(o.kind)})`;
  if (!isAxis(o.axis)) return `axis must be 0, 1 or 2 (got ${JSON.stringify(o.axis)})`;
  return null;
}
function rimError(c) {
  const r = c.rim;
  if (r === void 0) return null;
  if (!isValidRim(r)) return `rim must be a multiple of \xBD from ${RIM_MIN} to ${RIM_MAX} (got ${typeof r === "number" ? String(r) : JSON.stringify(r)})`;
  if (!isHole(c.kind)) return `a ${kindLabel(c.kind)} cannot carry a rim: wheels grow from pin holes and axle holes`;
  return null;
}
function partCellErrors(cells, partId) {
  const errs = [];
  const label = partId === void 0 ? "part" : `part ${partId}`;
  if (cells.length === 0) {
    errs.push({ code: "emptyPart", message: `${label} has no cells`, ...partId !== void 0 && { partId } });
    return errs;
  }
  const seen = /* @__PURE__ */ new Set();
  for (const c of cells) {
    const k = cellKey(c);
    if (seen.has(k)) {
      errs.push({
        code: "duplicateCell",
        message: `${label} has two cells at ${fmtPos(c)}`,
        pos: cellPos(c),
        ...partId !== void 0 && { partId }
      });
    }
    seen.add(k);
  }
  if (errs.length) return errs;
  const comps = components(cells);
  if (comps.length > 1) {
    const sizes = comps.map((cc) => cc.length).join(" + ");
    errs.push({
      code: "disconnected",
      message: `${label} is not connected: it falls into ${comps.length} pieces (${sizes} cells)`,
      ...partId !== void 0 && { partId }
    });
  }
  return errs;
}
function occupancyCheck(world, cell, ignorePartId) {
  const others = world.atXYZ(cell).filter((e) => e.partId !== ignorePartId);
  if (others.length === 0) return { ok: true };
  const distinct = new Set(others.map((e) => e.partId));
  if (distinct.size >= 2 || others.length >= 2) {
    return { ok: false, reason: `${fmtPos(cell)} is already shared by two parts` };
  }
  const other = others[0];
  const r = shareResult(cell, other.cell);
  if (r.ok) return { ok: true };
  return { ok: false, reason: `${fmtPos(cell)}: ${r.reason} (part ${other.partId} has a ${kindLabel(other.cell.kind)} there)` };
}
function cellInsideOtherWheel(world, cell, ignore) {
  if (world.rims.length === 0) return { ok: true };
  const pos = cellPos(cell);
  for (const e of world.discsOverlapping(pos)) {
    if (e.partId === ignore) continue;
    if (isMale(cell.kind) && world.holeOfPartAt(e.partId, pos)) continue;
    return { ok: false, reason: `${fmtPos(cell)} is inside the wheel of part ${e.partId}` };
  }
  return { ok: true };
}
function wheelBlocked(world, hub, r, ignore, ownHoleAt) {
  const hp = cellPos(hub);
  for (const q of discCells(hp, hub.axis, r)) {
    for (const e of world.at(q)) {
      if (e.partId === ignore) continue;
      if (isMale(e.cell.kind) && ownHoleAt(q)) continue;
      return { ok: false, reason: `wheel would hit part ${e.partId} at ${fmtPos(q)}` };
    }
  }
  for (const e of world.rimsNear(hp)) {
    if (e.partId === ignore) continue;
    if (discsOverlap(hp, hub.axis, r, e.hub, e.cell.axis, e.r)) {
      return { ok: false, reason: `wheels would overlap: the wheel of part ${e.partId} (hub ${fmtPos(e.hub)})` };
    }
  }
  return { ok: true };
}
function partAgainstWorld(world, cells, self) {
  for (const c of cells) {
    const r = occupancyCheck(world, c, self);
    if (!r.ok) return r;
  }
  if (world.rims.length > 0) {
    for (const c of cells) {
      const r = cellInsideOtherWheel(world, c, self);
      if (!r.ok) return r;
    }
  }
  if (cells.some(hasRim)) {
    const holes2 = /* @__PURE__ */ new Set();
    for (const c of cells) if (isHole(c.kind)) holes2.add(cellKey(c));
    const ownHoleAt = (q) => holes2.has(posKey(q[0], q[1], q[2]));
    for (const c of cells) {
      if (!hasRim(c)) continue;
      const r = wheelBlocked(world, c, c.rim, self, ownHoleAt);
      if (!r.ok) return r;
    }
  }
  return { ok: true };
}
function validateModel(m) {
  const errs = [];
  const s = (message) => errs.push({ code: "structure", message });
  const o = m;
  if (typeof o !== "object" || o === null || Array.isArray(o)) {
    s("model must be a JSON object");
    return errs;
  }
  if (o.version !== 1 && o.version !== 2) s(`version: expected 1 or 2 (got ${JSON.stringify(o.version)})`);
  if (!Array.isArray(o.parts)) {
    s("parts: expected an array");
    return errs;
  }
  if (o.rootPartId !== null && !(typeof o.rootPartId === "number" && Number.isSafeInteger(o.rootPartId))) {
    s(`rootPartId: expected an integer or null (got ${JSON.stringify(o.rootPartId)})`);
  }
  if (!(typeof o.nextPartId === "number" && Number.isSafeInteger(o.nextPartId) && o.nextPartId >= 1)) {
    s(`nextPartId: expected a positive integer (got ${JSON.stringify(o.nextPartId)})`);
  }
  for (const f2 of ["ground", "fixRoot"]) {
    if (o[f2] !== void 0 && typeof o[f2] !== "boolean") s(`${f2}: expected true or false (got ${JSON.stringify(o[f2])})`);
  }
  let usesRim = false;
  o.parts.forEach((p, i) => {
    const path = `parts[${i}]`;
    if (typeof p !== "object" || p === null || Array.isArray(p)) {
      s(`${path}: expected an object {id,color,cells}`);
      return;
    }
    const po = p;
    if (!(typeof po.id === "number" && Number.isSafeInteger(po.id) && po.id >= 0)) {
      s(`${path}.id: expected a non-negative integer (got ${JSON.stringify(po.id)})`);
    }
    if (typeof po.color !== "string" || !HEX_COLOR.test(po.color)) {
      s(`${path}.color: expected '#rrggbb' (got ${JSON.stringify(po.color)})`);
    }
    if (!Array.isArray(po.cells)) {
      s(`${path}.cells: expected an array`);
      return;
    }
    po.cells.forEach((c, j) => {
      const e = cellStructureError(c);
      if (e) {
        s(`${path}.cells[${j}]: ${e}`);
        return;
      }
      const cell = c;
      if (cell.rim === void 0) return;
      usesRim = true;
      const re = rimError(cell);
      if (re) {
        errs.push({
          code: "rim",
          message: `${path}.cells[${j}] at ${fmtPos(cell)}: ${re}`,
          pos: cellPos(cell),
          ...typeof po.id === "number" && { partId: po.id }
        });
      }
    });
  });
  if (o.version === 1 && (usesRim || o.ground !== void 0 || o.fixRoot !== void 0)) {
    s("version: a model with wheels (rim), ground or fixRoot must be version 2");
  }
  if (errs.length) return errs;
  const ids = /* @__PURE__ */ new Set();
  let maxId = -Infinity;
  for (const p of m.parts) {
    if (ids.has(p.id)) errs.push({ code: "duplicatePartId", message: `part id ${p.id} is used more than once`, partId: p.id });
    ids.add(p.id);
    maxId = Math.max(maxId, p.id);
  }
  if (m.parts.length && m.nextPartId <= maxId) {
    errs.push({ code: "nextPartId", message: `nextPartId ${m.nextPartId} must be greater than every part id (max ${maxId})` });
  }
  for (const p of m.parts) errs.push(...partCellErrors(p.cells, p.id));
  const world = new WorldIndex(m);
  for (const entries of world.map.values()) {
    const parts = /* @__PURE__ */ new Map();
    for (const e of entries) if (!parts.has(e.partId)) parts.set(e.partId, e);
    if (parts.size < 2) continue;
    const [a, b] = [...parts.values()];
    const pos = cellPos(a.cell);
    if (parts.size > 2) {
      errs.push({
        code: "overlap",
        message: `${fmtPos(a.cell)} is occupied by ${parts.size} parts (${[...parts.keys()].join(", ")}); at most two may share a cell`,
        pos
      });
      continue;
    }
    const r = shareResult(a.cell, b.cell);
    if (!r.ok) {
      errs.push({
        code: "overlap",
        message: `${fmtPos(a.cell)}: parts ${a.partId} and ${b.partId} overlap invalidly: ${r.reason}`,
        pos
      });
    }
  }
  const rimIndex = new Map(world.rims.map((e, i) => [e, i]));
  world.rims.forEach((w, wi) => {
    for (const q of discCells(w.hub, w.cell.axis, w.r)) {
      for (const e of world.at(q)) {
        if (e.partId === w.partId) continue;
        if (isMale(e.cell.kind) && world.holeOfPartAt(w.partId, q)) continue;
        errs.push({
          code: "overlap",
          message: `${fmtPos(q)}: the ${kindLabel(e.cell.kind)} of part ${e.partId} is inside the wheel of part ${w.partId} (hub ${fmtPos(w.hub)}, ${fmtRim(w.r)})`,
          pos: q,
          partId: e.partId
        });
      }
    }
    for (const v of world.rimsNear(w.hub)) {
      if (v.partId === w.partId || rimIndex.get(v) <= wi) continue;
      if (discsOverlap(w.hub, w.cell.axis, w.r, v.hub, v.cell.axis, v.r)) {
        errs.push({
          code: "overlap",
          message: `wheels would overlap: part ${w.partId} (hub ${fmtPos(w.hub)}, ${fmtRim(w.r)}) and part ${v.partId} (hub ${fmtPos(v.hub)}, ${fmtRim(v.r)})`,
          pos: w.hub,
          partId: w.partId
        });
      }
    }
  });
  return errs;
}
function allocIds(m, count) {
  let first = Number.isSafeInteger(m.nextPartId) ? Math.max(m.nextPartId, 1) : 1;
  for (const p of m.parts) if (p.id >= first) first = p.id + 1;
  if (!Number.isSafeInteger(first + count)) throw new Error("no part ids left (nextPartId too large)");
  return first;
}
function replacePart(m, partId, parts) {
  const out2 = [];
  for (const p of m.parts) {
    if (p.id === partId) out2.push(...parts);
    else out2.push(p);
  }
  return out2;
}
function bumpVersion(m, need) {
  return need && m.version !== 2 ? { ...m, version: 2 } : m;
}
function addPart(m, cells, color) {
  for (let i = 0; i < cells.length; i++) {
    const e = cellStructureError(cells[i]);
    if (e) throw new Error(`invalid cell ${i}: ${e}`);
    const re = rimError(cells[i]);
    if (re) throw new Error(`invalid cell ${i} at ${fmtPos(cells[i])}: ${re}`);
  }
  const copy = cells.map(copyCell);
  const errs = partCellErrors(copy, void 0);
  if (errs.length) throw new Error(errs[0].message);
  const r = partAgainstWorld(worldIndex(m), copy, null);
  if (!r.ok) throw new Error(r.reason);
  const col = color ?? defaultColorFor(copy[0].kind);
  if (!HEX_COLOR.test(col)) throw new Error(`invalid colour ${JSON.stringify(col)} (expected '#rrggbb')`);
  const partId = allocIds(m, 1);
  const part = { id: partId, color: col.toLowerCase(), cells: copy };
  const model = bumpVersion({ ...m, parts: [...m.parts, part], nextPartId: partId + 1 }, copy.some(hasRim));
  return { model, partId };
}
function replaceWithPieces(m, part, rest) {
  if (rest.length === 0) return removePart(m, part.id);
  const comps = components(rest);
  if (comps.length === 1) return { ...m, parts: replacePart(m, part.id, [{ ...part, cells: rest }]) };
  const ordered = [...comps].sort((a, b) => b.length - a.length);
  let next = allocIds(m, ordered.length - 1);
  const pieces = ordered.map((comp, k) => ({
    id: k === 0 ? part.id : next++,
    color: part.color,
    cells: comp.map((i) => rest[i])
  }));
  return { ...m, parts: replacePart(m, part.id, pieces), nextPartId: next };
}
function removePart(m, partId) {
  requirePart(m, partId);
  return {
    ...m,
    parts: m.parts.filter((p) => p.id !== partId),
    rootPartId: m.rootPartId === partId ? null : m.rootPartId
  };
}
function setRoot(m, partId) {
  if (partId !== null) requirePart(m, partId);
  if (m.rootPartId === partId) return m;
  return { ...m, rootPartId: partId };
}
function canSetRim(m, partId, pos, rim) {
  const part = partById(m, partId);
  if (!part) return { ok: false, reason: `no part with id ${partId}` };
  const cell = cellAt(part, pos);
  if (!cell) return { ok: false, reason: `part ${partId} has no cell at ${fmtPos(pos)}` };
  if (rim === void 0) return { ok: true };
  if (!isHole(cell.kind)) return { ok: false, reason: "wheels grow from pin holes and axle holes" };
  if (typeof rim !== "number" || Number.isNaN(rim)) return { ok: false, reason: `invalid wheel radius ${JSON.stringify(rim)}` };
  if (rim > RIM_MAX) return { ok: false, reason: `largest wheel is radius ${RIM_MAX}` };
  if (rim < RIM_MIN) return { ok: false, reason: `smallest wheel is radius ${RIM_MIN}` };
  if (!isValidRim(rim)) return { ok: false, reason: `wheel radius goes in steps of ${RIM_STEP}` };
  if (cell.rim !== void 0 && rim <= cell.rim) return { ok: true };
  const holes2 = /* @__PURE__ */ new Set();
  for (const c of part.cells) if (isHole(c.kind)) holes2.add(cellKey(c));
  return wheelBlocked(worldIndex(m), cell, rim, partId, (q) => holes2.has(posKey(q[0], q[1], q[2])));
}
function setRim(m, partId, pos, rim) {
  const r = canSetRim(m, partId, pos, rim);
  if (!r.ok) throw new Error(r.reason);
  const part = requirePart(m, partId);
  const idx = part.cells.findIndex((c) => c.x === pos[0] && c.y === pos[1] && c.z === pos[2]);
  const old = part.cells[idx];
  if (old.rim === rim) return m;
  const cells = part.cells.slice();
  cells[idx] = makeCell(old.x, old.y, old.z, old.kind, old.axis, rim);
  const shrink = rim === void 0 || old.rim !== void 0 && rim < old.rim;
  const out2 = shrink ? replaceWithPieces(m, part, cells) : { ...m, parts: replacePart(m, partId, [{ ...part, cells }]) };
  return bumpVersion(out2, rim !== void 0);
}
function rootIsFixed(m) {
  return m.fixRoot !== false || m.ground !== true;
}
function groundLevel(m) {
  if (m.ground !== true) return null;
  let lo = Infinity;
  for (const p of m.parts)
    for (const c of p.cells) {
      lo = Math.min(lo, c.y - 0.5);
      if (c.rim !== void 0 && c.axis !== 1) lo = Math.min(lo, c.y - c.rim);
    }
  return lo === Infinity ? null : lo;
}

// src/core/examples.ts
function runBetween(from, to) {
  const d = [to[0] - from[0], to[1] - from[1], to[2] - from[2]];
  const nonZero = d.filter((v) => v !== 0).length;
  if (nonZero > 1) throw new Error(`run ${JSON.stringify(from)}\u2192${JSON.stringify(to)} is not axis-aligned`);
  const n = Math.max(...d.map(Math.abs));
  const step = d.map(Math.sign);
  const out2 = [];
  for (let i = 0; i <= n; i++) out2.push([from[0] + step[0] * i, from[1] + step[1] * i, from[2] + step[2] * i]);
  return out2;
}
function holes(from, to, holeAxis = 2, kind = "pinHole") {
  return runBetween(from, to).map((p) => makeCell(p[0], p[1], p[2], kind, holeAxis));
}
function beam(from, to, holeAxis = 2) {
  return holes(from, to, holeAxis, "pinHole");
}
var ModelBuilder = class {
  model = emptyModel();
  /** Add a part; returns its id. Colour defaults per DEFAULT_COLORS. */
  add(cells, color) {
    const r = addPart(this.model, cells, color);
    this.model = r.model;
    return r.partId;
  }
  root(partId) {
    this.model = setRoot(this.model, partId);
    return this;
  }
  build() {
    return this.model;
  }
};

// src/core/kinematics.ts
function cmpPos(a, b) {
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
}
function findMates(model) {
  const out2 = [];
  for (const entries of worldIndex(model).map.values()) {
    if (entries.length !== 2) continue;
    const [a, b] = entries;
    if (a.partId === b.partId) continue;
    const r = shareResult(a.cell, b.cell);
    if (!r.ok) continue;
    const male = isMale(a.cell.kind) ? a : b;
    const hole = male === a ? b : a;
    out2.push({
      pos: [male.cell.x, male.cell.y, male.cell.z],
      axis: male.cell.axis,
      malePart: male.partId,
      holePart: hole.partId,
      type: r.mate
    });
  }
  out2.sort((m, n) => cmpPos(m.pos, n.pos));
  return out2;
}
function lineKey(pos, axis) {
  if (axis === 0) return `0|${pos[1]},${pos[2]}`;
  if (axis === 1) return `1|${pos[0]},${pos[2]}`;
  return `2|${pos[0]},${pos[1]}`;
}
var UnionFind = class {
  parent = /* @__PURE__ */ new Map();
  partCount = /* @__PURE__ */ new Map();
  cellCount = /* @__PURE__ */ new Map();
  add(id, cells) {
    this.parent.set(id, id);
    this.partCount.set(id, 1);
    this.cellCount.set(id, cells);
  }
  find(id) {
    let r = id;
    for (; ; ) {
      const p = this.parent.get(r);
      if (p === void 0 || p === r) break;
      r = p;
    }
    let c = id;
    while (c !== r) {
      const p = this.parent.get(c);
      this.parent.set(c, r);
      c = p;
    }
    return r;
  }
  /** Returns true if the classes were distinct. */
  union(a, b) {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra === rb) return false;
    const [keep, drop] = ra < rb ? [ra, rb] : [rb, ra];
    this.parent.set(drop, keep);
    this.partCount.set(keep, this.partCount.get(keep) + this.partCount.get(drop));
    this.cellCount.set(keep, this.cellCount.get(keep) + this.cellCount.get(drop));
    this.partCount.delete(drop);
    this.cellCount.delete(drop);
    return true;
  }
};
function isCylMateAlong(a, b, axis) {
  if (a.axis !== axis || b.axis !== axis) return false;
  const r = shareResult(a, b);
  return r.ok && r.mate === "cylindrical";
}
function maxShift(legal, sign) {
  let n = 0;
  while (n < 1e6 && legal(sign * (n + 1))) n++;
  return n;
}
function perpCoords(c, axis) {
  return axis === 0 ? [c.y, c.z] : axis === 1 ? [c.x, c.z] : [c.x, c.y];
}
function along(c, axis) {
  return axis === 0 ? c.x : axis === 1 ? c.y : c.z;
}
function cylindricalLimits(cellsA, cellsB, axis, onLine, blocked) {
  const [p, q] = axis === 0 ? [onLine[1], onLine[2]] : axis === 1 ? [onLine[0], onLine[2]] : [onLine[0], onLine[1]];
  const at = (t) => axis === 0 ? [t, p, q] : axis === 1 ? [p, t, q] : [p, q, t];
  const lineCells = (cells) => {
    const m = /* @__PURE__ */ new Map();
    for (const c of cells) {
      const [cp, cq] = perpCoords(c, axis);
      if (cp !== p || cq !== q) continue;
      const t = along(c, axis);
      const l = m.get(t);
      if (l) l.push(c);
      else m.set(t, [c]);
    }
    return m;
  };
  const la = lineCells(cellsA);
  const lb = lineCells(cellsB);
  const legal = (s) => {
    let mates = 0;
    for (const [t, bs] of lb) {
      const as = la.get(t + s);
      if (!as) continue;
      if (as.length !== 1 || bs.length !== 1 || !isCylMateAlong(as[0], bs[0], axis)) return false;
      if (blocked(...at(t + s)) || blocked(...at(t))) return false;
      mates++;
    }
    return mates >= 1;
  };
  return [0 - maxShift(legal, -1) || 0, maxShift(legal, 1)];
}
function prismaticLimits(mapA, cellsB, axis, blocked) {
  const byPos = /* @__PURE__ */ new Map();
  for (const c of cellsB) {
    const k = posKey(c.x, c.y, c.z);
    const l = byPos.get(k);
    if (l) l.push(c);
    else byPos.set(k, [c]);
  }
  const groups = [...byPos.values()];
  const legal = (s) => {
    const lines = /* @__PURE__ */ new Set();
    for (const bs of groups) {
      const c = bs[0];
      const x = c.x + (axis === 0 ? s : 0);
      const y = c.y + (axis === 1 ? s : 0);
      const z = c.z + (axis === 2 ? s : 0);
      const as = mapA.get(posKey(x, y, z));
      if (!as) continue;
      if (as.length !== 1 || bs.length !== 1 || !isCylMateAlong(as[0], c, axis)) return false;
      if (blocked(x, y, z) || blocked(c.x, c.y, c.z)) return false;
      lines.add(lineKey([x, y, z], axis));
    }
    return lines.size >= 2;
  };
  return [0 - maxShift(legal, -1) || 0, maxShift(legal, 1)];
}
function isStraightMale(cells) {
  if (cells.length === 0) return false;
  const c0 = cells[0];
  const [p0, q0] = perpCoords(c0, c0.axis);
  for (const c of cells) {
    if (!isMale(c.kind) || c.axis !== c0.axis) return false;
    const [p, q] = perpCoords(c, c0.axis);
    if (p !== p0 || q !== q0) return false;
  }
  return true;
}
function analyze(model) {
  const parts = [...model.parts].sort((p, q) => p.id - q.id);
  const cellsOf = /* @__PURE__ */ new Map();
  for (const p of parts) cellsOf.set(p.id, p.cells);
  const rootId = effectiveRootId(model);
  const mates = findMates(model);
  const uf = new UnionFind();
  for (const p of parts) uf.add(p.id, p.cells.length);
  for (const m of mates) if (m.type === "weld") uf.union(m.malePart, m.holePart);
  const matesOfMale = /* @__PURE__ */ new Map();
  for (const m of mates) {
    const l = matesOfMale.get(m.malePart);
    if (l) l.push(m);
    else matesOfMale.set(m.malePart, [m]);
  }
  const pinCandidates = parts.filter((p) => isStraightMale(p.cells)).map((p) => p.id);
  const revAt = /* @__PURE__ */ new Map();
  for (const m of mates) if (m.type === "revolute") revAt.set(posKey(...m.pos), m);
  const connectors = [];
  const rootFixedHere = rootIsFixed(model);
  let joints = [];
  for (let guard = 0; ; guard++) {
    if (guard > parts.length + 2) throw new Error("kinematic analysis did not converge");
    let changed = false;
    for (const pid of pinCandidates) {
      const r = uf.find(pid);
      if (uf.partCount.get(r) !== 1) continue;
      const ms = (matesOfMale.get(pid) ?? []).filter((m) => uf.find(m.holePart) !== r);
      if (ms.length === 0 || ms.some((m) => m.type !== "revolute")) continue;
      if (!connectors.includes(pid)) connectors.push(pid);
      if (pid === rootId && rootFixedHere) continue;
      const targets = [...new Set(ms.map((m) => uf.find(m.holePart)))].sort((x, y) => x - y);
      const cur = rootId === null ? null : uf.find(rootId);
      let best = targets[0];
      if (cur !== null && targets.includes(cur)) best = cur;
      else {
        for (const t of targets) if (uf.cellCount.get(t) > uf.cellCount.get(best)) best = t;
      }
      uf.union(pid, best);
      changed = true;
    }
    const pairs = /* @__PURE__ */ new Map();
    const pairOf = (rx, ry) => {
      const a = Math.min(rx, ry);
      const b = Math.max(rx, ry);
      const k = `${a},${b}`;
      let g = pairs.get(k);
      if (!g) {
        g = { a, b, mates: [], virtualLines: /* @__PURE__ */ new Set() };
        pairs.set(k, g);
      }
      return g;
    };
    for (const m of mates) {
      if (m.type === "weld") continue;
      const rm = uf.find(m.malePart);
      const rh = uf.find(m.holePart);
      if (rm === rh) continue;
      pairOf(rm, rh).mates.push(m);
    }
    for (const pid of connectors) {
      const own = uf.find(pid);
      const others = [
        ...new Set((matesOfMale.get(pid) ?? []).map((m) => uf.find(m.holePart)).filter((r) => r !== own))
      ].sort((x, y) => x - y);
      const c0 = cellsOf.get(pid)[0];
      const line = lineKey([c0.x, c0.y, c0.z], c0.axis);
      for (let i = 0; i < others.length; i++) {
        for (let k = i + 1; k < others.length; k++) pairOf(others[i], others[k]).virtualLines.add(line);
      }
    }
    const ordered = [...pairs.values()].sort((x, y) => x.a - y.a || x.b - y.b);
    const bodyCells = /* @__PURE__ */ new Map();
    const cellsOfBody = (rep) => {
      let cs = bodyCells.get(rep);
      if (!cs) {
        cs = [];
        for (const p of parts) if (uf.find(p.id) === rep) for (const c of p.cells) cs.push(c);
        bodyCells.set(rep, cs);
      }
      return cs;
    };
    const cellMap = (rep) => {
      const m = /* @__PURE__ */ new Map();
      for (const c of cellsOfBody(rep)) {
        const k = posKey(c.x, c.y, c.z);
        const l = m.get(k);
        if (l) l.push(c);
        else m.set(k, [c]);
      }
      return m;
    };
    const blockedFor = (a, b) => (x, y, z) => {
      const m = revAt.get(posKey(x, y, z));
      if (!m) return false;
      const rh = uf.find(m.holePart);
      const rm = uf.find(m.malePart);
      return (rh === a || rh === b) && rm !== a && rm !== b;
    };
    const unions = [];
    const next = [];
    for (const { a, b, mates: ms, virtualLines } of ordered) {
      const lines = /* @__PURE__ */ new Set([...ms.map((m) => lineKey(m.pos, m.axis)), ...virtualLines]);
      if (ms.length === 0) {
        if (lines.size >= 2) unions.push([a, b]);
        continue;
      }
      const origin = [...ms[0].pos];
      const axis = ms[0].axis;
      if (lines.size === 1) {
        if (virtualLines.size > 0 || ms.some((m) => m.type === "revolute")) {
          next.push({ a, b, type: "revolute", origin, axis });
        } else {
          const lim = cylindricalLimits(cellsOfBody(a), cellsOfBody(b), axis, origin, blockedFor(a, b));
          if (lim[0] === 0 && lim[1] === 0) next.push({ a, b, type: "revolute", origin, axis });
          else next.push({ a, b, type: "cylindrical", origin, axis, limits: lim });
        }
        continue;
      }
      const parallel = ms.every((m) => m.axis === axis);
      const allCyl = virtualLines.size === 0 && ms.every((m) => m.type === "cylindrical");
      if (parallel && allCyl) {
        const lim = prismaticLimits(cellMap(a), cellsOfBody(b), axis, blockedFor(a, b));
        if (lim[0] === 0 && lim[1] === 0) unions.push([a, b]);
        else next.push({ a, b, type: "prismatic", origin, axis, limits: lim });
      } else {
        unions.push([a, b]);
      }
    }
    for (const [a, b] of unions) if (uf.union(a, b)) changed = true;
    joints = next;
    if (!changed) break;
  }
  const reps = [...new Set(parts.map((p) => uf.find(p.id)))].sort((x, y) => x - y);
  const bodyIdOfRep = /* @__PURE__ */ new Map();
  reps.forEach((r, i) => bodyIdOfRep.set(r, i));
  const bodies = reps.map((r, i) => ({ id: i, partIds: [], fixed: false }));
  const rootFixed = rootIsFixed(model);
  const bodyOfPart = /* @__PURE__ */ new Map();
  for (const p of parts) {
    const bid = bodyIdOfRep.get(uf.find(p.id));
    bodies[bid].partIds.push(p.id);
    if (p.id === rootId && rootFixed) bodies[bid].fixed = true;
    bodyOfPart.set(p.id, bid);
  }
  const outJoints = joints.map((j) => {
    const out2 = {
      bodyA: bodyIdOfRep.get(j.a),
      bodyB: bodyIdOfRep.get(j.b),
      type: j.type,
      origin: j.origin,
      axis: j.axis
    };
    if (j.limits) out2.limits = j.limits;
    return out2;
  });
  outJoints.sort((x, y) => x.bodyA - y.bodyA || x.bodyB - y.bodyB);
  return { mates, bodies, joints: outJoints, bodyOfPart };
}

// src/geometry/dims.ts
var H = 0.47;
var R_BORE = 0.31;
var E_FREE = 0.48;
var EPS = 5e-3;
var E_CONN = 0.5 + EPS;
var HC = 0.46;
var R_COLL_ROD = 0.29;
var RIM_INSET = 0.5 - H;
var RIM_COLL_INSET = 0.5 - HC;

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
  const out2 = [];
  for (const t of analyzeCells(part)) {
    const c = t.cell;
    const ctr = localCenter(c, origin);
    const a = c.axis;
    if (isMale(c.kind)) {
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
    if (isHub(c)) {
      out2.push({ shape: "disc", center: [ctr[0], ctr[1], ctr[2]], axis: a, radius: c.rim - RIM_COLL_INSET, halfLength: HC, innerRadius: HC, cell: t.index, male: false });
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
  const out2 = [];
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
      const run2 = [];
      for (let k = 0; k <= n; k++) run2.push(plainAt(...step(k), c.axis));
      run2.forEach((ci, k) => {
        coveredBarrel.add(ci);
        if (k > 0) coveredWeb.add(`${ci}:${d}:-1`);
        if (k < n) coveredWeb.add(`${ci}:${d}:1`);
      });
      const first = plain.get(run2[0]);
      out2.push(prismShape(w(first.center), c.axis, first.radius, first.halfLength, segments, d, n));
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
    const c = cells[p.cell];
    const ctr = w(p.center);
    const off = [ctr[0] - c.x, ctr[1] - c.y, ctr[2] - c.z];
    const d = off.findIndex((x) => Math.abs(x) > EPS2);
    if (d >= 0 && coveredWeb.has(`${p.cell}:${d}:${Math.sign(off[d])}`)) continue;
    out2.push({ kind: "box", center: ctr, halfExtents: [...p.halfExtents] });
  }
  return out2;
}

// src/physics/math.ts
function vec(v) {
  return [v.x, v.y, v.z];
}
function quat(q) {
  return [q.x, q.y, q.z, q.w];
}
function xyz(v) {
  return { x: v[0], y: v[1], z: v[2] };
}
function add(a, b) {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}
function sub(a, b) {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}
function scale(a, s) {
  return [a[0] * s, a[1] * s, a[2] * s];
}
function dot(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}
function cross(a, b) {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
function len(a) {
  return Math.hypot(a[0], a[1], a[2]);
}
function rotate(q, v) {
  const [x, y, z, w] = q;
  const tx = 2 * (y * v[2] - z * v[1]);
  const ty = 2 * (z * v[0] - x * v[2]);
  const tz = 2 * (x * v[1] - y * v[0]);
  return [v[0] + w * tx + (y * tz - z * ty), v[1] + w * ty + (z * tx - x * tz), v[2] + w * tz + (x * ty - y * tx)];
}
function conj(q) {
  return [-q[0], -q[1], -q[2], q[3]];
}
function qmul(a, b) {
  const [ax, ay, az, aw] = a;
  const [bx, by, bz, bw] = b;
  return [
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
    aw * bw - ax * bx - ay * by - az * bz
  ];
}
function qnormalize(q) {
  const n = Math.hypot(q[0], q[1], q[2], q[3]) || 1;
  return [q[0] / n, q[1] / n, q[2] / n, q[3] / n];
}
function axisAngle(a, angle) {
  const s = Math.sin(angle / 2);
  return [a[0] * s, a[1] * s, a[2] * s, Math.cos(angle / 2)];
}
function unitAxis(axis, s = 1) {
  const v = [0, 0, 0];
  v[axis] = s;
  return v;
}

// src/physics/rapier.ts
import RAPIER from "@dimforge/rapier3d-compat";
var ready = null;
function initPhysics() {
  if (!ready) {
    ready = RAPIER.init().catch((e) => {
      ready = null;
      throw e;
    });
  }
  return ready;
}

// spikes/gearsim/gearsim.ts
var G = 1226.25;
var NOISE = 1e-5;
var JOINT_FRICTION = { off: 0, low: 0.05, realistic: 0.2 };
var GRAB_PRESS_LIMIT = 2;
var DEFAULT_FRICTION_LEVEL = "realistic";
var MAX_JOINT_FRICTION = 10;
var STICK_SPEED = 0.01;
var SLIP = 2e-4;
var HOLD_DEADBAND = 1e-5;
var FRICTION_GAIN = 1e9;
var SPEED_CAP = 400;
var GROUP = {
  ground: 1 << 16 | (2 | 8 | 16),
  round: 2 << 16 | (1 | 2),
  hull: 4 << 16 | 8,
  part: 8 << 16 | (1 | 4 | 8),
  guard: 16 << 16 | 1
};
var TYRE_FRICTION = 0.8;
var GROUND_SINK_DIST = 0.05;
var PITCH = Math.PI / 8;
var MESH = {
  /** Engage when gap ≤ engageGap (half the 0.25 working depth: teeth overlap by half). */
  engageGap: 0.125,
  /** Release when gap > releaseGap (tip contact: two addenda of 0.125). */
  releaseGap: 0.25,
  /** Never engage below this gap (one gear inside the other), release below minGap − 0.25. */
  minGap: -0.25,
  /** Engage when |delta| ≤ axialIn (teeth overlap ≥ 0.4 of the face), release when |delta| > axialOut. */
  axialIn: 0.6,
  axialOut: 0.9,
  /** Engage when the axes are within parIn rad of parallel, release beyond parOut. */
  parIn: 0.035,
  parOut: 0.087,
  /** Snap on engagement: the phase reference moves to the nearest tooth-compatible phase at this rate (units of pitch arc per second; 0.002 per 1/480 s step). */
  snapRate: 0.96,
  /** The LinY stop sits this far below min(0, gap at engagement). */
  stopSlack: 5e-3,
  /** Phase feedback gain (anchor 2 offset −k·e). */
  feedback: 1,
  lead: true,
  /** Stop row (one-sided LinY limit) on every mesh. */
  stop: true,
  /** Merge the energy-guard groups of meshed gears. */
  mergeGroups: true,
  /** Release (and do not engage) while either gear body's linear speed exceeds this (units/s; Rapier clamps at 400). Infinity = off. */
  maxLinSpeed: 350
};
var DEFAULTS = {
  speed: 0.25,
  fixedDt: 1 / 480,
  solverIterations: 240,
  freeSolverIterations: 30,
  pgsIterations: 1,
  maxStepsPerCall: 16,
  stepBudgetMs: 8,
  angularDamping: 0,
  friction: 0.4,
  restitution: 0.1,
  density: 1,
  removeBelowY: -400,
  grabFrequency: 10,
  grabAngularDamping: 5,
  cylinderSegments: 16,
  decoupleInertia: true,
  energyGuard: true,
  energyGuardBand: 0.01,
  jointFriction: JOINT_FRICTION[DEFAULT_FRICTION_LEVEL],
  groundSlopeDeg: 0,
  gears: true,
  substeps: 1
};
var twist = (q, a, st) => {
  const raw = 2 * Math.atan2(q[0] * a[0] + q[1] * a[1] + q[2] * a[2], q[3]);
  if (st.prev === void 0) st.acc = raw;
  else st.acc += wrapAngle(raw - st.prev);
  st.prev = raw;
  return st.acc;
};
var planeBasis = (a) => {
  const c = Math.abs(a[0]) < 0.9 ? cross(a, [1, 0, 0]) : cross(a, [0, 1, 0]);
  const e1 = scale(c, 1 / len(c));
  return [e1, cross(a, e1)];
};
var angleIn = (n, a, st) => {
  const [e1, e2] = planeBasis(a);
  const raw = Math.atan2(dot(n, e2), dot(n, e1));
  if (st.prev === void 0) st.acc = raw;
  else st.acc += wrapAngle(raw - st.prev);
  st.prev = raw;
  return st.acc;
};
function basisQuat(X, Y, Z) {
  const [m00, m10, m20] = X;
  const [m01, m11, m21] = Y;
  const [m02, m12, m22] = Z;
  const tr = m00 + m11 + m22;
  if (tr > 0) {
    const S2 = Math.sqrt(tr + 1) * 2;
    return [(m21 - m12) / S2, (m02 - m20) / S2, (m10 - m01) / S2, 0.25 * S2];
  } else if (m00 > m11 && m00 > m22) {
    const S2 = Math.sqrt(1 + m00 - m11 - m22) * 2;
    return [0.25 * S2, (m01 + m10) / S2, (m02 + m20) / S2, (m21 - m12) / S2];
  } else if (m11 > m22) {
    const S2 = Math.sqrt(1 + m11 - m00 - m22) * 2;
    return [(m01 + m10) / S2, 0.25 * S2, (m12 + m21) / S2, (m02 - m20) / S2];
  }
  const S = Math.sqrt(1 + m22 - m00 - m11) * 2;
  return [(m02 + m20) / S, (m12 + m21) / S, 0.25 * S, (m10 - m01) / S];
}
var LIN_X = 0;
var ANG_X = 3;
var ACCELERATION_BASED = 0;
var Simulation = class _Simulation {
  graph;
  fixedDt;
  /** Fixed steps taken so far. */
  stepCount = 0;
  /** Fixed steps step() dropped because of maxStepsPerCall or stepBudgetMs (readable counter). */
  droppedSteps = 0;
  speedValue;
  world;
  bodies = [];
  joints = [];
  bodyOfPart;
  opts;
  gravity;
  acc = 0;
  /** y below which a dynamic body's centre of mass is removed (see SimOptions.removeBelowY). */
  removalY;
  grabState = null;
  disposed = false;
  /** World substep count (= free-body substeps); jointed bodies add solverIterations − this. */
  baseIterations;
  /** Energy guard: collision events (to merge groups that touch), union-find over body ids, state per root. */
  events = null;
  groupParent = [];
  groups = /* @__PURE__ */ new Map();
  bodyOfCollider = /* @__PURE__ */ new Map();
  /** Energy the guard has removed so far (diagnostics). */
  guardRemoved = 0;
  frictionValue;
  /** Friction work (τ_f·|Δθ| + F_f·|Δs|) done in the last step, per energy-guard group root. */
  frictionWork = /* @__PURE__ */ new Map();
  /**
   * y of the ground's physics plane (groundLevel + ½ − HC) at its pivot under the model's mean cell
   * centre; null without a ground (DESIGN §5.1 "Ground").
   */
  groundY = null;
  /** Unit normal of the ground plane (tilted by groundSlopeDeg), and the plane's pivot point. */
  groundNormal = [0, 1, 0];
  groundPoint = [0, 0, 0];
  /** Dynamic bodies with a horizontal-axis rim touching the ground at Play (joint-friction load sinks). */
  groundSinks = /* @__PURE__ */ new Set();
  /** Collision groups are in use (the model has a rim or a ground). */
  grouped;
  /** GEARSIM: world steps per fixed step, the world step h = fixedDt / k, mesh parameters, gears and candidate pairs. */
  k;
  h;
  meshP;
  gears = [];
  meshes = [];
  /** GEARSIM: world steps taken; per-world-step max |ω|·h over gear bodies (for histograms) is reported to this hook. */
  worldSteps = 0;
  onWorldStep = null;
  /** Analyse `model` (which must be valid) and build its Rapier world. */
  static async create(model, opts = {}) {
    await initPhysics();
    return new _Simulation(model, opts);
  }
  constructor(model, options) {
    const o = { ...DEFAULTS };
    for (const k of Object.keys(DEFAULTS)) {
      const v = options[k];
      if (v !== void 0) o[k] = v;
    }
    if (!(o.fixedDt > 0) || !Number.isFinite(o.fixedDt)) throw new Error(`fixedDt must be > 0 (got ${o.fixedDt})`);
    if (!(o.speed >= 0) || !Number.isFinite(o.speed)) throw new Error(`speed must be >= 0 (got ${o.speed})`);
    this.opts = o;
    this.fixedDt = o.fixedDt;
    if (!(Number.isInteger(o.substeps) && o.substeps >= 1)) throw new Error(`substeps must be a positive integer (got ${o.substeps})`);
    this.k = o.substeps;
    this.h = o.fixedDt / o.substeps;
    o.solverIterations = Math.max(1, Math.round(o.solverIterations / o.substeps));
    o.freeSolverIterations = Math.max(1, Math.round(o.freeSolverIterations / o.substeps));
    this.meshP = { ...MESH, ...options.mesh ?? {} };
    this.speedValue = o.speed;
    this.frictionValue = checkFriction(o.jointFriction);
    this.gravity = options.gravity ? [...options.gravity] : [0, -G, 0];
    this.graph = analyze(model);
    let minY = Infinity;
    for (const p of model.parts) for (const c of p.cells) minY = Math.min(minY, c.y);
    this.removalY = Number.isFinite(minY) ? Math.min(o.removeBelowY, minY + o.removeBelowY) : o.removeBelowY;
    this.bodyOfPart = this.graph.bodyOfPart;
    const level = groundLevel(model);
    const hasRim2 = model.parts.some((p) => p.cells.some((c) => c.rim !== void 0));
    this.grouped = hasRim2 || level !== null;
    if (level !== null) {
      if (!Number.isFinite(o.groundSlopeDeg) || Math.abs(o.groundSlopeDeg) >= 90)
        throw new Error(`groundSlopeDeg must be in (\u221290, 90) (got ${o.groundSlopeDeg})`);
      const th = o.groundSlopeDeg * Math.PI / 180;
      const nrm = [Math.sin(th), Math.cos(th), 0];
      let cx = 0;
      let cz = 0;
      let n = 0;
      let low = Infinity;
      const half = 0.5 * (Math.abs(nrm[0]) + Math.abs(nrm[1]) + Math.abs(nrm[2]));
      for (const p of model.parts)
        for (const c of p.cells) {
          cx += c.x;
          cz += c.z;
          n++;
          const h = c.x * nrm[0] + c.y * nrm[1] + c.z * nrm[2];
          low = Math.min(low, h - half);
          if (c.rim !== void 0) low = Math.min(low, h - c.rim * Math.sqrt(Math.max(0, 1 - nrm[c.axis] ** 2)) - 0.5 * Math.abs(nrm[c.axis]));
        }
      if (th === 0) low = level;
      let d = low + (0.5 - HC);
      for (const p of model.parts)
        for (const c of p.cells) {
          if (c.kind !== "pin" && c.kind !== "axle" && c.kind !== "frictionPin") continue;
          const na = Math.abs(nrm[c.axis]);
          const reach = E_FREE * na + R_COLL_ROD * Math.sqrt(Math.max(0, 1 - na * na));
          d = Math.min(d, c.x * nrm[0] + c.y * nrm[1] + c.z * nrm[2] - reach);
        }
      cx /= n;
      cz /= n;
      this.groundY = (d - nrm[0] * cx - nrm[2] * cz) / nrm[1];
      this.groundPoint = [cx, this.groundY, cz];
      this.groundNormal = nrm;
    }
    const world = new RAPIER.World(xyz(this.gravity));
    this.world = world;
    world.timestep = this.h;
    this.baseIterations = Math.max(1, Math.min(o.freeSolverIterations, o.solverIterations));
    world.numSolverIterations = this.baseIterations;
    world.numInternalPgsIterations = o.pgsIterations;
    world.integrationParameters.maxCcdSubsteps = 0;
    try {
      this.buildGroundCollider();
      this.buildBodies(model);
      this.buildGround(model);
      this.buildJoints();
      this.buildMeshCandidates();
      this.applyFriction();
      if (o.energyGuard) {
        this.events = new RAPIER.EventQueue(true);
        this.initGroups();
      }
    } catch (e) {
      this.events?.free();
      world.free();
      throw e;
    }
  }
  buildBodies(model) {
    const partById2 = new Map(model.parts.map((p) => [p.id, p]));
    const o = this.opts;
    const jointed = /* @__PURE__ */ new Set();
    for (const j of this.graph.joints) {
      jointed.add(j.bodyA);
      jointed.add(j.bodyB);
    }
    const extra = Math.max(0, o.solverIterations - this.baseIterations);
    for (const b of this.graph.bodies) {
      const parts = b.partIds.map((id) => partById2.get(id)).filter((p) => p && p.cells.length > 0);
      let ref = [0, 0, 0];
      let n = 0;
      for (const p of parts) for (const c of p.cells) {
        ref = add(ref, [c.x, c.y, c.z]);
        n++;
      }
      if (n > 0) ref = scale(ref, 1 / n).map(Math.fround);
      const desc = b.fixed ? RAPIER.RigidBodyDesc.fixed() : RAPIER.RigidBodyDesc.dynamic().setCanSleep(false).setAngularDamping(o.angularDamping);
      if (!b.fixed && jointed.has(b.id)) desc.setAdditionalSolverIterations(extra);
      desc.setTranslation(ref[0], ref[1], ref[2]);
      const rb = this.world.createRigidBody(desc);
      const addCollider = (cd) => {
        if (!b.fixed && o.energyGuard) cd.setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS);
        const col = this.world.createCollider(cd, rb);
        this.bodyOfCollider.set(col.handle, b.id);
      };
      for (const p of parts) {
        for (const sh of partShapes(p, o.cylinderSegments)) {
          let cd;
          if (sh.kind === "wheel") {
            this.addWheel(sh, ref, addCollider);
            continue;
          }
          if (sh.kind === "hull") {
            const pts = new Float32Array(sh.points.length * 3);
            sh.points.forEach((q, i) => pts.set(sub(q, ref), i * 3));
            cd = RAPIER.ColliderDesc.convexHull(pts);
            if (!cd) throw new Error(`convex hull failed for part ${p.id}`);
            const mp = sh.mass;
            cd.setMassProperties(mp.volume * o.density, xyz(sub(mp.com, ref)), xyz(scale(mp.inertia, o.density)), { x: 0, y: 0, z: 0, w: 1 });
          } else {
            const c = sub(sh.center, ref);
            cd = RAPIER.ColliderDesc.cuboid(sh.halfExtents[0], sh.halfExtents[1], sh.halfExtents[2]).setTranslation(c[0], c[1], c[2]);
            cd.setDensity(o.density);
          }
          cd.setFriction(o.friction).setRestitution(o.restitution);
          if (this.grouped) cd.setCollisionGroups(GROUP.part);
          addCollider(cd);
        }
      }
      this.bodies.push({ id: b.id, fixed: b.fixed, ref, rb });
      if (o.gears) {
        for (const p of parts)
          for (const c of p.cells)
            if (c.rim !== void 0) this.gears.push({ body: b.id, partId: p.id, local: sub([c.x, c.y, c.z], ref), axis: unitAxis(c.axis), r: c.rim });
      }
    }
    for (const sb of this.bodies)
      if (!sb.fixed && !jointed.has(sb.id)) sb.rb.setSoftCcdPrediction(SPEED_CAP * this.h * 1.25);
    this.decoupleInertia();
  }
  /**
   * The two colliders of a rim (DESIGN §5.1 "Wheels"; shapes.ts WheelShape), positions relative to
   * the body's reference point `ref`:
   *  - round: native cylinder (Rapier builds it along local Y; rotated onto the wheel axis), mass
   *    of the annulus set explicitly (f64 values, like the prisms), tyre friction, group `round`;
   *  - hull: the bevelled 32-gon prism, density 0, part friction, group `hull`;
   *  - with a ground, the ground guard (WheelShape.guard): density 0, tyre friction, group `guard`.
   */
  addWheel(sh, ref, add2) {
    const o = this.opts;
    const c = sub(sh.center, ref);
    const s = Math.SQRT1_2;
    const rot = sh.axis === 0 ? { x: 0, y: 0, z: -s, w: s } : sh.axis === 2 ? { x: s, y: 0, z: 0, w: s } : { x: 0, y: 0, z: 0, w: 1 };
    const m = sh.mass;
    const ia = m.inertia[sh.axis] * o.density;
    const it = m.inertia[(sh.axis + 1) % 3] * o.density;
    const round = RAPIER.ColliderDesc.cylinder(sh.halfLength, sh.radius).setTranslation(c[0], c[1], c[2]).setRotation(rot).setMassProperties(m.volume * o.density, { x: 0, y: 0, z: 0 }, { x: it, y: ia, z: it }, { x: 0, y: 0, z: 0, w: 1 }).setFriction(TYRE_FRICTION).setRestitution(o.restitution).setCollisionGroups(GROUP.round);
    add2(round);
    const pts = new Float32Array(sh.hull.length * 3);
    sh.hull.forEach((q, i) => pts.set(sub(q, ref), i * 3));
    const hull = RAPIER.ColliderDesc.convexHull(pts);
    if (!hull) throw new Error("convex hull failed for a wheel");
    hull.setDensity(0).setFriction(o.friction).setRestitution(o.restitution).setCollisionGroups(GROUP.hull);
    add2(hull);
    if (this.groundY === null) return;
    const gp = new Float32Array(sh.guard.length * 3);
    sh.guard.forEach((q, i) => gp.set(sub(q, ref), i * 3));
    const guard = RAPIER.ColliderDesc.convexHull(gp);
    if (!guard) throw new Error("convex hull failed for a wheel guard");
    guard.setDensity(0).setFriction(0).setFrictionCombineRule(RAPIER.CoefficientCombineRule.Min).setRestitution(o.restitution).setCollisionGroups(GROUP.guard);
    add2(guard);
  }
  /**
   * The ground (DESIGN §5.1 "Ground"): a fixed body with a half-space collider through groundPoint
   * with normal groundNormal (buildGroundCollider, created before every other body); not one of
   * `bodies`. buildGround finds the joint-friction sinks: dynamic
   * bodies with a rim about a horizontal axis whose lowest point (nominal radius r) is within
   * GROUND_SINK_DIST of the nominal floor (groundLevel, i.e. the physics plane less ½ − HC).
   */
  buildGroundCollider() {
    if (this.groundY === null) return;
    const n = this.groundNormal;
    const p0 = this.groundPoint;
    const rb = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    const cd = new RAPIER.ColliderDesc(new RAPIER.HalfSpace(xyz(n))).setTranslation(p0[0], p0[1], p0[2]).setFriction(this.opts.friction).setRestitution(this.opts.restitution).setCollisionGroups(GROUP.ground);
    this.world.createCollider(cd, rb);
  }
  buildGround(model) {
    if (this.groundY === null) return;
    const n = this.groundNormal;
    const p0 = this.groundPoint;
    const nominal = sub(p0, scale(n, 0.5 - HC));
    for (const p of model.parts) {
      const bid = this.bodyOfPart.get(p.id);
      if (bid === void 0 || this.bodies[bid].fixed) continue;
      for (const c of p.cells) {
        if (c.rim === void 0 || c.axis === 1) continue;
        const h = dot(sub([c.x, c.y, c.z], nominal), n) - c.rim * Math.sqrt(Math.max(0, 1 - n[c.axis] ** 2));
        if (h <= GROUND_SINK_DIST + 1e-9) this.groundSinks.add(bid);
      }
    }
  }
  /**
   * Rapier blows up a body that rotates about a joint axis which is not one of its principal
   * axes (measured: a tilted bar on a revolute joint spins up from 20 rad/s to the 377 rad/s
   * cap within 2 s; any part whose cells are not mirror-symmetric about the plane through its
   * centre of mass normal to the axis has such products of inertia, e.g. an arm on an axle or a
   * link carrying a pin). For a mechanism attached to a fixed body whose joints all share one
   * axis a, every body can only rotate about a, and then only I_aa (and mass / centre of mass)
   * enter the motion: the products I_ab, I_ac only produce torques normal to a, which the joints
   * absorb. So with opts.decoupleInertia (default) the products with a are dropped for exactly
   * those bodies (mass, centre of mass, I_aa and the other 2×2 block unchanged), which makes a
   * principal and removes the blow-up without changing the exact motion. Other bodies keep their
   * true inertia.
   */
  decoupleInertia() {
    if (!this.opts.decoupleInertia) return;
    const decoupled = /* @__PURE__ */ new Map();
    this.findPlanarMechanisms(decoupled);
    for (const [id, a] of decoupled) setDecoupledInertia(this.bodies[id].rb, a);
  }
  /** Bodies of mechanisms attached to a fixed body whose joints all share one axis → that axis. */
  findPlanarMechanisms(decoupled) {
    const fixed = (id) => this.bodies[id].fixed;
    const seen = /* @__PURE__ */ new Set();
    for (const start of this.bodies) {
      if (start.fixed || seen.has(start.id)) continue;
      const comp = [];
      const axes = /* @__PURE__ */ new Set();
      let attached = false;
      const stack = [start.id];
      seen.add(start.id);
      while (stack.length) {
        const u = stack.pop();
        comp.push(u);
        for (const j of this.graph.joints) {
          if (j.bodyA !== u && j.bodyB !== u) continue;
          axes.add(j.axis);
          const o = j.bodyA === u ? j.bodyB : j.bodyA;
          if (fixed(o)) attached = true;
          else if (!seen.has(o)) {
            seen.add(o);
            stack.push(o);
          }
        }
      }
      if (!attached || axes.size !== 1) continue;
      const a = [...axes][0];
      for (const id of comp) decoupled.set(id, a);
    }
  }
  buildJoints() {
    this.graph.joints.forEach((j, index) => {
      const A = this.bodies[j.bodyA];
      const B = this.bodies[j.bodyB];
      const anchorA = sub(j.origin, A.ref);
      const anchorB = sub(j.origin, B.ref);
      const axis = unitAxis(j.axis);
      const handle = this.createImpulse(j, A.rb, B.rb, anchorA, anchorB, axis);
      const stick = () => ({ x: 0, stuck: false, at: 0, target: 0 });
      this.joints.push({ index, joint: j, sliding: j.type !== "revolute", anchorA, anchorB, axis, handle, mj: 0, motors: false, ang: stick(), lin: stick() });
    });
    const mj = this.loadMasses();
    this.joints.forEach((sj, i) => sj.mj = mj[i]);
  }
  /**
   * Load mass m_j of every joint (graph.joints order) for joint friction (DESIGN §5.1, DEVIATIONS
   * §5 "Joint friction: load estimate"): the weight each joint passes on toward the fixed bodies,
   * fixed for the run. Engine masses (after decoupleInertia, which keeps the mass).
   *  - Bodies are ranked by their joint distance from a fixed body. Starting with the farthest,
   *    each dynamic body passes its own mass plus everything passed to it on to its joints that
   *    lead one step closer to a fixed body, in equal shares. A joint's load is what it passes.
   *    So in a chain every pivot carries everything below it, and a loop shares a coupler's
   *    weight between the two sides.
   *  - A joint that passes nothing (it joins two bodies at the same distance, e.g. across a loop)
   *    and every joint of a group of bodies with no path to a fixed body: the lighter body's mass
   *    (a fixed body counts as infinitely heavy; two fixed bodies give Infinity, i.e. no friction).
   *  - With a ground, bodies with a horizontal-axis rim touching it at Play (groundSinks) count as
   *    sinks at distance 0 like fixed bodies (DESIGN §5.1 "Free root"): a cart's axles each carry
   *    their share of the chassis, a wheel's own weight goes straight into the ground.
   */
  loadMasses() {
    const mass = (id) => this.bodies[id].fixed ? Infinity : this.bodies[id].rb.mass();
    const joints = this.graph.joints;
    const dist = /* @__PURE__ */ new Map();
    let frontier = this.bodies.filter((b) => b.fixed || this.groundSinks.has(b.id)).map((b) => b.id);
    for (const id of frontier) dist.set(id, 0);
    for (let d = 1; frontier.length; d++) {
      const next = [];
      for (const u of frontier)
        for (const j of joints) {
          const o = j.bodyA === u ? j.bodyB : j.bodyB === u ? j.bodyA : -1;
          if (o < 0 || dist.has(o)) continue;
          dist.set(o, d);
          next.push(o);
        }
      frontier = next;
    }
    const passed = joints.map(() => 0);
    const carried = /* @__PURE__ */ new Map();
    const order = this.bodies.filter((b) => !b.fixed && dist.get(b.id) > 0).sort((a, b) => dist.get(b.id) - dist.get(a.id) || a.id - b.id);
    for (const b of order) {
      const d = dist.get(b.id);
      const load = mass(b.id) + (carried.get(b.id) ?? 0);
      const down = [];
      joints.forEach((j, i) => {
        const o = j.bodyA === b.id ? j.bodyB : j.bodyB === b.id ? j.bodyA : -1;
        if (o >= 0 && dist.get(o) === d - 1) down.push(i);
      });
      for (const i of down) {
        const j = joints[i];
        const o = j.bodyA === b.id ? j.bodyB : j.bodyA;
        passed[i] = passed[i] + load / down.length;
        if (dist.get(o) > 0) carried.set(o, (carried.get(o) ?? 0) + load / down.length);
      }
    }
    return joints.map((j, i) => passed[i] > 0 ? passed[i] : Math.min(mass(j.bodyA), mass(j.bodyB)));
  }
  createImpulse(j, A, B, anchorA, anchorB, axis) {
    const LOCK_CYL = RAPIER.JointAxesMask.LinY | RAPIER.JointAxesMask.LinZ | RAPIER.JointAxesMask.AngY | RAPIER.JointAxesMask.AngZ;
    let data;
    if (j.type === "revolute") {
      data = RAPIER.JointData.revolute(xyz(anchorA), xyz(anchorB), xyz(axis));
    } else if (j.type === "prismatic") {
      data = RAPIER.JointData.prismatic(xyz(anchorA), xyz(anchorB), xyz(axis));
      const [lo, hi] = j.limits ?? [0, 0];
      data.limitsEnabled = true;
      data.limits = [lo, hi];
    } else {
      data = RAPIER.JointData.generic(xyz(anchorA), xyz(anchorB), xyz(axis), LOCK_CYL);
    }
    const handle = this.world.createImpulseJoint(data, A, B, true);
    if (j.type === "cylindrical") {
      const [lo, hi] = j.limits ?? [0, 0];
      this.world.impulseJoints.raw.jointSetLimits(handle.handle, LIN_X, lo, hi);
    }
    handle.setContactsEnabled(false);
    return handle;
  }
  // ------------------------------------------------------------------------------------------
  // Joint friction
  /** Joint friction coefficient μ in use (see SimOptions.jointFriction). */
  get jointFriction() {
    return this.frictionValue;
  }
  /**
   * Change the joint friction coefficient μ (≥ 0, finite; see JOINT_FRICTION). Takes effect on the
   * next fixed step; allowed at any time, also while a body is grabbed.
   */
  setJointFriction(mu) {
    this.alive();
    const v = checkFriction(mu);
    if (v === this.frictionValue) return;
    this.frictionValue = v;
    this.applyFriction();
    for (const b of this.bodies) if (!b.fixed && b.rb) this.resetGroup(b.id);
  }
  /** Friction limits of a joint at the current μ: torque τ_f about and force F_f along its axis. */
  frictionLimits(sj) {
    const mu = this.frictionValue;
    if (!(mu > 0) || !Number.isFinite(sj.mj)) return { torque: 0, force: 0 };
    const force = mu * sj.mj * len(this.gravity);
    const t = sj.joint.type;
    return { torque: t === "prismatic" ? 0 : force * R_BORE, force: t === "revolute" ? 0 : force };
  }
  /**
   * Dry friction on every joint's free axes: a velocity motor with target 0 whose torque/force is
   * limited to τ_f / F_f (Rapier's maxForce is a force or torque, applied per substep: measured, see
   * DEVIATIONS §5 "Joint friction"). Sliding, it pulls with exactly that limit against the relative
   * motion; below the limit it holds the relative velocity at 0 (stiction). With μ = 0 a joint that
   * never had friction gets no motor at all (the world is exactly the frictionless one); a joint
   * that had friction keeps its motor rows at limit 0 and target 0, which apply no impulse.
   * Every call forgets the stiction state (it is re-detected after the next step).
   */
  applyFriction() {
    const raw = this.world.impulseJoints.raw;
    this.frictionWork.clear();
    for (const sj of this.joints) {
      if (!sj.handle) continue;
      const { torque, force } = this.frictionLimits(sj);
      if (!sj.motors && torque === 0 && force === 0) continue;
      const h = sj.handle.handle;
      for (const [axis, st, limit] of this.frictionAxes(sj, torque, force)) {
        if (!sj.motors) raw.jointConfigureMotorModel(h, axis, ACCELERATION_BASED);
        if (!sj.motors || st.target !== 0) raw.jointConfigureMotorVelocity(h, axis, 0, FRICTION_GAIN);
        raw.jointSetMotorMaxForce(h, axis, limit);
        st.stuck = false;
        st.target = 0;
      }
      sj.motors = true;
      this.measureJoint(sj);
    }
  }
  /** The free axes of a joint with their stiction state and friction limit. */
  frictionAxes(sj, torque, force) {
    const t = sj.joint.type;
    const out2 = [];
    if (t !== "prismatic") out2.push([ANG_X, sj.ang, torque]);
    if (t !== "revolute") out2.push([LIN_X, sj.lin, force]);
    return out2;
  }
  /**
   * Relative coordinates and speeds of a live joint: angle of B relative to A about the axis since
   * the build pose (rad, in (−π, π]), B's anchor along A's axis (units), and their rates — the same
   * quantities and signs as jointStates' omega / speed, which are also the signs of the friction
   * motors' target velocity (measured).
   */
  jointCoords(sj) {
    const A = this.bodies[sj.joint.bodyA].rb;
    const B = this.bodies[sj.joint.bodyB].rb;
    const qa = quat(A.rotation());
    const qb = quat(B.rotation());
    const axA = rotate(qa, sj.axis);
    const rel = qmul(conj(qa), qb);
    const theta = 2 * Math.atan2(dot([rel[0], rel[1], rel[2]], sj.axis), rel[3]);
    const omega = dot(sub(vec(B.angvel()), vec(A.angvel())), axA);
    if (!sj.sliding) return { theta, omega, slide: 0, speed: 0 };
    const pa = add(rotate(qa, sj.anchorA), vec(A.translation()));
    const pb = add(rotate(qb, sj.anchorB), vec(B.translation()));
    const slide = dot(sub(pb, pa), axA);
    const speed = dot(sub(vec(B.velocityAtPoint(xyz(pb))), vec(A.velocityAtPoint(xyz(pb)))), axA);
    return { theta, omega, slide, speed };
  }
  /** Record a joint's current coordinates as the reference for the next step's friction work. */
  measureJoint(sj) {
    if (!sj.handle) return;
    const c = this.jointCoords(sj);
    sj.ang.x = c.theta;
    sj.lin.x = c.slide;
  }
  /**
   * After every fixed step with μ > 0, for each free axis that has friction:
   *  - friction work: limit × |change of the coordinate| is added to the step's friction work of the
   *    body's energy-guard group (a sliding friction motor is saturated, so this is the energy it
   *    took out; see guardEnergy);
   *  - stiction: an axis whose relative speed is below STICK_SPEED sticks at its coordinate. While
   *    stuck its motor's target velocity is −offset / fixedDt (0 within HOLD_DEADBAND): with the
   *    load below the limit the motor holds and steers the joint back to where it stuck, so the
   *    slow slip that one Gauss–Seidel row per substep leaves (DEVIATIONS §5) cannot accumulate.
   *    Once the offset exceeds SLIP the load has overcome the limit: it lets go and the target is 0
   *    again (pure dry friction). The hold can only pull back an offset of at most SLIP, so it
   *    returns at most limit·SLIP of energy per stick.
   */
  updateFriction() {
    const raw = this.world.impulseJoints.raw;
    this.frictionWork.clear();
    const hold = 1 / this.h;
    for (const sj of this.joints) {
      if (!sj.handle || !sj.motors) continue;
      const { torque, force } = this.frictionLimits(sj);
      if (torque === 0 && force === 0) continue;
      const c = this.jointCoords(sj);
      const dyn = this.bodies[sj.joint.bodyA].fixed ? sj.joint.bodyB : sj.joint.bodyA;
      let work = 0;
      for (const [axis, st, limit] of this.frictionAxes(sj, torque, force)) {
        const angular = axis === ANG_X;
        const x = angular ? c.theta : c.slide;
        const rate = angular ? c.omega : c.speed;
        work += limit * Math.abs(angular ? wrapAngle(x - st.x) : x - st.x);
        st.x = x;
        if (!st.stuck && Math.abs(rate) < STICK_SPEED) {
          st.stuck = true;
          st.at = x;
        }
        let target = 0;
        if (st.stuck) {
          const off = angular ? wrapAngle(x - st.at) : x - st.at;
          if (Math.abs(off) > SLIP) st.stuck = false;
          else if (Math.abs(off) > HOLD_DEADBAND) target = -off * hold;
        }
        if (target !== st.target) {
          raw.jointConfigureMotorVelocity(sj.handle.handle, axis, target, FRICTION_GAIN);
          st.target = target;
        }
      }
      if (this.events && work > 0) {
        const r = this.findGroup(dyn);
        this.frictionWork.set(r, (this.frictionWork.get(r) ?? 0) + work);
      }
    }
  }
  // ------------------------------------------------------------------------------------------
  // Stepping
  /** Simulated seconds elapsed (stepCount × fixedDt). */
  get time() {
    return this.stepCount * this.fixedDt;
  }
  get speed() {
    return this.speedValue;
  }
  /** Simulated seconds that step() dropped (droppedSteps × fixedDt). */
  get droppedTime() {
    return this.droppedSteps * this.fixedDt;
  }
  setSpeed(speed) {
    if (!(speed >= 0) || !Number.isFinite(speed)) throw new Error(`speed must be >= 0 (got ${speed})`);
    this.speedValue = speed;
  }
  /**
   * Advance by dtReal × speed simulated seconds in fixed steps, carrying the remainder in an
   * accumulator. At most maxStepsPerCall steps run per call, and stepping stops once a call has
   * used stepBudgetMs of wall-clock time; the whole steps not run are dropped (not carried over)
   * and counted in droppedSteps, so a slow machine runs slower than real time instead of
   * spiralling. Non-positive or non-finite dtReal is ignored. Returns the steps run.
   */
  step(dtReal) {
    this.alive();
    if (!(dtReal > 0) || !Number.isFinite(dtReal)) return 0;
    this.acc += dtReal * this.speedValue;
    const want = Math.floor(this.acc / this.fixedDt + 1e-9);
    this.acc = Math.max(0, this.acc - want * this.fixedDt);
    const n = Math.min(want, this.opts.maxStepsPerCall);
    const budget = this.opts.stepBudgetMs;
    const t0 = budget === Infinity ? 0 : now();
    let done = 0;
    while (done < n) {
      this.stepFixed(1);
      done++;
      if (budget !== Infinity && now() - t0 >= budget) break;
    }
    this.droppedSteps += want - done;
    return done;
  }
  /** Exactly n fixed steps (ignores speed and the accumulator). */
  stepFixed(n = 1) {
    this.alive();
    for (let i = 0; i < n; i++) {
      for (let s = 0; s < this.k; s++) {
        this.applyGrab();
        if (this.meshes.length) this.updateMeshes();
        const w0 = this.drives.map((d) => this.bodies[d.body].rb?.angvel());
        if (this.events) this.world.step(this.events);
        else this.world.step();
        this.worldSteps++;
        this.driveWork.clear();
        this.drives.forEach((d, i2) => {
          const rb = this.bodies[d.body].rb;
          if (!rb || !w0[i2]) return;
          const w1 = rb.angvel();
          const W = 0.5 * this.h * (d.tau[0] * (w0[i2].x + w1.x) + d.tau[1] * (w0[i2].y + w1.y) + d.tau[2] * (w0[i2].z + w1.z));
          this.driveTotal += W;
          if (this.events) {
            const r = this.findGroup(d.body);
            this.driveWork.set(r, (this.driveWork.get(r) ?? 0) + W);
          }
        });
        this.removeFallen();
        if (this.frictionValue > 0) this.updateFriction();
        if (this.events) this.guardEnergy();
        this.onWorldStep?.(this);
      }
      this.stepCount++;
    }
  }
  // ------------------------------------------------------------------------------------------
  // GEARSIM: gear meshes
  /** Candidate pairs: every two gears on different bodies, not both fixed. */
  buildMeshCandidates() {
    const g = this.gears;
    for (let i = 0; i < g.length; i++)
      for (let j = i + 1; j < g.length; j++) {
        const a = g[i];
        const b = g[j];
        if (a.body === b.body) continue;
        if (this.bodies[a.body].fixed && this.bodies[b.body].fixed) continue;
        const [g1, g2] = a.body < b.body ? [a, b] : [b, a];
        this.meshes.push({ g1, g2, joint: null, engaged: false, dead: false, s1: { acc: 0 }, s2: { acc: 0 }, sp: { acc: 0 }, phi0: 0, phiT: 0, e: 0, maxE: 0, stopMin: 0, gap: Infinity, delta: 0, par: 0, engagements: 0, releases: 0, lastSnap: 0 });
      }
  }
  /** World centre and axis of a gear (current pose). */
  gearPose(gr, rb) {
    const q = quat(rb.rotation());
    const x = vec(rb.translation());
    return { c: add(rotate(q, gr.local), x), a: rotate(q, gr.axis), q, x };
  }
  /**
   * Before every world step: engage / release each candidate pair by the MESH rules and re-anchor
   * every engaged mesh (anchors on the two pitch circles on the line of centres, each in its own
   * gear's plane; X = t, Y = n, Z = −a; lead λ along t on both; phase feedback −k·e on anchor 2).
   */
  updateMeshes() {
    const P = this.meshP;
    const h = this.h;
    for (const m of this.meshes) {
      if (m.dead) continue;
      const rb1 = this.bodies[m.g1.body].rb;
      const rb2 = this.bodies[m.g2.body].rb;
      if (!rb1 || !rb2) {
        m.joint = null;
        if (m.engaged) m.releases++;
        m.engaged = false;
        m.dead = true;
        continue;
      }
      if (m.joint && !m.joint.isValid()) {
        m.joint = null;
        m.engaged = false;
      }
      const f1 = this.gearPose(m.g1, rb1);
      const f2 = this.gearPose(m.g2, rb2);
      const a = f1.a;
      const par = Math.acos(Math.min(1, Math.abs(dot(a, f2.a))));
      const d = sub(f2.c, f1.c);
      const delta = dot(d, a);
      const dp = sub(d, scale(a, delta));
      const D = len(dp);
      const r1 = m.g1.r;
      const r2 = m.g2.r;
      const gap = D - (r1 + r2);
      m.gap = gap;
      m.delta = delta;
      m.par = par;
      const fast = Math.max(len(vec(rb1.linvel())), len(vec(rb2.linvel()))) > P.maxLinSpeed;
      if (!m.engaged) {
        if (fast) continue;
        if (!(par <= P.parIn && Math.abs(delta) <= P.axialIn && gap <= P.engageGap && gap >= P.minGap)) continue;
      } else if (fast || par > P.parOut || Math.abs(delta) > P.axialOut || gap > P.releaseGap || gap < P.minGap - 0.25) {
        this.releaseMesh(m);
        continue;
      }
      const n = scale(dp, 1 / D);
      const t = cross(a, n);
      const first = !m.engaged;
      if (first) {
        m.s1 = { acc: 0 };
        m.s2 = { acc: 0 };
        m.sp = { acc: 0 };
      }
      const th1 = twist(f1.q, a, m.s1);
      const th2 = twist(f2.q, a, m.s2);
      const psi = angleIn(n, a, m.sp);
      const phi = r1 * th1 + r2 * th2 - (r1 + r2) * psi;
      if (first) {
        m.phiT = Math.round(phi / PITCH) * PITCH;
        m.phi0 = phi;
        m.lastSnap = (m.phiT - phi) / PITCH;
        m.stopMin = Math.min(0, gap) - P.stopSlack;
      } else {
        const s = P.snapRate * h;
        const dphi = m.phiT - m.phi0;
        m.phi0 += Math.max(-s, Math.min(s, dphi));
      }
      m.e = phi - m.phi0;
      if (!first) m.maxE = Math.max(m.maxE, Math.abs(m.e));
      const off = -P.feedback * m.e;
      let lam = 0;
      if (P.lead) {
        const Dn = r1 + r2;
        const kk = Dn / r2;
        const vc = sub(vec(rb2.velocityAtPoint(xyz(f2.c))), vec(rb1.velocityAtPoint(xyz(f1.c))));
        const betaDot = dot(vc, t) / D;
        const phiStep = (dot(vec(rb1.angvel()), a) - betaDot) * h;
        lam = Dn * (1 - kk * kk) * phiStep / (2 * kk * kk);
      }
      const P1 = add(add(f1.c, scale(n, r1)), scale(t, lam));
      const P2 = add(sub(f2.c, scale(n, r2)), scale(t, lam + off));
      const A1 = rotate(conj(f1.q), sub(P1, f1.x));
      const A2 = rotate(conj(f2.q), sub(P2, f2.x));
      const na = scale(a, -1);
      const F1 = basisQuat(rotate(conj(f1.q), t), rotate(conj(f1.q), n), rotate(conj(f1.q), na));
      const F2 = basisQuat(rotate(conj(f2.q), t), rotate(conj(f2.q), n), rotate(conj(f2.q), na));
      const rot = (qq) => ({ x: qq[0], y: qq[1], z: qq[2], w: qq[3] });
      if (first) {
        const data = RAPIER.JointData.generic(xyz(A1), xyz(A2), { x: 1, y: 0, z: 0 }, RAPIER.JointAxesMask.LinX);
        m.joint = this.world.createImpulseJoint(data, rb1, rb2, true);
        m.joint.setContactsEnabled(true);
        m.joint.setLocalFrame1(xyz(A1), rot(F1));
        m.joint.setLocalFrame2(xyz(A2), rot(F2));
        if (P.stop) this.world.impulseJoints.raw.jointSetLimits(m.joint.handle, 1, m.stopMin, 1e6);
        m.engaged = true;
        m.engagements++;
        const b1 = this.bodies[m.g1.body];
        const b2 = this.bodies[m.g2.body];
        if (this.events && P.mergeGroups && !b1.fixed && !b2.fixed) this.unionGroups(b1.id, b2.id);
        continue;
      }
      m.joint.setLocalFrame1(xyz(A1), rot(F1));
      m.joint.setLocalFrame2(xyz(A2), rot(F2));
    }
  }
  releaseMesh(m) {
    if (m.joint && m.joint.isValid()) this.world.removeImpulseJoint(m.joint, true);
    m.joint = null;
    m.engaged = false;
    m.releases++;
  }
  /** GEARSIM test drives: constant torques (world) on bodies; their work is credited to the guard. */
  drives = [];
  driveWork = /* @__PURE__ */ new Map();
  driveTotal = 0;
  setDrive(bodyId, tau) {
    const rb = this.bodies[bodyId].rb;
    const i = this.drives.findIndex((d) => d.body === bodyId);
    if (i >= 0) this.drives.splice(i, 1);
    rb.resetTorques(true);
    if (tau.some((x) => x !== 0)) {
      this.drives.push({ body: bodyId, tau: [...tau] });
      rb.addTorque(xyz(tau), true);
    }
  }
  /** GEARSIM diagnostics: the rigid body (experiments only: torques, velocities). */
  rawBody(bodyId) {
    return this.bodies[bodyId]?.rb ?? null;
  }
  /** GEARSIM diagnostics: is this body's energy-guard group the same as that one's? */
  sameGuardGroup(a, b) {
    return !!this.events && this.findGroup(a) === this.findGroup(b);
  }
  /** GEARSIM: number of guard groups and live mesh joints (diagnostics). */
  meshJointCount() {
    return this.meshes.filter((m) => m.engaged).length;
  }
  // ------------------------------------------------------------------------------------------
  // Energy guard
  /**
   * Groups: dynamic bodies linked by joints (not through fixed bodies) share a group; groups whose
   * bodies start touching are merged for good. Energy moves within a group (through joints and
   * contacts) but not between groups, except through a fixed body, which only takes energy away.
   */
  initGroups() {
    for (const b of this.bodies) this.groupParent[b.id] = b.id;
    for (const j of this.graph.joints) {
      if (this.bodies[j.bodyA].fixed || this.bodies[j.bodyB].fixed) continue;
      this.unionGroups(j.bodyA, j.bodyB);
    }
    for (const b of this.bodies) if (!b.fixed) this.groupState(b.id);
  }
  findGroup(id) {
    let r = id;
    while (this.groupParent[r] !== r) r = this.groupParent[r];
    while (this.groupParent[id] !== r) {
      const next = this.groupParent[id];
      this.groupParent[id] = r;
      id = next;
    }
    return r;
  }
  unionGroups(a, b) {
    const ra = this.findGroup(a);
    const rb = this.findGroup(b);
    if (ra === rb) return;
    const [lo, hi] = ra < rb ? [ra, rb] : [rb, ra];
    this.groupParent[hi] = lo;
    this.groups.delete(hi);
    this.groupState(lo).init = false;
  }
  groupState(id) {
    const r = this.findGroup(id);
    let g = this.groups.get(r);
    if (!g) {
      g = { init: false, eRef: 0, kPeak: 0, floor: 0 };
      this.groups.set(r, g);
    }
    return g;
  }
  /** Forget a group's energy reference (external work was done on it: grab, removal, contact merge). */
  resetGroup(bodyId) {
    if (this.events) this.groupState(bodyId).init = false;
  }
  /**
   * Energy guard (DEVIATIONS §5 "Free rotation gains speed"). Rapier's f32 gyroscopic correction
   * scales every spinning body's ω up by ≈ 1e-7 per substep, so a frictionless mechanism slowly
   * gains energy (an arm on an axle climbed from horizontal to vertical in 60 s). After every
   * fixed step, per group (see initGroups): E = kinetic + potential energy, eRef = the lowest E
   * since the group's reference was (re)set, each step also lowered by the work the group's joint
   * friction did in that step (updateFriction; 0 at μ = 0), kPeak = the highest kinetic energy
   * since then. If
   * E > eRef + max(band·kPeak, floor), all velocities of the group are scaled by one factor s < 1
   * so that E comes back to that cap. `floor` (1e-5 · Σ m·|g|·(1 + |com|)) sits above the f32
   * rounding noise of the potential energy, so a mechanism starting from rest — or balanced on an
   * unstable equilibrium, where the kinetic energy is far below that noise — is never held still. A uniform scale keeps every joint's (homogeneous) velocity constraint
   * and every contact's sign, so the motion is unchanged except for its speed. The guard never adds
   * energy: losses (joint solve, impacts, limit stops) lower eRef and stay lost. The reference is
   * (re)set on the first step, while a body of the group is grabbed, after its release, when a body
   * of the group is removed, when two groups merge and when the friction level changes, so
   * external work is never undone.
   */
  guardEnergy() {
    const ev = this.events;
    ev.drainCollisionEvents((h1, h2, started) => {
      if (!started) return;
      const a = this.bodyOfCollider.get(h1);
      const b = this.bodyOfCollider.get(h2);
      if (a === void 0 || b === void 0 || a === b) return;
      if (this.bodies[a].fixed || this.bodies[b].fixed) return;
      this.unionGroups(a, b);
    });
    if (this.grabState?.body.rb) this.resetGroup(this.grabState.body.id);
    const sums = /* @__PURE__ */ new Map();
    const gl = len(this.gravity);
    for (const b of this.bodies) {
      const rb = b.rb;
      if (b.fixed || !rb) continue;
      if (!b.mp) b.mp = { mass: rb.mass(), inertia: vec(rb.principalInertia()), frame: quat(rb.principalInertiaLocalFrame()) };
      const { mass, inertia: I, frame } = b.mp;
      const v = vec(rb.linvel());
      const wl = rotate(conj(qmul(quat(rb.rotation()), frame)), vec(rb.angvel()));
      const k = 0.5 * mass * dot(v, v) + 0.5 * (I[0] * wl[0] ** 2 + I[1] * wl[1] ** 2 + I[2] * wl[2] ** 2);
      const com = vec(rb.worldCom());
      const e = k - mass * dot(this.gravity, com);
      const noise = NOISE * mass * gl * (1 + len(com));
      const r = this.findGroup(b.id);
      const s = sums.get(r);
      if (s) {
        s.e += e;
        s.k += k;
        s.noise += noise;
        s.members.push(b);
      } else sums.set(r, { e, k, noise, members: [b] });
    }
    const band = this.opts.energyGuardBand;
    for (const [r, { e, k, noise, members }] of sums) {
      const g = this.groupState(r);
      if (!g.init) {
        g.init = true;
        g.eRef = e;
        g.kPeak = k;
        g.floor = noise;
        continue;
      }
      if (k > g.kPeak) g.kPeak = k;
      const work = this.frictionWork.get(r);
      if (work) g.eRef -= work;
      const dw = this.driveWork.get(r);
      if (dw) g.eRef += dw;
      if (e < g.eRef) {
        g.eRef = e;
        continue;
      }
      const excess = e - (g.eRef + Math.max(band * g.kPeak, g.floor));
      if (!(excess > 0) || !(k > 0)) continue;
      const f2 = Math.sqrt(Math.max(0, 1 - excess / k));
      for (const b of members) {
        const rb = b.rb;
        const v = rb.linvel();
        const w = rb.angvel();
        rb.setLinvel({ x: v.x * f2, y: v.y * f2, z: v.z * f2 }, true);
        rb.setAngvel({ x: w.x * f2, y: w.y * f2, z: w.z * f2 }, true);
      }
      this.guardRemoved += k * (1 - f2 * f2);
    }
  }
  removeFallen() {
    const yMin = this.removalY;
    for (const b of this.bodies) {
      if (b.fixed || !b.rb) continue;
      const y = b.rb.worldCom().y;
      if (y < yMin) this.removeBody(b);
    }
  }
  removeBody(b) {
    if (!b.rb) return;
    this.resetGroup(b.id);
    if (this.grabState?.body === b) this.grabState = null;
    this.world.removeRigidBody(b.rb);
    b.rb = null;
    for (const j of this.joints) if (j.joint.bodyA === b.id || j.joint.bodyB === b.id) j.handle = null;
  }
  // ------------------------------------------------------------------------------------------
  // Poses
  /** Is the body still in the world? (false once it fell below removalY, or unknown id) */
  hasBody(bodyId) {
    return !!this.bodies[bodyId]?.rb;
  }
  /**
   * Displacement of the body since t=0: the transform T(t)·T(0)⁻¹ that maps its edit-time world
   * geometry to its current pose (identity at t=0 and for the fixed body). null once removed or
   * for an unknown id.
   */
  bodyTransform(bodyId) {
    this.alive();
    const b = this.bodies[bodyId];
    if (!b?.rb) return null;
    const q = qnormalize(quat(b.rb.rotation()));
    const t = vec(b.rb.translation());
    return { q, p: sub(t, rotate(q, b.ref)) };
  }
  /** The transform to apply to the part's edit-time world placement (its body's displacement). */
  partTransform(partId) {
    const bodyId = this.bodyOfPart.get(partId);
    return bodyId === void 0 ? null : this.bodyTransform(bodyId);
  }
  /** Body id of a part (undefined for an unknown part). */
  bodyOf(partId) {
    return this.bodyOfPart.get(partId);
  }
  /** Current velocity of the body's centre of mass and its angular velocity (world). */
  bodyVelocity(bodyId) {
    this.alive();
    const rb = this.bodies[bodyId]?.rb;
    if (!rb) return null;
    return { v: vec(rb.linvel()), w: vec(rb.angvel()) };
  }
  /**
   * Set a dynamic body's velocity: `linear` is the velocity of its centre of mass (world, units/s),
   * `angular` its angular velocity (world, rad/s; omitted = unchanged). External work, so the
   * energy guard's reference for the body's group is reset (as on a grab release). Returns false
   * (and does nothing) for a fixed, removed or unknown body, or a non-finite vector.
   */
  setBodyVelocity(bodyId, linear, angular) {
    this.alive();
    const b = this.bodies[bodyId];
    if (!b?.rb || b.fixed) return false;
    const ok = (v) => Array.isArray(v) && v.length === 3 && v.every((x) => typeof x === "number" && Number.isFinite(x));
    if (!ok(linear) || angular !== void 0 && !ok(angular)) return false;
    b.rb.setLinvel(xyz(linear), true);
    if (angular) b.rb.setAngvel(xyz(angular), true);
    this.resetGroup(b.id);
    return true;
  }
  /** Is the body one of the joint-friction load sinks on the ground (DESIGN §5.1 "Free root")? */
  isGroundSink(bodyId) {
    return this.groundSinks.has(bodyId);
  }
  /** Mass properties as computed by the engine from the colliders. */
  massInfo(bodyId) {
    this.alive();
    const rb = this.bodies[bodyId]?.rb;
    if (!rb) return null;
    const qf = qmul(quat(rb.rotation()), quat(rb.principalInertiaLocalFrame()));
    const d = vec(rb.principalInertia());
    const cols = [rotate(qf, [1, 0, 0]), rotate(qf, [0, 1, 0]), rotate(qf, [0, 0, 1])];
    const inertia = [];
    for (let r = 0; r < 3; r++)
      for (let c = 0; c < 3; c++) inertia.push(cols.reduce((s, e, k) => s + d[k] * e[r] * e[c], 0));
    return { mass: rb.mass(), com: vec(rb.worldCom()), inertia };
  }
  // ------------------------------------------------------------------------------------------
  // Interaction
  /**
   * Start pulling dynamic body `bodyId` at `worldPoint` (a point on it, current pose) toward the
   * drag target. Returns false (and grabs nothing) for a fixed, removed or unknown body.
   */
  grab(bodyId, worldPoint) {
    this.alive();
    this.release();
    const b = this.bodies[bodyId];
    if (!b?.rb || b.fixed) return false;
    const q = quat(b.rb.rotation());
    const t = vec(b.rb.translation());
    const local = rotate(conj(q), sub(worldPoint, t));
    const own = b.rb.mass();
    const mass = Math.min(this.mechanismMass(b.id), 10 * own);
    this.grabState = { body: b, local, target: [...worldPoint], mass };
    b.rb.setAngularDamping(this.opts.angularDamping + this.opts.grabAngularDamping);
    return true;
  }
  /** Total mass of the live dynamic bodies joint-connected to `bodyId` (not through fixed bodies). */
  mechanismMass(bodyId) {
    const seen = /* @__PURE__ */ new Set([bodyId]);
    const stack = [bodyId];
    let m = 0;
    while (stack.length) {
      const u = stack.pop();
      m += this.bodies[u].rb.mass();
      for (const j of this.joints) {
        if (!j.handle) continue;
        const o = j.joint.bodyA === u ? j.joint.bodyB : j.joint.bodyB === u ? j.joint.bodyA : -1;
        if (o < 0 || seen.has(o) || this.bodies[o].fixed || !this.bodies[o].rb) continue;
        seen.add(o);
        stack.push(o);
      }
    }
    return m;
  }
  /** Move the drag target (world). No-op when nothing is grabbed. */
  dragTo(worldPoint) {
    if (this.grabState) this.grabState.target = [...worldPoint];
  }
  release() {
    const g = this.grabState;
    this.grabState = null;
    if (g?.body.rb) {
      this.resetGroup(g.body.id);
      g.body.rb.resetForces(true);
      g.body.rb.resetTorques(true);
      g.body.rb.setAngularDamping(this.opts.angularDamping);
    }
  }
  /** The grabbed body id, or null. */
  get grabbed() {
    return this.grabState ? this.grabState.body.id : null;
  }
  /** The grabbed point's current world position, or null. */
  grabPoint() {
    const g = this.grabState;
    if (!g?.body.rb) return null;
    return add(rotate(quat(g.body.rb.rotation()), g.local), vec(g.body.rb.translation()));
  }
  /**
   * Spring-damper at the grabbed point: F = M·(ω²·(target − x) − 2ω·v) − m·g, ω = 2π·grabFrequency,
   * m = the grabbed body's mass, M = the mass of the mechanism it is joint-connected to (capped at
   * 10·m for explicit-integration stability). Critically damped for a free point mass M; the −m·g
   * term cancels the body's own weight so a free body settles exactly on the cursor (a linkage
   * sags by less than g/ω² ≈ 0.31 units at 10 Hz). |F| is capped at M·100·G, and with a ground its
   * component into the ground at GRAB_PRESS_LIMIT·M·G.
   */
  applyGrab() {
    const g = this.grabState;
    const rb = g?.body.rb;
    if (!g || !rb) return;
    const x = add(rotate(quat(rb.rotation()), g.local), vec(rb.translation()));
    const v = vec(rb.velocityAtPoint(xyz(x)));
    const m = rb.mass();
    const M = g.mass;
    const w = 2 * Math.PI * this.opts.grabFrequency;
    let f2 = sub(scale(sub(scale(sub(g.target, x), w * w), scale(v, 2 * w)), M), scale(this.gravity, m));
    const fmax = M * 100 * G;
    const fl = len(f2);
    if (fl > fmax) f2 = scale(f2, fmax / fl);
    if (this.groundY !== null) {
      const into = -dot(f2, this.groundNormal);
      const cap = GRAB_PRESS_LIMIT * M * G;
      if (into > cap) f2 = add(f2, scale(this.groundNormal, into - cap));
    }
    rb.resetForces(false);
    rb.resetTorques(false);
    rb.addForceAtPoint(xyz(f2), xyz(x), true);
  }
  // ------------------------------------------------------------------------------------------
  // Diagnostics
  /**
   * Total energy of the live dynamic bodies, from the engine's mass properties:
   * kinetic = Σ ½·m·|v_com|² + ½·ωᵀ·I·ω, potential = Σ −m·(gravity · com) (= Σ m·g·y_com for
   * the default gravity).
   */
  energy() {
    this.alive();
    let kinetic = 0;
    let potential = 0;
    for (const b of this.bodies) {
      const rb = b.rb;
      if (b.fixed || !rb) continue;
      const m = rb.mass();
      const v = vec(rb.linvel());
      const qf = qmul(quat(rb.rotation()), quat(rb.principalInertiaLocalFrame()));
      const wl = rotate(conj(qf), vec(rb.angvel()));
      const I = vec(rb.principalInertia());
      kinetic += 0.5 * m * dot(v, v) + 0.5 * (I[0] * wl[0] ** 2 + I[1] * wl[1] ** 2 + I[2] * wl[2] ** 2);
      potential -= m * dot(this.gravity, vec(rb.worldCom()));
    }
    return { kinetic, potential };
  }
  /** Per-joint diagnostics in graph.joints order. */
  jointStates() {
    this.alive();
    return this.joints.map((sj) => {
      const j = sj.joint;
      const base = { index: sj.index, bodyA: j.bodyA, bodyB: j.bodyB, type: j.type };
      const A = this.bodies[j.bodyA].rb;
      const B = this.bodies[j.bodyB].rb;
      if (!sj.handle || !A || !B)
        return { ...base, alive: false, error: 0, slide: 0, tilt: 0, omega: 0, speed: 0, frictionTorque: 0, frictionForce: 0, loadMass: sj.mj };
      const { torque: frictionTorque, force: frictionForce } = this.frictionLimits(sj);
      const qa = quat(A.rotation());
      const qb = quat(B.rotation());
      const pa = add(rotate(qa, sj.anchorA), vec(A.translation()));
      const pb = add(rotate(qb, sj.anchorB), vec(B.translation()));
      const axA = rotate(qa, sj.axis);
      const axB = rotate(qb, sj.axis);
      const d = sub(pb, pa);
      const slide = dot(d, axA);
      const error = sj.sliding ? len(sub(d, scale(axA, slide))) : len(d);
      const tilt = Math.atan2(len(cross(axA, axB)), dot(axA, axB));
      const omega = dot(sub(vec(B.angvel()), vec(A.angvel())), axA);
      const speed = dot(sub(vec(B.velocityAtPoint(xyz(pb))), vec(A.velocityAtPoint(xyz(pb)))), axA);
      return { ...base, alive: true, error, slide, tilt, omega, speed, frictionTorque, frictionForce, loadMass: sj.mj };
    });
  }
  /** Max over live joints of the anchor separation (sliding joints: distance from A's axis line), units. */
  jointError() {
    let e = 0;
    for (const s of this.jointStates()) {
      if (!s.alive) continue;
      if (Number.isNaN(s.error)) return NaN;
      if (s.error > e) e = s.error;
    }
    return e;
  }
  /** Free the Rapier world. Idempotent; any other call afterwards throws. */
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.grabState = null;
    this.events?.free();
    this.world.free();
    for (const b of this.bodies) b.rb = null;
    for (const j of this.joints) j.handle = null;
  }
  get isDisposed() {
    return this.disposed;
  }
  alive() {
    if (this.disposed) throw new Error("Simulation has been disposed");
  }
};
function checkFriction(mu) {
  if (typeof mu !== "number" || !(mu >= 0 && mu <= MAX_JOINT_FRICTION))
    throw new Error(`jointFriction must be a number in [0, ${MAX_JOINT_FRICTION}] (got ${mu})`);
  return mu + 0;
}
function wrapAngle(a) {
  return a - 2 * Math.PI * Math.ceil((a - Math.PI) / (2 * Math.PI));
}
function now() {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}
function localInertia(rb) {
  const qf = quat(rb.principalInertiaLocalFrame());
  const d = vec(rb.principalInertia());
  const cols = [rotate(qf, [1, 0, 0]), rotate(qf, [0, 1, 0]), rotate(qf, [0, 0, 1])];
  const I = [];
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) I.push(cols.reduce((s, e, k) => s + d[k] * e[r] * e[c], 0));
  return I;
}
function setDecoupledInertia(rb, a) {
  const m = rb.mass();
  const com = rb.localCom();
  const I = localInertia(rb);
  const b = (a + 1) % 3;
  const c = (a + 2) % 3;
  const tol = 1e-6 * (I[0] + I[4] + I[8]);
  if (Math.abs(I[a * 3 + b]) < tol && Math.abs(I[a * 3 + c]) < tol) return;
  const Ibb = I[b * 3 + b];
  const Icc = I[c * 3 + c];
  const Ibc = I[b * 3 + c];
  const th = 0.5 * Math.atan2(2 * Ibc, Ibb - Icc);
  const cs = Math.cos(th);
  const sn = Math.sin(th);
  const lu = Ibb * cs * cs + 2 * Ibc * sn * cs + Icc * sn * sn;
  const principal = [0, 0, 0];
  principal[a] = I[a * 3 + a];
  principal[b] = lu;
  principal[c] = Ibb + Icc - lu;
  const frame = axisAngle(unitAxis(a), th);
  for (let i = 0; i < rb.numColliders(); i++) rb.collider(i).setDensity(0);
  rb.setAdditionalMassProperties(m, com, xyz(principal), { x: frame[0], y: frame[1], z: frame[2], w: frame[3] }, true);
  rb.recomputeMassPropertiesFromColliders();
}

// spikes/gearsim/lib.ts
function putRims(m, rims) {
  for (const q of rims) if (q.r >= 1) m = setRim(m, q.part, q.pos, q.r);
  const small = rims.filter((q) => q.r < 1);
  if (small.length) {
    m = { ...m, version: 2, parts: m.parts.map((p) => ({ ...p, cells: p.cells.map((c) => {
      const s = small.find((q) => q.part === p.id && q.pos[0] === c.x && q.pos[1] === c.y && q.pos[2] === c.z);
      return s ? makeCell(c.x, c.y, c.z, c.kind, c.axis, s.r) : c;
    }) })) };
  }
  const errs = validateModel(m).filter((e) => !/rim must be|steps of/.test(e.message));
  if (errs.length) throw new Error("invalid model: " + JSON.stringify(errs.slice(0, 3)));
  return m;
}
var Angle = class {
  constructor(s, body, a = [0, 0, 1]) {
    this.s = s;
    this.body = body;
    this.a = a;
  }
  prev = 0;
  acc = 0;
  init = false;
  get() {
    const t = this.s.bodyTransform(this.body);
    if (!t) return NaN;
    const q = t.q;
    const raw = 2 * Math.atan2(q[0] * this.a[0] + q[1] * this.a[1] + q[2] * this.a[2], q[3]);
    if (!this.init) {
      this.init = true;
      this.acc = raw;
    } else {
      let d = raw - this.prev;
      d -= 2 * Math.PI * Math.round(d / (2 * Math.PI));
      this.acc += d;
    }
    this.prev = raw;
    return this.acc;
  }
};
function energyTotal(s) {
  const e = s.energy();
  return e.kinetic + e.potential;
}
var f = (x, d = 4) => x === 0 || Math.abs(x) >= 1e-3 && Math.abs(x) < 1e5 ? x.toFixed(d) : x.toExponential(2);
var out = (...a) => console.log(...a);

// spikes/gearsim/slide.ts
function slider() {
  const b = new ModelBuilder();
  const frame = b.add(beam([0, 0, 0], [2, 0, 0]));
  const A = b.add([makeCell(0, 0, 1, "pinHole", 2)]);
  b.add([makeCell(0, 0, 0, "frictionPin", 2), makeCell(0, 0, 1, "pin", 2)]);
  const B = b.add([makeCell(2, 0, 2, "axleHole", 2)]);
  const shaft = b.add([-2, -1, 0, 1, 2, 3].map((z) => makeCell(2, 0, z, "axle", 2)));
  let m = b.root(frame).build();
  m = putRims(m, [
    { part: A, pos: [0, 0, 1], r: 1 },
    { part: B, pos: [2, 0, 2], r: 1 }
  ]);
  return { model: m, A, B, shaft, frame };
}
async function run(mu, k, w, cycles, period) {
  const sl = slider();
  const s = await Simulation.create(sl.model, { jointFriction: mu, substeps: k });
  const A = s.bodyOf(sl.A);
  const B = s.bodyOf(sl.B);
  const js = s.jointStates();
  const cyl2 = js.find((j) => j.type === "cylindrical");
  const lim = s.graph.joints.find((j) => j.type === "cylindrical")?.limits;
  const IA = s.massInfo(A).inertia[8];
  const aA = new Angle(s, A);
  const aB = new Angle(s, B);
  const E0 = energyTotal(s);
  const grabPt = [2, 0, 3];
  s.grab(B, grabPt);
  const n = Math.round(cycles * period * 480);
  let maxTilt = 0;
  let maxJerr = 0;
  let maxExcessFree = -Infinity;
  const ev = [];
  const m = s.meshes[0];
  let prevEng = m.engaged;
  let ratioSum = 0;
  let ratioN = 0;
  let prevA = aA.get();
  let prevB = aB.get();
  const zs = [];
  let lastTau = NaN;
  for (let i = 1; i <= n; i++) {
    const t = i / 480;
    const phaseT = t % period / period;
    const z = phaseT < 0.5 ? 2 : 3;
    s.dragTo([2, 0, z]);
    const wA = s.bodyVelocity(A).w[2];
    const tau = Math.max(-4e3, Math.min(4e3, IA * (w - wA) * 480));
    if (tau !== lastTau) {
      s.setDrive(A, [0, 0, tau]);
      lastTau = tau;
    }
    s.stepFixed(1);
    const tr = s.bodyTransform(B);
    const q = tr.q;
    const ax = [2 * (q[0] * q[2] + q[3] * q[1]), 2 * (q[1] * q[2] - q[3] * q[0]), 1 - 2 * (q[0] * q[0] + q[1] * q[1])];
    maxTilt = Math.max(maxTilt, Math.acos(Math.min(1, ax[2])));
    maxJerr = Math.max(maxJerr, s.jointError());
    const hubZ = 2 + tr.p[2] + (tr.q[3] ? 0 : 0);
    if (m.engaged !== prevEng) {
      ev.push(`${t.toFixed(3)} ${m.engaged ? "ENG" : "rel"} hub z ${f(hubZ, 3)} delta ${f(m.delta, 3)}${m.engaged ? ` snap ${f(m.lastSnap, 3)} teeth` : ""}`);
      prevEng = m.engaged;
    }
    const a1 = aA.get();
    const b1 = aB.get();
    if (m.engaged && Math.abs(a1 - prevA) > 1e-6) {
      ratioSum += (b1 - prevB) / (a1 - prevA);
      ratioN++;
    }
    prevA = a1;
    prevB = b1;
    if (i % Math.round(period * 480 / 4) === 0) zs.push(`t ${t.toFixed(2)} hub z ${f(hubZ, 3)} \u03C9A ${f(wA, 2)} \u03C9B ${f(s.bodyVelocity(B).w[2], 2)} eng ${m.engaged} ph ${f(m.e / PITCH, 4)}`);
    void maxExcessFree;
    void E0;
  }
  s.release();
  out(`== slide mu ${mu} k ${k} w ${w}: cylindrical limits ${JSON.stringify(lim)} F_f ${f(cyl2?.frictionForce ?? 0, 1)} \u03C4f ${f(cyl2?.frictionTorque ?? 0, 1)} | engagements ${m.engagements} releases ${m.releases} | mean ratio while engaged ${f(ratioSum / Math.max(1, ratioN), 5)} | max phase err ${f(m.maxE / PITCH)} teeth | max tilt ${f(maxTilt)} rad | max joint error ${f(maxJerr)}`);
  for (const e of ev) out("   " + e);
  for (const z of zs) out("   " + z);
  s.dispose();
}
if (process.argv[1]?.endsWith("slide.mjs")) {
  const [mus = "0,0.05,0.2", ks = "1,2,4", w = "5", cycles = "3", period = "1"] = process.argv.slice(2);
  for (const mu of mus.split(",").map(Number)) for (const k of ks.split(",").map(Number)) await run(mu, k, Number(w), Number(cycles), Number(period));
  process.exit(0);
}

// spikes/gearsim/dbg_spinengage.ts
for (const k of [1, 2, 4])
  for (const [wA, wB] of [[20, 10], [20, -5], [50, 0], [0, 40]]) {
    const sl = slider();
    const s = await Simulation.create(sl.model, { jointFriction: 0, substeps: k, mesh: { snapRate: Number(process.env.SNAP ?? 0.96) } });
    const A = s.bodyOf(sl.A);
    const B = s.bodyOf(sl.B);
    s.setBodyVelocity(A, [0, 0, 0], [0, 0, wA]);
    s.setBodyVelocity(B, [0, 0, -3], [0, 0, wB]);
    const IA = s.massInfo(A).inertia[8];
    const IB = s.massInfo(B).inertia[8];
    const J = (wA + wB) / (1 / IA + 1 / IB);
    const wA2 = wA - J / IA;
    const wB2 = wB - J / IB;
    const lossAn = 0.5 * IA * wA ** 2 + 0.5 * IB * wB ** 2 - (0.5 * IA * wA2 ** 2 + 0.5 * IB * wB2 ** 2);
    const m = s.meshes[0];
    let eBefore = NaN, eAfter = NaN, at = -1, snap = 0, peakF = 0;
    let prev = [wA, wB];
    for (let i = 1; i <= 480; i++) {
      const e = energyTotal(s);
      const was = m.engaged;
      s.stepFixed(1);
      if (!was && m.engaged) {
        eBefore = e;
        at = i;
        snap = m.lastSnap;
      }
      if (at > 0 && i === at + 2) eAfter = energyTotal(s);
      const w = [s.bodyVelocity(A).w[2], s.bodyVelocity(B).w[2]];
      if (at > 0 && i <= at + 2) peakF = Math.max(peakF, Math.abs(w[0] - prev[0]) * IA * 480);
      prev = w;
      if (at > 0 && i === at + 2) {
        out(`k ${k} wA ${wA} wB ${wB}: engaged at ${(at / 480).toFixed(4)} s (snap ${f(snap, 3)} teeth) | after: \u03C9A ${f(w[0], 3)} \u03C9B ${f(w[1], 3)} vs analytic ${f(wA2, 3)} ${f(wB2, 3)} (err ${f(w[0] / wA2 - 1, 4)}, ${f(w[1] / wB2 - 1, 4)}) | \u0394E ${f(eAfter - eBefore, 2)} vs analytic \u2212${f(lossAn, 2)} | peak tooth impulse/dt ${f(peakF, 0)} vs J/dt ${f(Math.abs(J) * 480, 0)}`);
      }
    }
    let maxE = m.maxE / PITCH;
    out(`   then 1 s: ratio \u03C9B/\u03C9A ${f(s.bodyVelocity(B).w[2] / s.bodyVelocity(A).w[2], 5)}, phase max ${f(maxE, 4)} teeth, engaged ${m.engaged}, \u03B4 ${f(m.delta, 3)}, guardRemoved ${f(s.guardRemoved, 3)}`);
    s.dispose();
  }
process.exit(0);
