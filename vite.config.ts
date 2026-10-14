import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';
// @ts-expect-error plain ESM build helper without typings
import { artVersionsPlugin } from './scripts/art-versions.mjs';

// Executors share one node_modules through a junction, so each dev server needs its own
// pre-bundle cache: VITE_CACHE_DIR=node_modules/.vite-e<N> npx vite --port 42NN (cloud: .vite-n<k>, port 43k0).
// Without the variable this is Vite's default, so production builds are unchanged.
// The shared sectors (contract, rules, maps, protocol) are pure by rule (OWNERS.md, tests/arquitetura.test.ts):
// telling the bundler so lets a port (`index.ts`) be imported for one name without dragging the whole sector into
// the menu's entry chunk (the menu imports `classes` through src/rules/index.ts).
// Anchored to this project's src/ (module ids are absolute; on Windows they may use backslashes and either
// drive-letter case), so a dependency with a path like .../src/maps/ is never marked side-effect free.
const ROOT = fileURLToPath(new URL('./', import.meta.url)).replaceAll('\\', '/').toLowerCase();
const PURE_SECTOR = /^src\/(contract|rules|maps|protocol)\//;
const isPureSector = (id: string) => {
  const path = id.replaceAll('\\', '/').toLowerCase();
  return path.startsWith(ROOT) && PURE_SECTOR.test(path.slice(ROOT.length));
};
// The contract and the rules (pure, they import nothing from the client) go in one chunk of their own: shared modules
// of the client used to be merged into a chunk with them, and the chunks then imported each other, so a client module
// could run its top-level code before the rules had theirs (prod-only `CIDADE_NEVADA_WC3.mapCells` of undefined, and
// map-scale constants NaN: hotfix after e5b34e5). A chunk of pure modules imports no client chunk, so no cycle runs
// through it.
const CORE_SECTOR = /^src\/(contract|rules)\//;
const isCoreSector = (id: string) => {
  const path = id.replaceAll('\\', '/').toLowerCase();
  return path.startsWith(ROOT) && CORE_SECTOR.test(path.slice(ROOT.length));
};

// One id per build (src/client/ui/version-watch.ts): the deploy's commit on CI, VIAGEM_BUILD_ID when set, otherwise a
// 'dev-' id, which keeps the version watch off (dev server and local builds) unless a test turns it on.
const BUILD_ID = process.env.GITHUB_SHA?.slice(0, 12) || process.env.VIAGEM_BUILD_ID || `dev-${Date.now().toString(36)}`;
// dist/version.json = {"build":BUILD_ID}: an open tab polls it to notice a new deploy.
const versionFile: Plugin = {
  name: 'viagem-version-json',
  apply: 'build',
  generateBundle() {
    this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ build: BUILD_ID }) });
  },
};

export default defineConfig({
  define: { __BUILD_ID__: JSON.stringify(BUILD_ID) },
  // dist/art-versions.json: per-file content versions for the art cache (public/sw.js).
  plugins: [versionFile, artVersionsPlugin()],
  cacheDir: process.env.VITE_CACHE_DIR || 'node_modules/.vite',
  build: {
    rolldownOptions: {
      treeshake: { moduleSideEffects: (id: string) => !isPureSector(id) },
      output: { codeSplitting: { groups: [{ name: 'regras', test: (id: string) => isCoreSector(id), priority: 10 }] } },
    },
  },
});
