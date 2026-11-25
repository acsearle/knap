// The production build must carry the licences of the bundled third-party code (Apache-2.0 §4 for
// Rapier and manifold-3d): vite.config.ts emits THIRD_PARTY_LICENSES.txt.
import { describe, expect, it } from 'vitest';
import config from '../../vite.config';

describe('THIRD_PARTY_LICENSES.txt', () => {
  it('lists every runtime dependency with its licence text', () => {
    const plugins = (config as { plugins?: unknown[] }).plugins ?? [];
    const plugin = plugins.find((p) => (p as { name?: string }).name === 'knap-third-party-licenses') as
      | { generateBundle: (this: unknown) => void; apply?: string }
      | undefined;
    expect(plugin?.apply).toBe('build');
    const emitted: { fileName: string; source: string }[] = [];
    plugin!.generateBundle.call({ emitFile: (f: { fileName: string; source: string }) => emitted.push(f) });
    expect(emitted.map((f) => f.fileName)).toEqual(['THIRD_PARTY_LICENSES.txt']);
    const text = emitted[0]!.source;
    for (const name of ['@dimforge/rapier3d-compat', 'manifold-3d', 'three']) expect(text).toContain(`${name} `);
    expect(text.match(/TERMS AND CONDITIONS FOR USE, REPRODUCTION, AND DISTRIBUTION/g)?.length).toBe(2);
    expect(text).toMatch(/The MIT License/);
  });
});
