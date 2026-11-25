import { describe, expect, it } from 'vitest';
import { serialize } from '../../src/core';
import { buildExample } from '../../src/core/examples';
import {
  AUTOSAVE_CORRUPT_KEY,
  AUTOSAVE_KEY,
  autosave,
  clearAutosave,
  initialModel,
  modelFileText,
  parseModelFile,
  restoreAutosave,
  suggestFileName,
} from '../../src/editor';
import type { StorageLike } from '../../src/editor';
import { c, modelOf } from './helpers';

class MemStorage implements StorageLike {
  map = new Map<string, string>();
  failWrites = false;
  failReads = false;
  getItem(k: string) {
    if (this.failReads) throw new Error('SecurityError');
    return this.map.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    if (this.failWrites) throw new Error('QuotaExceededError');
    this.map.set(k, v);
  }
  removeItem(k: string) {
    this.map.delete(k);
  }
}

describe('suggestFileName', () => {
  it('from a name', () => {
    expect(suggestFileName('Four-bar linkage')).toBe('four-bar-linkage.knap.json');
    expect(suggestFileName('my model.knap.json')).toBe('my-model.knap.json');
    expect(suggestFileName('x.JSON')).toBe('x.knap.json');
    expect(suggestFileName('  ../../etc/passwd ')).toBe('etc-passwd.knap.json');
    expect(suggestFileName('a'.repeat(200)).length).toBe(80 + '.knap.json'.length);
  });
  it('fallback with a timestamp', () => {
    const d = new Date(2026, 0, 5, 9, 7);
    expect(suggestFileName(null, d)).toBe('knap-20260105-0907.knap.json');
    expect(suggestFileName('???', d)).toBe('knap-20260105-0907.knap.json');
    expect(suggestFileName('', d)).toBe('knap-20260105-0907.knap.json');
  });
});

describe('files and autosave', () => {
  const m = buildExample('four-bar');

  it('parseModelFile round trip and failures never throw', () => {
    const r = parseModelFile(modelFileText(m));
    expect(r.ok && r.model).toEqual(m);
    const bad = parseModelFile('{nope');
    expect(bad.ok).toBe(false);
    expect(!bad.ok && bad.message).toMatch(/invalid JSON/);
    const invalid = parseModelFile(JSON.stringify({ version: 1, parts: [{ id: 1, color: 'red', cells: [] }] }));
    expect(invalid.ok).toBe(false);
  });

  it('autosave / restore', () => {
    const s = new MemStorage();
    expect(restoreAutosave(s)).toEqual({ model: null });
    expect(autosave(s, m)).toEqual({ ok: true });
    expect(s.map.get(AUTOSAVE_KEY)).toBe(serialize(m));
    expect(restoreAutosave(s).model).toEqual(m);
    expect(initialModel(s).model).toEqual(m);
    clearAutosave(s);
    expect(initialModel(s).model.parts).toEqual([]);
    expect(initialModel(null).model.parts).toEqual([]);
  });

  it('an empty autosaved model restores as nothing', () => {
    const s = new MemStorage();
    autosave(s, modelOf());
    expect(restoreAutosave(s)).toEqual({ model: null });
  });

  it('corrupt data: null + message, set aside, next load clean', () => {
    const s = new MemStorage();
    s.map.set(AUTOSAVE_KEY, '{"version":1,"parts":[{"id":1,"color":"#ffffff","cells":[{"x":0.5}]}]}');
    const r = restoreAutosave(s);
    expect(r.model).toBeNull();
    expect(r.message).toMatch(/could not be restored/);
    expect(s.map.has(AUTOSAVE_KEY)).toBe(false);
    expect(s.map.get(AUTOSAVE_CORRUPT_KEY)).toContain('"x":0.5');
    expect(restoreAutosave(s)).toEqual({ model: null });
    // invalid model (overlap) is corrupt too
    s.map.set(AUTOSAVE_KEY, serialize(modelOf([c(0, 0, 0, 'pinHole', 2)])).replace('"parts": [', '"parts": [{"id":7,"color":"#000000","cells":[{"x":0,"y":0,"z":0,"kind":"pinHole","axis":2}]},'));
    const r2 = restoreAutosave(s);
    expect(r2.model).toBeNull();
    expect(r2.message).toBeDefined();
  });

  it('storage that throws', () => {
    const s = new MemStorage();
    s.failWrites = true;
    const w = autosave(s, m);
    expect(w.ok).toBe(false);
    expect(!w.ok && w.message).toMatch(/QuotaExceeded/);
    s.failReads = true;
    const r = restoreAutosave(s);
    expect(r.model).toBeNull();
    expect(r.message).toMatch(/SecurityError/);
    expect(initialModel(s).model.parts).toEqual([]);
    expect(() => clearAutosave({ getItem: () => null, setItem: () => {}, removeItem: () => { throw new Error('x'); } })).not.toThrow();
  });
});
