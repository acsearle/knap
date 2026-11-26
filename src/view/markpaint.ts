// Painting the wheels' index mark (DESIGN.md §4.2, §6.1 "Wheels"). The mark is cut into the render
// mesh as a shallow rectangular groove (src/geometry/solid.ts zmarkCutters), whose walls the outline
// pass draws as lines. On dark parts those dark lines on a dark face are faint, and at a small
// on-screen size the two walls merge, so the view also *paints* the groove in a contrasting colour
// (lighter on dark parts, darker on light ones): it then reads as a stripe at any zoom, from either
// side and edge-on (the tread groove).
//
// markWeights() tags the vertices of the groove's surfaces in a part's mesh, using the RimMark
// records (part-local frame, the mesh's own frame). The mesh splits vertices at creases (≥ 35°), so
// the groove's floors and walls have their own vertices, separate from the face and tread vertices
// along the groove's edge; a vertex is tagged only if its position *and normal* match a groove
// surface:
//   - face floor: normal ∥ the axis, at |axial| = H − depth, radially from r0 on, within the width;
//   - tread floor: normal ∥ +dir at s = r1 − depth, within the width;
//   - side walls: normal ∥ the tangential axis at |t| = width/2, inside the groove's extent;
//   - end wall: normal ∥ −dir at s = r0, within the width.
//   - a gear's face groove (RimMark.gear, §4.2): also its inner end wall (normal +dir at s = r0)
//     and its outer end wall (normal −dir at s = r1, the groove stops inside the root circle).
//     (On a plain wheel the inner end wall's normal is +dir too, so the test above never matches
//     it and that small wall stays unpainted; left as it was so wheels draw exactly as before.)
// A mark the geometry left out (covered by other material of the part) has no such vertices, so
// nothing is painted there either. Pure (no three.js): unit-tested in tests/view.
import type { Part } from '../core';
import { H, rimMarks } from '../geometry';

const TOL = 2e-3;

/** Per-vertex weights (1 = on the index-mark groove, 0 = elsewhere) for a part's mesh. */
export function markWeights(part: Part, positions: Float32Array, normals: Float32Array): Float32Array {
  const n = positions.length / 3;
  const out = new Float32Array(n);
  const marks = rimMarks(part);
  if (!marks.length) return out;
  for (const mk of marks) {
    const a = mk.axis;
    const sAx = mk.dir[0] !== 0 ? 0 : mk.dir[1] !== 0 ? 1 : 2;
    const sSign = mk.dir[sAx]! > 0 ? 1 : -1;
    const k = 3 - a - sAx;
    const hw = mk.width / 2;
    const floorAx = H - mk.depth;
    const treadFloor = mk.r1 - mk.depth;
    const reach = mk.r1 + 0.05;
    for (let i = 0; i < n; i++) {
      if (out[i] === 1) continue;
      const q = [positions[3 * i]! - mk.center[0], positions[3 * i + 1]! - mk.center[1], positions[3 * i + 2]! - mk.center[2]];
      const s = q[sAx]! * sSign;
      const t = q[k]!;
      const ax = q[a]!;
      if (s < mk.r0 - TOL || s > reach || Math.abs(t) > hw + TOL || Math.abs(ax) > H + 0.02) continue;
      const na = normals[3 * i + a]!;
      const ns = normals[3 * i + sAx]! * sSign;
      const nk = normals[3 * i + k]!;
      const inFace = Math.abs(ax) >= floorAx - TOL;
      const inTread = mk.tread && s >= treadFloor - TOL;
      let on = false;
      if (Math.abs(na) > 0.9) on = Math.abs(Math.abs(ax) - floorAx) < TOL && inFace;
      else if (ns > 0.9) on = (inTread && Math.abs(s - treadFloor) < TOL) || (!!mk.gear && Math.abs(s - mk.r0) < TOL && inFace);
      else if (ns < -0.9) on = (Math.abs(s - mk.r0) < TOL || (!!mk.gear && Math.abs(s - mk.r1) < TOL)) && inFace;
      else if (Math.abs(nk) > 0.9) on = Math.abs(Math.abs(t) - hw) < TOL && (inFace || inTread);
      if (on) out[i] = 1;
    }
  }
  return out;
}

/**
 * The mark's paint for a part colour ('#rrggbb'): a lighter shade on dark colours, a darker one on
 * light colours (by luma), so it contrasts with the face around it.
 */
export function markColor(hex: string): string {
  const v = parseInt(hex.slice(1), 16);
  const r = (v >> 16) & 255;
  const g = (v >> 8) & 255;
  const b = v & 255;
  const luma = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  const mix = (c: number, to: number, f: number) => Math.round(c + (to - c) * f);
  const [to, f] = luma > 0.5 ? [0, 0.42] : [255, 0.6];
  const h = (c: number) => mix(c, to, f).toString(16).padStart(2, '0');
  return `#${h(r)}${h(g)}${h(b)}`;
}
