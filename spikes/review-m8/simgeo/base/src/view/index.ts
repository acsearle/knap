// =============================================================================================
// src/view — the 3D viewport (DESIGN.md §6): parts, instruction-style outlines, overlays, camera
// navigation, view cube, and pointer plumbing for the editor. three.js / WebGL2, DOM.
// =============================================================================================
//
// QUICK START
//
//   import { Viewport, jointGlyphsFromGraph } from './view';
//   const vp = await Viewport.create(containerDiv);      // awaits initGeometry(); fills the div
//   vp.setModel(model);                                   // call again after every edit (diffs)
//   vp.home({ animate: false });                          // default iso view, fitted
//   vp.onHover((e) => …e.ray…);  vp.onClick((e) => …);    // editor input (non-navigation only)
//
// The container must have a size (the canvas fills it; a ResizeObserver tracks it). The
// viewport adds `position: relative` if the container is static, a canvas, and the Home/Fit
// buttons. Everything is removed by `vp.dispose()`.
//
// ---------------------------------------------------------------------------------------------
// CONSTRUCTION
//   Viewport.create(container, opts?) : Promise<Viewport>    preferred (loads the geometry WASM)
//   new Viewport(container, opts?)                           if initGeometry() already resolved
//   opts: { background='#f7f7f5', outlineWidth=1.25 (CSS px), selectionWidth=2.5, accent='#1f7ae0',
//           keyboard=true (F = fit, Home = home, on window, ignored while typing in inputs),
//           viewCube=true, supersample='auto' (= 2 ID texels per device px at any DPR, stepping
//           down to 1.5 then 1 when a side would exceed min(8192, MAX_TEXTURE_SIZE) or the ID
//           buffer 4096² texels ≈ 335 MB), animationMs=250 }
//   readonly canvas, container, renderer;  size → { width, height, pixelRatio } (CSS px)
//   updateSize()                    read the container size now (call after attaching a container
//                                   that was created detached, before the first home() / fit())
//
// MODEL
//   setModel(model)                 Show a Model. Per-part diff: geometry is rebuilt only for parts
//                                   whose cells changed (partSignature); identical parts share one
//                                   BufferGeometry; colour / position changes are uniform updates;
//                                   removed parts are freed. Cheap to call on every edit.
//   getModel()
//   setPartColors(map | null)       Map<partId, '#rrggbb'> overrides (e.g. tint by rigid body);
//                                   null → part colours. Persists across setModel.
//   setPartVisible(id, bool), showAllParts()   (persist across setModel; e.g. bodies that fell away)
//   setPartTransform(id, p, q)      Simulation pose: world' = R(q)·world_edit + p, applied to the
//                                   part's edit-time placement (p=[0,0,0], q=[0,0,0,1] = as edited).
//                                   p: [x,y,z] | {x,y,z};  q: [x,y,z,w] | {x,y,z,w} (physics Quat).
//                                   Exactly Simulation.partTransform(partId).
//   clearTransforms()               back to the edited pose (on Stop)
//   partBox(id), modelBox()         current world AABBs (with transforms) or null
//
// OVERLAYS
//   setSelection(ids)               accent outline around the selected parts' silhouettes + slight
//                                   lightening (reads on every part colour); getSelection()
//   setHoverFace({cell:[x,y,z], dir: Dir 0..5, color?} | null)   quad on that face of the cell cube
//   setHoverCell({cell:[x,y,z], color?='#e0322b'} | null)        whole cell cube (erase tool)
//   setGhost({cell: Cell, extra?: Cell[], valid, xray?} | null)   translucent real geometry of a one-cell
//                                   sub-part (with extra: of that multi-cell new part); accent
//                                   when valid, red when not; parts of it behind geometry are fainter
//   setHoverRing({hub, axis, r0, r1, color?='#e0322b'} | null)   a band of a wheel (Erase on a rim,
//                                   Shift+Wheel): translucent annulus over its faces and tread
//   setFloor({ y } | null)          ground floor (§6.1), the same in every mode: unbounded plane at
//                                   y, a barely darker tint + a contact shadow under the parts near
//                                   it (shadow.ts / shadowmath.ts) seen from above, nothing from
//                                   below, a line edge-on; behind parts, outlines and the grid;
//                                   full-screen shader (floor.ts), so never clipped. getFloor().
//                                   groundShadowAt(x, z): the shadow's strength there (0…1, 1 =
//                                   SHADOW_MAX), read back; shadowInfo(): its render count, frame.
//                                   The shadow texture re-renders only when a pose, the model,
//                                   visibility or the floor level changed — never for the camera.
//   setGridVisible(bool)            faint grid on y = −½ (cell boundaries) + coloured axis lines
//                                   (x=0 blue, z=0 red); hide while simulating
//   setRootMarkerVisible(bool)      small ground-hatch "fixed" mark hung below an anchor cell of
//                                   the root part (effectiveRootId), chosen from the model alone
//                                   (rootmarker.ts rootAnchorIndex: lowest row, nearest its
//                                   centroid), so it never jumps; drawn on top with a halo, fainter
//                                   (MARK.faint) where another part is in front of it.
//                                   rootMarkerInfo(probe?) reports where it is (test hook).
//   setJointGlyphs(glyphs | null), setGlyphsVisible(bool)
//                                   JointGlyph = { type, origin, axis, followPartId? }; build them
//                                   with jointGlyphsFromGraph(analyze(model)). Ring = revolute,
//                                   ring + double arrow = cylindrical, double arrow = prismatic;
//                                   magenta with a white halo, drawn on top of everything. A glyph
//                                   follows the transform of followPartId (first part of body B), so
//                                   glyphs may stay on while simulating (or hide them).
//   setViewCubeVisible(bool)
//
// CAMERA  (CameraState = { target: [x,y,z], yaw, pitch, height }: radians; yaw 0 looks from +Z
//          (front), +π/2 from +X (right); pitch ∈ [−π/2, π/2], + = from above; height = visible
//          world height of the orthographic frustum. Turntable about `target` with +Y up.)
//   getCamera(), setCamera(state, {animate=true})   (state is plain JSON: persist it as is)
//                                   snapTo / fit called while a snap / fit animates compose with
//                                   that animation's end state, not its in-between frame
//   snapTo(name | ViewDir, {animate=true, keepYaw=false})
//                                   names: front back left right top bottom; edges like
//                                   'top-front', 'front-right'; corners like 'top-front-right';
//                                   alias 'iso'. Any word order. Keeps target and zoom.
//                                   keepYaw: straight top/bottom keep the current yaw rounded to
//                                   a quarter turn, ties toward yaw 0 (TOP from the iso Home view
//                                   has FRONT at the bottom). The view cube uses keepYaw.
//   home({animate})                 iso from (+X,+Y,+Z), fitted to everything
//   fit(what?, {animate})           what: undefined (= selection if any, else all) | 'all' |
//                                   'selection' | partId[] | Box3. Re-centres the orbit pivot.
//                                   Parts are framed by their transformed vertices (exact
//                                   silhouette extent, centred, 10 % margin on the limiting side);
//                                   a Box3 is framed as a box. The pivot keeps the depth of the
//                                   framed parts' box centre. Home frames the same way.
//   Resizing keeps the world rectangle last chosen (by any camera change) fully visible: a
//   narrower viewport zooms out, widening again returns to it.
//   onCameraChange(cb) → unsubscribe     called on every change, including animation frames
//   animating                       true while a snap/fit animation (≈250 ms, eased) runs
//
// NAVIGATION (built in, per §6.2): left-drag orbit (a press moving < 4 px is a click), right /
//   middle / Shift+left drag pan (content follows the pointer exactly), wheel zoom toward the
//   cursor (ctrl+wheel = trackpad pinch; Safari gesture events too), pitch clamped to ±90°.
//   View cube top-right: hover highlights face / edge strip / corner; click snaps (top/bottom keep
//   the current yaw rounded to a quarter turn); dragging on the cube orbits. Home / Fit buttons
//   beside it. Context menu suppressed on the canvas.
//
// PICKING / INPUT FOR THE EDITOR
//   rayAt(clientX, clientY) : Ray   { origin, dir }: dir unit (= view direction), origin on the
//   rayAtLocal(x, y)                camera plane in front of the whole scene, so ray parameters
//                                   t > 0 are visible points ordered front to back.
//   project(p) → { clientX, clientY, x, y, inView }   (x, y: CSS px relative to the viewport)
//   onHover(cb(e | null))           pointer moves that are not navigation; null on leave, while
//                                   over the view cube, and while a drag gesture runs
//   onClick(cb(e))                  press+release < 4 px, any button (e.button 0/1/2), never for
//                                   a press on the view cube (right/middle drags from it pan)
//   setDragHandler({ claim(press, current) → bool, move(e), end(e, cancelled) } | null)
//                                   a left press (no Shift) that moves ≥ 4 px first asks claim()
//                                   with the event at the *press* position; true → the host owns
//                                   the drag (move/end), false → it becomes an orbit. Use it to
//                                   grab bodies in simulate mode.
//   A gesture whose release is lost (lostpointercapture, a mouse move with no button held, or a
//   new mouse press while it runs) is dropped: no click, a host drag ends with cancelled = true.
//   ViewportPointerEvent = { x, y, clientX, clientY, ray, button (-1 for hover), buttons,
//                            shiftKey, ctrlKey, altKey, metaKey, pointerType }
//   Modifier-only changes (e.g. Shift pressed while hovering) produce no event: re-evaluate the
//   last hover event in your own key handler.
//
// RENDERING
//   On demand: any change calls requestRender() (one rAF, coalesced). Nothing renders while idle.
//   onFrame(cb(dtSeconds, nowMs)) → unsubscribe   per-frame callback; while any is registered the
//                                   viewport renders every frame (simulation loop: step the sim and
//                                   call setPartTransform inside it).
//   renderNow()  synchronous render;  stats() → { parts, geometries, renders, lastRenderMs, supersample }
//   dispose()                       frees GPU resources, calls forceContextLoss() (browsers cap
//                                   live contexts), removes the canvas, buttons, listeners, the
//                                   DPR media listener and the position style it added
//   A lost WebGL context is logged; on restore the viewport simply draws again (three.js
//   re-uploads). Without EXT_color_buffer_float the outline passes are skipped (warned once).
//
// LOOK (§6.1): orthographic; near-white background; per-fragment Lambert from a key light fixed to
//   the camera (up-left) + camera-relative hemisphere ambient; smooth normals; no shadows. Outlines
//   are a post-process over an ID buffer (view depth + id where id = part slot·4096 + smooth-patch
//   number, see outline.ts and patches.ts): every crease is an id change, so lines are exact at any
//   angle, never speckle on curved surfaces or in bores, and never smear at grazing angles.
//   Lines are reconstructed as a polyline through the boundary-segment midpoints and drawn with a
//   1-px anti-aliasing ramp at a uniform width (1.25 CSS px × DPR); the ID buffer is rendered at 2×
//   (see `supersample`).
//
// Pure helpers (no WebGL; unit-tested in tests/view): see ./math (camera basis, named views, fit,
// pick ray, projection, orbit/pan/zoom steps, snap interpolation).
// =============================================================================================
export { Viewport } from './viewport';
export type {
  CameraAnimOptions,
  DragHandler,
  FitTarget,
  Ghost,
  HoverCell,
  HoverFace,
  HoverRing,
  QuatLike,
  Vec3Like,
  ViewportOptions,
  ViewportPointerEvent,
} from './viewport';
export { jointGlyphsFromGraph } from './glyphs';
export { FLOOR_EDGE_Y, FLOOR_TINT, SHADOW_COLOR, floorEdgeAlpha } from './floor';
export {
  SHADOW_BLUR,
  SHADOW_H,
  SHADOW_MAX,
  SHADOW_MAX_EXTENT,
  SHADOW_TEXEL,
  SHADOW_TEX_MAX,
  fitFrame,
  gaussianKernel,
  shadowStrength,
} from './shadowmath';
export type { ShadowFrame } from './shadowmath';
export type { FloorState } from './floor';
export type { JointGlyph } from './glyphs';
export {
  VIEW_DIRS,
  VIEW_NAMES,
  cameraBasis,
  defaultCamera,
  fitBox,
  fitPoints,
  interpolateCamera,
  nearestQuarterYaw,
  orientationForDir,
  parseViewName,
  pickRay,
  projectPoint,
  viewName,
} from './math';
export type { Box3, CameraState, Ray, Vec3, ViewDir } from './math';
