// Small vector / quaternion helpers for the physics layer (plain tuples, no allocation-free
// tricks needed at this scale). Quaternions are [x, y, z, w], unit length.

export type Vec3 = [number, number, number];
export type Quat = [number, number, number, number];

export interface XYZ {
  x: number;
  y: number;
  z: number;
}
export interface XYZW extends XYZ {
  w: number;
}

export const IDENTITY_Q: Quat = [0, 0, 0, 1];

export function vec(v: XYZ): Vec3 {
  return [v.x, v.y, v.z];
}
export function quat(q: XYZW): Quat {
  return [q.x, q.y, q.z, q.w];
}
export function xyz(v: readonly number[]): XYZ {
  return { x: v[0]!, y: v[1]!, z: v[2]! };
}

export function add(a: Vec3, b: Vec3): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}
export function sub(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}
export function scale(a: Vec3, s: number): Vec3 {
  return [a[0] * s, a[1] * s, a[2] * s];
}
export function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}
export function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
export function len(a: Vec3): number {
  return Math.hypot(a[0], a[1], a[2]);
}

/** Rotate v by unit quaternion q. */
export function rotate(q: Quat, v: Vec3): Vec3 {
  const [x, y, z, w] = q;
  const tx = 2 * (y * v[2] - z * v[1]);
  const ty = 2 * (z * v[0] - x * v[2]);
  const tz = 2 * (x * v[1] - y * v[0]);
  return [v[0] + w * tx + (y * tz - z * ty), v[1] + w * ty + (z * tx - x * tz), v[2] + w * tz + (x * ty - y * tx)];
}

export function conj(q: Quat): Quat {
  return [-q[0], -q[1], -q[2], q[3]];
}

/** Hamilton product a·b (apply b first, then a). */
export function qmul(a: Quat, b: Quat): Quat {
  const [ax, ay, az, aw] = a;
  const [bx, by, bz, bw] = b;
  return [
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
    aw * bw - ax * bx - ay * by - az * bz,
  ];
}

export function qnormalize(q: Quat): Quat {
  const n = Math.hypot(q[0], q[1], q[2], q[3]) || 1;
  return [q[0] / n, q[1] / n, q[2] / n, q[3] / n];
}

/** Quaternion rotating by `angle` radians about unit axis `a`. */
export function axisAngle(a: Vec3, angle: number): Quat {
  const s = Math.sin(angle / 2);
  return [a[0] * s, a[1] * s, a[2] * s, Math.cos(angle / 2)];
}

/** Unit vector along grid axis 0/1/2. */
export function unitAxis(axis: 0 | 1 | 2, s = 1): Vec3 {
  const v: Vec3 = [0, 0, 0];
  v[axis] = s;
  return v;
}

/** Apply rigid transform {p, q} to point x: q·x + p. */
export function applyTransform(t: { p: Vec3; q: Quat }, x: Vec3): Vec3 {
  return add(rotate(t.q, x), t.p);
}
