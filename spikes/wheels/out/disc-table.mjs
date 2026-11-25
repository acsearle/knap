// spikes/wheels/disc.ts
function checkDisc(d) {
  if (!(d.r > 0) || !Number.isInteger(d.r * 2)) throw new Error(`disc radius must be a positive multiple of 0.5 (got ${d.r})`);
  if (!d.c.every(Number.isInteger)) throw new Error("disc hub must be an integer cell");
}
function planeAxes(a) {
  return [(a + 1) % 3, (a + 2) % 3];
}
function discCell(d, p) {
  checkDisc(d);
  if (p[d.axis] !== d.c[d.axis]) return "none";
  const [u, v] = planeAxes(d.axis);
  const du = Math.abs(p[u] - d.c[u]);
  const dv = Math.abs(p[v] - d.c[v]);
  const r2 = d.r * d.r;
  const near2 = Math.max(0, du - 0.5) ** 2 + Math.max(0, dv - 0.5) ** 2;
  if (near2 > r2) return "none";
  if (near2 === r2) return "touch";
  const far2 = (du + 0.5) ** 2 + (dv + 0.5) ** 2;
  return far2 <= r2 ? "full" : "partial";
}
function coveredOffsets(r) {
  const full = [];
  const partial = [];
  const n = Math.ceil(r + 0.5);
  for (let du = -n; du <= n; du++)
    for (let dv = -n; dv <= n; dv++) {
      if (du === 0 && dv === 0) continue;
      const c = discCell({ c: [0, 0, 0], axis: 2, r }, [du, dv, 0]);
      if (c === "full") full.push([du, dv]);
      else if (c === "partial") partial.push([du, dv]);
    }
  return { full, partial };
}

// spikes/wheels/disc-table.ts
var fmtList = (l) => {
  const q = l.filter(([u, v]) => u >= 0 && v >= 0 && u >= v);
  return q.map(([u, v]) => `(${u},${v})`).join(" ");
};
console.log("r	hub	#full	#partial	full (octant u\u2265v\u22650)	partial (octant)	touch (octant)");
for (const r of [0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4]) {
  const c = coveredOffsets(r);
  const touch = [];
  for (let u = 0; u <= 5; u++) for (let v = 0; v <= u; v++) if (discCell({ c: [0, 0, 0], axis: 2, r }, [u, v, 0]) === "touch") touch.push([u, v]);
  console.log([r, discCell({ c: [0, 0, 0], axis: 2, r }, [0, 0, 0]), c.full.length, c.partial.length, fmtList(c.full), fmtList(c.partial), fmtList(touch)].join("	"));
}
