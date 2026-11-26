// Status bar (§7.4): hover info · what a click will do · last message / error · a lasting warning
// badge (e.g. "Not autosaved") · counts. When space is short the message cell gives way first, so
// the hint (with its [R] / Shift alternatives) stays readable at 1280 px.
import { h, setText } from './dom';

export class StatusBar {
  readonly el: HTMLElement;
  private readonly hover: HTMLElement;
  private readonly hint: HTMLElement;
  private readonly hintMain: HTMLElement;
  private readonly hintAux: HTMLElement;
  private readonly msg: HTMLElement;
  private readonly counts: HTMLElement;
  private readonly warn: HTMLElement;

  constructor() {
    this.hover = h('div', { class: 'st-hover', 'data-role': 'status-hover' });
    this.hintMain = h('span', { 'data-role': 'status-hint' });
    this.hintAux = h('span', { class: 'aux', 'data-role': 'status-aux' });
    this.hint = h('div', { class: 'st-hint' }, this.hintMain, this.hintAux);
    this.msg = h('div', { class: 'st-msg', 'data-role': 'status-message', 'aria-live': 'polite' });
    this.counts = h('div', { class: 'st-counts', 'data-role': 'status-counts' });
    this.warn = h('div', { class: 'st-warn', 'data-role': 'status-warning' });
    this.el = h('footer', { class: 'statusbar' }, this.hover, this.hint, this.msg, this.warn, this.counts);
  }

  setHover(text: string): void {
    setText(this.hover, text);
    this.hover.title = text;
  }

  /** What a click will do; `invalid` shows it in red (with the reason); `aux` = [R] / Shift hints. */
  setHint(text: string, invalid = false, aux = ''): void {
    setText(this.hintMain, text);
    setText(this.hintAux, aux);
    this.hint.classList.toggle('invalid', invalid);
    this.hint.title = aux ? `${text}  ${aux}` : text;
  }

  /** Last message; errors stay red until the next message. */
  setMessage(text: string, error = false): void {
    setText(this.msg, text);
    this.msg.classList.toggle('error', error);
    this.msg.title = text;
  }

  get message(): { text: string; error: boolean } {
    return { text: this.msg.textContent ?? '', error: this.msg.classList.contains('error') };
  }

  get hintText(): string {
    return this.hintMain.textContent ?? '';
  }

  /** A lasting warning badge ('' hides it); `title` explains it on hover. */
  setWarning(text: string, title = ''): void {
    setText(this.warn, text);
    this.warn.title = title;
  }

  get warning(): string {
    return this.warn.textContent ?? '';
  }

  setCounts(text: string): void {
    setText(this.counts, text);
  }
}
