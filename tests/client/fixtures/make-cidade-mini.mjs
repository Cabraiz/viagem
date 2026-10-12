// Writes tests/client/fixtures/cidade-mini.json from makeSampleCity() (src/client/render/city/sample.ts), the
// stand-in for the Cidade Nevada asset until the importer (cidade-01) ships.
// Run from the repo root: node --experimental-strip-types tests/client/fixtures/make-cidade-mini.mjs
import {writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {makeSampleCity} from '../../../src/client/render/city/sample.ts';

const out=fileURLToPath(new URL('./cidade-mini.json',import.meta.url));
writeFileSync(out,`${JSON.stringify(makeSampleCity())}\n`);
console.log(`wrote ${out}`);
