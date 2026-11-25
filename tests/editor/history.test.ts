import { describe, expect, it, vi } from 'vitest';
import { addPart, emptyModel } from '../../src/core';
import { History } from '../../src/editor';
import { c } from './helpers';

describe('History', () => {
  const m0 = emptyModel();
  const m1 = addPart(m0, [c(0, 0, 0, 'pinHole', 2)]).model;
  const m2 = addPart(m1, [c(5, 0, 0, 'pinHole', 2)]).model;
  const m3 = addPart(m1, [c(9, 0, 0, 'pin', 2)]).model;

  it('push / undo / redo', () => {
    const h = new History(m0);
    expect(h.current).toBe(m0);
    expect(h.canUndo).toBe(false);
    expect(h.canRedo).toBe(false);
    expect(h.undo()).toBeNull();
    expect(h.redo()).toBeNull();
    expect(h.push(m1)).toBe(true);
    expect(h.push(m2)).toBe(true);
    expect(h.current).toBe(m2);
    expect(h.undo()).toBe(m1);
    expect(h.undo()).toBe(m0);
    expect(h.undo()).toBeNull();
    expect(h.canRedo).toBe(true);
    expect(h.redo()).toBe(m1);
    expect(h.redo()).toBe(m2);
    expect(h.redo()).toBeNull();
  });

  it('push drops the redo tail', () => {
    const h = new History(m0);
    h.push(m1);
    h.push(m2);
    h.undo();
    h.push(m3);
    expect(h.canRedo).toBe(false);
    expect(h.redo()).toBeNull();
    expect(h.undo()).toBe(m1);
    expect(h.size).toBe(3);
  });

  it('no-op pushes (same identity) are ignored and do not notify or drop redo', () => {
    const h = new History(m0);
    h.push(m1);
    h.undo();
    const l = vi.fn();
    h.onChange(l);
    expect(h.push(m0)).toBe(false);
    expect(l).not.toHaveBeenCalled();
    expect(h.canRedo).toBe(true);
  });

  it('no cap: thousands of entries', () => {
    const h = new History(m0);
    let m = m0;
    for (let i = 0; i < 5000; i++) {
      m = { ...m };
      h.push(m);
    }
    let n = 0;
    while (h.undo()) n++;
    expect(n).toBe(5000);
    expect(h.current).toBe(m0);
  });

  it('listeners: called on every change, unsubscribe, reset', () => {
    const h = new History(m0);
    const seen: boolean[] = [];
    const off = h.onChange((x) => seen.push(x.canUndo));
    h.push(m1);
    h.undo();
    h.redo();
    h.reset(m2);
    expect(seen).toEqual([true, false, true, false]);
    expect(h.current).toBe(m2);
    expect(h.canUndo).toBe(false);
    expect(h.canRedo).toBe(false);
    off();
    h.push(m3);
    expect(seen.length).toBe(4);
  });
});
