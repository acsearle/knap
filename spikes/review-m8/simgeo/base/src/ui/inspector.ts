// Inspector for the selected part (§7.2): id, cell count, kinds, colour swatches, Set as fixed
// root, Rotate (also [ / ]), Duplicate, Delete, and the move / rotate keys.
import { kindLabel } from '../core';
import type { Kind } from '../core';
import { wheelSize } from '../editor';
import type { PartInfo } from '../editor';
import { button, h, setText } from './dom';
import { PALETTE } from './palette';

export interface InspectorHandlers {
  setColor(color: string): void;
  setRoot(): void;
  duplicate(): void;
  remove(): void;
  /** Rotate 90° about the view axis: '[' counter-clockwise, ']' clockwise (same as the keys). */
  rotate(key: '[' | ']'): void;
}

const KIND_ORDER: readonly Kind[] = ['pinHole', 'axleHole', 'axle', 'pin', 'frictionPin'];

function plural(n: number, kind: Kind): string {
  const l = kindLabel(kind);
  if (n === 1) return `1 ${l}`;
  return `${n} ${l}s`;
}

export class Inspector {
  readonly el: HTMLElement;
  private readonly title: HTMLElement;
  private readonly badge: HTMLElement;
  private readonly sub: HTMLElement;
  private readonly wheels: HTMLElement;
  private readonly body: HTMLElement;
  private readonly swatches: HTMLButtonElement[] = [];
  private readonly rootBtn: HTMLButtonElement;
  private readonly dupBtn: HTMLButtonElement;
  private readonly delBtn: HTMLButtonElement;
  private readonly rotBtns: HTMLButtonElement[];

  constructor(on: InspectorHandlers) {
    this.title = h('span');
    this.badge = h('span', { class: 'badge', hidden: true, title: 'This part is fixed in space during simulation' }, 'fixed root');
    this.sub = h('div', { class: 'sub', 'data-role': 'inspector-sub' });
    this.wheels = h('div', { class: 'wheels', hidden: true, 'data-role': 'inspector-wheels' });
    const pal = h('div', { class: 'palette', role: 'group', 'aria-label': 'Part colour' });
    for (const s of PALETTE) {
      const b = h('button', {
        type: 'button',
        class: 'swatch',
        title: s.name,
        'aria-label': `Colour ${s.name}`,
        'data-color': s.color,
        style: `background:${s.color}`,
        onclick: () => on.setColor(s.color),
      });
      this.swatches.push(b);
      pal.append(b);
    }
    this.rootBtn = button('Set as fixed root', { class: 'btn', 'data-action': 'set-root', title: 'Fix this part in space during simulation', onclick: () => on.setRoot() });
    this.dupBtn = button('Duplicate', { class: 'btn', 'data-action': 'duplicate', title: 'Copy the part to the nearest free spot (D)', onclick: () => on.duplicate() });
    this.delBtn = button('Delete', { class: 'btn danger', 'data-action': 'delete', title: 'Delete the part (Delete / Backspace)', onclick: () => on.remove() });
    // Buttons as well as keys: on some keyboard layouts [ and ] need Option / AltGr.
    this.rotBtns = [
      button('↺ Rotate', { class: 'btn', 'data-action': 'rotate-ccw', title: 'Rotate 90° counter-clockwise about the view axis ([)', onclick: () => on.rotate('[') }),
      button('↻ Rotate', { class: 'btn', 'data-action': 'rotate-cw', title: 'Rotate 90° clockwise about the view axis (])', onclick: () => on.rotate(']') }),
    ];
    const hint = h('div', { class: 'hint' });
    hint.innerHTML =
      'Move <kbd>←</kbd><kbd>→</kbd><kbd>↑</kbd><kbd>↓</kbd> <kbd>PgUp</kbd><kbd>PgDn</kbd><br>Rotate 90° <kbd>[</kbd> <kbd>]</kbd> · Fit <kbd>F</kbd>';
    this.body = h('div', null, h('div', { class: 'label' }, 'Colour'), pal, h('div', { class: 'actions' }, this.rootBtn, h('div', { class: 'row' }, ...this.rotBtns), this.dupBtn, this.delBtn), hint);
    this.el = h(
      'aside',
      { class: 'inspector', hidden: true, 'aria-label': 'Selected part', 'data-role': 'inspector' },
      h('h2', null, this.title, this.badge),
      this.sub,
      this.wheels,
      this.body,
    );
  }

  /**
   * `rootFixed`: the model's root is fixed in space (core rootIsFixed). With a free root (ground on,
   * Fix root off) nothing is fixed, so no part is called the fixed root, and Set as fixed root turns
   * Fix root back on with this part as the root.
   */
  update(info: PartInfo | null, disabled: boolean, rootFixed = true): void {
    this.el.hidden = !info;
    if (!info) return;
    setText(this.title, `Part ${info.id}`);
    const fixedRoot = info.isRoot && rootFixed;
    this.badge.hidden = !fixedRoot;
    const kinds = KIND_ORDER.filter((k) => info.kinds[k]).map((k) => plural(info.kinds[k]!, k));
    setText(this.sub, `${info.cellCount} ${info.cellCount === 1 ? 'cell' : 'cells'} · ${kinds.join(', ')}`);
    const w = info.wheels ?? [];
    this.wheels.hidden = w.length === 0;
    setText(this.wheels, w.length === 1 ? `Wheel ${wheelSize(w[0]!)}` : w.length ? `Wheels: radius ${w.join(', ')}` : '');
    for (const b of this.swatches) {
      b.classList.toggle('on', b.dataset.color === info.color.toLowerCase());
      b.disabled = disabled;
    }
    this.rootBtn.disabled = disabled || fixedRoot;
    this.rootBtn.textContent = fixedRoot ? 'Fixed root' : 'Set as fixed root';
    this.rootBtn.title = rootFixed
      ? 'Fix this part in space during simulation'
      : 'Nothing is fixed (Fix root is off): fix this part in space during simulation and turn Fix root on';
    this.dupBtn.disabled = disabled;
    this.delBtn.disabled = disabled;
    for (const b of this.rotBtns) b.disabled = disabled;
  }
}
