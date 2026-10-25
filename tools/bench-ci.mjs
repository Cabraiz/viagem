#!/usr/bin/env node
/**
 * The city run bench on GitHub Actions instead of the PC (NEW-20261025-ORQ-cicd-smokes-bench, step 2):
 *   node tools/bench-ci.mjs <branch> [--seeds 1-16] [--players 1,3,6] [--objective chaveiro] [--mode ninhos]
 *     [--combat manual] [--cap-min 25] [--no-towers] [--target 2/8] [--out <file.json>] [--json] [--timeout 120]
 * The branch must be on the remote (its head is benched). Pushes bench/<branch>-<stamp> (.bench.json on top of the head),
 * waits for .github/workflows/bench.yml (one job per seed × team size, in parallel), prints the same summary as a local
 * `scripts/bench-city-run.ts` and deletes the ref. --out writes the JSON summary: the local file's config + summary, and
 * each run without its long lists (tools/ci.mjs benchJson); --json prints that JSON instead of the table.
 * Exit 0 (pass or no target), 1 the target failed, 2 infrastructure. No token needed (public repo; shared API cache).
 * It is `node tools/ci.mjs bench …`: same flags, same output.
 */
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {main} from './ci.mjs';

export const run=(argv)=>main(['bench',...argv]);

const entry=process.argv[1]?pathToFileURL(path.resolve(process.argv[1])).href:'';
if(entry===import.meta.url)process.exitCode=await run(process.argv.slice(2));
