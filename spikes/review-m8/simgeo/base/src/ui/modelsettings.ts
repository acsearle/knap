// "Model" block of the inspector panel (DESIGN.md §7.4 "Model settings"): the Ground toggle [G] and
// the Fix root toggle. Always visible (unlike the selected-part inspector below it); edit mode
// only (disabled look while simulating). Both are part of the model (saved in the file, one undo
// step each); the app applies them. Fix root only matters with the ground on (core rootIsFixed):
// without a floor it shows checked and disabled, with a tooltip saying why.
import { h } from './dom';

export interface ModelSettingsHandlers {
  setGround(on: boolean): void;
  setFixRoot(on: boolean): void;
}

export interface ModelSettingsState {
  ground: boolean;
  /** The model's own setting (fixRoot !== false). */
  fixRoot: boolean;
  /** Simulating: both disabled. */
  disabled: boolean;
}

const FIX_TIP_ON = 'Fix the root part in space (off: nothing is fixed — a vehicle that rolls on the ground)';
const FIX_TIP_NO_GROUND = 'Without the ground the root part is always fixed: a model with nothing fixed would fall away. Turn the ground on first.';
const FIX_TIP_NO_GROUND_OFF = `${FIX_TIP_NO_GROUND} (This model's own setting, off, applies again when the ground is on.)`;

export class ModelSettings {
  readonly el: HTMLElement;
  private readonly groundInput: HTMLInputElement;
  private readonly fixInput: HTMLInputElement;
  private readonly fixLabel: HTMLLabelElement;

  constructor(on: ModelSettingsHandlers) {
    this.groundInput = h('input', { type: 'checkbox', 'data-action': 'ground' });
    this.groundInput.addEventListener('change', () => on.setGround(this.groundInput.checked));
    this.fixInput = h('input', { type: 'checkbox', 'data-action': 'fix-root' });
    this.fixInput.addEventListener('change', () => on.setFixRoot(this.fixInput.checked));
    const ground = h(
      'label',
      { class: 'ms-toggle', title: 'Put a floor under the model, at its lowest point (G)' },
      this.groundInput,
      'Ground',
      h('kbd', null, 'G'),
    );
    this.fixLabel = h('label', { class: 'ms-toggle', title: FIX_TIP_ON }, this.fixInput, 'Fix root');
    this.el = h(
      'section',
      { class: 'model-settings', 'aria-label': 'Model settings', 'data-role': 'model-settings' },
      h('h2', null, 'Model'),
      h('div', { class: 'row' }, ground, this.fixLabel),
    );
  }

  update(s: ModelSettingsState): void {
    this.groundInput.checked = s.ground;
    this.groundInput.disabled = s.disabled;
    // Fix root has no effect without the ground (the root is fixed then): checked and disabled.
    this.fixInput.checked = s.fixRoot || !s.ground;
    this.fixInput.disabled = s.disabled || !s.ground;
    this.fixLabel.title = s.ground ? FIX_TIP_ON : s.fixRoot ? FIX_TIP_NO_GROUND : FIX_TIP_NO_GROUND_OFF;
    this.el.classList.toggle('disabled', s.disabled);
    this.fixLabel.classList.toggle('disabled', this.fixInput.disabled);
    this.groundInput.parentElement!.classList.toggle('disabled', s.disabled);
  }
}
