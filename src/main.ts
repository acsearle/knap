// knap entry point: build the app into #app; show a readable page if it cannot start (no WebGL2,
// WASM blocked, …).
import './ui/styles.css';
import { App } from './app/app';
import { installTestHook } from './app/testhook';

async function main(): Promise<void> {
  const root = document.getElementById('app')!;
  try {
    const app = await App.create(root);
    installTestHook(app);
    document.body.dataset.ready = 'true';
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const webgl = /webgl|context/i.test(msg);
    root.replaceChildren();
    const box = document.createElement('div');
    box.className = 'fatal';
    box.dataset.role = 'fatal';
    const h1 = document.createElement('h1');
    h1.textContent = 'knap could not start';
    const p = document.createElement('p');
    p.textContent = webgl
      ? 'This browser could not create a WebGL2 context. Enable hardware acceleration, or try a current version of Chrome, Edge, Firefox or Safari.'
      : 'An error occurred while starting. Reloading the page may help.';
    const pre = document.createElement('pre');
    pre.textContent = msg;
    box.append(h1, p, pre);
    root.append(box);
    document.body.dataset.ready = 'error';
    console.error(err);
  }
}

void main();
