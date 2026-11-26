// Left toolbar (§7.2): Select, the five build tools, Wheel, Gear, Erase, plus the "New part" toggle [N], the
// "Back side" toggle [B] (§7.3) and the orientation cycler [R]. Shortcuts are shown on the buttons.
import { isBuildTool } from '../editor';
import type { Tool } from '../editor';
import { button, h, icon } from './dom';
import { ICONS } from './icons';

export interface ToolbarHandlers {
  selectTool(t: Tool): void;
  toggleNewPart(): void;
  toggleBackSide(): void;
  cycleOrientation(): void;
}

export interface ToolbarState {
  tool: Tool;
  newPart: boolean;
  backSide: boolean;
  disabled: boolean;
  /** "[R] 2/3" or '' — enables the orientation button when there is a choice. */
  orientationHint: string;
}

interface ToolDef {
  tool: Tool;
  label: string;
  key: string;
  icon: string;
  /** Extra tooltip text after "Label (key)". */
  tip?: string;
}

/** Toolbar order, labels and shortcuts: the one list of tools in the UI (keys: editor TOOL_KEYS). */
export const TOOL_DEFS: readonly ToolDef[] = [
  { tool: 'select', label: 'Select', key: 'V', icon: ICONS.select },
  { tool: 'pinHole', label: 'Pin hole', key: '1', icon: ICONS.pinHole },
  { tool: 'axleHole', label: 'Axle hole', key: '2', icon: ICONS.axleHole },
  { tool: 'axle', label: 'Axle', key: '3', icon: ICONS.axle },
  { tool: 'pin', label: 'Pin', key: '4', icon: ICONS.pin },
  { tool: 'frictionPin', label: 'Friction pin', key: '5', icon: ICONS.frictionPin },
  { tool: 'wheel', label: 'Wheel', key: 'W', icon: ICONS.wheel, tip: 'click a pin hole, axle hole or wheel to grow it by half a unit; Shift+click shrinks it' },
  { tool: 'gear', label: 'Gear', key: 'T', icon: ICONS.gear, tip: 'click a pin hole, axle hole or gear to make a gear or step it up (8, 16, 24, 40 teeth); Shift+click steps down' },
  { tool: 'erase', label: 'Erase', key: 'E', icon: ICONS.erase },
];

export class Toolbar {
  readonly el: HTMLElement;
  private readonly buttons = new Map<Tool, HTMLButtonElement>();
  private readonly newPartBtn: HTMLButtonElement;
  private readonly backSideBtn: HTMLButtonElement;
  private readonly rotateBtn: HTMLButtonElement;

  constructor(on: ToolbarHandlers) {
    this.el = h('nav', { class: 'toolbar', 'aria-label': 'Tools' });
    for (const d of TOOL_DEFS) {
      const b = button([icon(d.icon), h('span', { class: 'key' }, d.key)], {
        class: 'tool',
        title: `${d.label} (${d.key}${d.tool === 'select' ? ' / Esc' : ''})${d.tip ? ` — ${d.tip}` : ''}`,
        'aria-label': d.label,
        'data-tool': d.tool,
        onclick: () => on.selectTool(d.tool),
      });
      this.buttons.set(d.tool, b);
      this.el.append(b);
      if (d.tool === 'select' || d.tool === 'gear') this.el.append(h('span', { class: 'sep' }));
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
    this.backSideBtn = button([icon(ICONS.backSide), h('span', { class: 'key' }, 'B')], {
      class: 'tool small',
      title: 'Back side (B) — build on the back face under the cursor: the face the pointer would hit if you could see through the front of the parts. Hold Alt / Option for one click.',
      'aria-label': 'Back side',
      'aria-pressed': 'false',
      'data-action': 'back-side',
      onclick: () => on.toggleBackSide(),
    });
    this.rotateBtn = button([icon(ICONS.rotate), h('span', { class: 'key' }, 'R')], {
      class: 'tool small',
      title: 'Next orientation of the ghost (R)',
      'aria-label': 'Next orientation',
      'data-action': 'orientation',
      onclick: () => on.cycleOrientation(),
    });
    this.el.append(this.newPartBtn, this.backSideBtn, this.rotateBtn);
  }

  update(s: ToolbarState): void {
    for (const [tool, b] of this.buttons) {
      const on = tool === s.tool;
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', String(on));
      b.disabled = s.disabled;
    }
    const build = isBuildTool(s.tool);
    this.newPartBtn.disabled = s.disabled || !build;
    this.newPartBtn.classList.toggle('on', s.newPart && build);
    this.newPartBtn.setAttribute('aria-pressed', String(s.newPart));
    this.backSideBtn.disabled = s.disabled || !build;
    this.backSideBtn.classList.toggle('on', s.backSide && build);
    this.backSideBtn.setAttribute('aria-pressed', String(s.backSide));
    this.rotateBtn.disabled = s.disabled || !build || !s.orientationHint;
    this.rotateBtn.title = `Next orientation of the ghost (R)${s.orientationHint ? ` — ${s.orientationHint.replace('[R] ', '')}` : ''}`;
  }
}
