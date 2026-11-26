VERDICT. Most of the fixer's §6/§7 editor and rendering changes work in the real UI. I found two real defects and one product problem:
(a) MAJOR: beyond 128 units the shadow frame flips between two similar groups. Two copies of the Cart stood 150 apart, and the shadow jumped from one to the other 16 times in 3 s of simulated time. When they drove apart it flickered every 1–3 samples.
(b) MAJOR: Back side cannot extend an axle's far end when you look straight down the axle. The pick lands on the beam's back face, which is buried inside the axle, and shows a misleading red refusal.
(c) MINOR, a judgement call: the contrast colour on blue parts makes "valid" orange. A face on the Cart switches orange↔red when the cursor moves 6 px.
The standard suite against my build passed: E2E_NO_BUILD=1 E2E_DIST=e2e/out/review-m7-dist node e2e/run.mjs gave 16/16, under machine load of about 15–90.

METHOD. Real Playwright mouse and keyboard on my own build. I used window.__knap only to load models, set cameras and read state, shadow strength and pixels. I read the screenshots and contact sheets myself.

VERIFIED
- 1 Ground look (e2e/review-m7-look.mjs; e2e/out/review-m7-look-*-dpr{1,2}.png).
  - The shadow reads at Home on the Cart, on a beam on end, on flat beams, on plates and on Crank wheel with Ground switched on by the checkbox.
  - TOP shows a soft skirt round the wheels and chassis. Grazing 10° and 6° are continuous into the edge-on line. FRONT shows the line only.
  - Close up (height 3) it is smooth, with no banding. Grid lines still show through the shade.
  - Zoomed out ×8 the shadow is a few pixels and practically invisible. That is expected.
  - I saw no frame rectangle and no seam. Floor luminance in TOP is flat at 239 everywhere outside the skirt.
  - Not too dark anywhere. Next to a white 6×6 plate the floor luminance is 165 at 0.05 out (strength 0.36), 213 at 0.5, 230 at 1 and 239 from 2. The background is about 239.
  - Shades do not add. Two touching 1-wide parts read 0.647/0.559/0.371/0.117/0.045, and one 2-wide part reads 0.647/0.559/0.371/0.115/0.035 (MAX blending).
  - Parts are not darkened. The top/side pixels of all 8 palette beams and of the white plate are identical with the ground on and off.
  - The floor-below-grid case occurs in Crank wheel (floor −10.46): the grid floats mid-model at y = −½ (pre-existing design) and the floor shadow under the base still reads.
  - The floor can never sit exactly at the grid: the view floor is always cell − 0.46.
- 2 Cost (review-m7-shadow.mjs perf). Measured as step + render + readPixels, 8 interleaved rounds of 22 samples, load about 14–22, SwiftShader.
  - Ground on with the shadow re-rendered every frame: median 359 ms. Ground on without re-render: 344 ms. Ground off: 338 ms.
  - So the shadow pass is about 5–6 % of a frame (A/C 1.06), and the floor itself about 2 %.
  - Live simulation, 4×2 s interleaved: on/off fps ratio 1.01, at only about 3 fps absolute.
  - renderTiming with gl.finish returned 0.1 ms, so it is not a usable GPU timer here.
  - I did not build a 19-tap variant, so the 19→33 increment itself was not isolated.
- 4 Context loss/restore, real WEBGL_lose_context (review-m7-shadow.mjs ctx; e2e/out/review-m7-ctx-*.png).
  - The shadow comes back in edit mode, in a running simulation, while paused, with Ground toggled off and on while lost, with Ground turned on while lost, and after Esc stops a simulation during the loss.
  - Readback was 0.634 under the wheel each time, and the on-screen floor pixel (221) matched the value before the loss. No page errors.
- Rolling cart (review-m7-shadow.mjs roll): pushed to x = 300 with friction off.
  - Wheel-contact strength stayed between 0.582 and 0.641, and the largest sample-to-sample change was 0.027 across 53 frame re-centres. No popping.
- 7 Wheel tool on a crank hole (review-m7-editor.mjs wheel).
  - The hover says "Grow wheel · part 1 · radius 3". Click sets the hub to r 3 and the crank hole stays bare. Shift+click shrinks it back to r 2.5. Erase still says "Erase pin hole at (1, 1, 0)".
  - Holes not wholly inside the disc grow their own r 1 disc, which pokes out of the wheel: (2,1) in r 2.5, (0,2) in r 2, (1,1) in r 1.5. That is the rule as written; minor.
- 7 Inspector with a free root (Cart, parts 1 and 10). No badge. The button reads "Set as fixed root"; one click sets root = that part and Fix root on (+1 history entry). One undo restores the root to 1 and Fix root off.
- 7 Fit/Home: 7 window sizes × 3 models (Cart, 15-tall, 31-wide) × Home/Fit/Fit with a selection.
  - The model centre is always within 1 px of the centre of the area left of the panel. Never clipped left, never under the panel.
  - Worst case is the 31-wide beam at 1024×640: 60 px margin on the left, 294 px on the right, the model shrunk about 23 %. Not absurd.
  - The 234 px reserve applies even though only the 53 px-tall Model block is showing.
- 7 Out-of-view hint (review-m7-editor.mjs oov).
  - No false positive at Home, zoomed to height 1.2 on a wheel, or at height 0.6 in the air between parts.
  - It appears after a real right-drag pans the model off-screen (running, and paused without moving the mouse), clears on F, and appears again when Play starts with the model out of view.
- 6 Back-side sweep (review-m7-back.mjs sweep): Alt held, pin-hole tool, 6 views, 28 px grid.
  - Pins and axle through beams: 1807 back-face highlights, 0 with the cursor outside the highlighted face's projected square.
  - Cart: 846 highlights, 0 outside. Of 106 tread refusals, 2 came while the cursor was on a pin end in a wheel hub (the exit really is the tread; the wording "point at the wheel's flat face" is slightly off).
  - Crank wheel: not finished, see below.
- 6 Building sessions (review-m7-back.mjs build).
  - FRONT view with N, Alt+click on each of 5 holes: 5 new parts exactly behind, at z = −1. This works.
  - From Home, the same clicks build *below* the beam (−Y faces, then −Z of a cell just built). That is correct by the rule (the face is under the cursor) but not what someone adding a layer behind expects.
  - Axle far end from Home works only by hovering the hidden spot where the far end lies: the axle extends to (2,0,−2). From FRONT it fails; see the finding below.
  - Crank hole on the back of a wheel from Home: the hole lands where the ray exits the back face, not under the front spot. Cursor over virtual cell (−1,1) gives a hole at (−2,0); cursor near the hub gives an axial hole at (0,0,−1) behind the hub. The highlight shows this before the click.
  - Tread: front refusal is red with true text. Alt over the tread gives a valid back-face build on the back flat face (−Z). Consistent with "the back face under the cursor".
- 8 Flake (review-m7-flake.mjs). Replays app-files up to that step, with page instrumentation, 10 s chooser timeout.
  - Normal load: 2 failures in 65 runs (128 Meta+O presses). With 4 extra CPU burners: 0 in 25 runs.
  - With a 500 ms wait before Meta+O: 8 failures in 40 runs, so waiting makes it worse.
  - Every failure was the first Meta+O after the Open-button chooser. In every failure the window keydown fired (meta = true, target BODY, focus BODY, userActivation active) and input.click() ran synchronously with activation true. Chromium/Playwright then emitted no filechooser event.
  - The app did everything right. This is a test artefact of Playwright's intercepted chooser state; I believe a real user is very unlikely to hit it (inferred, not proven against a native dialog).
  - A fix for the test, not tried here: wait for the change event, or assert input.click() was called, rather than waiting for filechooser.

MEASURED BUT UNCERTAIN
- Overlay colours, from contact sheets e2e/out/review-m7-overlay-sheet-dpr{1,2}.png and review-m7-invalid-sheet-dpr{1,2}.png: 8 colours × 10 valid cases, plus 4 cases including real invalid ones, at DPR 1 and 2.
  - Everything is legible with the white under-stroke, and crisp at DPR 2.
  - On orange and red parts the erase/invalid colour becomes dark red (#651713). It reads as a dark outline rather than "red", and its fill is nearly invisible.
  - The "valid hint shown red" case my first script reported was a selector artefact: the screenshot review-m7-alt-valid-red-hint.png shows a black hint. Not a bug.

NOT TESTED
- The Back side sweep on Crank wheel (killed at the time limit).
- The sweep with tool 1+Alt and Erase in review-m7-overlay.mjs (timed out).
- An isolated 19-tap vs 33-tap comparison.
- A real GPU.
- Windows/Linux Ctrl+O.

Ground: would the owner now say they can see it, and is it too much? Yes. At Home, TOP and grazing views it now reads as a soft shade under wheels, chassis and flat beams. It is not too dark anywhere I looked, including white and yellow parts and wide plates. Zoomed far out it is invisible, which is fine. But a scene with two similar groups more than 128 units apart flickers (finding 1).

Back side: does it work in practice? Partly. Every highlight I measured was under the cursor (0 of 2653 outside). Building behind works from a straight-on view, and the fixed pin-in-beam case is right. But from the default isometric view "behind" usually means "below". Extending an axle's far end fails from the natural straight-on view with a misleading message, and wheel crank holes land at the exit point rather than under the cursor. An owner will need the highlight and a good view to succeed.

## [major] Shadow frame flips between two similar groups more than 128 units apart (clusterWindow ties only break on exact equality)
E2E_DIST=e2e/out/review-m7-dist node e2e/review-m7-cluster.mjs: two copies of the Cart, friction Realistic, sampled every 6 steps (12.5 ms sim) for 240 samples. Standing still 150 apart: the shadowed cart changed 16 times (runs B×11 A×10 B×7 A×15 B×19 …). Still 125 apart: 18 changes. Driving apart at ±45 u/s: 64 changes, every 1–3 samples once separation exceeded about 120 (A×2 B×1 A×3 B×1 …). Screenshots e2e/out/review-m7-cluster-flip-still150apart-{0,1}.png show the shadow on the left cart in one, the right cart in the next. Cause: candidate scores are AABB footprint areas, which change slightly as the arms swing and bodies bounce; only an exact tie keeps the previous window (shadowmath.ts clusterWindow, `c.s >= top - 1e-9*top`). The static exact tie (two identical beams 200 apart) is stable, and a small group crossing the window edge fades with no frame jump. Those cases are fine.
FIX: Add hysteresis: keep the previous window unless a candidate beats its score by a clear margin (e.g. > 10–20 % or a fixed area), and/or score groups (connected parts, or bodies) by an area that does not change as they rotate.

## [major] Back side cannot extend an axle's far end from a straight-on view: it picks the beam's back face buried inside the axle and refuses in red
e2e/review-m7-probe.mjs (iii): beam (0..4,0,0) with an axle (2,0,−1..1), FRONT view, axle tool, Alt over the axle end (and +6, +14 px). Highlight {pos:[2,0,0],dir:5} (the beam's −Z face), red hint "New part · insert axle ∥ Z into part 1 · back side (−Z) — the pin hole at (2, 0, 0) already holds an axle (part 2)". Screenshot e2e/out/review-m7-probe-axle-front-alt.png. Along that ray the axle continues to z = −1.5, so the beam's face at z = −0.5 is buried inside the axle (and is the hole opening). Yaw 15° / pitch 10° picks the neighbouring hole (1,0,0)/−Z instead. Only from Home, hovering the screen spot of the hidden far end, is (2,0,−1)/−Z picked; clicking there extends the axle to (2,0,−2) (review-m7-back.mjs build). This is the converse of the fixed case: a host face buried in the male is still a crossing.
FIX: In pickBack, treat the host's interval as part of the male's solid symmetrically: an exit from the hole part that lies inside the male's interval is no exit. The far end of the male, or the host's real outer face beyond it, should win.

## [minor] On blue parts a valid hover is orange and an invalid one red: the same face switches orange↔red as the cursor moves 6 px
review-m7-overlay.mjs sweep, Cart, Pin tool: 554 hovers, 9 colour changes, 4 with the same highlighted face (0,0,3)/+Z. review-m7-probe.mjs (i): at (320,400) over the friction pin (part 4, blue #2f63c4) the hover is valid "Extend part 4 · pin ∥ Z" with an orange frame and ghost. At (326,400) over the wheel hub (part 5) it is invalid "…already holds a pin (part 4)" with a red frame. Crops in /private/tmp/claude-501/-Users-antony-Desktop-knap-nosync/7e685b98-2385-4c25-8c1e-9d77a71d1d8f/scratchpad/verify-ui/pinpair.png; full frames e2e/out/review-m7-probe-cart-pin-{320,326}.png. The two are distinguishable side by side, but both are warm warning-like hues on a blue wheel.
FIX: Use a non-warm contrast for the accent over blue (e.g. white or cyan fill with a dark outline), so orange/red keep meaning "refused".

## [minor] Erase and invalid overlays on orange and red parts become dark red (#651713): no longer read as red, and the fill is invisible
Contact sheets e2e/out/review-m7-overlay-sheet-dpr1.png and -dpr2.png (columns 'Shift W', 'E cell', 'E wheel', orange and red rows) and e2e/out/review-m7-invalid-sheet-dpr1.png (column '4 pin on wheel', orange and red rows). Orange #e07b2e is 0.286 from red #e0322b (< 0.3), so it also switches. The white under-stroke keeps the lines visible, but they read as an outline; only the red hint text says 'erase' or 'refused'.
FIX: For a red overlay over red or orange, use a high-contrast but still clearly 'erase' treatment (e.g. white fill with a red dashed or thick outline), not a darkened red.

## [minor] From the default view, Back side 'behind' usually builds below, and wheel crank holes land at the back exit point rather than under the cursor
review-m7-back.mjs build (a): Home view, Alt+1 on the five front holes of a beam built cells at (-1,0,0), (0,-1,0), (2,-1,0), (3,-1,0), (3,-1,-1) (faces −X, −Y, −Y, −Y, −Z), not z = −1. FRONT view gives 5 cells at z = −1 as intended (a2). (c): wheel r 2.5, Alt+1 over front virtual cell (−1,1) builds the hole at (−2,0,0); over (1,1) it builds an axial hole (0,0,−1) behind the hub. All 846+1807 sweep highlights had the cursor inside the highlighted face (0 outside), so this follows the rule 'back face under the cursor'. It is a usability matter, not a pick bug. Screenshot e2e/out/review-m7-back-layer.png.
FIX: Consider a hint when the back face is not opposite the front face (e.g. 'back side: bottom (−Y) — use a straight view to build directly behind'), or snap the view on B.

## [minor] Wheel tool on a crank hole near the rim still grows a second disc that pokes out of the wheel
review-m7-editor.mjs wheel: the hole (1,1) inside r 2.5 correctly acts on the hub (r 3, then Shift back to 2.5). But hole (2,1) in r 2.5, (0,2) in r 2, (2,2) in r 2.5 and (1,1) in r 1.5 all hover 'Grow wheel · part 1 · radius 1 (16 mm across)'. These are valid crank holes (rimBridges joins them) that are not wholly inside the disc.
FIX: Apply the enclosing-wheel rule when the hole centre is inside the disc, or refuse with a hint.

## [nit] The tread-refusal text appears when the cursor is on a pin end (Alt), and the hover text is clipped at 1280
review-m7-back.mjs sweep, Cart: 2 of 106 tread refusals were on 'Part 2 · pin ∥ Z at (0, 0, -1) · in pin hole (part 3)' (views 120/30, 60/−30): the back exit really is the wheel's tread, but the hint says 'point at the wheel's flat face'. e2e/out/review-m7-back-tread.png: the status hover reads 'Part 1 · wheel radius 2.5 ∥ Z, hub (0, 0, 0) · tre…' at 1280 wide.
FIX: None

## [nit] app-files Meta+O flake is a test artefact: the app handles the key and calls input.click() with user activation, but no filechooser is emitted
e2e/review-m7-flake.mjs: 105 replays of the app-files sequence. Normal load: 2 failures in 65 runs. With 4 extra CPU burners: 0 in 25. With a 500 ms wait before Meta+O: 8 in 40. Every failure was the first Meta+O after the button-opened chooser. Diagnostics in each: keydown o meta=true act=true target=BODY focus=BODY, then input.click act=true at the same millisecond, then no chooser for 10 s. Screenshots e2e/out/review-m7-flake-fail-*.png.
FIX: In the test, do not rely on Playwright's filechooser after an earlier intercepted chooser: assert that input.click ran, or set files on the [data-role=open-file] input with setInputFiles. Optionally create a fresh <input type=file> per open in files.ts.

