// Undo / redo over immutable models (DESIGN.md §2.4, §7.4). Unlimited within the session.
import type { Model } from '../core';

export type HistoryListener = (h: History) => void;

/**
 * A linear history of models. `push` appends a new current model and drops the redo tail; pushing
 * the current model again (same object identity) is ignored. Listeners run after every change of
 * `current` or of the undo/redo availability (push, undo, redo, reset).
 */
export class History {
  private stack: Model[];
  private index: number;
  private listeners = new Set<HistoryListener>();

  constructor(initial: Model) {
    this.stack = [initial];
    this.index = 0;
  }

  get current(): Model {
    return this.stack[this.index]!;
  }

  get canUndo(): boolean {
    return this.index > 0;
  }

  get canRedo(): boolean {
    return this.index < this.stack.length - 1;
  }

  /** Number of models held (for diagnostics). */
  get size(): number {
    return this.stack.length;
  }

  /** Make `m` current. Returns false (and notifies nobody) if `m` is already current. */
  push(m: Model): boolean {
    if (m === this.current) return false;
    this.stack.length = this.index + 1;
    this.stack.push(m);
    this.index++;
    this.emit();
    return true;
  }

  /** Step back; returns the new current model, or null if there is nothing to undo. */
  undo(): Model | null {
    if (!this.canUndo) return null;
    this.index--;
    this.emit();
    return this.current;
  }

  /** Step forward; returns the new current model, or null if there is nothing to redo. */
  redo(): Model | null {
    if (!this.canRedo) return null;
    this.index++;
    this.emit();
    return this.current;
  }

  /** Start a fresh history at `m` (New / Open / load example). Always notifies. */
  reset(m: Model): void {
    this.stack = [m];
    this.index = 0;
    this.emit();
  }

  /** Subscribe; returns the unsubscribe function. */
  onChange(listener: HistoryListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emit(): void {
    for (const l of [...this.listeners]) l(this);
  }
}
