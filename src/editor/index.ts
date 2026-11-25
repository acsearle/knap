// knap editor logic (DESIGN.md §7). Pure TypeScript: no DOM, three.js or rendering. Imports only
// src/core and src/geometry/dims. Every function is pure (models in, new models out) except the
// History class, which holds the session's model stack.
//
// =============================================================================================
// WIRING OVERVIEW (for the integrator)
// =============================================================================================
//
// Per pointer move in Edit mode:
//   const ray  = { origin, dir }                       // world ray under the cursor (view's camera)
//   const hit  = pickCell(model, ray)                  // PickHit | null
//   const grid = hit ? null : pickGrid(ray)            // GridHit | null (only "empty space")
//   hoverInfo  = describeHover(model, hit, grid)     // status bar "hover info" (§7.4)
//   switch (toolState.tool) {
//     case 'select': resolveSelect(model, hit)        // { partId | null, description }
//     case 'erase':  resolveErase(model, hit)         // red highlight of hit cell, description
//     default:       proposal = resolveBuild(model, hit, grid, withShift(toolState, ev.shiftKey))
//                    // draw proposal.cell as a ghost in proposal.ghostColor (red when !valid),
//                    // tint proposal.highlight face, show proposal.description (+ orientationHint,
//                    // + shiftHint when non-empty)
//   }
// Re-resolve the hover on every pointer move AND on every model change (history.onChange: undo,
// redo, open, …) and on every tool-state / Shift change. A proposal is bound to the model it was
// resolved against (proposal.baseModel); apply(current) throws STALE_PROPOSAL for any other model.
// On click: if (proposal.valid) { const { model: m2, partId } = proposal.apply(history.current);
//           history.push(m2) } else show proposal.reason. (Erase: history.push(erase.apply(history.current)).)
// [R]:      toolState = cycleOrientation(toolState, proposal); then re-resolve the hover.
//           Passing the withShift(...) state is safe: every state function drops a Shift-induced
//           newPart (ToolState.shiftHeld), so Shift never latches the "New part" toggle on.
// [N]:      toolState = setNewPart(toolState, !toolState.newPart).
// [1]-[5], [V], [E], Esc: toolState = selectTool(toolState, TOOL_KEYS[key.toLowerCase()]).
// Palette swatch: toolState = pickColor(toolState, '#rrggbb').
//
// In Simulate mode (grabbing): pickCell(model, ray, { transform: (id) => sim.partTransform(id) })
// with the *edit-time* model; the hit's `point` is world space (for grab), `localPoint` is in the
// edit-time frame, `partId` maps to a body via sim.graph.bodyOfPart.
//
// Selection (Select tool, a part selected), `cam` = { right, up, forward } world vectors of the
// camera (forward = view direction, into the screen):
//   arrows / PageUp / PageDown: moveSelection(model, id, moveDelta(cam, moveKeyOf(ev.key)!))
//   '[' / ']':                  rotateSelection(model, id, cam, key)
//   Delete / Backspace:         deleteSelection(model, id)
//   Duplicate button:           duplicateSelection(model, id)   (result.partId = the copy)
//   inspector:                  partInfo(model, id, effectiveRootId(model))
// Each returns OpResult: { ok: true, model, message?, partId? } → history.push(model), select
// partId if given (it is undefined after delete); { ok: false, message } → status bar.
//
// Undo/redo: new History(initialModel(localStorage).model); history.push / undo / redo /
// canUndo / canRedo / reset (New, Open, Examples) / onChange(listener) (e.g. to autosave and
// re-render). Pushing the current model again is a no-op.
// Files: parseModelFile(text) (Open…), modelFileText(model) + suggestFileName(name) (Save),
// autosave(localStorage, model) after each change, restoreAutosave(localStorage) on load.
// Show kinematics: const g = analyze(model); partTints(g) (part id → '#rrggbb'),
// kinematicsSummary(model, g) for the status bar ("8 parts · 4 bodies (1 fixed) · 4 joints: 4 revolute").
//
// =============================================================================================
// PICKING (picking.ts)
// =============================================================================================
// pickCell(model, ray, opts?) → PickHit | null — nearest hit of origin + t·dir (t >= 0) with the
// unit cubes of all cells. The PickHit gives partId, cellIndex, cell, pos, dir (face ENTERED:
// the ray came from pos + DIRS[dir]), t, point (world), localPoint (edit-time frame), normal
// (world), inside (ray origin inside the cube; then t = 0 and dir is the face whose slab bounds
// the entry of the infinite line). Shared cells (male of part A in a hole of part B): the male
// wins iff the ray enters through an axial face (normal ∥ axis) strictly within R_ROD of the axis;
// otherwise the hole. Rays that only touch an edge or corner miss; a ray lying exactly in a face
// plane counts as inside that slab. Ties in t: lower part id, then lower cell index.
// opts.transform(partId) → { p, q } | null: part placement in simulation (null = skip part);
// opts.filter(part) → boolean: rejected parts are never returned; a male whose hole partner is
// rejected is picked through its own cube. A ray entering exactly through a cube edge or corner
// (tied slabs) reports the first tied face whose neighbour cell is empty (edit-time frame).
// pickGrid(ray) → GridHit | null — plane y = −½; pos = [round(x), 0, round(z)] (halves round up);
// null if parallel or behind; dir = 2 from above, 3 from below.
//
// =============================================================================================
// BUILD RESOLUTION (tools.ts) — §7.3
// =============================================================================================
// resolveBuild(model, pick, grid, state) → Proposal. pick (any { partId, cellIndex, dir }) wins
// over grid. For hover on cell C of part P through face n (T = C + n):
//   without newPart:  Extend (add to P at T) → Insert → Sleeve
//   with newPart:     Insert → Sleeve → New adjacent (new part at T)
//   no cell, grid:    New on grid (new part at [x, 0, z])
// The first action with at least one valid orientation wins. Insert is considered only for a male
// tool on a hole C entered through an axial face; Sleeve only for a hole tool on a male C (any
// face). If none is valid, the proposal is the most relevant invalid one (Insert/Sleeve if
// considered, else Extend/New adjacent), with `reason` from canAddCell / shareResult or a precise
// precondition message ("the pin hole at (1, 0, 0) already holds a pin (part 4)").
//
// Insert joining (DEVIATION, see docs/DEVIATIONS.md §7): without newPart, if the cell behind the
// hole (C − n, the far side from the viewer) holds a coaxial male of a part other than P, the
// inserted male is added to THAT part (proposal.joins = true, targetPartId = that part,
// createsPart = false) instead of starting a new one. Cube picking can never extend into a cell
// whose cube is occupied, so without this a pin could never be pushed through a second,
// already-placed hole and closed loops (four-bars) could not be built. With newPart (Shift / [N])
// Insert always makes a new part.
//
// Orientation candidates, natural default first (then the remaining axes cyclically):
//   male tool, Extend / New adjacent: ∥ n;  hole tool: C's axis if C is a hole, else X, Y, Z order;
//   Insert / Sleeve: the hole's / rod's axis only;  New on grid: Y first (both classes: holes
//   lying flat on the grid, rods standing on it), then Z, X.
//   If T already holds exactly one cell of another part of the opposite class (male for a hole
//   tool or vice versa), its axis is moved to the front (coaxial preference).
// proposal.options = the valid candidates in that order.
// Note: with cube picking, T = C + n is crossed by the ray before C, so T never holds another
// part's cell on a real hover; the coaxial preference above only shows when resolveBuild is
// called with a synthetic pick. (The Insert-join rule is what handles "the target is occupied".)
//
// ORIENTATION CYCLING RULE. The cycling state is ToolState.axisPref: Axis | null (an axis, not an
// index). For every hover the ghost's axis is axisPref if axisPref ∈ options, else options[0]
// (the natural default). [R] = cycleOrientation(state, proposal) sets axisPref to the option
// after the one currently shown (wrapping); no-op with < 2 options. So when the set of valid
// orientations changes between hovers, the choice maps by axis identity: the same world axis is
// kept wherever it is valid and the natural default is used where it is not, without forgetting
// the preference. selectTool(state, otherTool) resets axisPref to null (the same tool keeps it).
//
// Colours: new parts get newPartColor(state, kind): hole kinds → state.color (current palette
// colour); male kinds → the kind default (axle grey, pin tan, friction pin blue) unless the user
// picked a swatch since the current tool was selected (state.colorPicked, set by pickColor,
// cleared by selectTool to another tool).
//
// Proposal fields: baseModel, action, valid, reason?, cell (ghost incl. axis; null for 'none'),
// targetPartId? (part receiving the cell when no new part is created), hoverPartId?, joins,
// createsPart, color (of a new part, else null), ghostColor (receiving part's colour for extend /
// join, else the new part's colour; '' for 'none'), highlight { pos, dir } (hovered face; for New
// on grid the −Y face of the grid cell), description (status-bar sentence; invalid:
// "<what> — <reason>"), options, orientationHint ("[R] 2/3" or ''), shiftHint (without newPart:
// "Shift: <description>" when Shift would do a different valid thing, else ''),
// apply(current) → { model, partId } (throws if invalid or current !== baseModel).
//
// resolveErase(model, pick) → { baseModel, valid, partId, cellIndex, cell, highlight, description,
//   pieces, apply(current) → Model } — pieces 0 = part removed, 1 = shrinks, ≥2 = splits.
// resolveSelect(model, pick) → { partId | null, description }.
// describeHover(model, pick, grid) → "Part 3 · pin hole ∥ Z at (1, 0, 0) · holds pin (part 4)" /
//   "Grid (2, 0, -1)" / ''.
//
// Assumes the model is valid (validateModel(m) = []), as every model produced by core is.

export * from './picking';
export * from './tools';
export * from './selection';
export * from './history';
export * from './persistence';
export * from './kinview';
