// Pure camera math for the viewport (DESIGN.md §6.2). No three.js, no DOM: unit-tested in Node.
//
// Camera model: a turntable orthographic camera about a pivot (`target`) with world +Y up.
//   yaw   — rotation about world +Y (radians); yaw 0 looks from +Z (FRONT), yaw +π/2 from +X (RIGHT).
//   pitch — elevation (radians), clamped to [−π/2, +π/2]; +π/2 looks straight down (TOP).
//   height — visible world height (units) of the orthographic frustum; width = height · aspect.
// The camera sits on the ray target + back·distance and looks along −back.

export type Vec3 = [number, number, number];

export interface CameraState {
  /** Orbit pivot and centre of the view (world). */
  target: Vec3;
  /** Radians about world +Y; 0 = looking from +Z (front). Normalised to (−π, π]. */
  yaw: number;
  /** Radians, [−π/2, π/2]; positive = looking down from above. */
  pitch: number;
  /** Visible world height of the orthographic frustum (units). */
  height: number;
}

export interface Box3 {
  min: Vec3;
  max: Vec3;
}

export interface Ray {
  /** A point on the ray in front of everything in the scene (on the camera plane). */
  origin: Vec3;
  /** Unit direction (= −back for an orthographic camera). */
  dir: Vec3;
}

export interface Basis {
  /** Screen right in world. */
  right: Vec3;
  /** Screen up in world. */
  up: Vec3;
  /** From the target toward the camera (opposite of the view direction). */
  back: Vec3;
}

export const PITCH_LIMIT = Math.PI / 2;
/** Elevation of an isometric corner view: atan(1/√2) ≈ 35.264°. */
export const ISO_PITCH = Math.atan(1 / Math.SQRT2);
export const MIN_HEIGHT = 0.25;
export const MAX_HEIGHT = 5000;

// ------------------------------------------------------------------------------------------
// Small vector helpers

export const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scale = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
export const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
export const len = (a: Vec3): number => Math.hypot(a[0], a[1], a[2]);
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
export const lerp3 = (a: Vec3, b: Vec3, t: number): Vec3 => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
export const clamp = (x: number, lo: number, hi: number): number => (x < lo ? lo : x > hi ? hi : x);

/** Wrap an angle to (−π, π]. */
export function wrapAngle(a: number): number {
  let r = a % (2 * Math.PI);
  if (r <= -Math.PI) r += 2 * Math.PI;
  else if (r > Math.PI) r -= 2 * Math.PI;
  return r;
}

// ------------------------------------------------------------------------------------------
// Basis

/** Camera basis for a turntable orientation. Well defined at pitch = ±π/2 (yaw sets screen up). */
export function cameraBasis(yaw: number, pitch: number): Basis {
  const cp = Math.cos(pitch);
  const sp = Math.sin(pitch);
  const cy = Math.cos(yaw);
  const sy = Math.sin(yaw);
  const back: Vec3 = [cp * sy, sp, cp * cy];
  const right: Vec3 = [cy, 0, -sy];
  const up = cross(back, right);
  return { right, up, back };
}

/** A valid, normalised copy of a camera state (yaw wrapped, pitch and height clamped). */
export function normalizeCamera(s: CameraState): CameraState {
  return {
    target: [s.target[0], s.target[1], s.target[2]],
    yaw: wrapAngle(s.yaw),
    pitch: clamp(s.pitch, -PITCH_LIMIT, PITCH_LIMIT),
    height: clamp(s.height, MIN_HEIGHT, MAX_HEIGHT),
  };
}

// ------------------------------------------------------------------------------------------
// Named views: 6 faces, 12 edges, 8 corners of the view cube

/** A view direction from the target toward the camera, each component −1, 0 or 1 (not all 0). */
export type ViewDir = readonly [number, number, number];

const AXIS_WORDS: readonly [string, string][] = [
  ['right', 'left'], // x: +, −
  ['top', 'bottom'], // y
  ['front', 'back'], // z
];

/**
 * Canonical name of a view direction: the words for its non-zero components in the order
 * vertical, depth, side — e.g. 'front', 'top-front', 'top-front-right', 'bottom-back-left'.
 */
export function viewName(dir: ViewDir): string {
  const words: string[] = [];
  for (const k of [1, 2, 0] as const) {
    const s = dir[k]!;
    if (s > 0) words.push(AXIS_WORDS[k]![0]);
    else if (s < 0) words.push(AXIS_WORDS[k]![1]);
  }
  return words.join('-');
}

/** The 26 cube views: 6 faces, then 12 edges, then 8 corners. */
export const VIEW_DIRS: readonly ViewDir[] = (() => {
  const out: ViewDir[][] = [[], [], []];
  for (let x = -1; x <= 1; x++)
    for (let y = -1; y <= 1; y++)
      for (let z = -1; z <= 1; z++) {
        const n = (x !== 0 ? 1 : 0) + (y !== 0 ? 1 : 0) + (z !== 0 ? 1 : 0);
        if (n > 0) out[n - 1]!.push([x, y, z]);
      }
  return [...out[0]!, ...out[1]!, ...out[2]!];
})();

export const VIEW_NAMES: readonly string[] = VIEW_DIRS.map(viewName);

/**
 * Parse a view name: '-'-separated words from {top,bottom,front,back,left,right} in any order,
 * at most one per axis ('front-right-top' = 'top-front-right'), or the alias 'iso'
 * (= 'top-front-right', the default view). Returns null for anything else.
 */
export function parseViewName(name: string): ViewDir | null {
  const n = name.trim().toLowerCase();
  if (n === 'iso' || n === 'home') return [1, 1, 1];
  if (!n) return null;
  const dir: [number, number, number] = [0, 0, 0];
  for (const w of n.split(/[-_\s]+/)) {
    let found = false;
    for (let k = 0; k < 3; k++) {
      const [pos, neg] = AXIS_WORDS[k]!;
      if (w === pos || w === neg) {
        if (dir[k] !== 0) return null;
        dir[k] = w === pos ? 1 : -1;
        found = true;
      }
    }
    if (!found) return null;
  }
  return dir;
}

/**
 * Turntable orientation that looks from direction `dir` (target → camera). For straight up/down
 * views the yaw is free: `fallbackYaw` is used (callers pass 0 for the canonical orientation,
 * or the current yaw rounded to a quarter turn to keep the picture's rotation).
 */
export function orientationForDir(dir: ViewDir, fallbackYaw = 0): { yaw: number; pitch: number } {
  const h = Math.hypot(dir[0], dir[2]);
  if (h < 1e-9) return { yaw: wrapAngle(fallbackYaw), pitch: dir[1] >= 0 ? PITCH_LIMIT : -PITCH_LIMIT };
  return { yaw: wrapAngle(Math.atan2(dir[0], dir[2])), pitch: Math.atan2(dir[1], h) };
}

/**
 * Nearest multiple of π/2 to `yaw`, wrapped. An exact (or within 1e-6 rad) tie between two
 * quarter turns goes to the one nearer yaw 0 (front), so TOP from the default iso view
 * (yaw = π/4) is the canonical top view with FRONT at the bottom.
 */
export function nearestQuarterYaw(yaw: number): number {
  const q = wrapAngle(yaw) / (Math.PI / 2);
  const lo = Math.floor(q);
  const frac = q - lo;
  let n: number;
  if (Math.abs(frac - 0.5) * (Math.PI / 2) <= 1e-6) n = Math.abs(lo) < Math.abs(lo + 1) ? lo : lo + 1;
  else n = frac < 0.5 ? lo : lo + 1;
  return wrapAngle(n * (Math.PI / 2)) + 0; // + 0: no −0
}

// ------------------------------------------------------------------------------------------
// Fit

/**
 * Target and height that frame `box` for the given orientation and aspect (width/height), with
 * `margin` as a fraction added around it (0.1 = 10 % each side in the limiting direction).
 */
export function fitBox(box: Box3, yaw: number, pitch: number, aspect: number, margin = 0.1, minHeight = 2): { target: Vec3; height: number } {
  const c: Vec3 = [(box.min[0] + box.max[0]) / 2, (box.min[1] + box.max[1]) / 2, (box.min[2] + box.max[2]) / 2];
  const { right, up } = cameraBasis(yaw, pitch);
  let ex = 0;
  let ey = 0;
  for (let i = 0; i < 8; i++) {
    const p: Vec3 = [i & 1 ? box.max[0] : box.min[0], i & 2 ? box.max[1] : box.min[1], i & 4 ? box.max[2] : box.min[2]];
    const d = sub(p, c);
    ex = Math.max(ex, Math.abs(dot(d, right)));
    ey = Math.max(ey, Math.abs(dot(d, up)));
  }
  const a = aspect > 0 && Number.isFinite(aspect) ? aspect : 1;
  const height = Math.max(2 * ey, (2 * ex) / a) * (1 + 2 * margin);
  return { target: c, height: clamp(Math.max(height, minHeight), MIN_HEIGHT, MAX_HEIGHT) };
}

/**
 * Like fitBox, but frames a point set (flat world xyz, e.g. a model's vertices) by its exact
 * extent along the screen axes, and centres the view on that extent. The returned target (the
 * orbit pivot) is the centre of the points' bounding box moved within the view plane, so it
 * keeps the box centre's depth.
 */
export function fitPoints(points: ArrayLike<number>, yaw: number, pitch: number, aspect: number, margin = 0.1, minHeight = 2): { target: Vec3; height: number } {
  const n = Math.floor(points.length / 3);
  if (n === 0) return fitBox({ min: [-1, -1, -1], max: [1, 1, 1] }, yaw, pitch, aspect, margin, minHeight);
  const { right, up } = cameraBasis(yaw, pitch);
  let r0 = Infinity, r1 = -Infinity, u0 = Infinity, u1 = -Infinity;
  const lo: Vec3 = [Infinity, Infinity, Infinity];
  const hi: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < n; i++) {
    const x = points[3 * i]!, y = points[3 * i + 1]!, z = points[3 * i + 2]!;
    const r = x * right[0] + y * right[1] + z * right[2];
    const u = x * up[0] + y * up[1] + z * up[2];
    if (r < r0) r0 = r;
    if (r > r1) r1 = r;
    if (u < u0) u0 = u;
    if (u > u1) u1 = u;
    if (x < lo[0]) lo[0] = x;
    if (x > hi[0]) hi[0] = x;
    if (y < lo[1]) lo[1] = y;
    if (y > hi[1]) hi[1] = y;
    if (z < lo[2]) lo[2] = z;
    if (z > hi[2]) hi[2] = z;
  }
  const c: Vec3 = [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2];
  const dr = (r0 + r1) / 2 - dot(c, right);
  const du = (u0 + u1) / 2 - dot(c, up);
  const target = add(c, add(scale(right, dr), scale(up, du)));
  const a = aspect > 0 && Number.isFinite(aspect) ? aspect : 1;
  const height = Math.max(u1 - u0, (r1 - r0) / a) * (1 + 2 * margin);
  return { target, height: clamp(Math.max(height, minHeight), MIN_HEIGHT, MAX_HEIGHT) };
}

/** Union of boxes; null for none. */
export function unionBoxes(boxes: Iterable<Box3>): Box3 | null {
  let out: Box3 | null = null;
  for (const b of boxes) {
    if (!out) out = { min: [...b.min], max: [...b.max] };
    else
      for (let k = 0; k < 3; k++) {
        out.min[k] = Math.min(out.min[k]!, b.min[k]!);
        out.max[k] = Math.max(out.max[k]!, b.max[k]!);
      }
  }
  return out;
}

// ------------------------------------------------------------------------------------------
// Projection and picking (orthographic). NDC: x right, y up, both in [−1, 1] over the viewport.

/** World offset (in the view plane through the target) of an NDC point. */
export function ndcOffset(s: CameraState, aspect: number, ndcX: number, ndcY: number): Vec3 {
  const { right, up } = cameraBasis(s.yaw, s.pitch);
  const hh = s.height / 2;
  const hw = hh * aspect;
  return add(scale(right, ndcX * hw), scale(up, ndcY * hh));
}

/** Pick ray through an NDC point; the origin is `distance` in front of the target. */
export function pickRay(s: CameraState, aspect: number, ndcX: number, ndcY: number, distance: number): Ray {
  const { back } = cameraBasis(s.yaw, s.pitch);
  const origin = add(add(s.target, ndcOffset(s, aspect, ndcX, ndcY)), scale(back, distance));
  return { origin, dir: scale(back, -1) };
}

/** Project a world point: NDC x/y and the depth in front of the target plane (+ = toward the camera). */
export function projectPoint(s: CameraState, aspect: number, p: Vec3): { ndcX: number; ndcY: number; toward: number } {
  const { right, up, back } = cameraBasis(s.yaw, s.pitch);
  const d = sub(p, s.target);
  const hh = s.height / 2;
  return { ndcX: dot(d, right) / (hh * aspect), ndcY: dot(d, up) / hh, toward: dot(d, back) };
}

/** Client pixel (relative to the viewport's top-left) → NDC. */
export function pixelToNdc(x: number, y: number, width: number, height: number): [number, number] {
  return [(x / width) * 2 - 1, 1 - (y / height) * 2];
}

/** NDC → client pixel relative to the viewport's top-left. */
export function ndcToPixel(ndcX: number, ndcY: number, width: number, height: number): [number, number] {
  return [((ndcX + 1) / 2) * width, ((1 - ndcY) / 2) * height];
}

// ------------------------------------------------------------------------------------------
// Navigation steps (pure; the Viewport applies them)

/** Turntable orbit by a pointer delta in CSS px (dx right, dy down). */
export function orbit(s: CameraState, dx: number, dy: number, radPerPx = 0.0085): CameraState {
  return normalizeCamera({ ...s, yaw: s.yaw - dx * radPerPx, pitch: s.pitch + dy * radPerPx });
}

/** Pan so the content follows the pointer: dx, dy in CSS px, viewportHeight in CSS px. */
export function pan(s: CameraState, dx: number, dy: number, viewportHeight: number): CameraState {
  const { right, up } = cameraBasis(s.yaw, s.pitch);
  const wpp = s.height / Math.max(1, viewportHeight);
  const t = add(s.target, add(scale(right, -dx * wpp), scale(up, dy * wpp)));
  return { ...s, target: t };
}

/**
 * Zoom by `factor` (new height = height · factor; < 1 zooms in) keeping the world point under the
 * NDC position fixed on screen. The factor is limited so height stays within [minH, maxH].
 */
export function zoomAt(s: CameraState, aspect: number, ndcX: number, ndcY: number, factor: number, minH = MIN_HEIGHT, maxH = MAX_HEIGHT): CameraState {
  const h = clamp(s.height * factor, minH, maxH);
  const f = h / s.height;
  const o = ndcOffset(s, aspect, ndcX, ndcY);
  return { ...s, target: add(s.target, scale(o, 1 - f)), height: h };
}

// ------------------------------------------------------------------------------------------
// Snap animation

/** Smooth ease-in-out on [0, 1] (cubic). */
export function easeInOut(t: number): number {
  const x = clamp(t, 0, 1);
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
}

/**
 * Interpolate camera states at parameter t ∈ [0, 1] (no easing applied): yaw along the shorter
 * arc, pitch and target linearly, height geometrically (constant zoom speed).
 */
export function interpolateCamera(a: CameraState, b: CameraState, t: number): CameraState {
  const u = clamp(t, 0, 1);
  if (u === 1) return normalizeCamera(b);
  const dyaw = wrapAngle(b.yaw - a.yaw);
  return normalizeCamera({
    target: lerp3(a.target, b.target, u),
    yaw: a.yaw + dyaw * u,
    pitch: lerp(a.pitch, b.pitch, u),
    height: Math.exp(lerp(Math.log(a.height), Math.log(b.height), u)),
  });
}

/** Default camera: isometric from (+X, +Y, +Z) around the origin (fit it afterwards). */
export function defaultCamera(): CameraState {
  const { yaw, pitch } = orientationForDir([1, 1, 1]);
  return { target: [0, 0, 0], yaw, pitch, height: 12 };
}

/** True if two camera states are equal within tolerances (angles in radians). */
export function cameraNear(a: CameraState, b: CameraState, eps = 1e-6): boolean {
  return (
    Math.abs(wrapAngle(a.yaw - b.yaw)) <= eps &&
    Math.abs(a.pitch - b.pitch) <= eps &&
    Math.abs(a.height - b.height) <= eps * Math.max(1, a.height) &&
    len(sub(a.target, b.target)) <= eps * Math.max(1, a.height)
  );
}
