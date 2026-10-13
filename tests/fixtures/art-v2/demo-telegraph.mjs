/**
 * DEMO telegraph art v2 (NEW-20261012-ORQ-importar-arte-c-completa item 4): REAL sizes, SYNTHETIC look, so a print shows
 * the wiring and never passes for finished art:
 *  - efeitos/telegraph-enchimento.png 128×128: magenta diagonal hatch (x+y, period 16 px, 5 px lines) on a
 *    transparent background; seamless in x and y (128 is a multiple of the period).
 *  - efeitos/telegraph-borda.png 128×16: bright yellow dashes (20 on, 12 off, period 32) between two thin Breu rails,
 *    transparent between the dashes; wraps in x.
 * Each with its sidecar (the group's default kind is 'frames'), as scripts/art-v2/spec.mjs `efeitos` documents:
 * {kind:'seamless',cell,transparent:true} and, for the border, wrap:'x'.
 *
 *   node tests/fixtures/art-v2/demo-telegraph.mjs <pasta>     then: node scripts/import-art-v2.mjs --dry-run --input <pasta>
 */
import sharp from 'sharp';
import {mkdirSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

export const DEMO_TELEGRAPH=Object.freeze({efeitos:Object.freeze(['telegraph-enchimento','telegraph-borda'])});
export const HATCH=Object.freeze({size:128,period:16,line:5,rgba:Object.freeze([255,0,200,220])});
/** Sidecars by piece (scripts/art-v2/spec.mjs EFEITOS). */
export const DEMO_TELEGRAPH_SIDECARS=Object.freeze({
  'telegraph-enchimento':Object.freeze({kind:'seamless',cell:[128,128],transparent:true}),
  'telegraph-borda':Object.freeze({kind:'seamless',cell:[128,16],wrap:'x',transparent:true}),
});
export const DASH=Object.freeze({width:128,height:16,period:32,on:20,rgba:Object.freeze([255,235,0,255]),rail:Object.freeze([30,21,48,255])});

async function save(width,height,paint,file){
  const data=Buffer.alloc(width*height*4);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){const c=paint(x,y);if(c)data.set(c,(y*width+x)*4);}
  mkdirSync(path.dirname(file),{recursive:true});
  await sharp(data,{raw:{width,height,channels:4}}).png({compressionLevel:6}).toFile(file);
}

/** Writes the two telegraph pieces under `dir` (the `arte-entrada/` layout). Returns DEMO_TELEGRAPH. */
export async function writeDemoTelegraph(dir){
  const fx=path.join(dir,'efeitos');
  await save(HATCH.size,HATCH.size,(x,y)=>(x+y)%HATCH.period<HATCH.line?HATCH.rgba:undefined,path.join(fx,'telegraph-enchimento.png'));
  await save(DASH.width,DASH.height,(x,y)=>y<2||y>=DASH.height-2?DASH.rail:y>=4&&y<DASH.height-4&&x%DASH.period<DASH.on?DASH.rgba:undefined,
    path.join(fx,'telegraph-borda.png'));
  for(const [id,sidecar] of Object.entries(DEMO_TELEGRAPH_SIDECARS))writeFileSync(path.join(fx,`${id}.json`),`${JSON.stringify(sidecar)}\n`);
  return DEMO_TELEGRAPH;
}

if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
  const dir=process.argv[2];
  if(!dir){console.error('Uso: node tests/fixtures/art-v2/demo-telegraph.mjs <pasta>');process.exitCode=2;}
  else{
    await writeDemoTelegraph(path.resolve(dir));
    console.log(`Telegraph de demonstração (sintético) em ${path.resolve(dir)}/efeitos: ${DEMO_TELEGRAPH.efeitos.join(', ')}`);
  }
}
