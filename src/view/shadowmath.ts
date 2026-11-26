// The ground's contact shadow (DESIGN.md §6.1 "Ground"): constants and the pure parts — the
// strength of a surface at a height above the floor, the Gaussian kernels in texels, and the
// fitting / snapping of the shadow texture's frame. No three.js here (unit-tested in Node);
// the GPU side is src/view/shadow.ts.
//
// Two lobes (DEVIATIONS §6 "Contact shadow"): the spec's single σ = 0.35 Gaussian gave a crisp
// footprint that, from the default isometric view, hides almost entirely under the part casting
// it (a beam lying on the floor showed only a faint 1-px halo; the owner's review: "probably yes,
// but faintly"). So the same height field (1 − h/SHADOW_H)² is blurred twice: a *contact* lobe
// (σ = SHADOW_BLUR, the crisp dark footprint) and a broad *ambient* lobe (σ = SHADOW_AMBIENT_BLUR,
// the soft skirt that shows past the part's silhouette from above). Strength 1 = SHADOW_MAX opacity
// = SHADOW_CONTACT + SHADOW_AMBIENT, reached under a wide footprint touching the floor.
//
// The texture's texel is a FIXED world size (SHADOW_TEXEL), and its frame's origin is always a
// multiple of it: the texel grid is one fixed grid in world space. So a moving model is always
// sampled at the same world points, whatever the frame's size or centre, and its shadow can
// neither swim (sub-texel motion is carried exactly by the rasterisation and the bilinear lookup)
// nor pop when the frame re-centres or changes size (that changes only which texels exist).
// The frame's size per axis is a power of two of units between SHADOW_MIN_EXTENT and
// SHADOW_MAX_EXTENT (coarse steps, so the render targets are rarely re-allocated).

/** Opacity of the contact lobe (near-black) under a wide surface touching the floor. */
export const SHADOW_CONTACT = 0.42;
/** Opacity of the ambient lobe under a wide surface touching the floor. */
export const SHADOW_AMBIENT = 0.42;
/** Opacity of the shadow's near-black colour at strength 1 (both lobes at full). */
export const SHADOW_MAX = SHADOW_CONTACT + SHADOW_AMBIENT;
/** Height above the floor (world units) at and above which a surface casts nothing. */
export const SHADOW_H = 3;
/** Gaussian σ of the contact lobe's blur, in world units (the same at every zoom and frame size). */
export const SHADOW_BLUR = 0.35;
/** Gaussian σ of the ambient lobe's blur, world units. */
export const SHADOW_AMBIENT_BLUR = 0.9;
/** World size of one shadow texel (fixed: the texel grid is fixed in world space). */
export const SHADOW_TEXEL = 0.125;
/** Smallest and largest frame side, world units (powers of two). */
export const SHADOW_MIN_EXTENT = 8;
export const SHADOW_MAX_EXTENT = 128;
/** Largest texture side in texels (SHADOW_MAX_EXTENT / SHADOW_TEXEL). */
export const SHADOW_TEX_MAX = SHADOW_MAX_EXTENT / SHADOW_TEXEL;
/** Largest kernel radius (taps each side) the blur shader supports, per lobe. */
export const SHADOW_KERNEL_MAX = 16;
/**
 * Reach of the ambient lobe's kernel (world units): SHADOW_KERNEL_MAX linear-sampled taps, each
 * covering two texels (4σ for σ = 1).
 */
export const SHADOW_AMBIENT_REACH = 2 * SHADOW_KERNEL_MAX * SHADOW_TEXEL;
/**
 * Margin around the casters' footprint (world units): the widest blur's reach plus
 * SHADOW_EDGE_FADE, so the shadow is 0 where the floor shader's edge fade starts and no frame edge
 * ever shows.
 */
export const SHADOW_EDGE_FADE = 1;
export const SHADOW_MARGIN =
  Math.ceil((Math.max(3 * SHADOW_BLUR, SHADOW_AMBIENT_REACH) + SHADOW_EDGE_FADE) / SHADOW_TEXEL) * SHADOW_TEXEL;

/**
 * Strength (0…1, 1 = SHADOW_MAX opacity) under a surface `h` world units above the floor, before
 * the blur: (1 − h/SHADOW_H)² below SHADOW_H, 0 above; a surface at or under the floor gives 1.
 */
export function shadowStrength(h: number, H = SHADOW_H): number {
  if (h >= H) return 0;
  const t = 1 - Math.max(0, h) / H;
  return t * t;
}

/**
 * Normalised 1-D Gaussian weights for σ = `sigma` world units on a grid of `texel` world units:
 * w[0] is the centre tap, w[i] the taps at ±i (so w[0] + 2·Σ w[i] = 1). Radius ⌈3σ/texel⌉,
 * capped at SHADOW_KERNEL_MAX.
 */
export function gaussianKernel(sigma = SHADOW_BLUR, texel = SHADOW_TEXEL): number[] {
  const s = sigma / texel;
  const r = Math.min(SHADOW_KERNEL_MAX, Math.max(1, Math.ceil(3 * s)));
  const w: number[] = [];
  for (let i = 0; i <= r; i++) w.push(Math.exp(-(i * i) / (2 * s * s)));
  const sum = w[0]! + 2 * w.slice(1).reduce((a, b) => a + b, 0);
  return w.map((x) => x / sum);
}

/**
 * Exact per-texel weights of the ambient lobe: a Gaussian of σ = `sigma` world units on the texel
 * grid, radius 2·SHADOW_KERNEL_MAX texels, normalised (w[0] + 2·Σ w[i] = 1).
 */
export function ambientWeights(sigma = SHADOW_AMBIENT_BLUR, texel = SHADOW_TEXEL): number[] {
  const s = sigma / texel;
  const r = 2 * SHADOW_KERNEL_MAX;
  const w: number[] = [];
  for (let i = 0; i <= r; i++) w.push(Math.exp(-(i * i) / (2 * s * s)));
  const sum = w[0]! + 2 * w.slice(1).reduce((a, b) => a + b, 0);
  return w.map((x) => x / sum);
}

/**
 * The ambient lobe's kernel as the GPU applies it with linear (bilinear) sampling: the centre tap
 * w0 and SHADOW_KERNEL_MAX taps per side, tap k covering texels 2k+1 and 2k+2 at a fractional
 * offset between them — exactly ambientWeights(), with half the texture reads.
 */
export function ambientKernel(sigma = SHADOW_AMBIENT_BLUR, texel = SHADOW_TEXEL): { w0: number; offsets: number[]; weights: number[] } {
  const w = ambientWeights(sigma, texel);
  const offsets: number[] = [];
  const weights: number[] = [];
  for (let k = 0; k < SHADOW_KERNEL_MAX; k++) {
    const a = w[2 * k + 1]!;
    const b = w[2 * k + 2]!;
    weights.push(a + b);
    offsets.push(2 * k + 1 + (a + b > 0 ? b / (a + b) : 0));
  }
  return { w0: w[0]!, offsets, weights };
}

/** Strength (0…1, 1 = SHADOW_MAX opacity) from the two blurred lobes (each 0…1). */
export function shadowMix(contact: number, ambient: number): number {
  return (SHADOW_CONTACT * contact + SHADOW_AMBIENT * ambient) / SHADOW_MAX;
}

/** The shadow texture's frame on the floor: x ∈ [x0, x0 + w], z ∈ [z0, z0 + d] (world units). */
export interface ShadowFrame {
  x0: number;
  z0: number;
  w: number;
  d: number;
}

/** A caster's world box (only x/z extents and the lowest y matter). */
export interface CasterBox {
  min: readonly [number, number, number];
  max: readonly [number, number, number];
}

/** Smallest power-of-two side in [SHADOW_MIN_EXTENT, SHADOW_MAX_EXTENT] that holds `need`. */
export function frameStep(need: number): number {
  let s = SHADOW_MIN_EXTENT;
  while (s < need && s < SHADOW_MAX_EXTENT) s *= 2;
  return s;
}

/** Snap a world coordinate down to the texel grid. */
export function snapToTexel(v: number): number {
  return Math.floor(v / SHADOW_TEXEL + 1e-9) * SHADOW_TEXEL;
}

/**
 * The region the shadow must cover: the x/z extent of every caster whose lowest point is less than
 * SHADOW_H above the floor, grown by SHADOW_MARGIN; null when nothing is that close to the floor.
 */
export function shadowRegion(boxes: readonly CasterBox[], floorY: number): { x0: number; x1: number; z0: number; z1: number } | null {
  let x0 = Infinity;
  let x1 = -Infinity;
  let z0 = Infinity;
  let z1 = -Infinity;
  for (const b of boxes) {
    if (b.min[1] - floorY >= SHADOW_H) continue;
    x0 = Math.min(x0, b.min[0]);
    x1 = Math.max(x1, b.max[0]);
    z0 = Math.min(z0, b.min[2]);
    z1 = Math.max(z1, b.max[2]);
  }
  if (!(x0 <= x1 && z0 <= z1)) return null;
  return { x0: x0 - SHADOW_MARGIN, x1: x1 + SHADOW_MARGIN, z0: z0 - SHADOW_MARGIN, z1: z1 + SHADOW_MARGIN };
}

/** One axis of fitFrame: [lo, hi] needed, previous origin / size (or null). */
function fitAxis(lo: number, hi: number, prev: { o: number; s: number } | null): { o: number; s: number } {
  const need = hi - lo;
  const step = frameStep(need);
  // Keep the previous frame while it still holds the region and is at most one step too big
  // (hysteresis: a model hovering at a step boundary does not flip the size every frame).
  if (prev && prev.s >= step && prev.s <= 2 * step && prev.o <= lo + 1e-9 && prev.o + prev.s >= hi - 1e-9) return prev;
  if (need > SHADOW_MAX_EXTENT - 1e-9) {
    // At the maximum extent (fitFrame has already chosen the window): on the texel grid.
    return { o: snapToTexel((lo + hi) / 2 - SHADOW_MAX_EXTENT / 2), s: SHADOW_MAX_EXTENT };
  }
  // Centred on the region, origin on the texel grid; it still holds the region after snapping
  // (step ≥ need, and snapping moves the origin down by < one texel — grow one step if not).
  let s = step;
  for (;;) {
    const o = snapToTexel((lo + hi) / 2 - s / 2);
    if (o + s >= hi - 1e-9 || s >= SHADOW_MAX_EXTENT) return { o, s };
    s *= 2;
  }
}

/** Overlap area of a caster's floor footprint (at least SHADOW_TEXEL wide) with a window. */
function overlapArea(b: CasterBox, x0: number, x1: number, z0: number, z1: number): number {
  const bx0 = Math.min(b.min[0], b.max[0] - SHADOW_TEXEL);
  const bz0 = Math.min(b.min[2], b.max[2] - SHADOW_TEXEL);
  const w = Math.min(x1, b.max[0]) - Math.max(x0, bx0);
  const d = Math.min(z1, b.max[2]) - Math.max(z0, bz0);
  return w > 0 && d > 0 ? w * d : 0;
}

/** A switch of the >SHADOW_MAX_EXTENT window needs this much more footprint than the kept one. */
export const SHADOW_SWITCH_GAIN = 1.25;

/**
 * For casters spread wider than SHADOW_MAX_EXTENT: the SHADOW_MAX_EXTENT-square window (its inside,
 * less the margin, is what gets a full shadow) holding the most caster footprint area — so a model
 * with a group far from the rest (a vehicle driven away, a part left behind) keeps the shadow of
 * its biggest group instead of a window centred on the empty gap between them. Candidates: windows
 * centred on, or aligned with either side of, each caster's footprint.
 *
 * Hysteresis (DESIGN §6.1 "Stability"): with a previous frame, the *kept* window is that frame
 * carried along with the casters in it (the casters overlapping it now, which a frame-to-frame
 * motion cannot have taken out of it; shifted by the least texel-grid step that keeps their
 * footprint plus the margin inside, when that fits) — and it is kept unless another candidate holds
 * at least SHADOW_SWITCH_GAIN times its footprint. Footprint scores wobble as arms swing and bodies
 * bounce; review found two similar carts 150 apart trading the shadow 16 times in 3 s when only an
 * exact tie kept the previous window. Among equal best challengers the one nearest the previous
 * window wins, then the first. Model-only (never the camera), deterministic.
 */
export function clusterWindow(boxes: readonly CasterBox[], prev: ShadowFrame | null): { x0: number; x1: number; z0: number; z1: number } {
  const M = SHADOW_MAX_EXTENT;
  const inner = M - 2 * SHADOW_MARGIN;
  const score = (ox: number, oz: number): number => {
    let s = 0;
    for (const b of boxes) s += overlapArea(b, ox + SHADOW_MARGIN, ox + SHADOW_MARGIN + inner, oz + SHADOW_MARGIN, oz + SHADOW_MARGIN + inner);
    return s;
  };
  const win = (ox: number, oz: number) => ({ x0: ox, x1: ox + M, z0: oz, z1: oz + M });
  const cands: { ox: number; oz: number; s: number }[] = [];
  for (const b of boxes) {
    const cx = (b.min[0] + b.max[0]) / 2;
    const cz = (b.min[2] + b.max[2]) / 2;
    const xs = [cx - M / 2, b.min[0] - SHADOW_MARGIN, b.max[0] + SHADOW_MARGIN + SHADOW_TEXEL - M]; // (+1 texel: snapping moves down)
    const zs = [cz - M / 2, b.min[2] - SHADOW_MARGIN, b.max[2] + SHADOW_MARGIN + SHADOW_TEXEL - M];
    for (const ox of xs) for (const oz of zs) cands.push({ ox, oz, s: score(ox, oz) });
  }
  const pickBest = (): { ox: number; oz: number; s: number } => {
    const top = Math.max(...cands.map((c) => c.s));
    const near = prev ? (c: { ox: number; oz: number }) => Math.hypot(c.ox - prev.x0, c.oz - prev.z0) : () => 0;
    let best = cands.find((c) => c.s >= top - 1e-9 * Math.max(1, top))!;
    for (const c of cands) if (c.s >= top - 1e-9 * Math.max(1, top) && near(c) < near(best) - 1e-12) best = c;
    return best;
  };
  if (!prev) {
    const b = pickBest();
    return win(b.ox, b.oz);
  }
  const kept = carryFrame(boxes, prev);
  const keptScore = score(kept.ox, kept.oz);
  const best = pickBest();
  if (best.s > keptScore && best.s >= SHADOW_SWITCH_GAIN * keptScore) return win(best.ox, best.oz);
  return win(kept.ox, kept.oz);
}

/**
 * The previous frame as a SHADOW_MAX_EXTENT square (same centre, snapped to the texel grid when it
 * was smaller), carried along with the casters overlapping it: per axis, moved by the least whole
 * number of texels that puts their footprint (plus the margin) inside it, when it fits; else kept.
 */
function carryFrame(boxes: readonly CasterBox[], prev: ShadowFrame): { ox: number; oz: number } {
  const M = SHADOW_MAX_EXTENT;
  let ox = prev.w === M ? prev.x0 : snapToTexel(prev.x0 + prev.w / 2 - M / 2);
  let oz = prev.d === M ? prev.z0 : snapToTexel(prev.z0 + prev.d / 2 - M / 2);
  let x0 = Infinity;
  let x1 = -Infinity;
  let z0 = Infinity;
  let z1 = -Infinity;
  for (const b of boxes) {
    if (b.max[0] <= prev.x0 || b.min[0] >= prev.x0 + prev.w || b.max[2] <= prev.z0 || b.min[2] >= prev.z0 + prev.d) continue;
    x0 = Math.min(x0, b.min[0]);
    x1 = Math.max(x1, b.max[0]);
    z0 = Math.min(z0, b.min[2]);
    z1 = Math.max(z1, b.max[2]);
  }
  if (!(x0 <= x1)) return { ox, oz };
  const carry = (o: number, lo: number, hi: number): number => {
    lo -= SHADOW_MARGIN;
    hi += SHADOW_MARGIN;
    if (hi - lo > M) return o;
    if (o > lo + 1e-9) return o - Math.ceil((o - lo) / SHADOW_TEXEL - 1e-9) * SHADOW_TEXEL;
    if (o + M < hi - 1e-9) return o + Math.ceil((hi - o - M) / SHADOW_TEXEL - 1e-9) * SHADOW_TEXEL;
    return o;
  };
  ox = carry(ox, x0, x1);
  oz = carry(oz, z0, z1);
  return { ox, oz };
}

/**
 * The frame for these casters (null: nothing within SHADOW_H of the floor). Reuses `prev` per axis
 * while it still covers the region (so the frame stays put as a model moves within it), else
 * re-centres on the region with the smallest power-of-two side; the origin is always on the texel
 * grid. When the region is wider than SHADOW_MAX_EXTENT, the frame is the clusterWindow (the
 * SHADOW_MAX_EXTENT square holding most of the casters); what is outside gets no shadow.
 */
export function fitFrame(boxes: readonly CasterBox[], floorY: number, prev: ShadowFrame | null = null): ShadowFrame | null {
  let r = shadowRegion(boxes, floorY);
  if (!r) return null;
  if (r.x1 - r.x0 > SHADOW_MAX_EXTENT || r.z1 - r.z0 > SHADOW_MAX_EXTENT) {
    r = clusterWindow(
      boxes.filter((b) => b.min[1] - floorY < SHADOW_H),
      prev,
    );
  }
  const ax = fitAxis(r.x0, r.x1, prev ? { o: prev.x0, s: prev.w } : null);
  const az = fitAxis(r.z0, r.z1, prev ? { o: prev.z0, s: prev.d } : null);
  return { x0: ax.o, z0: az.o, w: ax.s, d: az.s };
}

/** Texture size (texels) of a frame. */
export function frameTexels(f: ShadowFrame): { nx: number; nz: number } {
  return { nx: Math.round(f.w / SHADOW_TEXEL), nz: Math.round(f.d / SHADOW_TEXEL) };
}

/**
 * Fade toward the frame's edges (1 inside, 0 at the edge, over SHADOW_EDGE_FADE units): only ever
 * visible for a model wider than SHADOW_MAX_EXTENT (elsewhere the margin keeps the shadow ~0 there).
 * The floor shader applies the same rule.
 */
export function frameEdgeFade(f: ShadowFrame, x: number, z: number): number {
  const e = Math.min(x - f.x0, f.x0 + f.w - x, z - f.z0, f.z0 + f.d - z);
  const t = Math.min(1, Math.max(0, e / SHADOW_EDGE_FADE));
  return t * t * (3 - 2 * t);
}
