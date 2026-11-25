import { describe, expect, it } from 'vitest';
import Module from 'manifold-3d';
import RAPIER from '@dimforge/rapier3d-compat';

describe('WASM dependencies initialise in Node', () => {
  it('manifold-3d: unit cube has volume 1, cylinder volume matches', async () => {
    const wasm = await Module();
    wasm.setup();
    const cube = wasm.Manifold.cube([1, 1, 1], true);
    expect(cube.volume()).toBeCloseTo(1, 9);
    const cyl = wasm.Manifold.cylinder(1.2, 0.25, 0.25, 256, true);
    expect(cyl.volume()).toBeCloseTo(Math.PI * 0.0625 * 1.2, 2);
    const diff = cube.subtract(cyl);
    expect(diff.volume()).toBeCloseTo(1 - Math.PI * 0.0625, 2);
    expect(diff.genus()).toBe(1);
    cube.delete();
    cyl.delete();
    diff.delete();
  });

  it('rapier: a dynamic ball falls under gravity for one step', async () => {
    await RAPIER.init();
    const world = new RAPIER.World({ x: 0, y: -1226.25, z: 0 });
    const body = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(0, 10, 0));
    world.createCollider(RAPIER.ColliderDesc.ball(0.5), body);
    world.step();
    const t = body.translation();
    expect(t.y).toBeLessThan(10);
    expect(t.x).toBe(0);
    world.free();
  });
});
