// BUG-20261022-ORQ-circulo-roxo: the Defumador's aura was a lilac ellipse with a thick purple rim around every hero who
// had it (the bots too): a big purple circle on the ground. Now it is painted smoke (render/aura-ring.ts,
// public/art/fx/aura-defumador.webp): no drawn ellipse, no rim, fainter on the allies, light on the download.
// NEW-20261029-ORQ-aura-defumador-fumaca: the smoke is puffs rising (one puff's life in six frames), not a still ring.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,statSync} from 'node:fs';
import {createRequire} from 'node:module';
import {AURA_ALLY_ALPHA,AURA_FRAME_H,AURA_FRAME_W,AURA_FRAMES,AURA_FRONT_ALLY,AURA_FRONT_SELF,AURA_GROUND_ALPHA,AURA_KEY,AURA_SELF_ALPHA,AURA_URL,AuraRings,auraPuff,auraPuffCount} from '../../src/client/render/aura-ring.ts';
import {Projector} from '../../src/client/render/projector.ts';
import {StepLerp} from '../../src/client/framing.ts';

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
      setName:()=>self,setOrigin:()=>self,setFrame:(f:number)=>{im.frame=f;return self;},setFlipX:(v:boolean)=>{im.flipX=v;return self;},setVisible:(v:boolean)=>{im.visible=v;return self;},
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

test("one ring of puffs per hero with the aura, as many as its length holds; the local hero's plain, the allies' fainter",()=>{
  const {scene,images}=fakeScene();
  const rings=new AuraRings(scene as never,new Projector(),10);
  rings.draw([{x:5,y:5,r:2,self:true},{x:9,y:5,r:1.3,self:false}],0,true);
  const n=auraPuffCount(2),m=auraPuffCount(1.3);
  assert.ok(n>m&&m>=10&&n<=24,`${n} and ${m} puffs`);
  assert.equal(images.length,n+m);
  assert.ok(images.every(im=>im.key===AURA_KEY));
  const self=images.slice(0,n),ally=images.slice(n);
  assert.ok(self.every(im=>im.visible&&(im.alpha as number)<=AURA_SELF_ALPHA+1e-9));
  assert.ok(Math.max(...ally.map(im=>im.alpha as number))<Math.min(...self.map(im=>im.alpha as number)),"every ally puff fainter than the local hero's");
  assert.ok(AURA_ALLY_ALPHA<AURA_SELF_ALPHA/2+.01);
  rings.draw([],0,true);
  assert.ok(images.every(im=>im.visible===false),'no aura, nothing on the ground');
});

test('before the sheet is in, nothing is drawn (never a fallback ellipse)',()=>{
  const {scene,images}=fakeScene(false);
  new AuraRings(scene as never,new Projector(),10).draw([{x:5,y:5,r:2,self:true}],0,false);
  assert.equal(images.length,0);
});

test('a puff is born thin on the ground, rises through the six frames, fullest mid-air, and fades out; still with reduced motion',()=>{
  const out={x:0,y:0,t:0,frame:0,alpha:0,scale:1,rise:0,flip:false};
  for(let i=0;i<12;i++){
    const seen=new Set<number>();let ground=1,peak=0,last=0,prevT=-1,prevFrame=0,prevRise=0;
    for(let now=0;now<4000;now+=20){
      const o=auraPuff(i,12,0,0,2,now,false,1,out);
      const d=Math.hypot(o.x,o.y);assert.ok(d>=.86*2-1e-9&&d<=2+1e-9,'on the ring');
      seen.add(o.frame);
      if(o.t<.04)ground=Math.min(ground,o.alpha);
      if(o.t>.35&&o.t<.7)peak=Math.max(peak,o.alpha);
      if(o.t>.99)last=Math.max(last,o.alpha);
      if(o.t>prevT&&prevT>=0){assert.ok(o.frame>=prevFrame&&o.rise>=prevRise,'frames and rise only go forward over a life');}
      prevT=o.t;prevFrame=o.frame;prevRise=o.rise;
    }
    assert.equal(seen.size,AURA_FRAMES,`puff ${i} shows every frame`);
    assert.ok(ground<=AURA_GROUND_ALPHA+.05,`thin on the ground (${ground})`);
    assert.ok(peak>.99,'full mid-air');assert.ok(last<.02,'gone before it is born again');
  }
  const a=auraPuff(3,12,0,0,2,0,true,.5,{...out}),b=auraPuff(3,12,0,0,2,7777,true,.5,{...out});
  assert.deepEqual(a,b,'reduced motion: the puff stands still');
  assert.equal(a.rise,0);assert.ok(a.alpha>.15,'and is seen');
});

test('the puffs in front of the hero draw over his feet, the ones behind under him (island and city)',()=>{
  for(const city of [false,true]){
    const {scene,images}=fakeScene(),projector=new Projector();
    if(city)projector.depthOverride=(x,y)=>(x+y)*10;
    new AuraRings(scene as never,projector,10).draw([{x:5,y:5,r:2,self:true}],1234,true);
    const feet=projector.project(5,5,{x:0,y:0}),hero=city?100:96500;
    const front=images.filter(im=>(im.y as number)>feet.y+5),back=images.filter(im=>(im.y as number)<feet.y-5);
    assert.ok(front.length>2&&back.length>2);
    assert.ok(front.every(im=>(im.depth as number)>hero),`${city?'city':'island'}: front puffs over the hero`);
    assert.ok(back.every(im=>(im.depth as number)<hero),`${city?'city':'island'}: back puffs under the hero`);
  }
  const you=readFileSync('src/client/render/you.ts','utf8');
  assert.equal(AURA_FRONT_SELF,Number(/export const SELF_DEPTH=(\d+)/.exec(you)?.[1])+.5);
  assert.equal(AURA_FRONT_ALLY,Number(/export const ALLY_DEPTH=(\d+)/.exec(you)?.[1])+.5);
});

test('the sheet is a light WebP of six square frames of one puff, each clear at its edges, the puff grown by the full frame',async()=>{
  assert.ok(statSync(FILE).size<=60_000,`${FILE} weighs ${statSync(FILE).size} B`);
  const {data,info}=await sharp(FILE).ensureAlpha().raw().toBuffer({resolveWithObject:true});
  assert.equal(info.width,AURA_FRAME_W*AURA_FRAMES);assert.equal(info.height,AURA_FRAME_H);
  const alpha=(x:number,y:number)=>data[(y*info.width+x)*4+3];
  const area:number[]=[];
  for(let f=0;f<AURA_FRAMES;f++){
    let border=0,solid=0;
    for(let x=0;x<AURA_FRAME_W;x++){border=Math.max(border,alpha(f*AURA_FRAME_W+x,0),alpha(f*AURA_FRAME_W+x,AURA_FRAME_H-1));}
    for(let y=0;y<AURA_FRAME_H;y++){border=Math.max(border,alpha(f*AURA_FRAME_W,y),alpha(f*AURA_FRAME_W+AURA_FRAME_W-1,y));}
    for(let y=0;y<AURA_FRAME_H;y++)for(let x=0;x<AURA_FRAME_W;x++)if(alpha(f*AURA_FRAME_W+x,y)>128)solid++;
    assert.ok(border<=8,`frame ${f}: alpha ${border} at the frame's edge`);
    assert.ok(solid>60,`frame ${f}: there is smoke (${solid} px)`);
    area.push(solid);
  }
  assert.ok(area[0]<area[2]/2,'born small, full in frame 3');
  assert.ok(area[5]<area[2]/4,'only wisps at the end');
});

test('the smoke is centred on the feet the scene drew this frame, after every hero is placed (aura-descentralizada)',()=>{
  // At locate() (inside horde.update, before place()) the smoke sat on net.predicted, which moves in 50 ms steps a step
  // ahead of the smoothed sprite, and on the allies' last network state, ahead of their buffered sprite.
  const scene=readFileSync('src/client/scene.ts','utf8');
  const arsenal=readFileSync('src/client/render/arsenal-fx.ts','utf8');
  assert.match(scene,/auraFromScene:true/);
  assert.match(arsenal,/if\(!this\.options\.auraFromScene\)this\.drawAuras\(/);
  const coop=scene.slice(scene.indexOf('private updateCoop('));
  const at=(s:string)=>{const i=coop.indexOf(s);assert.ok(i>=0,s);return i;};
  const auras=at('this.horde?.auras(id=>feet.get(id));');
  assert.ok(at('this.horde?.update(time,delta)')<auras,'after the horde update');
  assert.ok(at('this.place();')<auras&&at('feet.set(net.id,{x:this.position.x+this.selfShift.x,y:this.position.y+this.selfShift.y})')<auras,'the hero at his drawn spot (with the push shift), after place()');
  const ally=at('feet.set(player.id,{x:drawnAt.x,y:drawnAt.y})');
  assert.ok(at('objects.image.setPosition(q.x,q.y)')>ally&&ally<auras,'each ally at the spot its sprite is put');
});

test('running at 60 and at 20 fps the smoke stays on the hero\'s feet in every frame; the raw prediction did not',()=>{
  const {scene,images}=fakeScene();
  const projector=new Projector(),rings=new AuraRings(scene as never,projector,10),q={x:0,y:0};
  for(const fps of [60,20]){
    const lerp=new StepLerp(),STEP=.05,speed=6;let predicted={x:5,y:5},acc=0,worstOld=0;
    lerp.sync(predicted);
    for(let frame=0;frame<fps*2;frame++){
      acc+=1/fps;
      while(acc>=STEP){predicted={x:predicted.x+speed*STEP,y:predicted.y};acc-=STEP;lerp.push(predicted);}
      const feet=lerp.at(acc/STEP);
      rings.draw([{x:feet.x,y:feet.y,r:2,self:true}],frame*1000/fps,false);
      projector.project(feet.x,feet.y,q);
      const o=auraPuff(0,auraPuffCount(2),feet.x,feet.y,2,frame*1000/fps,false,1,{x:0,y:0,t:0,frame:0,alpha:0,scale:1,rise:0,flip:false});
      const at=projector.project(o.x,o.y,{x:0,y:0});
      assert.ok(Math.abs(images[0].x as number-at.x)<1e-9&&Math.abs(images[0].y as number+o.rise-at.y)<1e-9,`${fps} fps frame ${frame}`);
      const old=projector.project(predicted.x,predicted.y,{x:0,y:0});worstOld=Math.max(worstOld,Math.hypot(old.x-q.x,old.y-q.y));
    }
    assert.ok(worstOld>5,`${fps} fps: the prediction ran ${worstOld.toFixed(1)} px off the sprite (the bug this guards)`);
  }
});
