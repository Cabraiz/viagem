// Card NEW-20261022-ORQ-uno-no-jogo: the chaveiro's Quadradão is the imported Uno (8 views) once its sheet is in.
import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,readFileSync} from 'node:fs';
import sharp from 'sharp';
import {UNO_CELL,UNO_ENGINE,UNO_FOOT,UNO_KEY,UNO_SCALE,UNO_SIZES,UNO_SMOKE_FPS,UNO_SMOKE_FRAMES,UNO_SMOKE_H,UNO_SMOKE_SCALE,UNO_SMOKE_SRC,UNO_SMOKE_URL,UNO_SMOKE_W,UNO_URL,UNO_VIEWS,unoFootY,unoFrame,unoSmoke} from '../../src/client/render/chaveiro/uno-art.ts';
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

// Card NEW-20261028-ORQ-uno-capo-fumaca: the hood raised and the Codex's smoke (16 frames) out of the engine.
test('uno smoke: the sheet is 8×2 frames, the source at UNO_SMOKE_SRC in every frame, nothing on the edges, the loop has no jump',async()=>{
  const file=`public${UNO_SMOKE_URL}`;
  assert.ok(existsSync(file),file);
  const {data,info}=await sharp(readFileSync(file)).ensureAlpha().raw().toBuffer({resolveWithObject:true});
  assert.equal(info.width,8*UNO_SMOKE_W);assert.equal(info.height,2*UNO_SMOKE_H);
  assert.equal(UNO_SMOKE_FRAMES,16);
  const alpha=(f:number,x:number,y:number)=>data[((Math.floor(f/8)*UNO_SMOKE_H+y)*info.width+(f%8)*UNO_SMOKE_W+x)*4+3]/255;
  const diffs:number[]=[];
  for(let f=0;f<UNO_SMOKE_FRAMES;f++){
    let edge=0,low=-1,sum=0,sx=0,diff=0;
    for(let y=0;y<UNO_SMOKE_H;y++)for(let x=0;x<UNO_SMOKE_W;x++){
      const a=alpha(f,x,y);
      if(x<2||y<2||x>=UNO_SMOKE_W-2||y>=UNO_SMOKE_H-2)edge=Math.max(edge,a);
      if(a>.2)low=Math.max(low,y);
      diff+=Math.abs(a-alpha((f+1)%UNO_SMOKE_FRAMES,x,y));
    }
    for(let y=low-16;y<=low;y++)for(let x=0;x<UNO_SMOKE_W;x++){const a=alpha(f,x,y);sum+=a;sx+=a*x;}
    assert.ok(edge<.03,`frame ${f} touches the edge (${edge})`);
    assert.ok(Math.abs(low-UNO_SMOKE_SRC[1])<=2,`frame ${f} source y ${low}`);
    assert.ok(Math.abs(sx/sum-UNO_SMOKE_SRC[0])<=3,`frame ${f} source x ${sx/sum}`);
    diffs.push(diff);
  }
  // every step (the seam 16 → 1 too) within 1.3× the median step: no frame jumps
  const med=[...diffs].sort((a,b)=>a-b)[8];
  for(const [f,d] of diffs.entries())assert.ok(d/med<=1.3,`step ${f}→${(f+1)%16} is ${(d/med).toFixed(2)}× the median`);
});

test('uno smoke: out of the engine of each view, over the car where the engine shows and behind it where the hood hides it',async()=>{
  const {data,info}=await sharp(readFileSync(`public${UNO_URL}`)).ensureAlpha().raw().toBuffer({resolveWithObject:true});
  for(const [f,v] of UNO_VIEWS.entries()){
    const [ex,ey]=UNO_ENGINE[v],x0=(f%4)*UNO_CELL,y0=Math.floor(f/4)*UNO_CELL;
    // the engine's mouth is on the car (its body or the raised hood), not in the air
    let on=0;for(let dy=-4;dy<=4;dy++)for(let dx=-4;dx<=4;dx++)if(data[((y0+ey+dy)*info.width+x0+ex+dx)*4+3]>60)on++;
    assert.ok(on>=60,`${v}: engine (${ex},${ey}) off the car (${on}/81)`);
    const s=unoSmoke(f,100,200,0);
    assert.ok(Math.abs(s.x-(100+(ex-UNO_CELL/2)*UNO_SCALE))<1e-9&&Math.abs(s.y-(200+(ey-UNO_CELL*UNO_FOOT)*UNO_SCALE))<1e-9);
    assert.equal(s.behind,v==='N'||v==='NO'||v==='NE',v);
  }
  // the loop: UNO_SMOKE_FPS frames a second, round and round; one still frame with reduced effects
  assert.equal(unoSmoke(0,0,0,0).frame,0);
  assert.equal(unoSmoke(0,0,0,1000).frame,UNO_SMOKE_FPS%UNO_SMOKE_FRAMES);
  assert.equal(unoSmoke(0,0,0,UNO_SMOKE_FRAMES*1000/UNO_SMOKE_FPS+1).frame,0);
  assert.equal(unoSmoke(0,0,0,777,true).frame,0);
  // the column is about the car's cell tall
  assert.ok(Math.abs(UNO_SMOKE_H*UNO_SMOKE_SCALE-.9*UNO_CELL)<1e-9);
});
