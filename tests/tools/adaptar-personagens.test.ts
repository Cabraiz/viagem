/**
 * Delivery adapter of the player characters (scripts/art-v2/adaptar/personagens.mjs) on SYNTHETIC sheets: a box
 * figure per cell (feet on row 168 at the class column) with planted height differences. Checks the per-direction
 * normalization (then the real importer validation passes), the across-class factor and the 20 % card rule, the
 * downed factor from its standing phase, the silhouette repack, the dropped sidecars and byte determinism.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {mkdtempSync,rmSync,mkdirSync,writeFileSync,readFileSync,existsSync,readdirSync} from 'node:fs';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {adapt,MAX_FACTOR} from '../../scripts/art-v2/adaptar/personagens.mjs';
import {validatePiece} from '../../scripts/art-v2/validate.mjs';
import {DIRECTIONS,LEFT} from '../../scripts/art-v2/spec.mjs';
import {CELL,COLUMNS,ROWS,cellStats} from '../../scripts/sprite-atlas.mjs';

sharp.cache(false);sharp.concurrency(1);
const repoRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
/** clt-cansado's approved sheet stands on column 113 (docs/sprite-directions.md). */
const ID='clt-cansado',PIVOT=113;
type Rec={id:string,action:string,factor?:number,refused?:string,notes?:string[],downedFactor?:number};

/** Box figure of height h, 30 px wide, centred on column cx, bottom on row 168. */
function box(buf:Buffer,width:number,col:number,row:number,h:number,cx:number,w=30){
  for(let y=169-h;y<169;y++)for(let x=Math.round(cx-w/2);x<Math.round(cx+w/2);x++){
    const i=((row*CELL+y)*width+col*CELL+x)*4;buf[i]=40+(y%7)*20;buf[i+1]=90;buf[i+2]=160;buf[i+3]=255;
  }
}
const column=(d:string)=>LEFT.has(d)?CELL-1-PIVOT:PIVOT;
/** dir8 atlas: height(directionIndex,row) px per cell. */
async function atlas(file:string,height:(b:number,r:number)=>number){
  const width=CELL*COLUMNS,buf=Buffer.alloc(width*CELL*ROWS*DIRECTIONS.length*4);
  DIRECTIONS.forEach((d,b)=>{for(let r=0;r<ROWS;r++)for(let c=0;c<COLUMNS;c++)box(buf,width,c,b*ROWS+r,height(b,r),column(d));});
  await sharp(buf,{raw:{width,height:CELL*ROWS*DIRECTIONS.length,channels:4}}).png().toFile(file);
}
/** downed: lying boxes (wide, short) then the standing phase of height stand. */
async function downed(file:string,stand:number){
  const width=CELL*COLUMNS,buf=Buffer.alloc(width*CELL*DIRECTIONS.length*4);
  DIRECTIONS.forEach((d,r)=>{for(let c=0;c<COLUMNS;c++)c===COLUMNS-1?box(buf,width,c,r,stand,column(d)):box(buf,width,c,r,20+c*8,column(d),60);});
  await sharp(buf,{raw:{width,height:CELL*DIRECTIONS.length,channels:4}}).png().toFile(file);
}
const withTemp=async(fn:(src:string,out:string)=>Promise<void>)=>{
  const dir=mkdtempSync(path.join(tmpdir(),'adaptar-personagens-'));
  try{const src=path.join(dir,'src'),out=path.join(dir,'out');mkdirSync(path.join(src,'personagens'),{recursive:true});await fn(src,out);}
  finally{rmSync(dir,{recursive:true,force:true});}
};
const rowHeights=async(file:string)=>{
  const {data,info}=await sharp(file).ensureAlpha().raw().toBuffer({resolveWithObject:true});
  return DIRECTIONS.map((_,b)=>Array.from({length:ROWS},(_,r)=>cellStats(data,info.width,(b*ROWS+r)*COLUMNS).height));
};

test('per-direction heights go to the row median, feet stay on 168, and the importer accepts the result',async()=>withTemp(async(src,out)=>{
  const dir=path.join(src,'personagens');
  // Idle 100 px everywhere except W (89 px, 11 % short); attack 110 px except SE (96 px).
  await atlas(path.join(dir,`${ID}.dir8.png`),(b,r)=>r===0?(DIRECTIONS[b]==='W'?89:100):r===2?(DIRECTIONS[b]==='SE'?96:110):100);
  writeFileSync(path.join(dir,`${ID}.meta.json`),'{"cell":[192,192],"footX":113}');
  const recs:Rec[]=await adapt({src,out,options:{heroHeight:100}});
  const rec=recs.find(r=>r.id===ID)!;
  assert.equal(rec.refused,undefined,rec.refused);
  assert.equal(rec.factor,1);
  assert.ok(rec.notes!.some(n=>n.includes(`dropped ${ID}.meta.json`)));
  assert.deepEqual(readdirSync(path.join(out,'personagens')),[`${ID}.dir8.png`],'no sidecar is written');
  const file=path.join(out,'personagens',`${ID}.dir8.png`),h=await rowHeights(file);
  for(const b of h){assert.ok(Math.abs(b[0]-100)<=2,`idle ${b[0]}`);assert.ok(Math.abs(b[2]-110)<=2,`attack ${b[2]}`);}
  const {data,info}=await sharp(file).ensureAlpha().raw().toBuffer({resolveWithObject:true});
  for(let f=0;f<COLUMNS*ROWS*DIRECTIONS.length;f++)assert.equal(cellStats(data,info.width,f).maxY,168,`cell ${f}`);
  const v=await validatePiece('personagens',ID,[file],{input:out,repoRoot,classes:[ID]});
  assert.deepEqual(v.problems,[]);
}));

test('across classes: scaled to the hero height and recorded (default); with the switch on, past 20 % refuses',async()=>withTemp(async(src,out)=>{
  const dir=path.join(src,'personagens');
  await atlas(path.join(dir,`${ID}.dir8.png`),()=>80);
  // 80 → 100 is +25 %: applied by default (CROSS_CLASS_REFUSES off), refused with the switch on.
  let recs:Rec[]=await adapt({src,out,options:{heroHeight:100}});
  assert.equal(recs.find(r=>r.id===ID)!.refused,undefined);assert.equal(recs.find(r=>r.id===ID)!.factor,1.25);
  recs=await adapt({src,out,options:{heroHeight:100,crossClassRefuses:true}});
  let rec=recs.find(r=>r.id===ID)!;
  assert.match(rec.refused??'',/class factor \+25\.0 % is past 20 %/);
  assert.equal(existsSync(path.join(out,'personagens',`${ID}.dir8.png`)),false);
  // 80 → 92 is +15 %: applied.
  recs=await adapt({src,out,options:{heroHeight:92}});
  rec=recs.find(r=>r.id===ID)!;
  assert.equal(rec.refused,undefined);assert.equal(rec.factor,1.15);
  for(const b of await rowHeights(path.join(out,'personagens',`${ID}.dir8.png`)))for(const x of b)assert.ok(Math.abs(x-92)<=2,`height ${x}`);
  assert.equal(MAX_FACTOR,.2);
}));

test('a direction more than 20 % off its row median refuses the class',async()=>withTemp(async(src,out)=>{
  await atlas(path.join(src,'personagens',`${ID}.dir8.png`),b=>DIRECTIONS[b]==='N'?70:100);
  const rec=(await adapt({src,out,options:{heroHeight:100}}) as Rec[]).find(r=>r.id===ID)!;
  assert.match(rec.refused??'',/height differs between directions.*N idle \+42\.9 %/);
}));

test('downed: its own factor from the standing-up phase, to the same hero height',async()=>withTemp(async(src,out)=>{
  const dir=path.join(src,'personagens');
  await atlas(path.join(dir,`${ID}.dir8.png`),()=>100);
  await downed(path.join(dir,`${ID}.downed.png`),90);
  const rec=(await adapt({src,out,options:{heroHeight:100}}) as Rec[]).find(r=>r.id===ID)!;
  assert.equal(rec.refused,undefined);assert.equal(rec.downedFactor,1.1111);
  const file=path.join(out,'personagens',`${ID}.downed.png`);
  const {data,info}=await sharp(file).ensureAlpha().raw().toBuffer({resolveWithObject:true});
  assert.deepEqual([info.width,info.height],[CELL*COLUMNS,CELL*DIRECTIONS.length]);
  for(let r=0;r<DIRECTIONS.length;r++){const s=cellStats(data,info.width,r*COLUMNS+5);assert.ok(Math.abs(s.height-100)<=2);assert.equal(s.maxY,168);}
}));

test('silhouette: a 192×1536 column becomes the 1536×192 row; output bytes are deterministic',async()=>withTemp(async(src,out)=>{
  const dir=path.join(src,'personagens'),buf=Buffer.alloc(CELL*CELL*8*4);
  for(let i=0;i<8;i++)box(buf,CELL,0,i,100,96);
  await sharp(buf,{raw:{width:CELL,height:CELL*8,channels:4}}).png().toFile(path.join(dir,'_silhueta.png'));
  writeFileSync(path.join(dir,'_silhueta.meta.json'),'{}');
  writeFileSync(path.join(dir,'notes.txt'),'x');
  const recs:Rec[]=await adapt({src,out,options:{heroHeight:100}});
  assert.equal(recs.find(r=>r.id==='_silhueta')!.refused,undefined);
  assert.match(recs.find(r=>r.id==='notes.txt')!.refused??'',/unexpected file/);
  const file=path.join(out,'personagens','_silhueta.png'),m=await sharp(file).metadata();
  assert.deepEqual([m.width,m.height],[CELL*8,CELL]);
  const v=await validatePiece('personagens','_silhueta',[file],{input:out,repoRoot,classes:[ID]});
  assert.deepEqual(v.problems,[]);
  const first=readFileSync(file);
  await adapt({src,out,options:{heroHeight:100}});
  assert.ok(readFileSync(file).equals(first));
}));
