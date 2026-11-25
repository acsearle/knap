import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  build: {
    target: 'es2022',
    // The WASM modules are large; this is expected.
    chunkSizeWarningLimit: 8192,
  },
  optimizeDeps: {
    // manifold-3d is an Emscripten module that locates its .wasm relative to itself;
    // keep it out of dep pre-bundling so the ?url import resolves to the real file.
    exclude: ['manifold-3d'],
  },
});
