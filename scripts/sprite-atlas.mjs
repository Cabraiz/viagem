// Sprite sheet checks shared by scripts/import-sprites.mjs and tests/sprites.test.ts.
// Format contract for artists: docs/sprite-directions.md (NEW-20261009-ORQ-sprites-4-direcoes).
import sharp from 'sharp';

export const CELL=192;
export const COLUMNS=6;
/** Rows per facing block: idle, walk, attack. */
export const ROWS=3;
/** Order of the facing blocks in a 4-direction atlas (top to bottom); keep in sync with FACINGS in sprite-motion.ts. */
export const FACING_BLOCKS=['front-right','front-left','back-right','back-left'];
export const SINGLE={width:CELL*COLUMNS,height:CELL*ROWS};
export const DIR4={width:CELL*COLUMNS,height:CELL*ROWS*FACING_BLOCKS.length};
/** The sprite origin is (0.5, 0.88) of the cell: the feet sit on row 168 (± PIVOT_Y_TOLERANCE). */
export const PIVOT_Y=168;
export const PIVOT_Y_TOLERANCE=3;
/** The feet stand under the cell's centre column (the sprite turns around it): x = 96 ± PIVOT_X_TOLERANCE. */
export const PIVOT_X=CELL/2;
export const PIVOT_X_TOLERANCE=12;
/** Between facings: same feet row (± 2 px), feet centre within 12 px, standing height within 6 %. */
export const FACING_BASELINE_TOLERANCE=2;
export const FACING_FOOT_TOLERANCE=12;
export const FACING_HEIGHT_TOLERANCE=.06;
const ALPHA=20;

/** Opaque box, feet row and feet centre of one cell of a raw RGBA buffer; `clipped` when the figure touches an edge. */
export function cellStats(data,width,frame){
  const left0=frame%COLUMNS*CELL,top0=Math.floor(frame/COLUMNS)*CELL;
  let minX=CELL,minY=CELL,maxX=-1,maxY=-1,occupied=0,transparent=0,clipped=false;
  for(let y=0;y<CELL;y++)for(let x=0;x<CELL;x++){
    const a=data[((top0+y)*width+left0+x)*4+3];
    if(a===0)transparent++;
    if(a>ALPHA){occupied++;if(x<minX)minX=x;if(x>maxX)maxX=x;if(y<minY)minY=y;if(y>maxY)maxY=y;if(x===0||x===CELL-1||y===0||y===CELL-1)clipped=true;}
  }
  let sum=0,count=0;
  if(maxY>=0)for(let y=Math.max(0,maxY-5);y<=maxY;y++)for(let x=0;x<CELL;x++)if(data[((top0+y)*width+left0+x)*4+3]>ALPHA){sum+=x;count++;}
  return {occupied,transparent,clipped,minX,minY,maxX,maxY,height:maxY-minY+1,footX:count?sum/count:NaN};
}

async function raw(source){
  const image=sharp(source);
  const meta=await image.metadata();
  const {data,info}=await image.ensureAlpha().raw().toBuffer({resolveWithObject:true});
  return {meta,data,width:info.width,height:info.height};
}
function checkFrames(id,data,width,frames,problems){
  for(let frame=0;frame<frames;frame++){
    const s=cellStats(data,width,frame);
    if(!s.occupied||!s.transparent)problems.push(`Empty or opaque frame: ${id}:${frame}`);
    else if(s.clipped)problems.push(`Clipped cell: ${id}:${frame}`);
  }
}

/** The approved single-direction sheet (6×3 cells of 192 px, transparent). Returns the standing height of frame 0. */
export async function validateSingleSheet(source,id){
  const {meta,data,width,height}=await raw(source);
  if(width!==SINGLE.width||height!==SINGLE.height||!meta.hasAlpha)throw new Error(`Invalid sheet: ${id}`);
  const problems=[];checkFrames(id,data,width,COLUMNS*ROWS,problems);
  if(problems.length)throw new Error(problems[0]);
  return {height:cellStats(data,width,0).height};
}

/**
 * A 4-direction atlas: 6 columns × 12 rows of 192 px cells, four blocks of idle/walk/attack rows in FACING_BLOCKS
 * order, transparent background, nothing touching a cell edge, and the same pivot in every facing (feet row, feet
 * centre and standing height of each block's idle frame). Throws one error listing every problem found.
 */
export async function validateDirectionalAtlas(source,id){
  const {meta,data,width,height}=await raw(source);
  if(width!==DIR4.width||height!==DIR4.height)throw new Error(`Invalid 4-direction atlas: ${id}: ${width}x${height}, expected ${DIR4.width}x${DIR4.height}`);
  if(!meta.hasAlpha)throw new Error(`Invalid 4-direction atlas: ${id}: no transparency (alpha channel)`);
  const problems=[];
  checkFrames(id,data,width,COLUMNS*ROWS*FACING_BLOCKS.length,problems);
  const facings=FACING_BLOCKS.map((facing,block)=>{const s=cellStats(data,width,block*COLUMNS*ROWS);return {facing,baseline:s.maxY,height:s.height,footX:Math.round(s.footX*10)/10};});
  const [front]=facings;
  for(const f of facings){
    if(Math.abs(f.baseline-PIVOT_Y)>PIVOT_Y_TOLERANCE)problems.push(`Feet off the pivot row: ${id}:${f.facing} stands on row ${f.baseline}, expected ${PIVOT_Y}±${PIVOT_Y_TOLERANCE}`);
    if(!(Math.abs(f.footX-PIVOT_X)<=PIVOT_X_TOLERANCE))problems.push(`Feet off the pivot column: ${id}:${f.facing} feet centre x ${f.footX}, expected ${PIVOT_X}±${PIVOT_X_TOLERANCE}`);
    if(f===front)continue;
    if(Math.abs(f.baseline-front.baseline)>FACING_BASELINE_TOLERANCE)problems.push(`Pivot differs between facings: ${id}:${f.facing} feet row ${f.baseline} vs front-right ${front.baseline}`);
    if(!(Math.abs(f.footX-front.footX)<=FACING_FOOT_TOLERANCE))problems.push(`Pivot differs between facings: ${id}:${f.facing} feet centre x ${f.footX} vs front-right ${front.footX}`);
    if(Math.abs(f.height-front.height)>front.height*FACING_HEIGHT_TOLERANCE)problems.push(`Height differs between facings: ${id}:${f.facing} ${f.height} px vs front-right ${front.height} px`);
  }
  if(problems.length)throw new Error(problems.join('\n'));
  return {height:front.height,facings};
}
