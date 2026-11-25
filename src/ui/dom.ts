// Tiny DOM helpers for the plain-DOM UI (no framework).

export type Child = Node | string | null | undefined | false;
export type Attrs = Record<string, string | number | boolean | null | undefined | ((e: Event) => void)>;

/**
 * Create an element. Attributes: `class`, `title`, `data-*`, `aria-*`, any other attribute as a
 * string; boolean true sets an empty attribute, false/null/undefined skips it; `on<event>`
 * functions are added as listeners (e.g. `onclick`).
 */
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs?: Attrs | null, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v === null || v === undefined || v === false) continue;
      if (typeof v === 'function') el.addEventListener(k.slice(2), v as EventListener);
      else if (v === true) el.setAttribute(k, '');
      else el.setAttribute(k, String(v));
    }
  }
  append(el, children);
  return el;
}

export function append(el: Element, children: readonly Child[]): void {
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    el.append(typeof c === 'string' ? document.createTextNode(c) : c);
  }
}

/** An element holding trusted, static SVG markup (icons). */
export function icon(svg: string, cls = 'icon'): HTMLSpanElement {
  const s = document.createElement('span');
  s.className = cls;
  s.setAttribute('aria-hidden', 'true');
  s.innerHTML = svg;
  return s;
}

/** Set textContent only when it differs (avoids layout work in per-frame updates). */
export function setText(el: Element, text: string): void {
  if (el.textContent !== text) el.textContent = text;
}

/** A toolbar-style button. */
export function button(label: Child | Child[], attrs: Attrs = {}): HTMLButtonElement {
  const b = h('button', { type: 'button', ...attrs });
  append(b, Array.isArray(label) ? label : [label]);
  return b;
}

/** True when keyboard input is going into a text field (shortcuts must not fire). */
export function isTypingTarget(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  if (t.isContentEditable) return true;
  if (t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement) return true;
  if (t instanceof HTMLInputElement) {
    return !['button', 'checkbox', 'radio', 'range', 'color', 'file', 'submit', 'reset'].includes(t.type);
  }
  return false;
}

/**
 * True for a focused control that Space / Enter activates by itself (buttons, checkboxes, menu
 * items): global shortcuts on those keys must leave it to the browser. Text fields are covered by
 * isTypingTarget.
 */
export function isActivationTarget(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  if (t instanceof HTMLButtonElement || t instanceof HTMLInputElement || t instanceof HTMLSelectElement) return true;
  if (t instanceof HTMLAnchorElement && t.hasAttribute('href')) return true;
  const role = t.getAttribute('role');
  return role === 'button' || role === 'menuitem' || role === 'checkbox';
}
