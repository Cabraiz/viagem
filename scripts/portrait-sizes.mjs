// Derives the 768 px portrait (srcset middle step) from the approved 1024 px export when the originals in
// /art-source are not on this machine. Only downsampling and encoding: the illustration is untouched.
// With the originals at hand, `npm run prepare:art` exports the same -768 variant straight from the PNG.
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { stat } from 'node:fs/promises';
import { classes } from '../src/classes.ts';

const require = createRequire(import.meta.url);
const sharp = require(process.env.VIAGEM_SHARP_MODULE || 'sharp');
const dir = new URL('../public/art/portraits/', import.meta.url);
let made = 0, bytes = 0;
for (const hero of classes) {
  const source = new URL(`${hero.id}.webp`, dir), target = new URL(`${hero.id}-768.webp`, dir);
  let sourceStat;
  try { sourceStat = await stat(source); } catch { continue; }
  let current = false;
  try { current = (await stat(target)).mtimeMs > sourceStat.mtimeMs; } catch { /* first export */ }
  if (!current || process.argv.includes('--force')) {
    await sharp(fileURLToPath(source)).resize(768, 768, { fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 88, alphaQuality: 100, effort: 6 }).toFile(fileURLToPath(target));
    made++;
  }
  bytes += (await stat(target)).size;
}
console.log(JSON.stringify({ derived: made, variants768: classes.length, bytes768: bytes }));
