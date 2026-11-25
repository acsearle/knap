// WASM heap growth. liveManifoldCount() only sees objects this module registers; wrapper-internal
// temporaries (e.g. the polygon vectors manifold-3d's extrude/revolve wrappers forget to free)
// are invisible to it, so watch the WebAssembly.Memory itself.
import { beforeAll, describe, expect, it } from 'vitest';
import { buildPartMesh, clearMeshCache, initGeometry, liveManifoldCount, partSolidStats, partVolume } from '../../src/geometry';
import { c, liftarm, part, randomPart } from './helpers';

// Capture the memory of every module instantiated from here on (initGeometry runs in beforeAll,
// after this patch, so the geometry module's instance is captured).
const memories: WebAssembly.Memory[] = [];
const origInstantiate = WebAssembly.instantiate.bind(WebAssembly);
(WebAssembly as unknown as { instantiate: unknown }).instantiate = async (...a: unknown[]) => {
  const r = (await (origInstantiate as (...x: unknown[]) => Promise<unknown>)(...a)) as
    | WebAssembly.WebAssemblyInstantiatedSource
    | WebAssembly.Instance;
  const inst = 'instance' in r ? r.instance : r;
  for (const v of Object.values(inst.exports)) if (v instanceof WebAssembly.Memory) memories.push(v);
  return r;
};
if (WebAssembly.instantiateStreaming) {
  const origStreaming = WebAssembly.instantiateStreaming.bind(WebAssembly);
  (WebAssembly as unknown as { instantiateStreaming: unknown }).instantiateStreaming = async (...a: unknown[]) => {
    const r = await (origStreaming as (...x: unknown[]) => Promise<WebAssembly.WebAssemblyInstantiatedSource>)(...a);
    for (const v of Object.values(r.instance.exports)) if (v instanceof WebAssembly.Memory) memories.push(v);
    return r;
  };
}

beforeAll(() => initGeometry());

describe('WASM memory', () => {
  it('uncached builds (extrude, revolve and 3D paths) do not grow the heap', () => {
    expect(memories.length).toBeGreaterThan(0);
    const mem = memories[0]!;
    const fixed = [
      liftarm(15), // 2D slab extrude (a large profile, so a per-extrude leak is big)
      part([c(0, 0, 0, 'pin', 0), c(1, 0, 0, 'frictionPin', 0), c(2, 0, 0, 'axle', 0)]), // revolve + cross extrude
      part([c(0, 0, 0, 'pinHole', 0), c(1, 0, 0, 'axleHole', 1), c(1, 1, 0, 'axle', 1)]), // 3D path
    ];
    const run = (from: number, n: number): void => {
      for (let i = from; i < from + n; i++) {
        clearMeshCache();
        const p = i % 4 !== 0 ? fixed[i % fixed.length]! : randomPart(30000 + (i % 300), 2 + (i % 7));
        buildPartMesh(p);
        if (i % 5 === 0) partSolidStats(p);
        if (i % 7 === 0) partVolume(p);
      }
    };
    run(0, 300); // warm-up: let the allocator reach its working size
    const before = mem.buffer.byteLength;
    run(300, 3000);
    const after = mem.buffer.byteLength;
    expect(liveManifoldCount()).toBe(0);
    // With the leak this grew by several MiB over these builds; the heap grows in 64 KiB pages.
    expect(after - before, `heap ${before / 2 ** 20} → ${after / 2 ** 20} MiB`).toBeLessThanOrEqual(2 ** 20);
  }, 300000);

  it('many uncached pin builds (one revolve each) do not grow the heap', () => {
    const mem = memories[0]!;
    const pin = part([c(0, 0, 0, 'pin', 1)]);
    const run = (n: number): void => {
      for (let i = 0; i < n; i++) {
        clearMeshCache();
        buildPartMesh(pin);
      }
    };
    run(1000);
    const before = mem.buffer.byteLength;
    run(30000); // the old wrapper leaked ~0.6 KB per revolve: ~18 MiB here
    const after = mem.buffer.byteLength;
    expect(liveManifoldCount()).toBe(0);
    expect(after - before, `heap ${before / 2 ** 20} → ${after / 2 ** 20} MiB`).toBeLessThanOrEqual(2 ** 20);
  }, 300000);
});
