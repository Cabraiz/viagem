// Card NEW-20261029-ORQ-carro-chaveiro-arte: the parts that fall off the Quadradão are the Codex's images, not boxes.
import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,readFileSync} from 'node:fs';
import sharp from 'sharp';
import {PECAS_CELL,PECAS_KEY,PECAS_SIZES,PECAS_URL} from '../../src/client/render/chaveiro/uno-art.ts';
import {fallenParts,fallingPart,partSpot} from '../../src/client/render/chaveiro/figures.ts';
import {CAR_PARTS} from '../../src/client/render/chaveiro/view.ts';

test('uno pecas: the sheet is in public/ — 4×1 square cells (CAR_PARTS order), each part centred, the corners empty',async()=>{
  const file=`public${PECAS_URL}`;
  assert.ok(existsSync(file),file);
  assert.equal(PECAS_KEY,'chaveiro:quadradao-pecas');
  const {data,info}=await sharp(readFileSync(file)).ensureAlpha().raw().toBuffer({resolveWithObject:true});
  assert.equal(info.width,CAR_PARTS.length*PECAS_CELL);assert.equal(info.height,PECAS_CELL);
  const alpha=(x:number,y:number)=>data[(y*info.width+x)*4+3];
  for(let f=0;f<CAR_PARTS.length;f++){
    const x0=f*PECAS_CELL,[w,h]=PECAS_SIZES[f];
    assert.ok(w<=PECAS_CELL&&h<=PECAS_CELL);
    assert.ok(alpha(x0+PECAS_CELL/2,PECAS_CELL/2)>0||alpha(x0+PECAS_CELL/2,Math.round(PECAS_CELL/2+h/4))>0,`part ${f}: painted around its centre`);
    for(const [x,y] of [[x0,0],[x0+PECAS_CELL-1,0],[x0,PECAS_CELL-1],[x0+PECAS_CELL-1,PECAS_CELL-1]])assert.equal(alpha(x,y),0,`part ${f}: corner ${x},${y}`);
  }
});

test('uno pecas: a part goes from its place on the car to where its box lay on the ground, along the boxes\' path',()=>{
  for(const part of CAR_PARTS){
    const on=fallingPart(part,0)[0],down=fallenParts(1<<CAR_PARTS.indexOf(part))[0],a=partSpot(part,0),b=partSpot(part,1);
    const near=(p:number[],q:number[],what:string)=>p.forEach((v,i)=>assert.ok(Math.abs(v-q[i])<1e-9,`${part} ${what}: ${p} vs ${q}`));
    near([a.x,a.y,a.z,a.turn],[on.x,on.y,on.z+on.h/2,0],'on the car');
    near([b.x,b.y,b.z,b.turn],[down.x,down.y,down.z+down.h/2,down.turn??0],'on the ground');
    // mid-fall it hops, never under the ground
    for(let t=0;t<=1;t+=.1)assert.ok(partSpot(part,t).z>=0);
  }
});
