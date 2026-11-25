// REVIEW copy of geom-gallery-page.ts using review-geom-catalog.ts. Self-contained geometry gallery (not the app renderer): every catalogue part in a labelled
// grid, plain three.js, orthographic, Lambert + headlight, optional crease edges.
// Query: ?view=iso|back|front|top|side  &tile=240  &cols=6  &only=name1,name2  &edges=0
import * as THREE from 'three';
import { buildPartMesh, initGeometry } from '../src/geometry';
import { CATALOG } from './review-geom-catalog';

declare global {
  interface Window {
    __galleryReady?: boolean;
    __galleryError?: string;
    __galleryStats?: { name: string; triangles: number; vertices: number; ms: number }[];
  }
}

const q = new URLSearchParams(location.search);
const view = q.get('view') ?? 'iso';
const tile = Number(q.get('tile') ?? 240);
const only = q.get('only')?.split(',');
const showEdges = q.get('edges') !== '0';
const entries = only ? CATALOG.filter((e) => only.includes(e.name)) : CATALOG;
const cols = Math.min(Number(q.get('cols') ?? 6), entries.length);
const LABEL = 34;

const DIRS: Record<string, [number, number, number]> = {
  iso: [1, 1, 1],
  back: [-1, 0.75, -1.25],
  front: [0, 0, 1],
  top: [0, 1, 0.0001],
  side: [1, 0.25, 0],
  under: [0.6, -1, 0.8],
  oblique: [0.45, 0.55, 1],
};

async function main(): Promise<void> {
  await initGeometry();
  const rows = Math.ceil(entries.length / cols);
  const W = cols * tile;
  const Hh = rows * (tile + LABEL);
  const wrap = document.getElementById('wrap')!;
  wrap.style.width = `${W}px`;
  wrap.style.height = `${Hh}px`;
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setSize(W, Hh);
  renderer.setClearColor(0xf7f7f5, 1);
  renderer.setScissorTest(true);
  wrap.append(renderer.domElement);
  renderer.setScissor(0, 0, W, Hh);
  renderer.setViewport(0, 0, W, Hh);
  renderer.clear();

  const dir = new THREE.Vector3(...(DIRS[view] ?? DIRS.iso!)).normalize();
  const stats: NonNullable<Window['__galleryStats']> = [];

  entries.forEach((e, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const t0 = performance.now();
    const md = buildPartMesh(e.part);
    const ms = performance.now() - t0;
    stats.push({ name: e.name, triangles: md.indices.length / 3, vertices: md.positions.length / 3, ms });

    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(md.positions, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(md.normals, 3));
    g.setIndex(new THREE.BufferAttribute(md.indices, 1));
    g.computeBoundingSphere();
    g.computeBoundingBox();

    const scene = new THREE.Scene();
    const mat = new THREE.MeshLambertMaterial({
      color: e.part.color,
      polygonOffset: true,
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 1,
    });
    scene.add(new THREE.Mesh(g, mat));
    if (showEdges) {
      const lines = new THREE.LineSegments(new THREE.EdgesGeometry(g, 35), new THREE.LineBasicMaterial({ color: 0x262626 }));
      scene.add(lines);
    }
    const center = new THREE.Vector3();
    g.boundingBox!.getCenter(center);
    const r = g.boundingSphere!.radius * 1.08;
    const aspect = tile / (tile + 0.0001);
    const cam = new THREE.OrthographicCamera(-r * aspect, r * aspect, r, -r, 0.01, 100);
    cam.position.copy(center).addScaledVector(dir, 20);
    cam.up.set(0, 1, 0);
    if (Math.abs(dir.y) > 0.99) cam.up.set(0, 0, -1);
    cam.lookAt(center);
    scene.add(cam);
    scene.add(new THREE.HemisphereLight(0xffffff, 0x8a8a8a, 1.6));
    const key = new THREE.DirectionalLight(0xffffff, 2.0);
    key.position.set(-0.6, 0.9, 1); // camera-relative: up-left headlight
    cam.add(key);
    cam.add(key.target);
    key.target.position.set(0, 0, -1);

    const x = col * tile;
    const yTop = row * (tile + LABEL);
    const yGl = Hh - yTop - tile; // GL origin bottom-left
    renderer.setScissor(x, yGl, tile, tile);
    renderer.setViewport(x, yGl, tile, tile);
    renderer.render(scene, cam);

    const label = document.createElement('div');
    label.className = 'label';
    label.style.left = `${x}px`;
    label.style.top = `${yTop + tile}px`;
    label.style.width = `${tile}px`;
    label.innerHTML = `${e.name}<br><small>${md.indices.length / 3} tri · ${ms.toFixed(1)} ms</small>`;
    wrap.append(label);
  });
  window.__galleryStats = stats;
  window.__galleryReady = true;
}

main().catch((err: unknown) => {
  window.__galleryError = err instanceof Error ? (err.stack ?? err.message) : String(err);
  console.error(err);
});
