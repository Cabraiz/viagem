/**
 * Full-size run of tests/protocol/protocol4.test.ts: the bandwidth measurements with 6 clients (a full room) and
 * the 10 s run without area of interest. Not part of `npm test` (the name does not end in .test.ts) because it peaks
 * at ~1 GB; run it on purpose with `npm run test:protocol:stress`.
 */
(globalThis as {__P4_STRESS__?:boolean}).__P4_STRESS__=true;
await import('../protocol4.test.ts');
