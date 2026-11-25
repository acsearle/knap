// Top bar: app name, File (New / Open… / Save / Examples ▾), Undo / Redo, colour palette,
// Show kinematics, simulate controls (Play/Stop, Pause, Step, speed, joint friction), help and
// about. The simulated-time readout and the "can't keep up" pill are built here but placed by the
// host over the viewport (next to the SIMULATING badge), so the top bar never changes width.
import type { FrictionLevel } from '../physics';
import { button, h, icon, setText } from './dom';
import { ICONS } from './icons';
import { PALETTE } from './palette';

export interface ExampleEntry {
  name: string;
  title: string;
  description: string;
}

export interface TopBarHandlers {
  newModel(): void;
  open(): void;
  save(): void;
  loadExample(name: string): void;
  undo(): void;
  redo(): void;
  pickColor(color: string): void;
  setShowKinematics(on: boolean): void;
  playStop(): void;
  togglePause(): void;
  step(): void;
  setSpeed(speed: number): void;
  setFriction(level: FrictionLevel): void;
  help(): void;
  about(): void;
}

export type Mode = 'edit' | 'starting' | 'simulate';

export interface TopBarState {
  mode: Mode;
  paused: boolean;
  canUndo: boolean;
  canRedo: boolean;
  color: string;
  showKinematics: boolean;
  speed: number;
  friction: FrictionLevel;
}

export const SPEEDS: readonly { value: number; label: string }[] = [
  { value: 1, label: '1×' },
  { value: 0.5, label: '½×' },
  { value: 0.25, label: '¼×' },
  { value: 0.1, label: '⅒×' },
];

/** The joint-friction levels (DESIGN §5.1) as the top bar shows them; μ is in JOINT_FRICTION. */
/** `name` is the level's one name everywhere (tooltip, status, help, accessible name); `label` the
 * button caption ("Real" is "Realistic" shortened to fit the 1280 px top bar). */
export const FRICTION_LEVELS: readonly { level: FrictionLevel; name: string; label: string; title: string }[] = [
  { level: 'off', name: 'Off', label: 'Off', title: 'Off — ideal joints: motion never dies down' },
  { level: 'low', name: 'Low', label: 'Low', title: 'Low — joints slip easily: a swing dies down slowly' },
  { level: 'realistic', name: 'Realistic', label: 'Real', title: 'Realistic — like real parts: a swing dies down within seconds' },
];
export const FRICTION_TITLE = 'Joint friction: how quickly pins and axles lose motion';

const MOD = /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl+';

export class TopBar {
  readonly el: HTMLElement;
  private readonly newBtn: HTMLButtonElement;
  private readonly openBtn: HTMLButtonElement;
  private readonly saveBtn: HTMLButtonElement;
  private readonly examplesBtn: HTMLButtonElement;
  private readonly examplesMenu: HTMLElement;
  private readonly undoBtn: HTMLButtonElement;
  private readonly redoBtn: HTMLButtonElement;
  private readonly swatches: HTMLButtonElement[] = [];
  private readonly kinInput: HTMLInputElement;
  private readonly playBtn: HTMLButtonElement;
  private readonly pauseBtn: HTMLButtonElement;
  private readonly stepBtn: HTMLButtonElement;
  private readonly speedBtns: HTMLButtonElement[] = [];
  private readonly frictionBtns: HTMLButtonElement[] = [];
  /** Simulated time; the host places it (over the viewport, next to the mode badge). */
  readonly readout: HTMLElement;
  /** The "can't keep up" pill; the host places it (over the viewport, next to the mode badge). */
  readonly slow: HTMLElement;

  constructor(examples: readonly ExampleEntry[], private readonly on: TopBarHandlers) {
    this.newBtn = button([icon(ICONS.file), 'New'], { class: 'btn', title: 'New empty model', 'data-action': 'new', onclick: () => on.newModel() });
    this.openBtn = button([icon(ICONS.open), 'Open…'], { class: 'btn', title: `Open a .knap.json file (${MOD}O)`, 'data-action': 'open', onclick: () => on.open() });
    this.saveBtn = button([icon(ICONS.save), 'Save'], { class: 'btn', title: `Download the model as .knap.json (${MOD}S)`, 'data-action': 'save', onclick: () => on.save() });

    this.examplesMenu = h('div', { class: 'menu', role: 'menu', hidden: true, 'data-role': 'examples-menu' });
    for (const ex of examples) {
      this.examplesMenu.append(
        h(
          'button',
          {
            type: 'button',
            class: 'menu-item',
            role: 'menuitem',
            'data-example': ex.name,
            onclick: () => {
              this.closeMenus();
              on.loadExample(ex.name);
            },
          },
          h('span', { class: 'title' }, ex.title),
          h('span', { class: 'desc' }, ex.description),
        ),
      );
    }
    this.examplesBtn = button(['Examples', icon(ICONS.caret, 'icon caret')], {
      class: 'btn',
      title: 'Load a built-in example',
      'aria-haspopup': 'menu',
      'aria-expanded': 'false',
      'data-action': 'examples',
      onclick: (e) => {
        e.stopPropagation();
        this.toggleMenu();
      },
    });
    const examplesWrap = h('div', { class: 'menu-wrap' }, this.examplesBtn, this.examplesMenu);
    document.addEventListener('pointerdown', (e) => {
      if (!examplesWrap.contains(e.target as Node)) this.closeMenus();
    });

    this.undoBtn = button(icon(ICONS.undo), { class: 'btn icon-only', title: `Undo (${MOD}Z)`, 'aria-label': 'Undo', 'data-action': 'undo', onclick: () => on.undo() });
    this.redoBtn = button(icon(ICONS.redo), {
      class: 'btn icon-only',
      title: `Redo (${MOD === '⌘' ? '⇧⌘Z' : 'Ctrl+Y'})`,
      'aria-label': 'Redo',
      'data-action': 'redo',
      onclick: () => on.redo(),
    });

    const palette = h('div', { class: 'palette tool-palette', role: 'group', 'aria-label': 'Colour for new parts', 'data-role': 'palette' });
    for (const s of PALETTE) {
      const b = h('button', {
        type: 'button',
        class: 'swatch',
        title: `${s.name} — colour for new parts`,
        'aria-label': s.name,
        'data-color': s.color,
        style: `background:${s.color}`,
        onclick: () => on.pickColor(s.color),
      });
      this.swatches.push(b);
      palette.append(b);
    }

    this.kinInput = h('input', { type: 'checkbox', 'data-action': 'kinematics' });
    this.kinInput.addEventListener('change', () => on.setShowKinematics(this.kinInput.checked));
    const kin = h('label', { class: 'toggle', title: 'Tint parts by rigid body and show joint axes (K)' }, this.kinInput, 'Show kinematics');

    this.playBtn = button([icon(ICONS.play), 'Play'], { class: 'btn primary play', title: 'Simulate (Space)', 'data-action': 'play', onclick: () => on.playStop() });
    this.pauseBtn = button(icon(ICONS.pause), { class: 'btn icon-only', title: 'Pause / resume (Space)', 'aria-label': 'Pause', 'data-action': 'pause', onclick: () => on.togglePause() });
    this.stepBtn = button(icon(ICONS.step), { class: 'btn icon-only', title: 'Step 1/60 s of simulated time (.)', 'aria-label': 'Step', 'data-action': 'step', onclick: () => on.step() });
    const seg = h('div', { class: 'seg', role: 'group', 'aria-label': 'Playback speed', title: 'Playback speed (simulated time per real time)' });
    for (const s of SPEEDS) {
      const b = h('button', { type: 'button', 'data-speed': String(s.value), onclick: () => on.setSpeed(s.value) }, s.label);
      this.speedBtns.push(b);
      seg.append(b);
    }
    // A plain-text caption beside the segmented buttons (not a cell of the group, which read as a
    // disabled fourth option).
    const fricSeg = h('div', { class: 'seg' });
    const fric = h('span', { class: 'friction', role: 'group', 'aria-label': FRICTION_TITLE, title: FRICTION_TITLE, 'data-role': 'friction' }, h('span', { class: 'seg-caption', 'aria-hidden': 'true' }, 'Friction'), fricSeg);
    for (const f of FRICTION_LEVELS) {
      const b = h('button', { type: 'button', 'data-friction': f.level, title: `${FRICTION_TITLE}\n${f.title}`, 'aria-label': f.name, 'aria-pressed': 'false', onclick: () => on.setFriction(f.level) }, f.label);
      this.frictionBtns.push(b);
      fricSeg.append(b);
    }
    this.readout = h('span', { class: 'readout', hidden: true, 'data-role': 'sim-time', title: 'Simulated time' }, 't = –');
    this.slow = h('span', { class: 'slow', hidden: true, 'data-role': 'sim-slow', title: 'The computer cannot simulate this model fast enough: it runs slower than the chosen speed.' }, 'can’t keep up — running slower than the chosen speed');

    const helpBtn = button(icon(ICONS.help), { class: 'btn icon-only', title: 'Mouse and keyboard controls (?)', 'aria-label': 'Controls', 'data-action': 'help', onclick: () => on.help() });
    const aboutBtn = button(icon(ICONS.info), { class: 'btn icon-only', title: 'About knap', 'aria-label': 'About', 'data-action': 'about', onclick: () => on.about() });

    this.el = h(
      'header',
      { class: 'topbar' },
      h('span', { class: 'brand' }, 'knap'),
      this.newBtn,
      this.openBtn,
      this.saveBtn,
      examplesWrap,
      h('span', { class: 'sep' }),
      this.undoBtn,
      this.redoBtn,
      h('span', { class: 'sep' }),
      palette,
      h('span', { class: 'sep' }),
      kin,
      h('span', { class: 'spacer' }),
      h('span', { class: 'simgroup' }, this.playBtn, this.pauseBtn, this.stepBtn, seg, fric),
      h('span', { class: 'sep' }),
      helpBtn,
      aboutBtn,
    );
  }

  get menuOpen(): boolean {
    return !this.examplesMenu.hidden;
  }

  toggleMenu(): void {
    const open = this.examplesMenu.hidden;
    this.examplesMenu.hidden = !open;
    this.examplesBtn.setAttribute('aria-expanded', String(open));
    if (open) (this.examplesMenu.querySelector('button') as HTMLButtonElement | null)?.focus({ preventScroll: true });
  }

  /**
   * Keyboard while the Examples menu is open (role=menu): ArrowDown / ArrowUp / Home / End move
   * between the items, Escape closes it, Space / Enter on a focused item are left to the browser
   * (they activate it), Tab closes it and moves on. Every other key without Ctrl / ⌘ / Alt is held
   * back so shortcuts do not act behind the menu; a key with one closes the menu and is not taken.
   * Returns true when the key was the menu's (the caller then does nothing else with it).
   */
  menuKey(e: KeyboardEvent): boolean {
    if (this.examplesMenu.hidden) return false;
    if (e.ctrlKey || e.metaKey || e.altKey) {
      this.closeMenus();
      return false;
    }
    const items = Array.from(this.examplesMenu.querySelectorAll<HTMLButtonElement>('[role=menuitem]'));
    const i = items.indexOf(document.activeElement as HTMLButtonElement);
    const focus = (j: number): void => {
      e.preventDefault();
      items[(j + items.length) % items.length]?.focus({ preventScroll: true });
    };
    switch (e.key) {
      case 'ArrowDown':
        focus(i + 1);
        break;
      case 'ArrowUp':
        focus(i < 0 ? -1 : i - 1);
        break;
      case 'Home':
        focus(0);
        break;
      case 'End':
        focus(-1);
        break;
      case 'Escape':
        e.preventDefault();
        if (i >= 0) items[i]!.blur();
        this.closeMenus();
        break;
      case 'Tab':
        this.closeMenus();
        break;
      case ' ':
      case 'Enter':
        if (i < 0) e.preventDefault(); // nothing focused in the menu: nothing to activate
        break;
      default:
        break;
    }
    return true;
  }

  closeMenus(): void {
    if (this.examplesMenu.hidden) return;
    this.examplesMenu.hidden = true;
    this.examplesBtn.setAttribute('aria-expanded', 'false');
  }

  update(s: TopBarState): void {
    const editing = s.mode === 'edit';
    for (const b of [this.newBtn, this.openBtn, this.examplesBtn]) b.disabled = !editing;
    if (!editing) this.closeMenus();
    this.undoBtn.disabled = !editing || !s.canUndo;
    this.redoBtn.disabled = !editing || !s.canRedo;
    for (const b of this.swatches) {
      b.disabled = !editing;
      b.classList.toggle('on', b.dataset.color === s.color);
    }
    this.kinInput.checked = s.showKinematics;

    const running = s.mode !== 'edit';
    this.playBtn.replaceChildren(icon(running ? ICONS.stop : ICONS.play), s.mode === 'starting' ? 'Starting…' : running ? 'Stop' : 'Play');
    this.playBtn.classList.toggle('running', running);
    this.playBtn.title = running ? 'Stop and return to the model as edited (Esc)' : 'Simulate (Space)';
    this.playBtn.disabled = s.mode === 'starting';
    this.playBtn.dataset.action = running ? 'stop' : 'play';
    this.pauseBtn.disabled = s.mode !== 'simulate';
    this.pauseBtn.classList.toggle('on', s.mode === 'simulate' && s.paused);
    this.pauseBtn.setAttribute('aria-pressed', String(s.mode === 'simulate' && s.paused));
    this.pauseBtn.replaceChildren(icon(s.mode === 'simulate' && s.paused ? ICONS.play : ICONS.pause));
    this.pauseBtn.title = s.paused ? 'Resume (Space)' : 'Pause (Space)';
    this.stepBtn.disabled = s.mode === 'starting' || (s.mode === 'simulate' && !s.paused);
    for (const b of this.speedBtns) b.classList.toggle('on', Number(b.dataset.speed) === s.speed);
    for (const b of this.frictionBtns) {
      const on = b.dataset.friction === s.friction;
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', String(on));
    }
    this.readout.hidden = s.mode !== 'simulate';
    if (!running) {
      setText(this.readout, 't = –');
      this.slow.hidden = true;
    }
  }

  /** Per-frame simulation readout (cheap: touches the DOM only on change). */
  setSimReadout(time: number, slow: boolean): void {
    setText(this.readout, `t = ${time.toFixed(2)} s`);
    if (this.slow.hidden === slow) this.slow.hidden = !slow;
  }
}
