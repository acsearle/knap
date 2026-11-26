process.env.E2E_DIST = process.env.E2E_DIST || 'e2e/out/review-m8-ux-dist';
const { buildApp } = await import('../../../e2e/lib.mjs');
await buildApp();
console.log('built');
