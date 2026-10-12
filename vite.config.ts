import { defineConfig } from 'vite';

// Executors share one node_modules through a junction, so each dev server needs its own
// pre-bundle cache: VITE_CACHE_DIR=node_modules/.vite-e<N> npx vite --port 42NN (cloud: .vite-n<k>, port 43k0).
// Without the variable this is Vite's default, so production builds are unchanged.
// The shared sectors (contract, rules, maps, protocol) are pure by rule (OWNERS.md, tests/arquitetura.test.ts):
// telling the bundler so lets a port (`index.ts`) be imported for one name without dragging the whole sector into
// the menu's entry chunk (the menu imports `classes` through src/rules/index.ts).
const PURE_SECTOR = /[\\/]src[\\/](contract|rules|maps|protocol)[\\/]/;

export default defineConfig({
  cacheDir: process.env.VITE_CACHE_DIR || 'node_modules/.vite',
  build: {
    rolldownOptions: {
      treeshake: { moduleSideEffects: (id: string) => !PURE_SECTOR.test(id) },
    },
  },
});
