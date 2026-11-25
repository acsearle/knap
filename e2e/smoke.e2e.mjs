// Smoke test: the production bundle loads, the app reports ready, WebGL2 is available.
export default async function ({ page, url, shot, assert, step }) {
  await step('load page', () => page.goto(url));
  assert((await page.title()) === 'knap', 'page title is "knap"');

  await step('wait for app ready', () =>
    page.waitForFunction(() => document.body.dataset.ready === 'true', null, { timeout: 30000 }),
  );
  assert(await page.evaluate(() => !!window.__knap && window.__knap.getModel().parts.length > 0),
    'app started with a non-empty model');

  // Independently confirm WebGL2 renders (draw + readPixels), not just that a context exists.
  const pixel = await page.evaluate(() => {
    const c = document.createElement('canvas');
    c.width = c.height = 4;
    const gl = c.getContext('webgl2');
    if (!gl) return null;
    gl.clearColor(0, 1, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    const px = new Uint8Array(4);
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    return {
      px: Array.from(px),
      renderer: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
    };
  });
  assert(pixel, 'WebGL2 context in test page');
  console.log(`  [smoke] webgl2 renderer: ${pixel.renderer}`);
  assert(pixel.px.join(',') === '0,255,0,255', `WebGL2 clear readback ${pixel.px}`);

  await shot('smoke');
}
