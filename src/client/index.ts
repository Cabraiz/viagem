/**
 * Port of the client sector. Nothing in the build imports it (src/main.ts is the Vite entry and loads the client
 * lazily); it names the entry points tools use (scripts/perf-lab.mjs, the protocol bots).
 */
export {mountWaitingRoom} from './lobby.ts';
export {openExploration} from './explore.ts';
export {CoopClient} from './net/client.ts';
