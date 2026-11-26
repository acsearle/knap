// Self-contained demo of the view module (src/view) for visual verification (e2e/view-shots.e2e.mjs).
//
// Query parameters (all optional):
//   example=four-bar        built-in example name (src/core/examples.ts); 'all' lays every example out in a row
//   view=iso                named view (front, top-front-right, …); yaw=…&pitch=… (degrees) override it
//   target=x,y,z&height=h   explicit camera (close-ups); otherwise fitted to everything
//   sel=1,2                 selected part ids
//   ghost=x,y,z,kind,axis,valid   ghost sub-part (valid 1/0)
//   hoverFace=x,y,z,dir     hovered cell face (dir 0..5)
//   hoverCell=x,y,z         erase-hover cell cube
//   grid=0|1  root=0|1  glyphs=0|1  cube=0|1  tint=0|1 (colour by rigid body)
//   rot=partId,deg,px,py,pz,axis   apply a simulation-style rotation to a part about an axis line
//   ss=1|2                  outline supersampling override
//   log=1                   log host pointer events to window.__viewEvents
import { EXAMPLES, buildExample } from '../src/core/examples';
import { analyze } from '../src/core/kinematics';
import type { Axis, Cell, Dir, Kind, Model } from '../src/core';
import { Viewport, jointGlyphsFromGraph, parseViewName } from '../src/view';
import type { CameraState, ViewportPointerEvent } from '../src/view';
import { initGeometry } from '../src/geometry';
import { addCell, movePart, setPartColor } from '../src/core';

declare global {
  interface Window {
    __view?: Record<string, unknown> & { ready: boolean };
    __viewError?: string;
    __viewEvents?: { type: string; x: number; y: number; button: number; ray?: unknown }[];
  }
}

const q = new URLSearchParams(location.search);
const nums = (s: string | null): number[] | null => (s ? s.split(',').map(Number) : null);
const BODY_COLORS = ['#5f6468', '#c8433a', '#e0b43c', '#3b74c4', '#4c9a57', '#e07b2e', '#8a5cc2', '#2aa198'];

function allExamples(): Model {
  // Lay every example out along X, 14 units apart, renumbering part ids.
  const parts: Model['parts'] = [];
  let id = 1;
  // gears=0: leave out the examples with gears (view-gears compares this layout against the view
  // before gears existed); their slots stay empty so the other examples keep their positions.
  const noGears = q.get('gears') === '0';
  EXAMPLES.forEach((ex, i) => {
    const m = ex.build();
    if (noGears && m.parts.some((p) => p.cells.some((c) => c.teeth))) return;
    for (const p of m.parts) parts.push({ id: id++, color: p.color, cells: p.cells.map((c) => ({ ...c, x: c.x + i * 14 })) });
  });
  return { version: 1, parts, rootPartId: 1, nextPartId: id };
}

async function main(): Promise<void> {
  await initGeometry();
  const exampleName = q.get('example') ?? 'four-bar';
  const model = exampleName === 'all' ? allExamples() : buildExample(exampleName);
  const ssParam = q.get('ss');
  const vp = new Viewport(document.getElementById('vp')!, {
    viewCube: q.get('cube') !== '0',
    supersample: ssParam ? Number(ssParam) : 'auto',
    animationMs: Number(q.get('anim') ?? 250),
  });
  vp.setModel(model);

  if (q.get('tint') === '1') {
    const g = analyze(model);
    const m = new Map<number, string>();
    for (const [pid, bid] of g.bodyOfPart) m.set(pid, BODY_COLORS[bid % BODY_COLORS.length]!);
    vp.setPartColors(m);
  }
  const sel = nums(q.get('sel'));
  if (sel) vp.setSelection(sel);
  const gh = q.get('ghost')?.split(',');
  if (gh) {
    const cell: Cell = { x: +gh[0]!, y: +gh[1]!, z: +gh[2]!, kind: gh[3] as Kind, axis: +gh[4]! as Axis };
    vp.setGhost({ cell, valid: gh[5] !== '0' });
  }
  const hf = nums(q.get('hoverFace'));
  if (hf) vp.setHoverFace({ cell: [hf[0]!, hf[1]!, hf[2]!], dir: hf[3]! as Dir });
  const hc = nums(q.get('hoverCell'));
  if (hc) vp.setHoverCell({ cell: [hc[0]!, hc[1]!, hc[2]!] });
  vp.setGridVisible(q.get('grid') !== '0');
  vp.setRootMarkerVisible(q.get('root') !== '0');
  if (q.get('glyphs') === '1') vp.setJointGlyphs(jointGlyphsFromGraph(analyze(model)));
  const rot = nums(q.get('rot'));
  if (rot) {
    const [pid, deg, px, py, pz, axis] = rot as [number, number, number, number, number, number];
    const a = [0, 0, 0];
    a[axis] = 1;
    const h = ((deg * Math.PI) / 180) / 2;
    const qq: [number, number, number, number] = [a[0]! * Math.sin(h), a[1]! * Math.sin(h), a[2]! * Math.sin(h), Math.cos(h)];
    // world' = R·world + p with p = pivot − R·pivot
    const rotv = (v: number[]): number[] => {
      const [x, y, z, w] = qq;
      const tx = 2 * (y * v[2]! - z * v[1]!);
      const ty = 2 * (z * v[0]! - x * v[2]!);
      const tz = 2 * (x * v[1]! - y * v[0]!);
      return [v[0]! + w * tx + (y * tz - z * ty), v[1]! + w * ty + (z * tx - x * tz), v[2]! + w * tz + (x * ty - y * tx)];
    };
    const rp = rotv([px, py, pz]);
    vp.setPartTransform(pid, [px - rp[0]!, py - rp[1]!, pz - rp[2]!], qq);
  }

  // camera
  const view = q.get('view') ?? 'iso';
  const dir = parseViewName(view);
  if (!dir) throw new Error(`bad view ${view}`);
  vp.snapTo(dir, { animate: false });
  const yaw = q.get('yaw');
  const pitch = q.get('pitch');
  if (yaw !== null || pitch !== null) {
    const c = vp.getCamera();
    vp.setCamera({ ...c, yaw: yaw !== null ? (+yaw * Math.PI) / 180 : c.yaw, pitch: pitch !== null ? (+pitch * Math.PI) / 180 : c.pitch }, { animate: false });
  }
  vp.fit('all', { animate: false });
  const tg = nums(q.get('target'));
  if (tg) vp.setCamera({ ...vp.getCamera(), target: [tg[0]!, tg[1]!, tg[2]!], height: Number(q.get('height') ?? 4) }, { animate: false });

  const events: NonNullable<Window['__viewEvents']> = [];
  window.__viewEvents = events;
  if (q.get('log') === '1') {
    const rec = (type: string) => (e: ViewportPointerEvent | null) => {
      if (e) events.push({ type, x: e.x, y: e.y, button: e.button, ray: e.ray });
      else events.push({ type, x: NaN, y: NaN, button: -1 });
    };
    vp.onHover(rec('hover'));
    vp.onClick(rec('click'));
  }
  if (q.get('claim') === '1') {
    // Host drag hook: claim left drags that start on the right half of the viewport.
    vp.setDragHandler({
      claim: (press) => {
        const ok = press.x > vp.size.width / 2;
        events.push({ type: ok ? 'claim' : 'decline', x: press.x, y: press.y, button: press.button });
        return ok;
      },
      move: (e) => events.push({ type: 'drag', x: e.x, y: e.y, button: e.button }),
      end: (e, cancelled) => events.push({ type: cancelled ? 'dragcancel' : 'dragend', x: e.x, y: e.y, button: e.button }),
    });
  }

  const waitFrames = (n: number): Promise<void> =>
    new Promise((res) => {
      const step = (): void => (n-- <= 0 ? res() : void requestAnimationFrame(step));
      requestAnimationFrame(step);
    });

  window.__view = {
    ready: false,
    vp,
    camera: (): CameraState => vp.getCamera(),
    setCamera: (s: CameraState, animate = false) => vp.setCamera(s, { animate }),
    snap: (name: string, animate = false) => vp.snapTo(name, { animate }),
    fit: (animate = false) => vp.fit(undefined, { animate }),
    home: (animate = false) => vp.home({ animate }),
    project: (p: [number, number, number]) => vp.project(p),
    ray: (x: number, y: number) => vp.rayAtLocal(x, y),
    /** Client point inside a view-cube region (or null if not visible). */
    cubePoint: (name: string) => {
      const d = parseViewName(name);
      const cube = (vp as unknown as { cube: { regionPoint(d: unknown, w: number): [number, number] | null } | null }).cube;
      if (!d || !cube) return null;
      const p = cube.regionPoint(d, vp.size.width);
      if (!p) return null;
      const r = vp.canvas.getBoundingClientRect();
      return [p[0] + r.left, p[1] + r.top];
    },
    animating: () => vp.animating,
    /** Resolve once no animation runs and two more frames have rendered. */
    settle: async () => {
      while (vp.animating) await waitFrames(1);
      await waitFrames(2);
      return vp.getCamera();
    },
    /** Average ms per synchronous render (GPU-synchronised with a 1-px readback). */
    benchmark: (frames = 20) => {
      const gl = vp.renderer.getContext();
      const px = new Uint8Array(4);
      vp.renderNow();
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
      const t0 = performance.now();
      for (let i = 0; i < frames; i++) {
        vp.renderNow();
        gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
      }
      return (performance.now() - t0) / frames;
    },
    stats: () => ({
      ...vp.stats(),
      triangles: vp.renderer.info.render.triangles,
      calls: vp.renderer.info.render.calls,
      size: vp.size,
    }),
    model: () => vp.getModel(),
    /** Model edits through core (exercise setModel diffing). */
    edit: (op: 'move' | 'color' | 'add', partId: number, arg: unknown) => {
      const m = vp.getModel()!;
      const next =
        op === 'move' ? movePart(m, partId, arg as [number, number, number])
        : op === 'color' ? setPartColor(m, partId, arg as string)
        : addCell(m, partId, arg as Cell);
      if (!next) throw new Error('edit rejected');
      vp.setModel(next);
      return vp.stats();
    },
    renderNow: () => vp.renderNow(),
    /** Render, read the drawing buffer back and count dark (ink) and non-background pixels. */
    pixelStats: () => {
      vp.renderNow();
      const gl = vp.renderer.getContext();
      const w = gl.drawingBufferWidth;
      const h = gl.drawingBufferHeight;
      const px = new Uint8Array(w * h * 4);
      gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
      let ink = 0;
      let nonBg = 0;
      let opaque = 0;
      for (let i = 0; i < px.length; i += 4) {
        const l = 0.299 * px[i]! + 0.587 * px[i + 1]! + 0.114 * px[i + 2]!;
        if (l < 70) ink++;
        if (Math.abs(px[i]! - 247) + Math.abs(px[i + 1]! - 247) + Math.abs(px[i + 2]! - 245) > 24) nonBg++;
        if (px[i + 3] === 255) opaque++;
      }
      return { w, h, ink, nonBg, opaque, total: w * h };
    },
  };
  await waitFrames(2);
  window.__view.ready = true;
}

main().catch((err: unknown) => {
  window.__viewError = err instanceof Error ? (err.stack ?? err.message) : String(err);
  console.error(err);
});
