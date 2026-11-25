// Prints, for each wheel radius, the cells of the wheel's own layer it fully / partly covers (hub excluded).
import { coveredOffsets, discCell } from './disc';
const fmtList = (l: [number, number][]) => {
  const q = l.filter(([u, v]) => u >= 0 && v >= 0 && u >= v); // one octant; the rest by symmetry
  return q.map(([u, v]) => `(${u},${v})`).join(' ');
};
console.log('r\thub\t#full\t#partial\tfull (octant u≥v≥0)\tpartial (octant)\ttouch (octant)');
for (const r of [0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4]) {
  const c = coveredOffsets(r);
  const touch: [number, number][] = [];
  for (let u = 0; u <= 5; u++) for (let v = 0; v <= u; v++) if (discCell({ c: [0, 0, 0], axis: 2, r }, [u, v, 0]) === 'touch') touch.push([u, v]);
  console.log([r, discCell({ c: [0, 0, 0], axis: 2, r }, [0, 0, 0]), c.full.length, c.partial.length, fmtList(c.full), fmtList(c.partial), fmtList(touch)].join('\t'));
}
