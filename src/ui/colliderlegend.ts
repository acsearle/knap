// Legend of the "Show colliders" view (DESIGN §7.4): shown only while the toggle is on, in the side
// panel under the Model block and the inspector. One line per kind of collider present in the shown model — colour
// swatch, name, what it hits in plain words, how many — then the floor when the ground is on, and a
// note that joined parts never hit each other (the view draws them overlapping).
//
// What hits what is the simulation's collision groups (physics/sim.ts GROUP, DESIGN §5.1 "Wheels"
// and "Gears"), worded for what the model actually holds: a gear's disc never meets another gear's,
// so gear discs get their own line; there is no "floor" without a ground; and two bodies that share
// a joint (or parts welded into one body) never collide at all (§5.1 "Contacts between two bodies
// that share a joint are disabled"). Counts leave out hidden parts (a body removed while
// simulating), so they match what the simulation still has.
import { COLLIDER_ROLES, COLLIDER_STYLE } from '../view/colliders';
import type { ColliderRole } from '../physics/shapes';
import { h, setText } from './dom';

export interface LegendRow {
  /** 'part' | 'hull' | 'round' (wheel discs) | 'gearRound' (gear discs) | 'guard' | 'floor' | 'joined' | 'none' */
  role: string;
  /** Swatch colours (the role's edge and fill colours); null for rows without a swatch. */
  color: string | null;
  fill: string | null;
  label: string;
  meets: string;
  /** Colliders of the row in the model; null for the floor and the notes. */
  count: number | null;
}

/** What the legend needs per part (Viewport.colliderInfo().parts). */
export interface LegendPart {
  counts: Readonly<Record<ColliderRole, number>>;
  /** Of `counts`, the gear colliders (absent = none). */
  gear?: { readonly round: number; readonly hull: number };
  /** Drawn (false: hidden, e.g. its body was removed while simulating). Absent = visible. */
  visible?: boolean;
}

/** "a", "a and b", "a, b and c". */
function list(xs: readonly string[]): string {
  return xs.length <= 1 ? (xs[0] ?? '') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`;
}

/**
 * The legend's rows (pure): every kind of collider present in the visible parts, in legend order
 * (part shapes, wheel / gear pieces, wheel discs, gear discs, guards), with its total; then the
 * floor when `ground`; then, when `joined` (the model has a joint or a body of several welded
 * parts), the joined-parts note. With nothing drawn, one 'none' row.
 */
export function colliderLegendRows(parts: readonly LegendPart[], ground: boolean, joined = true): LegendRow[] {
  const total: Record<ColliderRole, number> = { part: 0, hull: 0, round: 0, guard: 0 };
  let gearRound = 0;
  let gearHull = 0;
  for (const p of parts) {
    if (p.visible === false) continue;
    for (const r of COLLIDER_ROLES) total[r] += p.counts[r];
    gearRound += p.gear?.round ?? 0;
    gearHull += p.gear?.hull ?? 0;
  }
  const wheelRound = total.round - gearRound;
  const wheels = total.hull - gearHull > 0 || wheelRound > 0;
  const gears = gearHull > 0 || gearRound > 0;
  const pieces = wheels && gears ? 'wheel and gear pieces' : gears ? 'gear pieces' : 'wheel pieces';
  const floor = ground ? ['the floor'] : [];
  const swatch = (r: ColliderRole) => ({ color: COLLIDER_STYLE[r].line, fill: COLLIDER_STYLE[r].fill });
  const rows: LegendRow[] = [];
  if (total.part > 0) {
    const hits = ['other parts', ...(total.hull > 0 ? [pieces] : []), ...floor];
    rows.push({ role: 'part', ...swatch('part'), label: 'Part shapes', meets: `hit ${list(hits)}`, count: total.part });
  }
  if (total.hull > 0) rows.push({ role: 'hull', ...swatch('hull'), label: pieces[0]!.toUpperCase() + pieces.slice(1), meets: 'hit part shapes only', count: total.hull });
  if (wheelRound > 0) {
    const hits = [...floor, 'other wheel discs', ...(gearRound > 0 ? ['gear discs'] : [])];
    rows.push({ role: 'round', ...swatch('round'), label: 'Wheel discs', meets: `hit ${list(hits)}`, count: wheelRound });
  }
  if (gearRound > 0) {
    const hits = [...floor, ...(wheelRound > 0 ? ['wheel discs'] : [])];
    rows.push({ role: 'gearRound', ...swatch('round'), label: 'Gear discs', meets: hits.length ? `hit ${list(hits)}, never another gear's disc` : "never hit another gear's disc", count: gearRound });
  }
  if (total.guard > 0) rows.push({ role: 'guard', ...swatch('guard'), label: 'Ground guards', meets: 'hit the floor only', count: total.guard });
  if (rows.length === 0) {
    rows.push({ role: 'none', color: null, fill: null, label: 'None', meets: 'no parts to collide', count: null });
    return rows;
  }
  if (ground) {
    const by = [...(total.part > 0 ? ['part shapes'] : []), ...(total.round > 0 ? ['discs'] : []), ...(total.guard > 0 ? ['guards'] : [])];
    rows.push({ role: 'floor', color: null, fill: null, label: 'Floor', meets: `hit by ${list(by)}`, count: null });
  }
  if (joined) rows.push({ role: 'joined', color: null, fill: null, label: 'Joined parts', meets: 'never hit each other (welded, or linked by a pin or axle)', count: null });
  return rows;
}

export class ColliderLegend {
  readonly el: HTMLElement;
  private readonly list: HTMLElement;
  private key = '';

  constructor() {
    this.list = h('ul', { class: 'cl-list' });
    this.el = h(
      'section',
      { class: 'collider-legend', 'aria-label': 'Colliders', 'data-role': 'collider-legend', hidden: true },
      h('h2', null, 'Colliders'),
      this.list,
    );
  }

  /** Show `rows` (visible = true) or hide the legend. Touches the DOM only on change. */
  update(visible: boolean, rows: readonly LegendRow[]): void {
    this.el.hidden = !visible;
    if (!visible) return;
    const key = JSON.stringify(rows);
    if (key === this.key) return;
    this.key = key;
    this.list.replaceChildren(
      ...rows.map((r) => {
        const note = r.role === 'joined' || r.role === 'none';
        const sw = h('span', { class: `cl-swatch${r.color ? '' : note ? ' note' : ' floor'}`, 'aria-hidden': 'true' });
        if (r.color) sw.style.borderColor = r.color;
        if (r.fill) sw.style.background = r.fill;
        const count = h('span', { class: 'cl-count' });
        setText(count, r.count === null ? '' : String(r.count));
        return h(
          'li',
          { 'data-legend-role': r.role, class: note ? 'cl-note' : '' },
          sw,
          h('span', { class: 'cl-text' }, h('span', { class: 'cl-head' }, h('span', { class: 'cl-label' }, r.label), count), h('span', { class: 'cl-meets' }, r.meets)),
        );
      }),
    );
  }
}
