import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import type { Plugin } from 'vite';

const ROOT = dirname(fileURLToPath(import.meta.url));

/**
 * The production bundle embeds the runtime dependencies (three.js MIT; Rapier and manifold-3d
 * Apache-2.0), and minification keeps only three.js's @license header. Apache-2.0 §4 asks
 * redistributions to carry the licence text, so the build writes every runtime dependency's
 * LICENSE (and NOTICE, if it has one) into dist/THIRD_PARTY_LICENSES.txt.
 */
function thirdPartyLicenses(): Plugin {
  return {
    name: 'knap-third-party-licenses',
    apply: 'build',
    generateBundle() {
      const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as { dependencies?: Record<string, string> };
      const parts = ['Third-party software bundled with knap', ''];
      for (const name of Object.keys(pkg.dependencies ?? {}).sort()) {
        const dir = join(ROOT, 'node_modules', name);
        const meta = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as { version: string; license?: string; homepage?: string };
        parts.push('='.repeat(78), `${name} ${meta.version} — ${meta.license ?? 'see below'}${meta.homepage ? ` — ${meta.homepage}` : ''}`, '='.repeat(78), '');
        parts.push(readFileSync(join(dir, 'LICENSE'), 'utf8').trimEnd(), '');
        try {
          parts.push(readFileSync(join(dir, 'NOTICE'), 'utf8').trimEnd(), '');
        } catch {
          // no NOTICE file
        }
      }
      this.emitFile({ type: 'asset', fileName: 'THIRD_PARTY_LICENSES.txt', source: parts.join('\n') });
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [thirdPartyLicenses()],
  build: {
    target: 'es2022',
    // The WASM modules are large; this is expected.
    chunkSizeWarningLimit: 8192,
  },
  optimizeDeps: {
    // manifold-3d is an Emscripten module that locates its .wasm relative to itself;
    // keep it out of dep pre-bundling so the ?url import resolves to the real file.
    exclude: ['manifold-3d'],
  },
});
