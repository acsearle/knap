// Smoke test: the production bundle loads, both WASM modules initialise, WebGL2 is available.
export default async function ({ page, url, shot, assert, step }) {
  await step('load page', () => page.goto(url));
  assert((await page.title()) === 'knap', 'page title is "knap"');

  const status = page.locator('#status');
  await step('wait for status', () =>
    page.waitForFunction(() => {
      const s = document.getElementById('status');
      return s && (s.dataset.state === 'ok' || s.dataset.state === 'error');
    }, null, { timeout: 30000 }),
  );
  const text = (await status.textContent()) ?? '';
  console.log(`  [smoke] status: ${text}`);
  assert(text.includes('manifold ok volume=1'), `manifold status in "${text}"`);
  assert(text.includes('rapier ok'), `rapier status in "${text}"`);
  assert(text.includes('webgl2 ok'), `webgl2 status in "${text}"`);

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
