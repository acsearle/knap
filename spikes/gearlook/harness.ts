// gearlook harness: the REAL Viewport (src/view) showing gear meshes injected through geomwrap.ts.
// Query: scene=pair|train|sizes|single|beam|holes  kind=involute|trapezoid|sine  treat=all|band|flat
//        chamfer=0.03  mark=1  holes=1  draw=N (fewer drawn teeth)  bandH=0.3  colors=#..,#..
//        view=home|front|side|top|iso|back  zoom=1 (×: >1 zooms in)  fallback=0  grid=1
//        sizes=0.5,1.5 (for pair)  axis=2
import Module from 'manifold-3d';
import manifoldWasmUrl from 'manifold-3d/manifold.wasm?url';
import { Viewport } from '../../src/view';
import type { Cell, Model, Part } from '../../src/core';
import type { GearEntry } from './geomwrap';

const q = new URLSearchParams(location.search);
const num = (k: string, d: number) => (q.has(k) ? Number(q.get(k)) : d);
const DEG = Math.PI / 180;
const COLORS = (q.get('colors') ?? '#e0b43c,#a8adb2,#3b74c4,#c8433a,#5f6468,#4c9a57,#e8e8e4,#e07b2e').split(',');
type G = { __gearSpecs: Map<number, GearEntry>; __gearW: unknown; __ready?: boolean; __err?: string; __setAngle?: (t: number) => void; __vp?: Viewport; __rates?: [number, number][]; __gearStats?: unknown[]; __noCreaseFallback?: boolean };
const g = globalThis as unknown as G;
g.__noCreaseFallback = q.get('fallback') === '0';

interface GearPlace { u: number; v: number; r: number; layer?: number; g?: number; color?: string; holes?: [number, number][] }

function base(): Omit<GearEntry, 'r'> {
  const kind = (q.get('kind') ?? 'involute') as GearEntry['kind'];
  return {
    kind,
    alpha: 20 * DEG,
    ha: num('ha', 3 / 32),
    hf: num('hf', 0.15625),
    backlash: num('B', 0.03),
    flankPts: num('fp', kind === 'trapezoid' ? 2 : 5),
    tipPts: num('tp', kind === 'trapezoid' ? 1 : 2),
    rootPts: num('rp', kind === 'trapezoid' ? 1 : 2),
    chamfer: num('chamfer', 0),
    bandH: q.has('bandH') ? num('bandH', 0.47) : undefined,
    bore: (q.get('bore') ?? 'axle') as GearEntry['bore'],
    mark: q.get('mark') === '1',
    markTooth: q.get('mtooth') === '1',
    treat: (q.get('treat') ?? 'all') as GearEntry['treat'],
    drawTeeth: undefined,
    underBase: (q.get('ub') ?? 'radial') as GearEntry['underBase'],
  };
}

function scene(): { gears: GearPlace[]; extra: Part[] } {
  const s = q.get('scene') ?? 'pair';
  const holesOn = q.get('holes') === '1';
  const H40: [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  const H24: [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  const hz = (r: number) => (holesOn ? (r === 2.5 ? H40 : r === 1.5 ? H24 : undefined) : undefined);
  if (s === 'single') return { gears: [{ u: 0, v: 0, r: num('r', 2.5), holes: hz(num('r', 2.5)) }], extra: [] };
  if (s === 'sizes') {
    const gs: GearPlace[] = [];
    let x = 0;
    for (const r of [0.5, 1, 1.5, 2.5]) { x += r; gs.push({ u: x, v: 0, r, holes: hz(r) }); x += r + 1; }
    return { gears: gs, extra: [] };
  }
  if (s === 'intrude') {
    // r 0.5 gear with another part's beam face-adjacent (1,0) in its layer; r 1.5 gear with a beam at
    // distance 2 (pitch circle touches the cell face); r 2.5 next to a beam at (3,1): all allowed by the
    // pitch-radius disc rule, all hit by the tips.
    const beam = (x0: number, y0: number, n: number, id: number, vertical = false): Part => ({ id, color: '#a8adb2', cells: Array.from({ length: n }, (_, i) => ({ x: x0 + (vertical ? 0 : i), y: y0 + (vertical ? i : 0), z: 0, kind: 'pinHole' as const, axis: 2 as const })) });
    return {
      gears: [{ u: 0, v: 0, r: 0.5 }, { u: 0, v: 4, r: 1.5 }, { u: 0, v: 10, r: 2.5 }],
      extra: [beam(1, -1, 3, 50, true), beam(2, 3, 3, 51, true), beam(3, 10, 3, 52, true), { id: 53, color: '#4c9a57', cells: [{ x: -4, y: 4, z: 0, kind: 'pinHole', axis: 2, rim: 2.5 }] }],
    };
  }
  if (s === 'pair') {
    const [a, b] = (q.get('sizes') ?? '0.5,1.5').split(',').map(Number) as [number, number];
    const diag = q.get('diag') === '1';
    return { gears: [{ u: 0, v: 0, r: a, holes: hz(a) }, diag ? { u: 4, v: 3, r: b, holes: hz(b), g: 0 } : { u: a + b, v: 0, r: b, holes: hz(b) }], extra: [] };
  }
  if (s === 'train' || s === 'beam') {
    // 40 – 8 – 24 – 24 – 40 along X, all meshing (3, 2, 3, 4)
    const gs: GearPlace[] = [
      { u: 0, v: 0, r: 2.5, holes: hz(2.5) },
      { u: 3, v: 0, r: 0.5 },
      { u: 5, v: 0, r: 1.5, holes: hz(1.5) },
      { u: 8, v: 0, r: 1.5, holes: hz(1.5) },
      { u: 12, v: 0, r: 2.5, holes: hz(2.5) },
    ];
    const extra: Part[] = [];
    if (s === 'beam') {
      // a 13-hole liftarm behind (layer z = −1) and an axle through each gear
      const beam: Cell[] = [];
      for (let x = 0; x <= 12; x++) beam.push({ x, y: 0, z: -1, kind: 'pinHole', axis: 2 });
      extra.push({ id: 100, color: '#a8adb2', cells: beam });
      gs.forEach((gg, i) => extra.push({ id: 101 + i, color: '#5f6468', cells: [-1, 0, 1].map((z) => ({ x: gg.u, y: 0, z, kind: 'axle' as const, axis: 2 as const })) }));
    }
    return { gears: gs, extra };
  }
  throw new Error('scene ' + s);
}

async function main(): Promise<void> {
  const w = await Module({ locateFile: () => manifoldWasmUrl });
  w.setup();
  g.__gearW = w;
  g.__gearSpecs = new Map();
  const { gears, extra } = scene();
  const b = base();
  const axis = num('axis', 2) as 0 | 1 | 2;
  const parts: Part[] = [];
  const rates: [number, number][] = [];
  // rolling rates along the chain (gear i meshes i−1 in these scenes)
  let rate = 1;
  gears.forEach((gp, i) => {
    if (i > 0) rate = -rate * gears[i - 1]!.r / gp.r;
    const N = Math.round(16 * gp.r);
    const draw = q.has('draw') ? Math.round(num('draw', N) * gp.r / 2.5) : undefined; // draw=N for the 40; others scaled
    const pos = axis === 2 ? { x: gp.u, y: gp.v, z: gp.layer ?? 0 } : axis === 0 ? { x: gp.layer ?? 0, y: gp.u, z: gp.v } : { x: gp.v, y: gp.layer ?? 0, z: gp.u };
    const id = i + 1;
    const nDraw = draw ?? N;
    const k = N / nDraw;
    const spec: GearEntry = { ...b, ha: b.ha! * k, hf: b.hf! * k, r: gp.r, drawTeeth: draw, crankHoles: gp.holes, phase: (q.get('phase0') === '1' ? 0 : -Math.PI / (2 * nDraw)) + ((gp.g ?? 0) * 2 * Math.PI) / nDraw };
    g.__gearSpecs.set(id, spec);
    parts.push({ id, color: gp.color ?? COLORS[i % COLORS.length]!, cells: [{ ...pos, kind: b.bore === 'pin' ? 'pinHole' : 'axleHole', axis }] });
    rates.push([id, rate]);
  });
  // the diagonal pair needs the phase rule's offset: g = 0.0967 each for (4,3)
  if (q.get('diag') === '1') {
    for (const id of [1, 2]) { const s = g.__gearSpecs.get(id)!; s.phase = -Math.PI / 80 + (0.0967 * 2 * Math.PI) / 40; }
  }
  parts.push(...extra);
  const model: Model = { version: 2, parts, rootPartId: extra.length ? 100 : 1, nextPartId: 200 };
  const vp = await Viewport.create(document.getElementById('vp')!, { viewCube: q.get('cube') === '1' });
  g.__vp = vp;
  vp.setModel(model);
  vp.setGridVisible(q.get('grid') !== '0');
  vp.setRootMarkerVisible(false);
  const view = q.get('view') ?? 'home';
  vp.home({ animate: false });
  if (view !== 'home') vp.snapTo(view, { animate: false });
  const cam = vp.getCamera();
  const zoom = num('zoom', 1);
  vp.setCamera({ ...cam, height: cam.height / zoom, yaw: q.has('yaw') ? num('yaw', 0) * DEG : cam.yaw, pitch: q.has('pitch') ? num('pitch', 0) * DEG : cam.pitch }, { animate: false });
  if (q.has('fitzoom')) { vp.fit('all', { animate: false }); const c2 = vp.getCamera(); vp.setCamera({ ...c2, height: c2.height / num('fitzoom', 1) }, { animate: false }); }
  g.__rates = rates;
  g.__setAngle = (theta: number) => {
    for (const [id, rt] of rates) {
      const p = parts.find((pp) => pp.id === id)!.cells[0]!;
      const a = theta * rt;
      const ax = [0, 0, 0]; ax[axis] = 1;
      const sn = Math.sin(a / 2);
      const qq: [number, number, number, number] = [ax[0]! * sn, ax[1]! * sn, ax[2]! * sn, Math.cos(a / 2)];
      // p' = R c + t = c  →  t = c − R c
      const c = [p.x, p.y, p.z];
      const ca = Math.cos(a), sa = Math.sin(a);
      const Rc = axis === 2 ? [ca * c[0]! - sa * c[1]!, sa * c[0]! + ca * c[1]!, c[2]!] : axis === 0 ? [c[0]!, ca * c[1]! - sa * c[2]!, sa * c[1]! + ca * c[2]!] : [sa * c[2]! + ca * c[0]!, c[1]!, ca * c[2]! - sa * c[0]!];
      vp.setPartTransform(id, [c[0]! - Rc[0]!, c[1]! - Rc[1]!, c[2]! - Rc[2]!], qq);
    }
    vp.renderNow();
  };
  if (q.has('angle')) g.__setAngle(num('angle', 0));
  vp.renderNow();
  g.__ready = true;
}
main().catch((e: unknown) => {
  g.__err = e instanceof Error ? (e.stack ?? e.message) : String(e);
  console.error(e);
});
