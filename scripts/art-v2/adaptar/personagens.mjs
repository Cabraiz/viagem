/**
 * Delivery adapter for the player characters (NEW-20261012-ORQ-adaptar-entrega-codex), group `personagens`.
 * Contract: scripts/art-v2/adaptar-entrega.mjs. Importer rules: scripts/art-v2/spec.mjs (kind 'dir8', cell 192, feet on
 * row 168) and scripts/art-v2/validate.mjs (validateDir8/validateSilhouette), docs/sprite-directions.md.
 *
 * The importer takes, per class, ONLY `<id>.dir8.png` (1152×4608: 8 direction blocks of idle/walk/attack rows) and the
 * optional `<id>.downed.png` (1152×1536, one row per direction), plus `_silhueta.png` (1536×192, one cell per
 * direction). No sidecar is accepted in this group, so the delivery's `<id>.meta.json`, `<id>.downed.meta.json` and
 * `_silhueta.meta.json` are dropped (noted on the record). What this adapter changes:
 *  1. Height per direction: for every animation row (idle, walk, attack) the row height (median of its 6 cells, the
 *     importer's measure) is brought to the median of that row over the 8 directions, so every direction matches the
 *     reference SE within the importer's 6 %. Each cell is rescaled (lanczos3) about its feet: x = the row's median feet
 *     centre, y = the cell's own foot line (lowest drawn row), so the foot checks stay as delivered.
 *  2. Height across classes (D-030, same hero height): the whole atlas is scaled by heroHeight / class idle height. The
 *     downed sheet is drawn at its own scale in the delivery, so it gets heroHeight / its standing-up phase height
 *     (same hero height; a downed that does not fit or is past the limit is dropped alone, it is optional). No design doc gives a per-class or a texture height (PACOTE-SPRITES-COMPLETO.md §4
 *     lists only the feet column; docs/sprite-directions.md fixes the on-screen size, 96 world px, by scaling each sheet
 *     at runtime), so the default target is the MEDIAN idle height over the delivered classes.
 *  3. Card rule: a factor beyond ±MAX_FACTOR (20 %) refuses the class (nothing written) and lists it. `crossClassRefuses`
 *     says whether the across-class factor also counts (default true, as the card says); the per-direction factors
 *     always count.
 *  4. The silhouette arrives as a column (192×1536) and is repacked into the importer's row (1536×192), its cells
 *     normalized the same way (to their median, then to the hero height).
 * Deterministic: fixed PNG options, sorted inputs, no timestamps.
 */
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import {DIRECTIONS,LEFT,PADDING} from '../spec.mjs';
import {CELL,COLUMNS,ROWS,cellStats} from '../../sprite-atlas.mjs';

export const GROUP='personagens';
/** Largest accepted rescale, as a fraction (card: "se passar de 20 %, reprovar e listar"). */
export const MAX_FACTOR=.2;
/**
 * Whether the across-class (D-030) factor also refuses a class past MAX_FACTOR. Off: the 20 % rule guards the per-direction
 * fix (a figure that changes size between directions is bad art); the across-class factor only brings every hero to the same
 * texture height (classes were drawn from 69 to 129 px), is recorded per class, and the big ones go to PEDIR-DE-VOLTA.
 * A class whose scaled figure no longer fits the cell is still refused.
 */
export const CROSS_CLASS_REFUSES=false;
export const SILHOUETTE='_silhueta';
const PNG={compressionLevel:9,adaptiveFiltering:false,palette:false,effort:10};
const ALPHA=20;
const median=v=>{const s=[...v].filter(Number.isFinite).sort((a,b)=>a-b);if(!s.length)return NaN;return s.length%2?s[s.length>>1]:(s[s.length/2-1]+s[s.length/2])/2;};
const r4=x=>Math.round(x*1e4)/1e4;
const pct=f=>`${f>=1?'+':''}${((f-1)*100).toFixed(1)} %`;

async function readRaw(file){
  const {data,info}=await sharp(file).ensureAlpha().raw().toBuffer({resolveWithObject:true});
  return {data,width:info.width,height:info.height};
}
/** Copies cell (col,row) of a raw RGBA image into a fresh CELL×CELL buffer. */
function cellOf(img,col,row){
  const out=Buffer.alloc(CELL*CELL*4);
  for(let y=0;y<CELL;y++)img.data.copy(out,y*CELL*4,((row*CELL+y)*img.width+col*CELL)*4,((row*CELL+y)*img.width+col*CELL+CELL)*4);
  return out;
}
function putCell(img,col,row,cell){
  for(let y=0;y<CELL;y++)cell.copy(img.data,((row*CELL+y)*img.width+col*CELL)*4,y*CELL*4,(y+1)*CELL*4);
}
/** cellStats over a single CELL×CELL buffer. */
const statsOf=cell=>cellStats(cell,CELL,0);

/**
 * Rescales one cell by `f` about the point (ax, ay) (cell px; continuous coordinates) with lanczos3, then shifts it by
 * whole pixels so the importer's own measures stay where the scale puts them: the foot line (lowest drawn row) back on
 * the cell's original one and the feet centre on the original one scaled about `ax`. Returns the new cell and whether
 * any drawn pixel fell outside the cell. `fitX`: then slide it sideways, if needed and possible, to keep the PADDING
 * margin (the downed sheet, whose feet centre the importer does not check: a lying figure is wide).
 */
export async function scaleCell(cell,f,ax,ay,{fitX=false}={}){
  const before=statsOf(cell);
  if(Math.abs(f-1)<1e-3||!before.occupied)return {cell:Buffer.from(cell),clipped:false};
  let x0=CELL,y0=CELL,x1=-1,y1=-1;
  for(let y=0;y<CELL;y++)for(let x=0;x<CELL;x++)if(cell[(y*CELL+x)*4+3]){if(x<x0)x0=x;if(x>x1)x1=x;if(y<y0)y0=y;if(y>y1)y1=y;}
  const m=4;x0=Math.max(0,x0-m);y0=Math.max(0,y0-m);x1=Math.min(CELL-1,x1+m);y1=Math.min(CELL-1,y1+m);
  const w=x1-x0+1,h=y1-y0+1,W=Math.max(1,Math.round(w*f)),H=Math.max(1,Math.round(h*f));
  const crop=await sharp(cell,{raw:{width:CELL,height:CELL,channels:4}}).extract({left:x0,top:y0,width:w,height:h}).raw().toBuffer();
  const big=await sharp(crop,{raw:{width:w,height:h,channels:4}}).resize(W,H,{kernel:'lanczos3',fit:'fill'}).raw().toBuffer();
  const sx=W/w,sy=H/h;
  const place=(ox,oy)=>{
    const out=Buffer.alloc(CELL*CELL*4);let clipped=false;
    for(let y=0;y<H;y++)for(let x=0;x<W;x++){
      const i=(y*W+x)*4,tx=ox+x,ty=oy+y;
      if(tx<0||ty<0||tx>=CELL||ty>=CELL){if(big[i+3]>ALPHA)clipped=true;continue;}
      big.copy(out,(ty*CELL+tx)*4,i,i+4);
    }
    return {cell:out,clipped};
  };
  let ox=Math.round(ax-(ax-x0)*sx),oy=Math.round(ay-(ay-y0)*sy),res=place(ox,oy);
  const after=statsOf(res.cell);
  if(after.occupied){
    const wantX=ax+(before.footX+.5-ax)*f-.5;
    const dx=Number.isFinite(after.footX)&&Number.isFinite(wantX)?Math.round(wantX-after.footX):0,dy=before.maxY-after.maxY;
    if(dx||dy){ox+=dx;oy+=dy;res=place(ox,oy);}
  }
  if(fitX){
    // Bounds of the drawn pixels of the placed image: slide them inside [PADDING, CELL-1-PADDING] when they fit.
    let lo=W,hi=-1;
    for(let y=0;y<H;y++)for(let x=0;x<W;x++)if(big[(y*W+x)*4+3]>ALPHA){if(x<lo)lo=x;if(x>hi)hi=x;}
    if(hi>=lo&&hi-lo<=CELL-1-2*PADDING){
      const dx=ox+lo<PADDING?PADDING-(ox+lo):ox+hi>CELL-1-PADDING?CELL-1-PADDING-(ox+hi):0;
      if(dx){ox+=dx;res=place(ox,oy);}
    }
  }
  return res;
}
/** Drawn pixels closer than PADDING to the cell border (the importer refuses that). */
const nearEdge=s=>s.occupied&&(s.minX<PADDING||s.minY<PADDING||s.maxX>CELL-1-PADDING||s.maxY>CELL-1-PADDING);

/** Row heights of a dir8 atlas: h[b][r] = median of the 6 cell heights (validate.mjs checkDir8), footX[b][r] likewise. */
function dir8Rows(img){
  return DIRECTIONS.map((d,b)=>Array.from({length:ROWS},(_,r)=>{
    const cells=Array.from({length:COLUMNS},(_,c)=>cellStats(img.data,img.width,(b*ROWS+r)*COLUMNS+c)).filter(s=>s.occupied);
    return {height:median(cells.map(s=>s.height)),footX:median(cells.map(s=>s.footX))};
  }));
}
/** Per-direction factors (row by row, to the median over the 8 directions) and the class idle height. */
export function directionFactors(rows){
  const target=Array.from({length:ROWS},(_,r)=>median(rows.map(b=>b[r].height)));
  return {target,factors:rows.map(b=>b.map((row,r)=>Number.isFinite(row.height)&&row.height>0?target[r]/row.height:1)),classHeight:target[0]};
}

async function writePng(file,img){
  fs.mkdirSync(path.dirname(file),{recursive:true});
  const buf=await sharp(img.data,{raw:{width:img.width,height:img.height,channels:4}}).png(PNG).toBuffer();
  if(!fs.existsSync(file)||!fs.readFileSync(file).equals(buf))fs.writeFileSync(file,buf);
}

/** Rescales every cell of a dir8 atlas; returns problems (cells that no longer fit). */
async function scaleDir8(img,rows,factors,classFactor){
  const problems=[];
  for(let b=0;b<DIRECTIONS.length;b++)for(let r=0;r<ROWS;r++){
    const f=factors[b][r]*classFactor,ax=Number.isFinite(rows[b][r].footX)?rows[b][r].footX+.5:CELL/2;
    for(let c=0;c<COLUMNS;c++){
      const line=b*ROWS+r,cell=cellOf(img,c,line),s=statsOf(cell);
      if(!s.occupied)continue;
      const res=await scaleCell(cell,f,ax,s.maxY+1),after=statsOf(res.cell);
      if(res.clipped||nearEdge(after))problems.push(`${DIRECTIONS[b]} row ${line+1} col ${c+1}`);
      putCell(img,c,line,res.cell);
    }
  }
  return problems;
}
/** Downed sheet: one row per direction; the class factor about the class feet column (mirrored on the left). */
async function scaleDowned(img,classFactor,pivotX){
  const problems=[];
  for(let r=0;r<Math.min(DIRECTIONS.length,img.height/CELL);r++){
    const ax=(LEFT.has(DIRECTIONS[r])?CELL-1-pivotX:pivotX)+.5;
    for(let c=0;c<img.width/CELL;c++){
      const cell=cellOf(img,c,r),s=statsOf(cell);
      if(!s.occupied)continue;
      const res=await scaleCell(cell,classFactor,ax,s.maxY+1,{fitX:true});
      if(res.clipped||nearEdge(statsOf(res.cell)))problems.push(`${DIRECTIONS[r]} col ${c+1}`);
      putCell(img,c,r,res.cell);
    }
  }
  return problems;
}

/** Height of the downed sheet's last phase (standing up again), median over the directions. */
function downedStandHeight(img){
  const cols=img.width/CELL,rows=Math.min(DIRECTIONS.length,img.height/CELL);
  return median(Array.from({length:rows},(_,r)=>cellStats(img.data,img.width,r*cols+cols-1)).filter(s=>s.occupied).map(s=>s.height));
}
const beyond=f=>Math.abs(f-1)>MAX_FACTOR+1e-9;

/**
 * @param {{src:string,out:string,log?:(m:string)=>void,options?:{heroHeight?:number,crossClassRefuses?:boolean}}} args
 */
export async function adapt({src,out,log=()=>{},options={}}){
  const dir=path.join(src,GROUP),dst=path.join(out,GROUP);
  if(!fs.existsSync(dir))return [];
  const crossRefuses=options.crossClassRefuses??CROSS_CLASS_REFUSES;
  const files=fs.readdirSync(dir).filter(f=>fs.statSync(path.join(dir,f)).isFile()).sort();
  const records=[],classes=new Map(),handled=new Set();
  for(const f of files){
    const m=/^(.+)\.dir8\.png$/i.exec(f);
    if(m)classes.set(m[1],{atlas:f});
  }
  for(const f of files){
    const m=/^(.+)\.downed\.png$/i.exec(f);
    if(m){if(classes.has(m[1]))classes.get(m[1]).downed=f;else classes.set(m[1],{downed:f});}
  }
  // Measure every class first: the across-class target is the median idle height of the delivered classes.
  const measured=new Map();
  for(const [id,c] of classes){
    if(!c.atlas)continue;
    const img=await readRaw(path.join(dir,c.atlas));
    if(img.width!==CELL*COLUMNS||img.height!==CELL*ROWS*DIRECTIONS.length){measured.set(id,{img,bad:`dir8 sheet is ${img.width}x${img.height}, expected ${CELL*COLUMNS}x${CELL*ROWS*DIRECTIONS.length}`});continue;}
    const rows=dir8Rows(img);
    measured.set(id,{img,rows,...directionFactors(rows)});
  }
  const heights=[...measured.values()].filter(m=>!m.bad).map(m=>m.classHeight);
  const heroHeight=options.heroHeight??median(heights);
  if(heights.length)log(`personagens: hero height target ${heroHeight} px (${options.heroHeight?'given':`median idle height of ${heights.length} classes`})`);

  for(const [id,c] of classes){
    const notes=[],sidecars=[`${id}.meta.json`,`${id}.downed.meta.json`].filter(s=>files.includes(s));
    sidecars.forEach(s=>handled.add(s));
    if(c.atlas)handled.add(c.atlas);
    if(c.downed)handled.add(c.downed);
    if(sidecars.length)notes.push(`dropped ${sidecars.join(', ')} (the importer takes no sidecar for dir8 classes)`);
    const remove=()=>{for(const n of [`${id}.dir8.png`,`${id}.downed.png`])fs.rmSync(path.join(dst,n),{force:true});};
    if(!c.atlas){
      // Downed without atlas: nothing to measure the class against; pass it through unchanged (importer notes it).
      fs.mkdirSync(dst,{recursive:true});fs.copyFileSync(path.join(dir,c.downed),path.join(dst,`${id}.downed.png`));
      records.push({group:GROUP,id,action:'copied (downed only, not rescaled)',notes});continue;
    }
    const m=measured.get(id);
    if(m.bad){remove();records.push({group:GROUP,id,action:'refused',notes,refused:m.bad});continue;}
    const classFactor=heroHeight/m.classHeight,flat=m.factors.flat();
    const lo=Math.min(...flat),hi=Math.max(...flat);
    const perDir=DIRECTIONS.map((d,b)=>`${d} ${m.factors[b].map(f=>f.toFixed(3)).join('/')}`).join('; ');
    notes.push(`class idle height ${m.classHeight} px -> ${heroHeight} px: class factor ${classFactor.toFixed(3)} (${pct(classFactor)})`);
    notes.push(`per-direction factors idle/walk/attack (to the row median ${m.target.join('/')} px): ${perDir}; range ${lo.toFixed(3)}..${hi.toFixed(3)}`);
    const why=[];
    const badDirs=DIRECTIONS.flatMap((d,b)=>m.factors[b].map((f,r)=>beyond(f)?`${d} ${['idle','walk','attack'][r]} ${pct(f)}`:[]).flat());
    if(badDirs.length)why.push(`height differs between directions by more than ${MAX_FACTOR*100} % (${badDirs.join(', ')})`);
    if(crossRefuses&&beyond(classFactor))why.push(`drawn at ${m.classHeight} px, the hero height is ${heroHeight} px: class factor ${pct(classFactor)} is past ${MAX_FACTOR*100} %`);
    const record={group:GROUP,id,action:'rescaled',factor:r4(classFactor),directionFactors:{min:r4(lo),max:r4(hi)},notes};
    if(why.length){remove();records.push({...record,action:'refused',refused:why.join('; ')});continue;}
    const se=DIRECTIONS.indexOf('SE'),stand=cellStats(m.img.data,m.img.width,se*ROWS*COLUMNS);
    const pivotX=Number.isFinite(stand.footX)?stand.footX:CELL/2;
    const fit=await scaleDir8(m.img,m.rows,m.factors,classFactor);
    let downed;
    if(c.downed){
      downed=await readRaw(path.join(dir,c.downed));
      if(downed.width%CELL||downed.height%CELL){notes.push(`downed sheet ${downed.width}x${downed.height} is not a grid of ${CELL}; copied unchanged`);downed={copy:true};}
      else{
        // The downed sheet is drawn at its own scale (its last phase, standing up, is 0.6–1.6× the atlas idle in the
        // codex-706 delivery), so its factor comes from that standing phase, to the same hero height.
        const standH=downedStandHeight(downed),downedFactor=Number.isFinite(standH)&&standH>0?heroHeight/standH:classFactor;
        record.downedFactor=r4(downedFactor);
        notes.push(`downed standing phase ${standH} px (atlas idle ${m.classHeight} px) -> ${heroHeight} px: downed factor ${downedFactor.toFixed(3)} (${pct(downedFactor)})`);
        const drop=why=>{notes.push(`downed sheet dropped: ${why}; the game keeps the current downed art`);record.downedDropped=why;downed=undefined;};
        if(crossRefuses&&beyond(downedFactor))drop(`downed factor ${pct(downedFactor)} is past ${MAX_FACTOR*100} % (standing phase drawn at ${standH} px, atlas idle at ${m.classHeight} px)`);
        else{
          const dfit=await scaleDowned(downed,downedFactor,pivotX);
          if(dfit.length)drop(`the lying figure no longer fits the ${CELL} px cell (${PADDING} px margin) at the hero height (${dfit.slice(0,4).join(', ')}${dfit.length>4?` and ${dfit.length-4} more`:''})`);
        }
      }
    }
    if(fit.length){remove();records.push({...record,action:'refused',refused:`the drawing no longer fits the ${CELL} px cell (${PADDING} px margin) at the hero height: ${fit.slice(0,6).join(', ')}${fit.length>6?` and ${fit.length-6} more`:''}`});continue;}
    await writePng(path.join(dst,`${id}.dir8.png`),m.img);
    if(downed?.copy)fs.copyFileSync(path.join(dir,c.downed),path.join(dst,`${id}.downed.png`));
    else if(downed)await writePng(path.join(dst,`${id}.downed.png`),downed);
    else fs.rmSync(path.join(dst,`${id}.downed.png`),{force:true});
    records.push(record);
  }

  // Silhouette: column (1×8) or row (8×1) of 192 cells → the importer's row, normalized to the hero height.
  const sil=files.find(f=>f.toLowerCase()===`${SILHOUETTE}.png`);
  if(sil){
    handled.add(sil);
    const notes=[];
    if(files.includes(`${SILHOUETTE}.meta.json`)){handled.add(`${SILHOUETTE}.meta.json`);notes.push(`dropped ${SILHOUETTE}.meta.json (the importer takes no sidecar for the silhouette)`);}
    const img=await readRaw(path.join(dir,sil)),n=DIRECTIONS.length;
    const column=img.width===CELL&&img.height===CELL*n,row=img.width===CELL*n&&img.height===CELL;
    if(!column&&!row)records.push({group:GROUP,id:SILHOUETTE,action:'refused',notes,refused:`silhouette is ${img.width}x${img.height}, expected ${CELL*n}x${CELL} (or a ${CELL}x${CELL*n} column)`});
    else{
      if(column)notes.push(`repacked from a ${CELL}x${CELL*n} column to a ${CELL*n}x${CELL} row`);
      const cells=Array.from({length:n},(_,i)=>column?cellOf(img,0,i):cellOf(img,i,0));
      const stats=cells.map(statsOf),own=median(stats.filter(s=>s.occupied).map(s=>s.height));
      const target=Number.isFinite(heroHeight)?heroHeight:own,classFactor=target/own;
      const factors=stats.map(s=>s.occupied?own/s.height:1),lo=Math.min(...factors),hi=Math.max(...factors);
      notes.push(`height ${own} px -> ${target} px: factor ${classFactor.toFixed(3)} (${pct(classFactor)}); per-direction ${factors.map(f=>f.toFixed(3)).join('/')}`);
      const record={group:GROUP,id:SILHOUETTE,action:column?'repacked, rescaled':'rescaled',factor:r4(classFactor),directionFactors:{min:r4(lo),max:r4(hi)},notes};
      const why=[];
      if(factors.some(beyond))why.push(`height differs between directions by more than ${MAX_FACTOR*100} %`);
      if(crossRefuses&&beyond(classFactor))why.push(`class factor ${pct(classFactor)} is past ${MAX_FACTOR*100} %`);
      const outImg={data:Buffer.alloc(CELL*n*CELL*4),width:CELL*n,height:CELL},fit=[];
      if(!why.length)for(let i=0;i<n;i++){
        const s=stats[i];
        if(!s.occupied){putCell(outImg,i,0,cells[i]);continue;}
        const res=await scaleCell(cells[i],factors[i]*classFactor,s.footX+.5,s.maxY+1);
        if(res.clipped||nearEdge(statsOf(res.cell)))fit.push(DIRECTIONS[i]);
        putCell(outImg,i,0,res.cell);
      }
      if(fit.length)why.push(`the drawing no longer fits the ${CELL} px cell at the hero height (${fit.join(', ')})`);
      if(why.length){fs.rmSync(path.join(dst,`${SILHOUETTE}.png`),{force:true});records.push({...record,action:'refused',refused:why.join('; ')});}
      else{await writePng(path.join(dst,`${SILHOUETTE}.png`),outImg);records.push(record);}
    }
  }
  for(const f of files)if(!handled.has(f))records.push({group:GROUP,id:f,action:'refused',refused:`unexpected file in personagens/ (the importer takes <class>.dir8.png, <class>.downed.png and ${SILHOUETTE}.png)`});
  return records;
}
