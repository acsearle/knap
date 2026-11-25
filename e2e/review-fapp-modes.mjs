// Review fapp: the level in every mode, persistence, no model/undo/file side effects.
import { readFile } from 'node:fs/promises';
import { harness, check, ev, stepN } from './review-fapp-lib.mjs';
import { frames, press, state, status } from './app-lib.mjs';

const h = await harness();
const mu = (p) => ev(p, () => window.__knap.simInfo()?.jointFriction ?? null);
try {
  {
    const c = await h.open('fapp-modes');
    const p = c.page;
    // edit-mode change -> Play
    await press(p, '[data-friction=low]');
    await press(p, '[data-action=play]');
    await p.waitForFunction(() => window.__knap.getState().mode === 'simulate', null, { timeout: 60000 });
    check('edit Low -> Play runs at 0.05', (await mu(p)) === 0.05, await mu(p));
    // while running
    await press(p, '[data-friction=off]');
    check('running -> Off: mu 0', (await mu(p)) === 0, await mu(p));
    // paused then Step
    await press(p, '[data-action=pause]');
    await press(p, '[data-friction=realistic]');
    const t0 = (await ev(p, () => window.__knap.simInfo())).time;
    await press(p, '[data-action=step]');
    const si = await ev(p, () => window.__knap.simInfo());
    check('paused -> Real -> Step: mu 0.2 and time advances', si.jointFriction === 0.2 && si.time > t0, { t0, t1: si.time, mu: si.jointFriction });
    // Stop -> Play keeps
    await press(p, '[data-action=stop]');
    check('after Stop level is realistic', (await state(p)).friction === 'realistic');
    await press(p, '[data-friction=off]');
    await press(p, '[data-action=play]');
    await p.waitForFunction(() => window.__knap.getState().mode === 'simulate', null, { timeout: 60000 });
    check('Stop, pick Off, Play: mu 0', (await mu(p)) === 0, await mu(p));
    await press(p, '[data-action=stop]');

    // 'starting' window: click Play then immediately a level with the real mouse (no waiting)
    for (const lvl of ['realistic', 'low']) {
      const playBox = await p.locator('[data-action=play]').boundingBox();
      const lvBox = await p.locator(`[data-friction=${lvl}]`).boundingBox();
      await p.mouse.click(playBox.x + playBox.width / 2, playBox.y + playBox.height / 2);
      const modeAtClick = (await state(p)).mode;
      await p.mouse.click(lvBox.x + lvBox.width / 2, lvBox.y + lvBox.height / 2);
      await p.waitForFunction(() => window.__knap.getState().mode === 'simulate', null, { timeout: 60000 });
      const st = await state(p);
      const marked = await ev(p, () => Array.from(document.querySelectorAll('[data-friction].on')).map((b) => b.dataset.friction));
      check(`starting window click ${lvl}: session mu matches shown level`, st.friction === lvl && marked.join() === lvl && (await mu(p)) === { realistic: 0.2, low: 0.05 }[lvl], { modeAtClick, shown: marked, mu: await mu(p) });
      await press(p, '[data-action=stop]');
    }

    // Undo state / history unchanged; New / Open / example keep level
    await press(p, '[data-friction=low]');
    const s0 = await state(p);
    const undoDis0 = await p.locator('[data-action=undo]').isDisabled();
    await press(p, '[data-friction=off]');
    await press(p, '[data-friction=realistic]');
    const s1 = await state(p);
    const undoDis1 = await p.locator('[data-action=undo]').isDisabled();
    check('level change no undo step', s0.historySize === s1.historySize && s0.canUndo === s1.canUndo && undoDis0 === undoDis1, { h0: s0.historySize, h1: s1.historySize });
    await press(p, '[data-friction=low]');
    await press(p, '[data-action=examples]');
    await press(p, '[data-example=pendulum]');
    check('example load keeps level', (await state(p)).friction === 'low');
    await press(p, '[data-action=new]');
    await frames(p, 2);
    check('New keeps level', (await state(p)).friction === 'low', (await state(p)).friction);
    await ev(p, () => window.__knap.openText('x.knap.json', JSON.stringify(window.__knap.getModel())));
    check('Open keeps level', (await state(p)).friction === 'low');
    await ev(p, () => window.__knap.loadExample('four-bar'));
    // autosave flag
    await ev(p, () => window.__knap.flushAutosave());
    const as0 = await ev(p, () => localStorage.getItem('knap.autosave.v1'));
    await press(p, '[data-friction=off]');
    await ev(p, () => window.__knap.flushAutosave());
    const as1 = await ev(p, () => localStorage.getItem('knap.autosave.v1'));
    check('autosave unchanged by level change', as0 === as1);
    // Save file
    const [dl] = await Promise.all([p.waitForEvent('download'), press(p, '[data-action=save]')]);
    const text = await readFile(await dl.path(), 'utf8');
    check('saved file has no friction field', !/fric/i.test(text), text.slice(0, 120));
    // reload keeps
    await p.reload();
    await p.waitForFunction(() => document.body.dataset.ready === 'true', null, { timeout: 90000 });
    check('reload keeps off', (await state(p)).friction === 'off');
    await press(p, '[data-friction=realistic]');
  }
  // garbage / blocked storage
  for (const [name, init] of [
    ['garbage', () => localStorage.setItem('knap.pref.jointFriction', '{"x":1}')],
    ['proto', () => localStorage.setItem('knap.pref.jointFriction', '__proto__')],
    ['blocked', () => { Object.defineProperty(window, 'localStorage', { get() { throw new Error('blocked'); } }); }],
  ]) {
    const c = await h.open(`fapp-st-${name}`, {}, { init });
    const st = await state(c.page);
    check(`storage ${name}: default level, no error banner`, st.friction === 'realistic' && !st.banner && !(await status(c.page)).error && !c.errors.length, { f: st.friction, banner: st.banner, errors: c.errors });
    await press(c.page, '[data-friction=off]');
    check(`storage ${name}: picking still works`, (await state(c.page)).friction === 'off' && !c.errors.length, c.errors);
  }
} finally {
  await h.done();
}
