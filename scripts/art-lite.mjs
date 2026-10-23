#!/usr/bin/env node
/**
 * N27 · art the game downloads: lossy WebP copies of the approved sheets (trees, class sprites and the enemies of
 * public/art/enemies/<id>/, subfolders kept), next to them under public/art/lite/. Cells are never cropped: the client
 * indexes frames by cell. The approved files (lossless WebP) are never touched; the game loads the copies.
 *
 *   node scripts/art-lite.mjs            make or refresh the copies whose source changed (the manifest keeps hashes)
 *   node scripts/art-lite.mjs --check    exit 1 when a source has no copy or changed since its copy was made
 *   node scripts/art-lite.mjs --all      remake every copy
 *   node scripts/art-lite.mjs --kinds sprites,menu   refresh only these families, keeping other entries and files
 *
 * City (NEW-20261021-E1-decor-lite-arte-perto): the 4-view sheets the city draws and the decor's live loops
 * (render/city/art-plan.ts cityLiteFiles: building lots, props, the fountain, the decor, the nests, `anim*`) that weigh over CITY_LITE_MIN_BYTES get a lossy copy,
 * every cell × its scale (1, or 0.75 for the sheets drawn small), at public/art/lite/city/<group dir>/<file>; its cell goes to the file
 * as `liteCell` (the group's manifest and the index), from which the city loads the copy (art-plan.ts cityTexture). A
 * reimport drops `liteCell`; this script puts it back, and --check fails until it does.
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
import {cityLiteFiles} from '../src/client/render/city/art-plan.ts';

const require=createRequire(import.meta.url);
const sharp=require('sharp');
/** The repository it works on: this one, or ART_LITE_ROOT (tests: a scratch tree with its own public/ and art-lite.json). */
const ROOT=process.env.ART_LITE_ROOT??fileURLToPath(new URL('..',import.meta.url));
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
/**
 * Towers: every cell × this. At the city scenery's scale (tower-rules towerArtScale: 0.85 world px per art px on the
 * real Cidade Nevada's 1.496 u cells) a phone draws a tower at ~0.57 CSS px per art px at the closest zoom
 * (ZOOM_MAX; measured in the sandbox cidade, 390×844): LITE_TEXELS of that, as for the enemies.
 */
export const TOWER_LITE_SCALE=.5;
/**
 * City files below this keep the approved file: a copy would save a few KB. 200 KB (the card's first cut) left 24
 * sheets of 100–190 KB (walls, poles, small houses: 3 MB) in the opening's art, decor-lite-arte-perto fases d1.
 */
export const CITY_LITE_MIN_BYTES=64*1024;
/** Shown psnr a city copy keeps (tests/client/art-lite.test.ts: no copy below 36 dB at the size a phone draws it). */
const CITY_MIN_PSNR=36;
/** The art groups the city draws from (art-plan.ts), by their GROUPS key. */
const CITY_GROUPS=['predios','base','props','cenario'];
const KINDS=['trees','sprites','enemies','menu','towers','city'];
const TOWERS=join(ROOT,'public/art/towers/manifest.json');
/**
 * Towers (NEW-20261020-ORQ-torres-entregues): the files a match loads (render/towers queueTowerArt: the base and the
 * weapon's idle), each as ONE lite sheet at public/art/lite/towers/<id>/<name>.webp, its pages joined (frames in
 * order, `views` or `frames` columns), every cell scaled by TOWER_LITE_SCALE; `liteCell` goes to the file in
 * public/art/towers/manifest.json and the index. The delivered art is drawn at the city scenery's scale
 * (tower-rules towerArtScale), ~0.57 CSS px per art px on a phone at the closest zoom (see TOWER_LITE_SCALE).
 */
const TOWER_LITE_FILES=['base','idle'];
/** Downed and the silhouette still have no animation slot. The cardinals (dir4c) are used: the 8-direction rest. */
const UNUSED=/\.downed\.webp$|^_silhueta\.webp$/;
/**
 * Menu (BUG-20261022-ORQ-art-lite-menu): only what the page loads from /art/lite/menu gets a copy, the dance pages
 * (ui/menu-dance.ts), the heroes' backgrounds `fundo-*` (estadio.css, ui/stadium.ts) and the phone's profile screen `insta/`
 * (ui/insta.ts, scripts/insta-arte.mjs) and the row's faces `rosto/` (ui/miniatura.ts, scripts/miniatura-rosto.mjs). The button, the cut-out heroes,
 * the letreiros and the mureta are light WebPs already (scripts/menu-arte.mjs, q95 at the size shown), loaded as they are.
 */
const MENU_LITE=/^(danca\/|insta\/|rosto\/|fundo-[^/]+\.webp$)/;

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
/**
 * The sheet with every cell resized on its own (no texel bleeds into the next frame), as raw RGBA. The cell's outer px
 * stays transparent (BUG-20261022-ORQ-quadro-sangra-vizinho): the lanczos pulls a figure drawn near the edge onto it,
 * and the game's LINEAR filtering would bleed it into the next frame (scripts/sheet-cells.mjs checks it).
 */
async function shrink({data,width,height},[cw,ch],[lw,lh]){
  const cols=Math.floor(width/cw),rows=Math.floor(height/ch),W=cols*lw,out=Buffer.alloc(W*rows*lh*4);
  const src=sharp(data,{raw:{width,height,channels:4}});
  for(let r=0;r<rows;r++)for(let c=0;c<cols;c++){
    const cell=await src.clone().extract({left:c*cw,top:r*ch,width:cw,height:ch}).resize(lw,lh,{kernel:'lanczos3',fit:'fill'}).raw().toBuffer();
    for(let y=0;y<lh;y++)for(let x=0;x<lw;x++)if(x===0||y===0||x===lw-1||y===lh-1)cell[(y*lw+x)*4+3]=0;
    for(let y=0;y<lh;y++)cell.copy(out,((r*lh+y)*W+c*lw)*4,y*lw*4,(y+1)*lw*4);
  }
  return {data:out,width:W,height:rows*lh};
}

const options=process.argv.slice(2),args=new Set(options),kindArg=options.indexOf('--kinds');
const kinds=kindArg<0?KINDS:[...new Set((options[kindArg+1]??'').split(',').map(k=>k.trim()).filter(Boolean))];
if(!kinds.length||kinds.some(kind=>!KINDS.includes(kind)))throw new Error('--kinds precisa de famílias válidas separadas por vírgula: trees,sprites,enemies,menu,towers.');
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
for(const kind of kinds){
  const dir=join(ROOT,'public/art',kind);
  if(!existsSync(dir))continue;
  // Recursive (enemies keep one folder per id); names use '/' on every OS.
  const names=readdirSync(dir,{recursive:true}).map(n=>String(n).replaceAll('\\','/'));
  if(kind==='towers'||kind==='city')continue; // joined per file / smaller per cell below
  for(const name of names.filter(n=>n.endsWith('.webp')&&!UNUSED.test(n.split('/').pop())&&(kind!=='menu'||MENU_LITE.test(n))).sort()){
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

// ---------- towers: one lite sheet per loaded file, pages joined ----------
let towersMoved=0;
const towers=kinds.includes('towers')&&existsSync(TOWERS)?JSON.parse(readFileSync(TOWERS,'utf8')):undefined;
for(const [id,piece] of Object.entries(towers?.pieces??{}))for(const name of TOWER_LITE_FILES){
  const f=piece.files[name];if(!f)continue;
  const total=(f.views??f.frames??1)*(Array.isArray(f.rows)?f.rows.length:f.directions??1);
  const pages=f.pages?.length?f.pages:[{file:f.file,columns:f.views??f.frames??1,rows:Array.isArray(f.rows)?f.rows.length:f.directions??1,firstFrame:0,frameCount:total}];
  const bufs=pages.map(p=>readFileSync(join(ROOT,'public/art/towers',p.file)));
  const key=`towers/${id}/${name}.webp`,out=join(ROOT,'public/art/lite',key),entry=manifest.files[key];
  const source=sha(Buffer.concat(bufs)),liteCell=[Math.ceil(f.cell[0]*TOWER_LITE_SCALE),Math.ceil(f.cell[1]*TOWER_LITE_SCALE)];
  if(String(f.liteCell)!==String(liteCell)){towersMoved++;f.liteCell=liteCell;}
  if(!args.has('--all')&&entry?.source===source&&String(entry.liteCell)===String(liteCell)&&existsSync(out)&&sha(readFileSync(out))===entry.lite&&JSON.stringify(manifest.webp)===JSON.stringify(WEBP))continue;
  stale.push(key);
  if(args.has('--check'))continue;
  // `views` or `frames` columns, more when that is over 4096 px tall (frames are read in order, any grid will do)
  const [lw,lh]=liteCell,count=pages.reduce((n,p)=>Math.max(n,p.firstFrame+p.frameCount),0);
  let cols=f.views??f.frames??pages[0].columns;while(Math.ceil(count/cols)*lh>4096&&(cols+1)*lw<=4096)cols++;
  const rows=Math.ceil(count/cols),W=cols*lw,H=rows*lh,raw=Buffer.alloc(W*H*4);
  if(H>4096||W>4096)throw new Error(`art-lite: ${key} ${W}×${H} passa de 4096 px`);
  for(let k=0;k<pages.length;k++){
    const p=pages[k],src=sharp(bufs[k]).ensureAlpha();
    for(let i=0;i<p.frameCount;i++){
      const cell=await src.clone().extract({left:(i%p.columns)*f.cell[0],top:Math.floor(i/p.columns)*f.cell[1],width:f.cell[0],height:f.cell[1]})
        .resize(lw,lh,{kernel:'lanczos3',fit:'fill'}).raw().toBuffer();
      const g=p.firstFrame+i,x0=(g%cols)*lw,y0=Math.floor(g/cols)*lh;
      for(let y=0;y<lh;y++)cell.copy(raw,((y0+y)*W+x0)*4,y*lw*4,(y+1)*lw*4);
    }
  }
  const lite=await sharp(raw,{raw:{width:W,height:H,channels:4}}).webp(WEBP).toBuffer();
  mkdirSync(dirname(out),{recursive:true});writeFileSync(out,lite);
  const shown=psnr(raw,await rgba(lite)); // the copy is already at the size a phone draws it
  manifest.files[key]={source,lite:sha(lite),bytes:bufs.reduce((n,b)=>n+b.length,0),liteBytes:lite.length,liteCell,psnr:shown,shownPsnr:shown};
  const e=manifest.files[key];
  console.error(key,`${Math.round(e.bytes/1024)} → ${Math.round(e.liteBytes/1024)} KB`,`cell ${liteCell.join('×')}`,`psnr ${e.psnr} dB`);
  save();
}
if(towersMoved&&args.has('--check')){console.error(`art-lite: ${towersMoved} tower files with a stale liteCell in public/art/towers/manifest.json (node scripts/art-lite.mjs --kinds towers)`);process.exit(1);}
if(towersMoved){
  writeFileSync(TOWERS,`${JSON.stringify(towers,null,2)}
`);
  await writeIndex({torres:GROUPS.torres},{outRoot:ROOT});
  console.error('art-lite:',towersMoved,'tower files got a new liteCell (manifest and index)');
}

// ---------- city: the files the city draws over CITY_LITE_MIN_BYTES, every cell × its scale (cityLiteFiles) ----------
const cityMoved=new Set();
if(kinds.includes('city'))for(const group of CITY_GROUPS){
  const spec=GROUPS[group],file=join(ROOT,spec.output,'manifest.json');
  if(!existsSync(file))continue;
  const m=JSON.parse(readFileSync(file,'utf8')),dir=spec.output.replace(/^public\/art\//,'');
  for(const [id,piece] of Object.entries(m.pieces??{}))for(const {name,scale:k} of cityLiteFiles(group,id,piece)){
    const f=piece.files[name];
    if(!f?.file)continue;
    const source=readFileSync(join(ROOT,spec.output,f.file)),key=`${dir}/${f.file}`,out=join(ROOT,'public/art/lite',key);
    const liteCell=source.length>CITY_LITE_MIN_BYTES?[Math.ceil(f.cell[0]*k),Math.ceil(f.cell[1]*k)]:undefined;
    if(String(f.liteCell)!==String(liteCell)){
      cityMoved.add(group);
      if(liteCell)f.liteCell=liteCell;else delete f.liteCell;
    }
    if(!liteCell){if(manifest.files[key]&&!args.has('--check')){delete manifest.files[key];save();}continue;}
    const entry=manifest.files[key];
    if(!args.has('--all')&&entry?.source===sha(source)&&String(entry.liteCell)===String(liteCell)&&existsSync(out)&&sha(readFileSync(out))===entry.lite&&JSON.stringify(manifest.webp)===JSON.stringify(WEBP))continue;
    stale.push(key);
    if(args.has('--check'))continue;
    // The copy is already at the size a phone draws it (at most): its psnr is the shown one. A small busy sheet
    // (puxadinho-1, 84×136 cells: 34.9 dB at quality 90, 35.9 at 100) loses more: the next setting up to CITY_MIN_PSNR,
    // lossless last.
    const s=k<1?await shrink(await decode(source),f.cell,liteCell):await decode(source);
    let lite,shown;
    for(const webp of [WEBP,{...WEBP,quality:95},{lossless:true,effort:WEBP.effort}]){
      lite=await sharp(s.data,{raw:{width:s.width,height:s.height,channels:4}}).webp(webp).toBuffer();
      shown=psnr(s.data,await rgba(lite));
      if(shown>=CITY_MIN_PSNR)break;
    }
    mkdirSync(dirname(out),{recursive:true});writeFileSync(out,lite);
    manifest.files[key]={source:sha(source),lite:sha(lite),bytes:source.length,liteBytes:lite.length,liteCell,psnr:shown,shownPsnr:shown};
    console.error(key,`${Math.round(source.length/1024)} → ${Math.round(lite.length/1024)} KB`,`cell ${liteCell.join('×')}`,`psnr ${shown} dB`);
    save();
  }
  if(cityMoved.has(group)&&!args.has('--check'))writeFileSync(file,`${JSON.stringify(m,null,2)}
`);
}
if(cityMoved.size&&args.has('--check')){console.error(`art-lite: city files with a stale liteCell in ${[...cityMoved].join(', ')} (node scripts/art-lite.mjs --kinds city)`);process.exit(1);}
if(cityMoved.size){
  await writeIndex(Object.fromEntries([...cityMoved].map(g=>[g,GROUPS[g]])),{outRoot:ROOT});
  console.error('art-lite: city files got a new liteCell in',[...cityMoved].join(', '),'(manifest and index)');
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
