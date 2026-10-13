/**
 * DEMO critter HUD icons, art v2 (NEW-20261012-ORQ-importar-arte-d-restos item 1): REAL size, SYNTHETIC look. Each icon is
 * loud on purpose (a neon disc, a warning-striped rim and one big black letter) so a print shows the wiring and never
 * passes for finished art:
 *  - ui/inimigo-<id>.png 128×128, transparent, nothing within 2 px of the border (the importer's margin rule), for the
 *    D-033 cast: bebado B (lime), anao-molotov M (orange), pombos P (cyan), tio-pave T (pink), agiota A (yellow),
 *    chefe C (violet).
 * The ally ring and plaque reuse the "Você" ring and the place plaque, written by demo-frames.mjs.
 *
 *   node tests/fixtures/art-v2/demo-hud.mjs <pasta>     then: node scripts/import-art-v2.mjs --dry-run --input <pasta>
 */
import sharp from 'sharp';
import {mkdirSync} from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

/** What writeDemoHud writes, by group (every one must be approved by the importer). */
export const DEMO_HUD=Object.freeze({
  ui:Object.freeze(['inimigo-bebado','inimigo-anao-molotov','inimigo-pombos','inimigo-tio-pave','inimigo-agiota','inimigo-chefe']),
});

const INK=[20,10,30,255],YELLOW=[255,230,0,255];
/** Letter and disc colour per icon. */
const LOOK=Object.freeze({
  'inimigo-bebado':['B',[120,255,40,255]],'inimigo-anao-molotov':['M',[255,140,0,255]],'inimigo-pombos':['P',[0,230,255,255]],
  'inimigo-tio-pave':['T',[255,40,200,255]],'inimigo-agiota':['A',[255,230,0,255]],'inimigo-chefe':['C',[150,60,255,255]],
});
/** 5×7 pixel glyphs (rows top to bottom, '#' drawn). */
const GLYPHS=Object.freeze({
  B:['####.','#...#','#...#','####.','#...#','#...#','####.'],
  M:['#...#','##.##','#.#.#','#.#.#','#...#','#...#','#...#'],
  P:['####.','#...#','#...#','####.','#....','#....','#....'],
  T:['#####','..#..','..#..','..#..','..#..','..#..','..#..'],
  A:['.###.','#...#','#...#','#####','#...#','#...#','#...#'],
  C:['.####','#....','#....','#....','#....','#....','.####'],
});
const SIZE=128,GLYPH_SCALE=10;

/** Writes a SIZE² PNG whose pixel (x, y) is paint(x, y) (RGBA array) or transparent (undefined). */
async function save(file,paint){
  const data=Buffer.alloc(SIZE*SIZE*4);
  for(let y=0;y<SIZE;y++)for(let x=0;x<SIZE;x++){const c=paint(x,y);if(c)data.set(c,(y*SIZE+x)*4);}
  mkdirSync(path.dirname(file),{recursive:true});
  await sharp(data,{raw:{width:SIZE,height:SIZE,channels:4}}).png({compressionLevel:6}).toFile(file);
}

/** Writes the demo under `dir` (the `arte-entrada/` layout). Returns DEMO_HUD. */
export async function writeDemoHud(dir){
  for(const id of DEMO_HUD.ui){
    const [letter,color]=LOOK[id],glyph=GLYPHS[letter];
    const gx=64-5*GLYPH_SCALE/2,gy=64-7*GLYPH_SCALE/2;
    await save(path.join(dir,'ui',`${id}.png`),(x,y)=>{
      const d=Math.hypot(x-63.5,y-63.5);
      if(d>58)return undefined;
      // Rim: yellow/black warning stripes, 8 px wide.
      if(d>50)return (x+y)%16<8?YELLOW:INK;
      const col=Math.floor((x-gx)/GLYPH_SCALE),row=Math.floor((y-gy)/GLYPH_SCALE);
      if(row>=0&&row<7&&col>=0&&col<5&&glyph[row][col]==='#')return INK;
      return color;
    });
  }
  return DEMO_HUD;
}

if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
  const dir=process.argv[2];
  if(!dir){console.error('Uso: node tests/fixtures/art-v2/demo-hud.mjs <pasta>');process.exitCode=2;}
  else{
    const pieces=await writeDemoHud(path.resolve(dir));
    console.log(`Ícones de bicho de demonstração (sintéticos) em ${path.resolve(dir)}:`);
    for(const [group,ids] of Object.entries(pieces))console.log(`  ${group}: ${ids.join(', ')}`);
    console.log(`Valide com: node scripts/import-art-v2.mjs --dry-run --input ${path.resolve(dir)}`);
  }
}
