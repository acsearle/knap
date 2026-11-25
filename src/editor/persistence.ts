// File-name suggestion, file parsing and autosave wrappers (DESIGN.md §7.4). Pure apart from
// the storage object passed in (no direct localStorage access).
import { deserialize, emptyModel, serialize } from '../core';
import type { Model } from '../core';

/** Subset of the Web Storage API used here (window.localStorage satisfies it). */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export const FILE_EXTENSION = '.knap.json';
export const AUTOSAVE_KEY = 'knap.autosave.v1';
/** Where an unreadable autosave is moved so it is neither lost nor retried on every load. */
export const AUTOSAVE_CORRUPT_KEY = 'knap.autosave.v1.corrupt';

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/**
 * Suggested download name. With `name` (the opened file's name or an example's name) it is that
 * name with any `.knap.json` / `.json` extension removed, lower-cased, runs of characters other
 * than letters, digits, '-', '_' and '.' replaced by '-', trimmed of '-'/'.', at most 80 chars,
 * plus `.knap.json`. Without a usable name: `knap-YYYYMMDD-HHMM.knap.json` (local time of `now`).
 */
export function suggestFileName(name?: string | null, now: Date = new Date()): string {
  let base = (name ?? '').trim().replace(/\.knap\.json$/i, '').replace(/\.json$/i, '');
  base = base
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    .slice(0, 80)
    .replace(/[-.]+$/g, '');
  if (!base) {
    base = `knap-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;
  }
  return base + FILE_EXTENSION;
}

export type LoadResult = { ok: true; model: Model } | { ok: false; message: string };

/** Parse an opened .knap.json file's text. Never throws; the message is suitable for the status bar / a dialog. */
export function parseModelFile(text: string): LoadResult {
  try {
    return { ok: true, model: deserialize(text) };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}

/** Text for Save (download). */
export function modelFileText(m: Model): string {
  return serialize(m);
}

/** Write the autosave. Never throws (quota / disabled storage → ok:false with a message). */
export function autosave(storage: StorageLike, m: Model): { ok: true } | { ok: false; message: string } {
  try {
    storage.setItem(AUTOSAVE_KEY, serialize(m));
    return { ok: true };
  } catch (e) {
    return { ok: false, message: `Autosave failed: ${e instanceof Error ? e.message : String(e)}` };
  }
}

export interface RestoreResult {
  /** The restored model, or null when there was none or it was unreadable. */
  model: Model | null;
  /** Set when an autosave existed but could not be restored (status bar). */
  message?: string;
}

/**
 * Read the autosave. Missing → { model: null }. Unreadable (invalid JSON / invalid model /
 * storage throws) → { model: null, message }, and the bad text is moved to AUTOSAVE_CORRUPT_KEY
 * (best effort) so the next load starts clean. An autosaved empty model restores as null too
 * (nothing worth restoring). Never throws.
 */
export function restoreAutosave(storage: StorageLike): RestoreResult {
  let text: string | null;
  try {
    text = storage.getItem(AUTOSAVE_KEY);
  } catch (e) {
    return { model: null, message: `Could not read the autosave: ${e instanceof Error ? e.message : String(e)}` };
  }
  if (text === null || text === '') return { model: null };
  const r = parseModelFile(text);
  if (r.ok) return { model: r.model.parts.length ? r.model : null };
  try {
    storage.setItem(AUTOSAVE_CORRUPT_KEY, text);
    storage.removeItem(AUTOSAVE_KEY);
  } catch {
    // best effort
  }
  return { model: null, message: `The autosaved model could not be restored and was set aside (${firstProblem(r.message)})` };
}

/**
 * One line from a parse message: "Invalid knap model (2 problems):\n  - a\n  - b" → "Invalid knap
 * model (2 problems): a"; a one-line message is returned as is.
 */
export function firstProblem(message: string): string {
  const [head = '', ...rest] = message.split('\n');
  const first = rest.map((l) => l.replace(/^\s*-\s*/, '').trim()).find(Boolean);
  return first ? `${head.replace(/:\s*$/, '')}: ${first}` : head;
}

/** Remove the autosave (e.g. after File ▸ New, if the app wants a clean slate). Never throws. */
export function clearAutosave(storage: StorageLike): void {
  try {
    storage.removeItem(AUTOSAVE_KEY);
  } catch {
    // ignore
  }
}

/** Convenience: the model to start the app with — the restored autosave, else an empty model. */
export function initialModel(storage: StorageLike | null): RestoreResult & { model: Model } {
  if (!storage) return { model: emptyModel() };
  const r = restoreAutosave(storage);
  return { ...r, model: r.model ?? emptyModel() };
}
