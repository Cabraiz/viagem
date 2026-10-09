import { defineConfig } from 'vite';

// Executors share one node_modules through a junction, so each dev server needs its own
// pre-bundle cache: VITE_CACHE_DIR=node_modules/.vite-e<N> npx vite --port 42NN.
// Without the variable this is Vite's default, so production builds are unchanged.
export default defineConfig({
  cacheDir: process.env.VITE_CACHE_DIR || 'node_modules/.vite',
});
