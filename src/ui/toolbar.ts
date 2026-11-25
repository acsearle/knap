// Left toolbar (§7.2): Select, the five build tools, Erase, plus the "New part" toggle [N] and
// the orientation cycler [R]. Shortcuts are shown on the buttons.
import type { Tool } from '../editor';
import { button, h, icon } from './dom';
import { ICONS } from './icons';

export interface ToolbarHandlers {
  selectTool(t: Tool): void;
  toggleNewPart(): void;
  cycleOrientation(): void;
}

export interface ToolbarState {
  tool: Tool;
  newPart: boolean;
  disabled: boolean;
  /** "[R] 2/3" or '' — enables the orientation button when there is a choice. */
  orientationHint: string;
}

interface ToolDef {
  tool: Tool;
  label: string;
  key: string;
  icon: string;
}

/** Toolbar order, labels and shortcuts: the one list of tools in the UI (keys: editor TOOL_KEYS). */
export const TOOL_DEFS: readonly ToolDef[] = [
  { tool: 'select', label: 'Select', key: 'V', icon: ICONS.select },
  { tool: 'pinHole', label: 'Pin hole', key: '1', icon: ICONS.pinHole },
  { tool: 'axleHole', label: 'Axle hole', key: '2', icon: ICONS.axleHole },
  { tool: 'axle', label: 'Axle', key: '3', icon: ICONS.axle },
  { tool: 'pin', label: 'Pin', key: '4', icon: ICONS.pin },
  { tool: 'frictionPin', label: 'Friction pin', key: '5', icon: ICONS.frictionPin },
  { tool: 'erase', label: 'Erase', key: 'E', icon: ICONS.erase },
];

export class Toolbar {
  readonly el: HTMLElement;
  private readonly buttons = new Map<Tool, HTMLButtonElement>();
  private readonly newPartBtn: HTMLButtonElement;
  private readonly rotateBtn: HTMLButtonElement;

  constructor(on: ToolbarHandlers) {
    this.el = h('nav', { class: 'toolbar', 'aria-label': 'Tools' });
    for (const d of TOOL_DEFS) {
      const b = button([icon(d.icon), h('span', { class: 'key' }, d.key)], {
        class: 'tool',
        title: `${d.label} (${d.key}${d.tool === 'select' ? ' / Esc' : ''})`,
        'aria-label': d.label,
        'data-tool': d.tool,
        onclick: () => on.selectTool(d.tool),
      });
      this.buttons.set(d.tool, b);
      this.el.append(b);
      if (d.tool === 'select' || d.tool === 'frictionPin') this.el.append(h('span', { class: 'sep' }));
    }
    this.el.append(h('span', { class: 'sep' }));
    this.newPartBtn = button([icon(ICONS.newPart), h('span', { class: 'key' }, 'N')], {
      class: 'tool small',
      title: 'New part (N) — new sub-parts start a separate part instead of extending the clicked one. Hold Shift for one click.',
      'aria-label': 'New part',
      'aria-pressed': 'false',
      'data-action': 'new-part',
      onclick: () => on.toggleNewPart(),
    });
    this.rotateBtn = button([icon(ICONS.rotate), h('span', { class: 'key' }, 'R')], {
      class: 'tool small',
      title: 'Next orientation of the ghost (R)',
      'aria-label': 'Next orientation',
      'data-action': 'orientation',
      onclick: () => on.cycleOrientation(),
    });
    this.el.append(this.newPartBtn, this.rotateBtn);
  }

  update(s: ToolbarState): void {
    for (const [tool, b] of this.buttons) {
      const on = tool === s.tool;
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', String(on));
      b.disabled = s.disabled;
    }
    const build = s.tool !== 'select' && s.tool !== 'erase';
    this.newPartBtn.disabled = s.disabled || !build;
    this.newPartBtn.classList.toggle('on', s.newPart && build);
    this.newPartBtn.setAttribute('aria-pressed', String(s.newPart));
    this.rotateBtn.disabled = s.disabled || !build || !s.orientationHint;
    this.rotateBtn.title = `Next orientation of the ghost (R)${s.orientationHint ? ` — ${s.orientationHint.replace('[R] ', '')}` : ''}`;
  }
}
