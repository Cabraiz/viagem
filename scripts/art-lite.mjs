#!/usr/bin/env node
/**
 * N27 · art the game downloads: lossy WebP copies of the approved sheets (trees, class sprites and the enemies of
 * public/art/enemies/<id>/, subfolders kept), next to them under public/art/lite/. Cells are never cropped: the client
 * indexes frames by cell. The approved files (lossless WebP) are never touched; the game loads the copies.
 *
 *   node scripts/art-lite.mjs            make or refresh the copies whose source changed (the manifest keeps hashes)
 *   node scripts/art-lite.mjs --check    exit 1 when a source has no copy or changed since its copy was made
 *   node scripts/art-lite.mjs --all      remake every copy
 *
 * Enemies (NEW-20261016-ORQ-inimigos-peso-download): the copy is also smaller, cell by cell, down to what a phone
 * shows. The game canvas has the page's CSS size, so an enemy's figure is drawn at artTargetHeight × the hero's 56 CSS
 * px over 96 world px at the closest zoom (camera-zoom.ts ZOOM_MAX), elites ELITE_SCALE bigger: the copy keeps
 * LITE_TEXELS texels per CSS px of that. The figure is measured in the still loop's source cells (the one
 * drawnHeight measures, every cell). One scale per piece, so its elite and costume layers keep the base's geometry
 * (the rest rows sleep/wake, which no match downloads, keep their cell: the client scales a file by its own cell);
 * the smaller cell goes to the piece's files as `liteCell` (public/art/enemies/manifest.json and the index), which
 * the client uses as the cell (art/manifest.ts). A reimport drops `liteCell`; this script puts it back, and --check
 * fails until it does.
 *
 * Quality, measured per file and kept in scripts/art-lite.json:
 *   - `psnr`: the whole sheet, premultiplied colour and alpha (what the GPU blends), at full size (a smaller enemy
 *     copy: against the source scaled the same way, so it measures the encoding);
 *   - `shownPsnr`: at the size a phone draws it (SHOWN_SCALE of the sheet: a 210-world-px tree from a 340 px drawing
 *     at the follow camera's zoom, D-019; heroes and enemies the same), both scaled the same way. Above 40 dB nobody tells them apart.
 * The tests (tests/client/art-lite.test.ts) fail when a tree or a class has no copy, or its copy is older than its source.
 */
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync,mkdirSync,existsSync,readdirSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {GROUPS} from './art-v2/spec.mjs';
import {writeIndex} from './art-v2/convert.mjs';
import {artTargetHeight,chooseAnim,HERO_FIGURE_PX,MASS_ALPHA,unusedEnemyFile} from '../src/client/art/horde-art.ts';
import {ELITE_SCALE} from '../src/client/render/keys.ts';
import {HERO_MIN_SCREEN_PX} from '../src/contract/offscreen.ts';

const require=createRequire(import.meta.url);
const sharp=require('sharp');
const ROOT=fileURLToPath(new URL('..',import.meta.url));
const MANIFEST=join(ROOT,'scripts/art-lite.json');
const ENEMIES=join(ROOT,'public/art/enemies/manifest.json');
/** libwebp settings: lossy colour at 90, exact alpha (cut-outs keep their edge); effort 6 saves ~2% for 3× the time. */
export const WEBP={quality:90,alphaQuality:100,effort:4,smartSubsample:true};
/** What a phone draws of a sheet (see the header): 0.35 of its pixels on each side. */
const SHOWN_SCALE=.35;
/**
 * Texels an enemy copy keeps per CSS px of its figure as an elite at the closest zoom (see the header): 0.9 is a 1.1×
 * stretch in that worst case only (a plain enemy keeps 1.2, and 1.45 at the default zoom), what puts a match at
 * ≤ 18 MB (1 gave 18.2 MB median, 20.8 MB p90 over 300 rotations).
 */
export const LITE_TEXELS=.9;
const KINDS=['trees','sprites','enemies'];
/** Imported v2 files the game has no slot for yet (character-sprites.ts): cardinals, downed, silhouette. No copy. */
const UNUSED=/\.(dir4c|downed)\.webp$|^_silhueta\.webp$/;

const sha=buf=>createHash('sha256').update(buf).digest('hex');
async function rgba(input,w,h){
  let img=sharp(input).ensureAlpha();
  if(w)img=img.resize(w,h,{kernel:'linear',fit:'fill'});
  return (await img.raw().toBuffer({resolveWithObject:true})).data;
}
/** PSNR over premultiplied RGB and alpha. */
function psnr(a,b){
  let se=0,n=0;
  for(let i=0;i<a.length;i+=4){
    const x=a[i+3]/255,y=b[i+3]/255;
    for(let k=0;k<3;k++){const d=a[i+k]*x-b[i+k]*y;se+=d*d;}
    const da=a[i+3]-b[i+3];se+=da*da;n+=4;
  }
  return se===0?99:Math.round(10*Math.log10(255*255/(se/n))*10)/10;
}
const decode=async input=>{const {data,info}=await sharp(input).ensureAlpha().raw().toBuffer({resolveWithObject:true});return {data,width:info.width,height:info.height};};
/** Tallest figure over every cell of a sheet: feet (cell height × anchor y) minus the topmost row at MASS_ALPHA. */
function tallest({data,width,height},[cw,ch],anchorY){
  const feet=Math.round(ch*anchorY);let best=0;
  for(let y0=0;y0+ch<=height;y0+=ch)for(let x0=0;x0+cw<=width;x0+=cw){
    let top=-1;
    for(let y=0;y<ch&&top<0;y++){const row=((y0+y)*width+x0)*4;for(let x=0;x<cw;x++)if(data[row+x*4+3]>=MASS_ALPHA){top=y;break;}}
    if(top>=0&&top<feet)best=Math.max(best,feet-top);
  }
  return best;
}
/** The sheet with every cell resized on its own (no texel bleeds into the next frame), as raw RGBA. */
async function shrink({data,width,height},[cw,ch],[lw,lh]){
  const cols=Math.floor(width/cw),rows=Math.floor(height/ch),W=cols*lw,out=Buffer.alloc(W*rows*lh*4);
  const src=sharp(data,{raw:{width,height,channels:4}});
  for(let r=0;r<rows;r++)for(let c=0;c<cols;c++){
    const cell=await src.clone().extract({left:c*cw,top:r*ch,width:cw,height:ch}).resize(lw,lh,{kernel:'lanczos3',fit:'fill'}).raw().toBuffer();
    for(let y=0;y<lh;y++)cell.copy(out,((r*lh+y)*W+c*lw)*4,y*lw*4,(y+1)*lw*4);
  }
  return {data:out,width:W,height:rows*lh};
}

const args=new Set(process.argv.slice(2));
const manifest=existsSync(MANIFEST)?JSON.parse(readFileSync(MANIFEST,'utf8')):{webp:WEBP,files:{}};
manifest.enemyFigures??={};

// ---------- enemy scales: one per piece, from its still loop's tallest figure ----------
const enemies=existsSync(ENEMIES)?JSON.parse(readFileSync(ENEMIES,'utf8')):{pieces:{}};
/** `enemies/<file>` → its cell and the smaller cell of its copy (only for files whose copy is smaller). */
const liteCells=new Map();
const figures={};
for(const [id,piece] of Object.entries(enemies.pieces)){
  const anim=chooseAnim(piece,false,false),file=anim&&piece.files[anim];if(!file)continue;
  const pages=file.pages?.length?file.pages.map(p=>p.file):[file.file];
  const source=sha(Buffer.concat(pages.map(p=>readFileSync(join(ROOT,'public/art/enemies',p)))));
  let fig=manifest.enemyFigures[id];
  if(fig?.source!==source||String(fig.cell)!==String(file.cell)){
    let drawn=0;for(const p of pages)drawn=Math.max(drawn,tallest(await decode(join(ROOT,'public/art/enemies',p)),file.cell,file.anchor?.[1]??.88));
    fig={source,cell:file.cell,drawn};
  }
  figures[id]=fig;
  const need=artTargetHeight(id)*HERO_MIN_SCREEN_PX/HERO_FIGURE_PX*ELITE_SCALE*LITE_TEXELS;
  const scale=fig.drawn>0?Math.min(1,Math.ceil(file.cell[1]*need/fig.drawn)/file.cell[1]):1;
  if(scale>=1)continue;
  for(const [name,f] of Object.entries(piece.files)){
    if(unusedEnemyFile(name))continue; // the rest rows no match downloads (the nests' card) keep their cell
    const cell=[Math.ceil(f.cell[0]*scale),Math.ceil(f.cell[1]*scale)];
    for(const p of f.pages?.length?f.pages.map(x=>x.file):[f.file])liteCells.set(`enemies/${p}`,{cell:f.cell,lite:cell});
  }
}
manifest.enemyFigures=Object.fromEntries(Object.entries(figures).sort(([a],[b])=>a.localeCompare(b)));

const stale=[];
for(const kind of KINDS){
  const dir=join(ROOT,'public/art',kind);
  // Recursive (enemies keep one folder per id); names use '/' on every OS.
  const names=readdirSync(dir,{recursive:true}).map(n=>String(n).replaceAll('\\','/'));
  for(const name of names.filter(n=>n.endsWith('.webp')&&!UNUSED.test(n.split('/').pop())).sort()){
    const source=readFileSync(join(dir,name)),key=`${kind}/${name}`,entry=manifest.files[key];
    const out=join(ROOT,'public/art/lite',kind,name),small=liteCells.get(key),liteCell=small?.lite;
    if(!args.has('--all')&&entry?.source===sha(source)&&String(entry.liteCell)===String(liteCell)&&existsSync(out)&&sha(readFileSync(out))===entry.lite&&JSON.stringify(manifest.webp)===JSON.stringify(WEBP))continue;
    stale.push(key);
    if(args.has('--check'))continue;
    const meta=await sharp(source).metadata(),w=Math.round(meta.width*SHOWN_SCALE),h=Math.round(meta.height*SHOWN_SCALE);
    let lite,full;
    if(small){
      const s=await shrink(await decode(source),small.cell,small.lite);
      lite=await sharp(s.data,{raw:{width:s.width,height:s.height,channels:4}}).webp(WEBP).toBuffer();full=s.data;
    }else{lite=await sharp(source).webp(WEBP).toBuffer();full=await rgba(source);}
    mkdirSync(dirname(out),{recursive:true});writeFileSync(out,lite);
    manifest.files[key]={source:sha(source),lite:sha(lite),bytes:source.length,liteBytes:lite.length,...(liteCell?{liteCell}:{}),
      psnr:psnr(full,await rgba(lite)),shownPsnr:psnr(await rgba(source,w,h),await rgba(lite,w,h))};
    const e=manifest.files[key];
    console.error(key,`${Math.round(e.bytes/1024)} → ${Math.round(e.liteBytes/1024)} KB`,liteCell?`cell ${liteCell.join('×')}`:'',`psnr ${e.psnr} dB, shown ${e.shownPsnr} dB`);
    save();
  }
}

// ---------- `liteCell` on the enemy files (manifest and index): what the client takes as the cell ----------
let moved=0;
for(const piece of Object.values(enemies.pieces))for(const f of Object.values(piece.files)){
  const first=f.pages?.length?f.pages[0].file:f.file,cell=liteCells.get(`enemies/${first}`)?.lite;
  if(String(f.liteCell)===String(cell))continue;
  moved++;
  if(cell)f.liteCell=cell;else delete f.liteCell;
}
if(moved&&args.has('--check')){console.error(`art-lite: ${moved} enemy files with a stale liteCell in public/art/enemies/manifest.json (node scripts/art-lite.mjs)`);process.exit(1);}
if(moved){
  writeFileSync(ENEMIES,`${JSON.stringify(enemies,null,2)}\n`);
  await writeIndex({inimigos:GROUPS.inimigos},{outRoot:ROOT});
  console.error('art-lite:',moved,'enemy files got a new liteCell (manifest and index)');
}

function save(){
  manifest.webp=WEBP;
  const files=Object.values(manifest.files),sum=k=>files.reduce((a,f)=>a+f[k],0);
  manifest.summary={files:files.length,bytes:sum('bytes'),liteBytes:sum('liteBytes'),
    worstPsnr:Math.min(...files.map(f=>f.psnr)),worstShownPsnr:Math.min(...files.map(f=>f.shownPsnr))};
  manifest.files=Object.fromEntries(Object.entries(manifest.files).sort(([a],[b])=>a.localeCompare(b)));
  const {webp,summary,files:all,enemyFigures}=manifest;
  writeFileSync(MANIFEST,JSON.stringify({webp,summary,files:all,enemyFigures},null,1)+'\n');
}
if(args.has('--check')){
  if(stale.length){console.error('art-lite: copies missing or older than their source:',stale.join(', '));process.exit(1);}
  console.error('art-lite: every copy matches its source');process.exit(0);
}
save();
console.error('art-lite:',stale.length,'made;',JSON.stringify(manifest.summary));
