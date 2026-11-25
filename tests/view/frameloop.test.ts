// Regression test for the viewport frame loop: a frame callback that changes the view (as the
// simulation loop does with setPartTransform → requestRender) must not leave a second frame
// request pending. Before the fix every such frame doubled the pending requestAnimationFrame
// callbacks (1, 2, 4, …), so the page rendered exponentially many times per display frame.
// Runs Viewport.prototype.frame / requestRender on a stand-in object (no WebGL in Node).
import { afterEach, describe, expect, it } from 'vitest';
import { Viewport } from '../../src/view/viewport';

type Fake = {
  disposed: boolean;
  rafId: number | null;
  lastFrame: number;
  anim: null;
  frameCallbacks: Set<(dt: number, now: number) => void>;
  renders: number;
  renderNow(): void;
  requestRender(): void;
  frame(t: number): void;
};

const g = globalThis as unknown as {
  requestAnimationFrame?: (cb: (t: number) => void) => number;
  cancelAnimationFrame?: (id: number) => void;
};
const saved = { raf: g.requestAnimationFrame, caf: g.cancelAnimationFrame };

afterEach(() => {
  g.requestAnimationFrame = saved.raf;
  g.cancelAnimationFrame = saved.caf;
});

describe('Viewport frame loop', () => {
  it('keeps exactly one frame pending while a frame callback requests renders', () => {
    const pending = new Map<number, (t: number) => void>();
    let next = 1;
    g.requestAnimationFrame = (cb) => {
      pending.set(next, cb);
      return next++;
    };
    g.cancelAnimationFrame = (id) => {
      pending.delete(id);
    };
    const proto = Viewport.prototype as unknown as { frame(t: number): void; requestRender(): void };
    const fake: Fake = {
      disposed: false,
      rafId: null,
      lastFrame: 0,
      anim: null,
      frameCallbacks: new Set(),
      renders: 0,
      renderNow() {
        this.renders++;
      },
      requestRender() {
        proto.requestRender.call(this);
      },
      frame(t: number) {
        proto.frame.call(this, t);
      },
    };
    fake.frameCallbacks.add(() => fake.requestRender()); // like setPartTransform in the sim loop
    fake.requestRender();
    for (let vsync = 1; vsync <= 10; vsync++) {
      const due = [...pending.values()];
      pending.clear();
      for (const cb of due) cb(vsync * 16.7);
      expect(pending.size).toBe(1);
      expect(fake.renders).toBe(vsync);
    }
  });
});
