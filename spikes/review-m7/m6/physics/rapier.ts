// Rapier loading. `@dimforge/rapier3d-compat` inlines its WASM as base64, so the same code works
// in Node (vitest) and in the Vite bundle with no asset handling.
import RAPIER from '@dimforge/rapier3d-compat';

export { RAPIER };

let ready: Promise<void> | null = null;

/** Initialise the Rapier WASM module. Idempotent: every call returns the same promise. */
export function initPhysics(): Promise<void> {
  if (!ready) {
    ready = RAPIER.init().catch((e: unknown) => {
      ready = null; // allow a retry after a failed init
      throw e;
    });
  }
  return ready;
}
