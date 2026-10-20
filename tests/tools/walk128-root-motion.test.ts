import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {readFile} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import path from 'node:path';

// The imported R06 sheets the game plays (original and lite): each pose keeps the body in place. Before the importer
// aligned them, every row of8 poses slid the figure up to25 px (96 px cell) and snapped back, with a ground line per
// 32-pose source sheet: in game the character skated and jumped while walking or attacking.
sharp.cache(false);sharp.concurrency(1);
const ROOT=path.resolve(import.meta.dirname,'../..'),MAX_STEP=2;

function anchors(data:Buffer,width:number){
  const out:{x:number;bottom:number}[]=[];
  for(let frame=0;frame<128;frame++){
    const sx=frame%16*96,sy=Math.floor(frame/16)*96;let top=96,bottom=-1,sum=0,count=0;
    for(let y=0;y<96;y++)for(let x=0;x<96;x++)if(data[((sy+y)*width+sx+x)*4+3]>20){top=Math.min(top,y);bottom=Math.max(bottom,y);}
    const y0=Math.round(top+(bottom-top)*.25),y1=Math.round(top+(bottom-top)*.55);
    for(let y=y0;y<y1;y++)for(let x=0;x<96;x++)if(data[((sy+y)*width+sx+x)*4+3]>20){sum+=x;count++;}
    out.push({x:sum/count,bottom});
  }
  return out;
}

test('walk128/attack128: torso x and foot line move < 2 px between consecutive poses, every class and direction',async()=>{
  const manifest=JSON.parse(await readFile(path.join(ROOT,'public/art/sprites/manifest.json'),'utf8'));
  const failures:string[]=[];let clips=0;
  for(const [id,piece] of Object.entries<any>(manifest.pieces))for(const [key,file] of Object.entries<any>(piece.files)){
    const motion=/^(walk|attack)128-/.exec(key)?.[1];if(!motion)continue;
    for(const dir of ['public/art/sprites','public/art/lite/sprites']){
      const absolute=path.join(ROOT,dir,file.file);if(dir.includes('lite')&&!existsSync(absolute))continue;
      const {data,info}=await sharp(absolute).ensureAlpha().raw().toBuffer({resolveWithObject:true}),poses=anchors(data,info.width);clips++;
      // walk loops, so the last pose must also meet the first; attack plays once.
      for(let frame=0;frame<(motion==='walk'?128:127);frame++){
        const a=poses[frame],b=poses[(frame+1)%128],dx=Math.abs(a.x-b.x),dy=Math.abs(a.bottom-b.bottom);
        if(dx>=MAX_STEP||dy>=MAX_STEP)failures.push(`${dir.includes('lite')?'lite ':''}${id} ${key} ${frame}→${(frame+1)%128}: Δx ${dx.toFixed(1)} Δfoot ${dy}`);
      }
    }
  }
  assert.ok(clips>=240,`expected the 15 R06 classes × 16 clips at least, got ${clips}`);
  assert.deepEqual(failures.slice(0,20),[],`${failures.length} pose steps ≥ ${MAX_STEP} px`);
});
