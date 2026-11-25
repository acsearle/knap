// window.__knap — the debug API for automated tests (DESIGN.md §7.5), plus a few extras the e2e
// scripts need to drive the real UI (screen positions of cell faces and grid cells, state).
import { DIRS, partById } from '../core';
import type { Dir, Model } from '../core';
import { describeGraph } from '../core/kinematics';
import { pickCell, pickGrid } from '../editor';
import type { FrictionLevel } from '../physics';
import type { App } from './app';

type V3 = [number, number, number];

export interface AnalyzeSummary {
  parts: number;
  bodies: number;
  fixedBodies: number;
  joints: number;
  revolute: number;
  cylindrical: number;
  prismatic: number;
  /** "4 bodies (1 fixed) · 4 joints: 4 revolute" */
  summary: string;
  bodyOfPart: Record<number, number>;
  jointList: { bodyA: number; bodyB: number; type: string; axis: number; origin: V3; limits?: [number, number] }[];
}

function rotate(q: readonly number[], v: readonly number[]): V3 {
  const [x, y, z, w] = q as [number, number, number, number];
  const [vx, vy, vz] = v as V3;
  const tx = 2 * (y * vz - z * vy);
  const ty = 2 * (z * vx - x * vz);
  const tz = 2 * (x * vy - y * vx);
  return [vx + w * tx + (y * tz - z * ty), vy + w * ty + (z * tx - x * tz), vz + w * tz + (x * ty - y * tx)];
}

export function installTestHook(app: App): void {
  const vp = app.vp;

  /** Client point → is it on the canvas (not covered by a panel, the cube's buttons, …)? */
  const onCanvas = (x: number, y: number): boolean => document.elementFromPoint(x, y) === vp.canvas;

  /** World point of a cell (edit-time) under the current simulated transform of its part. */
  const worldOf = (partId: number, p: V3): V3 => {
    const t = app.session?.transformOf(partId);
    if (!t) return p;
    const r = rotate(t.q, p);
    return [r[0] + t.p[0], r[1] + t.p[1], r[2] + t.p[2]];
  };

  const api = {
    getModel: (): Model => JSON.parse(JSON.stringify(app.model)) as Model,
    setModel: (m: Model): void => app.setModel(m),
    loadExample: (name: string): void => app.loadExample(name),
    analyze: (): AnalyzeSummary => {
      const g = app.graph();
      const count = (t: string) => g.joints.filter((j) => j.type === t).length;
      return {
        parts: app.model.parts.length,
        bodies: g.bodies.length,
        fixedBodies: g.bodies.filter((b) => b.fixed).length,
        joints: g.joints.length,
        revolute: count('revolute'),
        cylindrical: count('cylindrical'),
        prismatic: count('prismatic'),
        summary: describeGraph(g),
        bodyOfPart: Object.fromEntries(g.bodyOfPart),
        jointList: g.joints.map((j) => ({
          bodyA: j.bodyA,
          bodyB: j.bodyB,
          type: j.type,
          axis: j.axis,
          origin: [...j.origin] as V3,
          ...(j.limits ? { limits: [j.limits[0], j.limits[1]] as [number, number] } : {}),
        })),
      };
    },
    setMode: async (mode: 'edit' | 'simulate'): Promise<void> => {
      if (mode === 'simulate') await app.play();
      else app.stop();
    },
    stepSim: async (n = 1): Promise<number> => {
      if (app.mode !== 'simulate') await app.play({ paused: true });
      app.session?.stepFixed(n);
      return app.session?.time ?? 0;
    },
    setPaused: (on: boolean): void => app.setPaused(on),
    /** Joint-friction level, as if picked in the top bar (any mode). */
    setFriction: (level: FrictionLevel): void => app.setFriction(level),
    setView: (name: string): void => vp.snapTo(name, { animate: false }),
    fit: (): void => vp.fit(undefined, { animate: false }),
    home: (): void => vp.home({ animate: false }),
    camera: () => vp.getCamera(),
    /** Client position of the centre of the part's current (transformed) bounding box. */
    partScreenPos: (partId: number): { x: number; y: number } | null => {
      const b = vp.partBox(partId);
      if (!b) return null;
      const c: V3 = [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2];
      const p = vp.project(c);
      return { x: p.clientX, y: p.clientY };
    },
    /** Client position of a world point. */
    screenPos: (p: V3): { x: number; y: number } => {
      const q = vp.project(p);
      return { x: q.clientX, y: q.clientY };
    },
    /** Client position of a cell centre of a part, at its simulated pose while simulating. */
    cellScreenPos: (partId: number, cellIndex: number): { x: number; y: number } | null => {
      const c = partById(app.model, partId)?.cells[cellIndex];
      if (!c) return null;
      const p = vp.project(worldOf(partId, [c.x, c.y, c.z]));
      return { x: p.clientX, y: p.clientY };
    },
    /**
     * A client point on face `dir` of cell `cellIndex` of part `partId` where a click picks
     * exactly that (part, cell, face) and lands on the canvas, or null if there is none
     * (the face is hidden or covered). Edit mode only.
     */
    clientPosOfCellFace: (partId: number, cellIndex: number, dir: Dir): { x: number; y: number } | null => {
      const c = partById(app.model, partId)?.cells[cellIndex];
      if (!c) return null;
      const n = DIRS[dir]!;
      const a = dir >> 1;
      const t1 = [0, 0, 0] as V3;
      const t2 = [0, 0, 0] as V3;
      t1[(a + 1) % 3] = 1;
      t2[(a + 2) % 3] = 1;
      const offsets: [number, number][] = [[0, 0]];
      for (const r of [0.38, 0.2]) for (let k = 0; k < 8; k++) offsets.push([r * Math.cos((k * Math.PI) / 4), r * Math.sin((k * Math.PI) / 4)]);
      for (const [u, v] of offsets) {
        const w: V3 = [0, 1, 2].map((i) => [c.x, c.y, c.z][i]! + 0.5 * n[i]! + u * t1[i]! + v * t2[i]!) as V3;
        const p = vp.project(w);
        const x = Math.round(p.clientX * 4) / 4;
        const y = Math.round(p.clientY * 4) / 4;
        if (!p.inView || !onCanvas(x, y)) continue;
        const hit = pickCell(app.model, vp.rayAt(x, y));
        if (hit && hit.partId === partId && hit.cellIndex === cellIndex && hit.dir === dir) return { x, y };
      }
      return null;
    },
    /** A client point over the empty grid cell (x, 0, z), or null. */
    clientPosOfGrid: (gx: number, gz: number): { x: number; y: number } | null => {
      for (const [u, v] of [[0, 0], [0.2, 0.2], [-0.2, 0.2], [0.2, -0.2], [-0.2, -0.2]] as const) {
        const p = vp.project([gx + u, -0.5, gz + v]);
        if (!p.inView || !onCanvas(p.clientX, p.clientY)) continue;
        const ray = vp.rayAt(p.clientX, p.clientY);
        if (pickCell(app.model, ray)) continue;
        const g = pickGrid(ray);
        if (g && g.pos[0] === gx && g.pos[2] === gz) return { x: p.clientX, y: p.clientY };
      }
      return null;
    },
    simTransforms: (): Record<number, { p: V3; q: [number, number, number, number] } | null> => {
      const out: Record<number, { p: V3; q: [number, number, number, number] } | null> = {};
      for (const part of app.model.parts) {
        const t = app.session?.transformOf(part.id);
        out[part.id] = app.session ? (t ? { p: [...t.p] as V3, q: [...t.q] as [number, number, number, number] } : null) : { p: [0, 0, 0], q: [0, 0, 0, 1] };
      }
      return out;
    },
    simInfo: () => {
      const s = app.session;
      if (!s) return null;
      return { time: s.time, jointError: s.sim.jointError(), paused: s.paused, speed: s.sim.speed, jointFriction: s.sim.jointFriction, grabbed: s.grabbedBody, droppedSteps: s.sim.droppedSteps, stepCount: s.sim.stepCount };
    },
    getState: () => ({
      mode: app.mode,
      tool: app.tool.tool,
      newPart: app.tool.newPart,
      axisPref: app.tool.axisPref,
      color: app.tool.color,
      selection: app.selection,
      canUndo: app.history.canUndo,
      canRedo: app.history.canRedo,
      historySize: app.history.size,
      showKinematics: app.showKinematics,
      speed: app.speed,
      friction: app.friction,
      paused: app.session?.paused ?? false,
      fileName: app.fileName,
      hint: app.status.hintText,
      message: app.status.message,
      banner: app.banner.text,
      animating: vp.animating,
      slow: !(document.querySelector('[data-role=sim-slow]') as HTMLElement | null)?.hidden,
      viewport: vp.stats(),
    }),
    /** Diagnostics: wall-clock ms of n synchronous renders, each followed by gl.finish(). */
    renderTiming: (n = 3): number[] => {
      const gl = vp.renderer.getContext();
      const out: number[] = [];
      for (let i = 0; i < n; i++) {
        const t0 = performance.now();
        vp.renderNow();
        gl.finish();
        out.push(performance.now() - t0);
      }
      return out;
    },
    /** Diagnostics: frames the viewport renders in `ms` of continuous rendering. */
    frameRate: (ms = 2000): Promise<{ frames: number; ms: number }> =>
      new Promise((res) => {
        let n = 0;
        const t0 = performance.now();
        const off = vp.onFrame(() => {
          n++;
          if (performance.now() - t0 >= ms) {
            off();
            res({ frames: n, ms: performance.now() - t0 });
          }
        });
      }),
    /** Test only: make the running simulation report NaN poses (exercises the failure path). */
    injectSimFault: (): boolean => {
      const sim = app.session?.sim;
      if (!sim) return false;
      const orig = sim.partTransform.bind(sim);
      (sim as unknown as { partTransform: typeof orig }).partTransform = (id: number) => {
        const t = orig(id);
        return t && { p: [Number.NaN, t.p[1], t.p[2]], q: t.q };
      };
      return true;
    },
    flushAutosave: (): void => app.flushAutosave(),
    openText: (name: string, text: string): boolean => app.openText(name, text),
  };
  (window as unknown as { __knap: typeof api }).__knap = api;
}
