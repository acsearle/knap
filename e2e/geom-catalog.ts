// Catalogue of representative parts for the geometry gallery (e2e/geom-gallery.*) and the
// geometry tests. Pure data built with the core API.
import { makeCell } from '../src/core';
import type { Axis, Cell, Kind, Part } from '../src/core';

const c = (x: number, y: number, z: number, kind: Kind, axis: Axis): Cell => makeCell(x, y, z, kind, axis);

export interface CatalogEntry {
  name: string;
  part: Part;
}

const P = (name: string, color: string, cells: Cell[]): CatalogEntry => ({ name, part: { id: 1, color, cells } });

const row = (n: number, kind: Kind, axis: Axis, dir: 0 | 1 | 2 = 0, y = 0): Cell[] =>
  Array.from({ length: n }, (_, i) => c(dir === 0 ? i : 0, y + (dir === 1 ? i : 0), dir === 2 ? i : 0, kind, axis));

export const CATALOG: CatalogEntry[] = [
  P('pin hole', '#f2c200', [c(0, 0, 0, 'pinHole', 2)]),
  P('axle hole', '#f2c200', [c(0, 0, 0, 'axleHole', 2)]),
  P('axle', '#a0a5a9', [c(0, 0, 0, 'axle', 0)]),
  P('pin', '#c8b48a', [c(0, 0, 0, 'pin', 0)]),
  P('friction pin', '#2a6fdb', [c(0, 0, 0, 'frictionPin', 0)]),
  P('5-hole liftarm', '#d6302b', row(5, 'pinHole', 2)),
  P('L liftarm', '#3a9a4a', [...row(4, 'pinHole', 2), c(0, 1, 0, 'pinHole', 2), c(0, 2, 0, 'pinHole', 2)]),
  P('T liftarm', '#3a9a4a', [...row(5, 'pinHole', 2), c(2, 1, 0, 'pinHole', 2), c(2, 2, 0, 'pinHole', 2)]),
  P('2×2 block', '#d6302b', [c(0, 0, 0, 'pinHole', 2), c(1, 0, 0, 'pinHole', 2), c(0, 1, 0, 'pinHole', 2), c(1, 1, 0, 'pinHole', 2)]),
  P('double-thick beam', '#f2c200', [
    ...Array.from({ length: 3 }, (_, i) => c(i, 0, 0, 'pinHole', 2)),
    ...Array.from({ length: 3 }, (_, i) => c(i, 0, 1, 'pinHole', 2)),
  ]),
  P('perp. connector ring↔wall', '#7a7f85', [c(0, 0, 0, 'pinHole', 0), c(1, 0, 0, 'pinHole', 1)]),
  P('perp. connector wall↔wall', '#7a7f85', [c(0, 0, 0, 'pinHole', 2), c(1, 0, 0, 'pinHole', 1)]),
  P('tube (2 coaxial)', '#2a6fdb', [c(0, 0, 0, 'pinHole', 0), c(1, 0, 0, 'pinHole', 0)]),
  P('4-long axle', '#a0a5a9', row(4, 'axle', 0)),
  P('2-long pin', '#c8b48a', row(2, 'pin', 0)),
  P('2-long friction pin', '#2a6fdb', row(2, 'frictionPin', 0)),
  P('axle-pin', '#c8b48a', [c(0, 0, 0, 'axle', 0), c(1, 0, 0, 'pin', 0)]),
  P('liftarm + side pin', '#d6302b', [...row(3, 'pinHole', 2), c(1, 1, 0, 'pin', 1)]),
  P('axle hole + pin hole coaxial', '#7a7f85', [c(0, 0, 0, 'axleHole', 0), c(1, 0, 0, 'pinHole', 0)]),
  P('blind hole (T of holes)', '#3a9a4a', [c(0, 0, 0, 'pinHole', 1), c(0, 1, 0, 'pinHole', 0), c(-1, 1, 0, 'pinHole', 0), c(1, 1, 0, 'pinHole', 0)]),
  P('axle hole liftarm', '#f2c200', [c(0, 0, 0, 'axleHole', 2), c(1, 0, 0, 'pinHole', 2), c(2, 0, 0, 'axleHole', 2)]),
  P('3-axis hub', '#7a7f85', [c(0, 0, 0, 'axleHole', 2), c(1, 0, 0, 'axle', 0), c(0, 1, 0, 'pin', 1), c(-1, 0, 0, 'pinHole', 1)]),
  P('rods on 4 walls', '#2a6fdb', [c(0, 0, 0, 'pinHole', 2), c(1, 0, 0, 'axle', 0), c(-1, 0, 0, 'axle', 0), c(0, 1, 0, 'pin', 1), c(0, -1, 0, 'frictionPin', 1)]),
  P('hole blind at both ends', '#3a9a4a', [c(-1, 0, 0, 'pinHole', 2), c(0, 0, 0, 'pinHole', 0), c(1, 0, 0, 'pinHole', 2)]),
];
