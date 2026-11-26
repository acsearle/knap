// Kinematic analysis (DESIGN.md §3): parts + mates -> rigid bodies + joints. Pure.
//
// Determinism: every step iterates parts in ascending id order and pairs / lines / mates in a
// canonical sorted order, so the result depends only on the set of parts (ids, cells) and the
// root, never on the order of `model.parts` or of a part's `cells`.
import { effectiveRootId, posKey, rootIsFixed, worldIndex } from './model';
import { axisLabel, isMale, shareResult } from './rules';
import type { Axis, Cell, MateType, Model } from './types';

// ---------------------------------------------------------------------------------------------
// Types (§3)

export type Vec3 = [number, number, number];
export type JointType = 'revolute' | 'cylindrical' | 'prismatic';

/** A position holding a male cell of one part inside a coaxial compatible hole of another. */
export interface Mate {
  pos: Vec3;
  axis: Axis;
  malePart: number;
  holePart: number;
  type: MateType;
}

export interface Body {
  /** Dense 0..n-1, ordered by lowest part id. */
  id: number;
  /** Ascending. */
  partIds: number[];
  /**
   * Contains the root part (effectiveRootId) **and** rootIsFixed(model) (§3.1 step 4): with a free
   * root (ground on, fixRoot false) no body is fixed.
   */
  fixed: boolean;
}

export interface Joint {
  /** Lower body id. */
  bodyA: number;
  bodyB: number;
  type: JointType;
  /** A point on the joint axis: the lexicographically smallest (x, y, z) mate cell centre of the pair. World, t=0. */
  origin: Vec3;
  axis: Axis;
  /**
   * cylindrical / prismatic only: allowed displacement of body B relative to body A along +axis,
   * in units. limits[0] <= 0 <= limits[1], never [0, 0].
   */
  limits?: [number, number];
}

export interface KinematicGraph {
  /** All mates (welds included), sorted by pos (x, y, z). */
  mates: Mate[];
  /** Sorted by id. */
  bodies: Body[];
  /** One per jointed body pair, sorted by (bodyA, bodyB). */
  joints: Joint[];
  /** part id -> body id, inserted in ascending part id order. */
  bodyOfPart: Map<number, number>;
}

// ---------------------------------------------------------------------------------------------
// Mates (§3.1 step 1)

function cmpPos(a: Vec3, b: Vec3): number {
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
}

/**
 * All mates of a model, sorted by position. A position contributes a mate only if it holds
 * exactly two cells, of different parts, one male and one hole, coaxial and compatible (§2.3);
 * anything else (which validateModel would reject) is ignored.
 */
export function findMates(model: Model): Mate[] {
  const out: Mate[] = [];
  for (const entries of worldIndex(model).map.values()) {
    if (entries.length !== 2) continue;
    const [a, b] = entries as [(typeof entries)[0], (typeof entries)[0]];
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
      type: r.mate,
    });
  }
  out.sort((m, n) => cmpPos(m.pos, n.pos));
  return out;
}

/** Key of the axis line through `pos` along `axis` (direction + the two transverse coordinates). */
export function lineKey(pos: readonly [number, number, number], axis: Axis): string {
  if (axis === 0) return `0|${pos[1]},${pos[2]}`;
  if (axis === 1) return `1|${pos[0]},${pos[2]}`;
  return `2|${pos[0]},${pos[1]}`;
}

// ---------------------------------------------------------------------------------------------
// Union-find over part ids; the representative of a class is its lowest part id.

class UnionFind {
  private parent = new Map<number, number>();
  readonly partCount = new Map<number, number>();
  readonly cellCount = new Map<number, number>();

  add(id: number, cells: number): void {
    this.parent.set(id, id);
    this.partCount.set(id, 1);
    this.cellCount.set(id, cells);
  }

  find(id: number): number {
    let r = id;
    for (;;) {
      const p = this.parent.get(r);
      if (p === undefined || p === r) break;
      r = p;
    }
    // path compression
    let c = id;
    while (c !== r) {
      const p = this.parent.get(c)!;
      this.parent.set(c, r);
      c = p;
    }
    return r;
  }

  /** Returns true if the classes were distinct. */
  union(a: number, b: number): boolean {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra === rb) return false;
    const [keep, drop] = ra < rb ? [ra, rb] : [rb, ra];
    this.parent.set(drop, keep);
    this.partCount.set(keep, this.partCount.get(keep)! + this.partCount.get(drop)!);
    this.cellCount.set(keep, this.cellCount.get(keep)! + this.cellCount.get(drop)!);
    this.partCount.delete(drop);
    this.cellCount.delete(drop);
    return true;
  }
}

// ---------------------------------------------------------------------------------------------
// Slide limits (§3.2)

/** Cells by position for one body. */
type CellMap = Map<string, Cell[]>;

function isCylMateAlong(a: Cell, b: Cell, axis: Axis): boolean {
  if (a.axis !== axis || b.axis !== axis) return false;
  const r = shareResult(a, b);
  return r.ok && r.mate === 'cylindrical';
}

/** Largest n >= 0 such that shifts sign*1 .. sign*n are all legal. */
function maxShift(legal: (s: number) => boolean, sign: 1 | -1): number {
  let n = 0;
  // Legality requires an overlap, so this terminates once B has moved past A; the cap is a guard.
  while (n < 1_000_000 && legal(sign * (n + 1))) n++;
  return n;
}

function perpCoords(c: Cell, axis: Axis): [number, number] {
  return axis === 0 ? [c.y, c.z] : axis === 1 ? [c.x, c.z] : [c.x, c.y];
}

function along(c: Cell, axis: Axis): number {
  return axis === 0 ? c.x : axis === 1 ? c.y : c.z;
}

/**
 * Positions (posKey) where a cell of A or B is already filled by a *pin of a third body* (a
 * `revolute` mate whose other part is in neither A nor B). A pin cannot slide out of its hole, so
 * such a position can never take a cell of the other body: a shift that needs it is blocked.
 * This keeps the limits independent of which body a free pin was absorbed into (DEVIATIONS §3).
 */
type Blocked = (x: number, y: number, z: number) => boolean;

/** Cylindrical limits of B relative to A on the single line through `onLine` along `axis`. */
function cylindricalLimits(
  cellsA: readonly Cell[],
  cellsB: readonly Cell[],
  axis: Axis,
  onLine: Vec3,
  blocked: Blocked,
): [number, number] {
  const [p, q] = axis === 0 ? [onLine[1], onLine[2]] : axis === 1 ? [onLine[0], onLine[2]] : [onLine[0], onLine[1]];
  const at = (t: number): [number, number, number] => (axis === 0 ? [t, p, q] : axis === 1 ? [p, t, q] : [p, q, t]);
  const lineCells = (cells: readonly Cell[]) => {
    const m = new Map<number, Cell[]>();
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
  const legal = (s: number): boolean => {
    let mates = 0;
    for (const [t, bs] of lb) {
      const as = la.get(t + s);
      if (!as) continue;
      if (as.length !== 1 || bs.length !== 1 || !isCylMateAlong(as[0]!, bs[0]!, axis)) return false;
      if (blocked(...at(t + s)) || blocked(...at(t))) return false;
      mates++;
    }
    return mates >= 1;
  };
  return [0 - maxShift(legal, -1) || 0, maxShift(legal, 1)];
}

/** Prismatic limits of B relative to A along `axis`, testing the full cell sets. */
function prismaticLimits(mapA: CellMap, cellsB: readonly Cell[], axis: Axis, blocked: Blocked): [number, number] {
  const byPos = new Map<string, Cell[]>();
  for (const c of cellsB) {
    const k = posKey(c.x, c.y, c.z);
    const l = byPos.get(k);
    if (l) l.push(c);
    else byPos.set(k, [c]);
  }
  const groups = [...byPos.values()];
  const legal = (s: number): boolean => {
    const lines = new Set<string>();
    for (const bs of groups) {
      const c = bs[0]!;
      const x = c.x + (axis === 0 ? s : 0);
      const y = c.y + (axis === 1 ? s : 0);
      const z = c.z + (axis === 2 ? s : 0);
      const as = mapA.get(posKey(x, y, z));
      if (!as) continue;
      if (as.length !== 1 || bs.length !== 1 || !isCylMateAlong(as[0]!, c, axis)) return false;
      if (blocked(x, y, z) || blocked(c.x, c.y, c.z)) return false;
      lines.add(lineKey([x, y, z], axis));
    }
    return lines.size >= 2;
  };
  return [0 - maxShift(legal, -1) || 0, maxShift(legal, 1)];
}

// ---------------------------------------------------------------------------------------------
// analyze (§3.1)

interface PairJoint {
  a: number; // representative (lowest part id) of body A
  b: number;
  type: JointType;
  origin: Vec3;
  axis: Axis;
  limits?: [number, number];
}

/** Is this part a straight run of male cells on one line (§3.1 3.1(b))? */
function isStraightMale(cells: readonly Cell[]): boolean {
  if (cells.length === 0) return false;
  const c0 = cells[0]!;
  const [p0, q0] = perpCoords(c0, c0.axis);
  for (const c of cells) {
    if (!isMale(c.kind) || c.axis !== c0.axis) return false;
    const [p, q] = perpCoords(c, c0.axis);
    if (p !== p0 || q !== q0) return false;
  }
  return true;
}

/**
 * Rigid bodies and joints of a model (§3). Expects a valid model (validateModel(m) == []);
 * invalid overlaps are ignored rather than reported. Deterministic.
 */
export function analyze(model: Model): KinematicGraph {
  const parts = [...model.parts].sort((p, q) => p.id - q.id);
  const cellsOf = new Map<number, readonly Cell[]>();
  for (const p of parts) cellsOf.set(p.id, p.cells);
  const rootId = effectiveRootId(model);
  const mates = findMates(model);

  // Step 2: union across welds.
  const uf = new UnionFind();
  for (const p of parts) uf.add(p.id, p.cells.length);
  for (const m of mates) if (m.type === 'weld') uf.union(m.malePart, m.holePart);

  const matesOfMale = new Map<number, Mate[]>();
  for (const m of mates) {
    const l = matesOfMale.get(m.malePart);
    if (l) l.push(m);
    else matesOfMale.set(m.malePart, [m]);
  }
  const pinCandidates = parts.filter((p) => isStraightMale(p.cells)).map((p) => p.id);

  // Revolute mates by position, for the third-body pin test in the slide limits.
  const revAt = new Map<string, Mate>();
  for (const m of mates) if (m.type === 'revolute') revAt.set(posKey(...m.pos), m);

  // Free pins (3.1 a–d) seen so far: absorbed ones, and a free pin that is the root (kept as its
  // own fixed body). Each one is a revolute connection on its line between *every* pair of
  // bodies it passes through, not only the pairs that involve the body holding its cells.
  const connectors: number[] = [];
  const rootFixedHere = rootIsFixed(model);

  let joints: PairJoint[] = [];
  for (let guard = 0; ; guard++) {
    if (guard > parts.length + 2) throw new Error('kinematic analysis did not converge'); // each pass that continues merges >= 1 class
    let changed = false;

    // 3.1 Absorb free pins (ascending part id; live union-find state).
    for (const pid of pinCandidates) {
      const r = uf.find(pid);
      if (uf.partCount.get(r) !== 1) continue;
      const ms = (matesOfMale.get(pid) ?? []).filter((m) => uf.find(m.holePart) !== r);
      if (ms.length === 0 || ms.some((m) => m.type !== 'revolute')) continue;
      if (!connectors.includes(pid)) connectors.push(pid);
      // A free pin that is itself the *fixed* root stays a fixed body of its own: absorbing it
      // would weld the beam it landed in to the ground. With a free root (§2.6) nothing is fixed,
      // so it is absorbed like any other free pin (review finding: else it became a 0.5-mass body
      // of its own whose joints carried only its tiny friction load).
      if (pid === rootId && rootFixedHere) continue;
      const targets = [...new Set(ms.map((m) => uf.find(m.holePart)))].sort((x, y) => x - y);
      const cur = rootId === null ? null : uf.find(rootId);
      let best = targets[0]!;
      if (cur !== null && targets.includes(cur)) best = cur;
      else {
        for (const t of targets) if (uf.cellCount.get(t)! > uf.cellCount.get(best)!) best = t;
      }
      uf.union(pid, best);
      changed = true;
    }

    // 3.2 Pairwise reduction over non-weld mates between distinct bodies, plus the implied
    // ("virtual") revolute lines of free pins between the other bodies they pass through.
    interface Pair {
      a: number;
      b: number;
      mates: Mate[];
      /** Line keys of virtual revolute connections (no Mate of their own). */
      virtualLines: Set<string>;
    }
    const pairs = new Map<string, Pair>();
    const pairOf = (rx: number, ry: number): Pair => {
      const a = Math.min(rx, ry);
      const b = Math.max(rx, ry);
      const k = `${a},${b}`;
      let g = pairs.get(k);
      if (!g) {
        g = { a, b, mates: [], virtualLines: new Set() };
        pairs.set(k, g);
      }
      return g;
    };
    for (const m of mates) {
      if (m.type === 'weld') continue;
      const rm = uf.find(m.malePart);
      const rh = uf.find(m.holePart);
      if (rm === rh) continue;
      pairOf(rm, rh).mates.push(m);
    }
    for (const pid of connectors) {
      const own = uf.find(pid);
      const others = [
        ...new Set((matesOfMale.get(pid) ?? []).map((m) => uf.find(m.holePart)).filter((r) => r !== own)),
      ].sort((x, y) => x - y);
      const c0 = cellsOf.get(pid)![0]!;
      const line = lineKey([c0.x, c0.y, c0.z], c0.axis);
      for (let i = 0; i < others.length; i++) {
        for (let k = i + 1; k < others.length; k++) pairOf(others[i]!, others[k]!).virtualLines.add(line);
      }
    }
    const ordered = [...pairs.values()].sort((x, y) => x.a - y.a || x.b - y.b);

    const bodyCells = new Map<number, Cell[]>();
    const cellsOfBody = (rep: number): Cell[] => {
      let cs = bodyCells.get(rep);
      if (!cs) {
        cs = [];
        for (const p of parts) if (uf.find(p.id) === rep) for (const c of p.cells) cs.push(c);
        bodyCells.set(rep, cs);
      }
      return cs;
    };
    const cellMap = (rep: number): CellMap => {
      const m: CellMap = new Map();
      for (const c of cellsOfBody(rep)) {
        const k = posKey(c.x, c.y, c.z);
        const l = m.get(k);
        if (l) l.push(c);
        else m.set(k, [c]);
      }
      return m;
    };
    /** Is (x,y,z) a hole of body a or b that holds a pin of some third body? */
    const blockedFor =
      (a: number, b: number): Blocked =>
      (x, y, z) => {
        const m = revAt.get(posKey(x, y, z));
        if (!m) return false;
        const rh = uf.find(m.holePart);
        const rm = uf.find(m.malePart);
        return (rh === a || rh === b) && rm !== a && rm !== b;
      };

    const unions: [number, number][] = [];
    const next: PairJoint[] = [];
    for (const { a, b, mates: ms, virtualLines } of ordered) {
      const lines = new Set([...ms.map((m) => lineKey(m.pos, m.axis)), ...virtualLines]);
      if (ms.length === 0) {
        // Only virtual lines: one line is already implied by the pin's joints to its own body
        // (no joint here, it would be redundant); two or more lines make the pair rigid.
        if (lines.size >= 2) unions.push([a, b]);
        continue;
      }
      // ms is sorted by pos (mates is), so ms[0] is the canonical origin.
      const origin: Vec3 = [...ms[0]!.pos];
      const axis = ms[0]!.axis;
      if (lines.size === 1) {
        if (virtualLines.size > 0 || ms.some((m) => m.type === 'revolute')) {
          next.push({ a, b, type: 'revolute', origin, axis });
        } else {
          const lim = cylindricalLimits(cellsOfBody(a), cellsOfBody(b), axis, origin, blockedFor(a, b));
          if (lim[0] === 0 && lim[1] === 0) next.push({ a, b, type: 'revolute', origin, axis });
          else next.push({ a, b, type: 'cylindrical', origin, axis, limits: lim });
        }
        continue;
      }
      const parallel = ms.every((m) => m.axis === axis);
      const allCyl = virtualLines.size === 0 && ms.every((m) => m.type === 'cylindrical');
      if (parallel && allCyl) {
        const lim = prismaticLimits(cellMap(a), cellsOfBody(b), axis, blockedFor(a, b));
        if (lim[0] === 0 && lim[1] === 0) unions.push([a, b]);
        else next.push({ a, b, type: 'prismatic', origin, axis, limits: lim });
      } else {
        unions.push([a, b]);
      }
    }
    for (const [a, b] of unions) if (uf.union(a, b)) changed = true;
    joints = next;
    if (!changed) break;
  }

  // Step 4: dense body ids ordered by lowest part id (= representative).
  const reps = [...new Set(parts.map((p) => uf.find(p.id)))].sort((x, y) => x - y);
  const bodyIdOfRep = new Map<number, number>();
  reps.forEach((r, i) => bodyIdOfRep.set(r, i));
  const bodies: Body[] = reps.map((r, i) => ({ id: i, partIds: [], fixed: false }));
  const rootFixed = rootIsFixed(model);
  const bodyOfPart = new Map<number, number>();
  for (const p of parts) {
    const bid = bodyIdOfRep.get(uf.find(p.id))!;
    bodies[bid]!.partIds.push(p.id);
    if (p.id === rootId && rootFixed) bodies[bid]!.fixed = true;
    bodyOfPart.set(p.id, bid);
  }
  const outJoints: Joint[] = joints.map((j) => {
    const out: Joint = {
      bodyA: bodyIdOfRep.get(j.a)!,
      bodyB: bodyIdOfRep.get(j.b)!,
      type: j.type,
      origin: j.origin,
      axis: j.axis,
    };
    if (j.limits) out.limits = j.limits;
    return out;
  });
  outJoints.sort((x, y) => x.bodyA - y.bodyA || x.bodyB - y.bodyB);
  return { mates, bodies, joints: outJoints, bodyOfPart };
}

// ---------------------------------------------------------------------------------------------
// Summary

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : word.endsWith('y') ? '' : 's'}`;
}

function fmtVec(v: readonly number[]): string {
  return `(${v.join(', ')})`;
}

function fmtLimits(l: readonly [number, number]): string {
  return `[${l[0]}, ${l[1] > 0 ? '+' : ''}${l[1]}]`;
}

/**
 * Compact human-readable summary, e.g. "4 bodies (1 fixed) · 4 joints: 4 revolute".
 * With `detail`, adds one line per body and per joint:
 *   "body 0 fixed: parts 1, 5, 8"
 *   "joint 0–1 cylindrical ∥ Y through (0, 0, 0), slide [-2, +2]"
 */
export function describeGraph(graph: KinematicGraph, opts: { detail?: boolean } = {}): string {
  const nb = graph.bodies.length;
  const nf = graph.bodies.filter((b) => b.fixed).length;
  const counts: Record<JointType, number> = { revolute: 0, cylindrical: 0, prismatic: 0 };
  for (const j of graph.joints) counts[j.type]++;
  const kinds = (['revolute', 'cylindrical', 'prismatic'] as const)
    .filter((t) => counts[t] > 0)
    .map((t) => `${counts[t]} ${t}`)
    .join(', ');
  const bodiesStr = `${nb} ${nb === 1 ? 'body' : 'bodies'}${nb ? ` (${nf} fixed)` : ''}`;
  const jointsStr = graph.joints.length ? `${plural(graph.joints.length, 'joint')}: ${kinds}` : 'no joints';
  let s = `${bodiesStr} · ${jointsStr}`;
  if (opts.detail) {
    const lines = [s];
    for (const b of graph.bodies) {
      lines.push(`body ${b.id}${b.fixed ? ' fixed' : ''}: ${b.partIds.length === 1 ? 'part' : 'parts'} ${b.partIds.join(', ')}`);
    }
    for (const j of graph.joints) {
      let l = `joint ${j.bodyA}–${j.bodyB} ${j.type} ∥ ${axisLabel(j.axis)} through ${fmtVec(j.origin)}`;
      if (j.limits) l += `, slide ${fmtLimits(j.limits)}`;
      lines.push(l);
    }
    s = lines.join('\n');
  }
  return s;
}
