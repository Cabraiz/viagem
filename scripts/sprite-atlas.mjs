// Sprite sheet checks shared by scripts/import-sprites.mjs, scripts/import-dir4.mjs and tests/sprites.test.ts.
// Format contract for artists: docs/sprite-directions.md (NEW-20261009-ORQ-sprites-4-direcoes). Messages are in
// pt-BR because they are read by whoever draws the art.
import sharp from 'sharp';

export const CELL=192;
export const COLUMNS=6;
/** Rows per facing block: idle, walk, attack. */
export const ROWS=3;
export const ROW_NAMES=['parado','andar','ataque'];
/** Order of the facing blocks in a 4-direction atlas (top to bottom); keep in sync with FACINGS in sprite-motion.ts. */
export const FACING_BLOCKS=['front-right','front-left','back-right','back-left'];
export const FACING_NAMES={'front-right':'frente-direita','front-left':'frente-esquerda','back-right':'costas-direita','back-left':'costas-esquerda'};
export const SINGLE={width:CELL*COLUMNS,height:CELL*ROWS};
export const DIR4={width:CELL*COLUMNS,height:CELL*ROWS*FACING_BLOCKS.length};
/** The sprite origin is (0.5, 0.88) of the cell: the feet sit on pixel row 168 (counted from 0 at the cell's top). */
export const PIVOT_Y=168;
/** Median feet row of each row of cells: idle and walk ± 3 px, attack ± 6 px (lunges; the approved sheets reach +6). */
export const ROW_BASELINE_TOLERANCE=[3,3,6];
/** Any single cell: feet row within ± 8 px (walk bob, attack lunge; approved sheets reach 7). */
export const CELL_BASELINE_TOLERANCE=8;
/** Default feet column (cell centre). A class with an approved sheet keeps that sheet's standing feet column. */
export const PIVOT_X=CELL/2;
/** The standing cell's feet centre: within ± 12 px of the class's column (mirrored for the left facings). */
export const PIVOT_X_TOLERANCE=12;
/** Same row in two facings (medians of its 6 cells): feet row ± 2 px (idle) / ± 3 px, feet centre ± 12 px, height ± 6 %. */
export const FACING_BASELINE_TOLERANCE=[2,3,3];
export const FACING_FOOT_TOLERANCE=12;
export const FACING_HEIGHT_TOLERANCE=.06;
const ALPHA=20;
const median=values=>{const v=[...values].sort((a,b)=>a-b);return v.length%2?v[v.length>>1]:(v[v.length/2-1]+v[v.length/2])/2;};
const where=(frame)=>`linha ${Math.floor(frame/COLUMNS)+1}, coluna ${frame%COLUMNS+1}`;

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
/** Box of the drawn figure (alpha > 20) over every cell, in cell px: what CharacterSprites.figure() serves. */
export function figureBox(data,width,height){
  let left=CELL,top=CELL,right=-1,bottom=-1;
  for(let y=0;y<height;y++)for(let x=0;x<width;x++)if(data[(y*width+x)*4+3]>ALPHA){
    const fx=x%CELL,fy=y%CELL;if(fx<left)left=fx;if(fx>right)right=fx;if(fy<top)top=fy;if(fy>bottom)bottom=fy;
  }
  return right>=left?{left,top,right:right+1,bottom:bottom+1}:undefined;
}

export async function raw(source){
  const image=sharp(source);
  const meta=await image.metadata();
  const {data,info}=await image.ensureAlpha().raw().toBuffer({resolveWithObject:true});
  return {meta,data,width:info.width,height:info.height};
}
function checkFrames(id,data,width,frames,problems){
  for(let frame=0;frame<frames;frame++){
    const s=cellStats(data,width,frame);
    if(!s.occupied||!s.transparent)problems.push(`${id}: célula vazia ou sem fundo transparente (${where(frame)})`);
    else if(s.clipped)problems.push(`${id}: desenho encostando na borda da célula (${where(frame)})`);
  }
}

/** The approved single-direction sheet (6×3 cells of 192 px, transparent). Standing height and feet column of frame 0. */
export async function validateSingleSheet(source,id){
  const {meta,data,width,height}=await raw(source);
  if(width!==SINGLE.width||height!==SINGLE.height||!meta.hasAlpha)throw new Error(`${id}: folha inválida (${width}×${height}${meta.hasAlpha?'':', sem transparência'}; esperado ${SINGLE.width}×${SINGLE.height} com alfa)`);
  const problems=[];checkFrames(id,data,width,COLUMNS*ROWS,problems);
  if(problems.length)throw new Error(problems[0]);
  const s=cellStats(data,width,0);
  return {height:s.height,footX:s.footX,figure:figureBox(data,width,height)};
}
/** Feet column the class already shows standing (its approved sheet), or the cell centre for a class without one. */
export async function approvedPivotX(source){
  try{const {data,width}=await raw(source);const x=cellStats(data,width,0).footX;return Number.isFinite(x)?Math.round(x*10)/10:PIVOT_X;}catch{return PIVOT_X;}
}

/**
 * A 4-direction atlas (docs/sprite-directions.md). Checked: size 1152×2304 with alpha; every one of the 72 cells drawn,
 * with transparent background and nothing touching its edge; every cell's feet row within PIVOT_Y ± 8; per facing and
 * row, the median feet row of its 6 cells within PIVOT_Y ± 3 (attack ± 6); the standing cell (first of each idle row)
 * with its feet centre on the class's column ± 12 (`pivotX`, mirrored as 191 − x for the left facings); and, row by
 * row against front-right, the same median feet row (± 2 idle, ± 3 walk/attack), feet centre (± 12, mirrored) and
 * height (± 6 %). Throws one error listing every problem found.
 */
export async function validateDirectionalAtlas(source,id,{pivotX=PIVOT_X}={}){
  const {meta,data,width,height}=await raw(source);
  if(width!==DIR4.width||height!==DIR4.height)throw new Error(`${id}: atlas de 4 direções com ${width}×${height}, esperado ${DIR4.width}×${DIR4.height}`);
  if(!meta.hasAlpha)throw new Error(`${id}: atlas sem transparência (salve o PNG com canal alfa)`);
  const problems=[];
  checkFrames(id,data,width,COLUMNS*ROWS*FACING_BLOCKS.length,problems);
  const norm=(facing,x)=>facing.endsWith('left')?CELL-1-x:x;
  const facings=FACING_BLOCKS.map((facing,block)=>{
    const name=FACING_NAMES[facing];
    const rows=ROW_NAMES.map((row,r)=>{
      const first=(block*ROWS+r)*COLUMNS,cells=Array.from({length:COLUMNS},(_,c)=>cellStats(data,width,first+c));
      cells.forEach((s,c)=>{if(s.occupied&&Math.abs(s.maxY-PIVOT_Y)>CELL_BASELINE_TOLERANCE)problems.push(`${id}: ${name}, ${row}: pés na linha ${s.maxY} da célula (${where(first+c)}), esperado ${PIVOT_Y} ± ${CELL_BASELINE_TOLERANCE}`);});
      const baseline=median(cells.map(s=>s.maxY)),footX=Math.round(median(cells.map(s=>norm(facing,s.footX)))*10)/10,h=median(cells.map(s=>s.height));
      if(Math.abs(baseline-PIVOT_Y)>ROW_BASELINE_TOLERANCE[r])problems.push(`${id}: ${name}, ${row}: os pés ficam na linha ${baseline} (mediana das 6 células), esperado ${PIVOT_Y} ± ${ROW_BASELINE_TOLERANCE[r]}`);
      return {row,baseline,footX,height:h};
    });
    const stand=cellStats(data,width,block*ROWS*COLUMNS),standX=Math.round(norm(facing,stand.footX)*10)/10;
    if(!(Math.abs(standX-pivotX)<=PIVOT_X_TOLERANCE))problems.push(`${id}: ${name}, parado: pés centrados em x = ${Math.round(facing.endsWith('left')?CELL-1-standX:standX)}, esperado ${Math.round(facing.endsWith('left')?CELL-1-pivotX:pivotX)} ± ${PIVOT_X_TOLERANCE}`);
    return {facing,baseline:stand.maxY,height:stand.height,footX:standX,rows};
  });
  const [front]=facings;
  for(const f of facings.slice(1))f.rows.forEach((row,r)=>{
    const ref=front.rows[r],name=FACING_NAMES[f.facing];
    if(Math.abs(row.baseline-ref.baseline)>FACING_BASELINE_TOLERANCE[r])problems.push(`${id}: ${name}, ${row.row}: pés na linha ${row.baseline}, frente-direita na ${ref.baseline} (pivô diferente entre direções, tolerância ${FACING_BASELINE_TOLERANCE[r]} px)`);
    if(!(Math.abs(row.footX-ref.footX)<=FACING_FOOT_TOLERANCE))problems.push(`${id}: ${name}, ${row.row}: pés centrados em ${row.footX} (espelhado), frente-direita em ${ref.footX} (pivô diferente entre direções, tolerância ${FACING_FOOT_TOLERANCE} px)`);
    if(Math.abs(row.height-ref.height)>ref.height*FACING_HEIGHT_TOLERANCE)problems.push(`${id}: ${name}, ${row.row}: altura ${row.height} px, frente-direita ${ref.height} px (altura diferente entre direções, tolerância 6 %)`);
  });
  if(problems.length)throw new Error(problems.join('\n'));
  return {height:front.height,figure:figureBox(data,width,height),facings};
}
