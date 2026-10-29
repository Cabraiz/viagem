// Saci elite import (NEW-20261029-ORQ-saci-elite-no-jogo): E1's sheets of the aberração-saci (body + real cast shadow,
// one row per direction S, SW, W, NW, N, NE, E, SE, a different frame count per row) into the enemies group.
//   node scripts/import-saci.mjs [--from <folder with saci-<anim>-8dir.png/-sombra.png/.json>]
// Every row is shifted up or down so its foot stands on the same ground line of the cell (two rows of E1's sheet stand
// 10 px higher: one anchor would put those directions in the air), body and shadow by the same offset so the shadow
// stays under the foot. Across, the rows keep E1's placement: the saci hops on one leg, and that foot circles his body
// as he turns, so the body's axis (the middle of the figure, the anchor) is what stays put. Writes public/art/enemies/saci/<anim>.webp and <anim>-sombra.webp (lossless), the piece
// `aberracao-saci` in public/art/enemies/manifest.json (files <anim> and shadow/<anim>, `dirFrames` per row), the
// client index and the enemy art ids. Run `node scripts/art-lite.mjs --kinds enemies,enemies-pc` after it.
// No walk yet: the idle is the only loop (the renderer falls back to it when moving); a walk sheet in the folder
// (saci-walk-8dir.png) is imported the same way.
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {GROUPS} from './art-v2/spec.mjs';
import {WEBP,writeIndex} from './art-v2/convert.mjs';
import {writeEnemyArtIds} from './art-v2/enemy-art-ids.mjs';

const ROOT=join(dirname(fileURLToPath(import.meta.url)),'..');
const sharp=createRequire(import.meta.url)('sharp');
export const SACI_ID='aberracao-saci',SACI_DIR='saci';
export const DIRS=['s','sw','w','nw','n','ne','e','se'];
const FROM_DEFAULT='D:/Gits/viagem-board/evidence/NEW-20261029-ORQ-aberracao-saci-no-angulo/anim';
const MANIFEST=join(ROOT,'public/art/enemies/manifest.json');
const sha256=b=>createHash('sha256').update(b).digest('hex');
/** Opaque body (the shadow sheet is fainter, alpha ≤ 89: only the body is measured). */
const SOLID=128;

/**
 * Ground point {x, y} of row `r` of a raw RGBA sheet (`cell` px cells, `frames` used columns), in cell coordinates:
 * y the lowest opaque (alpha ≥ SOLID) line of any frame of the row, x the middle of the row's opaque pixels.
 */
export function groundPoint({data,width},cell,r,frames){
  let bottom=-1,minX=cell,maxX=-1;
  for(let c=0;c<frames;c++)for(let y=0;y<cell;y++)for(let x=0;x<cell;x++)
    if(data[((r*cell+y)*width+c*cell+x)*4+3]>=SOLID){bottom=Math.max(bottom,y);minX=Math.min(minX,x);maxX=Math.max(maxX,x);}
  return bottom<0?undefined:{x:Math.round((minX+maxX)/2),y:bottom};
}
/** `sheet` with row `r` of every cell moved by (dx, dy) (pixels pushed out of the cell are dropped and reported). */
export function shiftRows({data,width,height},cell,shifts){
  const out=Buffer.alloc(data.length);let lost=0;
  for(let i=0;i<data.length;i+=4){
    const p=i/4,x=p%width,y=(p/width)|0,r=(y/cell)|0,s=shifts[r]??{dx:0,dy:0};
    if(!data[i+3])continue;
    const cx=x%cell+s.dx,cy=y%cell+s.dy;
    if(cx<0||cy<0||cx>=cell||cy>=cell){lost++;continue;}
    const o=((r*cell+cy)*width+(x-x%cell)+cx)*4;data.copy(out,o,i,i+4);
  }
  return {data:out,width,height,lost};
}
const raw=async file=>{const {data,info}=await sharp(file).ensureAlpha().raw().toBuffer({resolveWithObject:true});return {data,width:info.width,height:info.height};};
const webp=s=>sharp(s.data,{raw:{width:s.width,height:s.height,channels:4}}).webp(WEBP).toBuffer();

/** One animation: {file entries (body and shadow), the target ground point}. */
async function importAnim(from,anim,ground){
  const meta=JSON.parse(readFileSync(join(from,`saci-${anim}-8dir.json`),'utf8'));
  const cell=meta.celula,order=meta.ordem;
  if(String(order)!==String(DIRS))throw new Error(`${anim}: ordem ${order} ≠ ${DIRS}`);
  const dirFrames=DIRS.map(d=>meta.quadros[d]),frames=Math.max(...dirFrames),fps=Math.round(1000/meta.ms);
  const body=await raw(join(from,`saci-${anim}-8dir.png`)),shadow=await raw(join(from,`saci-${anim}-8dir-sombra.png`));
  if(body.width!==cell*frames||body.height!==cell*DIRS.length)throw new Error(`${anim}: folha ${body.width}×${body.height} ≠ ${frames}×${DIRS.length} células de ${cell}`);
  const points=DIRS.map((_,r)=>groundPoint(body,cell,r,dirFrames[r]));
  ground??=points[0];
  const shifts=points.map(p=>({dx:0,dy:ground.y-p.y}));
  const files={};
  for(const [key,name,sheet] of [[anim,`${anim}.webp`,body],[`shadow/${anim}`,`${anim}-sombra.webp`,shadow]]){
    const moved=shiftRows(sheet,cell,shifts),buffer=await webp(moved),file=`${SACI_DIR}/${name}`,hash=sha256(buffer);
    mkdirSync(join(ROOT,'public/art/enemies',SACI_DIR),{recursive:true});
    writeFileSync(join(ROOT,'public/art/enemies',file),buffer);
    files[key]={file,cell:[cell,cell],frames,directions:DIRS.length,dirFrames,anchor:[ground.x/cell,ground.y/cell],fps,
      pages:[{file,columns:frames,rows:DIRS.length,firstFrame:0,frameCount:frames*DIRS.length,sha256:hash}],sha256:hash};
    console.error(file,`${Math.round(buffer.length/1024)} KB`,`deslocado ${shifts.map((s,r)=>s.dx||s.dy?`${DIRS[r]}(${s.dx},${s.dy})`:'').filter(Boolean).join(' ')||'nada'}`,moved.lost?`${moved.lost} px perdidos`:'');
    if(moved.lost)throw new Error(`${file}: ${moved.lost} px saíram da célula`);
  }
  return {files,ground};
}

export async function importSaci(from=FROM_DEFAULT){
  let ground;const files={};
  for(const anim of ['idle','walk']){
    if(!existsSync(join(from,`saci-${anim}-8dir.png`)))continue;
    const r=await importAnim(from,anim,ground);ground=r.ground;Object.assign(files,r.files);
  }
  if(!files.idle)throw new Error(`sem saci-idle-8dir.png em ${from}`);
  const manifest=JSON.parse(readFileSync(MANIFEST,'utf8'));
  const piece={kind:'animations',files,meta:{eliteArt:true},
    sha256:sha256(Object.entries(files).map(([k,f])=>`${k} ${f.sha256}`).sort().join('\n'))};
  manifest.pieces=Object.fromEntries(Object.entries({...manifest.pieces,[SACI_ID]:piece}).sort(([a],[b])=>a.localeCompare(b)));
  writeFileSync(MANIFEST,JSON.stringify(manifest,null,2)+'\n');
  await writeIndex({inimigos:GROUPS.inimigos},{outRoot:ROOT});
  await writeEnemyArtIds({outRoot:ROOT});
  return piece;
}

if(process.argv[1]&&fileURLToPath(import.meta.url)===process.argv[1]){
  const i=process.argv.indexOf('--from');
  await importSaci(i<0?undefined:process.argv[i+1]);
}
