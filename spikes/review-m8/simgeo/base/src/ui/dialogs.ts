// Modal dialogs (controls "?" and About) and the message banner over the viewport. A dialog keeps
// Tab focus inside itself while open; closing leaves focus on the page body.
import { button, h, icon } from './dom';
import { ICONS } from './icons';

const MAC = /Mac|iPhone|iPad/.test(navigator.platform);
const MOD = MAC ? '⌘' : 'Ctrl+';

/** Disclaimer text (README + About are the only places those names may appear). */
export const DISCLAIMER =
  'knap is an independent project. It is not affiliated with, endorsed by, or an official product of the LEGO Group. ' +
  '“LEGO” and “Technic” are trademarks of the LEGO Group.';

function rows(list: readonly (readonly [string, string])[]): HTMLTableElement {
  const t = h('table');
  for (const [k, v] of list) {
    const td = h('td');
    td.innerHTML = k; // static, trusted markup (<kbd>)
    t.append(h('tr', null, td, h('td', null, v)));
  }
  return t;
}

const k = (...keys: string[]): string => keys.map((x) => `<kbd>${x}</kbd>`).join(' ');

export class Dialog {
  readonly overlay: HTMLElement;
  private readonly box: HTMLElement;
  private onClose: (() => void) | null = null;

  constructor(role: string, title: string, content: HTMLElement) {
    const closeBtn = button(icon(ICONS.close), { class: 'btn icon-only close', 'aria-label': 'Close', onclick: () => this.close() });
    this.box = h('div', { class: 'dialog', role: 'dialog', 'aria-modal': 'true', 'aria-label': title, 'data-role': role }, closeBtn, h('h2', null, title), content);
    this.overlay = h('div', { class: 'overlay', hidden: true });
    this.overlay.append(this.box);
    this.overlay.addEventListener('pointerdown', (e) => {
      if (e.target === this.overlay) this.close();
    });
    // aria-modal: Tab / Shift+Tab cycle within the dialog (a window listener, so it also catches
    // a Tab pressed while focus has drifted outside, e.g. onto the page body).
    window.addEventListener('keydown', (e) => {
      if (e.key !== 'Tab' || this.overlay.hidden || e.defaultPrevented) return;
      const items = Array.from(this.box.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')).filter(
        (el) => !(el as HTMLButtonElement).disabled,
      );
      if (!items.length) return;
      const i = items.indexOf(document.activeElement as HTMLElement);
      const next = e.shiftKey ? (i <= 0 ? items.length - 1 : i - 1) : i < 0 || i === items.length - 1 ? 0 : i + 1;
      e.preventDefault();
      items[next]!.focus({ preventScroll: true });
    });
  }

  get isOpen(): boolean {
    return !this.overlay.hidden;
  }

  open(onClose?: () => void): void {
    this.overlay.hidden = false;
    this.onClose = onClose ?? null;
    (this.box.querySelector('button') as HTMLButtonElement | null)?.focus({ preventScroll: true });
  }

  close(): void {
    if (this.overlay.hidden) return;
    this.overlay.hidden = true;
    // Focus goes back to the page body (not to the button that opened it: Space would reopen it).
    if (this.box.contains(document.activeElement)) (document.activeElement as HTMLElement).blur();
    const cb = this.onClose;
    this.onClose = null;
    cb?.();
  }

  toggle(): void {
    if (this.isOpen) this.close();
    else this.open();
  }
}

export function helpDialog(): Dialog {
  const content = h(
    'div',
    null,
    h(
      'div',
      { class: 'cols' },
      h(
        'div',
        null,
        h('h3', null, 'Camera'),
        rows([
          ['Left-drag', 'Orbit (a press that moves < 4 px is a click)'],
          ['Right- / middle-drag, ' + k('Shift') + '+drag', 'Pan'],
          ['Wheel / pinch', 'Zoom toward the cursor'],
          ['View cube', 'Click a face, edge or corner to snap the view'],
          [k('F'), 'Fit the selection, else everything'],
          [k('Home'), 'Default isometric view, fitted'],
        ]),
        h('h3', null, 'Tools'),
        rows([
          [k('V') + ' / ' + k('Esc'), 'Select'],
          [k('1') + '–' + k('5'), 'Pin hole, axle hole, axle, pin, friction pin'],
          [k('W'), 'Wheel: click a pin / axle hole or a wheel to grow it by ½ unit (radius 1 to 4); Shift+click shrinks it'],
          [k('E'), 'Erase a sub-part (the part splits if it falls apart); on a wheel, its outer ½ unit'],
          [k('R'), 'Next orientation of the ghost'],
          [k('N'), 'Toggle “New part”: start a separate part'],
          ['Hold ' + k('Shift'), '“New part” for one click: insert / sleeve / new adjacent part'],
          [k('B'), 'Toggle “Back side”: build on the back face under the cursor, seen through the part'],
          ['Hold ' + k('Alt') + ' / ' + k('⌥'), '“Back side” for one click'],
          ['Click on the grid', 'Start a new part (holes ∥ Z)'],
          ['Pin on a hole’s mouth', 'Insert, through stacked holes'],
          ['Hole on a pin’s end', 'Sleeve a beam on (R: extend)'],
          ['Hole on a wheel’s face', 'A crank hole in the wheel (then a pin goes in)'],
        ]),
      ),
      h(
        'div',
        null,
        h('h3', null, 'Selected part'),
        rows([
          [k('←', '→', '↑', '↓'), 'Move one cell along the screen-aligned axes'],
          [k('PgUp') + ' ' + k('PgDn'), 'Move toward / away from you'],
          [k('[') + ' ' + k(']'), 'Rotate 90° about the view axis'],
          [k('D'), 'Duplicate'],
          [k('Delete') + ' / ' + k('⌫'), 'Delete'],
        ]),
        h('h3', null, 'Edit'),
        rows([
          [k(`${MOD}Z`), 'Undo'],
          [MAC ? k('⇧⌘Z') : k('Ctrl+Y') + ' / ' + k('Ctrl+Shift+Z'), 'Redo'],
          [k(`${MOD}S`), 'Save (download .knap.json)'],
          [k(`${MOD}O`), 'Open a .knap.json file'],
          [k('K'), 'Show kinematics (bodies and joints)'],
          [k('G'), 'Ground: a floor under the model, shown by a soft shadow (Model panel; with it, “Fix root” off makes a free vehicle)'],
        ]),
        h('h3', null, 'Simulate'),
        rows([
          [k('Space'), 'Play; while simulating: pause / resume'],
          [k('.'), 'Step 1/60 s (starts paused if editing)'],
          [k('Esc'), 'Stop: back to the model as edited'],
          ['Friction Off / Low / Real', 'Joint friction: how quickly pins and axles lose motion; Real = Realistic, the default (remembered)'],
          ['Drag a moving part', 'Pull it with a spring'],
          ['Drag a vehicle', 'It rolls on the ground only (not along beams); drag in the FRONT view to roll it straight; F brings it back into view'],
          ['Drag elsewhere', 'Orbit as usual'],
        ]),
      ),
    ),
    h('p', { class: 'muted' }, 'Shortcuts are ignored while typing in a text field.'),
  );
  return new Dialog('help', 'Controls', content);
}

export function aboutDialog(): Dialog {
  const content = h(
    'div',
    null,
    h('p', null, 'knap is a 3D editor and rigid-body simulator for a construction system of beams, pins and axles on a one-stud grid. Parts are welded, pinned or slid together; the kinematic analysis turns them into rigid bodies and joints, and the physics engine simulates them at real scale under gravity.'),
    h('p', { class: 'muted' }, 'Rendering: three.js · Physics: Rapier · Solid modelling: manifold-3d. Runs entirely in the browser; your model is saved in this browser automatically.'),
    h('p', { class: 'disclaimer', 'data-role': 'disclaimer' }, DISCLAIMER),
  );
  return new Dialog('about', 'About knap', content);
}

/** A dismissable message over the viewport (errors, lost graphics context). */
export class Banner {
  readonly el: HTMLElement;
  private readonly msg: HTMLElement;
  private timer = 0;

  constructor() {
    this.msg = h('div', { class: 'msg', 'data-role': 'banner-text' });
    const close = button(icon(ICONS.close), { class: 'btn icon-only', 'aria-label': 'Dismiss', onclick: () => this.hide() });
    this.el = h('div', { class: 'banner', role: 'alert', hidden: true, 'data-role': 'banner' }, this.msg, close);
  }

  show(text: string, opts: { kind?: 'error' | 'info'; timeoutMs?: number } = {}): void {
    this.msg.textContent = text;
    this.el.classList.toggle('info', opts.kind === 'info');
    this.el.hidden = false;
    window.clearTimeout(this.timer);
    if (opts.timeoutMs) this.timer = window.setTimeout(() => this.hide(), opts.timeoutMs);
  }

  hide(): void {
    window.clearTimeout(this.timer);
    this.el.hidden = true;
  }

  /** What is shown now (null when hidden), to put back later with restore(). */
  snapshot(): { text: string; kind: 'error' | 'info' } | null {
    if (this.el.hidden) return null;
    return { text: this.msg.textContent ?? '', kind: this.el.classList.contains('info') ? 'info' : 'error' };
  }

  /** Show a snapshot() again (null hides the banner). */
  restore(s: { text: string; kind: 'error' | 'info' } | null): void {
    if (s) this.show(s.text, { kind: s.kind });
    else this.hide();
  }

  get visible(): boolean {
    return !this.el.hidden;
  }

  get text(): string {
    return this.el.hidden ? '' : (this.msg.textContent ?? '');
  }
}
