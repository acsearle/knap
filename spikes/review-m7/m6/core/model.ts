// Model operations (DESIGN.md §2.4–2.5). Pure functions: inputs are never mutated; unchanged
// parts/cells are shared structurally between the input and output models.
import {
  AXES,
  DIRS,
  connects,
  isAxis,
  isKind,
  isMale,
  kindLabel,
  shareResult,
} from './rules';
import type {
  Axis,
  CanResult,
  Cell,
  Kind,
  Model,
  Part,
  ValidationError,
  Vec3i,
} from './types';

// ---------------------------------------------------------------------------------------------
// Small helpers

type XYZ = { readonly x: number; readonly y: number; readonly z: number };

/** Map key for a grid position. */
export function posKey(x: number, y: number, z: number): string {
  return `${x},${y},${z}`;
}

/** Map key for a cell's (or any {x,y,z}'s) position. */
export function cellKey(c: XYZ): string {
  return `${c.x},${c.y},${c.z}`;
}

export function cellPos(c: XYZ): Vec3i {
  return [c.x, c.y, c.z];
}

function fmtPos(p: XYZ | Vec3i): string {
  return 'x' in p ? `(${p.x}, ${p.y}, ${p.z})` : `(${p[0]}, ${p[1]}, ${p[2]})`;
}

/** Copy of a cell with only the known fields. */
export function makeCell(x: number, y: number, z: number, kind: Kind, axis: Axis): Cell {
  return { x, y, z, kind, axis };
}

export function emptyModel(): Model {
  return { version: 1, parts: [], rootPartId: null, nextPartId: 1 };
}

export function partById(m: Model, partId: number): Part | undefined {
  return m.parts.find((p) => p.id === partId);
}

function requirePart(m: Model, partId: number): Part {
  const p = partById(m, partId);
  if (!p) throw new Error(`no part with id ${partId}`);
  return p;
}

/** The cell of `part` at `pos`, if any. */
export function cellAt(part: Part, pos: Vec3i): Cell | undefined {
  return part.cells.find((c) => c.x === pos[0] && c.y === pos[1] && c.z === pos[2]);
}

/** The part fixed during simulation: rootPartId if it names an existing part, else the lowest id. */
export function effectiveRootId(m: Model): number | null {
  if (m.rootPartId !== null && m.parts.some((p) => p.id === m.rootPartId)) return m.rootPartId;
  let best: number | null = null;
  for (const p of m.parts) if (best === null || p.id < best) best = p.id;
  return best;
}

export const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

/** Default colours (§6.1) used when a new part is created without an explicit colour. */
export const DEFAULT_COLORS: Readonly<Record<Kind, string>> = {
  pinHole: '#e0b43c', // the UI normally passes its current palette colour for holes
  axleHole: '#e0b43c',
  axle: '#a8adb2', // light grey
  pin: '#d9c9a3', // tan
  frictionPin: '#2f63c4', // blue
};

export function defaultColorFor(kind: Kind): string {
  return DEFAULT_COLORS[kind];
}

// ---------------------------------------------------------------------------------------------
// World index

export interface WorldEntry {
  readonly partId: number;
  readonly cell: Cell;
  /** Index of the cell within its part's `cells`. */
  readonly index: number;
}

const EMPTY: readonly WorldEntry[] = Object.freeze([]);

/** Position -> cells (with part ids) occupying it. Build with `worldIndex(m)` (cached). */
export class WorldIndex {
  readonly map = new Map<string, WorldEntry[]>();

  constructor(m: Model) {
    for (const part of m.parts) {
      part.cells.forEach((cell, index) => {
        const k = cellKey(cell);
        const list = this.map.get(k);
        const e: WorldEntry = { partId: part.id, cell, index };
        if (list) list.push(e);
        else this.map.set(k, [e]);
      });
    }
  }

  at(pos: Vec3i): readonly WorldEntry[] {
    return this.map.get(posKey(pos[0], pos[1], pos[2])) ?? EMPTY;
  }

  atXYZ(p: XYZ): readonly WorldEntry[] {
    return this.map.get(cellKey(p)) ?? EMPTY;
  }
}

const indexCache = new WeakMap<Model, WorldIndex>();

/**
 * World index for a model, cached by model identity. Models MUST NOT be mutated after they have
 * been passed to any core function (canAddCell, addPart, movePart, rotatePart, cellsAt, …):
 * build a new model instead (all core operations do). validateModel does not use this cache.
 */
export function worldIndex(m: Model): WorldIndex {
  let w = indexCache.get(m);
  if (!w) {
    w = new WorldIndex(m);
    indexCache.set(m, w);
  }
  return w;
}

/** All cells (of any part) at a position. */
export function cellsAt(m: Model, pos: Vec3i): readonly WorldEntry[] {
  return worldIndex(m).at(pos);
}

// ---------------------------------------------------------------------------------------------
// Part-internal structure

/**
 * Connected components of a cell list under the in-part connection rule. Each component is a
 * list of indices into `cells`, ascending; components are ordered by their lowest index.
 * Cells at duplicate positions are treated as separate (the first one at a position wins the
 * lookup), so callers should check duplicates first.
 */
export function components(cells: readonly Cell[]): number[][] {
  const at = new Map<string, number>();
  cells.forEach((c, i) => {
    const k = cellKey(c);
    if (!at.has(k)) at.set(k, i);
  });
  const comp = new Array<number>(cells.length).fill(-1);
  const out: number[][] = [];
  for (let s = 0; s < cells.length; s++) {
    if (comp[s] !== -1) continue;
    const id = out.length;
    const members: number[] = [];
    comp[s] = id;
    const stack = [s];
    while (stack.length) {
      const i = stack.pop()!;
      members.push(i);
      const c = cells[i]!;
      for (const d of DIRS) {
        const j = at.get(posKey(c.x + d[0], c.y + d[1], c.z + d[2]));
        if (j === undefined || comp[j] !== -1) continue;
        if (connects(c, cells[j]!)) {
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

function cellStructureError(c: unknown): string | null {
  if (typeof c !== 'object' || c === null || Array.isArray(c)) return 'expected an object {x,y,z,kind,axis}';
  const o = c as Record<string, unknown>;
  for (const f of ['x', 'y', 'z'] as const) {
    if (typeof o[f] !== 'number' || !Number.isSafeInteger(o[f])) return `${f} must be an integer (got ${JSON.stringify(o[f])})`;
  }
  if (!isKind(o.kind)) return `kind must be one of pinHole, axleHole, axle, pin, frictionPin (got ${JSON.stringify(o.kind)})`;
  if (!isAxis(o.axis)) return `axis must be 0, 1 or 2 (got ${JSON.stringify(o.axis)})`;
  return null;
}

/** Problems with a candidate part's cell list (structure, duplicates, connectivity). */
function partCellErrors(cells: readonly Cell[], partId: number | undefined): ValidationError[] {
  const errs: ValidationError[] = [];
  const label = partId === undefined ? 'part' : `part ${partId}`;
  if (cells.length === 0) {
    errs.push({ code: 'emptyPart', message: `${label} has no cells`, ...(partId !== undefined && { partId }) });
    return errs;
  }
  const seen = new Set<string>();
  for (const c of cells) {
    const k = cellKey(c);
    if (seen.has(k)) {
      errs.push({
        code: 'duplicateCell',
        message: `${label} has two cells at ${fmtPos(c)}`,
        pos: cellPos(c),
        ...(partId !== undefined && { partId }),
      });
    }
    seen.add(k);
  }
  if (errs.length) return errs;
  const comps = components(cells);
  if (comps.length > 1) {
    const sizes = comps.map((cc) => cc.length).join(' + ');
    errs.push({
      code: 'disconnected',
      message: `${label} is not connected: it falls into ${comps.length} pieces (${sizes} cells)`,
      ...(partId !== undefined && { partId }),
    });
  }
  return errs;
}

/**
 * Can `cell` be placed at its position given the other parts' cells there?
 * `ignorePartId`'s cells are disregarded (the part being edited/moved).
 */
function occupancyCheck(world: WorldIndex, cell: Cell, ignorePartId: number | null): CanResult {
  const others = world.atXYZ(cell).filter((e) => e.partId !== ignorePartId);
  if (others.length === 0) return { ok: true };
  const distinct = new Set(others.map((e) => e.partId));
  if (distinct.size >= 2 || others.length >= 2) {
    return { ok: false, reason: `${fmtPos(cell)} is already shared by two parts` };
  }
  const other = others[0]!;
  const r = shareResult(cell, other.cell);
  if (r.ok) return { ok: true };
  return { ok: false, reason: `${fmtPos(cell)}: ${r.reason} (part ${other.partId} has a ${kindLabel(other.cell.kind)} there)` };
}

// ---------------------------------------------------------------------------------------------
// Validation

/**
 * Validate a model against §2.2 and §2.3 (plus basic structure). [] when valid.
 * Accepts arbitrary input (e.g. freshly parsed JSON) without throwing.
 */
export function validateModel(m: Model): ValidationError[] {
  const errs: ValidationError[] = [];
  const s = (message: string) => errs.push({ code: 'structure', message });
  const o = m as unknown as Record<string, unknown>;
  if (typeof o !== 'object' || o === null || Array.isArray(o)) {
    s('model must be a JSON object');
    return errs;
  }
  if (o.version !== 1) s(`version: expected 1 (got ${JSON.stringify(o.version)})`);
  if (!Array.isArray(o.parts)) {
    s('parts: expected an array');
    return errs;
  }
  if (o.rootPartId !== null && !(typeof o.rootPartId === 'number' && Number.isSafeInteger(o.rootPartId))) {
    s(`rootPartId: expected an integer or null (got ${JSON.stringify(o.rootPartId)})`);
  }
  if (!(typeof o.nextPartId === 'number' && Number.isSafeInteger(o.nextPartId) && o.nextPartId >= 1)) {
    s(`nextPartId: expected a positive integer (got ${JSON.stringify(o.nextPartId)})`);
  }
  (o.parts as unknown[]).forEach((p, i) => {
    const path = `parts[${i}]`;
    if (typeof p !== 'object' || p === null || Array.isArray(p)) {
      s(`${path}: expected an object {id,color,cells}`);
      return;
    }
    const po = p as Record<string, unknown>;
    if (!(typeof po.id === 'number' && Number.isSafeInteger(po.id) && po.id >= 0)) {
      s(`${path}.id: expected a non-negative integer (got ${JSON.stringify(po.id)})`);
    }
    if (typeof po.color !== 'string' || !HEX_COLOR.test(po.color)) {
      s(`${path}.color: expected '#rrggbb' (got ${JSON.stringify(po.color)})`);
    }
    if (!Array.isArray(po.cells)) {
      s(`${path}.cells: expected an array`);
      return;
    }
    (po.cells as unknown[]).forEach((c, j) => {
      const e = cellStructureError(c);
      if (e) s(`${path}.cells[${j}]: ${e}`);
    });
  });
  if (errs.length) return errs; // later checks assume well-formed data

  // Part ids
  const ids = new Set<number>();
  let maxId = -Infinity;
  for (const p of m.parts) {
    if (ids.has(p.id)) errs.push({ code: 'duplicatePartId', message: `part id ${p.id} is used more than once`, partId: p.id });
    ids.add(p.id);
    maxId = Math.max(maxId, p.id);
  }
  if (m.parts.length && m.nextPartId <= maxId) {
    errs.push({ code: 'nextPartId', message: `nextPartId ${m.nextPartId} must be greater than every part id (max ${maxId})` });
  }

  // Per part (§2.2)
  for (const p of m.parts) errs.push(...partCellErrors(p.cells, p.id));

  // Sharing between parts (§2.3). A fresh index, not the identity cache: validateModel is the
  // function most likely to see hand-built or mutated objects.
  const world = new WorldIndex(m);
  for (const entries of world.map.values()) {
    const parts = new Map<number, WorldEntry>();
    for (const e of entries) if (!parts.has(e.partId)) parts.set(e.partId, e);
    if (parts.size < 2) continue;
    const [a, b] = [...parts.values()] as [WorldEntry, WorldEntry];
    const pos = cellPos(a.cell);
    if (parts.size > 2) {
      errs.push({
        code: 'overlap',
        message: `${fmtPos(a.cell)} is occupied by ${parts.size} parts (${[...parts.keys()].join(', ')}); at most two may share a cell`,
        pos,
      });
      continue;
    }
    const r = shareResult(a.cell, b.cell);
    if (!r.ok) {
      errs.push({
        code: 'overlap',
        message: `${fmtPos(a.cell)}: parts ${a.partId} and ${b.partId} overlap invalidly: ${r.reason}`,
        pos,
      });
    }
  }
  return errs;
}

// ---------------------------------------------------------------------------------------------
// Editing

/** Why two adjacent cells of one part do not connect (§2.2), as a short clause for messages. */
function whyNoConnection(a: Cell, b: Cell): string {
  const along = a.x !== b.x ? 0 : a.y !== b.y ? 1 : 2;
  if ((isMale(a.kind) && a.axis !== along) || (isMale(b.kind) && b.axis !== along)) return 'a rod’s side holds nothing';
  return 'a rod’s end on the mouth of a coaxial hole does not hold';
}

/**
 * Could `cell` be added to part `partId` (or, with partId null, start a new part)?
 * Checks: well-formed cell; position free within the part; >= 1 in-part connection; world
 * occupancy compatible per §2.3.
 */
export function canAddCell(m: Model, partId: number | null, cell: Cell): CanResult {
  const se = cellStructureError(cell);
  if (se) return { ok: false, reason: `invalid cell: ${se}` };
  if (partId !== null) {
    const part = partById(m, partId);
    if (!part) return { ok: false, reason: `no part with id ${partId}` };
    if (part.cells.some((c) => c.x === cell.x && c.y === cell.y && c.z === cell.z)) {
      return { ok: false, reason: `part ${partId} already has a cell at ${fmtPos(cell)}` };
    }
    let neighbour: Cell | null = null;
    let connected = false;
    for (const c of part.cells) {
      if (Math.abs(c.x - cell.x) + Math.abs(c.y - cell.y) + Math.abs(c.z - cell.z) !== 1) continue;
      neighbour ??= c;
      if (connects(c, cell)) {
        connected = true;
        break;
      }
    }
    if (!neighbour) return { ok: false, reason: `${fmtPos(cell)} is not adjacent to part ${partId}` };
    if (!connected) {
      return {
        ok: false,
        reason: `${/^[aeiou]/.test(kindLabel(cell.kind)) ? 'an' : 'a'} ${kindLabel(cell.kind)} along ${'XYZ'[cell.axis]} at ${fmtPos(cell)} would not attach to part ${partId} (${whyNoConnection(neighbour, cell)})`,
      };
    }
  }
  return occupancyCheck(worldIndex(m), cell, partId);
}

/**
 * First of `count` fresh part ids. nextPartId is normally >= 1 and > every id (validateModel);
 * this also guards models that were never validated, so allocation never yields a negative,
 * duplicate or unsafe id. Throws if the id space is exhausted.
 */
function allocIds(m: Model, count: number): number {
  let first = Number.isSafeInteger(m.nextPartId) ? Math.max(m.nextPartId, 1) : 1;
  for (const p of m.parts) if (p.id >= first) first = p.id + 1;
  if (!Number.isSafeInteger(first + count)) throw new Error('no part ids left (nextPartId too large)');
  return first;
}

function replacePart(m: Model, partId: number, parts: Part[]): Part[] {
  const out: Part[] = [];
  for (const p of m.parts) {
    if (p.id === partId) out.push(...parts);
    else out.push(p);
  }
  return out;
}

/** Add a cell to an existing part. Throws if !canAddCell(m, partId, cell). */
export function addCell(m: Model, partId: number, cell: Cell): Model {
  const r = canAddCell(m, partId, cell);
  if (!r.ok) throw new Error(r.reason);
  const part = requirePart(m, partId);
  const np: Part = { ...part, cells: [...part.cells, makeCell(cell.x, cell.y, cell.z, cell.kind, cell.axis)] };
  return { ...m, parts: replacePart(m, partId, [np]) };
}

/**
 * Create a new part from `cells` (copied). Colour defaults to DEFAULT_COLORS of the first cell's
 * kind. Throws with a reason if the part would be invalid or conflict with existing parts.
 */
export function addPart(m: Model, cells: readonly Cell[], color?: string): { model: Model; partId: number } {
  for (let i = 0; i < cells.length; i++) {
    const e = cellStructureError(cells[i]);
    if (e) throw new Error(`invalid cell ${i}: ${e}`);
  }
  const copy = cells.map((c) => makeCell(c.x, c.y, c.z, c.kind, c.axis));
  const errs = partCellErrors(copy, undefined);
  if (errs.length) throw new Error(errs[0]!.message);
  const world = worldIndex(m);
  for (const c of copy) {
    const r = occupancyCheck(world, c, null);
    if (!r.ok) throw new Error(r.reason);
  }
  const col = color ?? defaultColorFor(copy[0]!.kind);
  if (!HEX_COLOR.test(col)) throw new Error(`invalid colour ${JSON.stringify(col)} (expected '#rrggbb')`);
  const partId = allocIds(m, 1);
  const part: Part = { id: partId, color: col.toLowerCase(), cells: copy };
  return { model: { ...m, parts: [...m.parts, part], nextPartId: partId + 1 }, partId };
}

/**
 * Remove the cell of part `partId` at `pos`. If the rest falls apart it is split into several
 * parts: the largest piece keeps the id (ties: the piece containing the earliest remaining cell),
 * the others get fresh ids in order of size (desc) then earliest cell, inserted right after it,
 * with the same colour. The root designation follows the piece that keeps the id. Removing a
 * part's last cell removes the part. Throws if there is no such part/cell.
 */
export function removeCell(m: Model, partId: number, pos: Vec3i): Model {
  const part = requirePart(m, partId);
  const idx = part.cells.findIndex((c) => c.x === pos[0] && c.y === pos[1] && c.z === pos[2]);
  if (idx < 0) throw new Error(`part ${partId} has no cell at ${fmtPos(pos)}`);
  const rest = part.cells.filter((_, i) => i !== idx);
  if (rest.length === 0) return removePart(m, partId);
  const comps = components(rest);
  if (comps.length === 1) return { ...m, parts: replacePart(m, partId, [{ ...part, cells: rest }]) };
  // Stable sort keeps "earliest cell first" order among equal sizes.
  const ordered = [...comps].sort((a, b) => b.length - a.length);
  let next = allocIds(m, ordered.length - 1);
  const pieces: Part[] = ordered.map((comp, k) => ({
    id: k === 0 ? partId : next++,
    color: part.color,
    cells: comp.map((i) => rest[i]!),
  }));
  return { ...m, parts: replacePart(m, partId, pieces), nextPartId: next };
}

/** Remove a whole part. If it was the designated root, rootPartId becomes null. Throws if missing. */
export function removePart(m: Model, partId: number): Model {
  requirePart(m, partId);
  return {
    ...m,
    parts: m.parts.filter((p) => p.id !== partId),
    rootPartId: m.rootPartId === partId ? null : m.rootPartId,
  };
}

/** Replace a part's cells if the result is valid w.r.t. the other parts; else null. */
function withPartCells(m: Model, part: Part, cells: Cell[]): Model | null {
  const world = worldIndex(m);
  for (const c of cells) if (!occupancyCheck(world, c, part.id).ok) return null;
  return { ...m, parts: replacePart(m, part.id, [{ ...part, cells }]) };
}

function isIntVec(v: readonly number[]): boolean {
  return v.length === 3 && v.every((n) => Number.isSafeInteger(n));
}

/** Translate a part by an integer delta. null if the result would be invalid. Throws if missing. */
export function movePart(m: Model, partId: number, delta: Vec3i): Model | null {
  const part = requirePart(m, partId);
  if (!isIntVec(delta)) throw new Error(`movePart: delta must be three integers (got ${JSON.stringify(delta)})`);
  const [dx, dy, dz] = delta;
  if (dx === 0 && dy === 0 && dz === 0) return m;
  return withPartCells(
    m,
    part,
    part.cells.map((c) => makeCell(c.x + dx, c.y + dy, c.z + dz, c.kind, c.axis)),
  );
}

/**
 * Rotate an integer vector by quarterTurns × 90° about a coordinate axis (right-hand rule:
 * positive turns are counter-clockwise looking from +axis towards the origin).
 */
export function rotateVec(v: Vec3i, axis: Axis, quarterTurns: number): Vec3i {
  let [x, y, z] = v;
  const k = ((quarterTurns % 4) + 4) % 4;
  for (let i = 0; i < k; i++) {
    if (axis === 0) [y, z] = [-z, y];
    else if (axis === 1) [z, x] = [-x, z];
    else [x, y] = [-y, x];
  }
  // normalise -0
  return [x + 0, y + 0, z + 0];
}

/** The cell axis after a rotation: odd quarter-turns swap the two axes ⟂ the rotation axis. */
export function rotateAxis(cellAxis: Axis, axis: Axis, quarterTurns: number): Axis {
  const k = ((quarterTurns % 4) + 4) % 4;
  if (cellAxis === axis || k % 2 === 0) return cellAxis;
  return AXES.find((a) => a !== axis && a !== cellAxis)!;
}

/**
 * Rotate a part by quarterTurns × 90° about the line through integer point `pivot` parallel to
 * `axis` (right-hand rule). Cell axes rotate too; a cell at the pivot stays in place. null if the
 * result would be invalid. Throws if the part is missing or the pivot is not integral.
 */
export function rotatePart(m: Model, partId: number, axis: Axis, quarterTurns: number, pivot: Vec3i): Model | null {
  const part = requirePart(m, partId);
  if (!isAxis(axis)) throw new Error(`rotatePart: bad axis ${JSON.stringify(axis)}`);
  if (!Number.isSafeInteger(quarterTurns)) throw new Error(`rotatePart: quarterTurns must be an integer`);
  if (!isIntVec(pivot)) throw new Error(`rotatePart: pivot must be three integers (got ${JSON.stringify(pivot)})`);
  const k = ((quarterTurns % 4) + 4) % 4;
  if (k === 0) return m;
  const [px, py, pz] = pivot;
  const cells = part.cells.map((c) => {
    const [x, y, z] = rotateVec([c.x - px, c.y - py, c.z - pz], axis, k);
    return makeCell(x + px, y + py, z + pz, c.kind, rotateAxis(c.axis, axis, k));
  });
  return withPartCells(m, part, cells);
}

/** Set a part's colour ('#rrggbb', stored lower-case). Throws on a bad colour or missing part. */
export function setPartColor(m: Model, partId: number, color: string): Model {
  const part = requirePart(m, partId);
  if (typeof color !== 'string' || !HEX_COLOR.test(color)) {
    throw new Error(`invalid colour ${JSON.stringify(color)} (expected '#rrggbb')`);
  }
  const c = color.toLowerCase();
  if (c === part.color) return m;
  return { ...m, parts: replacePart(m, partId, [{ ...part, color: c }]) };
}

/** Designate the root (fixed) part; null clears it (lowest id is then the root). Throws if missing. */
export function setRoot(m: Model, partId: number | null): Model {
  if (partId !== null) requirePart(m, partId);
  if (m.rootPartId === partId) return m;
  return { ...m, rootPartId: partId };
}

// ---------------------------------------------------------------------------------------------
// Serialisation (.knap.json)

/** Deterministic JSON: one cell per line. */
export function serialize(m: Model): string {
  const cell = (c: Cell) =>
    `{"x":${c.x},"y":${c.y},"z":${c.z},"kind":${JSON.stringify(c.kind)},"axis":${c.axis}}`;
  const part = (p: Part) =>
    [
      '    {',
      `      "id": ${p.id},`,
      `      "color": ${JSON.stringify(p.color)},`,
      p.cells.length
        ? `      "cells": [\n${p.cells.map((c) => `        ${cell(c)}`).join(',\n')}\n      ]`
        : '      "cells": []',
      '    }',
    ].join('\n');
  return [
    '{',
    `  "version": ${m.version},`,
    `  "rootPartId": ${m.rootPartId === null ? 'null' : m.rootPartId},`,
    `  "nextPartId": ${m.nextPartId},`,
    m.parts.length ? `  "parts": [\n${m.parts.map(part).join(',\n')}\n  ]` : '  "parts": []',
    '}',
    '',
  ].join('\n');
}

/** Error thrown by deserialize; `errors` lists every problem found. */
export class ModelFormatError extends Error {
  readonly errors: ValidationError[];
  constructor(message: string, errors: ValidationError[]) {
    super(message);
    this.name = 'ModelFormatError';
    this.errors = errors;
  }
}

const MAX_LISTED = 10;

/**
 * Parse and validate a .knap.json string. Unknown fields are dropped; a missing rootPartId is
 * treated as null and a missing nextPartId as (max part id + 1). Throws ModelFormatError with a
 * readable message listing the problems.
 */
export function deserialize(json: string): Model {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new ModelFormatError(`Not a knap model: invalid JSON (${msg})`, [{ code: 'structure', message: `invalid JSON: ${msg}` }]);
  }
  const fail = (errs: ValidationError[]): never => {
    const lines = errs.slice(0, MAX_LISTED).map((e) => `  - ${e.message}`);
    if (errs.length > MAX_LISTED) lines.push(`  … and ${errs.length - MAX_LISTED} more`);
    throw new ModelFormatError(`Invalid knap model (${errs.length} problem${errs.length === 1 ? '' : 's'}):\n${lines.join('\n')}`, errs);
  };
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return fail([{ code: 'structure', message: 'expected a JSON object with version, parts, rootPartId, nextPartId' }]);
  }
  const o = raw as Record<string, unknown>;
  if (o.version !== 1) {
    return fail([{ code: 'structure', message: `unsupported version ${JSON.stringify(o.version)} (expected 1)` }]);
  }
  const candidate = {
    version: 1,
    parts: o.parts,
    rootPartId: o.rootPartId === undefined ? null : o.rootPartId,
    nextPartId: o.nextPartId,
  } as unknown as Model;
  if (o.nextPartId === undefined && Array.isArray(o.parts)) {
    const ids = (o.parts as unknown[])
      .map((p) => (typeof p === 'object' && p !== null ? (p as Record<string, unknown>).id : undefined))
      .filter((id): id is number => typeof id === 'number' && Number.isFinite(id));
    // A loop, not Math.max(...ids): spreading 150 000 ids overflows the call stack.
    let max = -Infinity;
    for (const id of ids) if (id > max) max = id;
    (candidate as { nextPartId: number }).nextPartId = ids.length ? max + 1 : 1;
  }
  const errs = validateModel(candidate);
  if (errs.length) return fail(errs);
  // Rebuild with known fields only.
  const model: Model = {
    version: 1,
    rootPartId: candidate.rootPartId,
    nextPartId: candidate.nextPartId,
    parts: candidate.parts.map((p) => ({
      id: p.id,
      color: p.color.toLowerCase(),
      cells: p.cells.map((c) => makeCell(c.x, c.y, c.z, c.kind, c.axis)),
    })),
  };
  return model;
}
