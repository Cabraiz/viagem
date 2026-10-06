// Only asset encoding and downsampling. Illustration edits come from image_gen.
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { classes } from '../src/classes.ts';

const require = createRequire(import.meta.url);
const sharp = require(process.env.VIAGEM_SHARP_MODULE || 'sharp');
const root = new URL('../', import.meta.url);
const output = new URL('public/art/portraits/', root);
await mkdir(output, { recursive: true });
const manifest = [];
for (const hero of classes) {
  const source = new URL(`art-source/portraits/${hero.id}.png`, root);
  let sourceStat;
  try { sourceStat = await stat(source); } catch { continue; }
  const sourceBytes = await readFile(source);
  const metadata = await sharp(sourceBytes).metadata();
  if (!metadata.hasAlpha || metadata.width < 1024 || metadata.height < 1024) {
    throw new Error(`Source portrait lacks resolution or alpha: ${hero.id}`);
  }
  if ((await sharp(sourceBytes).stats()).isOpaque) throw new Error(`Opaque background: ${hero.id}`);
  const item = { id: hero.id, width: metadata.width, height: metadata.height, alpha: true, sourceBytes: sourceStat.size, variants: [] };
  for (const [suffix, size, quality] of [['', 1024, 90], ['-thumb', 256, 86]]) {
    const path = new URL(`${hero.id}${suffix}.webp`, output);
    let current = false;
    try { current = (await stat(path)).mtimeMs > sourceStat.mtimeMs; } catch { /* first export */ }
    if (!current || process.argv.includes('--force')) {
      await sharp(sourceBytes)
        .resize(size, size, { fit: 'inside', withoutEnlargement: true })
        .webp({ quality, alphaQuality: 100, effort: 6 })
        .toFile(fileURLToPath(path));
    }
    item.variants.push({ file: `${hero.id}${suffix}.webp`, size, bytes: (await stat(path)).size });
  }
  manifest.push(item);
}
await writeFile(new URL('docs/portraits/manifest.json', root), JSON.stringify(manifest, null, 2) + '\n');
console.log(JSON.stringify({ prepared: manifest.length, originalsExpected: classes.length, webBytes: manifest.flatMap(x => x.variants).reduce((total, x) => total + x.bytes, 0) }));
if (process.argv.includes('--complete') && manifest.length !== classes.length) throw new Error('Missing source portraits');
