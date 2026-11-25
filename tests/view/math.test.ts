import { describe, expect, it } from 'vitest';
import {
  ISO_PITCH,
  MAX_HEIGHT,
  MIN_HEIGHT,
  VIEW_DIRS,
  VIEW_NAMES,
  cameraBasis,
  cameraNear,
  cross,
  defaultCamera,
  dot,
  easeInOut,
  fitBox,
  fitPoints,
  interpolateCamera,
  len,
  nearestQuarterYaw,
  ndcToPixel,
  normalizeCamera,
  orbit,
  orientationForDir,
  pan,
  parseViewName,
  pickRay,
  pixelToNdc,
  projectPoint,
  sub,
  unionBoxes,
  viewName,
  wrapAngle,
  zoomAt,
} from '../../src/view/math';
import type { CameraState, Vec3 } from '../../src/view/math';

const close3 = (a: readonly number[], b: readonly number[], eps = 1e-9): void => {
  for (let i = 0; i < 3; i++) expect(a[i]).toBeCloseTo(b[i]!, -Math.log10(eps));
};
const norm = (v: readonly number[]): Vec3 => {
  const l = Math.hypot(v[0]!, v[1]!, v[2]!);
  return [v[0]! / l, v[1]! / l, v[2]! / l];
};

describe('camera basis', () => {
  it('is right-handed and orthonormal for many orientations, including the poles', () => {
    for (const yaw of [-3, -1.2, 0, 0.4, Math.PI / 2, 2.9])
      for (const pitch of [-Math.PI / 2, -1, -0.2, 0, 0.6, Math.PI / 2]) {
        const { right, up, back } = cameraBasis(yaw, pitch);
        for (const v of [right, up, back]) expect(len(v)).toBeCloseTo(1, 12);
        expect(dot(right, up)).toBeCloseTo(0, 12);
        expect(dot(up, back)).toBeCloseTo(0, 12);
        expect(dot(right, back)).toBeCloseTo(0, 12);
        close3(cross(right, up), back, 1e-12);
        // turntable: right stays horizontal, up never points down
        expect(right[1]).toBeCloseTo(0, 12);
        expect(up[1]).toBeGreaterThanOrEqual(-1e-12);
      }
  });

  it('gives the expected basis for the six face views', () => {
    const cases: [string, Vec3, Vec3, Vec3][] = [
      // name, back (toward camera), screen right, screen up
      ['front', [0, 0, 1], [1, 0, 0], [0, 1, 0]],
      ['back', [0, 0, -1], [-1, 0, 0], [0, 1, 0]],
      ['right', [1, 0, 0], [0, 0, -1], [0, 1, 0]],
      ['left', [-1, 0, 0], [0, 0, 1], [0, 1, 0]],
      ['top', [0, 1, 0], [1, 0, 0], [0, 0, -1]],
      ['bottom', [0, -1, 0], [1, 0, 0], [0, 0, 1]],
    ];
    for (const [name, back, right, up] of cases) {
      const { yaw, pitch } = orientationForDir(parseViewName(name)!);
      const b = cameraBasis(yaw, pitch);
      close3(b.back, back, 1e-12);
      close3(b.right, right, 1e-12);
      close3(b.up, up, 1e-12);
    }
  });

  it('looks along every one of the 26 cube directions', () => {
    expect(VIEW_DIRS).toHaveLength(26);
    expect(new Set(VIEW_NAMES).size).toBe(26);
    for (const d of VIEW_DIRS) {
      const o = orientationForDir(d);
      close3(cameraBasis(o.yaw, o.pitch).back, norm(d), 1e-12);
    }
  });

  it('isometric corner view has the classic elevation', () => {
    const o = orientationForDir([1, 1, 1]);
    expect(o.pitch).toBeCloseTo(ISO_PITCH, 12);
    expect((ISO_PITCH * 180) / Math.PI).toBeCloseTo(35.264, 3);
    expect(o.yaw).toBeCloseTo(Math.PI / 4, 12);
    const d = defaultCamera();
    expect(d.pitch).toBeCloseTo(ISO_PITCH, 12);
    expect(d.yaw).toBeCloseTo(Math.PI / 4, 12);
  });

  it('vertical views keep the fallback yaw (quarter-turn rounding)', () => {
    expect(orientationForDir([0, 1, 0], 1.0).yaw).toBe(1.0);
    expect(nearestQuarterYaw(0.9)).toBeCloseTo(Math.PI / 2, 12);
    expect(nearestQuarterYaw(-0.9)).toBeCloseTo(-Math.PI / 2, 12);
    expect(nearestQuarterYaw(3.0)).toBeCloseTo(Math.PI, 12);
    expect(nearestQuarterYaw(0.2)).toBe(0);
  });
});

describe('view names', () => {
  it('round-trips all 26 names and accepts any word order and the iso alias', () => {
    for (const d of VIEW_DIRS) expect(parseViewName(viewName(d))).toEqual([...d]);
    expect(viewName([1, 1, 1])).toBe('top-front-right');
    expect(viewName([0, 1, 1])).toBe('top-front');
    expect(viewName([-1, 0, -1])).toBe('back-left');
    expect(parseViewName('front-right-top')).toEqual([1, 1, 1]);
    expect(parseViewName('RIGHT_front')).toEqual([1, 0, 1]);
    expect(parseViewName('iso')).toEqual([1, 1, 1]);
  });

  it('rejects malformed names', () => {
    for (const bad of ['', 'up', 'front-back', 'top-top', 'left-right-top', 'fronts']) expect(parseViewName(bad)).toBeNull();
  });
});

describe('fit', () => {
  it('frames a box in front view exactly (with margin)', () => {
    const box = { min: [0, 0, -1] as Vec3, max: [6, 2, 1] as Vec3 };
    const f = fitBox(box, 0, 0, 2, 0); // front, aspect 2
    close3(f.target, [3, 1, 0]);
    // width 6 at aspect 2 needs height 3; height 2 needs 2 -> 3
    expect(f.height).toBeCloseTo(3, 12);
    const g = fitBox(box, 0, 0, 2, 0.1);
    expect(g.height).toBeCloseTo(3 * 1.2, 12);
  });

  it('keeps every box corner inside the view for arbitrary orientations', () => {
    const box = { min: [-3, -1, 2] as Vec3, max: [5, 4, 3] as Vec3 };
    for (const [yaw, pitch, aspect] of [[0.3, 0.5, 1.5], [-2, -1.2, 0.6], [1, Math.PI / 2, 1]] as const) {
      const f = fitBox(box, yaw, pitch, aspect, 0.05, 0.1);
      const s: CameraState = { target: f.target, yaw, pitch, height: f.height };
      let maxX = 0;
      let maxY = 0;
      for (let i = 0; i < 8; i++) {
        const p: Vec3 = [i & 1 ? box.max[0] : box.min[0], i & 2 ? box.max[1] : box.min[1], i & 4 ? box.max[2] : box.min[2]];
        const q = projectPoint(s, aspect, p);
        maxX = Math.max(maxX, Math.abs(q.ndcX));
        maxY = Math.max(maxY, Math.abs(q.ndcY));
      }
      expect(Math.max(maxX, maxY)).toBeLessThanOrEqual(1 / 1.1 + 1e-9);
      expect(Math.max(maxX, maxY)).toBeCloseTo(1 / 1.1, 9); // tight in the limiting direction
    }
  });

  it('applies a minimum height for tiny boxes and unions boxes', () => {
    expect(fitBox({ min: [0, 0, 0], max: [0, 0, 0] }, 0, 0, 1).height).toBe(2);
    expect(unionBoxes([])).toBeNull();
    expect(unionBoxes([{ min: [0, 0, 0], max: [1, 1, 1] }, { min: [-1, 2, 0], max: [0, 3, 5] }])).toEqual({ min: [-1, 0, 0], max: [1, 3, 5] });
  });
});

describe('pick ray and projection', () => {
  const s: CameraState = { target: [1, 2, 3], yaw: 0.7, pitch: 0.4, height: 10 };
  const aspect = 1.6;

  it('the ray through a projected point passes through that point', () => {
    for (const p of [[1, 2, 3], [4, -1, 0], [-2, 5, 7]] as Vec3[]) {
      const q = projectPoint(s, aspect, p);
      const ray = pickRay(s, aspect, q.ndcX, q.ndcY, 50);
      const t = dot(sub(p, ray.origin), ray.dir);
      expect(t).toBeGreaterThan(0); // the point is in front of the ray origin
      const closest: Vec3 = [ray.origin[0] + ray.dir[0] * t, ray.origin[1] + ray.dir[1] * t, ray.origin[2] + ray.dir[2] * t];
      close3(closest, p, 1e-9);
    }
  });

  it('rays are parallel to the view direction and the centre ray hits the target', () => {
    const { back } = cameraBasis(s.yaw, s.pitch);
    const r = pickRay(s, aspect, 0.3, -0.8, 20);
    close3(r.dir, [-back[0], -back[1], -back[2]], 1e-12);
    const c = pickRay(s, aspect, 0, 0, 20);
    close3([c.origin[0] + c.dir[0] * 20, c.origin[1] + c.dir[1] * 20, c.origin[2] + c.dir[2] * 20], s.target, 1e-9);
  });

  it('front view: screen corners map to the expected world points', () => {
    const f: CameraState = { target: [0, 0, 0], yaw: 0, pitch: 0, height: 4 };
    // aspect 2 -> visible x in [-4, 4], y in [-2, 2]; top-left pixel of an 800x400 viewport
    const [nx, ny] = pixelToNdc(0, 0, 800, 400);
    const r = pickRay(f, 2, nx, ny, 10);
    close3(r.origin, [-4, 2, 10]);
    close3(r.dir, [0, 0, -1]);
    const q = projectPoint(f, 2, [4, -2, 5]);
    expect(ndcToPixel(q.ndcX, q.ndcY, 800, 400)).toEqual([800, 400]);
    expect(q.toward).toBe(5);
  });
});

describe('navigation', () => {
  const s: CameraState = { target: [0, 0, 0], yaw: 0, pitch: 0, height: 10 };

  it('zoom keeps the world point under the cursor fixed', () => {
    const aspect = 1.5;
    const a: CameraState = { target: [2, 1, -1], yaw: 0.9, pitch: 0.3, height: 8 };
    for (const factor of [0.5, 0.8, 1.25, 3]) {
      const b = zoomAt(a, aspect, 0.4, -0.6, factor);
      expect(b.height).toBeCloseTo(8 * factor, 12);
      const ra = pickRay(a, aspect, 0.4, -0.6, 30);
      const rb = pickRay(b, aspect, 0.4, -0.6, 30);
      close3(ra.origin, rb.origin, 1e-9); // same line of sight: the point under the cursor stays put
    }
  });

  it('zoom respects height limits (and still keeps the cursor point at the limit)', () => {
    const z = zoomAt(s, 1, 0.5, 0.5, 1e-6);
    expect(z.height).toBe(MIN_HEIGHT);
    expect(zoomAt(s, 1, 0, 0, 1e9).height).toBe(MAX_HEIGHT);
    close3(pickRay(z, 1, 0.5, 0.5, 5).origin, pickRay(s, 1, 0.5, 0.5, 5).origin, 1e-9);
  });

  it('pan moves the content with the pointer', () => {
    // dragging 100 px right at 10 units / 500 px moves the target 2 units left (content right)
    const p = pan(s, 100, 50, 500);
    close3(p.target, [-2, 1, 0]);
    expect(p.height).toBe(10);
  });

  it('orbit: drag right turns yaw negative, drag down raises the camera, pitch clamps at ±90°', () => {
    const o = orbit(s, 10, 0, 0.01);
    expect(o.yaw).toBeCloseTo(-0.1, 12);
    expect(orbit(s, 0, 10, 0.01).pitch).toBeCloseTo(0.1, 12);
    expect(orbit(s, 0, 1e6).pitch).toBe(Math.PI / 2);
    expect(orbit(s, 0, -1e6).pitch).toBe(-Math.PI / 2);
    expect(Math.abs(orbit(s, 1e4, 0).yaw)).toBeLessThanOrEqual(Math.PI);
  });

  it('normalises camera states', () => {
    const n = normalizeCamera({ target: [0, 0, 0], yaw: 7, pitch: 3, height: 1e9 });
    expect(n.yaw).toBeCloseTo(7 - 2 * Math.PI, 12);
    expect(n.pitch).toBe(Math.PI / 2);
    expect(n.height).toBe(MAX_HEIGHT);
    expect(wrapAngle(Math.PI)).toBe(Math.PI);
    expect(wrapAngle(-Math.PI)).toBeCloseTo(Math.PI, 12);
  });
});

describe('snap interpolation', () => {
  const a: CameraState = { target: [0, 0, 0], yaw: 3, pitch: 0.2, height: 2 };
  const b: CameraState = { target: [4, 2, 0], yaw: -3, pitch: -0.4, height: 8 };

  it('starts and ends exactly at the endpoints', () => {
    expect(cameraNear(interpolateCamera(a, b, 0), a, 1e-12)).toBe(true);
    expect(cameraNear(interpolateCamera(a, b, 1), b, 1e-12)).toBe(true);
  });

  it('turns along the shorter arc, zooms geometrically, moves the target linearly', () => {
    const m = interpolateCamera(a, b, 0.5);
    // 3 -> -3 the short way crosses ±π (Δ = 2π − 6 ≈ 0.283), not through 0
    expect(Math.abs(Math.abs(m.yaw) - Math.PI)).toBeLessThan(0.15);
    expect(m.height).toBeCloseTo(4, 12); // sqrt(2·8)
    close3(m.target, [2, 1, 0]);
    expect(m.pitch).toBeCloseTo(-0.1, 12);
  });

  it('is monotone in every component for a simple snap', () => {
    const s0: CameraState = { target: [0, 0, 0], yaw: 0.1, pitch: 0.1, height: 5 };
    const s1: CameraState = { target: [1, 0, 0], yaw: 1.2, pitch: 0.9, height: 9 };
    let prev = interpolateCamera(s0, s1, 0);
    for (let i = 1; i <= 20; i++) {
      const t = easeInOut(i / 20);
      const c = interpolateCamera(s0, s1, t);
      expect(c.yaw).toBeGreaterThanOrEqual(prev.yaw - 1e-12);
      expect(c.pitch).toBeGreaterThanOrEqual(prev.pitch - 1e-12);
      expect(c.height).toBeGreaterThanOrEqual(prev.height - 1e-12);
      prev = c;
    }
  });

  it('easing is symmetric and pinned at 0, ½, 1', () => {
    expect(easeInOut(0)).toBe(0);
    expect(easeInOut(1)).toBe(1);
    expect(easeInOut(0.5)).toBeCloseTo(0.5, 12);
    for (const t of [0.1, 0.3, 0.45]) expect(easeInOut(t) + easeInOut(1 - t)).toBeCloseTo(1, 12);
    expect(easeInOut(-1)).toBe(0);
    expect(easeInOut(2)).toBe(1);
  });
});

describe('quarter-yaw ties (view cube TOP/BOTTOM keep the yaw)', () => {
  it('a tie goes to the quarter turn nearer yaw 0 (front)', () => {
    const iso = orientationForDir(parseViewName('iso')!).yaw; // exactly atan2(1, 1)
    expect(nearestQuarterYaw(iso)).toBe(0);
    expect(nearestQuarterYaw(-Math.PI / 4)).toBe(0);
    expect(nearestQuarterYaw((3 * Math.PI) / 4)).toBeCloseTo(Math.PI / 2, 12);
    expect(nearestQuarterYaw((-3 * Math.PI) / 4)).toBeCloseTo(-Math.PI / 2, 12);
    // not a tie: plain rounding
    expect(nearestQuarterYaw(Math.PI / 4 + 0.01)).toBeCloseTo(Math.PI / 2, 12);
    expect(nearestQuarterYaw(Math.PI / 4 - 0.01)).toBe(0);
  });
});

describe('fitPoints', () => {
  const corners = (min: Vec3, max: Vec3): number[] => {
    const out: number[] = [];
    for (let i = 0; i < 8; i++) out.push(i & 1 ? max[0] : min[0], i & 2 ? max[1] : min[1], i & 4 ? max[2] : min[2]);
    return out;
  };

  it('equals fitBox for the 8 corners of a box', () => {
    const min: Vec3 = [-1, 0, 2];
    const max: Vec3 = [3, 1.5, 4];
    for (const [yaw, pitch] of [[0, 0], [0.7, 0.4], [-2, -1.2], [Math.PI / 4, ISO_PITCH]] as const) {
      const a = fitPoints(corners(min, max), yaw, pitch, 1.5);
      const b = fitBox({ min, max }, yaw, pitch, 1.5);
      expect(a.height).toBeCloseTo(b.height, 12);
      for (let k = 0; k < 3; k++) expect(a.target[k]).toBeCloseTo(b.target[k]!, 12);
    }
  });

  it('frames the exact silhouette extent, centred, with the margin', () => {
    // a diagonal rod: its AABB is much larger on screen than the rod in an iso view
    const pts: number[] = [];
    for (let t = 0; t <= 1; t += 0.05) pts.push(4 * t, 0, 4 * t);
    const { yaw, pitch } = orientationForDir([1, 1, 1]);
    const aspect = 1;
    const f = fitPoints(pts, yaw, pitch, aspect, 0.1, 0.1);
    const s: CameraState = { target: f.target, yaw, pitch, height: f.height };
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (let i = 0; i < pts.length; i += 3) {
      const q = projectPoint(s, aspect, [pts[i]!, pts[i + 1]!, pts[i + 2]!]);
      x0 = Math.min(x0, q.ndcX); x1 = Math.max(x1, q.ndcX); y0 = Math.min(y0, q.ndcY); y1 = Math.max(y1, q.ndcY);
    }
    // limiting extent fills 1/1.2 of the view, and the content is centred
    expect(Math.max(x1 - x0, (y1 - y0))).toBeCloseTo(2 / 1.2, 9);
    expect((x0 + x1) / 2).toBeCloseTo(0, 9);
    expect((y0 + y1) / 2).toBeCloseTo(0, 9);
    // the AABB fit is looser
    expect(fitBox({ min: [0, 0, 0], max: [4, 0, 4] }, yaw, pitch, aspect, 0.1, 0.1).height).toBeGreaterThan(f.height * 1.1);
  });

  it('keeps the pivot at the depth of the points\' box centre', () => {
    const pts = [0, 0, 0, 2, 0, 0, 0, 3, 0, 0, 0, 5];
    const { yaw, pitch } = orientationForDir([1, 1, 1]);
    const f = fitPoints(pts, yaw, pitch, 1);
    const back = [Math.cos(pitch) * Math.sin(yaw), Math.sin(pitch), Math.cos(pitch) * Math.cos(yaw)];
    const depth = (p: number[]): number => p[0]! * back[0]! + p[1]! * back[1]! + p[2]! * back[2]!;
    expect(depth(f.target)).toBeCloseTo(depth([1, 1.5, 2.5]), 12);
  });

  it('degenerate inputs', () => {
    expect(fitPoints([], 0, 0, 1).height).toBeGreaterThan(0);
    expect(fitPoints([1, 2, 3], 0, 0, 1)).toEqual({ target: [1, 2, 3], height: 2 });
  });
});
