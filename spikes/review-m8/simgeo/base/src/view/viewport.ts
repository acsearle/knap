// The 3D viewport: parts, outlines, overlays, camera navigation, view cube and pointer plumbing.
// Public API documented in src/view/index.ts.
import * as THREE from 'three';
import { DIRS, effectiveRootId } from '../core';
import type { Cell, Dir, Model, Part } from '../core';
import { buildPartMesh, geometryReady, initGeometry, partOrigin, partSignature } from '../geometry';
import { glyphSegments } from './glyphs';
import type { JointGlyph, RigidTransform } from './glyphs';
import { Floor, floorEdgeAlpha } from './floor';
import type { FloorState } from './floor';
import { Grid } from './grid';
import { FatLines, SegmentBuilder, createLineUniforms, rgba } from './lines';
import { createFillMaterial, createGhostMaterial, createPartMaterial } from './materials';
import {
  cameraBasis,
  defaultCamera,
  easeInOut,
  fitBox,
  fitPoints,
  interpolateCamera,
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
  unionBoxes,
  zoomAt,
} from './math';
import type { Box3, CameraState, Ray, Vec3, ViewDir } from './math';
import { DEFAULT_OUTLINE, OutlinePass, createIdMaterial } from './outline';
import type { OutlineParams } from './outline';
import { markColor, markWeights } from './markpaint';
import { vertexPatches } from './patches';
import { ContactShadow } from './shadow';
import type { CasterBox, ShadowFrame } from './shadowmath';
import { MARK, placeMark, rootAnchorIndex } from './rootmarker';
import { ViewCube } from './viewcube';

// ------------------------------------------------------------------------------------------
// Public types

export type Vec3Like = readonly [number, number, number] | { x: number; y: number; z: number };
export type QuatLike = readonly [number, number, number, number] | { x: number; y: number; z: number; w: number };

export interface ViewportOptions {
  /** Background colour (default '#f7f7f5'). */
  background?: string;
  /** Ink line width in CSS px (default 1.25). */
  outlineWidth?: number;
  /** Selection outline width in CSS px (default 2.5). */
  selectionWidth?: number;
  /** Accent colour used for selection, hover and the valid ghost (default '#1f7ae0'). */
  accent?: string;
  /** Handle the F (fit) and Home keys on window (default true). */
  keyboard?: boolean;
  /** Show the view cube with Home/Fit buttons (default true). */
  viewCube?: boolean;
  /** ID-buffer texels per device pixel; 'auto' = 2 (stepping down to 1.5, then 1, above a size/memory cap). */
  supersample?: number | 'auto';
  /** Snap/fit animation duration in ms (default 250). */
  animationMs?: number;
}

/** Pointer information delivered to the host for non-navigation input. */
export interface ViewportPointerEvent {
  /** CSS px relative to the viewport's top-left. */
  x: number;
  y: number;
  clientX: number;
  clientY: number;
  /** World-space pick ray under the pointer (orthographic: parallel rays). */
  ray: Ray;
  /** Button that changed (click / drag start); -1 for hover moves. */
  button: number;
  buttons: number;
  shiftKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  metaKey: boolean;
  pointerType: string;
}

/**
 * Lets the host take over a left-button drag before it becomes an orbit (e.g. grabbing a body in
 * simulate mode). `claim` is called once, when a left press (without Shift) has moved ≥ 4 px,
 * with the event at the *press* position; return true to own the drag. Then `move` gets every
 * pointer move and `end` the release (or cancel).
 */
export interface DragHandler {
  claim(press: ViewportPointerEvent, current: ViewportPointerEvent): boolean;
  move(e: ViewportPointerEvent): void;
  end(e: ViewportPointerEvent, cancelled: boolean): void;
}

export interface HoverFace {
  /** Cell position (integer). */
  cell: readonly [number, number, number];
  /** Face direction 0..5 = +X, −X, +Y, −Y, +Z, −Z. */
  dir: Dir;
  /** Default: the accent colour. */
  color?: string;
  /** Colour of the part the highlight is drawn over (overlayStyle: white fill, bold outline if close). */
  over?: string;
  /**
   * Seen through the part (Back side, §7.3: the face is on the far side): drawn on top of
   * everything instead of depth-tested, so it reads through the part in front of it.
   */
  xray?: boolean;
}

export interface HoverCell {
  cell: readonly [number, number, number];
  /** Default red (erase). */
  color?: string;
  /** Colour of the part under it (see HoverFace.over). */
  over?: string;
}

/**
 * A band of a wheel to highlight (Erase / Shift+Wheel: the half-unit a click removes): radii r0..r1
 * about the hub's axis, in the hub's layer (one cell thick).
 */
export interface HoverRing {
  hub: readonly [number, number, number];
  axis: 0 | 1 | 2;
  r0: number;
  r1: number;
  /** Default red. */
  color?: string;
  /** Colour of the part under it (see HoverFace.over). */
  over?: string;
}

export interface Ghost {
  cell: Cell;
  /** Further cells of the same prospective part (a deep insert); drawn fused with `cell`. */
  extra?: readonly Cell[];
  valid: boolean;
  /** Built on the far side of a part (Back side): the parts of it behind geometry are drawn stronger. */
  xray?: boolean;
  /** Colour of the part it is drawn over or through (see HoverFace.over). */
  over?: string;
}

export type FitTarget = 'all' | 'selection' | readonly number[] | Box3;

export interface CameraAnimOptions {
  /** Animate (default true). */
  animate?: boolean;
}

// ------------------------------------------------------------------------------------------
// Internals

/** Floor draw order: before the grid (−100) when it is below the grid, after it when above. */
const FLOOR_UNDER_GRID_ORDER = -110;
const FLOOR_OVER_GRID_ORDER = -90;

/** Hover face fill opacity; seen through the part (Back side) it is drawn on top, a bit lighter. */
const HOVER_FACE_OPACITY = 0.28;
/** Fill opacities of the bold (white-filled) overlays, and the erase cell / ring fills. */
const HOVER_BOLD_OPACITY = 0.5;
const HOVER_BOLD_XRAY_OPACITY = 0.42;
const HOVER_CELL_OPACITY = 0.16;
const HOVER_CELL_BOLD_OPACITY = 0.32;
const HOVER_RING_OPACITY = 0.2;
const HOVER_RING_BOLD_OPACITY = 0.4;
/** Silhouette rim (in the semantic colour) of a bold, white ghost. */
const GHOST_BOLD_RIM = 1;
/** Falloff of that rim (rim^p, rim = 1 − |n·view|): broader than the white see-through rim's 3. */
const GHOST_BOLD_RIM_POW = 0.7;
const HOVER_FACE_XRAY_OPACITY = 0.22;
/** The ghost where geometry is in front of it; stronger for a Back side proposal (always behind). */
const GHOST_HIDDEN_OPACITY = 0.16;
const GHOST_XRAY_HIDDEN_OPACITY = 0.32;
/** Light silhouette rim on the hidden ghost (see GHOST_FRAG): stronger when built through a part. */
const GHOST_HIDDEN_RIM = 0.5;
const GHOST_XRAY_HIDDEN_RIM = 0.9;

interface GeoEntry {
  geometry: THREE.BufferGeometry;
  refs: number;
  box: Box3; // local
  /** Distinct local vertex positions (for fitting), built on first use. */
  points?: Float32Array;
}

interface PartView {
  id: number;
  part: Part;
  sig: string;
  origin: Vec3;
  geo: GeoEntry;
  slot: number;
  colorMesh: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
  idMesh: THREE.Mesh<THREE.BufferGeometry, THREE.RawShaderMaterial>;
  /** Draws the part into the contact shadow's texture (shadow.ts). */
  shadowMesh: THREE.Mesh;
  color: string;
}

type Gesture =
  | {
      kind: 'pending';
      mode: 'left' | 'pan';
      button: number;
      startX: number;
      startY: number;
      press: ViewportPointerEvent;
      id: number;
      /** Pressed on the view cube (right / middle button): may pan, never a host click. */
      onCube: boolean;
    }
  | { kind: 'cube'; startX: number; startY: number; dir: ViewDir | null; id: number }
  | { kind: 'orbit'; lastX: number; lastY: number; id: number }
  | { kind: 'pan'; lastX: number; lastY: number; id: number }
  | { kind: 'host'; id: number };

const CLICK_SLOP = 4;
/** Supersampled ID buffers are used only while each side stays ≤ this and texels ≤ the budget. */
const SS_MAX_SIDE = 8192;
const SS_TEXEL_BUDGET = 4096 * 4096; // ≈ 335 MB of outline targets at ≈ 20 B/texel
const STYLE_ID = 'knap-view-style';
let liveViewports = 0;
const STYLE = `
.kv-root{position:relative;overflow:hidden;}
.kv-canvas{display:block;width:100%;height:100%;touch-action:none;outline:none;user-select:none;-webkit-user-select:none;}
.kv-buttons{position:absolute;display:flex;flex-direction:column;gap:6px;z-index:2;}
.kv-btn{width:30px;height:30px;padding:0;border:1px solid #c9cdd2;border-radius:6px;background:#fbfbfa;color:#3a3f45;
  display:flex;align-items:center;justify-content:center;cursor:pointer;box-shadow:0 1px 2px rgba(0,0,0,.06);}
.kv-btn:hover{background:#eef4fd;border-color:#8db6ec;color:#1f5fb4;}
.kv-btn:active{background:#dfeafa;}
.kv-btn:focus-visible{outline:2px solid #1f7ae0;outline-offset:1px;}
.kv-btn svg{width:18px;height:18px;display:block;}
`;

const ICON_HOME = `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"><path d="M3.5 9.2 10 3.8l6.5 5.4"/><path d="M5.3 8v8.2h3.6v-4.6h2.2v4.6h3.6V8"/></svg>`;
const ICON_FIT = `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M3.5 7.5v-4h4M12.5 3.5h4v4M16.5 12.5v4h-4M7.5 16.5h-4v-4"/><rect x="7" y="7" width="6" height="6" rx="0.8"/></svg>`;

function v3(v: Vec3Like): Vec3 {
  return Array.isArray(v) ? [v[0], v[1], v[2]] : [(v as { x: number }).x, (v as { y: number }).y, (v as { z: number }).z];
}
function q4(q: QuatLike): [number, number, number, number] {
  if (Array.isArray(q)) return [q[0], q[1], q[2], q[3]];
  const o = q as { x: number; y: number; z: number; w: number };
  return [o.x, o.y, o.z, o.w];
}

/** sRGB distance below which an overlay's colour counts as close to the part under it. */
export const OVERLAY_CLOSE = 0.3;
/** Fill colour of an overlay drawn over a part of (nearly) its own colour. */
export const OVERLAY_CLOSE_FILL = '#ffffff';

/** How an overlay is drawn: its semantic colour for the lines, the fill colour, and whether it is bold. */
export interface OverlayStyle {
  /** The semantic colour (accent = a click will do this, red = refused or erase): always the lines'. */
  line: string;
  /** The fill: the semantic colour, or white over a part close to it. */
  fill: string;
  /** Over a part close to the semantic colour: white fill, outline at double width. */
  bold: boolean;
}

/**
 * How to draw an overlay (hover face, erase cell or ring, ghost) of semantic colour `color` over a
 * part of colour `over` (§7.3 "Hue keeps its meaning on every part colour"): the hue never changes —
 * the accent always means "a click will do this", red always "refused" or "erase". When the two
 * colours are close (sRGB distance < OVERLAY_CLOSE: the blue accent over a blue wheel, the red erase
 * band over a red or orange part) the *treatment* changes instead: a white fill, and the outline in
 * the semantic colour at double width over the white under-stroke (applyHalo). (A first version
 * switched hue — orange over blue, dark red over red — so a valid face on the Cart turned orange and
 * an invalid one red 6 px apart, and dark red on red read as a plain dark outline.)
 */
export function overlayStyle(color: string, over?: string): OverlayStyle {
  if (!over) return { line: color, fill: color, bold: false };
  const a = rgba(color);
  const b = rgba(over);
  const bold = Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) < OVERLAY_CLOSE;
  return { line: color, fill: bold ? OVERLAY_CLOSE_FILL : color, bold };
}

/** A light under-stroke for overlay lines: the same segments, white, drawn wider just before them. */
function applyHalo(sb: SegmentBuilder, halo: FatLines): void {
  halo.setSegments(new Float32Array(sb.ends), [1, 1, 1, 0.9]);
  halo.visible = true;
}

function srgbTriple(hex: string): [number, number, number] {
  const c = rgba(hex);
  return [c[0], c[1], c[2]];
}

// ------------------------------------------------------------------------------------------

export class Viewport {
  /** Await the geometry WASM, then construct. */
  static async create(container: HTMLElement, opts: ViewportOptions = {}): Promise<Viewport> {
    await initGeometry();
    return new Viewport(container, opts);
  }

  readonly container: HTMLElement;
  readonly canvas: HTMLCanvasElement;
  readonly renderer: THREE.WebGLRenderer;

  private readonly opts: Required<ViewportOptions>;
  private readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 100);
  private readonly colorScene = new THREE.Scene();
  private readonly idScene = new THREE.Scene();
  private readonly overlayScene = new THREE.Scene();
  private readonly outline = new OutlinePass();
  private readonly outlineParams: OutlineParams;
  private readonly lineUniforms = createLineUniforms();
  private readonly grid = new Grid();
  private readonly floor = new Floor();
  private floorState: FloorState | null = null;
  private readonly shadow = new ContactShadow();
  /** A part's pose, the model, part visibility or the floor level changed since the last shadow render. */
  private shadowDirty = true;
  private readonly floorEdge: FatLines;
  private readonly cube: ViewCube | null;
  private readonly buttons: HTMLElement | null;

  // parts
  private readonly views = new Map<number, PartView>();
  private readonly geoCache = new Map<string, GeoEntry>();
  private readonly freeSlots: number[] = [];
  private nextSlot = 1;
  private model: Model | null = null;
  private readonly transforms = new Map<number, RigidTransform>();
  private readonly hidden = new Set<number>();
  private colorOverrides: ReadonlyMap<number, string> | null = null;
  private selection = new Set<number>();
  private rootId: number | null = null;

  // overlays
  private readonly hoverFaceFill: THREE.Mesh;
  private readonly hoverFaceLines: FatLines;
  /** Light under-strokes of the hover lines (legible over a part of the overlay's own hue or a dark one). */
  private readonly hoverFaceHalo: FatLines;
  /** The hover face / cell / ring is drawn bold (overlayStyle). */
  private hoverFaceBold = false;
  private hoverCellBold = false;
  private hoverRingBold = false;
  private readonly hoverCellHalo: FatLines;
  private readonly hoverRingHalo: FatLines;
  private readonly hoverCellFill: THREE.Mesh;
  private readonly hoverCellLines: FatLines;
  private readonly hoverRingFill: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  private readonly hoverRingLines: FatLines;
  private readonly ghostVisible: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
  private readonly ghostHidden: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
  private ghostGeo: { sig: string; entry: GeoEntry } | null = null;
  private readonly glyphHalo: FatLines;
  private readonly glyphLines: FatLines;
  private glyphs: JointGlyph[] = [];
  private glyphsVisible = true;
  private readonly rootHalo: FatLines;
  private readonly rootLines: FatLines;
  private rootMarkerVisible = true;
  private gridVisible = true;

  // camera
  private cam: CameraState = defaultCamera();
  private anim: { from: CameraState; to: CameraState; t0: number; dur: number } | null = null;
  /**
   * Visible world rectangle the user last chose (height · aspect × height). A resize keeps it
   * fully visible (the height grows when the viewport gets narrower) and returns to it when the
   * viewport widens again; only camera changes other than resizes update it.
   */
  private viewRect: { w: number; h: number } | null = null;
  private readonly cameraListeners = new Set<(s: CameraState) => void>();

  // input
  private gesture: Gesture | null = null;
  private readonly hoverListeners = new Set<(e: ViewportPointerEvent | null) => void>();
  private readonly clickListeners = new Set<(e: ViewportPointerEvent) => void>();
  private dragHandler: DragHandler | null = null;
  private hostHovering = false;

  // frame loop
  private readonly frameCallbacks = new Set<(dt: number, now: number) => void>();
  private rafId: number | null = null;
  private lastFrame = 0;
  private cssW = 1;
  /** See setFitInsetRight. */
  private fitInsetRight = 0;
  private cssH = 1;
  private dpr = 1;
  private readonly resizeObserver: ResizeObserver;
  private dprQuery: MediaQueryList | null = null;
  private addedPosition = false;
  private readonly floatTargets: boolean;
  private disposed = false;
  private readonly cleanups: (() => void)[] = [];
  private readonly tmpMatrix = new THREE.Matrix4();
  /** Statistics of the last render (for tests / diagnostics). */
  readonly lastRender = { ms: 0, frame: 0 };

  constructor(container: HTMLElement, opts: ViewportOptions = {}) {
    this.container = container;
    this.opts = {
      background: opts.background ?? '#f7f7f5',
      outlineWidth: opts.outlineWidth ?? 1.25,
      selectionWidth: opts.selectionWidth ?? 2.5,
      accent: opts.accent ?? '#1f7ae0',
      keyboard: opts.keyboard ?? true,
      viewCube: opts.viewCube ?? true,
      supersample: opts.supersample ?? 'auto',
      animationMs: opts.animationMs ?? 250,
    };
    this.outlineParams = { ...DEFAULT_OUTLINE, sel: srgbTriple(this.opts.accent) };

    if (!document.getElementById(STYLE_ID)) {
      const st = document.createElement('style');
      st.id = STYLE_ID;
      st.textContent = STYLE;
      document.head.append(st);
    }
    liveViewports++;
    container.classList.add('kv-root');
    if (getComputedStyle(container).position === 'static') {
      container.style.position = 'relative';
      this.addedPosition = true;
    }

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
    this.renderer.autoClear = false;
    // The ID buffer is RG32F, renderable only with EXT_color_buffer_float (near-universal on
    // WebGL2). Without it the outline passes are skipped (parts still render, without lines).
    this.floatTargets = this.renderer.extensions.has('EXT_color_buffer_float');
    if (!this.floatTargets) console.warn('knap view: EXT_color_buffer_float unavailable; outlines disabled');
    this.canvas = this.renderer.domElement;
    this.canvas.classList.add('kv-canvas');
    this.canvas.tabIndex = 0;
    container.append(this.canvas);

    // scenes
    this.colorScene.add(this.floor, this.grid);
    this.floorEdge = new FatLines(this.lineUniforms, { depthTest: true, depthBias: 0.0002 });
    this.floorEdge.renderOrder = -1;
    this.floorEdge.visible = false;
    this.overlayScene.add(this.floorEdge);
    const accent = this.opts.accent;
    this.hoverFaceFill = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), createFillMaterial(accent, HOVER_FACE_OPACITY));
    this.hoverFaceLines = new FatLines(this.lineUniforms, { depthTest: true, depthBias: 0.0005 });
    this.hoverCellFill = new THREE.Mesh(new THREE.BoxGeometry(1.02, 1.02, 1.02), createFillMaterial('#e0322b', HOVER_CELL_OPACITY));
    this.hoverCellLines = new FatLines(this.lineUniforms, { depthTest: true, depthBias: 0.0005 });
    this.ghostVisible = new THREE.Mesh(new THREE.BufferGeometry(), createGhostMaterial(false));
    this.ghostHidden = new THREE.Mesh(new THREE.BufferGeometry(), createGhostMaterial(true));
    this.ghostHidden.renderOrder = 1;
    this.ghostVisible.renderOrder = 2;
    const ringMat = createFillMaterial('#e0322b', HOVER_RING_OPACITY);
    ringMat.side = THREE.DoubleSide;
    this.hoverRingFill = new THREE.Mesh(new THREE.BufferGeometry(), ringMat);
    this.hoverRingLines = new FatLines(this.lineUniforms, { depthTest: true, depthBias: 0.0005 });
    this.hoverRingFill.renderOrder = 3;
    this.hoverRingLines.renderOrder = 4;
    this.hoverFaceHalo = new FatLines(this.lineUniforms, { depthTest: true, depthBias: 0.0005 });
    this.hoverCellHalo = new FatLines(this.lineUniforms, { depthTest: true, depthBias: 0.0005 });
    this.hoverRingHalo = new FatLines(this.lineUniforms, { depthTest: true, depthBias: 0.0005 });
    for (const h of [this.hoverFaceHalo, this.hoverCellHalo, this.hoverRingHalo]) h.renderOrder = 3.5;
    for (const o of [this.hoverFaceFill, this.hoverFaceLines, this.hoverFaceHalo, this.hoverCellFill, this.hoverCellLines, this.hoverCellHalo, this.hoverRingFill, this.hoverRingLines, this.hoverRingHalo, this.ghostVisible, this.ghostHidden]) {
      o.visible = false;
      this.overlayScene.add(o);
    }
    this.hoverFaceFill.renderOrder = 3;
    this.hoverFaceLines.renderOrder = 4;
    this.hoverCellFill.renderOrder = 3;
    this.hoverCellLines.renderOrder = 4;
    this.glyphHalo = new FatLines(this.lineUniforms, { depthTest: false });
    this.glyphLines = new FatLines(this.lineUniforms, { depthTest: false });
    this.glyphHalo.renderOrder = 10;
    this.glyphLines.renderOrder = 11;
    this.overlayScene.add(this.glyphHalo, this.glyphLines);
    const idTex = this.outline.idTarget.textures[0]!;
    this.rootHalo = new FatLines(this.lineUniforms, { depthTest: false, idFade: idTex });
    this.rootLines = new FatLines(this.lineUniforms, { depthTest: false, idFade: idTex });
    this.rootHalo.renderOrder = 5;
    this.rootLines.renderOrder = 6;
    this.overlayScene.add(this.rootHalo, this.rootLines);

    // view cube + buttons
    if (this.opts.viewCube) {
      this.cube = new ViewCube();
      const b = document.createElement('div');
      b.className = 'kv-buttons';
      const mk = (label: string, icon: string, fn: () => void): HTMLButtonElement => {
        const el = document.createElement('button');
        el.type = 'button';
        el.className = 'kv-btn';
        el.title = label;
        el.setAttribute('aria-label', label);
        el.innerHTML = icon;
        el.addEventListener('click', () => {
          fn();
          this.canvas.focus({ preventScroll: true });
        });
        return el;
      };
      b.append(mk('Home view (Home)', ICON_HOME, () => this.home()), mk('Fit (F)', ICON_FIT, () => this.fit()));
      b.dataset.role = 'view-buttons';
      container.append(b);
      this.buttons = b;
    } else {
      this.cube = null;
      this.buttons = null;
    }

    this.bindInput();
    this.resizeObserver = new ResizeObserver(() => this.syncSize(true));
    this.resizeObserver.observe(container);
    this.watchDpr();
    this.syncSize(false);
    this.requestRender();
  }

  // ========================================================================================
  // Model

  /**
   * Show a model. Diffs by part: geometry is rebuilt only for parts whose cells changed (by
   * signature; identical parts share one BufferGeometry), colours/positions update in place,
   * removed parts are dropped. Requires initGeometry() (use Viewport.create).
   */
  setModel(model: Model): void {
    if (!geometryReady()) throw new Error('Viewport.setModel: geometry not initialised (await initGeometry() or use Viewport.create)');
    this.model = model;
    const seen = new Set<number>();
    for (const part of model.parts) {
      seen.add(part.id);
      let pv = this.views.get(part.id);
      if (!pv) {
        pv = this.createView(part);
        this.views.set(part.id, pv);
      } else if (pv.part !== part) {
        if (pv.part.cells !== part.cells) {
          const sig = partSignature(part);
          if (sig !== pv.sig) {
            const entry = this.acquireGeometry(sig, part);
            this.releaseGeometry(pv.sig);
            pv.geo = entry;
            pv.sig = sig;
            pv.colorMesh.geometry = entry.geometry;
            pv.idMesh.geometry = entry.geometry;
            pv.shadowMesh.geometry = entry.geometry;
            this.shadowDirty = true;
          }
          pv.origin = partOrigin(part);
        }
        pv.part = part;
        pv.color = part.color;
      }
      this.applyColor(pv);
      this.applyMatrix(pv);
      this.applyVisibility(pv);
      this.applySelection(pv);
    }
    for (const [id, pv] of this.views) if (!seen.has(id)) this.destroyView(pv);
    this.rootId = effectiveRootId(model);
    this.requestRender();
  }

  /** The model last passed to setModel. */
  getModel(): Model | null {
    return this.model;
  }

  /** Per-part colour overrides ('#rrggbb'), e.g. tint by rigid body; null restores part colours. */
  setPartColors(overrides: ReadonlyMap<number, string> | null): void {
    this.colorOverrides = overrides;
    for (const pv of this.views.values()) this.applyColor(pv);
    this.requestRender();
  }

  /** Show / hide one part (persists across setModel until changed). */
  setPartVisible(partId: number, visible: boolean): void {
    if (visible) this.hidden.delete(partId);
    else this.hidden.add(partId);
    const pv = this.views.get(partId);
    if (pv) this.applyVisibility(pv);
    this.requestRender();
  }

  /** Show every part again. */
  showAllParts(): void {
    this.hidden.clear();
    for (const pv of this.views.values()) this.applyVisibility(pv);
    this.requestRender();
  }

  /**
   * Rigid transform applied to a part's edit-time world placement: world' = R(q)·world + p
   * (identity p = [0,0,0], q = [0,0,0,1] shows it as edited). q is [x, y, z, w] (or {x,y,z,w}).
   */
  setPartTransform(partId: number, p: Vec3Like, q: QuatLike): void {
    this.transforms.set(partId, { p: v3(p), q: q4(q) });
    const pv = this.views.get(partId);
    if (pv) this.applyMatrix(pv);
    this.requestRender();
  }

  /** Drop all simulation transforms (parts return to their edit-time placement). */
  clearTransforms(): void {
    this.transforms.clear();
    for (const pv of this.views.values()) this.applyMatrix(pv);
    this.requestRender();
  }

  /** Current world bounding box of a part (with its transform), or null if unknown. */
  partBox(partId: number): Box3 | null {
    const pv = this.views.get(partId);
    return pv ? this.worldBox(pv) : null;
  }

  /**
   * Does any visible part's world box overlap the view (its projected corners' screen rectangle
   * meets the canvas)? False with no visible parts. (A vehicle that rolled away: the app says so.)
   */
  modelInView(): boolean {
    for (const pv of this.views.values()) {
      if (this.hidden.has(pv.id)) continue;
      const b = this.worldBox(pv);
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
      for (let i = 0; i < 8; i++) {
        const q = this.project([i & 1 ? b.max[0] : b.min[0], i & 2 ? b.max[1] : b.min[1], i & 4 ? b.max[2] : b.min[2]]);
        x0 = Math.min(x0, q.x);
        x1 = Math.max(x1, q.x);
        y0 = Math.min(y0, q.y);
        y1 = Math.max(y1, q.y);
      }
      if (x1 >= 0 && x0 <= this.cssW && y1 >= 0 && y0 <= this.cssH) return true;
    }
    return false;
  }

  /** World box of all visible parts, or null if there are none. */
  modelBox(): Box3 | null {
    return unionBoxes([...this.views.values()].filter((pv) => !this.hidden.has(pv.id)).map((pv) => this.worldBox(pv)));
  }

  // ========================================================================================
  // Overlays

  /** Selected parts: accent outline around their silhouette plus a light tint. */
  setSelection(partIds: Iterable<number>): void {
    this.selection = new Set(partIds);
    for (const pv of this.views.values()) this.applySelection(pv);
    this.requestRender();
  }

  getSelection(): number[] {
    return [...this.selection];
  }

  /** Highlight one face of one cell's bounding cube (build tool hover), or null. */
  setHoverFace(h: HoverFace | null): void {
    if (!h) {
      this.hoverFaceFill.visible = false;
      this.hoverFaceLines.visible = false;
      this.hoverFaceHalo.visible = false;
      this.requestRender();
      return;
    }
    const d = DIRS[h.dir]!;
    const axis = d[0] !== 0 ? 0 : d[1] !== 0 ? 1 : 2;
    const c: Vec3 = [h.cell[0] + d[0] * 0.505, h.cell[1] + d[1] * 0.505, h.cell[2] + d[2] * 0.505];
    const fill = this.hoverFaceFill;
    fill.position.set(...c);
    fill.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), new THREE.Vector3(d[0], d[1], d[2]));
    const st = overlayStyle(h.color ?? this.opts.accent, h.over);
    const color = st.line;
    this.hoverFaceBold = st.bold;
    const fm = fill.material as THREE.MeshBasicMaterial;
    fm.color.set(st.fill);
    const xray = !!h.xray;
    if (fm.depthTest === xray) {
      fm.depthTest = !xray;
      fm.side = xray ? THREE.DoubleSide : THREE.FrontSide;
      fm.needsUpdate = true;
      this.hoverFaceLines.material.depthTest = !xray;
      this.hoverFaceHalo.material.depthTest = !xray;
    }
    fm.opacity = st.bold ? (xray ? HOVER_BOLD_XRAY_OPACITY : HOVER_BOLD_OPACITY) : xray ? HOVER_FACE_XRAY_OPACITY : HOVER_FACE_OPACITY;
    fill.visible = true;
    const t1 = (axis + 1) % 3;
    const t2 = (axis + 2) % 3;
    const pts: number[][] = [];
    for (const [a, b] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const) {
      const p = [...c];
      p[t1] = p[t1]! + a * 0.5;
      p[t2] = p[t2]! + b * 0.5;
      pts.push(p);
    }
    const sb = new SegmentBuilder();
    sb.polyline(pts, rgba(color), true);
    sb.apply(this.hoverFaceLines);
    applyHalo(sb, this.hoverFaceHalo);
    this.requestRender();
  }

  /** Highlight a whole cell cube (erase tool hover; red by default), or null. */
  setHoverCell(h: HoverCell | null): void {
    if (!h) {
      this.hoverCellFill.visible = false;
      this.hoverCellLines.visible = false;
      this.hoverCellHalo.visible = false;
      this.requestRender();
      return;
    }
    const st = overlayStyle(h.color ?? '#e0322b', h.over);
    const color = st.line;
    this.hoverCellBold = st.bold;
    this.hoverCellFill.position.set(h.cell[0], h.cell[1], h.cell[2]);
    const cm = this.hoverCellFill.material as THREE.MeshBasicMaterial;
    cm.color.set(st.fill);
    cm.opacity = st.bold ? HOVER_CELL_BOLD_OPACITY : HOVER_CELL_OPACITY;
    this.hoverCellFill.visible = true;
    const sb = new SegmentBuilder();
    const col = rgba(color);
    const s = 0.51;
    for (let k = 0; k < 3; k++)
      for (const s1 of [-1, 1])
        for (const s2 of [-1, 1]) {
          const a = [h.cell[0], h.cell[1], h.cell[2]];
          const b = [...a];
          a[k] = a[k]! - s;
          b[k] = b[k]! + s;
          for (const p of [a, b]) {
            p[(k + 1) % 3] = p[(k + 1) % 3]! + s1 * s;
            p[(k + 2) % 3] = p[(k + 2) % 3]! + s2 * s;
          }
          sb.seg(a, b, col);
        }
    sb.apply(this.hoverCellLines);
    applyHalo(sb, this.hoverCellHalo);
    this.requestRender();
  }

  /**
   * Highlight a band of a wheel (Erase on a rim, Shift+Wheel shrink: the outer half-unit a click
   * removes), or null: a translucent annulus slightly proud of the wheel's faces and tread, outlined
   * by its four circles.
   */
  setHoverRing(h: HoverRing | null): void {
    if (!h) {
      this.hoverRingFill.visible = false;
      this.hoverRingLines.visible = false;
      this.hoverRingHalo.visible = false;
      this.requestRender();
      return;
    }
    const st = overlayStyle(h.color ?? '#e0322b', h.over);
    const color = st.line;
    this.hoverRingBold = st.bold;
    const a = h.axis;
    const u = (a + 1) % 3;
    const v = (a + 2) % 3;
    const n = Math.max(48, Math.ceil(h.r1 * 24));
    const pad = 0.015;
    const r0 = Math.max(0.05, h.r0 - pad);
    const r1 = h.r1 + pad;
    const half = 0.5 + pad;
    const pt = (r: number, ang: number, s: number): number[] => {
      const p = [h.hub[0], h.hub[1], h.hub[2]];
      p[u] = p[u]! + r * Math.cos(ang);
      p[v] = p[v]! + r * Math.sin(ang);
      p[a] = p[a]! + s * half;
      return p;
    };
    const pos: number[] = [];
    const quad = (p0: number[], p1: number[], p2: number[], p3: number[]) => pos.push(...p0, ...p1, ...p2, ...p0, ...p2, ...p3);
    for (let i = 0; i < n; i++) {
      const a0 = (i / n) * Math.PI * 2;
      const a1 = ((i + 1) / n) * Math.PI * 2;
      for (const s of [-1, 1]) quad(pt(r0, a0, s), pt(r1, a0, s), pt(r1, a1, s), pt(r0, a1, s)); // flat faces
      quad(pt(r1, a0, -1), pt(r1, a0, 1), pt(r1, a1, 1), pt(r1, a1, -1)); // tread
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
    this.hoverRingFill.geometry.dispose();
    this.hoverRingFill.geometry = g;
    this.hoverRingFill.material.color.set(st.fill);
    this.hoverRingFill.material.opacity = st.bold ? HOVER_RING_BOLD_OPACITY : HOVER_RING_OPACITY;
    this.hoverRingFill.visible = true;
    const sb = new SegmentBuilder();
    const col = rgba(color);
    for (const r of [r0, r1])
      for (const s of [-1, 1]) {
        const ring: number[][] = [];
        for (let i = 0; i < n; i++) ring.push(pt(r, (i / n) * Math.PI * 2, s));
        sb.polyline(ring, col, true);
      }
    sb.apply(this.hoverRingLines);
    applyHalo(sb, this.hoverRingHalo);
    this.requestRender();
  }

  /**
   * The ground floor (§6.1), or null for none: at world height `y`, the same in every mode — a
   * barely darker tint reaching every edge of the view plus a contact shadow under the parts near
   * it (shadow.ts), drawn behind the model and its outlines. Seen from below: nothing. Edge-on: a
   * line at its level.
   */
  setFloor(f: FloorState | null): void {
    const same = f === null ? this.floorState === null : this.floorState !== null && this.floorState.y === f.y;
    if (same) return;
    this.floorState = f ? { y: f.y } : null;
    this.shadowDirty = true;
    this.requestRender();
  }

  /** The floor last set with setFloor (null: none). */
  getFloor(): FloorState | null {
    return this.floorState ? { ...this.floorState } : null;
  }

  /**
   * Translucent ghost of a prospective sub-part (its real geometry; with `extra`, of the whole
   * prospective part), accent-coloured
   * when valid, red when not; the part of it hidden behind other geometry shows fainter.
   */
  setGhost(g: Ghost | null): void {
    if (!g) {
      this.ghostVisible.visible = false;
      this.ghostHidden.visible = false;
      this.requestRender();
      return;
    }
    const part: Part = { id: -1, color: '#ffffff', cells: [{ ...g.cell }, ...(g.extra ?? []).map((c) => ({ ...c }))] };
    const origin = partOrigin(part);
    const sig = partSignature(part);
    if (!this.ghostGeo || this.ghostGeo.sig !== sig) {
      const entry = this.acquireGeometry(sig, part);
      if (this.ghostGeo) this.releaseGeometry(this.ghostGeo.sig);
      this.ghostGeo = { sig, entry };
      this.ghostVisible.geometry = entry.geometry;
      this.ghostHidden.geometry = entry.geometry;
    }
    // Over a part of (nearly) the ghost's colour: a white body with a silhouette rim in the
    // semantic colour (overlayStyle; the ghost's "outline"), else the colour with a white rim
    // where it is seen through geometry.
    const st = overlayStyle(g.valid ? this.opts.accent : '#e0322b', g.over);
    this.ghostHidden.material.uniforms.uOpacity!.value = g.xray ? GHOST_XRAY_HIDDEN_OPACITY : GHOST_HIDDEN_OPACITY;
    this.ghostHidden.material.uniforms.uRim!.value = st.bold ? GHOST_BOLD_RIM : g.xray ? GHOST_XRAY_HIDDEN_RIM : GHOST_HIDDEN_RIM;
    this.ghostVisible.material.uniforms.uRim!.value = st.bold ? GHOST_BOLD_RIM : 0;
    for (const m of [this.ghostVisible, this.ghostHidden]) {
      m.position.set(origin[0], origin[1], origin[2]);
      (m.material.uniforms.uColor!.value as THREE.Color).set(st.fill);
      (m.material.uniforms.uRimColor!.value as THREE.Color).set(st.bold ? st.line : '#ffffff');
      m.material.uniforms.uRimPow!.value = st.bold ? GHOST_BOLD_RIM_POW : 3;
      m.visible = true;
    }
    this.requestRender();
  }

  /** Reference grid on y = −½ (hide while simulating). */
  setGridVisible(on: boolean): void {
    this.gridVisible = on;
    this.requestRender();
  }

  /** The small "fixed" marker under the root part. */
  setRootMarkerVisible(on: boolean): void {
    this.rootMarkerVisible = on;
    this.requestRender();
  }

  /** Joint glyphs (see jointGlyphsFromGraph); [] or null clears. Drawn on top of everything. */
  setJointGlyphs(glyphs: readonly JointGlyph[] | null): void {
    this.glyphs = glyphs ? [...glyphs] : [];
    this.requestRender();
  }

  setGlyphsVisible(on: boolean): void {
    this.glyphsVisible = on;
    this.requestRender();
  }

  /** Show / hide the view cube and its buttons. */
  setViewCubeVisible(on: boolean): void {
    if (this.buttons) this.buttons.style.display = on ? '' : 'none';
    this.cubeHidden = !on;
    this.requestRender();
  }
  private cubeHidden = false;

  // ========================================================================================
  // Camera

  getCamera(): CameraState {
    const c = this.cam;
    return { target: [...c.target], yaw: c.yaw, pitch: c.pitch, height: c.height };
  }

  /** Set the camera (animated by default). */
  setCamera(state: CameraState, opts: CameraAnimOptions = {}): void {
    const to = normalizeCamera(state);
    if (opts.animate ?? true) this.animateTo(to);
    else {
      this.anim = null;
      this.applyCamera(to);
    }
  }

  /** True while a snap / fit animation runs. */
  get animating(): boolean {
    return this.anim !== null;
  }

  /**
   * Snap to a named view (math.parseViewName: 'front', 'top-front', 'top-front-right', 'iso', …)
   * or a direction. Keeps target and zoom. For straight top/bottom views the screen rotation is
   * canonical (yaw 0) unless keepYaw, which keeps the current yaw rounded to a quarter turn.
   */
  snapTo(view: string | ViewDir, opts: CameraAnimOptions & { keepYaw?: boolean } = {}): void {
    const dir = typeof view === 'string' ? parseViewName(view) : view;
    if (!dir) throw new Error(`unknown view ${JSON.stringify(view)}`);
    // Compose with the end state of a running snap / fit, not its in-between frame.
    const base = this.anim?.to ?? this.cam;
    const { yaw, pitch } = orientationForDir(dir, opts.keepYaw ? nearestQuarterYaw(base.yaw) : 0);
    this.setCamera({ ...base, target: [...base.target], yaw, pitch }, opts);
  }

  /** Default isometric view from (+X, +Y, +Z), fitted to everything. */
  home(opts: CameraAnimOptions = {}): void {
    const { yaw, pitch } = orientationForDir([1, 1, 1]);
    const f = this.fitFor('all', yaw, pitch);
    this.setCamera({ target: f.target, yaw, pitch, height: f.height }, opts);
  }

  /**
   * Frame something and re-centre the orbit pivot on it: no argument = the selection if any, else
   * everything; or 'all', 'selection', a list of part ids, or a world box.
   */
  fit(what?: FitTarget, opts: CameraAnimOptions = {}): void {
    // Keep the orientation a running snap is heading for.
    const base = this.anim?.to ?? this.cam;
    const f = this.fitFor(what ?? (this.visibleSelection().length ? 'selection' : 'all'), base.yaw, base.pitch);
    this.setCamera({ ...base, target: f.target, height: f.height }, opts);
  }

  /** Called with the new state whenever the camera changes (also during animations). */
  onCameraChange(cb: (s: CameraState) => void): () => void {
    this.cameraListeners.add(cb);
    return () => this.cameraListeners.delete(cb);
  }

  // ========================================================================================
  // Picking / projection

  /** World pick ray under a client (page) position. */
  rayAt(clientX: number, clientY: number): Ray {
    const r = this.canvas.getBoundingClientRect();
    return this.rayAtLocal(clientX - r.left, clientY - r.top);
  }

  /** World pick ray under a point in CSS px relative to the viewport's top-left. */
  rayAtLocal(x: number, y: number): Ray {
    const [nx, ny] = pixelToNdc(x, y, this.cssW, this.cssH);
    return pickRay(this.cam, this.aspect(), nx, ny, this.cameraDistance());
  }

  /**
   * Project a world point to client (page) coordinates. `inView` is false when it falls outside
   * the viewport. (Orthographic: there is no "behind the camera".)
   */
  project(p: Vec3Like): { clientX: number; clientY: number; x: number; y: number; inView: boolean } {
    const q = projectPoint(this.cam, this.aspect(), v3(p));
    const [x, y] = ndcToPixel(q.ndcX, q.ndcY, this.cssW, this.cssH);
    const r = this.canvas.getBoundingClientRect();
    return { clientX: x + r.left, clientY: y + r.top, x, y, inView: Math.abs(q.ndcX) <= 1 && Math.abs(q.ndcY) <= 1 };
  }

  /** Diagnostics: part views, distinct GPU geometries (identical parts share one), last render. */
  stats(): { parts: number; geometries: number; renders: number; lastRenderMs: number; supersample: number; shadowRenders: number } {
    return {
      parts: this.views.size,
      geometries: this.geoCache.size,
      renders: this.lastRender.frame,
      lastRenderMs: this.lastRender.ms,
      supersample: this.supersample(),
      shadowRenders: this.shadow.renders,
    };
  }

  /**
   * The contact shadow (DESIGN §6.1, §7.5 groundShadowAt): its strength at a floor point (x, z),
   * 0…1 after the blur, where 1 = SHADOW_MAX opacity (the strength under a wide surface lying on
   * the floor); read back from the shadow texture, brought up to date first. null without a floor.
   */
  groundShadowAt(x: number, z: number): number | null {
    if (!this.floorState || this.disposed) return null;
    this.updateShadow();
    return this.shadow.sample(this.renderer, x, z);
  }

  /** Diagnostics: the contact shadow's render count, frame, CPU ms of its last render, GPU bytes. */
  shadowInfo(): { renders: number; frame: ShadowFrame | null; floorY: number | null; lastMs: number; bytes: number; dirty: boolean } {
    return {
      renders: this.shadow.renders,
      frame: this.floorState ? this.shadow.frame && { ...this.shadow.frame } : null,
      floorY: this.floorState ? this.floorState.y : null,
      lastMs: this.shadow.lastMs,
      bytes: this.shadow.bytes,
      dirty: this.shadowDirty,
    };
  }

  /** Viewport size in CSS px. */
  get size(): { width: number; height: number; pixelRatio: number } {
    return { width: this.cssW, height: this.cssH, pixelRatio: this.dpr };
  }

  /**
   * Read the container's size now instead of waiting for the ResizeObserver. Call it after
   * putting the container into the page and before a first home() / fit(), so the fit uses the
   * real aspect (a resize keeps the framed world rectangle, so a fit at the placeholder 1×1 size
   * would stay too loose).
   */
  updateSize(): void {
    this.syncSize(false);
  }

  // ========================================================================================
  // Host input

  /** Pointer moves that are not navigation (null when the pointer leaves or is over the cube). */
  onHover(cb: (e: ViewportPointerEvent | null) => void): () => void {
    this.hoverListeners.add(cb);
    return () => this.hoverListeners.delete(cb);
  }

  /** Press + release that moved < 4 px (any button), not on the view cube. */
  onClick(cb: (e: ViewportPointerEvent) => void): () => void {
    this.clickListeners.add(cb);
    return () => this.clickListeners.delete(cb);
  }

  /** Install (or clear) the host drag handler; see DragHandler. */
  setDragHandler(h: DragHandler | null): void {
    this.dragHandler = h;
  }

  // ========================================================================================
  // Rendering loop

  /** Render on the next animation frame (coalesced). */
  requestRender(): void {
    if (this.disposed || this.rafId !== null) return;
    this.rafId = requestAnimationFrame((t) => this.frame(t));
  }

  /**
   * Run `cb(dtSeconds, nowMs)` before every frame; while at least one callback is registered the
   * viewport renders continuously (use for simulation). Returns an unsubscribe function.
   */
  onFrame(cb: (dt: number, now: number) => void): () => void {
    this.frameCallbacks.add(cb);
    this.requestRender();
    return () => this.frameCallbacks.delete(cb);
  }

  /** Render synchronously now. */
  renderNow(): void {
    if (this.disposed) return;
    const t0 = performance.now();
    this.render();
    this.lastRender.ms = performance.now() - t0;
    this.lastRender.frame++;
  }

  /** Remove everything this viewport added and free GPU resources. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    liveViewports--;
    if (this.rafId !== null) cancelAnimationFrame(this.rafId);
    this.resizeObserver.disconnect();
    if (this.dprQuery) this.dprQuery.onchange = null;
    this.dprQuery = null;
    for (const c of this.cleanups) c();
    for (const pv of [...this.views.values()]) this.destroyView(pv);
    if (this.ghostGeo) this.releaseGeometry(this.ghostGeo.sig);
    for (const e of this.geoCache.values()) e.geometry.dispose();
    this.geoCache.clear();
    this.outline.dispose();
    this.grid.dispose();
    this.floor.dispose();
    this.shadow.dispose();
    this.cube?.dispose();
    for (const l of [this.hoverFaceLines, this.hoverCellLines, this.hoverRingLines, this.hoverFaceHalo, this.hoverCellHalo, this.hoverRingHalo, this.floorEdge, this.glyphHalo, this.glyphLines, this.rootHalo, this.rootLines]) l.dispose();
    for (const m of [this.hoverFaceFill, this.hoverCellFill, this.hoverRingFill]) {
      m.geometry.dispose();
      (m.material as THREE.Material).dispose();
    }
    this.ghostVisible.material.dispose();
    this.ghostHidden.material.dispose();
    this.renderer.dispose();
    // Release the context now: browsers cap live contexts (~16) and kill the oldest, which may be
    // another viewport still in use.
    this.renderer.forceContextLoss();
    this.canvas.remove();
    this.buttons?.remove();
    this.container.classList.remove('kv-root');
    if (this.addedPosition) this.container.style.position = '';
    if (liveViewports === 0) document.getElementById(STYLE_ID)?.remove();
  }

  // ========================================================================================
  // Internals: parts

  private acquireGeometry(sig: string, part: Part): GeoEntry {
    let e = this.geoCache.get(sig);
    if (!e) {
      const md = buildPartMesh(part);
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(md.positions, 3));
      g.setAttribute('normal', new THREE.BufferAttribute(md.normals, 3));
      const { patch } = vertexPatches(md.positions.length / 3, md.indices);
      g.setAttribute('surfacePatch', new THREE.BufferAttribute(new Float32Array(patch), 1));
      // Wheels' index mark: painted groove (markpaint.ts); all zero for parts without a rim.
      g.setAttribute('aMark', new THREE.BufferAttribute(markWeights(part, md.positions, md.normals), 1));
      g.setIndex(new THREE.BufferAttribute(md.indices, 1));
      g.computeBoundingBox();
      g.computeBoundingSphere();
      const bb = g.boundingBox!;
      e = { geometry: g, refs: 0, box: { min: [bb.min.x, bb.min.y, bb.min.z], max: [bb.max.x, bb.max.y, bb.max.z] } };
      if (md.indices.length === 0) e.box = { min: [-0.5, -0.5, -0.5], max: [0.5, 0.5, 0.5] };
      this.geoCache.set(sig, e);
    }
    e.refs++;
    return e;
  }

  private releaseGeometry(sig: string): void {
    const e = this.geoCache.get(sig);
    if (!e) return;
    e.refs--;
    if (e.refs <= 0) {
      e.geometry.dispose();
      this.geoCache.delete(sig);
    }
  }

  private createView(part: Part): PartView {
    const sig = partSignature(part);
    const geo = this.acquireGeometry(sig, part);
    const slot = this.freeSlots.pop() ?? this.nextSlot++;
    const colorMesh = new THREE.Mesh(geo.geometry, createPartMaterial(part.color));
    const idMesh = new THREE.Mesh(geo.geometry, createIdMaterial(slot % 4095));
    for (const m of [colorMesh, idMesh]) {
      m.matrixAutoUpdate = false;
      m.userData.partId = part.id;
    }
    this.colorScene.add(colorMesh);
    this.idScene.add(idMesh);
    const shadowMesh = this.shadow.createCaster(geo.geometry);
    this.shadowDirty = true;
    return { id: part.id, part, sig, origin: partOrigin(part), geo, slot, colorMesh, idMesh, shadowMesh, color: part.color };
  }

  private destroyView(pv: PartView): void {
    this.colorScene.remove(pv.colorMesh);
    this.idScene.remove(pv.idMesh);
    this.shadow.removeCaster(pv.shadowMesh);
    this.shadowDirty = true;
    pv.colorMesh.material.dispose();
    pv.idMesh.material.dispose();
    this.releaseGeometry(pv.sig);
    this.freeSlots.push(pv.slot);
    this.views.delete(pv.id);
  }

  private applyColor(pv: PartView): void {
    const c = this.colorOverrides?.get(pv.id) ?? pv.color;
    (pv.colorMesh.material.uniforms.uColor!.value as THREE.Color).set(c);
    (pv.colorMesh.material.uniforms.uMarkColor!.value as THREE.Color).set(markColor(c));
  }

  private applySelection(pv: PartView): void {
    const sel = this.selection.has(pv.id);
    pv.idMesh.material.uniforms.uSelected!.value = sel ? 1 : 0;
    const u = pv.colorMesh.material.uniforms;
    // Lighten rather than hue-shift: reads on every part colour; the accent outline does the rest.
    (u.uTint!.value as THREE.Color).set('#ffffff');
    u.uTintAmount!.value = sel ? 0.16 : 0;
  }

  private applyVisibility(pv: PartView): void {
    const v = !this.hidden.has(pv.id);
    if (pv.shadowMesh.visible !== v) this.shadowDirty = true;
    pv.colorMesh.visible = v;
    pv.idMesh.visible = v;
    pv.shadowMesh.visible = v;
  }

  private partMatrix(pv: PartView, out: THREE.Matrix4): THREE.Matrix4 {
    out.makeTranslation(pv.origin[0], pv.origin[1], pv.origin[2]);
    const t = this.transforms.get(pv.id);
    if (t) {
      const m = new THREE.Matrix4().compose(new THREE.Vector3(...t.p), new THREE.Quaternion(...t.q), new THREE.Vector3(1, 1, 1));
      out.premultiply(m);
    }
    return out;
  }

  private applyMatrix(pv: PartView): void {
    const m = this.partMatrix(pv, this.tmpMatrix);
    // Only a real change of pose re-renders the contact shadow (a paused simulation re-applies
    // the same poses every frame).
    if (!m.equals(pv.shadowMesh.matrix)) {
      pv.shadowMesh.matrix.copy(m);
      pv.shadowMesh.matrixWorldNeedsUpdate = true;
      this.shadowDirty = true;
    }
    pv.colorMesh.matrix.copy(m);
    pv.idMesh.matrix.copy(pv.colorMesh.matrix);
    pv.colorMesh.matrixWorldNeedsUpdate = true;
    pv.idMesh.matrixWorldNeedsUpdate = true;
  }

  private worldBox(pv: PartView): Box3 {
    const b = pv.geo.box;
    const m = this.partMatrix(pv, new THREE.Matrix4());
    const box = new THREE.Box3(new THREE.Vector3(...b.min), new THREE.Vector3(...b.max)).applyMatrix4(m);
    return { min: [box.min.x, box.min.y, box.min.z], max: [box.max.x, box.max.y, box.max.z] };
  }

  private visibleSelection(): number[] {
    return [...this.selection].filter((id) => this.views.has(id) && !this.hidden.has(id));
  }

  /**
   * Target + height framing `what` for an orientation. Parts are framed by their actual
   * (transformed) vertices, not their bounding boxes, so iso views fill the viewport and are
   * centred on the visible silhouette; an explicit Box3 is framed as a box.
   */
  /**
   * Keep Fit and Home clear of an overlay along the right edge (the app's side panel): `px` CSS px
   * of the view's width are treated as covered, so a fitted model is framed in the rest of it.
   * Ignored when it would leave less than half of the view.
   */
  setFitInsetRight(px: number): void {
    this.fitInsetRight = Number.isFinite(px) && px > 0 ? px : 0;
  }

  private fitFor(what: FitTarget, yaw: number, pitch: number): { target: Vec3; height: number } {
    const inset = this.fitInsetRight > 0 && this.fitInsetRight < this.cssW / 2 ? this.fitInsetRight : 0;
    const f = this.fitForAspect(what, yaw, pitch, ((this.cssW - inset) / Math.max(1, this.cssH)) || this.aspect());
    if (!inset) return f;
    // Centre the framed content in the free part: move the pivot right by half the inset.
    const { right } = cameraBasis(yaw, pitch);
    const k = ((inset / 2) * f.height) / Math.max(1, this.cssH);
    return { target: [f.target[0] + right[0] * k, f.target[1] + right[1] * k, f.target[2] + right[2] * k], height: f.height };
  }

  private fitForAspect(what: FitTarget, yaw: number, pitch: number, aspect: number): { target: Vec3; height: number } {
    if (what !== 'all' && what !== 'selection' && !Array.isArray(what)) return fitBox(what as Box3, yaw, pitch, aspect);
    let ids: number[];
    if (what === 'all') ids = [...this.views.keys()];
    else if (what === 'selection') ids = this.visibleSelection();
    else ids = (what as readonly number[]).filter((id) => this.views.has(id));
    ids = ids.filter((id) => !this.hidden.has(id));
    if (!ids.length && what === 'selection') ids = [...this.views.keys()].filter((id) => !this.hidden.has(id));
    if (!ids.length) return fitBox({ min: [-2, -0.5, -2], max: [2, 1.5, 2] }, yaw, pitch, aspect);
    const pts = this.worldVertices(ids.map((id) => this.views.get(id)!));
    return fitPoints(pts, yaw, pitch, aspect);
  }

  /** World positions (flat xyz) of the distinct vertices of some part views, with transforms. */
  private worldVertices(pvs: PartView[]): Float64Array {
    let n = 0;
    for (const pv of pvs) n += this.hullPoints(pv.geo).length / 3;
    const out = new Float64Array(n * 3);
    const m = new THREE.Matrix4();
    let o = 0;
    for (const pv of pvs) {
      const e = this.partMatrix(pv, m).elements;
      const src = this.hullPoints(pv.geo);
      for (let i = 0; i < src.length; i += 3) {
        const x = src[i]!;
        const y = src[i + 1]!;
        const z = src[i + 2]!;
        out[o++] = e[0]! * x + e[4]! * y + e[8]! * z + e[12]!;
        out[o++] = e[1]! * x + e[5]! * y + e[9]! * z + e[13]!;
        out[o++] = e[2]! * x + e[6]! * y + e[10]! * z + e[14]!;
      }
    }
    return out;
  }

  /** Distinct vertex positions of a cached geometry (crease-split duplicates removed), cached. */
  private hullPoints(e: GeoEntry): Float32Array {
    if (e.points) return e.points;
    const pos = e.geometry.getAttribute('position').array as Float32Array;
    const seen = new Set<string>();
    const pts: number[] = [];
    for (let i = 0; i < pos.length; i += 3) {
      const k = `${pos[i]},${pos[i + 1]},${pos[i + 2]}`;
      if (seen.has(k)) continue;
      seen.add(k);
      pts.push(pos[i]!, pos[i + 1]!, pos[i + 2]!);
    }
    if (!pts.length) pts.push(...e.box.min, ...e.box.max);
    e.points = new Float32Array(pts);
    return e.points;
  }

  // ========================================================================================
  // Internals: camera

  private aspect(): number {
    return this.cssW / Math.max(1, this.cssH);
  }

  /** Distance from the target to the camera plane: in front of everything. */
  private cameraDistance(): number {
    const box = this.modelBox();
    const t = this.cam.target;
    let r = 10;
    if (box)
      for (let i = 0; i < 8; i++) {
        const p: Vec3 = [i & 1 ? box.max[0] : box.min[0], i & 2 ? box.max[1] : box.min[1], i & 4 ? box.max[2] : box.min[2]];
        r = Math.max(r, Math.hypot(p[0] - t[0], p[1] - t[1], p[2] - t[2]) + 4);
      }
    return r;
  }

  private animateTo(to: CameraState): void {
    if (this.opts.animationMs <= 0) {
      this.anim = null;
      this.applyCamera(to);
      return;
    }
    this.anim = { from: this.getCamera(), to, t0: performance.now(), dur: this.opts.animationMs };
    this.requestRender();
  }

  private applyCamera(s: CameraState, fromResize = false): void {
    this.cam = normalizeCamera(s);
    if (!fromResize) this.viewRect = { w: this.cam.height * this.aspect(), h: this.cam.height };
    const snapshot = this.getCamera();
    for (const cb of this.cameraListeners) cb(snapshot);
    this.requestRender();
  }

  private updateThreeCamera(): void {
    const s = this.cam;
    const { right, up, back } = cameraBasis(s.yaw, s.pitch);
    const dist = this.cameraDistance();
    const cam = this.camera;
    const hh = s.height / 2;
    const hw = hh * this.aspect();
    cam.left = -hw;
    cam.right = hw;
    cam.top = hh;
    cam.bottom = -hh;
    cam.near = 0.05;
    cam.far = dist * 2 + 40;
    cam.position.set(s.target[0] + back[0] * dist, s.target[1] + back[1] * dist, s.target[2] + back[2] * dist);
    const m = new THREE.Matrix4().makeBasis(new THREE.Vector3(...right), new THREE.Vector3(...up), new THREE.Vector3(...back));
    cam.quaternion.setFromRotationMatrix(m);
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld(true);
  }

  // ========================================================================================
  // Internals: frame + render

  private frame(now: number): void {
    this.rafId = null;
    if (this.disposed) return;
    const dt = this.lastFrame ? Math.min(0.1, (now - this.lastFrame) / 1000) : 1 / 60;
    this.lastFrame = now;
    for (const cb of [...this.frameCallbacks]) cb(dt, now);
    if (this.anim) {
      const t = (performance.now() - this.anim.t0) / this.anim.dur;
      const to = this.anim.to;
      if (t >= 1) {
        this.anim = null;
        this.applyCamera(to);
      } else this.applyCamera(interpolateCamera(this.anim.from, to, easeInOut(t)));
    }
    // A frame callback or applyCamera may have requested a frame; we render now anyway. Cancel
    // it: dropping only the id left that request alive next to the one below, so every frame with
    // a callback that touched the view (setPartTransform) doubled the pending frames.
    if (this.rafId !== null) cancelAnimationFrame(this.rafId);
    this.rafId = null;
    this.renderNow();
    if (this.anim || this.frameCallbacks.size > 0) this.rafId = requestAnimationFrame((t) => this.frame(t));
    else this.lastFrame = 0;
  }

  private supersample(): number {
    const s = this.opts.supersample;
    // 'auto' = 2 at every DPR: with one ID texel per pixel the reconstructed lines flicker under
    // slow orbits (measured: ~5 % of ink pixels jump > 0.6 coverage per 0.05° step at ss 1,
    // < 0.02 % at ss 2). Capped: each side within the texture limit and the texel count within a
    // memory budget (RG32F + RGBA8 + depth + RGBA8 edges ≈ 20 B/texel), stepping down 2 → 1.5 → 1.
    const want = typeof s === 'number' ? Math.max(1, Math.min(3, s)) : 2;
    const w = this.cssW * this.dpr;
    const h = this.cssH * this.dpr;
    const maxSide = Math.min(SS_MAX_SIDE, this.renderer.capabilities.maxTextureSize);
    const fits = (ss: number): boolean => w * ss <= maxSide && h * ss <= maxSide && w * h * ss * ss <= SS_TEXEL_BUDGET;
    for (const ss of [want, 2, 1.5]) if (ss <= want && fits(ss)) return ss;
    return 1;
  }

  private render(): void {
    const r = this.renderer;
    // A devicePixelRatio change whose media-query event never came (some zoom paths, emulation).
    if ((window.devicePixelRatio || 1) !== this.dpr) {
      this.syncSize(false);
      this.watchDpr();
    }
    const dpr = this.dpr;
    this.updateThreeCamera();
    this.lineUniforms.uResolution.value.set(this.cssW * dpr, this.cssH * dpr);

    // 1–2: ID buffer + edges
    const ss = this.supersample();
    this.outline.setSize(Math.round(this.cssW * dpr), Math.round(this.cssH * dpr), ss);
    const wpt = this.cam.height / (this.cssH * dpr * ss);
    const params: OutlineParams = {
      ...this.outlineParams,
      inkWidth: this.opts.outlineWidth * dpr,
      selWidth: this.opts.selectionWidth * dpr,
    };
    if (this.floatTargets) this.outline.renderEdges(r, this.idScene, this.camera, params, wpt);

    // 3: shaded colour (+ grid behind everything)
    r.setRenderTarget(null);
    r.setClearColor(this.opts.background, 1);
    r.clear(true, true, true);
    const box = this.modelBox();
    this.grid.visible = this.gridVisible;
    if (this.gridVisible) {
      const cx = box ? (box.min[0] + box.max[0]) / 2 : 0;
      const cz = box ? (box.min[2] + box.max[2]) / 2 : 0;
      const ext = box ? Math.max(box.max[0] - box.min[0], box.max[2] - box.min[2]) : 0;
      this.grid.update([cx, cz], Math.max(10, ext * 0.6 + 7), Math.sin(this.cam.pitch), dpr);
    }
    this.updateFloor(dpr);
    r.render(this.colorScene, this.camera);

    // 4: lines
    if (this.floatTargets) this.outline.composite(r, params, this.visibleSelection().length > 0);

    // 5: overlays in the scene (hover, ghost, root marker, glyphs on top)
    // Bold (overlayStyle: over a part of the overlay's own colour): the line at double width, the
    // white under-stroke still 1.5 px wider on each side.
    const lw = (base: number, bold: boolean) => (bold ? 2 * base : base) * dpr;
    this.hoverFaceLines.width = lw(2, this.hoverFaceBold);
    this.hoverCellLines.width = lw(1.75, this.hoverCellBold);
    this.hoverRingLines.width = lw(2, this.hoverRingBold);
    this.hoverFaceHalo.width = lw(2, this.hoverFaceBold) + 3 * dpr;
    this.hoverCellHalo.width = lw(1.75, this.hoverCellBold) + 3 * dpr;
    this.hoverRingHalo.width = lw(2, this.hoverRingBold) + 3 * dpr;
    this.updateGlyphs(dpr);
    this.updateRootMarker(dpr, ss);
    r.render(this.overlayScene, this.camera);

    // 6: view cube
    if (this.cube && !this.cubeHidden) {
      this.cube.setOrientation(this.cam.yaw, this.cam.pitch);
      this.cube.render(r, this.cssW, this.cssH, dpr);
      this.positionButtons();
    }
  }

  /**
   * Re-render the contact shadow's texture if a part's pose, the model, part visibility or the floor
   * level changed since the last time (never for camera changes: the shadow does not depend on
   * the view). No-op without a floor.
   */
  private updateShadow(): void {
    const f = this.floorState;
    if (!f || !this.shadowDirty) return;
    this.shadowDirty = false;
    const boxes: CasterBox[] = [];
    for (const pv of this.views.values()) if (!this.hidden.has(pv.id)) boxes.push(this.worldBox(pv));
    this.shadow.render(this.renderer, f.y, boxes);
  }

  /** Floor uniforms, the contact shadow and the edge-on floor line (§6.1 Ground); see floor.ts. */
  private updateFloor(dpr: number): void {
    const f = this.floorState;
    this.floor.visible = !!f;
    // The floor is a plane like the grid: when it lies above the grid (y = −½) it is drawn after the
    // grid, so the grid's lines show through its translucent tint and shadow rather than over them.
    this.floor.renderOrder = f && f.y > -0.5 ? FLOOR_OVER_GRID_ORDER : FLOOR_UNDER_GRID_ORDER;
    if (!f) {
      this.floorEdge.visible = false;
      return;
    }
    this.updateShadow();
    const { right, back } = cameraBasis(this.cam.yaw, this.cam.pitch);
    const fwdY = -back[1];
    const frame = this.shadow.frame;
    this.floor.update(this.camera, f, fwdY, frame ? { texture: this.shadow.texture, frame } : null);
    const alpha = floorEdgeAlpha(fwdY);
    this.floorEdge.visible = alpha > 0.01;
    if (!this.floorEdge.visible) return;
    const t = this.cam.target;
    const w = this.cam.height * this.aspect() * 2 + 10;
    const p0 = [t[0] - right[0] * w, f.y, t[2] - right[2] * w];
    const p1 = [t[0] + right[0] * w, f.y, t[2] + right[2] * w];
    const col = rgba('#8d9196');
    this.floorEdge.setSegments(new Float32Array([...p0, ...p1]), [col[0], col[1], col[2], 0.9 * alpha]);
    this.floorEdge.width = 1.25 * dpr;
  }

  private updateGlyphs(dpr: number): void {
    const on = this.glyphsVisible && this.glyphs.length > 0;
    this.glyphHalo.visible = on;
    this.glyphLines.visible = on;
    if (!on) return;
    const { back } = cameraBasis(this.cam.yaw, this.cam.pitch);
    const segs = glyphSegments(this.glyphs, back, (id) => this.transforms.get(id) ?? null);
    const ends = new Float32Array(segs.length * 6);
    segs.forEach(([a, b], i) => ends.set([...a, ...b], i * 6));
    this.glyphHalo.setSegments(ends, [1, 1, 1, 0.9]);
    this.glyphLines.setSegments(ends, rgba('#c42a7a'));
    this.glyphHalo.width = 4.5 * dpr;
    this.glyphLines.width = 1.9 * dpr;
  }

  /**
   * World position of the root marker's anchor (centre of rootAnchorIndex's cell, under the root's
   * current transform), or null when there is no visible root. See updateRootMarker.
   */
  private rootAnchor(): { pv: PartView; p: Vec3 } | null {
    const pv = this.rootId !== null ? this.views.get(this.rootId) : undefined;
    if (!this.rootMarkerVisible || !pv || this.hidden.has(pv.id)) return null;
    const i = rootAnchorIndex(pv.part.cells);
    if (i < 0) return null;
    const cell = pv.part.cells[i]!;
    let p: Vec3 = [cell.x, cell.y, cell.z];
    const t = this.transforms.get(pv.id);
    if (t) {
      const m = new THREE.Vector3(...p).applyQuaternion(new THREE.Quaternion(...t.q));
      p = [m.x + t.p[0], m.y + t.p[1], m.z + t.p[2]];
    }
    return { pv, p };
  }

  /**
   * Where the mark is drawn: `at` is the anchor's own base-line centre and `x`/`y` the drawn one
   * (CSS px of the canvas), which differs only when placeMark clamps it into the view.
   */
  private rootMarkPlacement(a: { pv: PartView; p: Vec3 }): { at: [number, number]; x: number; y: number; clamped: boolean } {
    const aspect = this.aspect();
    const toPx = (p: Vec3): [number, number] => {
      const q = projectPoint(this.cam, aspect, p);
      return ndcToPixel(q.ndcX, q.ndcY, this.cssW, this.cssH);
    };
    const at = toPx(this.markPoint(a.p, 0, 0));
    const t = this.transforms.get(a.pv.id);
    const q = t ? new THREE.Quaternion(...t.q) : null;
    const cells = a.pv.part.cells.map((c) => {
      if (!q || !t) return toPx([c.x, c.y, c.z]);
      const v = new THREE.Vector3(c.x, c.y, c.z).applyQuaternion(q);
      return toPx([v.x + t.p[0], v.y + t.p[1], v.z + t.p[2]]);
    });
    const cellPx = (0.5 * this.cssH) / Math.max(1e-9, this.cam.height);
    return { at, ...placeMark(at, cells, cellPx, this.cssW, this.cssH) };
  }

  /** World point of the mark at (dx, dy) CSS px from its base line's centre (x right, y down). */
  private markPoint(anchor: Vec3, dx: number, dy: number): Vec3 {
    const { right, up } = cameraBasis(this.cam.yaw, this.cam.pitch);
    const wpp = this.cam.height / Math.max(1, this.cssH); // world units per CSS px
    const ox = dx * wpp;
    const oy = -MARK.dropWorld - (MARK.dropPx + dy) * wpp;
    return [0, 1, 2].map((k) => anchor[k]! + right[k]! * ox + up[k]! * oy) as unknown as Vec3;
  }

  /**
   * The "fixed" marker (DESIGN §6.1): a small ground-hatch symbol of constant screen size, hung
   * just below the anchor cell on screen. The anchor is chosen from the model alone
   * (rootAnchorIndex), so the mark never jumps while orbiting, while other parts move or while
   * simulating; it follows the root's own transform. When the anchor is off-screen but the root
   * is not, the mark is clamped into the view (placeMark; continuous, so still no jumps). Drawn
   * on top of everything with a white halo; where another part is in front of the root's surface
   * at the anchor's depth (outline ID buffer, MARK.frontEps), at MARK.faint / MARK.haloFaint.
   */
  private updateRootMarker(dpr: number, ss: number): void {
    const a = this.rootAnchor();
    this.rootHalo.visible = !!a;
    this.rootLines.visible = !!a;
    if (!a) return;
    const sb = new SegmentBuilder();
    const col = rgba('#41474e');
    const w = MARK.halfWidth;
    // Offsets ⟂ the view keep every mark point at the anchor's depth (the fade compares to it).
    const pl = this.rootMarkPlacement(a);
    const sx = pl.x - pl.at[0];
    const sy = pl.y - pl.at[1];
    const at = (dx: number, dy: number): Vec3 => this.markPoint(a.p, dx + sx, dy + sy);
    sb.seg(at(-w, 0), at(w, 0), col);
    for (let k = 0; k < 5; k++) {
      const x0 = -w + MARK.hatch + (k * (2 * w - MARK.hatch)) / 4;
      sb.seg(at(x0, 0), at(x0 - MARK.hatch, MARK.hatch), col);
    }
    sb.apply(this.rootLines);
    this.rootHalo.setSegments(new Float32Array(sb.ends), [1, 1, 1, 0.9]);
    this.rootLines.width = 1.35 * dpr;
    this.rootHalo.width = 3.5 * dpr;
    const fadeSS = this.floatTargets ? ss : 0;
    this.rootLines.setFade(a.pv.slot % 4095, fadeSS, MARK.faint, MARK.frontEps);
    this.rootHalo.setFade(a.pv.slot % 4095, fadeSS, MARK.haloFaint, MARK.frontEps);
  }

  /**
   * Debug / test hook: where the root marker is (client px of the centre of its base line), whether
   * it is drawn and inside the view, and its strength — the mean alpha factor over a grid of
   * points on the mark (1 = nothing in front, MARK.faint = all covered), read back from the
   * outline ID buffer with the shader's own rule (`probe` false: no render, no read-back, alpha 1
   * — for cheap position sweeps). null when there is no root
   * to mark (none, hidden, or the marker is turned off).
   */
  rootMarkerInfo(
    probe = true,
  ): { x: number; y: number; visible: boolean; alpha: number; anchor: Vec3; clamped: boolean; anchorX: number; anchorY: number } | null {
    const a = this.rootAnchor();
    if (!a) return null;
    if (probe) this.renderNow();
    else this.updateThreeCamera();
    const rect = this.canvas.getBoundingClientRect();
    const pl = this.rootMarkPlacement(a);
    const [cx, cy] = [pl.x, pl.y];
    const w = MARK.halfWidth;
    const inside = cx + w >= 0 && cx - w <= this.cssW && cy + MARK.hatch >= 0 && cy <= this.cssH;
    let alpha = 1;
    const ss = this.supersample();
    if (probe && this.floatTargets && inside) {
      const tgt = this.outline.idTarget;
      const depth = -new THREE.Vector3(...a.p).applyMatrix4(this.camera.matrixWorldInverse).z;
      const buf = new Float32Array(4);
      let sum = 0;
      let n = 0;
      for (let j = 0; j <= 2; j++)
        for (let i = 0; i <= 10; i++) {
          const x = cx - w + (2 * w * i) / 10;
          const y = cy + (MARK.hatch * j) / 2;
          if (x < 0 || y < 0 || x >= this.cssW || y >= this.cssH) continue;
          const tx = Math.floor(x * this.dpr * ss);
          const ty = Math.floor((this.cssH - y) * this.dpr * ss);
          if (tx >= tgt.width || ty >= tgt.height) continue;
          this.renderer.readRenderTargetPixels(tgt, tx, ty, 1, 1, buf, undefined, 0);
          const id = Math.abs(buf[1]!);
          const other = id > 0.5 && Math.floor((id - 1) / 4096) !== a.pv.slot % 4095 && buf[0]! < depth - MARK.frontEps;
          sum += other ? MARK.faint : 1;
          n++;
        }
      if (n) alpha = sum / n;
    }
    return { x: rect.left + cx, y: rect.top + cy, visible: inside, alpha, anchor: a.p, clamped: pl.clamped, anchorX: rect.left + pl.at[0], anchorY: rect.top + pl.at[1] };
  }

  private positionButtons(): void {
    if (!this.buttons || !this.cube) return;
    const r = this.cube.rect(this.cssW);
    this.buttons.style.right = `${this.cssW - r.x + 4}px`;
    this.buttons.style.top = `${r.y + r.size / 2 - 33}px`;
    this.buttons.style.left = '';
  }

  private syncSize(renderImmediately: boolean): void {
    const w = Math.max(1, this.container.clientWidth);
    const h = Math.max(1, this.container.clientHeight);
    const dpr = window.devicePixelRatio || 1;
    if (w === this.cssW && h === this.cssH && dpr === this.dpr && this.renderer.getPixelRatio() === dpr) return;
    const aspectChanged = w / h !== this.cssW / this.cssH;
    this.cssW = w;
    this.cssH = h;
    this.dpr = dpr;
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(w, h, false);
    if (aspectChanged && this.viewRect) {
      // Keep the chosen world rectangle visible: narrower → zoom out, wider again → back.
      const height = Math.max(this.viewRect.h, this.viewRect.w / this.aspect());
      if (this.anim) {
        const k = height / this.cam.height;
        this.anim.from = { ...this.anim.from, height: this.anim.from.height * k };
        this.anim.to = { ...this.anim.to, height: this.anim.to.height * k };
      }
      this.applyCamera({ ...this.cam, height }, true);
    }
    if (renderImmediately) this.renderNow();
    else this.requestRender();
  }

  private watchDpr(): void {
    if (this.dprQuery) this.dprQuery.onchange = null;
    if (typeof window.matchMedia !== 'function') return;
    this.dprQuery = window.matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`);
    this.dprQuery.onchange = () => {
      if (this.disposed) return;
      this.syncSize(true);
      this.watchDpr();
    };
  }

  // ========================================================================================
  // Internals: input

  private local(e: { clientX: number; clientY: number }): [number, number] {
    const r = this.canvas.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  }

  private pointerEvent(e: PointerEvent | MouseEvent, button: number, at?: [number, number]): ViewportPointerEvent {
    const [x, y] = at ?? this.local(e);
    const r = this.canvas.getBoundingClientRect();
    return {
      x,
      y,
      clientX: x + r.left,
      clientY: y + r.top,
      ray: this.rayAtLocal(x, y),
      button,
      buttons: e.buttons,
      shiftKey: e.shiftKey,
      ctrlKey: e.ctrlKey,
      altKey: e.altKey,
      metaKey: e.metaKey,
      pointerType: (e as PointerEvent).pointerType ?? 'mouse',
    };
  }

  private emitHover(e: ViewportPointerEvent | null): void {
    if (e === null && !this.hostHovering) return;
    this.hostHovering = e !== null;
    for (const cb of this.hoverListeners) cb(e);
  }

  private cubeAt(x: number, y: number): { inWidget: boolean; dir: ViewDir | null } {
    if (!this.cube || this.cubeHidden) return { inWidget: false, dir: null };
    const dir = this.cube.pick(x, y, this.cssW);
    return { inWidget: dir !== null, dir };
  }

  private setCubeHover(dir: ViewDir | null): void {
    if (this.cube && this.cube.setHover(dir)) {
      this.canvas.style.cursor = dir ? 'pointer' : '';
      this.requestRender();
    }
  }

  private bindInput(): void {
    const c = this.canvas;
    const on = <K extends keyof HTMLElementEventMap>(el: HTMLElement | Window, type: K, fn: (e: HTMLElementEventMap[K]) => void, o?: AddEventListenerOptions): void => {
      el.addEventListener(type, fn as EventListener, o);
      this.cleanups.push(() => el.removeEventListener(type, fn as EventListener, o));
    };

    on(c, 'contextmenu', (e) => e.preventDefault());
    // Browser zoom changes devicePixelRatio and fires a window resize (the container may not resize).
    on(window, 'resize', () => {
      if ((window.devicePixelRatio || 1) !== this.dpr) {
        this.syncSize(true);
        this.watchDpr();
      }
    });
    // three.js keeps the context restorable (preventDefault on loss) and re-uploads resources
    // lazily after a restore; we only need to draw again.
    on(c, 'webglcontextlost' as keyof HTMLElementEventMap, () => console.warn('knap view: WebGL context lost'));
    on(c, 'webglcontextrestored' as keyof HTMLElementEventMap, () => {
      this.lastFrame = 0;
      // Render targets lose their contents with the context: the contact shadow must be redrawn.
      this.shadowDirty = true;
      this.requestRender();
    });

    // End a gesture whose release will never come (capture lost to a native dialog, a window
    // switch mid-drag, …): nothing is clicked, a host drag is ended as cancelled.
    const abort = (e: PointerEvent): void => {
      const g = this.gesture;
      if (!g) return;
      this.gesture = null;
      try {
        c.releasePointerCapture(g.id);
      } catch {
        /* ignore */
      }
      if (g.kind === 'host') this.dragHandler?.end(this.pointerEvent(e, 0, this.local(e)), true);
    };
    on(c, 'lostpointercapture', (e) => {
      if (this.gesture && e.pointerId === this.gesture.id) abort(e);
    });

    on(c, 'pointerdown', (e) => {
      const stale = this.gesture;
      if (stale) {
        // A mouse has one pointer (extra buttons arrive as moves), so a new press means the
        // release of the previous one was lost: drop that gesture and start this one.
        if (e.pointerType !== 'mouse' && e.pointerId !== stale.id) return;
        abort(e);
      }
      const [x, y] = this.local(e);
      try {
        c.setPointerCapture(e.pointerId);
      } catch {
        /* synthetic events */
      }
      const cube = this.cubeAt(x, y);
      if (cube.inWidget && e.button === 0) {
        this.gesture = { kind: 'cube', startX: x, startY: y, dir: cube.dir, id: e.pointerId };
        return;
      }
      const panLike = e.button === 1 || e.button === 2 || (e.button === 0 && e.shiftKey);
      if (e.button === 1) e.preventDefault();
      if (e.button === 0 || panLike) {
        this.gesture = {
          kind: 'pending',
          mode: panLike ? 'pan' : 'left',
          button: e.button,
          startX: x,
          startY: y,
          press: this.pointerEvent(e, e.button, [x, y]),
          id: e.pointerId,
          onCube: cube.inWidget,
        };
      }
    });

    on(c, 'pointermove', (e) => {
      const [x, y] = this.local(e);
      // A mouse moving with no button held cannot be mid-drag: its release was lost.
      if (this.gesture && e.pointerType === 'mouse' && e.buttons === 0 && e.pointerId === this.gesture.id) abort(e);
      const g = this.gesture;
      if (!g) {
        const cube = this.cubeAt(x, y);
        this.setCubeHover(cube.dir);
        if (cube.inWidget) this.emitHover(null);
        else this.emitHover(this.pointerEvent(e, -1, [x, y]));
        return;
      }
      if (e.pointerId !== g.id) return;
      switch (g.kind) {
        case 'pending':
        case 'cube': {
          if (Math.hypot(x - g.startX, y - g.startY) < CLICK_SLOP) return;
          this.anim = null;
          this.emitHover(null);
          this.setCubeHover(null);
          if (g.kind === 'cube') {
            this.gesture = { kind: 'orbit', lastX: g.startX, lastY: g.startY, id: g.id };
          } else if (g.mode === 'pan') {
            this.gesture = { kind: 'pan', lastX: g.startX, lastY: g.startY, id: g.id };
          } else if (this.dragHandler && this.dragHandler.claim(g.press, this.pointerEvent(e, 0, [x, y]))) {
            this.gesture = { kind: 'host', id: g.id };
            this.dragHandler.move(this.pointerEvent(e, 0, [x, y]));
            return;
          } else {
            this.gesture = { kind: 'orbit', lastX: g.startX, lastY: g.startY, id: g.id };
          }
          this.continueGesture(x, y);
          return;
        }
        case 'host':
          this.dragHandler?.move(this.pointerEvent(e, 0, [x, y]));
          return;
        default:
          this.continueGesture(x, y);
      }
    });

    const finish = (e: PointerEvent, cancelled: boolean): void => {
      const g = this.gesture;
      if (!g || e.pointerId !== g.id) return;
      this.gesture = null;
      try {
        c.releasePointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
      const [x, y] = this.local(e);
      if (cancelled) {
        if (g.kind === 'host') this.dragHandler?.end(this.pointerEvent(e, 0, [x, y]), true);
        return;
      }
      if (g.kind === 'cube') {
        if (g.dir) this.snapTo(g.dir, { keepYaw: true });
      } else if (g.kind === 'pending' && !g.onCube) {
        const ev = this.pointerEvent(e, g.button, [x, y]);
        for (const cb of this.clickListeners) cb(ev);
      } else if (g.kind === 'host') {
        this.dragHandler?.end(this.pointerEvent(e, 0, [x, y]), false);
      }
      // resume hover feedback at the release point
      const cube = this.cubeAt(x, y);
      this.setCubeHover(cube.dir);
      if (!cube.inWidget && e.pointerType !== 'touch') this.emitHover(this.pointerEvent(e, -1, [x, y]));
    };
    on(c, 'pointerup', (e) => finish(e, false));
    on(c, 'pointercancel', (e) => finish(e, true));
    on(c, 'pointerleave', () => {
      if (this.gesture) return;
      this.setCubeHover(null);
      this.emitHover(null);
    });

    on(
      c,
      'wheel',
      (e) => {
        e.preventDefault();
        const [x, y] = this.local(e);
        let dy = e.deltaY;
        if (e.deltaMode === 1) dy *= 16;
        else if (e.deltaMode === 2) dy *= this.cssH;
        const k = e.ctrlKey ? 0.01 : 0.0015; // ctrlKey: trackpad pinch
        const factor = Math.exp(Math.max(-300, Math.min(300, dy)) * k);
        this.zoomAtLocal(x, y, factor);
      },
      { passive: false },
    );

    // Safari trackpad pinch
    let lastScale = 1;
    const gs = (e: Event): void => {
      e.preventDefault();
      lastScale = (e as unknown as { scale: number }).scale || 1;
    };
    const gc = (e: Event): void => {
      e.preventDefault();
      const ge = e as unknown as { scale: number; clientX: number; clientY: number };
      const s = ge.scale || 1;
      const [x, y] = this.local(ge);
      this.zoomAtLocal(x, y, lastScale / s);
      lastScale = s;
    };
    c.addEventListener('gesturestart', gs);
    c.addEventListener('gesturechange', gc);
    this.cleanups.push(() => {
      c.removeEventListener('gesturestart', gs);
      c.removeEventListener('gesturechange', gc);
    });

    if (this.opts.keyboard) {
      on(window, 'keydown', (e) => {
        if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
        const t = e.target as HTMLElement | null;
        if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
        if (e.key === 'f' || e.key === 'F') {
          e.preventDefault();
          this.fit();
        } else if (e.key === 'Home') {
          e.preventDefault();
          this.home();
        }
      });
    }
  }

  private continueGesture(x: number, y: number): void {
    const g = this.gesture;
    if (!g || (g.kind !== 'orbit' && g.kind !== 'pan')) return;
    const dx = x - g.lastX;
    const dy = y - g.lastY;
    g.lastX = x;
    g.lastY = y;
    if (g.kind === 'orbit') this.applyCamera(orbit(this.cam, dx, dy));
    else this.applyCamera(pan(this.cam, dx, dy, this.cssH));
  }

  private zoomAtLocal(x: number, y: number, factor: number): void {
    // Finish a running animation first so the zoom composes with its end state.
    if (this.anim) {
      const to = this.anim.to;
      this.anim = null;
      this.cam = to;
    }
    const [nx, ny] = pixelToNdc(x, y, this.cssW, this.cssH);
    this.applyCamera(zoomAt(this.cam, this.aspect(), nx, ny, factor));
  }
}
