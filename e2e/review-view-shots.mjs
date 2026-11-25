// Review screenshots: node e2e/review-view-shots.mjs [filter]  -> e2e/out/review-view-*.png
import { join } from 'node:path';
import { OUT_DIR, harness } from './review-view-lib.mjs';

const filter = process.argv[2] ?? '';
const SHOTS = [
  ['iso', 'example=four-bar', {}],
  ['iso-dpr2', 'example=four-bar', { width: 1280, height: 720, deviceScaleFactor: 2 }],
  ['all', 'example=all&glyphs=1', { width: 1800, height: 500 }],
  ['grazing', 'example=four-bar&yaw=40&pitch=2', {}],
  ['grazing-top', 'example=four-bar&yaw=10&pitch=88', {}],
  ['pinhole-close', 'example=pendulum&target=0,0,0.5&height=1.6&yaw=25&pitch=30', {}],
  ['bore-close', 'example=pendulum&target=2,0,0&height=2.2&yaw=8&pitch=10', {}],
  ['far', 'example=all', { width: 900, height: 500 }],
  ['stack-close', 'example=weld-test&target=3,0,1.5&height=2&yaw=58&pitch=4', {}],
  ['tall', 'example=triple-pendulum', { width: 360, height: 900 }],
  ['wide', 'example=four-bar', { width: 1600, height: 260 }],
  ['overlays', 'example=four-bar&sel=3&hoverFace=4,2,2,4&ghost=7,0,1,pinHole,2,1&glyphs=1', {}],
  ['overlays-invalid', 'example=four-bar&hoverCell=2,0,0&ghost=0,0,2,pin,2,0&glyphs=1&yaw=-30&pitch=20', {}],
  ['under', 'example=four-bar&yaw=30&pitch=-50', {}],
  ['root-front', 'example=sliding-axle&view=front', {}],
  ['collision', 'example=collision&glyphs=1', {}],
];
const { open, done } = await harness();
try {
  for (const [name, q, vpOpts] of SHOTS) {
    if (filter && !name.includes(filter)) continue;
    const c = await open(q, vpOpts);
    const path = join(OUT_DIR, `review-view-${name}.png`);
    await c.page.screenshot({ path });
    console.log(path, c.errors.join(' | '));
    await c.close();
  }
} finally {
  await done();
}
