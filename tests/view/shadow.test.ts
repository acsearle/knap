// The ground's contact shadow (DESIGN §6.1 "Ground"): the pure parts in src/view/shadowmath.ts
// (strength, the blur kernel in world units, frame fitting / snapping), and the viewport's rule for
// when the shadow texture is re-rendered (on a stand-in object: no WebGL in Node).
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  SHADOW_AMBIENT,
  SHADOW_AMBIENT_BLUR,
  SHADOW_AMBIENT_REACH,
  SHADOW_BLUR,
  SHADOW_CONTACT,
  SHADOW_KERNEL_MAX,
  SHADOW_EDGE_FADE,
  SHADOW_H,
  SHADOW_MARGIN,
  SHADOW_MAX,
  SHADOW_MAX_EXTENT,
  SHADOW_MIN_EXTENT,
  SHADOW_TEXEL,
  SHADOW_TEX_MAX,
  ambientKernel,
  ambientWeights,
  clusterWindow,
  fitFrame,
  frameEdgeFade,
  frameStep,
  frameTexels,
  gaussianKernel,
  shadowMix,
  shadowRegion,
  shadowStrength,
  snapToTexel,
} from '../../src/view/shadowmath';
import type { CasterBox, ShadowFrame } from '../../src/view/shadowmath';
import { Viewport } from '../../src/view/viewport';

const box = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): CasterBox => ({ min: [x0, y0, z0], max: [x1, y1, z1] });
const onGrid = (v: number): boolean => Math.abs(v / SHADOW_TEXEL - Math.round(v / SHADOW_TEXEL)) < 1e-9;
const holds = (f: ShadowFrame, r: { x0: number; x1: number; z0: number; z1: number }): boolean =>
  f.x0 <= r.x0 + 1e-9 && f.x0 + f.w >= r.x1 - 1e-9 && f.z0 <= r.z0 + 1e-9 && f.z0 + f.d >= r.z1 - 1e-9;

describe('constants', () => {
  it('as specified (start values) and consistent', () => {
    // Two lobes (DEVIATIONS §6 "Contact shadow"): SHADOW_MAX is their sum, a strength-1 shadow.
    // (Was: SHADOW_MAX < 0.6 for the spec's single lobe; the tuned pair is 0.42 + 0.42.)
    expect(SHADOW_MAX).toBeCloseTo(SHADOW_CONTACT + SHADOW_AMBIENT, 12);
    expect(SHADOW_CONTACT).toBeGreaterThan(0);
    expect(SHADOW_AMBIENT).toBeGreaterThan(0);
    expect(SHADOW_MAX).toBeLessThan(0.9);
    expect(SHADOW_AMBIENT_BLUR).toBeGreaterThan(SHADOW_BLUR);
    expect(SHADOW_AMBIENT_REACH).toBeGreaterThanOrEqual(4 * SHADOW_AMBIENT_BLUR);
    expect(SHADOW_MARGIN).toBeGreaterThanOrEqual(SHADOW_AMBIENT_REACH + SHADOW_EDGE_FADE);
    expect(SHADOW_H).toBe(3);
    expect(SHADOW_BLUR).toBeGreaterThan(0);
    expect(SHADOW_MAX_EXTENT).toBeGreaterThanOrEqual(128);
    expect(SHADOW_TEX_MAX).toBe(SHADOW_MAX_EXTENT / SHADOW_TEXEL);
    expect(SHADOW_TEX_MAX).toBeLessThanOrEqual(2048);
    expect(SHADOW_MARGIN).toBeGreaterThanOrEqual(3 * SHADOW_BLUR + SHADOW_EDGE_FADE);
    expect(onGrid(SHADOW_MARGIN)).toBe(true);
  });
});

describe('shadowStrength', () => {
  it('(1 − h/H)² below H, 0 at and above, 1 at or under the floor, monotone', () => {
    expect(shadowStrength(0)).toBe(1);
    expect(shadowStrength(-0.2)).toBe(1);
    expect(shadowStrength(1.5)).toBeCloseTo(0.25, 12);
    expect(shadowStrength(SHADOW_H)).toBe(0);
    expect(shadowStrength(5)).toBe(0);
    let prev = 2;
    for (let h = 0; h <= SHADOW_H + 0.5; h += 0.01) {
      const s = shadowStrength(h);
      expect(s).toBeLessThanOrEqual(prev);
      expect(s).toBeCloseTo(h < SHADOW_H ? (1 - h / SHADOW_H) ** 2 : 0, 12);
      prev = s;
    }
  });
});

describe('gaussianKernel', () => {
  it('normalised, symmetric taps reaching 3σ', () => {
    const w = gaussianKernel();
    expect(w[0]! + 2 * w.slice(1).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 12);
    expect(w.length - 1).toBe(Math.ceil((3 * SHADOW_BLUR) / SHADOW_TEXEL));
    for (let i = 1; i < w.length; i++) expect(w[i]!).toBeLessThan(w[i - 1]!);
  });

  it('σ is in world units: the discrete variance is σ² in world units for any texel size', () => {
    // (texel sizes whose 3σ radius fits SHADOW_KERNEL_MAX; truncating at 3σ loses ≈ 1.5 % of σ)
    for (const texel of [SHADOW_TEXEL, 0.1, 0.175]) {
      const w = gaussianKernel(SHADOW_BLUR, texel);
      let v = 0;
      for (let i = 1; i < w.length; i++) v += 2 * w[i]! * (i * texel) ** 2;
      expect(Math.abs(Math.sqrt(v) / SHADOW_BLUR - 1)).toBeLessThan(0.025);
    }
  });

  it('a blurred straight edge of a wide footprint is ½ at the edge and ≈ 0.023 at 2σ outside', () => {
    // one row of texels: 1 inside x < 0 (texel centres), 0 outside
    const w = gaussianKernel();
    const r = w.length - 1;
    const at = (cx: number): number => {
      let s = 0;
      for (let i = -r; i <= r; i++) s += w[Math.abs(i)]! * ((cx + i + 0.5) * SHADOW_TEXEL < 0 ? 1 : 0);
      return s;
    };
    // texel centre just outside the edge vs just inside average to ½
    expect((at(-1) + at(0)) / 2).toBeCloseTo(0.5, 6);
    const k = Math.round((2 * SHADOW_BLUR) / SHADOW_TEXEL);
    expect(at(k)).toBeGreaterThan(0.005);
    expect(at(k)).toBeLessThan(0.05);
  });
});

describe('ambient lobe', () => {
  it('per-texel weights normalised, σ in world units, 4σ reach', () => {
    const w = ambientWeights();
    expect(w.length - 1).toBe(2 * SHADOW_KERNEL_MAX);
    expect(w[0]! + 2 * w.slice(1).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 12);
    let v = 0;
    for (let i = 1; i < w.length; i++) v += 2 * w[i]! * (i * SHADOW_TEXEL) ** 2;
    expect(Math.abs(Math.sqrt(v) / SHADOW_AMBIENT_BLUR - 1)).toBeLessThan(0.01);
  });

  it('the linear-sampled kernel is exactly the per-texel one (any input row)', () => {
    const w = ambientWeights();
    const k = ambientKernel();
    expect(k.offsets.length).toBe(SHADOW_KERNEL_MAX);
    const R = 2 * SHADOW_KERNEL_MAX;
    // a random row; bilinear sampling at fractional offsets = linear interpolation between texels
    const row = Array.from({ length: 4 * R + 1 }, (_, i) => Math.abs(Math.sin(i * 12.9898) * 43758.5453) % 1);
    const c = 2 * R;
    const lerp = (x: number): number => {
      const i = Math.floor(x);
      const t = x - i;
      return row[i]! * (1 - t) + row[i + 1]! * t;
    };
    let exact = w[0]! * row[c]!;
    for (let i = 1; i <= R; i++) exact += w[i]! * (row[c + i]! + row[c - i]!);
    let gpu = k.w0 * row[c]!;
    for (let j = 0; j < k.offsets.length; j++) gpu += k.weights[j]! * (lerp(c + k.offsets[j]!) + lerp(c - k.offsets[j]!));
    expect(gpu).toBeCloseTo(exact, 12);
  });

  it('shadowMix: 1 with both lobes full, linear in each', () => {
    expect(shadowMix(1, 1)).toBeCloseTo(1, 12);
    expect(shadowMix(0, 0)).toBe(0);
    expect(shadowMix(1, 0)).toBeCloseTo(SHADOW_CONTACT / SHADOW_MAX, 12);
    expect(shadowMix(0.5, 0.25)).toBeCloseTo((0.5 * SHADOW_CONTACT + 0.25 * SHADOW_AMBIENT) / SHADOW_MAX, 12);
  });
});

describe('frame fitting', () => {
  it('frameStep: powers of two between the minimum and the maximum extent', () => {
    expect(frameStep(0.5)).toBe(SHADOW_MIN_EXTENT);
    expect(frameStep(SHADOW_MIN_EXTENT)).toBe(SHADOW_MIN_EXTENT);
    expect(frameStep(SHADOW_MIN_EXTENT + 0.01)).toBe(2 * SHADOW_MIN_EXTENT);
    expect(frameStep(100)).toBe(128);
    expect(frameStep(1000)).toBe(SHADOW_MAX_EXTENT);
  });

  it('snapToTexel lands on the texel grid, at or below the value', () => {
    for (const v of [-3.07, -0.01, 0, 0.0625, 1.3, 17.99]) {
      const s = snapToTexel(v);
      expect(onGrid(s)).toBe(true);
      expect(s).toBeLessThanOrEqual(v + 1e-12);
      expect(v - s).toBeLessThan(SHADOW_TEXEL);
    }
  });

  it('only casters below SHADOW_H count; the region is their footprint plus the margin', () => {
    expect(shadowRegion([box(0, 3.5, 0, 1, 4, 1)], 0)).toBeNull();
    expect(fitFrame([box(0, 3.5, 0, 1, 4, 1)], 0)).toBeNull();
    expect(fitFrame([], 0)).toBeNull();
    const r = shadowRegion([box(0, 3.5, 0, 9, 4, 9), box(-1, 0.2, -2, 1, 1, 2)], 0)!;
    expect(r).toEqual({ x0: -1 - SHADOW_MARGIN, x1: 1 + SHADOW_MARGIN, z0: -2 - SHADOW_MARGIN, z1: 2 + SHADOW_MARGIN });
    // relative to the floor level
    expect(shadowRegion([box(0, 3.5, 0, 1, 4, 1)], 2)).not.toBeNull();
  });

  it('the frame holds the region, sits on the texel grid, sides are coarse steps', () => {
    for (const b of [box(0.3, 0, 0.1, 0.9, 1, 0.7), box(-7.2, -1, 3.3, 11.6, 0, 4.1), box(-40.05, 0, -2, 21.7, 1, 2)]) {
      const f = fitFrame([b], -1)!;
      expect(holds(f, shadowRegion([b], -1)!)).toBe(true);
      expect(onGrid(f.x0) && onGrid(f.z0)).toBe(true);
      for (const s of [f.w, f.d]) {
        expect(Math.log2(s) % 1).toBe(0);
        expect(s).toBeGreaterThanOrEqual(SHADOW_MIN_EXTENT);
        expect(s).toBeLessThanOrEqual(SHADOW_MAX_EXTENT);
      }
      const { nx, nz } = frameTexels(f);
      expect(nx).toBeLessThanOrEqual(SHADOW_TEX_MAX);
      expect(nz).toBeLessThanOrEqual(SHADOW_TEX_MAX);
    }
  });

  it('a model moving in small steps keeps its frame until it leaves it, then re-centres (on the grid)', () => {
    let f: ShadowFrame | null = null;
    let recentres = 0;
    let resizes = 0;
    for (let i = 0; i <= 400; i++) {
      const x = i * 0.037;
      const b = box(x, -0.5, 0, x + 7, 1.5, 3);
      const g: ShadowFrame = fitFrame([b], -0.46, f)!;
      if (f && (g.x0 !== f.x0 || g.z0 !== f.z0)) recentres++;
      if (f && (g.w !== f.w || g.d !== f.d)) resizes++;
      expect(holds(g, shadowRegion([b], -0.46)!)).toBe(true);
      expect(onGrid(g.x0)).toBe(true);
      f = g;
    }
    // 14.8 units of travel in a 16-unit frame: a handful of re-centres, never a resize
    expect(recentres).toBeGreaterThan(0);
    expect(recentres).toBeLessThan(10);
    expect(resizes).toBe(0);
  });

  it('hysteresis: a footprint at a step boundary does not flip the size; a much smaller one shrinks', () => {
    // (sizes relative to the margin: it grew from 2.25 to 5 units with the ambient lobe)
    const m2 = 2 * SHADOW_MARGIN;
    const big = fitFrame([box(0, 0, 0, 17.9 - m2, 1, 1)], 0)!; // needs 17.9 > 16 → 32
    expect(big.w).toBe(32);
    const small = fitFrame([box(0, 0, 0, 15 - m2, 1, 1)], 0, big)!; // needs < 16, but 32 ≤ 2·16 and still holds it: kept
    expect(small).toEqual(big);
    const tiny = fitFrame([box(0, 0, 0, 1, 1, 1)], 0, fitFrame([box(0, 0, 0, 60, 1, 1)], 0)!)!; // 128 > 2·16: shrinks
    expect(tiny.w).toBe(frameStep(1 + m2));
  });

  it('beyond the maximum extent: clamped to it, centred on the region', () => {
    const f = fitFrame([box(-100, 0, -1, 100, 1, 1)], 0)!;
    expect(f.w).toBe(SHADOW_MAX_EXTENT);
    expect(f.x0 + f.w / 2).toBeCloseTo(0, 0);
    expect(onGrid(f.x0)).toBe(true);
  });

  it('beyond the maximum extent: the frame holds the biggest group, not the gap between groups', () => {
    // a cart-sized group (three beams) at x 0…5 and a lone beam far away on either side
    const group = [box(0, -0.5, 0, 5, 0.5, 1), box(0, -0.5, 2, 5, 0.5, 3), box(0, -0.5, 4, 5, 0.5, 5)];
    for (const far of [130, 200, 1000, -200]) {
      const lone = box(far, -0.5, 0, far + 5, 0.5, 1);
      for (const order of [[...group, lone], [lone, ...group]]) {
        const f = fitFrame(order, -0.46)!;
        expect(f.w).toBe(SHADOW_MAX_EXTENT);
        // the group lies inside the frame, at least the margin from its edge
        expect(f.x0 + SHADOW_MARGIN).toBeLessThanOrEqual(0);
        expect(f.x0 + f.w - SHADOW_MARGIN).toBeGreaterThanOrEqual(5);
        expect(f.z0 + SHADOW_MARGIN).toBeLessThanOrEqual(0);
        expect(f.z0 + f.d - SHADOW_MARGIN).toBeGreaterThanOrEqual(5);
        expect(onGrid(f.x0) && onGrid(f.z0)).toBe(true);
      }
    }
    // diagonal groups: a 2-D window, not one axis from each group
    const a = [box(0, 0, 0, 6, 1, 6)];
    const b = [box(300, 0, 300, 303, 1, 303)];
    const w = clusterWindow([...b, ...a], null);
    expect(w.x0 <= 0 && w.x1 >= 6 && w.z0 <= 0 && w.z1 >= 6).toBe(true);
  });

  it('beyond the maximum extent: two equal groups do not flip; the frame follows a group as it moves', () => {
    const at = (x: number) => [box(x, 0, 0, x + 5, 1, 1), box(x + 200, 0, 0, x + 205, 1, 1)];
    let f = fitFrame(at(0), 0)!;
    const first = f.x0 < 100 ? 0 : 1;
    let flips = 0;
    for (let i = 1; i <= 200; i++) {
      const g = fitFrame(at(i * 0.3), 0, f)!;
      const side = g.x0 < 100 + i * 0.3 ? 0 : 1;
      if (side !== first) flips++;
      // the chosen group stays covered
      const gx = first === 0 ? i * 0.3 : i * 0.3 + 200;
      expect(g.x0 + SHADOW_MARGIN).toBeLessThanOrEqual(gx + 1e-9);
      expect(g.x0 + g.w - SHADOW_MARGIN).toBeGreaterThanOrEqual(gx + 5 - 1e-9);
      f = g;
    }
    expect(flips).toBe(0);
  });

  it('frameEdgeFade: 1 inside, 0 at the frame edge, over SHADOW_EDGE_FADE', () => {
    const f: ShadowFrame = { x0: 0, z0: 0, w: 16, d: 16 };
    expect(frameEdgeFade(f, 8, 8)).toBe(1);
    expect(frameEdgeFade(f, SHADOW_EDGE_FADE, 8)).toBe(1);
    expect(frameEdgeFade(f, 0, 8)).toBe(0);
    expect(frameEdgeFade(f, SHADOW_EDGE_FADE / 2, 8)).toBeCloseTo(0.5, 12);
  });
});

// ------------------------------------------------------------------------------------------
// When the viewport re-renders the shadow (Viewport internals on a stand-in object).

type Proto = Record<string, (...a: unknown[]) => unknown>;
const P = Viewport.prototype as unknown as Proto;

function fakeViewport() {
  const renders: number[] = [];
  const pv = {
    id: 1,
    origin: [0, 0, 0],
    geo: { box: { min: [-0.5, -0.5, -0.5], max: [0.5, 0.5, 0.5] } },
    colorMesh: { matrix: new THREE.Matrix4(), matrixWorldNeedsUpdate: false, visible: true },
    idMesh: { matrix: new THREE.Matrix4(), matrixWorldNeedsUpdate: false, visible: true },
    shadowMesh: { matrix: new THREE.Matrix4(), matrixWorldNeedsUpdate: false, visible: true },
  };
  const vp = {
    views: new Map([[1, pv]]),
    hidden: new Set<number>(),
    transforms: new Map<number, { p: number[]; q: number[] }>(),
    floorState: null as null | { y: number },
    shadowDirty: true,
    tmpMatrix: new THREE.Matrix4(),
    renderer: {},
    shadow: { render: (_r: unknown, y: number) => renders.push(y) },
    requestRender() {},
    partMatrix: P.partMatrix,
    applyMatrix: P.applyMatrix,
    applyVisibility: P.applyVisibility,
    worldBox: P.worldBox,
    updateShadow: P.updateShadow,
    setFloor: P.setFloor,
    setPartTransform: P.setPartTransform,
    setPartVisible: P.setPartVisible,
    setCamera: P.setCamera,
  };
  return { vp, renders, pv };
}

describe('Viewport: the shadow texture is re-rendered only when something it shows changed', () => {
  it('pose, visibility and floor level re-render once; repeats and no-ops do not', () => {
    const { vp, renders } = fakeViewport();
    const call = (name: string, ...a: unknown[]) => (vp as unknown as Proto)[name]!.apply(vp, a);
    call('updateShadow');
    expect(renders.length).toBe(0); // no floor: nothing
    call('setFloor', { y: -0.46 });
    call('updateShadow');
    call('updateShadow');
    expect(renders).toEqual([-0.46]);
    call('setFloor', { y: -0.46 }); // same level
    call('updateShadow');
    expect(renders.length).toBe(1);
    call('setPartTransform', 1, [0.1, 0, 0], [0, 0, 0, 1]);
    call('updateShadow');
    expect(renders.length).toBe(2);
    call('setPartTransform', 1, [0.1, 0, 0], [0, 0, 0, 1]); // the same pose again (a paused simulation)
    call('updateShadow');
    expect(renders.length).toBe(2);
    call('setPartVisible', 1, false);
    call('updateShadow');
    call('setPartVisible', 1, false);
    call('updateShadow');
    expect(renders.length).toBe(3);
    call('setFloor', { y: -1 });
    call('updateShadow');
    expect(renders).toEqual([-0.46, -0.46, -0.46, -1]);
  });
});
