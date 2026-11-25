import { describe, expect, it } from 'vitest';
import { partById, validateModel } from '../../src/core';
import type { Vec3i } from '../../src/core';
import {
  deleteSelection,
  duplicateOffsets,
  duplicateSelection,
  moveDelta,
  moveKeyOf,
  moveSelection,
  partInfo,
  rotateSelection,
  screenAxes,
  viewRotation,
} from '../../src/editor';
import type { CameraBasis, MoveKey, Vec3 } from '../../src/editor';
import { c, modelOf } from './helpers';

const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

/** Turntable camera (§6.2): yaw about +Y, pitch in [−90°, 90°]; looks at the origin from `eye` direction. */
function turntable(yawDeg: number, pitchDeg: number): CameraBasis {
  const y = (yawDeg * Math.PI) / 180;
  const p = (pitchDeg * Math.PI) / 180;
  // eye direction (from target to eye)
  const back: Vec3 = [Math.cos(p) * Math.sin(y), Math.sin(p), Math.cos(p) * Math.cos(y)];
  const forward: Vec3 = [-back[0], -back[1], -back[2]];
  const right: Vec3 = [Math.cos(y), 0, -Math.sin(y)];
  // right × up must equal −forward (= back): screen x × screen y points at the viewer
  const u = cross(back, right);
  return { right, up: u, forward };
}

const cams: [string, CameraBasis][] = [];
for (let yaw = -180; yaw < 180; yaw += 15) for (let pitch = -90; pitch <= 90; pitch += 15) cams.push([`yaw ${yaw} pitch ${pitch}`, turntable(yaw, pitch)]);
// plus near-ties
cams.push(['iso +X+Y+Z', turntable(45, 35.264389682754654)]);
cams.push(['iso jitter', turntable(45 + 1e-9, 35.264389682754654 - 1e-9)]);
cams.push(['45° exact', turntable(45, 45)]);

describe('camera helper sanity', () => {
  it('right × up = −forward, orthonormal', () => {
    for (const [, cam] of cams) {
      const x = cross(cam.right, cam.up);
      for (let i = 0; i < 3; i++) expect(x[i]).toBeCloseTo(-cam.forward[i]!, 9);
      expect(dot(cam.right, cam.up)).toBeCloseTo(0, 9);
    }
  });
});

describe('screen-aligned move', () => {
  const keys: MoveKey[] = ['left', 'right', 'up', 'down', 'pageUp', 'pageDown'];

  it.each(cams)('%s: unit deltas on three distinct axes, opposite keys opposite, signs follow the screen', (_n, cam) => {
    const d = Object.fromEntries(keys.map((k) => [k, moveDelta(cam, k)])) as Record<MoveKey, Vec3i>;
    const axisOf = (v: Vec3i) => v.findIndex((x) => x !== 0);
    for (const k of keys) {
      expect(d[k].filter((x) => x !== 0).length).toBe(1);
      expect(Math.abs(d[k][axisOf(d[k])]!)).toBe(1);
    }
    expect(new Set([axisOf(d.right), axisOf(d.up), axisOf(d.pageUp)]).size).toBe(3);
    for (const [a, b] of [['left', 'right'], ['down', 'up'], ['pageDown', 'pageUp']] as const) {
      expect(d[a].map((x) => -x + 0)).toEqual([...d[b]]);
    }
    expect(dot(d.right, cam.right)).toBeGreaterThanOrEqual(0);
    expect(dot(d.up, cam.up)).toBeGreaterThanOrEqual(0);
    expect(dot(d.pageUp, cam.forward)).toBeLessThanOrEqual(1e-6); // toward the viewer
    // the axis taken first is the screen direction's dominant world axis
    const s = screenAxes(cam);
    const dom = (v: Vec3) => Math.max(...v.map(Math.abs));
    if (dom(cam.up) + 1e-6 >= dom(cam.right)) expect(Math.abs(cam.up[s.up.axis])).toBeCloseTo(dom(cam.up), 5);
    else expect(Math.abs(cam.right[s.right.axis])).toBeCloseTo(dom(cam.right), 5);
  });

  it('snapped views', () => {
    const front: CameraBasis = { right: [1, 0, 0], up: [0, 1, 0], forward: [0, 0, -1] };
    expect(moveDelta(front, 'right')).toEqual([1, 0, 0]);
    expect(moveDelta(front, 'up')).toEqual([0, 1, 0]);
    expect(moveDelta(front, 'pageUp')).toEqual([0, 0, 1]);
    const top: CameraBasis = { right: [1, 0, 0], up: [0, 0, -1], forward: [0, -1, 0] };
    expect(moveDelta(top, 'up')).toEqual([0, 0, -1]);
    expect(moveDelta(top, 'pageUp')).toEqual([0, 1, 0]);
    const bottom: CameraBasis = { right: [1, 0, 0], up: [0, 0, 1], forward: [0, 1, 0] };
    expect(moveDelta(bottom, 'pageUp')).toEqual([0, -1, 0]);
    const leftView: CameraBasis = { right: [0, 0, 1], up: [0, 1, 0], forward: [1, 0, 0] };
    expect(moveDelta(leftView, 'right')).toEqual([0, 0, 1]);
    expect(moveDelta(leftView, 'pageDown')).toEqual([1, 0, 0]);
  });

  it('default isometric view: ↑ = +Y, → = +X (tie X/Z → X), PageUp = +Z', () => {
    const iso = turntable(45, 35.264389682754654);
    expect(moveDelta(iso, 'up')).toEqual([0, 1, 0]);
    expect(moveDelta(iso, 'right')).toEqual([1, 0, 0]);
    expect(moveDelta(iso, 'pageUp')).toEqual([0, 0, 1]);
    // deterministic under tiny jitter around the tie
    expect(moveDelta(turntable(45 + 1e-9, 35.26), 'right')).toEqual([1, 0, 0]);
    expect(moveDelta(turntable(45 - 1e-9, 35.26), 'right')).toEqual([1, 0, 0]);
  });

  it('moveKeyOf', () => {
    expect(moveKeyOf('ArrowLeft')).toBe('left');
    expect(moveKeyOf('PageDown')).toBe('pageDown');
    expect(moveKeyOf('a')).toBeNull();
  });

  it('moveSelection: success and rejection with a reason', () => {
    const m = modelOf([c(0, 0, 0, 'pinHole', 2), c(1, 0, 0, 'pinHole', 2)], [c(3, 0, 0, 'pinHole', 2)]);
    const ok = moveSelection(m, 1, [0, 1, 0]);
    expect(ok.ok).toBe(true);
    if (ok.ok) {
      expect(partById(ok.model, 1)!.cells[0]).toEqual(c(0, 1, 0, 'pinHole', 2));
      expect(ok.message).toBe('Moved part 1 +Y');
      expect(ok.partId).toBe(1);
    }
    const bad = moveSelection(m, 1, [2, 0, 0]);
    expect(bad.ok).toBe(false);
    expect(bad.message).toBe("Can't move part 1 +2X: (3, 0, 0): two holes cannot share a cell (part 2 has a pin hole there)");
    expect(moveSelection(m, 9, [1, 0, 0]).ok).toBe(false);
  });
});

describe('view rotation', () => {
  // L-shaped part: pivot (0,0,0), arm to (1,0,0),(1,1,0) and (0,0,1)
  const m = modelOf([c(0, 0, 0, 'pinHole', 2), c(1, 0, 0, 'pinHole', 2), c(0, 1, 0, 'pinHole', 2), c(0, 0, 1, 'pinHole', 1)]);

  it.each(cams)("%s: ']' turns clockwise on screen about the view-dominant axis, '[' undoes it", (_n, cam) => {
    const { axis, quarterTurns } = viewRotation(cam, ']');
    expect(Math.abs(cam.forward[axis])).toBeCloseTo(Math.max(...cam.forward.map(Math.abs)), 6);
    expect(quarterTurns * cam.forward[axis]).toBeGreaterThan(0);
    const r = rotateSelection(m, 1, cam, ']');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(validateModel(r.model)).toEqual([]);
    // Clockwise as seen: for every cell offset v ⟂ axis, the screen projection turns clockwise
    // (2D cross product of before × after < 0).
    const before = partById(m, 1)!.cells;
    const after = partById(r.model, 1)!.cells;
    expect([after[0]!.x, after[0]!.y, after[0]!.z]).toEqual([before[0]!.x, before[0]!.y, before[0]!.z]); // pivot on the first cell
    for (let i = 1; i < before.length; i++) {
      const b: Vec3 = [before[i]!.x, before[i]!.y, before[i]!.z];
      const a: Vec3 = [after[i]!.x, after[i]!.y, after[i]!.z];
      if (b[axis] !== 0) continue; // along the axis: unchanged
      const pb = [dot(b, cam.right), dot(b, cam.up)] as const;
      const pa = [dot(a, cam.right), dot(a, cam.up)] as const;
      const z = pb[0] * pa[1] - pb[1] * pa[0];
      expect(z).toBeLessThan(0);
    }
    const back = rotateSelection(r.model, 1, cam, '[');
    expect(back.ok && partById(back.model, 1)!.cells).toEqual(before);
  });

  it('isometric (all equal): Y preferred; rejected rotation has a message', () => {
    expect(viewRotation(turntable(45, 35.264389682754654), ']').axis).toBe(1);
    const blocked = modelOf([c(0, 0, 0, 'pinHole', 2), c(1, 0, 0, 'pinHole', 2)], [c(0, -1, 0, 'pinHole', 2)]);
    const front: CameraBasis = { right: [1, 0, 0], up: [0, 1, 0], forward: [0, 0, -1] };
    const r = rotateSelection(blocked, 1, front, ']'); // clockwise: (1,0,0) -> (0,-1,0): occupied
    expect(r.ok).toBe(false);
    expect(r.ok || r.message).toBe("Can't rotate part 1 about Z: (0, -1, 0): two holes cannot share a cell (part 2 has a pin hole there)");
    expect(rotateSelection(blocked, 1, front, '[').ok).toBe(true);
  });
});

describe('duplicate / delete / info', () => {
  it('nearest free offset, deterministic order', () => {
    const offs = duplicateOffsets(1);
    expect(offs.slice(0, 6)).toEqual([[1, 0, 0], [0, 0, 1], [0, 0, -1], [-1, 0, 0], [0, 1, 0], [0, -1, 0]]);
    expect(offs.length).toBe(26);
    const m = modelOf([c(0, 0, 0, 'pinHole', 2), c(1, 0, 0, 'pinHole', 2)]);
    const r = duplicateSelection(m, 1);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // +X by 1 overlaps itself; +Z is free
    expect(partById(r.model, r.partId!)!.cells.map((x) => [x.x, x.y, x.z])).toEqual([[0, 0, 1], [1, 0, 1]]);
    expect(partById(r.model, r.partId!)!.color).toBe(partById(m, 1)!.color);
    expect(r.message).toBe('Duplicated part 1 as part 2 (offset +Z)');
    expect(validateModel(r.model)).toEqual([]);
  });

  it('never lands on an occupied cell, even a compatible one', () => {
    const m = modelOf([c(0, 0, 0, 'pin', 2)], [c(1, 0, 0, 'pinHole', 2)]);
    const r = duplicateSelection(m, 1);
    expect(r.ok && partById(r.model, r.partId!)!.cells[0]).toEqual(c(0, 0, 1, 'pin', 2));
  });

  it('fails when no free offset within the radius', () => {
    const cells = [];
    for (let x = -1; x <= 1; x++) for (let y = -1; y <= 1; y++) for (let z = -1; z <= 1; z++) cells.push(c(x, y, z, 'pinHole', 2));
    const m = modelOf(cells.filter((q) => q.x || q.y || q.z), [c(0, 0, 0, 'pinHole', 2)]);
    // part 1 is a 26-cell shell with a 1-cell part 2 in its centre: any shift of part 2 by ≤ 1 hits the shell
    const r = duplicateSelection(m, 2, 1);
    expect(r).toEqual({ ok: false, message: "Can't duplicate part 2: no free space within 1 cells" });
    expect(duplicateSelection(m, 2, 2).ok).toBe(true);
  });

  it('delete and info', () => {
    const m = modelOf([c(0, 0, 0, 'pinHole', 2)], [c(0, 0, 0, 'pin', 2), c(0, 0, 1, 'pin', 2)]);
    const d = deleteSelection(m, 1);
    expect(d.ok && d.model.parts.map((p) => p.id)).toEqual([2]);
    expect(d.ok && d.message).toBe('Deleted part 1');
    expect(deleteSelection(m, 5).ok).toBe(false);
    expect(partInfo(m, 2, 1)).toEqual({ id: 2, cellCount: 2, color: partById(m, 2)!.color, isRoot: false, kinds: { pin: 2 } });
    expect(partInfo(m, 1, 1)!.isRoot).toBe(true);
    expect(partInfo(m, 3, 1)).toBeNull();
  });
});

describe('refused rotation reason (review fix)', () => {
  it('states the §2.3 conflict, not a generic "collide"', () => {
    const m = modelOf([c(0, 0, 0, 'pinHole', 2), c(1, 0, 0, 'pinHole', 2)], [c(0, 0, 0, 'pin', 2), c(0, 0, 1, 'pin', 2)]);
    const top: CameraBasis = { right: [1, 0, 0], up: [0, 0, -1], forward: [0, -1, 0] };
    const r = rotateSelection(m, 1, top, ']');
    expect(r.ok).toBe(false);
    expect(r.ok || r.message).toMatch(/^Can't rotate part 1 about Y: \(0, 0, 0\): .*coaxial.* \(part 2 has a pin there\)$/);
  });
});
