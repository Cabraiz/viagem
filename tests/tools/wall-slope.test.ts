/**
 * Walls' straight pieces join without a step (NEW-20261029-ORQ-cercas-nordeste-ligadas, print 0): a wall line runs
 * along a cell axis, ±1/2 on screen, so the post bases of every view of every `<família>-reto-<estado>` sheet must run
 * at ±1/2 (scripts/art-v2/adaptar/wall-slope.mjs). levelWallBase brings a view drawn at another slope there, posts
 * upright and the middle in place; the adapter levels new deliveries, scripts/wall-slope.mjs the imported sheets.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {levelWallBase,wallBaseSlope,WALL_SLOPE,WALL_SLOPE_TOLERANCE} from '../../scripts/art-v2/adaptar/wall-slope.mjs';
import {WALLS} from '../../scripts/art-v2/adaptar/decor.mjs';

sharp.cache(false);sharp.concurrency(1);

const ROOT=path.resolve(import.meta.dirname,'../..'),DIR=path.join(ROOT,'public/art/city/decor');
type Img={data:Buffer,width:number,height:number};

/** A fence view: two posts 8 px wide joined by a panel whose base drops `slope` px per column. */
function fence(slope:number,w=200,h=240):Img{
  const img={data:Buffer.alloc(w*h*4),width:w,height:h},x0=20,x1=w-21,base=(x:number)=>Math.round(140+slope*(x-(x0+x1)/2));
  for(let x=x0;x<=x1;x++){
    const post=x<x0+8||x>x1-8,b=post?base(post&&x<x0+8?x0+3:x1-3):base(x),top=b-(post?60:40);
    for(let y=top;y<=b;y++)img.data.set([120,90,60,255],(y*w+x)*4);
  }
  return img;
}
const postColumns=(img:Img,x:number)=>{const ys:number[]=[];for(let y=0;y<img.height;y++)if(img.data[(y*img.width+x)*4+3]>128)ys.push(y);return ys;};

test('levelWallBase brings a view drawn at 0.4 or 0.7 to ±1/2, posts upright, the middle in place', ()=>{
  for(const s of [.4,-.4,.7,-.62]){
    const before=fence(s),after=levelWallBase(before),m=wallBaseSlope(after)!;
    assert.ok(Math.abs(m.slope-Math.sign(s)*WALL_SLOPE)<=WALL_SLOPE_TOLERANCE,`slope ${s} → ${m.slope}`);
    const mid=Math.round((m.x0+m.x1)/2);
    assert.deepEqual(postColumns(after,mid).at(-1),postColumns(before,mid).at(-1),'the middle of the base stays');
    // An end post is one block: its columns share their top and bottom rows within a pixel.
    for(const [a,b] of [[m.x0+1,m.x0+6],[m.x1-6,m.x1-1]]){
      const pa=postColumns(after,a),pb=postColumns(after,b);
      assert.ok(Math.abs(pa.at(-1)!-pb.at(-1)!)<=Math.ceil(Math.abs(s-Math.sign(s)*WALL_SLOPE)*5)+1,`post foot at ${a}/${b}`);
    }
  }
  const ok=fence(.5);
  assert.equal(levelWallBase(ok),ok,'a view at ±1/2 is left as delivered');
});

test('levelWallBase refuses to push a drawn pixel out of the frame, and grows it when asked', ()=>{
  const tight=fence(.3,200,166);
  assert.throws(()=>levelWallBase(tight),/out of the/);
  const grown=levelWallBase(tight,{grow:true});
  assert.ok(grown.height>tight.height);
  assert.ok(Math.abs(wallBaseSlope(grown)!.slope-WALL_SLOPE)<=WALL_SLOPE_TOLERANCE);
});

test('every view of every wall straight piece in the game has its base at ±1/2', async ()=>{
  const manifest=JSON.parse(readFileSync(path.join(DIR,'manifest.json'),'utf8'));
  for(const family of WALLS)for(const state of ['intacto','quebrado']){
    const id=`${family}-reto-${state}`,sheet=manifest.pieces[id].files.sheet,[cw,ch]=sheet.cell;
    const {data,info}=await sharp(path.join(DIR,sheet.file)).ensureAlpha().raw().toBuffer({resolveWithObject:true});
    for(let v=0;v<sheet.views;v++){
      const view={data:Buffer.alloc(cw*ch*4),width:cw,height:ch};
      for(let y=0;y<ch;y++)data.copy(view.data,y*cw*4,(y*info.width+v*cw)*4,(y*info.width+(v+1)*cw)*4);
      const slope=wallBaseSlope(view)!.slope;
      // Views 0 and 2 draw the line "/" (rising to the right), 1 and 3 "\".
      assert.ok(Math.abs(slope-(v%2?WALL_SLOPE:-WALL_SLOPE))<=WALL_SLOPE_TOLERANCE,`${id} view ${v}: base slope ${slope.toFixed(3)} (node scripts/wall-slope.mjs)`);
    }
  }
});
