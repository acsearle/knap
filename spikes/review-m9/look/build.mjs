import { buildApp, DIST_DIR } from '../../../e2e/lib.mjs';
const t0 = Date.now();
await buildApp();
console.log('built', DIST_DIR, Date.now() - t0, 'ms');
