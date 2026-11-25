// The application: wires core (model, rules, analysis), the editor logic, the viewport and the
// physics into the tool of DESIGN.md §7. One instance per page (see src/main.ts).
//
// State that is *not* the model (and therefore not in the undo history): the tool state, the
// selection, the mode (edit / starting / simulate), the kinematics toggle, the playback speed
// and the open file's name. Every model change goes through `commit()` → History, and History's
// change listener is the single place that pushes a model to the view, the overlays, the
// inspector, the counts and the autosave.
import { effectiveRootId, emptyModel, partById, setPartColor, setRoot } from '../core';
import type { Model } from '../core';
import { EXAMPLES, buildExample, exampleByName } from '../core/examples';
import { analyze } from '../core/kinematics';
import type { KinematicGraph } from '../core/kinematics';
import {
  History,
  TOOL_KEYS,
  autosave,
  cycleOrientation,
  deleteSelection,
  describeHover,
  duplicateSelection,
  initialToolState,
  isBuildTool,
  kinematicsSummary,
  modelFileText,
  moveDelta,
  moveKeyOf,
  moveSelection,
  parseModelFile,
  partInfo,
  partTints,
  pickCell,
  pickColor,
  pickGrid,
  resolveBuild,
  resolveErase,
  resolveSelect,
  restoreAutosave,
  rotateSelection,
  selectTool,
  setNewPart,
  suggestFileName,
  withShift,
} from '../editor';
import type { CameraBasis, OpResult, Proposal, StorageLike, Tool, ToolState } from '../editor';
import { Viewport, cameraBasis, defaultCamera, jointGlyphsFromGraph } from '../view';
import type { ViewportPointerEvent } from '../view';
import { Banner, aboutDialog, helpDialog } from '../ui/dialogs';
import type { Dialog } from '../ui/dialogs';
import { h, isTypingTarget } from '../ui/dom';
import { Inspector } from '../ui/inspector';
import { StatusBar } from '../ui/statusbar';
import { Toolbar } from '../ui/toolbar';
import { TopBar } from '../ui/topbar';
import type { Mode } from '../ui/topbar';
import { FilePicker, downloadText, safeLocalStorage } from './files';
import { STEP_SECONDS, SimSession } from './simulation';

export type { Mode } from '../ui/topbar';

/** Debounce of the autosave after a model change (ms). */
export const AUTOSAVE_DELAY_MS = 400;
export const DEFAULT_EXAMPLE = 'four-bar';
const RED = '#e0322b';
const BLOCKED = 'Stop the simulation to edit (Esc)';

export class App {
  readonly vp: Viewport;
  readonly history: History;
  readonly topbar: TopBar;
  readonly toolbar: Toolbar;
  readonly inspector: Inspector;
  readonly status: StatusBar;
  readonly banner: Banner;
  readonly help: Dialog;
  readonly about: Dialog;
  readonly viewEl: HTMLElement;

  tool: ToolState = initialToolState();
  selection: number | null = null;
  mode: Mode = 'edit';
  showKinematics = false;
  speed = 0.25;
  session: SimSession | null = null;
  fileName: string | null = null;

  private readonly storage: StorageLike | null;
  private readonly picker: FilePicker;
  private readonly simBadge: HTMLElement;
  private lastHover: ViewportPointerEvent | null = null;
  private shiftDown = false;
  /** The build proposal currently shown (for [R]). */
  private proposal: Proposal | null = null;
  private graphCache: { model: Model; graph: KinematicGraph } | null = null;
  private autosaveTimer = 0;
  private autosaveFailed = false;
  private starting: Promise<void> | null = null;

  /** Build the DOM inside `root` and start. Throws if WebGL2 is unavailable. */
  static async create(root: HTMLElement): Promise<App> {
    const viewEl = h('main', { class: 'view', 'data-role': 'viewport' });
    const vp = await Viewport.create(viewEl);
    return new App(root, viewEl, vp);
  }

  private constructor(root: HTMLElement, viewEl: HTMLElement, vp: Viewport) {
    this.vp = vp;
    this.viewEl = viewEl;
    this.storage = safeLocalStorage();

    this.topbar = new TopBar(
      EXAMPLES.map((e) => ({ name: e.name, title: e.title, description: e.description })),
      {
        newModel: () => this.newModel(),
        open: () => this.openFile(),
        save: () => this.save(),
        loadExample: (n) => this.loadExample(n),
        undo: () => this.undo(),
        redo: () => this.redo(),
        pickColor: (c) => this.pickColor(c),
        setShowKinematics: (on) => this.setShowKinematics(on),
        playStop: () => void (this.mode === 'edit' ? this.play() : this.stop()),
        togglePause: () => this.togglePause(),
        step: () => void this.stepButton(),
        setSpeed: (s) => this.setSpeed(s),
        help: () => this.help.toggle(),
        about: () => this.about.toggle(),
      },
    );
    this.toolbar = new Toolbar({
      selectTool: (t) => this.selectTool(t),
      toggleNewPart: () => this.toggleNewPart(),
      cycleOrientation: () => this.cycleOrientation(),
    });
    this.inspector = new Inspector({
      setColor: (c) => this.withSelection((id, m) => ({ ok: true, model: setPartColor(m, id, c), partId: id, message: `Part ${id} recoloured` })),
      setRoot: () => this.withSelection((id, m) => ({ ok: true, model: setRoot(m, id), partId: id, message: `Part ${id} is now the fixed root` })),
      duplicate: () => this.withSelection((id, m) => duplicateSelection(m, id)),
      remove: () => this.withSelection((id, m) => deleteSelection(m, id)),
    });
    this.status = new StatusBar();
    this.banner = new Banner();
    this.help = helpDialog();
    this.about = aboutDialog();
    this.simBadge = h('div', { class: 'sim-badge', hidden: true, 'data-role': 'sim-badge' }, 'SIMULATING');
    this.picker = new FilePicker(
      '.json,.knap.json,application/json',
      (name, text) => this.openText(name, text),
      (name, msg) => this.error(`Could not read ${name}: ${msg}`, true),
    );

    viewEl.append(h('div', { class: 'sim-status' }, this.simBadge, this.topbar.slow), this.banner.el, this.inspector.el);
    root.replaceChildren(this.topbar.el, this.toolbar.el, viewEl, this.status.el);
    document.body.append(this.help.overlay, this.about.overlay);

    // Start-up model: the autosave, else the default example.
    const restored = this.storage ? restoreAutosave(this.storage) : { model: null };
    let initial: Model;
    if (restored.model) {
      initial = restored.model;
    } else {
      initial = buildExample(DEFAULT_EXAMPLE);
      this.fileName = DEFAULT_EXAMPLE;
    }
    this.history = new History(initial);
    this.history.onChange(() => this.modelChanged());

    vp.onHover((e) => {
      this.lastHover = e;
      this.refreshHover();
    });
    vp.onClick((e) => this.click(e));
    vp.onCameraChange(() => {
      if (this.lastHover) this.refreshHover();
    });
    vp.canvas.addEventListener('webglcontextlost', () => {
      this.banner.show('The graphics context was lost (the GPU was reset or is busy). Waiting for the browser to restore it…');
    });
    vp.canvas.addEventListener('webglcontextrestored', () => {
      this.banner.hide();
      this.info('Graphics context restored');
    });

    window.addEventListener('keydown', (e) => this.keydown(e));
    window.addEventListener('keyup', (e) => {
      if (e.key === 'Shift') this.setShift(false);
    });
    window.addEventListener('blur', () => this.setShift(false));
    window.addEventListener('pagehide', () => this.flushAutosave());
    // Buttons clicked with the mouse should not keep keyboard focus (Space would re-click them).
    document.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement | null)?.closest?.('button');
      if (b && (e as MouseEvent).detail > 0) b.blur();
    });

    this.modelChanged();
    vp.home({ animate: false });
    if (restored.message) this.error(restored.message, true);
    else this.info(restored.model ? 'Restored the autosaved model' : 'Four-bar linkage example · press Play to simulate');
  }

  // ===========================================================================================
  // Model changes

  get model(): Model {
    return this.history.current;
  }

  /** The kinematic graph of the current model (cached by model identity). */
  graph(): KinematicGraph {
    const m = this.history.current;
    if (this.graphCache?.model !== m) this.graphCache = { model: m, graph: analyze(m) };
    return this.graphCache.graph;
  }

  private modelChanged(): void {
    const m = this.history.current;
    this.vp.setModel(m);
    if (this.selection !== null && !partById(m, this.selection)) this.selection = null;
    this.vp.setSelection(this.selection !== null ? [this.selection] : []);
    this.vp.setRootMarkerVisible(true);
    this.updateKinematicsOverlay();
    this.status.setCounts(kinematicsSummary(m, this.graph()));
    this.scheduleAutosave();
    this.refreshUI();
    this.refreshHover();
  }

  /** Apply an OpResult as one undoable step. */
  private applyOp(r: OpResult): boolean {
    if (!r.ok) {
      this.error(r.message);
      return false;
    }
    if (r.partId !== undefined) this.selection = r.partId;
    this.history.push(r.model);
    if (r.message) this.info(r.message);
    return true;
  }

  private withSelection(fn: (id: number, m: Model) => OpResult): void {
    if (!this.editable()) return;
    if (this.selection === null) return;
    this.applyOp(fn(this.selection, this.history.current));
  }

  /** False (with a status message) while simulating. */
  private editable(): boolean {
    if (this.mode === 'edit') return true;
    this.info(BLOCKED);
    return false;
  }

  // ===========================================================================================
  // Messages

  info(text: string): void {
    this.status.setMessage(text, false);
  }

  /** Status-bar error; `banner` also shows it over the viewport (file errors, simulation failures). */
  error(text: string, banner = false): void {
    this.status.setMessage(text, true);
    if (banner) this.banner.show(text);
  }

  // ===========================================================================================
  // UI refresh

  refreshUI(): void {
    const editing = this.mode === 'edit';
    document.body.classList.toggle('simulating', this.mode !== 'edit');
    document.body.classList.toggle('busy', this.mode === 'starting');
    this.simBadge.hidden = this.mode !== 'simulate';
    this.topbar.update({
      mode: this.mode,
      paused: this.session?.paused ?? false,
      canUndo: this.history.canUndo,
      canRedo: this.history.canRedo,
      color: this.tool.color,
      showKinematics: this.showKinematics,
      speed: this.speed,
    });
    this.toolbar.update({
      tool: this.tool.tool,
      newPart: this.tool.newPart,
      disabled: !editing,
      orientationHint: editing ? (this.proposal?.orientationHint ?? '') : '',
    });
    const m = this.history.current;
    this.inspector.update(this.selection !== null ? partInfo(m, this.selection, effectiveRootId(m)) : null, !editing);
  }

  private updateKinematicsOverlay(): void {
    if (this.showKinematics) {
      const g = this.graph();
      this.vp.setPartColors(partTints(g));
      this.vp.setJointGlyphs(jointGlyphsFromGraph(g));
      this.vp.setGlyphsVisible(true);
    } else {
      this.vp.setPartColors(null);
      this.vp.setGlyphsVisible(false);
    }
  }

  private clearEditOverlays(): void {
    this.vp.setGhost(null);
    this.vp.setHoverFace(null);
    this.vp.setHoverCell(null);
    this.proposal = null;
  }

  /** Re-resolve what the pointer is over (pointer move, model / tool / Shift / camera change). */
  refreshHover(): void {
    const ev = this.lastHover;
    if (this.mode !== 'edit') {
      this.clearEditOverlays();
      this.simHover(ev);
      return;
    }
    if (!ev) {
      this.clearEditOverlays();
      this.status.setHover('');
      this.status.setHint(this.idleHint());
      this.toolbarHintSync();
      return;
    }
    const ray = this.vp.rayAt(ev.clientX, ev.clientY);
    const m = this.history.current;
    const hit = pickCell(m, ray);
    const grid = hit ? null : pickGrid(ray);
    this.status.setHover(describeHover(m, hit, grid));
    const t = this.tool.tool;
    if (t === 'select') {
      this.clearEditOverlays();
      const sp = resolveSelect(m, hit);
      this.status.setHint(sp.description || (this.selection !== null ? 'Click empty space to deselect' : 'Click a part to select it'));
    } else if (t === 'erase') {
      this.vp.setGhost(null);
      this.vp.setHoverFace(null);
      this.proposal = null;
      const ep = resolveErase(m, hit);
      this.vp.setHoverCell(ep.valid && ep.highlight ? { cell: ep.highlight.pos } : null);
      this.status.setHint(ep.description || 'Click a sub-part to erase it');
    } else {
      this.vp.setHoverCell(null);
      const p = resolveBuild(m, hit, grid, withShift(this.tool, this.shiftDown));
      this.proposal = p;
      if (p.action === 'none' || !p.cell) {
        this.vp.setGhost(null);
        this.vp.setHoverFace(null);
        this.status.setHint(this.idleHint());
      } else {
        this.vp.setGhost({ cell: p.cell, valid: p.valid });
        this.vp.setHoverFace(p.highlight ? { cell: p.highlight.pos, dir: p.highlight.dir, ...(p.valid ? {} : { color: RED }) } : null);
        const aux = [p.orientationHint, p.shiftHint].filter(Boolean).join('   ');
        this.status.setHint(p.description, !p.valid, aux);
      }
    }
    this.toolbarHintSync();
  }

  private lastOrientationHint = '';
  private toolbarHintSync(): void {
    const hint = this.proposal?.orientationHint ?? '';
    if (hint !== this.lastOrientationHint) {
      this.lastOrientationHint = hint;
      this.refreshUI();
    }
  }

  private idleHint(): string {
    switch (this.tool.tool) {
      case 'select':
        return 'Click a part to select it';
      case 'erase':
        return 'Click a sub-part to erase it';
      default:
        return 'Point at a part’s face, or at the grid to start a new part';
    }
  }

  private simHover(ev: ViewportPointerEvent | null): void {
    const s = this.session;
    if (!s || !ev) {
      this.status.setHover('');
      this.status.setHint(this.mode === 'starting' ? 'Starting the simulation…' : 'Drag a moving part to pull it · drag elsewhere to orbit');
      return;
    }
    const hit = s.pick(this.vp.rayAt(ev.clientX, ev.clientY));
    if (!hit) {
      this.status.setHover('');
      this.status.setHint('Drag to orbit · drag a moving part to pull it');
      return;
    }
    const body = s.sim.bodyOf(hit.partId);
    this.status.setHover(`Part ${hit.partId} · body ${body ?? '?'}`);
    this.status.setHint(s.isDynamicPart(hit.partId) ? `Drag to pull part ${hit.partId}` : `Part ${hit.partId} is fixed · drag to orbit`);
  }

  private setShift(on: boolean): void {
    if (this.shiftDown === on) return;
    this.shiftDown = on;
    if (this.mode === 'edit' && isBuildTool(this.tool.tool)) this.refreshHover();
  }

  // ===========================================================================================
  // Pointer

  private click(e: ViewportPointerEvent): void {
    if (e.button !== 0) return;
    if (this.mode !== 'edit') return; // the model is frozen; drags grab or orbit
    this.lastHover = e;
    const m = this.history.current;
    const ray = e.ray;
    const hit = pickCell(m, ray);
    const t = this.tool.tool;
    if (t === 'select') {
      const sp = resolveSelect(m, hit);
      this.selection = sp.partId;
      this.vp.setSelection(sp.partId !== null ? [sp.partId] : []);
      this.refreshUI();
      this.refreshHover();
      return;
    }
    if (t === 'erase') {
      const ep = resolveErase(m, hit);
      if (!ep.valid) return;
      this.history.push(ep.apply(m));
      this.info(ep.description.replace(/^Erase/, 'Erased'));
      return;
    }
    const grid = hit ? null : pickGrid(ray);
    const p = resolveBuild(m, hit, grid, withShift(this.tool, e.shiftKey));
    if (p.action === 'none') return;
    if (!p.valid) {
      this.error(`Can’t place here: ${p.reason ?? 'not possible'}`);
      return;
    }
    const r = p.apply(m);
    this.history.push(r.model);
    this.info(`${p.description} → part ${r.partId}`);
  }

  // ===========================================================================================
  // Tools

  selectTool(t: Tool): void {
    if (!this.editable()) return;
    this.tool = selectTool(this.tool, t);
    if (t !== 'select' && this.selection !== null) {
      this.selection = null;
      this.vp.setSelection([]);
    }
    this.refreshUI();
    this.refreshHover();
  }

  toggleNewPart(): void {
    if (!this.editable()) return;
    this.tool = setNewPart(this.tool, !this.tool.newPart);
    this.info(this.tool.newPart ? 'New part: on — clicks start separate parts' : 'New part: off');
    this.refreshUI();
    this.refreshHover();
  }

  cycleOrientation(): void {
    if (!this.editable()) return;
    const p = this.proposal;
    if (!p || p.options.length < 2) {
      this.info(p ? 'No other orientation is valid here' : 'Point at a face or the grid first, then press R');
      return;
    }
    this.tool = cycleOrientation(this.tool, p);
    this.refreshHover();
  }

  pickColor(c: string): void {
    if (!this.editable()) return;
    this.tool = pickColor(this.tool, c);
    this.refreshUI();
    this.refreshHover();
  }

  setShowKinematics(on: boolean): void {
    this.showKinematics = on;
    this.updateKinematicsOverlay();
    this.refreshUI();
  }

  // ===========================================================================================
  // Undo / files / examples

  undo(): void {
    if (!this.editable()) return;
    if (this.history.undo()) this.info('Undone');
    else this.info('Nothing to undo');
  }

  redo(): void {
    if (!this.editable()) return;
    if (this.history.redo()) this.info('Redone');
    else this.info('Nothing to redo');
  }

  /**
   * Replace the whole model (New / Open / example). Pushed onto the history like any other edit,
   * so an accidental New or Open can be undone (see docs/DEVIATIONS.md §7 app).
   */
  private replaceModel(m: Model, fileName: string | null, fit: 'home' | 'empty' | 'none'): void {
    this.selection = null;
    this.fileName = fileName;
    this.vp.setSelection([]);
    this.history.push(m);
    if (fit === 'home') this.vp.home();
    else if (fit === 'empty') this.vp.setCamera(defaultCamera());
  }

  newModel(): void {
    if (!this.editable()) return;
    this.replaceModel(emptyModel(), null, 'empty');
    this.info('New model · pick a build tool (1–5) and click the grid');
  }

  openFile(): void {
    if (!this.editable()) return;
    this.picker.open();
  }

  /** Open a file's text (from the picker, or the test hook). */
  openText(name: string, text: string): boolean {
    if (!this.editable()) return false;
    const r = parseModelFile(text);
    if (!r.ok) {
      this.error(`Could not open ${name}: ${r.message}`, true);
      return false;
    }
    this.banner.hide();
    this.replaceModel(r.model, name, 'home');
    this.info(`Opened ${name} · ${r.model.parts.length} parts`);
    return true;
  }

  save(): void {
    const name = suggestFileName(this.fileName);
    try {
      downloadText(name, modelFileText(this.history.current));
      this.info(`Saved ${name}`);
    } catch (e) {
      this.error(`Save failed: ${e instanceof Error ? e.message : String(e)}`, true);
    }
  }

  loadExample(name: string): void {
    if (!this.editable()) return;
    const ex = exampleByName(name);
    if (!ex) {
      this.error(`Unknown example ${name}`);
      return;
    }
    this.replaceModel(ex.build(), ex.name, 'home');
    this.info(`${ex.title} · press Play to simulate`);
  }

  /** Programmatic model replacement (test hook): like Open, without moving the camera. */
  setModel(m: Model): void {
    this.replaceModel(m, null, 'none');
  }

  private scheduleAutosave(): void {
    if (!this.storage) return;
    window.clearTimeout(this.autosaveTimer);
    this.autosaveTimer = window.setTimeout(() => this.flushAutosave(), AUTOSAVE_DELAY_MS);
  }

  /** Write the autosave now (also on page hide). */
  flushAutosave(): void {
    window.clearTimeout(this.autosaveTimer);
    this.autosaveTimer = 0;
    if (!this.storage) return;
    const r = autosave(this.storage, this.history.current);
    if (!r.ok && !this.autosaveFailed) this.error(r.message);
    this.autosaveFailed = !r.ok;
  }

  // ===========================================================================================
  // Selection operations (keys)

  private cameraBasisNow(): CameraBasis {
    const c = this.vp.getCamera();
    const b = cameraBasis(c.yaw, c.pitch);
    return { right: b.right, up: b.up, forward: [-b.back[0], -b.back[1], -b.back[2]] };
  }

  // ===========================================================================================
  // Simulate mode

  async play(opts: { paused?: boolean } = {}): Promise<void> {
    if (this.mode === 'starting') return this.starting ?? undefined;
    if (this.mode !== 'edit') return;
    const model = this.history.current;
    if (!model.parts.length) {
      this.info('Nothing to simulate: the model is empty');
      return;
    }
    this.mode = 'starting';
    this.clearEditOverlays();
    this.topbar.closeMenus();
    this.refreshUI();
    this.refreshHover();
    const run = (async () => {
      try {
        const s = await SimSession.start(this.vp, model, this.speed, {
          fail: (msg) => this.simFailed(msg),
          readout: (t, slow) => this.topbar.setSimReadout(t, slow),
        }, opts);
        this.session = s;
        this.mode = 'simulate';
        this.vp.setGridVisible(false);
        this.banner.hide();
        this.info(opts.paused ? 'Simulation ready (paused) · Space to run, Esc to stop' : 'Simulating · Space pauses, Esc stops');
      } catch (e) {
        this.mode = 'edit';
        this.error(`Could not start the simulation: ${e instanceof Error ? e.message : String(e)}`, true);
      } finally {
        this.starting = null;
        this.refreshUI();
        this.refreshHover();
      }
    })();
    this.starting = run;
    return run;
  }

  /** Stop: dispose the simulation and show the model exactly as edited (camera untouched). */
  stop(): void {
    if (this.mode !== 'simulate') return;
    this.session?.dispose();
    this.session = null;
    this.vp.clearTransforms();
    this.vp.showAllParts();
    this.vp.setGridVisible(true);
    this.mode = 'edit';
    this.refreshUI();
    this.refreshHover();
  }

  private simFailed(msg: string): void {
    // Called from inside the frame callback: stop on the next tick so the viewport finishes its frame.
    queueMicrotask(() => {
      this.stop();
      this.error(`Simulation stopped: ${msg}`, true);
    });
  }

  togglePause(): void {
    const s = this.session;
    if (this.mode !== 'simulate' || !s) return;
    s.paused = !s.paused;
    this.info(s.paused ? 'Paused · Step (.) advances 1/60 s · Space resumes' : 'Running');
    this.refreshUI();
  }

  setPaused(on: boolean): void {
    if (this.session && this.session.paused !== on) this.togglePause();
  }

  async stepButton(): Promise<void> {
    if (this.mode === 'edit') await this.play({ paused: true });
    const s = this.session;
    if (this.mode !== 'simulate' || !s) return;
    if (!s.paused) {
      s.paused = true;
      this.refreshUI();
    }
    s.stepFixed(Math.round(STEP_SECONDS / s.sim.fixedDt));
    this.topbar.setSimReadout(s.time, false);
  }

  setSpeed(speed: number): void {
    this.speed = speed;
    this.session?.setSpeed(speed);
    this.refreshUI();
  }

  // ===========================================================================================
  // Keyboard

  private keydown(e: KeyboardEvent): void {
    if (e.key === 'Shift') {
      this.setShift(true);
      return;
    }
    if (isTypingTarget(e.target)) return;
    const mod = e.ctrlKey || e.metaKey;
    const key = e.key;
    const lower = key.length === 1 ? key.toLowerCase() : key;

    // Dialogs and menus first.
    if (this.help.isOpen || this.about.isOpen) {
      if (key === 'Escape' || (key === '?' && this.help.isOpen)) {
        e.preventDefault();
        this.help.close();
        this.about.close();
      }
      return;
    }
    if (key === 'Escape' && this.topbar.menuOpen) {
      e.preventDefault();
      this.topbar.closeMenus();
      return;
    }

    if (mod && !e.altKey) {
      if (lower === 'z') {
        e.preventDefault();
        if (e.shiftKey) this.redo();
        else this.undo();
      } else if (lower === 'y' && !e.shiftKey) {
        e.preventDefault();
        this.redo();
      } else if (lower === 's' && !e.shiftKey) {
        e.preventDefault();
        this.save();
      } else if (lower === 'o' && !e.shiftKey) {
        e.preventDefault();
        this.openFile();
      }
      return; // never steal other browser shortcuts
    }
    if (e.altKey || mod) return;

    // Simulation keys.
    if (key === ' ' || key === 'Spacebar') {
      e.preventDefault();
      if (e.repeat) return;
      if (this.mode === 'edit') void this.play();
      else if (this.mode === 'simulate') this.togglePause();
      return;
    }
    if (key === 'Escape' && this.mode !== 'edit') {
      e.preventDefault();
      this.stop();
      return;
    }
    if (key === '.') {
      e.preventDefault();
      void this.stepButton();
      return;
    }
    if (key === '?') {
      e.preventDefault();
      this.help.open();
      return;
    }
    if (lower === 'k') {
      e.preventDefault();
      this.setShowKinematics(!this.showKinematics);
      return;
    }
    if (key === 'f' || key === 'F' || key === 'Home') return; // the viewport's own keys

    // Editing keys.
    const toolKey = TOOL_KEYS[lower.toLowerCase()];
    const mk = moveKeyOf(key);
    const editKey =
      toolKey !== undefined ||
      lower === 'n' ||
      lower === 'r' ||
      lower === 'd' ||
      key === 'Delete' ||
      key === 'Backspace' ||
      key === '[' ||
      key === ']' ||
      (mk !== null && this.selection !== null);
    if (!editKey) return;
    e.preventDefault();
    if (!this.editable()) return;
    if (toolKey !== undefined) {
      if (key === 'Escape' && this.selection !== null && this.tool.tool === 'select') {
        this.selection = null;
        this.vp.setSelection([]);
        this.refreshUI();
        this.refreshHover();
        return;
      }
      this.selectTool(toolKey);
    } else if (lower === 'n') this.toggleNewPart();
    else if (lower === 'r') this.cycleOrientation();
    else if (this.selection === null) {
      if (key === 'Delete' || key === 'Backspace' || key === '[' || key === ']' || lower === 'd') this.info('Select a part first (V, then click it)');
    } else if (key === 'Delete' || key === 'Backspace') this.withSelection((id, m) => deleteSelection(m, id));
    else if (lower === 'd') this.withSelection((id, m) => duplicateSelection(m, id));
    else if (key === '[' || key === ']') {
      const cam = this.cameraBasisNow();
      this.withSelection((id, m) => rotateSelection(m, id, cam, key));
    } else if (mk !== null) {
      const d = moveDelta(this.cameraBasisNow(), mk);
      this.withSelection((id, m) => moveSelection(m, id, d));
    }
  }
}
