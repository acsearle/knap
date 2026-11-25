// Shaded "printed instructions" material for parts and the translucent ghost (DESIGN.md §6.1):
// Lambert-like diffuse from a key light fixed to the camera (up-left, toward the viewer) plus a
// generous camera-relative hemisphere ambient, so no face goes dark and curved surfaces read as
// curved. No shadows, no environment, no gloss. Lighting is computed in linear space.
import * as THREE from 'three';

/** Lighting constants (view space: +x right, +y up, +z toward the viewer). */
export const LIGHT = {
  key: new THREE.Vector3(-0.42, 0.62, 0.66).normalize(),
  keyStrength: 0.5,
  ambientTop: 0.6,
  ambientBottom: 0.54,
};

const PART_VERT = /* glsl */ `
varying vec3 vNormal;
void main() {
  vNormal = normalize(normalMatrix * normal);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const PART_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform vec3 uTint;
uniform float uTintAmount;
uniform vec3 uKey;
uniform float uKeyStrength;
uniform float uAmbTop;
uniform float uAmbBottom;
uniform float uOpacity;
varying vec3 vNormal;
void main() {
  vec3 n = normalize(vNormal);
  if (!gl_FrontFacing) n = -n;
  float amb = mix(uAmbBottom, uAmbTop, n.y * 0.5 + 0.5);
  float diff = max(dot(n, uKey), 0.0);
  vec3 base = mix(uColor, uTint, uTintAmount);
  vec3 c = base * (amb + uKeyStrength * diff);
  gl_FragColor = vec4(c, uOpacity);
  #include <colorspace_fragment>
}`;

export function createPartMaterial(color: string): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: PART_VERT,
    fragmentShader: PART_FRAG,
    uniforms: {
      uColor: { value: new THREE.Color(color) },
      uTint: { value: new THREE.Color('#2f8cff') },
      uTintAmount: { value: 0 },
      uKey: { value: LIGHT.key },
      uKeyStrength: { value: LIGHT.keyStrength },
      uAmbTop: { value: LIGHT.ambientTop },
      uAmbBottom: { value: LIGHT.ambientBottom },
      uOpacity: { value: 1 },
    },
    side: THREE.FrontSide,
  });
}

const GHOST_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uOpacity;
uniform vec3 uKey;
varying vec3 vNormal;
void main() {
  vec3 n = normalize(vNormal);
  float diff = max(dot(n, uKey), 0.0);
  float rim = 1.0 - abs(n.z);
  vec3 c = uColor * (0.75 + 0.35 * diff);
  float a = uOpacity * (0.75 + 0.5 * rim * rim);
  gl_FragColor = vec4(c, clamp(a, 0.0, 1.0));
  #include <colorspace_fragment>
}`;

/** Translucent ghost material. `hidden` = the variant drawn only where something is in front. */
export function createGhostMaterial(hidden: boolean): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: PART_VERT,
    fragmentShader: GHOST_FRAG,
    uniforms: {
      uColor: { value: new THREE.Color('#2f8cff') },
      uOpacity: { value: hidden ? 0.16 : 0.42 },
      uKey: { value: LIGHT.key },
    },
    transparent: true,
    depthWrite: false,
    depthTest: true,
    depthFunc: hidden ? THREE.GreaterDepth : THREE.LessEqualDepth,
    side: THREE.FrontSide,
  });
}

/** A flat translucent fill (hover quads, erase cube). Colour in display space via THREE.Color. */
export function createFillMaterial(color: string, opacity: number, depthTest = true): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    color,
    opacity,
    transparent: true,
    depthWrite: false,
    depthTest,
    side: THREE.FrontSide,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -2,
  });
}
