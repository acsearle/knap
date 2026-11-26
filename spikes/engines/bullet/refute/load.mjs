// Independent loader (does not use ../lib.mjs). AMMO=typed selects ammojs-typed.
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
export default async function load() {
  const p = process.env.AMMO === 'typed' ? '../node_modules/ammojs-typed/ammo/ammo.wasm.js' : '../node_modules/ammojs3/dist/ammo.wasm.js';
  return await require(p)();
}
