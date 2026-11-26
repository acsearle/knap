// Mutations of colliderSpecs to check the builder's comparison has teeth. MUT selects one; each is
// applied to ONE spec per part (the first that fits), only for parts with a wheel or gear (MUT_ALL=1: every part).
import { vi } from 'vitest';
vi.mock('../../../src/physics/shapes', async (orig) => {
  const m = (await orig()) as typeof import('../../../src/physics/shapes');
  const MUT = process.env.MUT ?? '';
  const colliderSpecs: typeof m.colliderSpecs = (part, seg, ground) => {
    const out = m.colliderSpecs(part, seg, ground);
    if (!MUT) return out;
    const i = (pred: (s: (typeof out)[number]) => boolean) => out.findIndex(pred);
    let k = -1;
    switch (MUT) {
      case 'drop-guard': k = i((s) => s.role === 'guard'); if (k >= 0) out.splice(k, 1); break;
      case 'drop-part': k = i((s) => s.role === 'part'); if (k >= 0) out.splice(k, 1); break;
      case 'shift-part-0.01': k = i((s) => s.role === 'part'); if (k >= 0) { const s = out[k]!.shape; if (s.type === 'hull') s.points = s.points.map((p) => [p[0] + 0.01, p[1], p[2]]); else if (s.type === 'box') s.center[0] += 0.01; } break;
      case 'shift-hull-0.01': k = i((s) => s.role === 'hull'); if (k >= 0) { const s = out[k]!.shape; if (s.type === 'hull') s.points = s.points.map((p) => [p[0], p[1] + 0.01, p[2]]); } break;
      case 'shift-round-0.01': k = i((s) => s.role === 'round'); if (k >= 0) { const s = out[k]!.shape; if (s.type === 'cylinder') s.center[2] += 0.01; } break;
      case 'role-hull-as-part': k = i((s) => s.role === 'hull'); if (k >= 0) out[k]!.role = 'part'; break;
      case 'role-guard-as-hull': k = i((s) => s.role === 'guard'); if (k >= 0) out[k]!.role = 'hull'; break;
      case 'gear-flag-lost': k = i((s) => s.gear === true && s.role === 'round'); if (k >= 0) delete out[k]!.gear; break;
      case 'extra-interior-point': k = i((s) => s.shape.type === 'hull'); if (k >= 0) { const s = out[k]!.shape; if (s.type === 'hull') { const c = s.points.reduce((a, p) => [a[0] + p[0] / s.points.length, a[1] + p[1] / s.points.length, a[2] + p[2] / s.points.length], [0, 0, 0]); s.points.push(c as [number, number, number]); } } break;
      case 'bevel-lost': k = i((s) => s.role === 'part' && s.shape.type === 'hull'); if (k >= 0) { const s = out[k]!.shape; if (s.type === 'hull') { const ax = [0, 1, 2]; // flatten: snap every coordinate within 0.011 of the max/min on each axis to it
          for (const a of ax) { const mx = Math.max(...s.points.map((p) => p[a]!)); const mn = Math.min(...s.points.map((p) => p[a]!)); for (const p of s.points) { if (mx - p[a]! < 0.0101 && mx - p[a]! > 0) p[a] = mx; if (p[a]! - mn < 0.0101 && p[a]! - mn > 0) p[a] = mn; } } } } break;
    }
    return out;
  };
  return { ...m, colliderSpecs };
});
