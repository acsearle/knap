import { DIRS, addPart, emptyModel, makeCell } from '../../src/core';
import type { Axis, Cell, Dir, Kind, Model, Vec3i } from '../../src/core';
import type { Ray } from '../../src/editor';

/** The two axes other than `a`, ascending. */
export function tangents(a: Axis): [Axis, Axis] {
  return ([0, 1, 2] as Axis[]).filter((x) => x !== a) as [Axis, Axis];
}

/**
 * A ray entering face `dir` of the cell at `pos`, at tangential offsets (u, v) from the face
 * centre (u along the lower tangent axis, v along the higher), starting `dist` in front of it.
 */
export function faceRay(pos: Vec3i, dir: Dir, u = 0, v = 0, dist = 0.7): Ray {
  const n = DIRS[dir]!;
  const a = (dir >> 1) as Axis;
  const [ta, tb] = tangents(a);
  const o: [number, number, number] = [pos[0] + n[0] * (0.5 + dist), pos[1] + n[1] * (0.5 + dist), pos[2] + n[2] * (0.5 + dist)];
  o[ta] += u;
  o[tb] += v;
  return { origin: o, dir: [-n[0], -n[1], -n[2]] };
}

export function c(x: number, y: number, z: number, kind: Kind, axis: Axis): Cell {
  return makeCell(x, y, z, kind, axis);
}

/** Build a model from part cell lists (ids 1, 2, …). */
export function modelOf(...parts: Cell[][]): Model {
  let m = emptyModel();
  for (const cells of parts) m = addPart(m, cells).model;
  return m;
}
