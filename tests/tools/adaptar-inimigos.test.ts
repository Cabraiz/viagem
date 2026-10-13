/**
 * Delivery adapter of the enemies (scripts/art-v2/adaptar/inimigos.mjs) on SYNTHETIC sheets: 64 px cells, anchor
 * [0.5,0.88] (foot column 32, ground line 56), rectangles as figures. Checks the foot re-centring of grounded sheets,
 * airborne sheets never moved vertically, the empty-cell fill, the refusal when a shift leaves the margin, and byte
 * determinism.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {mkdtempSync,rmSync,mkdirSync,writeFileSync,readFileSync,existsSync,readdirSync} from 'node:fs';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {adapt} from '../../scripts/art-v2/adaptar/inimigos.mjs';
import {cellBox} from '../../scripts/art-v2/validate.mjs';

sharp.cache(false);sharp.concurrency(1);
const C=64,ROWS=8;
type Rect=[number,number,number,number];
type Rec={id:string,action:string,shifts?:Record<string,number>,refused?:string,notes?:string[]};

/** Sheet of `cols` frames × 8 rows; rects(r,c) = inclusive [x0,y0,x1,y1] list in cell px (empty list = empty cell). */
async function sheet(file:string,cols:number,rects:(r:number,c:number)=>Rect[]){
  const width=C*cols,buf=Buffer.alloc(width*C*ROWS*4);
  for(let r=0;r<ROWS;r++)for(let c=0;c<cols;c++)for(const [x0,y0,x1,y1] of rects(r,c))
    for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++){const i=((r*C+y)*width+c*C+x)*4;buf[i]=200;buf[i+1]=(x*7+c)%255;buf[i+2]=y;buf[i+3]=255;}
  await sharp(buf,{raw:{width,height:C*ROWS,channels:4}}).png().toFile(file);
}
async function raw(file:string){
  const {data,info}=await sharp(file).ensureAlpha().raw().toBuffer({resolveWithObject:true});
  return {data,width:info.width};
}
function enemy(src:string,id:string){
  const dir=path.join(src,'inimigos',id);mkdirSync(dir,{recursive:true});
  writeFileSync(path.join(dir,'meta.json'),JSON.stringify({cell:[C,C],anchor:[.5,.88],fps:{walk:8}}));
  return dir;
}
async function run(t:{after:(fn:()=>void)=>void},setup:(src:string)=>Promise<void>){
  const root=mkdtempSync(path.join(tmpdir(),'adaptar-inimigos-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
  const src=path.join(root,'in'),out=path.join(root,'out');
  await setup(src);
  return {root,src,out,records:await adapt({src,out}) as Rec[]};
}

test('grounded sheet: foot moved to the anchor column and the ground line; airborne sheet keeps its height', async t=>{
  const {out,records}=await run(t,async src=>{
    const dir=enemy(src,'boneco');
    // Feet at x 39..48 (centre 43.5, 11.5 px right of 32, past the 7.68 px tolerance) and on row 50 (ground is 56).
    await sheet(path.join(dir,'walk.png'),2,()=>[[39,20,48,50]]);
    // Airborne: flying high, bottom on row 30.
    await sheet(path.join(dir,'death.png'),2,()=>[[39,10,48,30]]);
  });
  const rec=records.find(r=>r.id==='boneco')!;
  assert.equal(rec.action,'recentred');
  assert.deepEqual(rec.shifts,{death:11,walk:11});
  const walk=await raw(path.join(out,'inimigos/boneco/walk.png')),death=await raw(path.join(out,'inimigos/boneco/death.png'));
  for(let r=0;r<ROWS;r++)for(let c=0;c<2;c++){
    const w=cellBox(walk.data,walk.width,c*C,r*C,C,C),d=cellBox(death.data,death.width,c*C,r*C,C,C);
    assert.equal(w.maxY,56);assert.equal(w.footX,32.5);
    assert.equal(d.maxY,30,'airborne never moves vertically');assert.equal(d.minY,10);
    assert.equal(d.footX,32.5,'same direction shift sideways, no pop between animations');
  }
});

test('empty cell inside a row: filled with the previous frame, noted', async t=>{
  const {out,records}=await run(t,async src=>{
    const dir=enemy(src,'boneco');
    await sheet(path.join(dir,'walk.png'),3,(r,c)=>c===1?[]:[[28,20,36,56-(c>>1)]]);
  });
  const rec=records.find(r=>r.id==='boneco')!;
  assert.ok(rec.notes!.some(n=>/empty cell/.test(n)&&/col 2 <- col 1/.test(n)),JSON.stringify(rec.notes));
  const img=await raw(path.join(out,'inimigos/boneco/walk.png'));
  for(let r=0;r<ROWS;r++){
    const a=cellBox(img.data,img.width,0,r*C,C,C),b=cellBox(img.data,img.width,C,r*C,C,C);
    assert.ok(b.occupied>0);assert.equal(b.occupied,a.occupied);assert.equal(b.maxY,56);
  }
});

test('a required shift that leaves the cell margin refuses the enemy and writes nothing', async t=>{
  const {out,records}=await run(t,async src=>{
    const dir=enemy(src,'torto');
    // Body reaching x 2, feet at x 36..46 (centre 41): moving the feet to 32 pushes the body out of the cell.
    await sheet(path.join(dir,'walk.png'),2,()=>[[2,10,40,40],[36,41,46,56]]);
    enemy(src,'reto');await sheet(path.join(src,'inimigos/reto/walk.png'),2,()=>[[28,20,36,56]]);
  });
  const torto=records.find(r=>r.id==='torto')!,reto=records.find(r=>r.id==='reto')!;
  assert.equal(torto.action,'refused');assert.match(torto.refused!,/border/);
  assert.equal(existsSync(path.join(out,'inimigos/torto')),false);
  assert.equal(reto.action,'copied',JSON.stringify(reto));
});

test('deterministic: two runs write the same bytes; untouched sheets are byte copies', async t=>{
  const {root,src,out}=await run(t,async src=>{
    const dir=enemy(src,'boneco');
    // Centred feet, off the ground line: only the walk moves (vertically), so the direction shift is 0.
    await sheet(path.join(dir,'walk.png'),2,()=>[[28,20,36,50]]);
    await sheet(path.join(dir,'hit.png'),2,()=>[[28,20,36,40]]);
  });
  const out2=path.join(root,'out2');await adapt({src,out:out2});
  const files=readdirSync(path.join(out,'inimigos/boneco')).sort();
  assert.deepEqual(files,['hit.png','meta.json','walk.png']);
  for(const f of files)assert.ok(readFileSync(path.join(out,'inimigos/boneco',f)).equals(readFileSync(path.join(out2,'inimigos/boneco',f))),f);
  // hit is airborne and centred: no shift at all, so the delivered bytes are kept.
  assert.ok(readFileSync(path.join(out,'inimigos/boneco/hit.png')).equals(readFileSync(path.join(src,'inimigos/boneco/hit.png'))));
});
