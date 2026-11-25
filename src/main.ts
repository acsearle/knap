// Placeholder entry point: proves that both WASM dependencies (manifold-3d and Rapier) and
// WebGL2 work in the production bundle. Replaced by the real app wiring later.
import Module from 'manifold-3d';
import manifoldWasmUrl from 'manifold-3d/manifold.wasm?url';
import RAPIER from '@dimforge/rapier3d-compat';

async function checkManifold(): Promise<string> {
  const wasm = await Module({ locateFile: () => manifoldWasmUrl });
  wasm.setup();
  const cube = wasm.Manifold.cube([1, 1, 1], true);
  const volume = cube.volume();
  cube.delete();
  return `manifold ok volume=${Number(volume.toFixed(6))}`;
}

async function checkRapier(): Promise<string> {
  await RAPIER.init();
  const world = new RAPIER.World({ x: 0, y: -1226.25, z: 0 });
  const body = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(0, 10, 0));
  world.createCollider(RAPIER.ColliderDesc.ball(0.5), body);
  world.step();
  const y = body.translation().y;
  world.free();
  if (!(y < 10)) throw new Error(`ball did not fall (y=${y})`);
  return 'rapier ok';
}

function checkWebGL2(): string {
  const canvas = document.createElement('canvas');
  const gl = canvas.getContext('webgl2');
  if (!gl) throw new Error('WebGL2 unavailable');
  return 'webgl2 ok';
}

async function main(): Promise<void> {
  const app = document.getElementById('app')!;
  const status = document.createElement('p');
  status.id = 'status';
  status.textContent = 'initialising…';
  app.append(status);
  try {
    const parts = [await checkManifold(), await checkRapier(), checkWebGL2()];
    status.textContent = parts.join(' · ');
    status.dataset.state = 'ok';
  } catch (err) {
    status.textContent = `error: ${err instanceof Error ? err.message : String(err)}`;
    status.dataset.state = 'error';
    console.error(err);
  }
}

void main();
