// Browser file I/O for File ▸ Save (download) and File ▸ Open… (file picker), and a safe
// localStorage accessor.
import type { StorageLike } from '../editor';

/** Offer `text` as a download named `fileName`. */
export function downloadText(fileName: string, text: string, mime = 'application/json'): void {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.rel = 'noopener';
  a.style.display = 'none';
  document.body.append(a);
  a.click();
  a.remove();
  // Revoke after the browser has started the download.
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/**
 * A hidden <input type=file> that calls `onFile(name, text)` (or `onError`) for the chosen file.
 * `open()` must run inside a user gesture (click / key press).
 */
export class FilePicker {
  readonly input: HTMLInputElement;

  constructor(accept: string, onFile: (name: string, text: string) => void, onError: (name: string, message: string) => void) {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.style.display = 'none';
    input.dataset.role = 'open-file';
    input.addEventListener('change', () => {
      const f = input.files?.[0];
      input.value = ''; // so choosing the same file again fires change
      if (!f) return;
      f.text().then(
        (text) => onFile(f.name, text),
        (e: unknown) => onError(f.name, e instanceof Error ? e.message : String(e)),
      );
    });
    document.body.append(input);
    this.input = input;
  }

  open(): void {
    this.input.click();
  }
}

/** window.localStorage, or null when storage is disabled (some privacy modes throw on access). */
export function safeLocalStorage(): StorageLike | null {
  try {
    const s = window.localStorage;
    const k = '__knap_probe__';
    s.setItem(k, '1');
    s.removeItem(k);
    return s;
  } catch {
    return null;
  }
}
