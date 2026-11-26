// Independent brute-force re-statement of DESIGN §3.1 for models made only of pin holes and smooth
// pins (every mate revolute, no welds, no slide limits), including the free-pin "connector" lines
// (a pin's line joins every pair of bodies it passes through) that DEVIATIONS documents.
import { effectiveRootId, rootIsFixed } from '../../src/core/model';
import type { Model } from '../../src/core/types';

export interface BruteResult {
  /** body of each part, as the lowest part id in it */
  rep: Map<number, number>;
  fixedRep: number | null;
  /** revolute joints between reps: "a,b|lineKey" */
  joints: Set<string>;
}

export function bruteAnalyze(m: Model): BruteResult {
  const parts = [...m.parts].sort((a, b) => a.id - b.id);
  const root = effectiveRootId(m);
  const fixedRoot = rootIsFixed(m);
  const holeAt = new Map<string, number>();
  const maleAt = new Map<string, number[]>();
  for (const p of parts)
    for (const c of p.cells) {
      const k = `${c.x},${c.y},${c.z}`;
      if (c.kind === 'pinHole') holeAt.set(k, p.id);
      else (maleAt.get(k) ?? maleAt.set(k, []).get(k)!).push(p.id);
    }
  const mates: { male: number; hole: number; line: string }[] = [];
  for (const [k, ms] of maleAt) {
    const h = holeAt.get(k);
    if (h === undefined) continue;
    const [x, y] = k.split(',');
    for (const male of ms) if (male !== h) mates.push({ male, hole: h, line: `${x},${y}` });
  }
  const parent = new Map<number, number>(parts.map((p) => [p.id, p.id]));
  const find = (x: number): number => (parent.get(x) === x ? x : find(parent.get(x)!));
  const union = (a: number, b: number): boolean => {
    const ra = find(a);
    const rb = find(b);
    if (ra === rb) return false;
    parent.set(Math.max(ra, rb), Math.min(ra, rb));
    return true;
  };
  const members = (r: number) => parts.filter((p) => find(p.id) === r);
  const cellCount = (r: number) => members(r).reduce((s, p) => s + p.cells.length, 0);
  const straightPin = (pid: number) => {
    const cs = parts.find((p) => p.id === pid)!.cells;
    return cs.every((c) => c.kind === 'pin' && c.axis === cs[0]!.axis && c.x === cs[0]!.x && c.y === cs[0]!.y);
  };
  const connectors = new Set<number>();
  let joints = new Set<string>();
  for (let it = 0; it < 100; it++) {
    let changed = false;
    for (const p of parts) {
      if (members(find(p.id)).length !== 1 || !straightPin(p.id)) continue;
      const ms = mates.filter((x) => x.male === p.id && find(x.hole) !== find(p.id));
      if (ms.length === 0) continue;
      connectors.add(p.id);
      if (p.id === root && fixedRoot) continue;
      const targets = [...new Set(ms.map((x) => find(x.hole)))].sort((a, b) => a - b);
      let best: number;
      if (root !== null && targets.includes(find(root))) best = find(root);
      else {
        best = targets[0]!;
        for (const t of targets) if (cellCount(t) > cellCount(best)) best = t;
      }
      union(p.id, best);
      changed = true;
    }
    const lines = new Map<string, Set<string>>();
    const real = new Set<string>();
    const add = (a: number, b: number, line: string, isReal: boolean) => {
      const k = `${Math.min(a, b)},${Math.max(a, b)}`;
      (lines.get(k) ?? lines.set(k, new Set()).get(k)!).add(line);
      if (isReal) real.add(k);
    };
    for (const x of mates) if (find(x.male) !== find(x.hole)) add(find(x.male), find(x.hole), x.line, true);
    for (const pid of connectors) {
      const own = find(pid);
      const others = [...new Set(mates.filter((x) => x.male === pid).map((x) => find(x.hole)).filter((r) => r !== own))];
      const c0 = parts.find((p) => p.id === pid)!.cells[0]!;
      for (let i = 0; i < others.length; i++) for (let j = i + 1; j < others.length; j++) add(others[i]!, others[j]!, `${c0.x},${c0.y}`, false);
    }
    joints = new Set();
    for (const [k, ls] of lines) {
      const [a, b] = k.split(',').map(Number);
      if (ls.size >= 2) {
        if (union(a!, b!)) changed = true;
      } else if (real.has(k)) joints.add(`${k}|${[...ls][0]}`);
    }
    if (!changed) break;
  }
  const rep = new Map(parts.map((p) => [p.id, find(p.id)]));
  return { rep, fixedRep: root !== null && fixedRoot ? find(root) : null, joints };
}
