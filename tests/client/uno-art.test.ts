// Card NEW-20261022-ORQ-uno-no-jogo: the chaveiro's Quadradão is the imported Uno (8 views) once its sheet is in.
import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,readFileSync} from 'node:fs';
import sharp from 'sharp';
import {UNO_CELL,UNO_FOOT,UNO_KEY,UNO_SCALE,UNO_SIZES,UNO_URL,UNO_VIEWS,unoFootY,unoFrame} from '../../src/client/render/chaveiro/uno-art.ts';
import {CAR_HALF} from '../../src/client/render/chaveiro/figures.ts';

const Q=Math.PI/4;
const view=(heading:number,v=0)=>UNO_VIEWS[unoFrame(heading,v)];

test('uno: the nose picks the view; a car along a world axis takes a diagonal one (the 2:1 squash undone)',()=>{
  // world +x goes down-right on the screen, +y down-left (isoOffset)
  assert.equal(view(0),'SE');
  assert.equal(view(Math.PI/2),'SO');
  assert.equal(view(Math.PI),'NO');
  assert.equal(view(-Math.PI/2),'NE');
  assert.equal(view(Q),'S');
  assert.equal(view(3*Q),'O');
  assert.equal(view(-3*Q),'N');
  assert.equal(view(-Q),'L');
  // the camera turned a quarter: world +x now goes where +y went
  assert.equal(view(0,1),'SO');
  assert.equal(view(0,2),'NO');
  assert.equal(view(0,3),'NE');
});

test('uno: every view is reached at every camera view, and a near heading keeps its view',()=>{
  for(let v=0;v<4;v++){
    const seen=new Set<string>();
    for(let i=0;i<64;i++)seen.add(view(i/64*Math.PI*2,v));
    assert.equal(seen.size,8,`view ${v}`);
  }
  assert.equal(view(.05),view(-.05));
});

test('uno: the wheels sit below the centre, deepest when the car points down the screen',()=>{
  for(let i=0;i<8;i++)assert.ok(unoFootY(i*Q,0)>0);
  assert.ok(unoFootY(Q,0)>unoFootY(-Q,0));
  // about the provisional car's size on the screen: the diagonal view as wide as its footprint
  assert.ok(Math.abs(281*UNO_SCALE-2*(CAR_HALF.l+CAR_HALF.w)*42)<1e-9);
});

test('uno: the sheet is in public/ — 4×2 square cells, each view on the wheel line, nothing in the corners',async()=>{
  const file=`public${UNO_URL}`;
  assert.ok(existsSync(file),file);
  assert.equal(UNO_KEY,'chaveiro:quadradao');
  const {data,info}=await sharp(readFileSync(file)).ensureAlpha().raw().toBuffer({resolveWithObject:true});
  assert.equal(info.width,4*UNO_CELL);assert.equal(info.height,2*UNO_CELL);
  for(let f=0;f<8;f++){
    const x0=(f%4)*UNO_CELL,y0=Math.floor(f/4)*UNO_CELL;let low=-1,top=UNO_CELL,l=UNO_CELL,r=-1,count=0;
    for(let y=0;y<UNO_CELL;y++)for(let x=0;x<UNO_CELL;x++)if(data[((y0+y)*info.width+x0+x)*4+3]>60){count++;low=Math.max(low,y);top=Math.min(top,y);l=Math.min(l,x);r=Math.max(r,x);}
    // the box the life bar and the fade use is the frame's own, centred
    const [w,h]=UNO_SIZES[UNO_VIEWS[f]];
    assert.ok(Math.abs(r-l+1-w)<=3&&Math.abs(low-top+1-h)<=3,`frame ${UNO_VIEWS[f]} box ${r-l+1}×${low-top+1} vs ${w}×${h}`);
    assert.ok(Math.abs((l+r+1)/2-UNO_CELL/2)<=2,`frame ${UNO_VIEWS[f]} centred`);
    assert.ok(count>UNO_CELL*UNO_CELL*.15,`frame ${UNO_VIEWS[f]} has the car`);
    assert.ok(Math.abs(low-Math.round(UNO_FOOT*UNO_CELL))<=2,`frame ${UNO_VIEWS[f]} wheels at ${low}`);
    assert.equal(data[(y0*info.width+x0)*4+3],0,`frame ${UNO_VIEWS[f]} corner transparent`);
  }
});
