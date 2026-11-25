// The 3D viewport: parts, outlines, overlays, camera navigation, view cube and pointer plumbing.
// Public API documented in src/view/index.ts.
import * as THREE from 'three';
import { DIRS, effectiveRootId } from '../core';
import type { Cell, Dir, Model, Part } from '../core';
import { buildPartMesh, geometryReady, initGeometry, partOrigin, partSignature } from '../geometry';
import { glyphSegments } from './glyphs';
import type { JointGlyph, RigidTransform } from './glyphs';
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
import { vertexPatches } from './patches';
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
}

export interface HoverCell {
  cell: readonly [number, number, number];
  /** Default red (erase). */
  color?: string;
}

export interface Ghost {
  cell: Cell;
  valid: boolean;
}

export type FitTarget = 'all' | 'selection' | readonly number[] | Box3;

export interface CameraAnimOptions {
  /** Animate (default true). */
  animate?: boolean;
}

// ------------------------------------------------------------------------------------------
// Internals

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
  private readonly hoverCellFill: THREE.Mesh;
  private readonly hoverCellLines: FatLines;
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
  private cssH = 1;
  private dpr = 1;
  private readonly resizeObserver: ResizeObserver;
  private dprQuery: MediaQueryList | null = null;
  private addedPosition = false;
  private readonly floatTargets: boolean;
  private disposed = false;
  private readonly cleanups: (() => void)[] = [];
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
    this.colorScene.add(this.grid);
    const accent = this.opts.accent;
    this.hoverFaceFill = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), createFillMaterial(accent, 0.28));
    this.hoverFaceLines = new FatLines(this.lineUniforms, { depthTest: true, depthBias: 0.0005 });
    this.hoverCellFill = new THREE.Mesh(new THREE.BoxGeometry(1.02, 1.02, 1.02), createFillMaterial('#e0322b', 0.16));
    this.hoverCellLines = new FatLines(this.lineUniforms, { depthTest: true, depthBias: 0.0005 });
    this.ghostVisible = new THREE.Mesh(new THREE.BufferGeometry(), createGhostMaterial(false));
    this.ghostHidden = new THREE.Mesh(new THREE.BufferGeometry(), createGhostMaterial(true));
    this.ghostHidden.renderOrder = 1;
    this.ghostVisible.renderOrder = 2;
    for (const o of [this.hoverFaceFill, this.hoverFaceLines, this.hoverCellFill, this.hoverCellLines, this.ghostVisible, this.ghostHidden]) {
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
    this.rootHalo = new FatLines(this.lineUniforms, { depthTest: false, idMask: idTex });
    this.rootLines = new FatLines(this.lineUniforms, { depthTest: false, idMask: idTex });
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
      this.requestRender();
      return;
    }
    const d = DIRS[h.dir]!;
    const axis = d[0] !== 0 ? 0 : d[1] !== 0 ? 1 : 2;
    const c: Vec3 = [h.cell[0] + d[0] * 0.505, h.cell[1] + d[1] * 0.505, h.cell[2] + d[2] * 0.505];
    const fill = this.hoverFaceFill;
    fill.position.set(...c);
    fill.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), new THREE.Vector3(d[0], d[1], d[2]));
    const color = h.color ?? this.opts.accent;
    (fill.material as THREE.MeshBasicMaterial).color.set(color);
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
    this.requestRender();
  }

  /** Highlight a whole cell cube (erase tool hover; red by default), or null. */
  setHoverCell(h: HoverCell | null): void {
    if (!h) {
      this.hoverCellFill.visible = false;
      this.hoverCellLines.visible = false;
      this.requestRender();
      return;
    }
    const color = h.color ?? '#e0322b';
    this.hoverCellFill.position.set(h.cell[0], h.cell[1], h.cell[2]);
    (this.hoverCellFill.material as THREE.MeshBasicMaterial).color.set(color);
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
    this.requestRender();
  }

  /**
   * Translucent ghost of a prospective sub-part (its real one-cell geometry), accent-coloured
   * when valid, red when not; the part of it hidden behind other geometry shows fainter.
   */
  setGhost(g: Ghost | null): void {
    if (!g) {
      this.ghostVisible.visible = false;
      this.ghostHidden.visible = false;
      this.requestRender();
      return;
    }
    const part: Part = { id: -1, color: '#ffffff', cells: [{ ...g.cell }] };
    const sig = partSignature(part);
    if (!this.ghostGeo || this.ghostGeo.sig !== sig) {
      const entry = this.acquireGeometry(sig, part);
      if (this.ghostGeo) this.releaseGeometry(this.ghostGeo.sig);
      this.ghostGeo = { sig, entry };
      this.ghostVisible.geometry = entry.geometry;
      this.ghostHidden.geometry = entry.geometry;
    }
    const color = g.valid ? this.opts.accent : '#e0322b';
    for (const m of [this.ghostVisible, this.ghostHidden]) {
      m.position.set(g.cell.x, g.cell.y, g.cell.z);
      (m.material.uniforms.uColor!.value as THREE.Color).set(color);
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
  stats(): { parts: number; geometries: number; renders: number; lastRenderMs: number; supersample: number } {
    return {
      parts: this.views.size,
      geometries: this.geoCache.size,
      renders: this.lastRender.frame,
      lastRenderMs: this.lastRender.ms,
      supersample: this.supersample(),
    };
  }

  /** Viewport size in CSS px. */
  get size(): { width: number; height: number; pixelRatio: number } {
    return { width: this.cssW, height: this.cssH, pixelRatio: this.dpr };
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
    this.cube?.dispose();
    for (const l of [this.hoverFaceLines, this.hoverCellLines, this.glyphHalo, this.glyphLines, this.rootHalo, this.rootLines]) l.dispose();
    for (const m of [this.hoverFaceFill, this.hoverCellFill]) {
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
    return { id: part.id, part, sig, origin: partOrigin(part), geo, slot, colorMesh, idMesh, color: part.color };
  }

  private destroyView(pv: PartView): void {
    this.colorScene.remove(pv.colorMesh);
    this.idScene.remove(pv.idMesh);
    pv.colorMesh.material.dispose();
    pv.idMesh.material.dispose();
    this.releaseGeometry(pv.sig);
    this.freeSlots.push(pv.slot);
    this.views.delete(pv.id);
  }

  private applyColor(pv: PartView): void {
    const c = this.colorOverrides?.get(pv.id) ?? pv.color;
    (pv.colorMesh.material.uniforms.uColor!.value as THREE.Color).set(c);
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
    pv.colorMesh.visible = v;
    pv.idMesh.visible = v;
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
    this.partMatrix(pv, pv.colorMesh.matrix);
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
  private fitFor(what: FitTarget, yaw: number, pitch: number): { target: Vec3; height: number } {
    const aspect = this.aspect();
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
    r.render(this.colorScene, this.camera);

    // 4: lines
    if (this.floatTargets) this.outline.composite(r, params, this.visibleSelection().length > 0);

    // 5: overlays in the scene (hover, ghost, root marker, glyphs on top)
    this.hoverFaceLines.width = 2 * dpr;
    this.hoverCellLines.width = 1.75 * dpr;
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
   * The "fixed" marker: a small ground-hatch symbol of constant screen size, hung just below the
   * root part's lowest cell on screen. It never overlaps a different part: the line shader probes
   * the outline ID buffer and draws the mark under the first of the root's lowest cells (up to 8,
   * lowest first) whose mark rectangle no other part covers, or hides it when every one is
   * covered. It may overlap the root itself.
   */
  private updateRootMarker(dpr: number, ss: number): void {
    const pv = this.rootId !== null ? this.views.get(this.rootId) : undefined;
    const on = this.rootMarkerVisible && !!pv && !this.hidden.has(pv.id);
    this.rootHalo.visible = on;
    this.rootLines.visible = on;
    if (!on || !pv) return;
    const { right, up } = cameraBasis(this.cam.yaw, this.cam.pitch);
    const t = this.transforms.get(pv.id);
    const cells: { c: Vec3; down: number; side: number }[] = [];
    for (const cell of pv.part.cells) {
      let c: Vec3 = [cell.x, cell.y, cell.z];
      if (t) {
        const m = new THREE.Vector3(...c).applyQuaternion(new THREE.Quaternion(...t.q));
        c = [m.x + t.p[0], m.y + t.p[1], m.z + t.p[2]];
      }
      const down = -(c[0] * up[0] + c[1] * up[1] + c[2] * up[2]);
      const side = c[0] * right[0] + c[1] * right[1] + c[2] * right[2];
      cells.push({ c, down, side });
    }
    if (!cells.length) return;
    const lowest = Math.max(...cells.map((x) => x.down));
    // Lowest row first, centre of that row first; then cells up to one unit higher.
    const row = cells.filter((x) => x.down > lowest - 1e-6).sort((x, y) => x.side - y.side);
    const mid = row[Math.floor((row.length - 1) / 2)]!.side;
    const order = cells
      .filter((x) => x.down > lowest - 1.0 - 1e-6)
      .sort((x, y) => Math.round((y.down - x.down) * 1e6) || Math.abs(x.side - mid) - Math.abs(y.side - mid));
    const anchor = order[0]!.c;
    const px = (p: Vec3): [number, number] => {
      const q = projectPoint(this.cam, this.aspect(), p);
      return ndcToPixel(q.ndcX, q.ndcY, this.cssW, this.cssH);
    };
    const [ax, ay] = px(anchor);
    const candidates: [number, number][] = [];
    for (const o of order) {
      const [x, y] = px(o.c);
      const d: [number, number] = [(x - ax) * dpr, -(y - ay) * dpr];
      if (candidates.some((k) => Math.abs(k[0] - d[0]) < 2 && Math.abs(k[1] - d[1]) < 2)) continue;
      candidates.push(d);
      if (candidates.length === 8) break;
    }
    const wpp = this.cam.height / Math.max(1, this.cssH); // world units per CSS px
    const drop = 0.72 / wpp + 4; // CSS px from the cell centre down to the hatch's base line
    const rect: [number, number, number, number] = [
      (ax - 13) * dpr,
      (this.cssH - (ay + drop + 3.5 + 2)) * dpr,
      (ax + 13) * dpr,
      (this.cssH - (ay + drop - 2)) * dpr,
    ];
    const probeSS = this.floatTargets ? ss : 0;
    for (const l of [this.rootLines, this.rootHalo]) l.setMask(pv.slot % 4095, rect, candidates, probeSS);
    const at = (dx: number, dy: number): number[] => {
      const ox = dx * wpp;
      const oy = -0.72 - (4 + dy) * wpp; // below the cell, then dy px further down
      return [0, 1, 2].map((k) => anchor[k]! + right[k]! * ox + up[k]! * oy);
    };
    const sb = new SegmentBuilder();
    const col = rgba('#41474e');
    const w = 11;
    sb.seg(at(-w, 0), at(w, 0), col);
    for (let k = 0; k < 5; k++) {
      const x0 = -w + 4 + k * 4.5;
      sb.seg(at(x0, 0), at(x0 - 3.5, 3.5), col);
    }
    sb.apply(this.rootLines);
    this.rootHalo.setSegments(new Float32Array(sb.ends), [1, 1, 1, 0.85]);
    this.rootLines.width = 1.25 * dpr;
    this.rootHalo.width = 3.5 * dpr;
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
      this.requestRender();
    });

    on(c, 'pointerdown', (e) => {
      if (this.gesture) return;
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
