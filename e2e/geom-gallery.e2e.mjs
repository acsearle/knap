// `npm run e2e` entry for the geometry gallery. The gallery page is not part of the app bundle,
// so this script ignores the preview url and serves the repo with its own Vite dev server.
import { renderGallery, startDevServer } from './geom-gallery.mjs';

export default async function (ctx) {
  const server = await startDevServer();
  try {
    const stats = await renderGallery(ctx, server.url);
    ctx.assert(stats.length > 0 && stats.every((s) => s.triangles > 0), 'every gallery part has triangles');
  } finally {
    await server.close();
  }
}
