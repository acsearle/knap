// Tool state and click resolution for Build / Wheel / Gear / Erase / Select (DESIGN.md §7.2, §7.3). Pure.
//
// See the header of ./index.ts for the contract and the orientation-cycling rule.
import {
  AXES,
  DIRS,
  GEAR_RADII,
  RIM_MIN,
  RIM_STEP,
  addCell,
  addPart,
  axisLabel,
  axisOfDir,
  canAddCell,
  canRemoveCell,
  canSetRim,
  cellsAt,
  defaultColorFor,
  discOverlapsCell,
  discRadiusOf,
  fineDiscOverlapsCell,
  gearMeshes,
  gearTeeth,
  gearsOf,
  hasRim,
  isGear,
  isHole,
  isWebCell,
  isMale,
  isValidRim,
  kindLabel,
  makeCell,
  mateType,
  partById,
  removeCell,
  canSetGear,
  setGear,
  setRim,
  shareResult,
  tipRadius,
} from '../core';
import type { Axis, Cell, Dir, Kind, Model, Vec3i } from '../core';
import type { KinematicGraph } from '../core/kinematics';
import { kinematicsSummary } from './kinview';
import { pickBack, pickCell } from './picking';
import type { PickHit, Ray } from './picking';

// ---------------------------------------------------------------------------------------------
// Tools and tool state

export type Tool = 'select' | 'erase' | 'wheel' | 'gear' | Kind;

/** Keyboard shortcuts (§7.2), lower-case `KeyboardEvent.key` → tool. `Escape` also selects 'select'. */
export const TOOL_KEYS: Readonly<Record<string, Tool>> = {
  v: 'select',
  escape: 'select',
  '1': 'pinHole',
  '2': 'axleHole',
  '3': 'axle',
  '4': 'pin',
  '5': 'frictionPin',
  w: 'wheel',
  t: 'gear',
  e: 'erase',
};

/** The five build tools (one per cell kind); not Select, Wheel, Gear or Erase. */
export function isBuildTool(t: Tool): t is Kind {
  return t !== 'select' && t !== 'erase' && t !== 'wheel' && t !== 'gear';
}

export interface ToolState {
  readonly tool: Tool;
  /** The "New part" toggle [N]. Shift is applied per event with `withModifiers` / `withShift`. */
  readonly newPart: boolean;
  /**
   * The "Back side" toggle [B] (§7.3): build tools pick the back face under the cursor (pickBack,
   * chosen by `buildPick`). Alt/Option is applied per event with `withModifiers`. Ignored by
   * Select, Erase and Wheel.
   */
  readonly backSide: boolean;
  /**
   * Orientation cycling state: the axis last chosen with [R] for this tool, or null for the
   * natural default. Used whenever it is among the hover's valid orientations.
   */
  readonly axisPref: Axis | null;
  /** Current palette colour ('#rrggbb'). */
  readonly color: string;
  /** The user picked `color` explicitly since this tool was selected (see newPartColor). */
  readonly colorPicked: boolean;
  /**
   * Set only by `withShift` when it turned newPart on for one event. Such a state is a per-event
   * view, not the session's tool state: every state function (selectTool, setNewPart, pickColor,
   * cycleOrientation) drops the Shift-induced newPart again, so it can never latch on.
   */
  readonly shiftHeld?: true;
  /** Like shiftHeld, for a backSide turned on by Alt/Option (`withModifiers`) for one event. */
  readonly altHeld?: true;
}

/** The base state under a withShift / withModifiers view (identity for a base state). */
function baseState(s: ToolState): ToolState {
  if (!s.shiftHeld && !s.altHeld) return s;
  const { shiftHeld, altHeld, ...rest } = s;
  return { ...rest, newPart: shiftHeld ? false : rest.newPart, backSide: altHeld ? false : rest.backSide };
}

/** Default palette colour for hole parts before the user picks one (matches core DEFAULT_COLORS). */
export const DEFAULT_PALETTE_COLOR = defaultColorFor('pinHole');

export function initialToolState(color: string = DEFAULT_PALETTE_COLOR): ToolState {
  return { tool: 'select', newPart: false, backSide: false, axisPref: null, color, colorPicked: false };
}

/** Switch tool. Selecting a different tool resets axisPref and colorPicked; the same tool is a no-op. */
export function selectTool(s: ToolState, tool: Tool): ToolState {
  s = baseState(s);
  if (s.tool === tool) return s;
  return { ...s, tool, axisPref: null, colorPicked: false };
}

export function setNewPart(s: ToolState, on: boolean): ToolState {
  s = baseState(s);
  return s.newPart === on ? s : { ...s, newPart: on };
}

/** The "Back side" toggle [B]. */
export function setBackSide(s: ToolState, on: boolean): ToolState {
  s = baseState(s);
  return s.backSide === on ? s : { ...s, backSide: on };
}

/**
 * The state to resolve a hover / click with while modifiers are held: Shift = temporary "New
 * part", Alt/Option = temporary "Back side". Modifiers not held give the base state (so
 * withModifiers(withModifiers(s, {shift: true, alt: true}), {}) is s again). A toggle that is
 * already on is the base state and is kept.
 */
export function withModifiers(s: ToolState, mods: { shift?: boolean; alt?: boolean }): ToolState {
  s = baseState(s);
  const np = !!mods.shift && !s.newPart;
  const bs = !!mods.alt && !s.backSide;
  if (!np && !bs) return s;
  return { ...s, ...(np ? { newPart: true, shiftHeld: true as const } : {}), ...(bs ? { backSide: true, altHeld: true as const } : {}) };
}

/** withModifiers(s, { shift }) — Shift only (an Alt-induced backSide is dropped). */
export function withShift(s: ToolState, shift: boolean): ToolState {
  return withModifiers(s, { shift });
}

/** The user clicked a palette swatch. */
export function pickColor(s: ToolState, color: string): ToolState {
  s = baseState(s);
  return { ...s, color: color.toLowerCase(), colorPicked: true };
}

/**
 * Colour of a new part whose (first) cell is `kind` (§6.1, §7.3):
 * - hole kinds: always the current palette colour `s.color`;
 * - male kinds: the kind default (axle light grey, pin tan, friction pin blue) — unless the user
 *   picked a swatch while the current tool was selected (`colorPicked`), then `s.color`.
 *   colorPicked is cleared by selecting another tool, so an explicit choice applies to the tool
 *   in hand and does not silently recolour later pins.
 */
export function newPartColor(s: ToolState, kind: Kind): string {
  if (isHole(kind) || s.colorPicked) return s.color;
  return defaultColorFor(kind);
}

// ---------------------------------------------------------------------------------------------
// Build proposals

export type BuildAction = 'extend' | 'insert' | 'sleeve' | 'newAdjacent' | 'newOnGrid' | 'none';

/** The minimal pick resolveBuild/resolveErase/resolveSelect need (a PickHit satisfies it). */
export interface CellPick {
  partId: number;
  cellIndex: number;
  /** Face entered (outward normal DIRS[dir], edit-time frame). */
  dir: Dir;
  /**
   * Wheels (§7.3): a hit on the flat face of a rim's disc outside the part's own cells. cellIndex
   * is then the hub and `virtual` the grid cell G under the hit point in the hub's layer (a
   * *virtual cell* of the wheel); dir is the flat face (∥ the hub axis).
   */
  virtual?: Vec3i;
  /** Wheels (§7.3): a hit on a disc's tread; cellIndex is the hub, dir a lateral face of it. */
  tread?: boolean;
  /**
   * Back side (§7.3): a back-face pick (pickBack): `dir` is the face the ray LEAVES the part
   * through, and resolveBuild resolves it as that face hovered from behind (Proposal.backSide).
   */
  back?: boolean;
}

/** The minimal grid pick (a GridHit satisfies it). */
export interface GridPick {
  pos: Vec3i;
  dir?: Dir;
}

/** A face to highlight: face `dir` of the cell at `pos`. */
export interface Highlight {
  pos: Vec3i;
  dir: Dir;
}

export interface ApplyResult {
  model: Model;
  /** The part that received the cell (extended / joined / newly created). */
  partId: number;
}

export interface Proposal {
  /** The model this proposal was resolved against; apply() refuses any other. */
  baseModel: Model;
  action: BuildAction;
  valid: boolean;
  /** Why it is invalid (status bar, red ghost). Absent when valid or for 'none'. */
  reason?: string;
  /** The ghost: the cell a click would add, including the chosen axis. null for 'none'. */
  cell: Cell | null;
  /**
   * Further cells of the same new part (same kind and axis), [] normally. Only a deep insert has
   * them: the male continues through the empty coaxial holes stacked behind the hovered one.
   */
  extraCells: readonly Cell[];
  /**
   * The existing part that receives the cell: the extended part ('extend'), or the male part an
   * 'insert' joins (see `joins`). Absent when the click creates a new part.
   */
  targetPartId?: number;
  /** The hovered part (absent for grid / none). */
  hoverPartId?: number;
  /** 'insert' that adds the male to an existing coaxial male part behind the hole (see index.ts). */
  joins: boolean;
  /** apply() creates a new part. */
  createsPart: boolean;
  /** Colour of the new part, when one is created. */
  color: string | null;
  /**
   * Colour to draw the ghost with (the renderer may override it with red when !valid): the
   * receiving part's colour for extend / insert-join, the new part's colour otherwise.
   * '' for 'none'.
   */
  ghostColor: string;
  /** Hovered face (cell hover) or the grid square (face −Y of the grid cell). null for 'none'. */
  highlight: Highlight | null;
  /** Status-bar sentence ("Extend part 3 · pin hole ∥ Z", "New part · insert pin ∥ Z into part 1", …). */
  description: string;
  /** Valid orientations for this hover in [R] order; options[0] is the natural default. [] if invalid. */
  options: readonly Axis[];
  /** "[R] 2/3" when there is more than one valid orientation, else ''. */
  orientationHint: string;
  /**
   * Without newPart only: what a click with Shift held would do instead, when that is a different
   * valid action, or the same action without joining ("Shift: New part · sleeve pin hole ∥ Z onto part 2"), else ''.
   */
  shiftHint: string;
  /**
   * Resolved from a back-face pick (Back side, §7.3): `highlight` is the back face the ray leaves
   * through and `description` ends with " · back side (−Z)" (before " — reason" when invalid).
   */
  backSide: boolean;
  /**
   * Perform it on `current`, which must be `baseModel` (pass history.current). Throws if !valid
   * (message = `reason`) or if `current` is another model (the hover is stale, e.g. after undo:
   * re-resolve it). Pure: returns a new model.
   */
  apply(current: Model): ApplyResult;
}

/** Message of the error apply() throws for a stale proposal. */
export const STALE_PROPOSAL = 'the model changed since this hover was resolved; re-resolve it';

function noProposal(m: Model): Proposal {
  return {
    baseModel: m,
    action: 'none',
    valid: false,
    cell: null,
    extraCells: [],
    joins: false,
    createsPart: false,
    color: null,
    ghostColor: '',
    highlight: null,
    description: '',
    options: [],
    orientationHint: '',
    shiftHint: '',
    backSide: false,
    apply(): ApplyResult {
      throw new Error('nothing to do here');
    },
  };
}

/** "a pin", "an axle hole". */
function aKind(k: Kind): string {
  const l = kindLabel(k);
  return `${/^[aeiou]/.test(l) ? 'an' : 'a'} ${l}`;
}

function fmt(p: Vec3i | Cell): string {
  return 'x' in p ? `(${p.x}, ${p.y}, ${p.z})` : `(${p[0]}, ${p[1]}, ${p[2]})`;
}

function add3(p: Vec3i, d: Vec3i, s = 1): Vec3i {
  return [p[0] + s * d[0], p[1] + s * d[1], p[2] + s * d[2]];
}

/** [a, a+1, a+2] mod 3. */
function cyclicFrom(a: Axis): Axis[] {
  return [a, ((a + 1) % 3) as Axis, ((a + 2) % 3) as Axis];
}

/** Move `first` to the front of `order` (if present). */
function preferFirst(order: Axis[], first: Axis | null): Axis[] {
  if (first === null || !order.includes(first)) return order;
  return [first, ...order.filter((a) => a !== first)];
}

/**
 * Axis of the single cell of another part (not `exceptPart`) of the opposite class at `pos`,
 * i.e. the one a new `kind` cell would have to be coaxial with. null if none / ambiguous.
 */
function occupantAxis(m: Model, pos: Vec3i, kind: Kind, exceptPart: number | null): Axis | null {
  const others = cellsAt(m, pos).filter((e) => e.partId !== exceptPart);
  if (others.length !== 1) return null;
  const c = others[0]!.cell;
  return isMale(kind) !== isMale(c.kind) ? c.axis : null;
}

/** One candidate action evaluated over an ordered list of axes. */
interface Attempt {
  action: Exclude<BuildAction, 'none'>;
  pos: Vec3i;
  /** Part receiving the cell; null = new part. */
  partId: number | null;
  joins: boolean;
  /** Candidate axes in [R] order (natural default first). */
  order: Axis[];
  valid: Axis[];
  /** Reason per invalid axis. */
  reasons: Map<Axis, string>;
  /** Overrides per-axis reasons (precondition failure). */
  reason?: string;
  /** Deep insert: positions of the further male cells (behind `pos`), and the parts of their holes. */
  extra?: Vec3i[];
  throughParts?: number[];
  /** Extend into a virtual cell of a wheel (§7.3): the description says "in the wheel". */
  inWheel?: boolean;
  /** … of a gear: "in the gear". */
  inGear?: boolean;
}

function attempt(
  m: Model,
  action: Attempt['action'],
  kind: Kind,
  pos: Vec3i,
  partId: number | null,
  order: Axis[],
  joins = false,
): Attempt {
  const a: Attempt = { action, pos, partId, joins, order, valid: [], reasons: new Map() };
  for (const axis of order) {
    const r = canAddCell(m, partId, makeCell(pos[0], pos[1], pos[2], kind, axis));
    if (r.ok) a.valid.push(axis);
    else a.reasons.set(axis, r.reason);
  }
  return a;
}

function failed(action: Attempt['action'], pos: Vec3i, partId: number | null, order: Axis[], reason: string): Attempt {
  return { action, pos, partId, joins: false, order, valid: [], reasons: new Map(), reason };
}

interface Ctx {
  m: Model;
  kind: Kind;
  state: ToolState;
  highlight: Highlight;
  hoverPartId?: number;
}

function chosenAxis(a: Attempt, pref: Axis | null): Axis {
  if (a.valid.length) return pref !== null && a.valid.includes(pref) ? pref : a.valid[0]!;
  return pref !== null && a.order.includes(pref) ? pref : a.order[0]!;
}

function describe(a: Attempt, ctx: Ctx, axis: Axis): string {
  const what = `${kindLabel(ctx.kind)} ∥ ${axisLabel(axis)}`;
  switch (a.action) {
    case 'extend':
      return `Extend part ${a.partId} · ${what}${a.inGear ? ' in the gear' : a.inWheel ? ' in the wheel' : ''}`;
    case 'insert':
      if (a.joins) return `Extend part ${a.partId} · insert ${what} into part ${ctx.hoverPartId}`;
      if (a.extra?.length) {
        const through = [...new Set(a.throughParts)].filter((id) => id !== ctx.hoverPartId);
        const tail = through.length ? `, through part${through.length > 1 ? 's' : ''} ${through.join(', ')}` : '';
        return `New part · insert ${what} into part ${ctx.hoverPartId} · ${a.extra.length + 1} long${tail}`;
      }
      return `New part · insert ${what} into part ${ctx.hoverPartId}`;
    case 'sleeve':
      return `New part · sleeve ${what} onto part ${ctx.hoverPartId}`;
    case 'newAdjacent':
      return `New part · ${what}`;
    case 'newOnGrid':
      return `New part on grid · ${what}`;
  }
}

/**
 * A build refusal "(3, 0, 1) is inside the gear of part 3" (§2.7 rule 1: no bare cell inside a tip
 * disc) depends on build order: with the small gear's hole there first, the same final model is
 * valid and meshes. Say so (review m8 ux: a new user building the Gear train by hand hit this and
 * ended with no mesh).
 */
export function withGearOrderHint(reason: string): string {
  const m = /is inside the gear of part (\d+)/.exec(reason);
  if (!m) return reason;
  return `${reason} · build this before part ${m[1]}'s gear grows over it, or shrink that gear first (Gear tool, Shift+click) and grow it back after`;
}

/**
 * @param optionsOverride the [R] options to show instead of a.valid (sleeve-or-extend hover, see
 *   resolveCellHover); must contain the chosen axis.
 */
function toProposal(a: Attempt, ctx: Ctx, optionsOverride?: readonly Axis[]): Proposal {
  const axis = chosenAxis(a, ctx.state.axisPref);
  const cell = makeCell(a.pos[0], a.pos[1], a.pos[2], ctx.kind, axis);
  const extraCells = (a.extra ?? []).map((q) => makeCell(q[0], q[1], q[2], ctx.kind, axis));
  const valid = a.valid.length > 0;
  const reason = valid ? undefined : withGearOrderHint(a.reason ?? a.reasons.get(axis) ?? 'not possible here');
  const createsPart = a.partId === null;
  const color = createsPart ? newPartColor(ctx.state, ctx.kind) : null;
  const ghostColor = color ?? partById(ctx.m, a.partId!)?.color ?? newPartColor(ctx.state, ctx.kind);
  const base = describe(a, ctx, axis);
  const options = valid ? (optionsOverride ?? a.valid) : [];
  const idx = options.indexOf(axis);
  const m = ctx.m;
  const p: Proposal = {
    baseModel: m,
    action: a.action,
    valid,
    cell,
    extraCells,
    joins: a.joins,
    createsPart,
    color,
    ghostColor,
    highlight: ctx.highlight,
    description: valid ? base : `${base} — ${reason}`,
    options,
    orientationHint: options.length > 1 ? `[R] ${idx + 1}/${options.length}` : '',
    shiftHint: '',
    backSide: false,
    apply(current: Model): ApplyResult {
      if (!valid) throw new Error(reason);
      if (current !== m) throw new Error(STALE_PROPOSAL);
      if (a.partId === null) return addPart(m, [cell, ...extraCells], color!);
      return { model: addCell(m, a.partId, cell), partId: a.partId };
    },
  };
  if (reason !== undefined) p.reason = reason;
  if (a.partId !== null) p.targetPartId = a.partId;
  if (ctx.hoverPartId !== undefined) p.hoverPartId = ctx.hoverPartId;
  return p;
}

/**
 * What a click would do (§7.3) for the current build tool, given the cell pick (preferred when
 * non-null) and the grid pick (used only when nothing is under the cursor). Returns action
 * 'none' for non-build tools, when both picks are null, or for a stale pick (part/cell gone).
 * When no action is valid, returns the most relevant invalid one with a reason: the
 * specialised action (insert / sleeve) when its geometric precondition holds (male tool on an
 * axial face of a hole / hole tool on a male), else the generic one (extend / newAdjacent).
 */
export function resolveBuild(model: Model, pick: CellPick | null, grid: GridPick | null, state: ToolState): Proposal {
  if (!isBuildTool(state.tool)) return noProposal(model);
  const kind = state.tool;
  if (pick?.back) {
    // Back side (§7.3): resolve exactly as if the picked back face had been hovered from behind.
    const { back: _back, ...front } = pick;
    const p = resolveBuild(model, front, null, state);
    const suffix = ` · back side (${DIR_LABELS[pick.dir]})`;
    if (p.action === 'none') {
      // a refusal with a reason (a tread exit) still says it came from Back side
      if (p.description && p.reason) {
        const tail = ` — ${p.reason}`;
        p.description = `${p.description.slice(0, p.description.length - tail.length)}${suffix}${tail}`;
        p.backSide = true;
      }
      return p;
    }
    const tail = p.valid ? '' : ` — ${p.reason}`;
    const head = p.description.slice(0, p.description.length - tail.length);
    p.description = `${head}${suffix}${tail}`;
    // The Shift hint describes a Shift + Back side click, so it says back side too (it is only
    // ever set for a valid alternative, which has no " — reason" tail).
    if (p.shiftHint) p.shiftHint = `${p.shiftHint}${suffix}`;
    p.backSide = true;
    return p;
  }
  if (pick) {
    const part = partById(model, pick.partId);
    const C = part?.cells[pick.cellIndex];
    if (!part || !C) return noProposal(model);
    // A wheel's tread (fixer's ruling after review, DEVIATIONS §7): DESIGN resolves it as the hub's
    // lateral face, which builds a cell buried inside the disc, far from the cursor (and, for Back
    // side, highlights a face that is not under the cursor). Build tools refuse it with the way to
    // do it instead; Select, Wheel, Erase and grab still act on the tread.
    if (pick.tread) {
      const p = noProposal(model);
      p.hoverPartId = part.id;
      if (isGear(C)) {
        // Gears (§7.3 "Gears in picking"): the teeth are a tread.
        p.reason = "point at the gear's flat face or at a hole to build on a gear";
        p.description = `Part ${part.id} · gear teeth — ${p.reason}`;
      } else {
        p.reason = "point at the wheel's flat face or at a hole to build on a wheel";
        p.description = `Part ${part.id} · wheel tread — ${p.reason}`;
      }
      return p;
    }
    const G = pick.virtual;
    if (G && !isVirtualCellOf(part, C, G)) return noProposal(model);
    const resolveHover = (s: ToolState): Proposal =>
      G ? resolveVirtualHover(model, kind, part.id, C, G, pick.dir, s) : resolveCellHover(model, kind, part.id, C, pick.dir, s);
    const p = resolveHover(state);
    if (!state.newPart) {
      const alt = resolveHover({ ...state, newPart: true });
      const differs = !p.valid || alt.action !== p.action || alt.joins !== p.joins || alt.extraCells.length !== p.extraCells.length;
      if (alt.valid && differs) p.shiftHint = `Shift: ${alt.description}`;
    }
    return p;
  }
  if (grid) {
    const pos: Vec3i = [grid.pos[0], 0, grid.pos[2]];
    // Z first for every kind (DEVIATIONS §7): beams stand upright like every example, so a joint
    // built with the defaults turns about a horizontal axis and swings under gravity.
    const order = preferFirst(cyclicFrom(2), occupantAxis(model, pos, kind, null));
    const a = attempt(model, 'newOnGrid', kind, pos, null, order);
    return toProposal(a, { m: model, kind, state, highlight: { pos, dir: 3 } });
  }
  return noProposal(model);
}

/** '+X', '−X', … by Dir. */
export const DIR_LABELS: readonly string[] = ['+X', '−X', '+Y', '−Y', '+Z', '−Z'];

/**
 * The cell pick a build hover / click resolves with (§7.3): with a build tool and Back side on
 * (`state.backSide`, the [B] toggle or Alt held via withModifiers) the back face under the cursor
 * (pickBack), otherwise the front face (pickCell). Pass `front` when the caller already has
 * pickCell's result for the same ray, to avoid picking twice. Grid hovers are unaffected: the back
 * pick is null exactly when nothing is under the cursor.
 */
export function buildPick(model: Model, ray: Ray, state: ToolState, front?: PickHit | null): PickHit | null {
  if (isBuildTool(state.tool) && state.backSide) return pickBack(model, ray);
  return front !== undefined ? front : pickCell(model, ray);
}

/**
 * Deep insert of a `kind` male into hole C entered through face n: the run of cells C − n, C − 2n, …
 * that each hold exactly one cell, a hole coaxial with C that `kind` mates with (any part). null if
 * there is none or the resulting new part would be invalid.
 */
function deepInsert(m: Model, kind: Kind, C: Cell, n: Vec3i): Attempt | null {
  const cpos: Vec3i = [C.x, C.y, C.z];
  const extra: Vec3i[] = [];
  const throughParts: number[] = [];
  for (let k = 1; ; k++) {
    const q = add3(cpos, n, -k);
    const at = cellsAt(m, q);
    if (at.length !== 1) break;
    const h = at[0]!;
    if (!isHole(h.cell.kind) || h.cell.axis !== C.axis || mateType(kind, h.cell.kind) === null) break;
    extra.push(q);
    throughParts.push(h.partId);
  }
  if (!extra.length) return null;
  const cells = [cpos, ...extra].map((q) => makeCell(q[0], q[1], q[2], kind, C.axis));
  try {
    addPart(m, cells);
  } catch {
    return null;
  }
  return { action: 'insert', pos: cpos, partId: null, joins: false, order: [C.axis], valid: [C.axis], reasons: new Map(), extra, throughParts };
}

/**
 * The disc a hole cell carries for the editor (§2.6, §2.7): its pitch radius `r`, whether it is a
 * gear, and the radius it is picked and targeted by (`reach`: the tip radius r + 3/32 for a gear,
 * r for a plain wheel). null for a bare cell, a male cell or a malformed rim.
 */
export function editorDiscOf(c: Cell): { r: number; gear: boolean; reach: number } | null {
  if (!isHole(c.kind)) return null;
  const r = discRadiusOf(c);
  if (r === null) return null;
  const gear = isGear(c);
  return { r, gear, reach: gear ? tipRadius(r) : r };
}

/**
 * Does the disc of hub cell `hub` (a plain wheel's disc, or a gear's tip disc) overlap the cell at
 * `pos` with positive volume (the exact core predicates; only in the hub's layer)? False for a
 * cell without a disc.
 */
export function editorDiscOverlaps(hub: Cell, pos: Vec3i): boolean {
  const d = editorDiscOf(hub);
  if (!d) return false;
  const h: Vec3i = [hub.x, hub.y, hub.z];
  return d.gear ? fineDiscOverlapsCell(h, hub.axis, d.reach, pos) : discOverlapsCell(h, hub.axis, d.r, pos);
}

/**
 * Is G a virtual cell of the wheel or gear with hub `hub` in `part` (§7.3): the hub carries a disc
 * (a plain rim, or a gear's tip disc) that overlaps G, and G is not one of the part's own cells?
 */
export function isVirtualCellOf(part: { cells: readonly Cell[] }, hub: Cell, G: Vec3i): boolean {
  if (!editorDiscOf(hub)) return false;
  if (part.cells.some((c) => c.x === G[0] && c.y === G[1] && c.z === G[2])) return false;
  return editorDiscOverlaps(hub, G);
}

/**
 * Why a crank hole / crank pin cannot go at the virtual cell G of the gear `hub` (§7.3 "Gears in
 * picking", §2.7 rule 5: only the web, du² + dv² ≤ (r − ½)², has room): null when G is in the web.
 */
export function gearWebRefusal(hub: Cell & { rim: number }, G: Vec3i): string | null {
  if (isWebCell(hub, makeCell(G[0], G[1], G[2], hub.kind, hub.axis))) return null;
  const T = gearTeeth(hub.rim);
  const n = hub.rim - 0.5;
  if (n < 1) return `${aTeeth(T)} gear has no room for crank holes`;
  // The rule measures grid-cell centres; the cursor itself may be nearer the hub than N (review m8 ux).
  return `too close to the teeth — crank holes go on grid cells centred within ${n} of the hub`;
}

/** "an 8-tooth", "a 16-tooth". */
function aTeeth(T: number): string {
  return `${T === 8 ? 'an' : 'a'} ${T}-tooth`;
}

/**
 * Hover on a virtual cell G of the wheel or gear whose hub is `hub` (part P), through its flat
 * face `dir` (§7.3): a hole tool extends P with a hole *at G* (a crank hole; ∥ the hub axis first,
 * then the other axes in [R] order); with New part it starts a new part at G + n; on a plain wheel
 * a male tool is invalid ("add a hole here first": a pin goes into a crank hole). On a gear, hole
 * and male tools both extend P at G (a crank hole or a crank pin), but only in the web (§2.7 rule
 * 5); elsewhere on the face they are refused with gearWebRefusal's reason.
 */
function resolveVirtualHover(m: Model, kind: Kind, P: number, hub: Cell, G: Vec3i, dir: Dir, state: ToolState): Proposal {
  const ctx: Ctx = { m, kind, state, highlight: { pos: G, dir }, hoverPartId: P };
  const order = cyclicFrom(hub.axis);
  const gear = isGear(hub);
  if (!gear && isMale(kind)) return toProposal({ ...failed('extend', G, P, [hub.axis], 'add a hole here first'), inWheel: true }, ctx);
  if (state.newPart) {
    const T = add3(G, DIRS[dir]!);
    return toProposal(attempt(m, 'newAdjacent', kind, T, null, preferFirst(order, occupantAxis(m, T, kind, null))), ctx);
  }
  if (gear) {
    const why = gearWebRefusal(hub, G);
    if (why) return toProposal({ ...failed('extend', G, P, [hub.axis], why), inWheel: true, inGear: true }, ctx);
    return toProposal({ ...attempt(m, 'extend', kind, G, P, order), inWheel: true, inGear: true }, ctx);
  }
  return toProposal({ ...attempt(m, 'extend', kind, G, P, order), inWheel: true }, ctx);
}

function resolveCellHover(m: Model, kind: Kind, P: number, C: Cell, dir: Dir, state: ToolState): Proposal {
  const n = DIRS[dir]!;
  const nAxis = axisOfDir(dir);
  const cpos: Vec3i = [C.x, C.y, C.z];
  const T = add3(cpos, n);
  const ctx: Ctx = { m, kind, state, highlight: { pos: cpos, dir }, hoverPartId: P };

  // Natural default order at the adjacent cell T (extend / newAdjacent).
  const adjacentOrder = (exceptPart: number | null): Axis[] => {
    const base = isMale(kind) ? cyclicFrom(nAxis) : isHole(C.kind) ? cyclicFrom(C.axis) : [...AXES];
    return preferFirst(base, occupantAxis(m, T, kind, exceptPart));
  };

  const others = cellsAt(m, cpos).filter((e) => e.partId !== P);

  // Insert: male tool, C a hole, entered through an axial face.
  const insertRelevant = isMale(kind) && isHole(C.kind) && nAxis === C.axis;
  const doInsert = (): Attempt => {
    const order = [C.axis];
    const occupant = others.find((e) => isMale(e.cell.kind));
    if (occupant) {
      return failed('insert', cpos, null, order, `the ${kindLabel(C.kind)} at ${fmt(C)} already holds ${aKind(occupant.cell.kind)} (part ${occupant.partId})`);
    }
    if (mateType(kind, C.kind) === null) {
      const r = shareResult(makeCell(C.x, C.y, C.z, kind, C.axis), C);
      return failed('insert', cpos, null, order, r.ok ? 'not possible here' : r.reason);
    }
    if (!state.newPart) {
      // Join a coaxial male of another part that ends right behind the hole (see index.ts).
      const behind = add3(cpos, n, -1);
      const q = cellsAt(m, behind).find((e) => e.partId !== P && isMale(e.cell.kind) && e.cell.axis === C.axis);
      if (q) {
        const j = attempt(m, 'insert', kind, cpos, q.partId, order, true);
        if (j.valid.length) return j;
      }
      // Deep insert: push the male on through the empty, compatible coaxial holes stacked right
      // behind (see index.ts), so two stacked beams get pinned together.
      const deep = deepInsert(m, kind, C, n);
      if (deep) return deep;
    }
    return attempt(m, 'insert', kind, cpos, null, order);
  };

  // Sleeve: hole tool, C a male (any face).
  const sleeveRelevant = isHole(kind) && isMale(C.kind);
  const doSleeve = (): Attempt => {
    const order = [C.axis];
    const occupant = others.find((e) => isHole(e.cell.kind));
    if (occupant) {
      return failed('sleeve', cpos, null, order, `the ${kindLabel(C.kind)} at ${fmt(C)} is already in ${aKind(occupant.cell.kind)} (part ${occupant.partId})`);
    }
    if (mateType(C.kind, kind) === null) {
      const r = shareResult(makeCell(C.x, C.y, C.z, kind, C.axis), C);
      return failed('sleeve', cpos, null, order, r.ok ? 'not possible here' : r.reason);
    }
    return attempt(m, 'sleeve', kind, cpos, null, order);
  };

  const doExtend = (): Attempt => attempt(m, 'extend', kind, T, P, adjacentOrder(P));
  const doNewAdjacent = (): Attempt => attempt(m, 'newAdjacent', kind, T, null, adjacentOrder(null));

  // Hole tool on the axial end face of a rod (DEVIATIONS §7): sleeving a beam onto the rod is the
  // default, ahead of Extend (which would fuse a perpendicular hole onto the rod's end and turn a
  // loose pin into a liftarm-with-pin). Extend's orientations follow in the same [R] cycle; they
  // are perpendicular to the rod, so the axis alone tells which action is shown.
  if (!state.newPart && sleeveRelevant && nAxis === C.axis) {
    const sl = doSleeve();
    if (sl.valid.length) {
      const ex = doExtend();
      const exAxes = ex.valid.filter((ax) => ax !== C.axis);
      const options = [...sl.valid, ...exAxes];
      const pref = state.axisPref;
      if (pref !== null && exAxes.includes(pref)) return toProposal({ ...ex, valid: exAxes }, ctx, options);
      return toProposal(sl, ctx, options);
    }
  }

  type Step = { run: () => Attempt; special: boolean; relevant: boolean };
  const steps: Step[] = state.newPart
    ? [
        { run: doInsert, special: true, relevant: insertRelevant },
        { run: doSleeve, special: true, relevant: sleeveRelevant },
        { run: doNewAdjacent, special: false, relevant: true },
      ]
    : [
        { run: doExtend, special: false, relevant: true },
        { run: doInsert, special: true, relevant: insertRelevant },
        { run: doSleeve, special: true, relevant: sleeveRelevant },
      ];

  const tried: { a: Attempt; special: boolean }[] = [];
  for (const s of steps) {
    if (!s.relevant) continue;
    const a = s.run();
    if (a.valid.length) return toProposal(a, ctx);
    tried.push({ a, special: s.special });
  }
  const pickInvalid = tried.find((t) => t.special) ?? tried[0]!;
  return toProposal(pickInvalid.a, ctx);
}

// ---------------------------------------------------------------------------------------------
// Orientation cycling

/**
 * [R]: the state after cycling to the next valid orientation of the current hover. axisPref
 * becomes the option after the one the proposal shows (wrapping). No-op (same object) when the
 * proposal has fewer than two valid orientations.
 */
export function cycleOrientation(s: ToolState, p: Proposal): ToolState {
  s = baseState(s);
  if (p.options.length < 2 || !p.cell) return s;
  const i = p.options.indexOf(p.cell.axis);
  const next = p.options[(i + 1) % p.options.length]!;
  return { ...s, axisPref: next };
}

// ---------------------------------------------------------------------------------------------
// Erase and select

// ---------------------------------------------------------------------------------------------
// Wheels (§7.2 Wheel tool, Erase on rims)

/** A band of a wheel: radii r0..r1 about the hub's axis, in the hub's layer (erase / shrink highlight). */
export interface WheelRing {
  hub: Vec3i;
  axis: Axis;
  r0: number;
  r1: number;
}

/** "radius 1.5 (24 mm across)" — 1 unit = 8 mm, so the diameter is 16·r mm. */
export function wheelSize(r: number): string {
  return `radius ${r} (${Math.round(r * 16 * 100) / 100} mm across)`;
}

/** The radius after growing (bare → RIM_MIN → … ) or shrinking (… → RIM_MIN → bare = undefined) by half a unit. */
export function nextRim(r: number | undefined, shrink: boolean): number | undefined {
  if (!shrink) return r === undefined ? RIM_MIN : r + RIM_STEP;
  if (r === undefined) return undefined;
  return r - RIM_STEP < RIM_MIN ? undefined : r - RIM_STEP;
}

export interface WheelProposal {
  /** The model this proposal was resolved against; apply() refuses any other. */
  baseModel: Model;
  /** Click = grow by half a unit, Shift+click = shrink (§7.2). */
  mode: 'grow' | 'shrink';
  valid: boolean;
  /** Why not (status bar, red ghost). Absent when valid or when nothing is hovered. */
  reason?: string;
  /** The wheel's part and its hub cell (absent when nothing usable is hovered). */
  partId?: number;
  cellIndex?: number;
  hub?: Cell;
  /** Radius now and after the click (undefined = a bare hole cell, the "radius ½" wheel). */
  from?: number;
  to?: number;
  /** Grow: the ghost — the hub cell with its new rim (the disc at the new radius); red when !valid. */
  ghost: Cell | null;
  /** Shrink: the band that would be removed (highlight it). */
  ring: WheelRing | null;
  /** Hovered face of the hub (or of the virtual cell). */
  highlight: Highlight | null;
  /** "Grow wheel · part 3 · radius 1.5 (24 mm across)", "Shrink wheel · part 3 · back to a bare pin hole", "… — reason". '' when nothing is hovered. */
  description: string;
  /** Parts the wheel's part becomes (1 normally; ≥ 2 when shrinking splits off cells held only by the disc). */
  pieces: number;
  /** The hub is a gear: the click (either mode) makes it a plain wheel of the same radius (§7.2). */
  convert?: true;
  apply(current: Model): Model;
}

function noWheel(m: Model, mode: 'grow' | 'shrink'): WheelProposal {
  return {
    baseModel: m,
    mode,
    valid: false,
    ghost: null,
    ring: null,
    highlight: null,
    description: '',
    pieces: 0,
    apply(): Model {
      throw new Error('no wheel here');
    },
  };
}

/**
 * The hole cell a Wheel / Gear / Erase-on-rim hover acts on: the hub for a disc hit (virtual cell
 * or tread); the hovered hole cell; for a male cell sitting in a hole of another part (a pin or axle
 * through a hub, picked through the hole's mouth), that hole. null for a stale pick; `male` when a
 * lone male cell is hovered.
 *
 * Crank holes (§7.2): a bare hole of the part, in a disc's layer, that the disc overlaps (the exact
 * core disc × cell predicate: a plain wheel's disc, or a gear's tip disc — so a gear's web holes and
 * any own bare hole its teeth reach) acts on that wheel or gear, not on itself: a second disc there
 * would be hidden inside the first or poke out of it. With several such discs, the nearest hub
 * (centre distance), then the lower cell index.
 */
function wheelTarget(m: Model, pick: CellPick): { partId: number; cellIndex: number; cell: Cell } | { male: Cell; partId: number } | null {
  const part = partById(m, pick.partId);
  const cell = part?.cells[pick.cellIndex];
  if (!part || !cell) return null;
  if (pick.virtual || pick.tread) {
    if (!editorDiscOf(cell)) return null;
    if (pick.virtual && !isVirtualCellOf(part, cell, pick.virtual)) return null;
    return { partId: part.id, cellIndex: pick.cellIndex, cell };
  }
  if (isHole(cell.kind)) {
    if (!hasRim(cell) && cell.teeth === undefined) {
      const pos: Vec3i = [cell.x, cell.y, cell.z];
      let best = -1;
      let bestD = Infinity;
      for (let i = 0; i < part.cells.length; i++) {
        const h = part.cells[i]!;
        if (i === pick.cellIndex || !editorDiscOverlaps(h, pos)) continue;
        const d2 = (h.x - cell.x) ** 2 + (h.y - cell.y) ** 2 + (h.z - cell.z) ** 2;
        if (d2 < bestD) {
          best = i;
          bestD = d2;
        }
      }
      if (best >= 0) return { partId: part.id, cellIndex: best, cell: part.cells[best]! };
    }
    return { partId: part.id, cellIndex: pick.cellIndex, cell };
  }
  const hole = cellsAt(m, [cell.x, cell.y, cell.z]).find((e) => e.partId !== part.id && isHole(e.cell.kind));
  if (hole) return { partId: hole.partId, cellIndex: hole.index, cell: hole.cell };
  return { male: cell, partId: part.id };
}

/**
 * What a Wheel-tool click would do (§7.2): grow the hovered wheel's rim by half a unit
 * (bare → 1 → 1.5 → … → 4), or with `shrink` (Shift) shrink it by half a unit (1 → bare). The
 * hover may be a hole cell, the disc of a wheel (virtual cell or tread: that wheel), a bare hole
 * that a disc of its own part overlaps (that wheel or gear, see wheelTarget), or a male cell in
 * another part's hole (that hole). On a gear (either mode) it makes a plain wheel of the same
 * radius, 1 for an 8-tooth gear (`convert`). Each valid click is one setRim.
 */
export function resolveWheel(model: Model, pick: CellPick | null, shrink = false): WheelProposal {
  const mode = shrink ? 'shrink' : 'grow';
  if (!pick) return noWheel(model, mode);
  const tg = wheelTarget(model, pick);
  if (!tg) return noWheel(model, mode);
  const verb = shrink ? 'Shrink wheel' : 'Grow wheel';
  if ('male' in tg) {
    const p = noWheel(model, mode);
    p.reason = 'wheels grow from pin holes and axle holes';
    p.partId = tg.partId;
    p.description = `${verb} · part ${tg.partId} — ${p.reason}`;
    p.highlight = { pos: [tg.male.x, tg.male.y, tg.male.z], dir: pick.dir };
    return p;
  }
  const { partId, cellIndex, cell } = tg;
  const pos: Vec3i = [cell.x, cell.y, cell.z];
  const from = cell.rim;
  const gear = isGear(cell);
  const to = gear ? Math.max(cell.rim, RIM_MIN) : nextRim(from, shrink);
  const base = noWheel(model, mode);
  base.partId = partId;
  base.cellIndex = cellIndex;
  base.hub = cell;
  if (from !== undefined) base.from = from;
  base.highlight = { pos: pick.virtual ?? pos, dir: pick.dir };
  if (gear) base.convert = true;
  if (shrink && from === undefined) {
    base.reason = `this ${kindLabel(cell.kind)} has no wheel`;
    base.description = `${verb} · part ${partId} — ${base.reason}`;
    return base;
  }
  if (to !== undefined) base.to = to;
  const ok = canSetRim(model, partId, pos, to);
  const what = to === undefined ? `back to a bare ${kindLabel(cell.kind)}` : isValidRim(to) ? wheelSize(to) : '';
  const head = gear
    ? `Plain wheel · part ${partId} · ${wheelSize(to!)} instead of the ${gearTeeth(cell.rim)}-tooth gear`
    : `${verb} · part ${partId}${what ? ` · ${what}` : ''}`;
  if ((gear || !shrink) && to !== undefined && isValidRim(to)) base.ghost = makeCell(cell.x, cell.y, cell.z, cell.kind, cell.axis, to);
  if (!ok.ok) {
    base.reason = ok.reason;
    base.description = `${head} — ${ok.reason}`;
    return base;
  }
  const result = setRim(model, partId, pos, to);
  const pieces = result.parts.length - model.parts.length + 1;
  if (shrink && !gear) base.ring = { hub: pos, axis: cell.axis, r0: to ?? 0.5, r1: from! };
  base.valid = true;
  base.pieces = pieces;
  base.description = pieces > 1 ? `${head} · part ${partId} splits into ${pieces} parts` : head;
  base.apply = (current: Model): Model => {
    if (current !== model) throw new Error(STALE_PROPOSAL);
    return result;
  };
  return base;
}

// ---------------------------------------------------------------------------------------------
// Gears (§7.2 Gear tool, Erase on gears, §7.4 texts)

/** Greatest common divisor of two positive integers. */
function gcd(a: number, b: number): number {
  while (b) [a, b] = [b, a % b];
  return a;
}

/** A gear ratio reduced: gearRatio(24, 40) = "3:5". */
export function gearRatio(teethA: number, teethB: number): string {
  const g = gcd(teethA, teethB);
  return `${teethA / g}:${teethB / g}`;
}

/** "24 teeth (radius 1.5)". */
export function gearSize(r: number): string {
  return `${gearTeeth(r)} teeth (radius ${r})`;
}

/** One mesh partner of a gear: its part, tooth count and the ratio this gear : partner (reduced). */
export interface MeshPartner {
  partId: number;
  teeth: number;
  ratio: string;
}

/**
 * The meshes (gearMeshes, §2.7) of the gear whose hub is at `pos` (a hole cell of part `partId`):
 * each partner's part, teeth and the ratio. [] when there is no gear there or it meshes with nothing.
 */
export function meshPartners(m: Model, partId: number, pos: Vec3i): MeshPartner[] {
  const me = gearsOf(m).find((g) => g.partId === partId && g.hub[0] === pos[0] && g.hub[1] === pos[1] && g.hub[2] === pos[2]);
  if (!me) return [];
  const out: MeshPartner[] = [];
  for (const k of gearMeshes(m)) {
    const mine = k.a.partId === me.partId && k.a.index === me.index ? 'a' : k.b.partId === me.partId && k.b.index === me.index ? 'b' : null;
    if (!mine) continue;
    const other = mine === 'a' ? k.b : k.a;
    const teeth = mine === 'a' ? k.teethB : k.teethA;
    out.push({ partId: other.partId, teeth, ratio: gearRatio(me.teeth, teeth) });
  }
  return out;
}

/** "meshes with part 5 (40 teeth, 3:5), part 6 (8 teeth, 3:1)"; withRatio false drops the ratios. '' for none. */
export function meshText(partners: readonly MeshPartner[], withRatio = true): string {
  if (!partners.length) return '';
  return `meshes with ${partners.map((q) => `part ${q.partId} (${q.teeth} teeth${withRatio ? `, ${q.ratio}` : ''})`).join(', ')}`;
}

/**
 * Status-bar counts (§7.4): kinematicsSummary plus the gear meshes when there are any
 * ("3 parts · 3 bodies (1 fixed) · 2 joints: 2 revolute · 1 mesh").
 */
export function countsText(model: Model, graph?: KinematicGraph): string {
  const base = kinematicsSummary(model, graph);
  const n = gearMeshes(model).length;
  return n ? `${base} · ${n} ${n === 1 ? 'mesh' : 'meshes'}` : base;
}

export interface GearProposal {
  /** The model this proposal was resolved against; apply() refuses any other. */
  baseModel: Model;
  /** Click = one size up, Shift+click = one size down (§7.2). */
  mode: 'up' | 'down';
  valid: boolean;
  /** Why not (status bar, red ghost). Absent when valid or when nothing is hovered. */
  reason?: string;
  partId?: number;
  cellIndex?: number;
  hub?: Cell;
  /** Pitch radius of the gear now (undefined: no gear — a bare hole or a plain wheel, see `wheel`). */
  from?: number;
  /** The plain wheel's radius when the hub is a plain wheel (it becomes a gear). */
  wheel?: number;
  /** Pitch radius after the click (undefined = a bare hole cell). */
  to?: number;
  /** The ghost: the hub cell as the gear at the new size (up, or a plain wheel made a gear); red when !valid. */
  ghost: Cell | null;
  /** Down: the band that would be removed (highlight it). */
  ring: WheelRing | null;
  highlight: Highlight | null;
  /** The meshes the resulting gear would have (gearMeshes on the prospective model); [] when invalid. */
  meshes: MeshPartner[];
  /**
   * "Gear · part 3 · 24 teeth (radius 1.5)", "… · meshes with part 5 (40 teeth, 3:5)",
   * "Gear · part 3 · back to a bare pin hole", "… — reason". '' when nothing is hovered.
   */
  description: string;
  /** Parts the gear's part becomes (1 normally; ≥ 2 when a smaller disc splits off web cells). */
  pieces: number;
  apply(current: Model): Model;
}

function noGear(m: Model, mode: 'up' | 'down'): GearProposal {
  return {
    baseModel: m,
    mode,
    valid: false,
    ghost: null,
    ring: null,
    highlight: null,
    meshes: [],
    description: '',
    pieces: 0,
    apply(): Model {
      throw new Error('no gear here');
    },
  };
}

/**
 * The gear sizes a Gear click tries, in order (§7.2): the first is the step, the rest are the
 * "… would fit" alternatives further on in the same direction. Up: bare → 8, a gear → the next size,
 * a plain wheel of radius R → the largest gear not above R. Down: a gear → the previous size (8 →
 * bare, `undefined`), a plain wheel → one size below the gear "up" would make (radius 2: 16
 * teeth). [] when there is nothing (up from 40 teeth, down from a bare hole).
 */
function gearSteps(cell: Cell, down: boolean): (number | undefined)[] {
  const R = GEAR_RADII;
  if (isGear(cell)) {
    const i = R.indexOf(cell.rim);
    if (!down) return R.slice(i + 1);
    return i === 0 ? [undefined] : R.slice(0, i).reverse();
  }
  if (cell.rim === undefined) return down ? [] : R.slice();
  const below = R.filter((r) => r <= cell.rim!);
  const first = below[below.length - 1]!; // plain wheels have r ≥ 1, so there is one
  return down ? R.filter((r) => r < first).reverse() : [first, ...R.filter((r) => r > first)];
}

/**
 * What a Gear-tool click would do (§7.2): make the hovered hole a gear or step it up one size
 * (bare → 8 → 16 → 24 → 40 teeth), or with `down` (Shift) step it down (8 → bare). On a plain wheel
 * it makes the gear of the largest size not above the wheel's radius (down: one size smaller).
 * Targets as resolveWheel (a gear's virtual cell or teeth: that gear; a bare hole its tip disc
 * reaches: that gear). An invalid step says when a later size would fit ("… · 24 teeth would fit").
 * Each valid click is one setGear.
 */
export function resolveGear(model: Model, pick: CellPick | null, down = false): GearProposal {
  const mode = down ? 'down' : 'up';
  if (!pick) return noGear(model, mode);
  const tg = wheelTarget(model, pick);
  if (!tg) return noGear(model, mode);
  if ('male' in tg) {
    const p = noGear(model, mode);
    p.reason = 'gears grow from pin holes and axle holes';
    p.partId = tg.partId;
    p.description = `Gear · part ${tg.partId} — ${p.reason}`;
    p.highlight = { pos: [tg.male.x, tg.male.y, tg.male.z], dir: pick.dir };
    return p;
  }
  const { partId, cellIndex, cell } = tg;
  const pos: Vec3i = [cell.x, cell.y, cell.z];
  const base = noGear(model, mode);
  base.partId = partId;
  base.cellIndex = cellIndex;
  base.hub = cell;
  base.highlight = { pos: pick.virtual ?? pos, dir: pick.dir };
  const gear = isGear(cell);
  if (gear) base.from = cell.rim;
  else if (cell.rim !== undefined) base.wheel = cell.rim;
  // A hovered crank hole acts on the disc around it (wheelTarget): say which (review m8 ux: on a
  // 40's web hole the hint "largest gear has 40 teeth" read as unrelated to the hole).
  const redirected = !pick.virtual && !pick.tread && pick.partId === partId && pick.cellIndex !== cellIndex;
  const around = redirected
    ? ` (the ${gear ? `${gearTeeth(cell.rim)}-tooth gear` : `wheel of radius ${cell.rim}`} around this hole, hub (${pos.join(', ')}))`
    : '';
  const who = `Gear · part ${partId}${around}`;
  const steps = gearSteps(cell, down);
  if (!steps.length) {
    base.reason = down ? `this ${kindLabel(cell.kind)} has no gear` : `largest gear has ${gearTeeth(GEAR_RADII[GEAR_RADII.length - 1]!)} teeth`;
    base.description = `${who} — ${base.reason}`;
    return base;
  }
  // The click takes the first size that is valid (review m8 ux: on a long beam's middle hole the
  // 8, 16 and 24 cut into the beam but the 40 has it all in its web, and a hint "40 teeth would fit"
  // named a size no click could reach). The skipped sizes and why are in the text.
  const first = canSetGear(model, partId, pos, steps[0]);
  let k = 0;
  if (!first.ok) {
    const later = steps.findIndex((r, i) => i > 0 && r !== undefined && canSetGear(model, partId, pos, r).ok);
    if (later > 0) k = later;
  }
  const to = steps[k];
  if (to !== undefined) base.to = to;
  const fromWheel = !gear && cell.rim !== undefined ? ` · from the wheel of radius ${cell.rim}` : '';
  const head = `${who} · ${to === undefined ? `back to a bare ${kindLabel(cell.kind)}` : gearSize(to)}${fromWheel}`;
  if (to !== undefined && (!down || !gear)) base.ghost = makeCell(cell.x, cell.y, cell.z, cell.kind, cell.axis, to, true);
  if (!first.ok && k === 0) {
    base.reason = down ? first.reason : withGearLayerHint(first.reason);
    base.description = `${head} — ${base.reason}`;
    return base;
  }
  const skipped =
    k > 0
      ? ` · skips ${steps
          .slice(0, k)
          .map((r) => (r === undefined ? 'bare' : String(gearTeeth(r))))
          .join(', ')}: ${(first as { reason: string }).reason}`
      : '';
  const result = setGear(model, partId, pos, to);
  const pieces = result.parts.length - model.parts.length + 1;
  if (down) base.ring = { hub: pos, axis: cell.axis, r0: to !== undefined ? tipRadius(to) : 0.5, r1: gear ? tipRadius(cell.rim) : cell.rim! };
  // The hub's part after a split: the piece that holds the hub cell.
  const hubPart = result.parts.find((q) => q.cells.some((c) => c.x === pos[0] && c.y === pos[1] && c.z === pos[2] && isHole(c.kind)));
  base.meshes = to !== undefined && hubPart ? meshPartners(result, hubPart.id, pos) : [];
  const mesh = meshText(base.meshes);
  const near = to !== undefined && hubPart ? nearMissText(result, hubPart.id, pos) : '';
  base.valid = true;
  base.pieces = pieces;
  base.description = `${head}${skipped}${mesh ? ` · ${mesh}` : ''}${near ? ` · ${near}` : ''}${pieces > 1 ? ` · part ${partId} splits into ${pieces} parts` : ''}`;
  base.apply = (current: Model): Model => {
    if (current !== model) throw new Error(STALE_PROPOSAL);
    return result;
  };
  return base;
}

/**
 * The Gear tool's rule-5 refusal ("(1, 0, 0) would cut into the teeth of this part's gear") names a
 * cell but not the way out: a gear needs a layer of its own part to itself (review m8 ux: a gear on
 * a beam hole is the first thing a new user tries).
 */
export function withGearLayerHint(reason: string): string {
  if (!reason.includes("would cut into the teeth of this part's gear")) return reason;
  return `${reason} · a gear needs a layer to itself: sleeve a hole onto a pin, or extend a hole out of the beam along its axis`;
}

/** "an 8", "a 16". */
function aNum(T: number): string {
  return `${T === 8 ? 'an' : 'a'} ${T}`;
}

/**
 * Gears near the gear at `pos` (part `partId`) that do not mesh with it (§2.7 Meshing), with why:
 * parallel, same layer, pitch circles less than one unit apart (they look as if they engage). '' for
 * none. "does not mesh with part 1 (16 teeth): a 16 meshes only with another 16, in line at
 * distance 2" (review m8 ux: such pairs said nothing and then did not drive each other).
 */
export function nearMissText(m: Model, partId: number, pos: Vec3i): string {
  const gs = gearsOf(m);
  const me = gs.find((g) => g.partId === partId && g.hub[0] === pos[0] && g.hub[1] === pos[1] && g.hub[2] === pos[2]);
  if (!me) return '';
  const meshed = new Set<string>();
  for (const k of gearMeshes(m)) {
    meshed.add(`${k.a.partId}/${k.a.index}|${k.b.partId}/${k.b.index}`);
    meshed.add(`${k.b.partId}/${k.b.index}|${k.a.partId}/${k.a.index}`);
  }
  const out: string[] = [];
  for (const g of gs) {
    if (g === me || g.axis !== me.axis || g.hub[me.axis] !== me.hub[me.axis]) continue;
    if (meshed.has(`${me.partId}/${me.index}|${g.partId}/${g.index}`)) continue;
    const off = [0, 1, 2].filter((i) => i !== me.axis).map((i) => g.hub[i]! - me.hub[i]!);
    const d = Math.hypot(off[0]!, off[1]!);
    const sum = me.r + g.r;
    if (d >= sum + 1) continue;
    const inLine = off[0] === 0 || off[1] === 0;
    let why: string;
    if (g.partId === me.partId) why = 'two gears of one part cannot mesh';
    else if ((me.teeth === 16) !== (g.teeth === 16)) why = `a 16 meshes only with another 16, in line at distance 2`;
    else if (!inLine) why = `gears mesh only in a straight line along the grid (${aNum(me.teeth)} and ${aNum(g.teeth)} at distance ${sum})`;
    else why = `${aNum(me.teeth)} and ${aNum(g.teeth)} mesh at distance ${sum}, not ${d}`;
    out.push(`does not mesh with part ${g.partId} (${g.teeth} teeth): ${why}`);
  }
  return out.join('; ');
}

export interface EraseProposal {
  /** The model this proposal was resolved against; apply() refuses any other. */
  baseModel: Model;
  valid: boolean;
  /** Why the hovered cell cannot be erased (e.g. a pin of another part would be left inside a wheel). */
  reason?: string;
  partId?: number;
  cellIndex?: number;
  cell?: Cell;
  /** The hovered cell (tint red) and face. */
  highlight: Highlight | null;
  /**
   * Erase on a wheel (§7.2): set when the click removes the outer half-unit of a rim instead of a
   * cell (hub hovered, or the disc outside the part's own cells); highlight this band, not the cell.
   */
  ring?: WheelRing;
  /** "Erase pin hole at (1, 0, 0) from part 3", "… · part 3 splits into 2 parts", "Erase part 3 (last cell)", "Erase the wheel's outer half-unit · part 3 · radius 2.5 → 2". */
  description: string;
  /** Number of parts the erased part becomes (0 = part removed, 1 = shrinks, ≥2 = splits). */
  pieces: number;
  /** The model after the erase. `current` must be `baseModel` (else throws STALE_PROPOSAL). */
  apply(current: Model): Model;
}

function noErase(m: Model): EraseProposal {
  return {
    baseModel: m,
    valid: false,
    highlight: null,
    description: '',
    pieces: 0,
    apply(): Model {
      throw new Error('nothing to erase');
    },
  };
}

/**
 * What an Erase click would do (§7.2): remove the picked sub-part; the part splits if it falls
 * apart. On a wheel — its hub, or its disc outside the part's own cells (virtual cell / tread) —
 * it removes the outer half-unit of the rim instead (1 → bare); once the rim is gone the next
 * click erases the cell as usual. A hole cell holding another part's pin inside a remaining wheel
 * of its part cannot be erased (invalid, with the reason).
 */
export function resolveErase(model: Model, pick: CellPick | null): EraseProposal {
  if (!pick) return noErase(model);
  const part = partById(model, pick.partId);
  const cell = part?.cells[pick.cellIndex];
  if (!part || !cell) return noErase(model);
  const pos: Vec3i = [cell.x, cell.y, cell.z];
  if (isGear(cell) && isHole(cell.kind)) {
    // A gear (§7.2): step it down one size, 40 → 24 → 16 → 8 → bare.
    if (pick.virtual && !isVirtualCellOf(part, cell, pick.virtual)) return noErase(model);
    const i = GEAR_RADII.indexOf(cell.rim);
    const to = i > 0 ? GEAR_RADII[i - 1] : undefined;
    const T = gearTeeth(cell.rim);
    let description = `Erase gear teeth · part ${part.id} · ${T} → ${to === undefined ? `bare ${kindLabel(cell.kind)}` : `${gearTeeth(to)} teeth`}`;
    const highlight = { pos: pick.virtual ?? pos, dir: pick.dir };
    const can = canSetGear(model, part.id, pos, to);
    if (!can.ok) {
      const p = noErase(model);
      p.reason = can.reason;
      p.partId = part.id;
      p.cellIndex = pick.cellIndex;
      p.cell = cell;
      p.highlight = highlight;
      p.description = `${description} — ${can.reason}`;
      return p;
    }
    const result = setGear(model, part.id, pos, to);
    const pieces = result.parts.length - model.parts.length + 1;
    if (pieces > 1) description += ` · part ${part.id} splits into ${pieces} parts`;
    return {
      baseModel: model,
      valid: true,
      partId: part.id,
      cellIndex: pick.cellIndex,
      cell,
      highlight,
      // The band the click removes: from the smaller gear's tips to this gear's (review m8 look: a
      // ring from the pitch radius read as "delete this wheel").
      ring: { hub: pos, axis: cell.axis, r0: to !== undefined ? tipRadius(to) : 0.5, r1: tipRadius(cell.rim) },
      description,
      pieces,
      apply(current: Model): Model {
        if (current !== model) throw new Error(STALE_PROPOSAL);
        return result;
      },
    };
  }
  if (pick.virtual || pick.tread || (hasRim(cell) && isHole(cell.kind))) {
    if (!hasRim(cell) || !isValidRim(cell.rim) || (pick.virtual && !isVirtualCellOf(part, cell, pick.virtual))) return noErase(model);
    const from = cell.rim;
    const to = nextRim(from, true);
    const result = setRim(model, part.id, pos, to);
    const pieces = result.parts.length - model.parts.length + 1;
    let description = `Erase the wheel’s outer half-unit · part ${part.id} · radius ${from} → ${to === undefined ? `bare ${kindLabel(cell.kind)}` : to}`;
    if (pieces > 1) description += ` · part ${part.id} splits into ${pieces} parts`;
    return {
      baseModel: model,
      valid: true,
      partId: part.id,
      cellIndex: pick.cellIndex,
      cell,
      highlight: { pos: pick.virtual ?? pos, dir: pick.dir },
      ring: { hub: pos, axis: cell.axis, r0: to ?? 0.5, r1: from },
      description,
      pieces,
      apply(current: Model): Model {
        if (current !== model) throw new Error(STALE_PROPOSAL);
        return result;
      },
    };
  }
  const can = canRemoveCell(model, part.id, pos);
  if (!can.ok) {
    const p = noErase(model);
    p.reason = can.reason;
    p.partId = part.id;
    p.cellIndex = pick.cellIndex;
    p.cell = cell;
    p.highlight = { pos, dir: pick.dir };
    p.description = `Erase ${kindLabel(cell.kind)} at ${fmt(cell)} from part ${part.id} — ${can.reason}`;
    return p;
  }
  const result = removeCell(model, part.id, pos);
  const pieces = part.cells.length === 1 ? 0 : result.parts.length - model.parts.length + 1;
  let description: string;
  if (pieces === 0) description = `Erase part ${part.id} (last cell)`;
  else {
    description = `Erase ${kindLabel(cell.kind)} at ${fmt(cell)} from part ${part.id}`;
    if (pieces > 1) description += ` · part ${part.id} splits into ${pieces} parts`;
  }
  return {
    baseModel: model,
    valid: true,
    partId: part.id,
    cellIndex: pick.cellIndex,
    cell,
    highlight: { pos, dir: pick.dir },
    description,
    pieces,
    apply(current: Model): Model {
      if (current !== model) throw new Error(STALE_PROPOSAL);
      return result;
    },
  };
}

export interface SelectProposal {
  /** Part a click selects; null = the click deselects. */
  partId: number | null;
  description: string;
}

/** What a Select click would do (§7.2): select the hovered part, or deselect on empty space. */
export function resolveSelect(model: Model, pick: CellPick | null): SelectProposal {
  const part = pick ? partById(model, pick.partId) : undefined;
  if (!part) return { partId: null, description: '' };
  const n = part.cells.length;
  return { partId: part.id, description: `Select part ${part.id} · ${n} ${n === 1 ? 'cell' : 'cells'}` };
}

// ---------------------------------------------------------------------------------------------
// Hover info (status bar, §7.4)

/**
 * Status-bar "hover info" for what is under the cursor, independent of the tool:
 *   "Part 3 · pin hole ∥ Z at (1, 0, 0) · holds pin (part 4)"   (a shared cell, hole side)
 *   "Part 4 · pin ∥ Z at (1, 0, 0) · in pin hole (part 3)"      (a shared cell, male side)
 *   "Part 3 · wheel radius 2.5 ∥ Z, hub (0, 0, 0) · at (1, 1, 0)"   (a virtual cell; the size in mm is
 *   in the Wheel tool's hint, so the hover stays short enough for the status bar at 1280 px)
 *   "Grid (2, 0, -1)"                                            (empty space over the grid)
 * '' when nothing is hovered or the pick is stale.
 */
export function describeHover(model: Model, pick: CellPick | null, grid: GridPick | null): string {
  if (pick) {
    const part = partById(model, pick.partId);
    const c = part?.cells[pick.cellIndex];
    if (!part || !c) return '';
    if (isGear(c) && isHole(c.kind)) {
      // §7.4: "Part 3 · gear 24 teeth ∥ Z · meshes with part 5 (40 teeth)" (hub, face or teeth)
      let s = `Part ${part.id} · gear ${gearTeeth(c.rim)} teeth ∥ ${axisLabel(c.axis)}`;
      const mesh = meshText(meshPartners(model, part.id, [c.x, c.y, c.z]), false);
      if (mesh) s += ` · ${mesh}`;
      if (!pick.virtual && !pick.tread) {
        const mate = cellsAt(model, [c.x, c.y, c.z]).find((e) => e.partId !== part.id);
        if (mate) s += ` · holds ${kindLabel(mate.cell.kind)} (part ${mate.partId})`;
      }
      return s;
    }
    if ((pick.virtual || pick.tread) && hasRim(c)) {
      const wheel = `wheel radius ${c.rim} ∥ ${axisLabel(c.axis)}, hub ${fmt(c)}`;
      return pick.virtual ? `Part ${part.id} · ${wheel} · at ${fmt(pick.virtual)}` : `Part ${part.id} · ${wheel} · tread`;
    }
    let s = `Part ${part.id} · ${kindLabel(c.kind)} ∥ ${axisLabel(c.axis)} at ${fmt(c)}`;
    if (hasRim(c)) s += ` · wheel radius ${c.rim}`;
    const mate = cellsAt(model, [c.x, c.y, c.z]).find((e) => e.partId !== part.id);
    if (mate) s += ` · ${isHole(c.kind) ? 'holds' : 'in'} ${kindLabel(mate.cell.kind)} (part ${mate.partId})`;
    return s;
  }
  if (grid) return `Grid ${fmt([grid.pos[0], 0, grid.pos[2]])}`;
  return '';
}
