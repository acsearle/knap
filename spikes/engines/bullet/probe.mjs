import { createRequire } from 'module';
const require = createRequire(import.meta.url);
for (const [name, path] of [['ammojs-typed wasm','ammojs-typed/wasm'],['ammojs3 wasm','ammojs3/dist/ammo.wasm.js']]) {
  const t0 = performance.now();
  const f = require(path);
  const A = await f();
  console.log(name, 'loaded in', (performance.now()-t0).toFixed(0),'ms', 'btMultiBody' in A, 'btGearConstraint' in A, 'btMultiBodyGearConstraint' in A, 'btGeneric6DofSpring2Constraint' in A, 'btNNCGConstraintSolver' in A);
  // precision probe: store a double into btVector3 and read back
  const v = new A.btVector3(0.1, 1/3, 1e-9+1);
  console.log('  vec roundtrip', v.x(), v.y(), v.z(), 'f32(0.1)=', Math.fround(0.1));
}
process.exit(0);
