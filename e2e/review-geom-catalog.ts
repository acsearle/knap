// Review-only catalogue: configurations the geometry gallery does not cover.
import { makeCell } from '../src/core';
import type { Axis, Cell, Kind } from '../src/core';
import type { CatalogEntry } from './geom-catalog';

const c = (x: number, y: number, z: number, kind: Kind, axis: Axis): Cell => makeCell(x, y, z, kind, axis);
const P = (name: string, color: string, cells: Cell[]): CatalogEntry => ({ name, part: { id: 1, color, cells } });

export const CATALOG: CatalogEntry[] = [
  P('2×2×2 block', '#d6302b', [0, 1].flatMap((x) => [0, 1].flatMap((y) => [0, 1].map((z) => c(x, y, z, 'pinHole', 2))))),
  P('2×2, one X cell', '#f2c200', [c(0, 0, 0, 'pinHole', 2), c(1, 0, 0, 'pinHole', 0), c(0, 1, 0, 'pinHole', 2), c(1, 1, 0, 'pinHole', 2)]),
  P('2×2: X tube + Z holes', '#3a9a4a', [c(0, 0, 0, 'pinHole', 0), c(1, 0, 0, 'pinHole', 0), c(0, 1, 0, 'pinHole', 2), c(1, 1, 0, 'axleHole', 2)]),
  P('3-axis corner cluster', '#7a7f85', [c(0, 0, 0, 'pinHole', 0), c(1, 0, 0, 'axleHole', 1), c(0, 1, 0, 'pinHole', 2), c(0, 0, 1, 'axleHole', 1), c(1, 1, 0, 'pinHole', 0)]),
  P('rods on 4 walls', '#2a6fdb', [c(0, 0, 0, 'pinHole', 2), c(1, 0, 0, 'axle', 0), c(-1, 0, 0, 'axle', 0), c(0, 1, 0, 'pin', 1), c(0, -1, 0, 'frictionPin', 1)]),
  P('end↔ring loop', '#c8b48a', [c(0, 0, 0, 'pinHole', 2), c(0, 0, 1, 'pin', 2), c(0, 0, 2, 'pinHole', 0), c(1, 0, 2, 'pinHole', 0), c(1, 0, 1, 'pinHole', 2), c(1, 0, 0, 'pinHole', 2)]),
  P('pin hole → axle hole tube', '#7a7f85', [c(0, 0, 0, 'pinHole', 0), c(1, 0, 0, 'axleHole', 0)]),
  P('Z,X,Z row (sealed)', '#3a9a4a', [c(-1, 0, 0, 'pinHole', 2), c(0, 0, 0, 'pinHole', 0), c(1, 0, 0, 'pinHole', 2)]),
  P('15-hole liftarm', '#d6302b', Array.from({ length: 15 }, (_, i) => c(i, 0, 0, 'pinHole', 2))),
  P('thick L (3D path)', '#f2c200', [c(0, 0, 0, 'pinHole', 2), c(1, 0, 0, 'pinHole', 2), c(2, 0, 0, 'pinHole', 2), c(0, 0, 1, 'pinHole', 2), c(0, 1, 1, 'pinHole', 2), c(0, 2, 1, 'pinHole', 2)]),
  P('liftarm, axle hole middle, tube end', '#2a6fdb', [c(0, 0, 0, 'pinHole', 2), c(1, 0, 0, 'axleHole', 2), c(2, 0, 0, 'pinHole', 2), c(2, 0, 1, 'pinHole', 2)]),
  P('axle through wall stack', '#a0a5a9', [c(0, 0, 0, 'axleHole', 0), c(0, 1, 0, 'axle', 1), c(0, 2, 0, 'axle', 1), c(0, 3, 0, 'axleHole', 2), c(1, 3, 0, 'pinHole', 2)]),
];
