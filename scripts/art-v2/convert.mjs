/**
 * Art v2 conversion (NEW-20261012-ORQ-importador-arte-a): approved sheets → lossless WebP under the group output dir,
 * plus `<output>/manifest.json` merged with the previous one FILE BY FILE (pieces not delivered now keep their entry;
 * inside a delivered piece, files not re-sent keep theirs). Only called for pieces validate.mjs approved; never touches
 * src/client/sprites/sprite-catalog.ts (part B wires the game).
 *
 * No texture exceeds MAX_TEXTURE px on either side: a sheet that fits is written as `<name>.webp`; a larger one is cut
 * into pages `<name>-p1.webp`, `<name>-p2.webp`… holding its frames in reading order (direction-major for 8-direction
 * sheets: every frame of S, then SW…), each page a grid of floor(MAX_TEXTURE / cell width) columns.
 *
 * Writes are atomic: every file is first written to a temp file in its own folder and renamed over the target only
 * after the whole piece converted, so a failed conversion never deletes or corrupts a previously approved file.
 */
import {createHash,randomBytes} from 'node:crypto';
import {mkdir,readFile,writeFile,rm,rename} from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import {DIRECTIONS,MANIFEST_VERSION,INDEX_FILE} from './spec.mjs';
import {raw,CELL,ROWS,cellStats,figureBox} from '../sprite-atlas.mjs';

export const WEBP=Object.freeze({lossless:true,effort:6});
/** Largest texture side the game loads (px). */
export const MAX_TEXTURE=4096;
const MANIFEST_FIELDS=['cell','frames','views','rows','directions','anchor','fps','loop','slice','mask','wrap','transparent'];
const sha256=buffer=>createHash('sha256').update(buffer).digest('hex');
const inside=(dir,file)=>{const r=path.relative(dir,file);return r!==''&&!r.startsWith('..')&&!path.isAbsolute(r);};

/** Writes `data` to a temp file next to `file` and returns the temp path (renamed later by commit()). */
async function stage(file,data){
  await mkdir(path.dirname(file),{recursive:true});
  const tmp=path.join(path.dirname(file),`.${path.basename(file)}.${process.pid}-${randomBytes(4).toString('hex')}.tmp`);
  try{await writeFile(tmp,data);}catch(e){await rm(tmp,{force:true});throw e;}
  return tmp;
}
/** Atomic write of one file: temp file in the same folder, renamed over the target only when fully written. */
export async function writeAtomic(file,data){
  const tmp=await stage(file,data);
  try{await rename(tmp,file);}catch(e){await rm(tmp,{force:true});throw e;}
}

/** [r,g,b] of '#rrggbb'. */
const rgbOf=hex=>{const m=/^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);if(!m)throw new Error(`bad rim colour ${hex}`);return m.slice(1).map(h=>parseInt(h,16));};
/**
 * D-037 rim (spec.mjs RIM), baked into the RGBA pixels of a sheet of `cell` cells: every pixel gets a rim coverage
 * D = max over the drawn pixels q within reach of (alpha_q / 255) × clamp(width + 0.5 − |p − q|, 0, 1), i.e. the alpha
 * dilated by `width` px with a 1 px anti-aliased edge, minus the original coverage: the rim (colour at `alpha` × D) is
 * written ONLY where the source pixel is fully transparent (alpha 0). Every pixel with any original alpha (opaque body,
 * glass, smoke, soft interior edges) is left byte-identical, so the rim never darkens the inside of the sprite.
 * Only neighbours inside the same cell count and nothing is written outside it, so a rim never crosses into the next
 * frame. Returns a new buffer.
 */
export function applyRim({data,width,height},[cw,ch],{color,alpha,width:w}){
  const [rr,rg,rb]=rgbOf(color),out=Buffer.from(data),reach=Math.ceil(w+.5),edge=w+.5;
  const kernel=[];
  for(let dy=-reach;dy<=reach;dy++)for(let dx=-reach;dx<=reach;dx++){
    const cov=Math.min(1,Math.max(0,edge-Math.hypot(dx,dy)));
    if(cov>0)kernel.push([dx,dy,cov]);
  }
  for(let y=0;y<height;y++){
    const y0=y-y%ch,y1=y0+ch-1;
    for(let x=0;x<width;x++){
      const i=(y*width+x)*4;
      if(data[i+3])continue;
      const x0=x-x%cw,x1=x0+cw-1;
      let d=0;
      for(const [dx,dy,cov] of kernel){
        const nx=x+dx,ny=y+dy;
        if(nx<x0||nx>x1||ny<y0||ny>y1)continue;
        const qa=data[(ny*width+nx)*4+3];
        if(qa){const v=cov*qa/255;if(v>d)d=v;}
      }
      const ra=Math.round(alpha*d*255);
      if(ra<=0)continue;
      out[i]=rr;out[i+1]=rg;out[i+2]=rb;out[i+3]=ra;
    }
  }
  return out;
}

/** Width/height of the image a sheet produces before paging (dir8: the stacked blocks). */
async function sheetSize(sheet){
  const m=await sharp(sheet.source).metadata();
  return {width:m.width,height:sheet.blocks?CELL*ROWS*sheet.blocks.length:m.height};
}
/** RGBA pixels of a sheet: the source, or the DIRECTIONS blocks named in `blocks` (3 rows of 192 px each) stacked in that order. */
async function pixelsOf(sheet,rim){
  const {data,width,height}=await raw(sheet.source);
  if(rim)return {data:applyRim({data,width,height},sheet.cell,rim),width,height};
  if(!sheet.blocks)return {data,width,height};
  const bytes=width*CELL*ROWS*4;
  const parts=sheet.blocks.map(d=>{const b=DIRECTIONS.indexOf(d);return data.subarray(b*bytes,(b+1)*bytes);});
  return {data:Buffer.concat(parts),width,height:CELL*ROWS*sheet.blocks.length};
}

/**
 * Pages of a sheet of `width`×`height` px made of `sheet.cell` cells: one page `{file:sheet.output,…}` when it fits in
 * MAX_TEXTURE, otherwise `<name>-p<n>.webp` pages. Each page: {file (relative to the group output dir), columns, rows,
 * firstFrame (0-based, reading order of the source grid), frameCount}.
 */
export function pageLayout(sheet,width,height){
  const [cw,ch]=sheet.cell,cols=width/cw,rows=height/ch;
  if(!Number.isInteger(cols)||!Number.isInteger(rows)||cols<1||rows<1)throw new Error(`${sheet.output}: ${width}x${height} is not a grid of ${cw}x${ch} cells`);
  const total=cols*rows;
  if(width<=MAX_TEXTURE&&height<=MAX_TEXTURE)return [{file:sheet.output,columns:cols,rows,firstFrame:0,frameCount:total}];
  const pageCols=Math.floor(MAX_TEXTURE/cw),pageRows=Math.floor(MAX_TEXTURE/ch);
  if(!pageCols||!pageRows)throw new Error(`${sheet.output}: cell ${cw}x${ch} is larger than ${MAX_TEXTURE} px`);
  const perPage=pageCols*pageRows,stem=sheet.output.replace(/\.webp$/i,''),pages=[];
  for(let first=0,n=1;first<total;first+=perPage,n++){
    const count=Math.min(perPage,total-first);
    pages.push({file:`${stem}-p${n}.webp`,columns:Math.min(pageCols,count),rows:Math.ceil(count/pageCols),firstFrame:first,frameCount:count});
  }
  return pages;
}
/** One page as a sharp image: its frames copied from the source grid (`cols` columns) in reading order. */
function pageImage({data,width},[cw,ch],cols,page){
  const pw=page.columns*cw,ph=page.rows*ch,out=Buffer.alloc(pw*ph*4);
  for(let k=0;k<page.frameCount;k++){
    const f=page.firstFrame+k,sx=(f%cols)*cw,sy=Math.floor(f/cols)*ch,dx=(k%page.columns)*cw,dy=Math.floor(k/page.columns)*ch;
    for(let y=0;y<ch;y++){const s=((sy+y)*width+sx)*4;data.copy(out,((dy+y)*pw+dx)*4,s,s+cw*4);}
  }
  return sharp(out,{raw:{width:pw,height:ph,channels:4}});
}

/** Game files (relative to outRoot, `/`-separated) the sheets of one piece would write; used by --dry-run. */
export async function plannedOutputs(spec,sheets){
  const out=[];
  for(const sheet of sheets){
    const {width,height}=await sheetSize(sheet);
    for(const page of pageLayout(sheet,width,height))out.push(`${spec.output}/${page.file}`);
  }
  return out;
}
/**
 * What the game needs to draw a hero atlas at its 96 world px (D-030), measured like scripts/import-sprites.mjs does
 * for the catalog: `height` of the first idle cell of front-right (the atlas's first cell; alpha > 20) and `figure`,
 * the box of the drawn figure over every cell. undefined when that cell is empty.
 */
export function heroMeasures({data,width,height}){
  const first=cellStats(data,width,0);
  if(!first.occupied)return undefined;
  return {height:first.height,figure:figureBox(data,width,height)};
}
const fileList=entry=>[...new Set([...(entry?.file?[entry.file]:[]),...(Array.isArray(entry?.pages)?entry.pages.map(p=>p?.file).filter(Boolean):[])])];

/**
 * Converts the sheets of one approved piece under `<outRoot>/<spec.output>/`. Returns its manifest entry
 * {kind, files:{[key]:{file? (single page), cell,…, pages:[{file,columns,rows,firstFrame,frameCount,sha256}], sha256}},
 * sha256} and the absolute paths written (a hero `dir4` atlas also gets `height` and `figure`, heroMeasures()). Every page is staged in a temp file first; targets are replaced only after
 * all of them converted, so on failure nothing previously approved changes. `previous`: this piece's entry in the
 * current manifest; files of the replaced keys that the new layout no longer uses (e.g. a sheet now paged) are removed
 * after the commit. `meta`: the piece's render metadata (validatePiece), recorded as the entry's `meta`. When the group
 * has a `rim` (enemies, D-037), it is baked into every animation sheet except the elite layer (`elite/*` keys) and
 * recorded as `rim` on those files and on the piece.
 */
export async function convertPiece(spec,id,kind,sheets,{outRoot,previous,meta}={}){
  const dir=path.join(outRoot,spec.output),staged=[],files={};
  let heroHeight;
  const rimOf=sheet=>spec.rim&&kind==='animations'&&!sheet.blocks&&!String(sheet.key).startsWith('elite/')?spec.rim:undefined;
  try{
    for(const sheet of sheets){
      const {width,height}=await sheetSize(sheet);
      const pages=pageLayout(sheet,width,height),cols=width/sheet.cell[0];
      // Over the texture cap the frames are reflowed into pages (even when they all fit on one -p1 page).
      const reflow=width>MAX_TEXTURE||height>MAX_TEXTURE,rim=rimOf(sheet);
      const pixels=sheet.blocks||reflow||rim?await pixelsOf(sheet,rim):undefined;
      const entries=[];
      for(const page of pages){
        const image=reflow?pageImage(pixels,sheet.cell,cols,page)
          :pixels?sharp(pixels.data,{raw:{width:pixels.width,height:pixels.height,channels:4}}):sharp(sheet.source);
        const buffer=await image.webp(WEBP).toBuffer();
        const target=path.join(dir,...page.file.split('/'));
        staged.push({target,tmp:await stage(target,buffer)});
        entries.push({...page,sha256:sha256(buffer)});
      }
      const entry=pages.length===1?{file:pages[0].file}:{};
      for(const k of MANIFEST_FIELDS)if(sheet[k]!==undefined)entry[k]=sheet[k];
      // The hero atlas carries its measures so the client scales it without reading pixels (sprite-sheets.ts).
      if(kind==='dir8'&&(sheet.key==='dir4'||sheet.key==='dir4c')&&pixels){
        const measured=heroMeasures(pixels);
        if(measured){
          if(sheet.key==='dir4')heroHeight=measured.height;
          Object.assign(entry,measured,{height:heroHeight??measured.height});
        }
      }
      if(rim)entry.rim={...rim};
      entry.pages=entries;
      entry.sha256=entries.length===1?entries[0].sha256:sha256(entries.map(p=>`${p.file} ${p.sha256}`).join('\n'));
      files[sheet.key]=entry;
    }
  }catch(e){
    await Promise.all(staged.map(s=>rm(s.tmp,{force:true})));
    throw e;
  }
  const written=[];
  try{for(const s of staged){await rename(s.tmp,s.target);written.push(s.target);}}
  catch(e){await Promise.all(staged.map(s=>rm(s.tmp,{force:true})));throw e;}
  const keep=new Set(written.map(f=>path.resolve(f).toLowerCase()));
  for(const key of Object.keys(files))for(const f of fileList(previous?.files?.[key])){
    const abs=path.resolve(dir,f);
    if(inside(dir,abs)&&!keep.has(abs.toLowerCase()))await rm(abs,{force:true});
  }
  const rim=spec.rim&&kind==='animations'?{rim:{...spec.rim}}:{};
  return {entry:{kind,files,sha256:pieceHash(files),...(meta&&Object.keys(meta).length?{meta}:{}),...rim},written};
}
/** Piece hash: sha256 of the lines "<key> <sha256 of that file entry>" sorted, so it changes whenever any file changes. */
const pieceHash=files=>sha256(Object.entries(files).map(([k,f])=>`${k} ${f.sha256}`).sort().join('\n'));

/** Hash of a file entry from the files on disk (older entries without `sha256`); a missing file hashes as "ausente". */
async function hashOnDisk(dir,entry){
  const lines=[];
  for(const f of fileList(entry)){
    const abs=path.resolve(dir,f);
    lines.push(`${f} ${inside(dir,abs)?await readFile(abs).then(sha256,()=>'ausente'):'ausente'}`);
  }
  return lines.length===1?lines[0].split(' ')[1]:sha256(lines.join('\n'));
}
/** Merges a new piece entry over the previous one file by file (same kind), refreshing every file hash and the piece hash. */
async function mergeEntry(old,entry,dir){
  const sameKind=old&&old.kind===entry.kind&&old.files&&typeof old.files==='object';
  const merged={...(sameKind?old.files:{}),...entry.files},files={};
  for(const key of Object.keys(merged).sort()){
    const f=merged[key];
    if(!f||typeof f!=='object')continue;
    files[key]=typeof f.sha256==='string'?f:{...f,sha256:await hashOnDisk(dir,f)};
  }
  // `meta` is this run's (the table + sidecar of the piece just approved); `rim` stays while the kind does.
  const rim=entry.rim??(sameKind?old.rim:undefined);
  return {kind:entry.kind,files,sha256:pieceHash(files),...(entry.meta?{meta:entry.meta}:{}),...(rim?{rim}:{})};
}

/** Reads `<output>/manifest.json`; a missing or unreadable one (or an older version) gives undefined. */
export async function readManifest(file){
  try{const m=JSON.parse(await readFile(file,'utf8'));if(m&&m.version===MANIFEST_VERSION&&m.pieces&&typeof m.pieces==='object')return m;}catch{}
  return undefined;
}
export const manifestPath=(spec,{outRoot})=>path.join(outRoot,spec.output,'manifest.json');
/** Merges this run's approved entries (file by file) over the previous manifest and writes it atomically (ids sorted). Returns the file path. */
export async function writeManifest(group,spec,entries,{outRoot}){
  const file=manifestPath(spec,{outRoot}),dir=path.dirname(file);
  const pieces={...(await readManifest(file))?.pieces};
  for(const [id,entry] of Object.entries(entries))pieces[id]=await mergeEntry(pieces[id],entry,dir);
  const sorted=Object.fromEntries(Object.keys(pieces).sort().map(k=>[k,pieces[k]]));
  await writeAtomic(file,`${JSON.stringify({version:MANIFEST_VERSION,group,pieces:sorted},null,2)}\n`);
  return file;
}

export const indexPath=({outRoot})=>path.join(outRoot,...INDEX_FILE.split('/'));
/** Reads the index; a missing, unreadable or older one gives undefined. */
export async function readIndex(file){
  try{const m=JSON.parse(await readFile(file,'utf8'));if(m&&m.version===MANIFEST_VERSION&&m.groups&&typeof m.groups==='object'&&!Array.isArray(m.groups))return m;}catch{}
  return undefined;
}
/**
 * The index left by a merge stopped on it (git's conflict markers, the queue's resolveIndexConflict): both sides'
 * groups, the incoming side's over ours; anything else gives undefined. Without it a regen kept only the groups of
 * `specs`, and a group another importer writes (import-bicos.mjs: `bicos`) went missing (bots-walk128-troca-perna).
 */
export async function readConflictedIndex(file){
  let text;try{text=await readFile(file,'utf8');}catch{return undefined;}
  if(!/^<{7}( |$)/m.test(text))return undefined;
  const sides=[[],[]];let at='both';
  for(const line of text.split(/\r?\n/)){
    if(/^<{7}( |$)/.test(line))at='ours';
    else if(/^\|{7}( |$)/.test(line))at='base';
    else if(/^={7}$/.test(line))at='theirs';
    else if(/^>{7}( |$)/.test(line))at='both';
    else{if(at!=='theirs'&&at!=='base')sides[0].push(line);if(at!=='ours'&&at!=='base')sides[1].push(line);}
  }
  const parsed=sides.map(lines=>{try{const m=JSON.parse(lines.join('\n'));return m&&m.version===MANIFEST_VERSION&&m.groups&&typeof m.groups==='object'?m:undefined;}catch{return undefined;}});
  if(!parsed[0]&&!parsed[1])return undefined;
  return {version:MANIFEST_VERSION,groups:{...parsed[0]?.groups,...parsed[1]?.groups}};
}
/**
 * (Re)writes the client index `public/art/manifest.json` (spec.mjs INDEX_FILE, read by src/client/art/manifest.ts)
 * atomically: {version:2, groups:{[group]:{output, pieces}}} with every group of `specs` whose manifest exists on disk
 * (its pieces exactly as in that manifest), over the previous index (groups without a manifest keep their entry).
 * Groups and ids sorted, so a re-run gives the same bytes. Returns the file path.
 */
/** A group entry without its `sha256` fields (at every depth). */
export function leanIndex(value){
  if(Array.isArray(value))return value.map(leanIndex);
  if(!value||typeof value!=='object')return value;
  const out={};for(const [k,v] of Object.entries(value))if(k!=='sha256')out[k]=leanIndex(v);
  return out;
}
export async function writeIndex(specs,{outRoot}){
  const file=indexPath({outRoot}),clean=await readIndex(file),conflicted=clean?undefined:await readConflictedIndex(file);
  const groups={...(clean??conflicted)?.groups};
  // Over a conflicted index, a group outside `specs` (bicos, made by its own importer) comes from its own manifest when
  // there is one (the merge joined it). Over a clean index it keeps its entry as is: a selected import (--groups menu)
  // never rewrites the groups it did not select (tests/tools/import-menu-dance.test.ts).
  if(conflicted)for(const [group,entry] of Object.entries(groups)){
    if(specs[group]||typeof entry?.output!=='string')continue;
    const manifest=await readManifest(manifestPath(entry,{outRoot}));
    if(manifest)groups[group]={output:entry.output,pieces:manifest.pieces};
  }
  for(const [group,spec] of Object.entries(specs)){
    const manifest=await readManifest(manifestPath(spec,{outRoot}));
    if(manifest)groups[group]={output:spec.output,pieces:manifest.pieces};
  }
  const sorted=Object.fromEntries(Object.keys(groups).sort().map(g=>[g,leanIndex(groups[g])]));
  // Lean and minified (manifesto-enxuto-3g): the client never checks hashes, and every phone downloads this file
  // before the game starts (246 KB → ~84 KB, ~7 KB gzip). The group manifests keep every sha256.
  await writeAtomic(file,`${JSON.stringify({version:MANIFEST_VERSION,groups:sorted})}
`);
  return file;
}
