// Shaded "printed instructions" material for parts and the translucent ghost (DESIGN.md §6.1):
// Lambert-like diffuse from a key light fixed to the camera (up-left, toward the viewer) plus a
// generous camera-relative hemisphere ambient, so no face goes dark and curved surfaces read as
// curved. No shadows, no environment, no gloss. Lighting is computed in linear space.
import * as THREE from 'three';
import { markColor } from './markpaint';

/** Lighting constants (view space: +x right, +y up, +z toward the viewer). */
export const LIGHT = {
  key: new THREE.Vector3(-0.42, 0.62, 0.66).normalize(),
  keyStrength: 0.5,
  ambientTop: 0.6,
  ambientBottom: 0.54,
};

const PART_VERT = /* glsl */ `
attribute float aMark;
varying vec3 vNormal;
varying float vMark;
void main() {
  vNormal = normalize(normalMatrix * normal);
  vMark = aMark;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const PART_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform vec3 uMarkColor;
uniform vec3 uTint;
uniform float uTintAmount;
uniform vec3 uKey;
uniform float uKeyStrength;
uniform float uAmbTop;
uniform float uAmbBottom;
uniform float uOpacity;
uniform float uGhost;
uniform vec3 uGhostColor;
varying vec3 vNormal;
varying float vMark;
void main() {
  // Show colliders' ghost (viewport applyGhost): one flat colour, no shading, no index mark — so
  // the part's inner faces (pin holes, tread seams) and its own colour do not show through the
  // collider fills as features of the colliders.
  if (uGhost > 0.5) {
    gl_FragColor = vec4(mix(uGhostColor, uTint, uTintAmount), uOpacity);
    #include <colorspace_fragment>
    return;
  }
  vec3 n = normalize(vNormal);
  if (!gl_FrontFacing) n = -n;
  float amb = mix(uAmbBottom, uAmbTop, n.y * 0.5 + 0.5);
  float diff = max(dot(n, uKey), 0.0);
  // the wheels' index mark (markpaint.ts): painted in a contrasting shade
  vec3 base = mix(mix(uColor, uMarkColor, vMark), uTint, uTintAmount);
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
      uMarkColor: { value: new THREE.Color(markColor(color)) },
      uTint: { value: new THREE.Color('#2f8cff') },
      uTintAmount: { value: 0 },
      uKey: { value: LIGHT.key },
      uKeyStrength: { value: LIGHT.keyStrength },
      uAmbTop: { value: LIGHT.ambientTop },
      uAmbBottom: { value: LIGHT.ambientBottom },
      uOpacity: { value: 1 },
      uGhost: { value: 0 },
      uGhostColor: { value: new THREE.Color(color) },
    },
    side: THREE.FrontSide,
  });
}

const GHOST_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uOpacity;
uniform float uRim;
uniform vec3 uRimColor;
uniform float uRimPow;
uniform vec3 uKey;
varying vec3 vNormal;
void main() {
  vec3 n = normalize(vNormal);
  float diff = max(dot(n, uKey), 0.0);
  float rim = 1.0 - abs(n.z);
  vec3 c = uColor * (0.75 + 0.35 * diff);
  float a = uOpacity * (0.75 + 0.5 * rim * rim);
  // Silhouette rim (uRim > 0) in uRimColor: white for the ghost seen through geometry (keeps its
  // outline legible), or the semantic colour around a white ghost over a part of its own hue
  // (viewport overlayStyle).
  float r3 = pow(rim, uRimPow);
  c = mix(c, uRimColor, uRim * r3);
  a = max(a, uRim * r3 * 0.9);
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
      uRim: { value: 0 },
      uRimColor: { value: new THREE.Color('#ffffff') },
      uRimPow: { value: 3 },
      uKey: { value: LIGHT.key },
    },
    transparent: true,
    depthWrite: false,
    depthTest: true,
    depthFunc: hidden ? THREE.GreaterDepth : THREE.LessEqualDepth,
    side: THREE.FrontSide,
    // Pulled slightly toward the viewer: a ghost coplanar with existing geometry (a wheel's ghost
    // disc over the current wheel's faces) is then consistently the visible variant, not z-fighting.
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -4,
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
