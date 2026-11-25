// Faint reference grid on the plane y = −½ (cell boundaries at half-integers) with slightly
// stronger axis lines (x = 0 and z = 0), procedurally anti-aliased, fading out radially, at grazing
// view angles and where lines would get denser than a few pixels (DESIGN.md §6.1).
import * as THREE from 'three';

const VERT = /* glsl */ `
varying vec2 vXZ;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vXZ = w.xz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

const FRAG = /* glsl */ `
uniform vec2 uCenter;
uniform float uRadius;
uniform float uViewY;
uniform float uPx;      // device px per CSS px (line widths are in CSS px)
varying vec2 vXZ;
float lineCov(float coord, float offset, float widthPx) {
  float fw = max(fwidth(coord), 1e-6);
  float d = abs(fract(coord - offset + 0.5) - 0.5) / fw;   // px to nearest line
  return clamp(widthPx * 0.5 + 0.5 - d, 0.0, 1.0);
}
void main() {
  float fw = max(fwidth(vXZ.x), fwidth(vXZ.y));
  float density = 1.0 - smoothstep(0.12, 0.3, fw);         // fade when cells < ~4 px
  float minor = max(lineCov(vXZ.x, 0.5, uPx), lineCov(vXZ.y, 0.5, uPx)) * density;
  // Axis lines: x = 0 (runs along Z) and z = 0 (runs along X).
  float fwx = max(fwidth(vXZ.x), 1e-6);
  float fwz = max(fwidth(vXZ.y), 1e-6);
  float ax = clamp(1.3 * uPx * 0.5 + 0.5 - abs(vXZ.y) / fwz, 0.0, 1.0); // X axis (z = 0)
  float az = clamp(1.3 * uPx * 0.5 + 0.5 - abs(vXZ.x) / fwx, 0.0, 1.0); // Z axis (x = 0)
  float r = length(vXZ - uCenter);
  float fade = (1.0 - smoothstep(uRadius * 0.55, uRadius, r)) * smoothstep(0.06, 0.28, abs(uViewY));
  vec3 xCol = vec3(0.80, 0.33, 0.30);
  vec3 zCol = vec3(0.28, 0.45, 0.80);
  float aX = ax * 0.32;
  float aZ = az * 0.32;
  // premultiplied "over": minor lines (black), then the X axis, then the Z axis
  float A = minor * 0.065;
  vec3 P = vec3(0.0);
  P = xCol * aX + P * (1.0 - aX); A = aX + A * (1.0 - aX);
  P = zCol * aZ + P * (1.0 - aZ); A = aZ + A * (1.0 - aZ);
  A *= fade;
  P *= fade;
  if (A <= 0.002) discard;
  gl_FragColor = vec4(P / A, A);
}`;

export class Grid extends THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial> {
  constructor() {
    const geo = new THREE.PlaneGeometry(1, 1);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: {
        uCenter: { value: new THREE.Vector2() },
        uRadius: { value: 20 },
        uViewY: { value: 1 },
        uPx: { value: 1 },
      },
      transparent: false, // drawn first among opaques (renderOrder), blended manually
      blending: THREE.CustomBlending,
      blendSrc: THREE.SrcAlphaFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
      // keep the drawing buffer opaque (three's context always has an alpha channel)
      blendSrcAlpha: THREE.ZeroFactor,
      blendDstAlpha: THREE.OneFactor,
      depthWrite: false,
      depthTest: true,
      side: THREE.DoubleSide,
    });
    super(geo, mat);
    this.renderOrder = -100;
    this.frustumCulled = false;
    this.position.y = -0.5;
  }

  /** Centre/size the grid around a model box (xz) and set per-frame uniforms. */
  update(center: [number, number], radius: number, viewY: number, pixelRatio: number): void {
    const cx = Math.round(center[0]);
    const cz = Math.round(center[1]);
    this.position.set(cx, -0.5, cz);
    this.scale.set(radius * 2, 1, radius * 2);
    const u = this.material.uniforms;
    (u.uCenter!.value as THREE.Vector2).set(cx, cz);
    u.uRadius!.value = radius;
    u.uViewY!.value = viewY;
    u.uPx!.value = pixelRatio;
  }

  override dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
  }
}
