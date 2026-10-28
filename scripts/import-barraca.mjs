/**
 * Barraca de feira (NEW-20261023-ORQ-barracas-no-caminho): the Codex edits of the 3-box template
 * (arte-entrada/cenario/base/barraca/molde.py: one stall per lona, inteira | danificada | quebrada left to right) → one
 * base sheet the barraca pieces draw:
 *   public/art/city/base/barraca.webp   rows lona-N:<estado>, 2 views (0 as drawn, 1 mirrored: the other diagonal)
 * Each source is keyed off its green here (the same spill rule as the muralha's montar.py) and cut from the same window
 * around each box's ground centre, so every frame's anchor is that centre. meta.celula: art px across one build cell
 * (the template's L), what the renderer scales to the projected CITY_BUILD_CELL.
 * The group manifest and the index are rewritten; then `node scripts/art-lite.mjs --kinds city` makes the lite copies.
 *   node scripts/import-barraca.mjs [--src <folder>]
 */
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {readFileSync,readdirSync,writeFileSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';

const ROOT=join(dirname(fileURLToPath(import.meta.url)),'..');
const sha256=buffer=>createHash('sha256').update(buffer).digest('hex');

export const PIECE='barraca';
/** States left to right in the template (render: hp share → state). */
export const ESTADOS=['inteira','danificada','quebrada'];
/** molde.py: px per build cell (L) and the boxes' ground centres in the 1536×1024 frame. */
export const MOLDE={L:110,centres:[[274,640],[768,640],[1262,640]]};
/** Window around a ground centre: half the width, above it (awning + overshoot), below it (front corner + debris). */
export const WINDOW={left:245,up:400,down:150};
export const COLUMNS=6;

/** The lona sources in a folder (`lona-N.png`), in order. */
export const lonasIn=files=>files.map(f=>f.match(/^(lona-[0-9]+)[.]png$/)?.[1]).filter(Boolean).sort();
/** Row names of the sheet: `<lona>:<estado>`. */
export const sheetRows=lonas=>lonas.flatMap(id=>ESTADOS.map(s=>`${id}:${s}`));

/** Chroma key (in place, RGBA): green spill → alpha, the spill pulled out of the kept pixels. */
export function keyGreen(data){
  for(let i=0;i<data.length;i+=4){
    const r=data[i],g=data[i+1],b=data[i+2],spill=g-Math.max(r,b);
    const a=Math.min(1,Math.max(0,1-(spill-25)/(110-25)));
    if(spill>0)data[i+1]=Math.max(r,b);
    data[i+3]=Math.round(a*255);
  }
  return data;
}

async function main(){
  const require=createRequire(join(ROOT,'package.json')),sharp=require('sharp');
  const {GROUPS}=await import(pathToFileURL(join(ROOT,'scripts/art-v2/spec.mjs')).href);
  const {writeIndex}=await import(pathToFileURL(join(ROOT,'scripts/art-v2/convert.mjs')).href);
  const args=process.argv.slice(2),srcAt=args.indexOf('--src');
  const SRC=srcAt>=0?args[srcAt+1]:'D:/Gits/viagem-board/arte-entrada/cenario/base/barraca';
  const lonas=lonasIn(readdirSync(SRC));
  if(!lonas.length)throw new Error(`nenhuma lona-N.png em ${SRC}`);
  const spec=GROUPS.base,dir=join(ROOT,spec.output),manifestFile=join(dir,'manifest.json');
  const manifest=JSON.parse(readFileSync(manifestFile,'utf8'));
  const {left,up,down}=WINDOW,cw=2*left,ch=up+down,frames=[];
  for(const id of lonas){
    const src=await sharp(join(SRC,`${id}.png`)).resize(1536,1024,{fit:'fill'}).ensureAlpha().raw().toBuffer({resolveWithObject:true});
    const keyed=keyGreen(Buffer.from(src.data));
    for(const [cx,cy] of MOLDE.centres){
      const cell=await sharp(keyed,{raw:{width:1536,height:1024,channels:4}}).extract({left:cx-left,top:cy-up,width:cw,height:ch}).raw().toBuffer();
      frames.push(cell,await sharp(cell,{raw:{width:cw,height:ch,channels:4}}).flop().raw().toBuffer());
    }
  }
  const cols=COLUMNS,rows=Math.ceil(frames.length/cols),sheet=Buffer.alloc(cols*cw*rows*ch*4);
  frames.forEach((f,n)=>{
    const fx=(n%cols)*cw,fy=Math.floor(n/cols)*ch;
    for(let y=0;y<ch;y++)f.copy(sheet,((fy+y)*cols*cw+fx)*4,y*cw*4,(y+1)*cw*4);
  });
  const file=`${PIECE}.webp`,webp=await sharp(sheet,{raw:{width:cols*cw,height:rows*ch,channels:4}}).webp({lossless:true,effort:6}).toBuffer();
  writeFileSync(join(dir,file),webp);
  const hash=sha256(webp);
  const entry={file,cell:[cw,ch],views:2,rows:sheetRows(lonas),anchor:[.5,+(up/ch).toFixed(6)],
    pages:[{file,columns:cols,rows,firstFrame:0,frameCount:frames.length,sha256:hash}],sha256:hash};
  manifest.pieces[PIECE]={kind:'views',files:{sheet:entry},sha256:sha256(`sheet ${hash}`),
    meta:{lonas,estados:ESTADOS,celula:MOLDE.L,
      origem:'arte-entrada/cenario/base/barraca (Codex sobre molde.py, E2, card barracas-no-caminho); recorte por scripts/import-barraca.mjs'}};
  manifest.pieces=Object.fromEntries(Object.keys(manifest.pieces).sort().map(k=>[k,manifest.pieces[k]]));
  writeFileSync(manifestFile,`${JSON.stringify(manifest,null,2)}\n`);
  await writeIndex({base:spec},{outRoot:ROOT});
  console.error(`${PIECE}: ${frames.length} frames ${cw}×${ch}, ${cols}×${rows}, ${Math.round(webp.length/1024)} KB; agora: node scripts/art-lite.mjs --kinds city`);
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)await main();
