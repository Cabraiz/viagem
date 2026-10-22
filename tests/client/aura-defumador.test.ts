// BUG-20261022-ORQ-circulo-roxo: the Defumador's aura was a lilac ellipse with a thick purple rim around every hero who
// had it (the bots too): a big purple circle on the ground. Now it is painted smoke (render/aura-ring.ts,
// public/art/fx/aura-defumador.webp): no drawn ellipse, no rim, fainter on the allies, light on the download.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,statSync} from 'node:fs';
import {createRequire} from 'node:module';
import {AURA_ALLY_ALPHA,AURA_FRAME_H,AURA_FRAME_W,AURA_FRAMES,AURA_KEY,AURA_SELF_ALPHA,AURA_URL,AuraRings,auraAxes,auraFrameAlphas} from '../../src/client/render/aura-ring.ts';
import {Projector} from '../../src/client/render/projector.ts';

const sharp=createRequire(import.meta.url)('sharp');
const FILE=`public${AURA_URL}`;

test('the aura draws no shape: no Graphics, no fill or stroke of an ellipse or polygon around the heroes',()=>{
  const src=readFileSync('src/client/render/aura-ring.ts','utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm,'');
  for(const call of ['add.graphics','fillPoints','strokePoints','fillEllipse','strokeEllipse','lineStyle','fillStyle'])assert.ok(!src.includes(call),`aura-ring.ts calls ${call}`);
});

/** A scene whose add.image records the images; add.graphics fails the test. */
function fakeScene(loaded=true){
  const images:Record<string,unknown>[]=[];
  const image=(key:string,frame:number)=>{
    const im:Record<string,unknown>={key,frame,visible:true,alpha:1,flipX:false,x:0,y:0,w:0,h:0,depth:0};
    const self=im as Record<string,unknown>&Record<string,(...a:unknown[])=>unknown>;
    Object.assign(im,{
      setName:()=>self,setFlipX:(v:boolean)=>{im.flipX=v;return self;},setVisible:(v:boolean)=>{im.visible=v;return self;},
      setPosition:(x:number,y:number)=>{im.x=x;im.y=y;return self;},setDisplaySize:(w:number,h:number)=>{im.w=w;im.h=h;return self;},
      setAlpha:(a:number)=>{im.alpha=a;return self;},setDepth:(d:number)=>{im.depth=d;return self;},destroy:()=>{},
    });
    images.push(im);return im;
  };
  const scene={
    add:{image:(_x:number,_y:number,key:string,frame:number)=>image(key,frame),graphics:()=>{throw new Error('the aura made a Graphics');}},
    textures:{exists:(k:string)=>loaded&&k===AURA_KEY},
    load:{image:()=>{},once:()=>{},isLoading:()=>true,start:()=>{}},
  };
  return {scene,images};
}

test('one painted pair per hero with the aura, the size of its radius; the local hero\'s plain, the allies\' fainter',()=>{
  const {scene,images}=fakeScene();
  const rings=new AuraRings(scene as never,new Projector(),10);
  rings.draw([{x:5,y:5,r:2,self:true},{x:9,y:5,r:2,self:false}],0,true);
  assert.equal(images.length,4);
  assert.ok(images.every(im=>im.key===AURA_KEY));
  const [selfA,selfB,allyA,allyB]=images;
  const {rx,ry}=auraAxes(2);
  assert.equal(selfA.w,2*rx);assert.equal(selfA.h,2*ry);
  assert.ok(Math.abs(rx/ry-2)<1e-9,'the ground ellipse is 2:1, like the painting');
  assert.equal(selfA.alpha,AURA_SELF_ALPHA);assert.equal(selfB.visible,false,'reduced motion: one painting, still');
  assert.equal(allyA.alpha,AURA_ALLY_ALPHA);assert.equal(allyB.visible,false);
  assert.ok(AURA_ALLY_ALPHA<AURA_SELF_ALPHA/2+.01);
  rings.draw([],0,true);
  assert.ok(images.every(im=>im.visible===false),'no aura, nothing on the ground');
});

test('before the strip is in, nothing is drawn (never a fallback ellipse)',()=>{
  const {scene,images}=fakeScene(false);
  new AuraRings(scene as never,new Projector(),10).draw([{x:5,y:5,r:2,self:true}],0,false);
  assert.equal(images.length,0);
});

test('the two paintings cross-fade without blinking: their opacities always sum to the ring\'s',()=>{
  for(let t=0;t<12000;t+=137){
    const [a,b]=auraFrameAlphas(t,false,AURA_SELF_ALPHA);
    assert.ok(a>=0&&b>=0);assert.ok(Math.abs(a+b-AURA_SELF_ALPHA)<1e-9);
  }
  assert.deepEqual(auraFrameAlphas(4321,true,.4),[.4,0]);
});

test('the strip is a light WebP of the declared frames, and the smoke dissolves before the frame edge (no rim)',async()=>{
  assert.ok(statSync(FILE).size<=120_000,`${FILE} weighs ${statSync(FILE).size} B`);
  const {data,info}=await sharp(FILE).ensureAlpha().raw().toBuffer({resolveWithObject:true});
  assert.equal(info.width,AURA_FRAME_W*AURA_FRAMES);assert.equal(info.height,AURA_FRAME_H);
  const alpha=(x:number,y:number)=>data[(y*info.width+x)*4+3];
  for(let f=0;f<AURA_FRAMES;f++){
    let border=0,band=0;
    for(let x=0;x<AURA_FRAME_W;x++){border=Math.max(border,alpha(f*AURA_FRAME_W+x,0),alpha(f*AURA_FRAME_W+x,AURA_FRAME_H-1));}
    for(let y=0;y<AURA_FRAME_H;y++){border=Math.max(border,alpha(f*AURA_FRAME_W,y),alpha(f*AURA_FRAME_W+AURA_FRAME_W-1,y));}
    // Smoke there is: somewhere along the ring at 3/4 of the ellipse.
    for(let k=0;k<64;k++){const t=k/64*2*Math.PI;band=Math.max(band,alpha(f*AURA_FRAME_W+Math.round(AURA_FRAME_W/2*(1+.75*Math.cos(t))),Math.round(AURA_FRAME_H/2*(1+.75*Math.sin(t)))));}
    assert.ok(border<=8,`frame ${f}: alpha ${border} at the frame's edge`);
    assert.ok(band>=96,`frame ${f}: the smoke band is there (alpha ${band})`);
  }
});
