/**
 * Delivery adapter for the enemies, group `inimigos`. Contract: scripts/art-v2/adaptar-entrega.mjs. Importer rules:
 * scripts/art-v2/validate.mjs (validateAnimations/checkGrid) and spec.mjs (AIRBORNE_ANIMS, LUNGE_ANIMS, tolerances).
 *
 * Each enemy folder `inimigos/<id>/` holds `meta.json` {"cell":[w,h],"anchor":[ax,ay],"fps":{…}} and one sheet per
 * animation (`<anim>.png`: one row per direction, S…SE, N frames of the cell). The folder is copied to
 * `out/inimigos/<id>/`; the sheets are only TRANSLATED cell by cell, never rescaled (each enemy has its own size):
 *  1. Empty cell inside a row (a frame the export dropped): filled with the last drawn frame before it in that row (the
 *     first drawn one after it when it opens the row). Noted on the record.
 *  2. Foot column, per direction: the median foot centre (the importer's measure: mean x of the 6 lowest drawn rows) of
 *     that direction's row over the GROUNDED animations (not airborne, not lunge; lunge ones when there is no grounded
 *     one) is moved to anchor[0]×w. The same shift goes to every animation of that direction, airborne ones included, so
 *     the enemy does not pop sideways between animations. A grounded cell still past FOOT_X_TOLERANCE after that is
 *     nudged just inside it (that frame alone). Airborne and lunge rows have no foot-column rule, so there the shift is
 *     clamped, one value per row, to what keeps all its frames inside the margin (noted).
 *  3. Ground line, per frame: grounded and lunge cells get their lowest drawn row on round(anchor[1]×h). Airborne
 *     animations (fly, death, hit, throw…: the importer applies no foot rule to them) never move vertically.
 *  4. A required shift (grounded foot column, ground line) that would put the drawing closer than PADDING to the cell
 *     border (or out of it) refuses the enemy: no
 *     file of it is written and the reason lists the cells.
 * The elite layer `inimigos/elite/<id>-<anim>.png`, if any, gets the same per-cell shifts as its base sheet.
 * Record per enemy: action, `shifts` {anim: max |px| moved in that sheet}, notes. Deterministic: fixed PNG options,
 * sorted inputs, untouched sheets copied byte for byte.
 */
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import {AIRBORNE_ANIMS,LUNGE_ANIMS,ALPHA_THRESHOLD,PADDING,FOOT_X_TOLERANCE,DIRECTIONS} from '../spec.mjs';
import {cellBox} from '../validate.mjs';

export const GROUP='inimigos';
const PNG={compressionLevel:9,adaptiveFiltering:false,palette:false,effort:10};
const median=v=>{const s=v.filter(Number.isFinite).sort((a,b)=>a-b);if(!s.length)return NaN;return s.length%2?s[s.length>>1]:(s[s.length/2-1]+s[s.length/2])/2;};

async function readRaw(file){
  const {data,info}=await sharp(file).ensureAlpha().raw().toBuffer({resolveWithObject:true});
  return {data,width:info.width,height:info.height};
}
function getCell(img,cw,ch,c,r){
  const out=Buffer.alloc(cw*ch*4);
  for(let y=0;y<ch;y++)img.data.copy(out,y*cw*4,((r*ch+y)*img.width+c*cw)*4,((r*ch+y)*img.width+c*cw+cw)*4);
  return out;
}
function putCell(img,cw,ch,c,r,cell){
  for(let y=0;y<ch;y++)cell.copy(img.data,((r*ch+y)*img.width+c*cw)*4,y*cw*4,(y+1)*cw*4);
}
/** Moves a cell's content by (dx, dy) whole px; `clipped`: a drawn pixel left the cell. */
export function shiftCell(cell,cw,ch,dx,dy){
  if(!dx&&!dy)return {cell,clipped:false};
  const out=Buffer.alloc(cw*ch*4);let clipped=false;
  for(let y=0;y<ch;y++)for(let x=0;x<cw;x++){
    const i=(y*cw+x)*4;if(!cell[i+3])continue;
    const tx=x+dx,ty=y+dy;
    if(tx<0||ty<0||tx>=cw||ty>=ch){if(cell[i+3]>ALPHA_THRESHOLD)clipped=true;continue;}
    cell.copy(out,(ty*cw+tx)*4,i,i+4);
  }
  return {cell:out,clipped};
}
const kindOf=anim=>AIRBORNE_ANIMS.has(anim)?'airborne':LUNGE_ANIMS.has(anim)?'lunge':'grounded';

/** Fills empty cells of rows that have a drawn one; returns the filled cells as `row r col c`. */
function fillEmpty(img,cw,ch){
  const cols=img.width/cw,rows=img.height/ch,filled=[],emptyRows=[];
  for(let r=0;r<rows;r++){
    const drawn=Array.from({length:cols},(_,c)=>cellBox(img.data,img.width,c*cw,r*ch,cw,ch).occupied>0);
    if(!drawn.some(Boolean)){emptyRows.push(r);continue;}
    for(let c=0;c<cols;c++)if(!drawn[c]){
      let from=c-1;while(from>=0&&!drawn[from])from--;
      if(from<0){from=c+1;while(!drawn[from])from++;}
      putCell(img,cw,ch,c,r,getCell(img,cw,ch,from,r));
      filled.push({r,c,from});
    }
  }
  return {filled,emptyRows};
}

/**
 * Plans and applies the shifts of one enemy. `sheets`: [{anim,img}] (already filled). Returns per anim the shifts
 * matrix [r][c] = [dx,dy], its max |px|, and the cells that would break the margin.
 */
export function recentre(sheets,cell,anchor){
  const [cw,ch]=cell,ax=anchor[0]*cw,ground=Math.round(anchor[1]*ch),tolX=FOOT_X_TOLERANCE*cw;
  const rows=DIRECTIONS.length;
  const pick=kind=>sheets.filter(s=>kindOf(s.anim)===kind);
  const ref=pick('grounded').length?pick('grounded'):pick('lunge');
  const dirShift=Array.from({length:rows},(_,r)=>{
    const feet=ref.flatMap(s=>Array.from({length:s.img.width/cw},(_,c)=>cellBox(s.img.data,s.img.width,c*cw,r*ch,cw,ch)).filter(b=>b.occupied).map(b=>b.footX));
    const m=median(feet);
    return Number.isFinite(m)?Math.round(ax-m):0;
  });
  const out={};
  for(const s of sheets){
    const kind=kindOf(s.anim),cols=s.img.width/cw,shifts=[],bad=[],clamped=[];let max=0;
    for(let r=0;r<Math.min(rows,s.img.height/ch);r++){
      shifts.push([]);
      const boxes=Array.from({length:cols},(_,c)=>cellBox(s.img.data,s.img.width,c*cw,r*ch,cw,ch));
      // Airborne and lunge rows have no foot-column rule: the direction shift is only for consistency, so it is
      // clamped (one value for the whole row, no jump inside the animation) to what keeps every frame in the margin.
      let rowDx=dirShift[r];
      if(kind!=='grounded'){
        const drawn=boxes.filter(b=>b.occupied);
        const lo=Math.max(...drawn.map(b=>PADDING-b.minX)),hi=Math.min(...drawn.map(b=>cw-1-PADDING-b.maxX));
        const fit=drawn.length?(lo<=hi?Math.min(hi,Math.max(lo,rowDx)):0):rowDx;
        if(fit!==rowDx){clamped.push(`${DIRECTIONS[r]} ${rowDx>=0?'+':''}${rowDx}->${fit>=0?'+':''}${fit}`);rowDx=fit;}
      }
      for(let c=0;c<cols;c++){
        const b=boxes[c];
        if(!b.occupied){shifts[r].push([0,0]);continue;}
        let dx=rowDx;
        if(kind==='grounded'){
          const err=b.footX+dx-ax;
          if(Math.abs(err)>tolX)dx-=Math.sign(err)*Math.ceil(Math.abs(err)-tolX+1);
        }
        const dy=kind==='airborne'?0:ground-b.maxY;
        shifts[r].push([dx,dy]);
        if(!dx&&!dy)continue;
        max=Math.max(max,Math.abs(dx),Math.abs(dy));
        const res=shiftCell(getCell(s.img,cw,ch,c,r),cw,ch,dx,dy),after=cellBox(res.cell,cw,0,0,cw,ch);
        if(res.clipped||after.nearEdge)bad.push(`${DIRECTIONS[r]} col ${c+1} (${dx>=0?'+':''}${dx},${dy>=0?'+':''}${dy})`);
        putCell(s.img,cw,ch,c,r,res.cell);
      }
    }
    out[s.anim]={shifts,max,bad,clamped,dirShift};
  }
  return out;
}

async function writePng(file,img){
  const buf=await sharp(img.data,{raw:{width:img.width,height:img.height,channels:4}}).png(PNG).toBuffer();
  fs.writeFileSync(file,buf);
}

/** @param {{src:string,out:string,log?:(m:string)=>void}} args */
export async function adapt({src,out,log=()=>{}}){
  const dir=path.join(src,GROUP),dst=path.join(out,GROUP);
  if(!fs.existsSync(dir))return [];
  const ids=fs.readdirSync(dir).filter(f=>f!=='elite'&&fs.statSync(path.join(dir,f)).isDirectory()).sort();
  const eliteDir=path.join(dir,'elite'),eliteFiles=fs.existsSync(eliteDir)?fs.readdirSync(eliteDir).sort():[];
  const records=[],eliteHandled=new Set();
  for(const id of ids){
    const from=path.join(dir,id),to=path.join(dst,id),notes=[];
    const files=fs.readdirSync(from).filter(f=>fs.statSync(path.join(from,f)).isFile()).sort();
    const refuse=why=>{fs.rmSync(to,{recursive:true,force:true});records.push({group:GROUP,id,action:'refused',notes,refused:why});};
    let meta;
    try{meta=JSON.parse(fs.readFileSync(path.join(from,'meta.json'),'utf8'));}catch{refuse('meta.json missing or not valid JSON');continue;}
    const cell=meta.cell,anchor=meta.anchor;
    if(!(Array.isArray(cell)&&cell.length===2&&cell.every(n=>Number.isInteger(n)&&n>0))||!(Array.isArray(anchor)&&anchor.length===2)){refuse('meta.json without a valid "cell" [w,h] and "anchor" [x,y]');continue;}
    const [cw,ch]=cell,sheets=[],grid=[];
    for(const f of files.filter(f=>/\.png$/i.test(f))){
      const img=await readRaw(path.join(from,f));
      if(img.width%cw||img.height!==DIRECTIONS.length*ch){grid.push(`${f} is ${img.width}x${img.height}, not ${DIRECTIONS.length} rows of ${cw}x${ch} cells`);continue;}
      const anim=f.slice(0,-4),{filled,emptyRows}=fillEmpty(img,cw,ch);
      if(emptyRows.length)grid.push(`${f}: row(s) ${emptyRows.map(r=>DIRECTIONS[r]).join(', ')} fully empty`);
      if(filled.length)notes.push(`${anim}: empty cell(s) filled with the previous frame: ${filled.map(x=>`${DIRECTIONS[x.r]} col ${x.c+1} <- col ${x.from+1}`).join(', ')}`);
      sheets.push({anim,file:f,img,filled:filled.length>0});
    }
    if(grid.length){refuse(grid.join('; '));continue;}
    const plan=recentre(sheets,cell,anchor);
    const bad=sheets.flatMap(s=>plan[s.anim].bad.map(b=>`${s.anim} ${b}`));
    if(bad.length){refuse(`a shift would put the drawing within ${PADDING} px of the cell border: ${bad.slice(0,6).join(', ')}${bad.length>6?` and ${bad.length-6} more`:''}`);continue;}
    const dirShift=sheets.length?plan[sheets[0].anim].dirShift:[];
    if(dirShift.some(Boolean))notes.push(`foot column per direction (${DIRECTIONS.join('/')}): ${dirShift.map(d=>`${d>=0?'+':''}${d}`).join('/')} px`);
    for(const s of sheets)if(plan[s.anim].clamped.length)notes.push(`${s.anim}: direction shift reduced to fit the cell margin: ${plan[s.anim].clamped.join(', ')}`);
    fs.rmSync(to,{recursive:true,force:true});fs.mkdirSync(to,{recursive:true});
    const shifts={};let changed=false;
    for(const f of files)if(!/\.png$/i.test(f))fs.copyFileSync(path.join(from,f),path.join(to,f));
    for(const s of sheets){
      const p=plan[s.anim];shifts[s.anim]=p.max;
      if(p.max||s.filled){changed=true;await writePng(path.join(to,s.file),s.img);}
      else fs.copyFileSync(path.join(from,s.file),path.join(to,s.file));
      // Elite layer: same shifts as the base sheet, so the badge stays on the figure.
      const ef=eliteFiles.find(e=>e===`${id}-${s.anim}.png`);
      if(ef){
        eliteHandled.add(ef);fs.mkdirSync(path.join(dst,'elite'),{recursive:true});
        const eimg=await readRaw(path.join(eliteDir,ef));
        if(p.max&&eimg.width===s.img.width&&eimg.height===s.img.height){
          p.shifts.forEach((row,r)=>row.forEach(([dx,dy],c)=>{if(dx||dy)putCell(eimg,cw,ch,c,r,shiftCell(getCell(eimg,cw,ch,c,r),cw,ch,dx,dy).cell);}));
          await writePng(path.join(dst,'elite',ef),eimg);notes.push(`elite/${ef}: same shifts as ${s.file}`);
        }else fs.copyFileSync(path.join(eliteDir,ef),path.join(dst,'elite',ef));
      }
    }
    const max=Math.max(0,...Object.values(shifts));
    log(`inimigos/${id}: max shift ${max} px`);
    records.push({group:GROUP,id,action:changed?'recentred':'copied',shifts,notes});
  }
  for(const ef of eliteFiles)if(!eliteHandled.has(ef)){
    fs.mkdirSync(path.join(dst,'elite'),{recursive:true});fs.copyFileSync(path.join(eliteDir,ef),path.join(dst,'elite',ef));
    records.push({group:GROUP,id:`elite/${ef}`,action:'copied',notes:['no base sheet in this delivery: copied unchanged']});
  }
  return records;
}
