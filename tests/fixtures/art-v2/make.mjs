/**
 * SYNTHETIC art v2 deliveries for tests/tools/import-art-v2.test.ts (NEW-20261012-ORQ-importador-arte-a). No real art:
 * every piece is a flat figure drawn into a raw RGBA buffer and saved as PNG with sharp, in the `arte-entrada/` layout
 * of scripts/art-v2/spec.mjs. Sizes are small (enemy cell 64, tiles 32, icons 32) and the test passes matching
 * `groups` overrides (TEST_*); only the dir8 atlas keeps the real 1152×4608, because its cell and foot column are fixed.
 *
 * makeCorrectSet(root, {repoRoot}) writes one correct piece per format; makeErrorSet(root, {repoRoot}) writes one broken
 * piece per fault (ids in ENEMY_FAULTS and the other *_BROKEN constants). Pure functions of their arguments.
 */
import sharp from 'sharp';
import {mkdirSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {DIRECTIONS,LEFT,ANCHOR} from '../../../scripts/art-v2/spec.mjs';
import {approvedPivotX,CELL,PIVOT_Y,COLUMNS} from '../../../scripts/sprite-atlas.mjs';

/** Reduced enemy used by every enemy piece: cell 64, idle 2 + walk 2 frames, 8 directions. */
export const TEST_ENEMY=Object.freeze({cell:64,anims:Object.freeze({idle:2,walk:2})});
/** Size of the seamless tiles and of the UI icons in the test groups. */
export const TEST_TILE=32,TEST_ICON=32;
/** Building with 4 camera views × 2 named rows. */
export const TEST_VIEWS=Object.freeze({cell:[32,48],views:4,rows:['inteiro','quebrado'],anchor:[...ANCHOR]});
/** Nine-slice frame (a sign plate). */
export const TEST_NINESLICE=Object.freeze({kind:'nineslice',cell:[48,32],slice:[8,8,8,8]});
/** Item strip: 4 square frames of 32. */
export const TEST_FRAMES=Object.freeze({cell:32,frames:4});
/** Classes used for dir8 (real ids with an approved sheet): the correct one and the two broken ones. */
export const DIR8_OK='aposentado',DIR8_WRONG_COLUMN='coach',DIR8_LIFTED='porteiro';
/** Block lifted in DIR8_LIFTED, and by how many px. */
export const LIFTED_DIRECTION='NE',LIFT=20;
/** One flat colour per direction: the block signature used to check the dir8 → dir4 split. */
export const DIRECTION_COLORS=Object.freeze({
  S:[220,40,40],SW:[40,180,40],W:[40,60,220],NW:[220,200,40],N:[200,40,200],NE:[40,200,200],E:[240,130,20],SE:[130,70,20],
});

/** Enemy pieces, one fault each (all in group `inimigos`). */
export const ENEMY_FAULTS=Object.freeze({
  'tamanho-errado':'size','fundo-opaco':'opaque','celula-vazia':'empty','na-borda':'border','pe-fora-linha':'footY',
  'pe-fora-centro':'footX','quadros-errados':'frames','sem-animacoes':'noAnims','sem-meta':'missingMeta',
  'meta-invalido':'badMeta','ancora-errada':'anchor',
});
/** Broken non-enemy pieces, by group. */
export const VIEWS_BROKEN=Object.freeze({wrongViews:'predio-3vistas',wrongRows:'predio-linhas'});
export const FRAMES_BROKEN='moeda-torta';
export const SEAMLESS_BROKEN='neve-emenda',MASK_BROKEN='trans-neve-gelo';
export const NINESLICE_BROKEN='placa-sem-corte';
export const ICON_BROKEN='botao-grande';

// ---------------------------------------------------------------- raw RGBA drawing
const canvas=(width,height)=>({width,height,data:Buffer.alloc(width*height*4)});
/** Fills the inclusive rectangle [x0..x1]×[y0..y1] (clipped to the image). */
function fill(img,x0,y0,x1,y1,[r,g,b,a=255]){
  for(let y=Math.max(0,y0);y<=Math.min(img.height-1,y1);y++)for(let x=Math.max(0,x0);x<=Math.min(img.width-1,x1);x++){
    const i=(y*img.width+x)*4;img.data[i]=r;img.data[i+1]=g;img.data[i+2]=b;img.data[i+3]=a;
  }
}
function disc(img,cx,cy,radius,rgb){
  for(let y=Math.floor(cy-radius);y<=Math.ceil(cy+radius);y++)for(let x=Math.floor(cx-radius);x<=Math.ceil(cx+radius);x++)
    if((x-cx)**2+(y-cy)**2<=radius*radius)fill(img,x,y,x,y,rgb);
}
/** A standing figure in the cell at (left, top): body + feet bar whose bottom row is `footY` and centre column `cx`. */
function figure(img,left,top,cell,cx,footY,rgb){
  const body=Math.round(cell*.15),feet=Math.round(cell*.08),feetH=Math.round(cell*.08),height=Math.round(cell*.53);
  fill(img,left+Math.round(cx-body),top+footY-height,left+Math.round(cx+body),top+footY-feetH-1,rgb);
  fill(img,left+Math.round(cx-feet),top+footY-feetH,left+Math.round(cx+feet),top+footY,rgb);
}
async function save(img,file,{opaque=false,gray=false}={}){
  mkdirSync(path.dirname(file),{recursive:true});
  let s=sharp(img.data,{raw:{width:img.width,height:img.height,channels:4}});
  if(opaque)s=s.flatten({background:'#ffffff'});
  if(gray)s=s.toColourspace('b-w');
  await s.png({compressionLevel:1}).toFile(file);
}
export const json=(file,value)=>{mkdirSync(path.dirname(file),{recursive:true});writeFileSync(file,typeof value==='string'?value:JSON.stringify(value,null,2));};

// ---------------------------------------------------------------- pieces
/** One enemy animation sheet: `frames` columns × 8 rows (DIRECTIONS), feet on 0.88 × cell, centred. */
function enemySheet(cell,frames,{shiftX=0,shiftY=0,rows=DIRECTIONS.length,empty,border}={}){
  const img=canvas(cell*frames,cell*rows),footY=Math.round(ANCHOR[1]*cell)+shiftY,cx=cell*ANCHOR[0]+shiftX;
  for(let d=0;d<rows;d++)for(let f=0;f<frames;f++){
    if(empty&&empty[0]===d&&empty[1]===f)continue;
    const [r,g,b]=DIRECTION_COLORS[DIRECTIONS[d%8]];
    figure(img,f*cell,d*cell,cell,cx,footY,[r,g,(b+f*16)%256]);
  }
  if(border)fill(img,0,20,0,30,[0,0,0]);
  return img;
}
/**
 * An enemy folder `<dir>` (one PNG per animation + meta.json), correct unless `fault` (a value of ENEMY_FAULTS, or
 * 'missingAnim': no walk.png, a partial delivery). `shift`: {[anim]:{x?,y?}} moves that animation's feet (px).
 */
export async function writeEnemy(dir,{cell=TEST_ENEMY.cell,anims=TEST_ENEMY.anims,fault,shift={}}={}){
  mkdirSync(dir,{recursive:true});
  for(const [anim,frames] of Object.entries(anims)){
    if(fault==='noAnims'||fault==='missingAnim'&&anim==='walk')continue;
    const idle=anim==='idle',walk=anim==='walk';
    const sheet=enemySheet(cell,fault==='frames'&&walk?frames+1:frames,{
      rows:fault==='size'&&idle?7:8,
      shiftY:fault==='footY'&&idle?-12:shift[anim]?.y??0,
      shiftX:fault==='footX'&&walk?15:shift[anim]?.x??0,
      empty:fault==='empty'&&walk?[2,1]:undefined,
      border:fault==='border'&&idle,
    });
    await save(sheet,path.join(dir,`${anim}.png`),{opaque:fault==='opaque'&&idle});
  }
  const meta={cell:[cell,cell],anchor:fault==='anchor'?[.5,.75]:[...ANCHOR],fps:Object.fromEntries(Object.keys(anims).map(a=>[a,8]))};
  if(fault==='badMeta')json(path.join(dir,'meta.json'),'{"cell":[64,64],"anchor":[0.5,');
  else if(fault!=='missingMeta')json(path.join(dir,'meta.json'),meta);
}

/**
 * A dir8 player atlas (1152×4608): 8 blocks in DIRECTIONS order × idle/walk/attack rows, feet on PIVOT_Y. The feet sit
 * on `pivotX` for the right-facing blocks, 191 − pivotX for SW/W/NW and the cell centre for S/N. `shiftIdle` moves the
 * idle rows' feet column (mirrored on the left); `lift` raises a whole block.
 */
export async function writeDir8(file,{pivotX,shiftIdle=0,lift}={}){
  const img=canvas(CELL*COLUMNS,CELL*3*DIRECTIONS.length);
  DIRECTIONS.forEach((dir,block)=>{
    const centre=dir==='S'||dir==='N',left=LEFT.has(dir);
    for(let row=0;row<3;row++)for(let c=0;c<COLUMNS;c++){
      const x=(centre?(CELL-1)/2:pivotX)+(row===0?shiftIdle:0),cx=left?CELL-1-x:x;
      const footY=PIVOT_Y-(lift&&lift.direction===dir?lift.by:0);
      figure(img,c*CELL,(block*3+row)*CELL,CELL,cx,footY,DIRECTION_COLORS[dir]);
    }
  });
  await save(img,file);
}

/** Elite layer of an enemy animation: same grid, only a small badge above the head of every cell. */
export async function writeEliteLayer(file,{cell=TEST_ENEMY.cell,frames=2}={}){
  const img=canvas(cell*frames,cell*DIRECTIONS.length);
  for(let d=0;d<DIRECTIONS.length;d++)for(let f=0;f<frames;f++)disc(img,f*cell+cell/2-.5,d*cell+cell*.2,cell*.08,[250,210,30]);
  await save(img,file);
}
/** The player's downed sheet (1152×1536): a lying figure per cell, lowest row on PIVOT_Y. */
export async function writeDowned(file){
  const img=canvas(CELL*COLUMNS,CELL*DIRECTIONS.length);
  DIRECTIONS.forEach((dir,d)=>{for(let c=0;c<COLUMNS;c++)fill(img,c*CELL+46+c*4,d*CELL+PIVOT_Y-24,c*CELL+136+c*4,d*CELL+PIVOT_Y,DIRECTION_COLORS[dir]);});
  await save(img,file);
}
/** Bytes that start like a PNG and then are garbage. */
export function writeCorrupt(file){
  mkdirSync(path.dirname(file),{recursive:true});
  writeFileSync(file,Buffer.concat([Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]),Buffer.from('nao e uma imagem de verdade')]));
}
/** One row of `frames` cells (`cell`: side of a square, or [w,h]) with a centred disc each. */
export async function writeFrames(file,{cell=TEST_FRAMES.cell,frames=TEST_FRAMES.frames}={}){
  const [w,h]=Array.isArray(cell)?cell:[cell,cell],img=canvas(w*frames,h);
  for(let f=0;f<frames;f++)disc(img,f*w+w/2-.5,h/2-.5,Math.min(w,h)*.3,[200,170,30+f*40]);
  await save(img,file);
}
/** Building: `views` columns × rows of cell [w,h], base on the anchor line. */
export async function writeViews(file,{cell:[w,h]=TEST_VIEWS.cell,views=TEST_VIEWS.views,rows=TEST_VIEWS.rows.length}={}){
  const img=canvas(w*views,h*rows),base=Math.round(TEST_VIEWS.anchor[1]*h);
  for(let v=0;v<views;v++)for(let r=0;r<rows;r++)fill(img,v*w+8,r*h+12,v*w+w-9,r*h+base,[90+v*40,80,70+r*60]);
  await save(img,file);
}
/** Nine-slice plate: transparent margin, 1 px wide border ring of the slice width, flat centre. */
async function writeNineslice(file,{cell:[w,h]=TEST_NINESLICE.cell}={}){
  const img=canvas(w,h);
  fill(img,2,2,w-3,h-3,[60,40,20]);fill(img,8,8,w-9,h-9,[210,190,150]);
  await save(img,file);
}
/**
 * A building whose base stands on a corner point: wide body plus a narrow foot whose lowest 6 rows are centred on
 * `anchor[0]` × w, bottom row at `anchor[1]` × h (one row of `views` cells).
 */
export async function writeCornerViews(file,{cell:[w,h]=TEST_VIEWS.cell,views=4,anchor}){
  const img=canvas(w*views,h),ax=Math.round(anchor[0]*w),base=Math.round(anchor[1]*h);
  for(let v=0;v<views;v++){fill(img,v*w+4,8,v*w+w-5,base-6,[120+v*30,90,60]);fill(img,v*w+ax-2,base-5,v*w+ax+2,base,[60,60,60]);}
  await save(img,file);
}
/**
 * Seamless tile `width`×`height`. `pattern`: 'wave' (periodic in both axes), 'ramp' (left-to-right, does not wrap),
 * 'stripX' (periodic left/right, ramp top to bottom), 'cobble' (8 px stones, 1 px dark grout on x/y multiples of 8,
 * high contrast, periodic). `transparent`: periodic alpha. `breakRows`: [y0,y1] of the right column painted a foreign
 * colour (one broken stretch of the horizontal wrap).
 */
export async function writeSeamless(file,{size=TEST_TILE,width=size,height=size,pattern,tiling=true,gray=false,transparent=false,breakRows}={}){
  pattern??=tiling?'wave':'ramp';
  const img=canvas(width,height),kx=2*Math.PI/width,ky=2*Math.PI/height;
  const stones=[[200,170,120],[90,110,140],[225,215,195],[120,80,60]];
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    let rgb;
    if(pattern==='cobble'){
      const noise=((x*7+y*13)%5)*6;
      rgb=x%8===0||y%8===0?[35+noise,35+noise,40+noise]:stones[(Math.floor(x/8)*3+Math.floor(y/8)*5)%4].map(c=>Math.min(255,c+noise));
    }else{
      const v=pattern==='wave'?Math.round(128+50*Math.sin(kx*x)+50*Math.cos(ky*y))
        :pattern==='stripX'?Math.round(60+50*Math.sin(kx*x)+y*12):Math.round(x*255/(width-1));
      rgb=gray?[v,v,v]:[v,Math.round(v*.8),255-v];
    }
    fill(img,x,y,x,y,[...rgb,transparent?Math.round(150+90*Math.sin(kx*x)):255]);
  }
  if(breakRows)fill(img,width-1,breakRows[0],width-1,breakRows[1],[0,255,0,255]);
  await save(img,file,{opaque:!transparent,gray});
}
/** Transparent icon with a centred disc, or (`opaque`) a full-bleed opaque square. */
export async function writeIcon(file,{size=TEST_ICON,opaque=false}={}){
  const img=canvas(size,size);
  if(opaque)fill(img,0,0,size-1,size-1,[30,90,160]);
  disc(img,size/2-.5,size/2-.5,size*.35,[230,180,40]);await save(img,file,{opaque});
}

/** Pivot (feet column) of a class's approved sheet in the repo, as the importer reads it. */
export const classPivot=(repoRoot,id)=>approvedPivotX(path.join(repoRoot,'public/art/sprites',`${id}.webp`));

/** One correct piece per format. Returns the ids written, by group. */
export async function makeCorrectSet(root,{repoRoot}){
  await writeEnemy(path.join(root,'inimigos','blob'));
  await writeDir8(path.join(root,'personagens',`${DIR8_OK}.dir8.png`),{pivotX:await classPivot(repoRoot,DIR8_OK)});
  await writeSeamless(path.join(root,'cenario/chao','neve-1.png'));
  await writeSeamless(path.join(root,'cenario/chao','trans-neve-lama.png'),{gray:true});
  await writeViews(path.join(root,'cenario/predios','casinha.png'));
  json(path.join(root,'cenario/predios','casinha.json'),TEST_VIEWS);
  await writeNineslice(path.join(root,'cenario/props','placa.png'));
  json(path.join(root,'cenario/props','placa.json'),TEST_NINESLICE);
  await writeFrames(path.join(root,'itens','moeda.png'));
  await writeIcon(path.join(root,'ui','botao.png'));
  return {inimigos:['blob'],personagens:[DIR8_OK],chao:['neve-1','trans-neve-lama'],predios:['casinha'],props:['placa'],itens:['moeda'],ui:['botao']};
}

/** One broken piece per fault. */
export async function makeErrorSet(root,{repoRoot}){
  for(const [id,fault] of Object.entries(ENEMY_FAULTS))await writeEnemy(path.join(root,'inimigos',id),{fault});
  await writeDir8(path.join(root,'personagens',`${DIR8_WRONG_COLUMN}.dir8.png`),{pivotX:await classPivot(repoRoot,DIR8_WRONG_COLUMN),shiftIdle:30});
  await writeDir8(path.join(root,'personagens',`${DIR8_LIFTED}.dir8.png`),{pivotX:await classPivot(repoRoot,DIR8_LIFTED),lift:{direction:LIFTED_DIRECTION,by:LIFT}});
  await writeViews(path.join(root,'cenario/predios',`${VIEWS_BROKEN.wrongViews}.png`),{views:3});
  json(path.join(root,'cenario/predios',`${VIEWS_BROKEN.wrongViews}.json`),TEST_VIEWS);
  await writeViews(path.join(root,'cenario/predios',`${VIEWS_BROKEN.wrongRows}.png`),{rows:3});
  json(path.join(root,'cenario/predios',`${VIEWS_BROKEN.wrongRows}.json`),TEST_VIEWS);
  await writeFrames(path.join(root,'itens',`${FRAMES_BROKEN}.png`),{frames:3});
  json(path.join(root,'itens',`${FRAMES_BROKEN}.json`),{frames:4});
  await writeSeamless(path.join(root,'cenario/chao',`${SEAMLESS_BROKEN}.png`),{tiling:false});
  await writeSeamless(path.join(root,'cenario/chao',`${MASK_BROKEN}.png`));
  await writeNineslice(path.join(root,'cenario/props',`${NINESLICE_BROKEN}.png`));
  json(path.join(root,'cenario/props',`${NINESLICE_BROKEN}.json`),{kind:'nineslice',cell:TEST_NINESLICE.cell});
  await writeIcon(path.join(root,'ui',`${ICON_BROKEN}.png`),{size:40});
}
