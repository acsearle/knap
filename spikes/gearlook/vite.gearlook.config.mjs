// Dev server for the gearlook harness: the repo root, plus aliases that swap three modules for the
// copies in this directory *only when imported from src/view* (src/ itself is untouched).
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../..');
const VIEW = resolve(ROOT, 'src/view');
const SWAP = {
  '../geometry': resolve(HERE, 'geomwrap.ts'),
  './markpaint': resolve(HERE, 'markwrap.ts'),
  './outline': resolve(HERE, 'outline-copy.ts'),
};
export default {
  root: ROOT,
  logLevel: 'warn',
  optimizeDeps: { exclude: ['manifold-3d'] },
  plugins: [
    {
      name: 'gearlook-swap',
      enforce: 'pre',
      resolveId(source, importer) {
        if (!importer) return null;
        const imp = importer.split('?')[0];
        if (dirname(imp) === VIEW && SWAP[source]) {
          if (source === './markpaint' && imp.endsWith('markwrap.ts')) return null;
          return SWAP[source];
        }
        return null;
      },
    },
  ],
};
