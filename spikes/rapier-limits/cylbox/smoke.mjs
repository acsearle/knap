import { init, run, fmt } from './lib.mjs';
await init();
for (const floor of ['cuboid','halfspace']) for (const r of [0.5,1,2.5]) {
  const t=Date.now(); const { s } = run({ r, floor }); console.log(floor, r, fmt(s), (Date.now()-t)+'ms');
}
process.exit(0);
