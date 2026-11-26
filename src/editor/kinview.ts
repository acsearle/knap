// Presentation helpers for the "Show kinematics" overlay and status counts (DESIGN.md §7.4). Pure.
import { analyze, describeGraph } from '../core/kinematics';
import type { KinematicGraph } from '../core/kinematics';
import { gearMeshes } from '../core';
import type { Axis, Model } from '../core';

/** Tint of the fixed body (neutral grey). */
export const FIXED_BODY_TINT = '#8c9196';

function hslToHex(h: number, s: number, l: number): string {
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  const hex = (x: number) => Math.round(x * 255).toString(16).padStart(2, '0');
  return `#${hex(f(0))}${hex(f(8))}${hex(f(4))}`;
}

/**
 * Tint for a moving body: a function of the body id only (stable for a given analysis), hues
 * spaced by the golden angle from a warm start so consecutive ids differ strongly, with two
 * alternating lightness levels; saturated enough never to read as the fixed grey.
 */
export function bodyTint(bodyId: number, fixed = false): string {
  if (fixed) return FIXED_BODY_TINT;
  const h = (20 + bodyId * 137.50776405) % 360;
  const l = bodyId % 2 === 0 ? 0.55 : 0.45;
  return hslToHex(h, 0.65, l);
}

/** part id → overlay tint, for every part in the graph. */
export function partTints(graph: KinematicGraph): Map<number, string> {
  const fixed = new Map(graph.bodies.map((b) => [b.id, b.fixed]));
  const out = new Map<number, string>();
  for (const [partId, bodyId] of graph.bodyOfPart) out.set(partId, bodyTint(bodyId, fixed.get(bodyId) ?? false));
  return out;
}

/**
 * One-line status summary (§7.4 counts): "8 parts · 4 bodies (1 fixed) · 4 joints: 4 revolute";
 * with a free root (§2.6, no body fixed) "… 4 bodies (none fixed) …".
 * `graph` defaults to analyze(model); the model must be valid.
 */
export function kinematicsSummary(model: Model, graph: KinematicGraph = analyze(model)): string {
  const n = model.parts.length;
  const parts = `${n} ${n === 1 ? 'part' : 'parts'}`;
  if (n === 0) return parts;
  const g = describeGraph(graph);
  return `${parts} · ${graph.bodies.some((b) => b.fixed) ? g : g.replace('(0 fixed)', '(none fixed)')}`;
}

/**
 * One "Show kinematics" glyph per gear mesh (§7.4: "Each gear mesh gets a small glyph at its pitch
 * point"), one per core gearMeshes entry. `pitch` is the edit-time pitch point
 * hubA + (hubB − hubA)·rA/(rA + rB); the hubs, pitch radii and axis let the view draw the two ticks
 * and follow both gears' parts (followA / followB) while simulating. Structurally the view's MeshGlyph.
 */
export interface MeshGlyphSpec {
  hubA: readonly [number, number, number];
  hubB: readonly [number, number, number];
  rA: number;
  rB: number;
  axis: Axis;
  followA: number;
  followB: number;
  pitch: readonly [number, number, number];
}

export function meshGlyphSpecs(model: Model): MeshGlyphSpec[] {
  return gearMeshes(model).map((g) => {
    const A = [g.a.cell.x, g.a.cell.y, g.a.cell.z] as const;
    const B = [g.b.cell.x, g.b.cell.y, g.b.cell.z] as const;
    const rA = g.a.cell.rim!;
    const rB = g.b.cell.rim!;
    const f = rA / (rA + rB);
    return {
      hubA: A,
      hubB: B,
      rA,
      rB,
      axis: g.axis,
      followA: g.a.partId,
      followB: g.b.partId,
      pitch: [A[0] + (B[0] - A[0]) * f, A[1] + (B[1] - A[1]) * f, A[2] + (B[2] - A[2]) * f] as const,
    };
  });
}
