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
function makeCell(x, y, z, kind, axis) {
  return { x, y, z, kind, axis };
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
var EMPTY = Object.freeze([]);
var WorldIndex = class {
  map = /* @__PURE__ */ new Map();
  constructor(m) {
    for (const part of m.parts) {
      part.cells.forEach((cell, index) => {
        const k = cellKey(cell);
        const list = this.map.get(k);
        const e = { partId: part.id, cell, index };
        if (list) list.push(e);
        else this.map.set(k, [e]);
      });
    }
  }
  at(pos) {
    return this.map.get(posKey(pos[0], pos[1], pos[2])) ?? EMPTY;
  }
  atXYZ(p) {
    return this.map.get(cellKey(p)) ?? EMPTY;
  }
};
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
  const comp = new Array(cells.length).fill(-1);
  const out = [];
  for (let s = 0; s < cells.length; s++) {
    if (comp[s] !== -1) continue;
    const id = out.length;
    const members = [];
    comp[s] = id;
    const stack = [s];
    while (stack.length) {
      const i = stack.pop();
      members.push(i);
      const c = cells[i];
      for (const d of DIRS) {
        const j = at.get(posKey(c.x + d[0], c.y + d[1], c.z + d[2]));
        if (j === void 0 || comp[j] !== -1) continue;
        if (connects(c, cells[j])) {
          comp[j] = id;
          stack.push(j);
        }
      }
    }
    members.sort((a, b) => a - b);
    out.push(members);
  }
  return out;
}
function cellStructureError(c) {
  if (typeof c !== "object" || c === null || Array.isArray(c)) return "expected an object {x,y,z,kind,axis}";
  const o = c;
  for (const f of ["x", "y", "z"]) {
    if (typeof o[f] !== "number" || !Number.isSafeInteger(o[f])) return `${f} must be an integer (got ${JSON.stringify(o[f])})`;
  }
  if (!isKind(o.kind)) return `kind must be one of pinHole, axleHole, axle, pin, frictionPin (got ${JSON.stringify(o.kind)})`;
  if (!isAxis(o.axis)) return `axis must be 0, 1 or 2 (got ${JSON.stringify(o.axis)})`;
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
function allocIds(m, count) {
  let first = Number.isSafeInteger(m.nextPartId) ? Math.max(m.nextPartId, 1) : 1;
  for (const p of m.parts) if (p.id >= first) first = p.id + 1;
  if (!Number.isSafeInteger(first + count)) throw new Error("no part ids left (nextPartId too large)");
  return first;
}
function addPart(m, cells, color) {
  for (let i = 0; i < cells.length; i++) {
    const e = cellStructureError(cells[i]);
    if (e) throw new Error(`invalid cell ${i}: ${e}`);
  }
  const copy = cells.map((c) => makeCell(c.x, c.y, c.z, c.kind, c.axis));
  const errs = partCellErrors(copy, void 0);
  if (errs.length) throw new Error(errs[0].message);
  const world = worldIndex(m);
  for (const c of copy) {
    const r = occupancyCheck(world, c, null);
    if (!r.ok) throw new Error(r.reason);
  }
  const col = color ?? defaultColorFor(copy[0].kind);
  if (!HEX_COLOR.test(col)) throw new Error(`invalid colour ${JSON.stringify(col)} (expected '#rrggbb')`);
  const partId = allocIds(m, 1);
  const part = { id: partId, color: col.toLowerCase(), cells: copy };
  return { model: { ...m, parts: [...m.parts, part], nextPartId: partId + 1 }, partId };
}
function setRoot(m, partId) {
  if (partId !== null) requirePart(m, partId);
  if (m.rootPartId === partId) return m;
  return { ...m, rootPartId: partId };
}

// src/core/kinematics.ts
function cmpPos(a, b) {
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
}
function findMates(model) {
  const out = [];
  for (const entries of worldIndex(model).map.values()) {
    if (entries.length !== 2) continue;
    const [a, b] = entries;
    if (a.partId === b.partId) continue;
    const r = shareResult(a.cell, b.cell);
    if (!r.ok) continue;
    const male = isMale(a.cell.kind) ? a : b;
    const hole = male === a ? b : a;
    out.push({
      pos: [male.cell.x, male.cell.y, male.cell.z],
      axis: male.cell.axis,
      malePart: male.partId,
      holePart: hole.partId,
      type: r.mate
    });
  }
  out.sort((m, n) => cmpPos(m.pos, n.pos));
  return out;
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
  let joints = [];
  for (let guard2 = 0; ; guard2++) {
    if (guard2 > parts.length + 2) throw new Error("kinematic analysis did not converge");
    let changed = false;
    for (const pid of pinCandidates) {
      const r = uf.find(pid);
      if (uf.partCount.get(r) !== 1) continue;
      const ms = (matesOfMale.get(pid) ?? []).filter((m) => uf.find(m.holePart) !== r);
      if (ms.length === 0 || ms.some((m) => m.type !== "revolute")) continue;
      if (!connectors.includes(pid)) connectors.push(pid);
      if (pid === rootId) continue;
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
  const bodyOfPart = /* @__PURE__ */ new Map();
  for (const p of parts) {
    const bid = bodyIdOfRep.get(uf.find(p.id));
    bodies[bid].partIds.push(p.id);
    if (p.id === rootId) bodies[bid].fixed = true;
    bodyOfPart.set(p.id, bid);
  }
  const outJoints = joints.map((j) => {
    const out = {
      bodyA: bodyIdOfRep.get(j.a),
      bodyB: bodyIdOfRep.get(j.b),
      type: j.type,
      origin: j.origin,
      axis: j.axis
    };
    if (j.limits) out.limits = j.limits;
    return out;
  });
  outJoints.sort((x, y) => x.bodyA - y.bodyA || x.bodyB - y.bodyB);
  return { mates, bodies, joints: outJoints, bodyOfPart };
}

// src/geometry/dims.ts
var R_BORE = 0.31;
var E_FREE = 0.48;
var EPS = 5e-3;
var E_CONN = 0.5 + EPS;
var HC = 0.46;
var R_COLL_ROD = 0.29;

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
function gonVertex(R2, segments, i) {
  const a = (i + 0.5) / segments * 2 * Math.PI;
  return { u: R2 * Math.cos(a), v: R2 * Math.sin(a), a };
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
      const step2 = (k) => {
        const p = [c.x, c.y, c.z];
        p[d] += k;
        return p;
      };
      if (plainAt(...step2(-1), c.axis) !== void 0) continue;
      let n = 0;
      while (plainAt(...step2(n + 1), c.axis) !== void 0) n++;
      if (n === 0) continue;
      const run = [];
      for (let k = 0; k <= n; k++) run.push(plainAt(...step2(k), c.axis));
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

// src/physics/sim.ts
var G = 1226.25;
var NOISE = 1e-5;
var JOINT_FRICTION = { off: 0, low: 0.05, realistic: 0.2 };
var DEFAULT_FRICTION_LEVEL = "realistic";
var MAX_JOINT_FRICTION = 10;
var STICK_SPEED = 0.01;
var SLIP = 2e-4;
var HOLD_DEADBAND = 1e-5;
var FRICTION_GAIN = 1e9;
var SPEED_CAP = 400;
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
  jointFriction: JOINT_FRICTION[DEFAULT_FRICTION_LEVEL]
};
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
    this.speedValue = o.speed;
    this.frictionValue = checkFriction(o.jointFriction);
    this.gravity = options.gravity ? [...options.gravity] : [0, -G, 0];
    this.graph = analyze(model);
    let minY = Infinity;
    for (const p of model.parts) for (const c of p.cells) minY = Math.min(minY, c.y);
    this.removalY = Number.isFinite(minY) ? Math.min(o.removeBelowY, minY + o.removeBelowY) : o.removeBelowY;
    this.bodyOfPart = this.graph.bodyOfPart;
    const world = new RAPIER.World(xyz(this.gravity));
    this.world = world;
    world.timestep = o.fixedDt;
    this.baseIterations = Math.max(1, Math.min(o.freeSolverIterations, o.solverIterations));
    world.numSolverIterations = this.baseIterations;
    world.numInternalPgsIterations = o.pgsIterations;
    world.integrationParameters.maxCcdSubsteps = 0;
    try {
      this.buildBodies(model);
      this.buildJoints();
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
      for (const p of parts) {
        for (const sh of partShapes(p, o.cylinderSegments)) {
          let cd;
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
          if (!b.fixed && o.energyGuard) cd.setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS);
          const col = this.world.createCollider(cd, rb);
          this.bodyOfCollider.set(col.handle, b.id);
        }
      }
      this.bodies.push({ id: b.id, fixed: b.fixed, ref, rb });
    }
    for (const sb of this.bodies)
      if (!sb.fixed && !jointed.has(sb.id)) sb.rb.setSoftCcdPrediction(SPEED_CAP * o.fixedDt * 1.25);
    this.decoupleInertia();
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
   */
  loadMasses() {
    const mass = (id) => this.bodies[id].fixed ? Infinity : this.bodies[id].rb.mass();
    const joints = this.graph.joints;
    const dist = /* @__PURE__ */ new Map();
    let frontier = this.bodies.filter((b) => b.fixed).map((b) => b.id);
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
    const order = this.bodies.filter((b) => !b.fixed && dist.has(b.id)).sort((a, b) => dist.get(b.id) - dist.get(a.id) || a.id - b.id);
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
        if (!this.bodies[o].fixed) carried.set(o, (carried.get(o) ?? 0) + load / down.length);
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
    const out = [];
    if (t !== "prismatic") out.push([ANG_X, sj.ang, torque]);
    if (t !== "revolute") out.push([LIN_X, sj.lin, force]);
    return out;
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
    const hold = 1 / this.fixedDt;
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
      this.applyGrab();
      if (this.events) this.world.step(this.events);
      else this.world.step();
      this.stepCount++;
      this.removeFallen();
      if (this.frictionValue > 0) this.updateFriction();
      if (this.events) this.guardEnergy();
    }
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
      if (e < g.eRef) {
        g.eRef = e;
        continue;
      }
      const excess = e - (g.eRef + Math.max(band * g.kPeak, g.floor));
      if (!(excess > 0) || !(k > 0)) continue;
      const f = Math.sqrt(Math.max(0, 1 - excess / k));
      for (const b of members) {
        const rb = b.rb;
        const v = rb.linvel();
        const w = rb.angvel();
        rb.setLinvel({ x: v.x * f, y: v.y * f, z: v.z * f }, true);
        rb.setAngvel({ x: w.x * f, y: w.y * f, z: w.z * f }, true);
      }
      this.guardRemoved += k * (1 - f * f);
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
   * sags by less than g/ω² ≈ 0.31 units at 10 Hz). |F| is capped at M·100·G.
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
    let f = sub(scale(sub(scale(sub(g.target, x), w * w), scale(v, 2 * w)), M), scale(this.gravity, m));
    const fmax = M * 100 * G;
    const fl = len(f);
    if (fl > fmax) f = scale(f, fmax / fl);
    rb.resetForces(false);
    rb.resetTorques(false);
    rb.addForceAtPoint(xyz(f), xyz(x), true);
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

// src/core/examples.ts
function runBetween(from, to) {
  const d = [to[0] - from[0], to[1] - from[1], to[2] - from[2]];
  const nonZero = d.filter((v) => v !== 0).length;
  if (nonZero > 1) throw new Error(`run ${JSON.stringify(from)}\u2192${JSON.stringify(to)} is not axis-aligned`);
  const n = Math.max(...d.map(Math.abs));
  const step2 = d.map(Math.sign);
  const out = [];
  for (let i = 0; i <= n; i++) out.push([from[0] + step2[0] * i, from[1] + step2[1] * i, from[2] + step2[2] * i]);
  return out;
}
function holes(from, to, holeAxis = 2, kind = "pinHole") {
  return runBetween(from, to).map((p) => makeCell(p[0], p[1], p[2], kind, holeAxis));
}
function beam(from, to, holeAxis = 2) {
  return holes(from, to, holeAxis, "pinHole");
}

// spikes/wheels/lib.ts
import RAPIER2 from "@dimforge/rapier3d-compat";
var G2 = 1226.25;
var DT = 1 / 480;
var FRICTION = 0.4;
var RESTITUTION = 0.1;
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
  const R2 = r / Math.cos(Math.PI / n);
  let best = 0;
  for (let i = 0; i < n / 4; i++) if (Math.abs((i + 0.5) / n * 360 - 56.25) < Math.abs((best + 0.5) / n * 360 - 56.25)) best = i;
  const keep = /* @__PURE__ */ new Set([best, n / 2 - 1 - best, n / 2 + best, n - 1 - best]);
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = (i + 0.5) / n * 2 * Math.PI;
    for (const s of [-1, 1]) pts.push(R2 * Math.cos(a), R2 * Math.sin(a), s * (keep.has(i) ? h : h - bevel));
  }
  const A = 0.5 * n * R2 * R2 * Math.sin(2 * Math.PI / n);
  const L = 2 * h;
  const J = A * R2 * R2 * (2 + Math.cos(2 * Math.PI / n)) / 6;
  const volume = A * L;
  const Ixx = J / 2 * L + volume * L * L / 12;
  return { pts: new Float32Array(pts), volume, inertia: [Ixx, Ixx, J * L] };
}
var ROUND_BORDER = 0.05;
function wheelColliders(kind, r, at = [0, 0, 0]) {
  let cd;
  if (kind === "hyb") {
    const c = RAPIER2.ColliderDesc.cylinder(0.5, r).setRotation(Y_TO_Z).setDensity(1).setCollisionGroups(GRP.ROUND);
    const p = bevelPrism(r, 0.5, 32, WHEEL_BEVEL);
    const h = RAPIER2.ColliderDesc.convexHull(p.pts).setDensity(0).setCollisionGroups(GRP.HULL);
    for (const d of [c, h]) d.setTranslation(at[0], at[1], at[2]).setFriction(FRICTION).setRestitution(RESTITUTION);
    return [c, h];
  }
  if (kind.startsWith("b")) {
    const p = bevelPrism(r, 0.5, Number(kind.slice(1)), WHEEL_BEVEL);
    cd = RAPIER2.ColliderDesc.convexHull(p.pts);
    cd.setMassProperties(p.volume, { x: 0, y: 0, z: 0 }, { x: p.inertia[0], y: p.inertia[1], z: p.inertia[2] }, { x: 0, y: 0, z: 0, w: 1 });
  } else if (kind === "cyl") cd = RAPIER2.ColliderDesc.cylinder(0.5, r).setRotation(Y_TO_Z);
  else if (kind === "rcyl") cd = RAPIER2.ColliderDesc.roundCylinder(0.5 - ROUND_BORDER, r - ROUND_BORDER, ROUND_BORDER).setRotation(Y_TO_Z);
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
    const d = round ? RAPIER2.ColliderDesc.roundConvexHull(pts, b) : RAPIER2.ColliderDesc.convexHull(pts);
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
function worldInertia(rb) {
  const q = rb.rotation();
  const f = rb.principalInertiaLocalFrame();
  const qf = qmul2([q.x, q.y, q.z, q.w], [f.x, f.y, f.z, f.w]);
  const d = rb.principalInertia();
  const D = [d.x, d.y, d.z];
  const cols = [rot(qf, [1, 0, 0]), rot(qf, [0, 1, 0]), rot(qf, [0, 0, 1])];
  const I = [];
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) I.push(cols.reduce((s, e, k) => s + D[k] * e[r] * e[c], 0));
  return I;
}
function qmul2(a, b) {
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
function stats(a) {
  const n = a.length;
  const mean = a.reduce((s, x) => s + x, 0) / n;
  const std = Math.sqrt(a.reduce((s, x) => s + (x - mean) ** 2, 0) / n);
  return { mean, std, min: Math.min(...a), max: Math.max(...a) };
}
function fmt(x, d = 3) {
  if (!Number.isFinite(x)) return String(x);
  if (x !== 0 && (Math.abs(x) < 1e-3 || Math.abs(x) >= 1e5)) return x.toExponential(2);
  return x.toFixed(d);
}
function now2() {
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

// spikes/wheels/cart.ts
var TEST = process.argv[2] ?? "all";
var R = Number(process.argv[3] ?? 1.5);
function cartModel() {
  let m = emptyModel();
  const root = addPart(m, [makeCell(-50, 40, 0, "pinHole", 2)]);
  m = root.model;
  const ch = addPart(m, [...beam([0, 0, 0], [6, 0, 0]), makeCell(3, 0, 1, "pinHole", 2), ...beam([0, 0, 2], [6, 0, 2])]);
  m = ch.model;
  const wheelIds = [];
  for (const x of [0, 6])
    for (const [zc, zw] of [[0, -1], [2, 3]]) {
      m = addPart(m, [makeCell(x, 0, zc, "frictionPin", 2), makeCell(x, 0, zw, "pin", 2)]).model;
      const w = addPart(m, [makeCell(x, 0, zw, "pinHole", 2)]);
      m = w.model;
      wheelIds.push(w.partId);
    }
  m = setRoot(m, root.partId);
  return { model: m, chassisId: ch.partId, wheelIds };
}
async function makeCart(opts) {
  const r = opts.r ?? R;
  const th = (opts.theta ?? 0) * Math.PI / 180;
  const { model, chassisId, wheelIds } = cartModel();
  const sim = await Simulation.create(model, {
    gravity: [G2 * Math.sin(th), -G2 * Math.cos(th), 0],
    jointFriction: opts.mu ?? 0.2,
    energyGuard: opts.guard ?? true,
    solverIterations: opts.iters ?? 240
  });
  const p = sim;
  const world = p.world;
  world.forEachCollider((c) => c.setCollisionGroups(GRP.PARTS));
  const rbOf = (part) => p.bodies[sim.bodyOf(part)].rb;
  const wheels = wheelIds.map(rbOf);
  for (const wb of wheels) {
    const t = wb.translation();
    void t;
    for (const cd of wheelColliders("hyb", r)) world.createCollider(cd, wb);
  }
  const chassis = rbOf(chassisId);
  const g = world.createRigidBody(RAPIER2.RigidBodyDesc.fixed());
  const gr = (cd) => world.createCollider(cd.setFriction(0.4).setRestitution(0.1).setCollisionGroups(GRP.GROUND), g);
  if ((opts.ground ?? "half") === "half") gr(new RAPIER2.ColliderDesc(new RAPIER2.HalfSpace({ x: 0, y: 1, z: 0 })).setTranslation(0, -r, 0));
  if (opts.ground === "step") {
    gr(RAPIER2.ColliderDesc.cuboid(30, 1, 20).setTranslation(12 - 30, -r - 1, 1));
    gr(new RAPIER2.ColliderDesc(new RAPIER2.HalfSpace({ x: 0, y: 1, z: 0 })).setTranslation(0, -r - 2, 0));
  }
  const all = p.bodies.filter((b) => !b.fixed && b.rb).map((b) => b.rb);
  const M = all.reduce((s, b) => s + b.mass(), 0);
  const sumI = wheels.reduce((s, b) => s + worldInertia(b)[8], 0);
  const mw = wheels[0].mass();
  const mj = (opts.mjRule ?? "sim") === "sim" ? Math.min(mw, chassis.mass()) : (M - 4 * mw) / 4;
  for (const j of p.joints) j.mj = mj;
  p.applyFriction();
  return { sim, world, chassis, wheels, all, M, sumI, r };
}
function setSpeed(c, v) {
  for (const b of c.all) b.setLinvel({ x: v, y: 0, z: 0 }, true);
  for (const w of c.wheels) w.setAngvel({ x: 0, y: 0, z: -v / c.r }, true);
}
function wheelSlip(c) {
  let s = 0;
  for (const w of c.wheels) s = Math.max(s, Math.abs(w.linvel().x + w.angvel().z * c.r));
  return s;
}
async function incline() {
  console.log("## cart down an incline from rest (gravity tilted \u03B8 about Z), 1 s or until v \u2265 300");
  console.log("r	\u03B8\xB0	\u03BC	mj rule	M	\u03A3I/r\xB2	a_analytic	a_meas	rel.err	max slip	chassis tilt	guard removed / KE	ms/sim-s");
  for (const r of [1, 1.5, 2.5])
    for (const theta of [5, 15, 30])
      for (const [mu, rule] of [[0, "sim"], [0.2, "sim"], [0.2, "share"]]) {
        const c = await makeCart({ r, theta, mu, mjRule: rule });
        const th = theta * Math.PI / 180;
        const tauF = mu * c.sim.jointStates()[0].loadMass * G2 * 0.31;
        const aTh = Math.max(0, (c.M * G2 * Math.sin(th) - 4 * tauF / r) / (c.M + c.sumI / (r * r)));
        const ts = [];
        const vs = [];
        let slip = 0;
        let tilt = 0;
        const t0 = now2();
        let n = 0;
        for (; n < 480; n++) {
          c.sim.stepFixed(1);
          const v = c.chassis.linvel().x;
          if (n * DT > 0.1) {
            ts.push(n * DT);
            vs.push(v);
          }
          slip = Math.max(slip, wheelSlip(c));
          const q = c.chassis.rotation();
          tilt = Math.max(tilt, 2 * Math.asin(Math.min(1, Math.hypot(q.x, q.y, q.z))));
          if (v > 300) break;
        }
        const ms = (now2() - t0) / ((n + 1) * DT);
        let a = NaN;
        if (ts.length > 2) {
          const mx = ts.reduce((s, x) => s + x, 0) / ts.length;
          const my = vs.reduce((s, x) => s + x, 0) / vs.length;
          let sxy = 0;
          let sxx = 0;
          ts.forEach((t, i) => {
            sxy += (t - mx) * (vs[i] - my);
            sxx += (t - mx) ** 2;
          });
          a = sxy / sxx;
        }
        const ke = c.sim.energy().kinetic;
        console.log([r, theta, mu, rule, fmt(c.M, 2), fmt(c.sumI / (r * r), 2), fmt(aTh, 2), fmt(a, 2), fmt(a / aTh - 1, 4), fmt(slip, 3), fmt(tilt, 4), fmt(c.sim.guardRemoved / Math.max(ke, 1e-9), 4), fmt(ms, 0)].join("	"));
        c.sim.dispose();
      }
}
async function coast() {
  console.log("## coast to a stop on flat ground from v0 (joint friction only; Rapier has no rolling resistance)");
  console.log("r	\u03BC	mj rule	m_j	v0	decel analytic	stop dist analytic	stop dist meas	t_stop meas	drift after stop (5 s)	guard removed");
  for (const r of [1.5])
    for (const [mu, rule] of [[0.2, "sim"], [0.2, "share"], [1, "share"], [0, "sim"]])
      for (const v0 of [20, 100]) {
        const c = await makeCart({ r, mu, mjRule: rule });
        setSpeed(c, v0);
        const mj = c.sim.jointStates()[0].loadMass;
        const tauF = mu * mj * G2 * 0.31;
        const dec = 4 * tauF / r / (c.M + c.sumI / (r * r));
        const x0 = c.chassis.translation().x;
        let tStop = NaN;
        let xStop = NaN;
        const T = Math.min(30, mu > 0 ? v0 / dec * 1.5 + 1 : 3);
        for (let i = 0; i < Math.round(T / DT); i++) {
          c.sim.stepFixed(1);
          if (Number.isNaN(tStop) && Math.abs(c.chassis.linvel().x) < 0.01) {
            tStop = i * DT;
            xStop = c.chassis.translation().x;
          }
        }
        let drift = NaN;
        if (!Number.isNaN(tStop)) {
          const xa = c.chassis.translation().x;
          c.sim.stepFixed(Math.round(5 / DT));
          drift = c.chassis.translation().x - xa;
        }
        console.log([r, mu, rule, fmt(mj, 2), v0, fmt(dec, 3), fmt(dec > 0 ? v0 * v0 / (2 * dec) : Infinity, 2), fmt(xStop - x0, 2), fmt(tStop, 3), fmt(drift, 6), fmt(c.sim.guardRemoved, 3)].join("	"));
        c.sim.dispose();
      }
}
async function rest() {
  console.log("## cart placed at rest on flat ground, 30 s (\u03BC = 0.2)");
  console.log("r	guard	chassis y\u22120 mean	y p-p after 1 s	|dx| 30 s	|dz| 30 s	max |v| after 1 s	max wheel |\u03C9|	ms/sim-s");
  for (const r of [1, 1.5, 2.5])
    for (const guard2 of [true, false]) {
      const c = await makeCart({ r, guard: guard2 });
      const ys = [];
      let vmax = 0;
      let wmax = 0;
      const t0 = now2();
      for (let i = 0; i < Math.round(30 / DT); i++) {
        c.sim.stepFixed(1);
        if (i * DT < 1) continue;
        ys.push(c.chassis.translation().y);
        for (const b of c.all) vmax = Math.max(vmax, Math.hypot(b.linvel().x, b.linvel().y, b.linvel().z));
        for (const w of c.wheels) wmax = Math.max(wmax, Math.abs(w.angvel().z));
      }
      const ms = (now2() - t0) / 30;
      const s = stats(ys);
      const t = c.chassis.translation();
      console.log([r, guard2, fmt(s.mean, 5), fmt(s.max - s.min, 6), fmt(Math.abs(t.x - 3), 6), fmt(Math.abs(t.z - 1), 6), fmt(vmax, 5), fmt(wmax, 5), fmt(ms, 0)].join("	"));
      c.sim.dispose();
    }
}
async function step() {
  console.log("## drive off a 2-unit step at v0 (platform = cuboid, lower level = half-space), 3 s");
  console.log("r	v0	min wheel-bottom clearance (penetration <0)	max chassis tilt	final v	final y (expect \u22122)	max joint error	bodies removed");
  for (const r of [1, 1.5, 2.5])
    for (const v0 of [10, 40, 150]) {
      const c = await makeCart({ r, ground: "step", mu: 0.2 });
      setSpeed(c, v0);
      let pen = 0;
      let tilt = 0;
      let jerr = 0;
      for (let i = 0; i < Math.round(3 / DT); i++) {
        c.sim.stepFixed(1);
        for (const w of c.wheels) {
          const t = w.translation();
          if (t.x <= 12) pen = Math.min(pen, t.y - r + r);
          else if (t.x >= 12 + r) pen = Math.min(pen, t.y - r + r + 2);
        }
        const q = c.chassis.rotation();
        tilt = Math.max(tilt, 2 * Math.asin(Math.min(1, Math.hypot(q.x, q.y, q.z))));
        jerr = Math.max(jerr, c.sim.jointError());
      }
      console.log([r, v0, fmt(pen, 4), fmt(tilt, 4), fmt(c.chassis.linvel().x, 2), fmt(c.chassis.translation().y, 4), fmt(jerr, 5), c.sim.bodies.filter((b) => !b.fixed && !b.rb).length].join("	"));
      c.sim.dispose();
    }
}
async function guard() {
  console.log("## guard: \u03BC = 0, flat, v0 = 100 u/s for 20 s (2000 units)");
  console.log("guard	v_end/v0	guard removed/KE0	E_end/E0\u22121	ms/sim-s");
  for (const gOn of [true, false]) {
    const c = await makeCart({ r: 1.5, mu: 0, guard: gOn });
    setSpeed(c, 100);
    const e0 = c.sim.energy();
    const t0 = now2();
    c.sim.stepFixed(Math.round(20 / DT));
    const ms = (now2() - t0) / 20;
    const e1 = c.sim.energy();
    console.log([gOn, fmt(c.chassis.linvel().x / 100, 5), fmt(c.sim.guardRemoved / e0.kinetic, 5), fmt((e1.kinetic + e1.potential - e0.kinetic - e0.potential) / e0.kinetic, 5), fmt(ms, 0)].join("	"));
    c.sim.dispose();
  }
}
async function cost() {
  console.log("## cost: ms of stepping per simulated second (Node, machine shared with other jobs; min of 3 \xD7 2 s)");
  console.log("case	ms/sim-s");
  const cases = [
    ["cart r1.5 rolling 40 u/s, 240 it", async () => makeCart({ r: 1.5 }), 40],
    ["cart r1.5 at rest, 240 it", async () => makeCart({ r: 1.5 }), 0]
  ];
  for (const [name, mk, v] of cases) {
    let best = Infinity;
    for (let k = 0; k < 3; k++) {
      const c = await mk();
      setSpeed(c, v);
      const t0 = now2();
      c.sim.stepFixed(960);
      best = Math.min(best, (now2() - t0) / 2);
      c.sim.dispose();
    }
    console.log(`${name}	${fmt(best, 1)}`);
  }
  {
    const { model } = cartModel();
    let best = Infinity;
    for (let k = 0; k < 3; k++) {
      const sim = await Simulation.create(model, {});
      const t0 = now2();
      sim.stepFixed(960);
      best = Math.min(best, (now2() - t0) / 2);
      sim.dispose();
    }
    console.log(`same model, no wheels/ground (falls freely)	${fmt(best, 1)}`);
  }
  const hash = async () => {
    const c = await makeCart({ r: 1.5, theta: 15 });
    c.sim.stepFixed(960);
    const h = poseHash(c.all);
    c.sim.dispose();
    return h;
  };
  console.log(`determinism (cart 15\xB0, 2 s): ${await hash()} ${await hash()}`);
}
async function iters() {
  console.log("## cart substeps: 15\xB0 incline \u03BC=0 accuracy, rest 5 s on flat, cost");
  console.log("iters	a_analytic	a_meas	rel.err	rest y p-p	rest |dx| 5 s	max joint err (rest)	ms/sim-s (incline)");
  for (const it of [30, 60, 120, 240]) {
    const c = await makeCart({ r: 1.5, theta: 15, mu: 0, iters: it });
    const th = 15 * Math.PI / 180;
    const aTh = c.M * G2 * Math.sin(th) / (c.M + c.sumI / (c.r * c.r));
    const ts = [];
    const vs = [];
    const t0 = now2();
    for (let n = 0; n < 480; n++) {
      c.sim.stepFixed(1);
      if (n * DT > 0.1) {
        ts.push(n * DT);
        vs.push(c.chassis.linvel().x);
      }
    }
    const ms = now2() - t0;
    const mx = ts.reduce((a2, b) => a2 + b, 0) / ts.length;
    const my = vs.reduce((a2, b) => a2 + b, 0) / vs.length;
    let sxy = 0;
    let sxx = 0;
    ts.forEach((t, i) => {
      sxy += (t - mx) * (vs[i] - my);
      sxx += (t - mx) ** 2;
    });
    const a = sxy / sxx;
    c.sim.dispose();
    const d = await makeCart({ r: 1.5, iters: it });
    const ys = [];
    let je = 0;
    for (let n = 0; n < Math.round(5 / DT); n++) {
      d.sim.stepFixed(1);
      if (n * DT > 1) {
        ys.push(d.chassis.translation().y);
        je = Math.max(je, d.sim.jointError());
      }
    }
    const st = stats(ys);
    console.log([it, fmt(aTh, 2), fmt(a, 2), fmt(a / aTh - 1, 4), fmt(st.max - st.min, 6), fmt(Math.abs(d.chassis.translation().x - 3), 6), fmt(je, 6), fmt(ms, 0)].join("	"));
    d.sim.dispose();
  }
}
async function cuboidRest() {
  console.log("## cart at rest on a cuboid ground (not a half-space), 10 s");
  console.log("r	|dx|	final y	max |v|");
  for (const r of [1, 1.5, 2.5]) {
    const c = await makeCart({ r, ground: "none" });
    const g = c.world.createRigidBody(RAPIER2.RigidBodyDesc.fixed());
    c.world.createCollider(RAPIER2.ColliderDesc.cuboid(30, 1, 20).setTranslation(3, -r - 1, 1).setFriction(0.4).setRestitution(0.1).setCollisionGroups(GRP.GROUND), g);
    let vmax = 0;
    for (let n = 0; n < Math.round(10 / DT); n++) {
      c.sim.stepFixed(1);
      for (const b of c.all) vmax = Math.max(vmax, Math.hypot(b.linvel().x, b.linvel().y, b.linvel().z));
    }
    console.log([r, fmt(Math.abs(c.chassis.translation().x - 3), 5), fmt(c.chassis.translation().y, 4), fmt(vmax, 4)].join("	"));
    c.sim.dispose();
  }
}
async function main() {
  await initPhysics();
  const want = (t) => TEST === "all" || TEST === t;
  if (want("incline")) await incline();
  if (want("coast")) await coast();
  if (want("rest")) await rest();
  if (want("step")) await step();
  if (want("guard")) await guard();
  if (want("cost")) await cost();
  if (want("iters")) await iters();
  if (want("cuboid")) await cuboidRest();
}
void main();
