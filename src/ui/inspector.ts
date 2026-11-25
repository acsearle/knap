// Inspector for the selected part (§7.2): id, cell count, kinds, colour swatches, Set as fixed
// root, Duplicate, Delete, and the move / rotate keys.
import { kindLabel } from '../core';
import type { Kind } from '../core';
import type { PartInfo } from '../editor';
import { button, h, setText } from './dom';
import { PALETTE } from './palette';

export interface InspectorHandlers {
  setColor(color: string): void;
  setRoot(): void;
  duplicate(): void;
  remove(): void;
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
  private readonly body: HTMLElement;
  private readonly swatches: HTMLButtonElement[] = [];
  private readonly rootBtn: HTMLButtonElement;
  private readonly dupBtn: HTMLButtonElement;
  private readonly delBtn: HTMLButtonElement;

  constructor(on: InspectorHandlers) {
    this.title = h('span');
    this.badge = h('span', { class: 'badge', hidden: true, title: 'This part is fixed in space during simulation' }, 'fixed root');
    this.sub = h('div', { class: 'sub', 'data-role': 'inspector-sub' });
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
    const hint = h('div', { class: 'hint' });
    hint.innerHTML =
      'Move <kbd>←</kbd><kbd>→</kbd><kbd>↑</kbd><kbd>↓</kbd> <kbd>PgUp</kbd><kbd>PgDn</kbd><br>Rotate 90° <kbd>[</kbd> <kbd>]</kbd> · Fit <kbd>F</kbd>';
    this.body = h('div', null, h('div', { class: 'label' }, 'Colour'), pal, h('div', { class: 'actions' }, this.rootBtn, this.dupBtn, this.delBtn), hint);
    this.el = h(
      'aside',
      { class: 'inspector', hidden: true, 'aria-label': 'Selected part', 'data-role': 'inspector' },
      h('h2', null, this.title, this.badge),
      this.sub,
      this.body,
    );
  }

  update(info: PartInfo | null, disabled: boolean): void {
    this.el.hidden = !info;
    if (!info) return;
    setText(this.title, `Part ${info.id}`);
    this.badge.hidden = !info.isRoot;
    const kinds = KIND_ORDER.filter((k) => info.kinds[k]).map((k) => plural(info.kinds[k]!, k));
    setText(this.sub, `${info.cellCount} ${info.cellCount === 1 ? 'cell' : 'cells'} · ${kinds.join(', ')}`);
    for (const b of this.swatches) {
      b.classList.toggle('on', b.dataset.color === info.color.toLowerCase());
      b.disabled = disabled;
    }
    this.rootBtn.disabled = disabled || info.isRoot;
    this.rootBtn.textContent = info.isRoot ? 'Fixed root' : 'Set as fixed root';
    this.dupBtn.disabled = disabled;
    this.delBtn.disabled = disabled;
  }
}
