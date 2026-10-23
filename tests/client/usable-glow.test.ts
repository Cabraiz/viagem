// Usable glow (card NEW-20261023-ORQ-contorno-usavel-wc3): the Warcraft 3 gold outline on what the player can use and on
// the player's shot — its look (gold over a solid Breu band, on screen px), the pulse, and the copies that follow the sprite.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {GLOW_BANDS,GLOW_BREU,GLOW_MAX,GLOW_MIN,GLOW_PERIOD_MS,SHOT_BANDS,copiesOf,copySlot,glowAlpha} from '../../src/client/render/usable-glow-rules.ts';
import {POOL_MAX,UsableGlow} from '../../src/client/render/usable-glow.ts';
import {INTERATIVO_COR} from '../../src/client/hud/tralha/model.ts';

test('the glow is the interactive gold hugging the figure, a solid Breu band outside it, thinner on the shot', ()=>{
  for(const bands of [GLOW_BANDS,SHOT_BANDS]){
    assert.equal(bands.length,2);
    const [outer,inner]=bands;
    assert.equal(outer.color,GLOW_BREU);assert.equal(inner.color,INTERATIVO_COR);
    assert.ok(outer.css>inner.css,'Breu reaches farther out than the gold');
    assert.ok(outer.depth<inner.depth&&inner.depth<0,'both under the sprite, Breu deepest');
  }
  assert.ok(GLOW_BANDS[1].css>=2,'the gold reads at 2+ CSS px');
  assert.ok(SHOT_BANDS[1].css<GLOW_BANDS[1].css,'a bullet gets a thinner glow');
  assert.equal(copiesOf(GLOW_BANDS),16);
  assert.equal(copiesOf(SHOT_BANDS),8,'a shot: 4 directions per band');
  const dirs=Array.from({length:8},(_,i)=>copySlot(SHOT_BANDS,i).dir).sort();
  assert.deepEqual(dirs,[0,1,2,3,4,5,6,7],'Breu and gold together cover the 8 directions');
});

test('the gold pulses once a second between its bounds; steady with reduced motion', ()=>{
  const samples=Array.from({length:40},(_,i)=>glowAlpha(i*GLOW_PERIOD_MS/40,false));
  assert.ok(Math.min(...samples)>=GLOW_MIN-1e-9&&Math.max(...samples)<=GLOW_MAX+1e-9);
  assert.ok(Math.max(...samples)-Math.min(...samples)>.3,'a visible pulse');
  assert.ok(Math.abs(glowAlpha(123,false)-glowAlpha(123+GLOW_PERIOD_MS,false))<1e-9,'period');
  for(const t of [0,250,500,750])assert.equal(glowAlpha(t,true),GLOW_MAX);
  assert.equal(glowAlpha(NaN,false),GLOW_MAX);
});

/** A chainable stand-in for Phaser images (only what UsableGlow touches). */
function fakeImage(key:string,frame:string|number=0){
  const img:any={texture:{key},frame:{name:String(frame)},x:0,y:0,depth:0,alpha:1,visible:true,originX:.5,originY:.5,scaleX:1,scaleY:1,flipX:false,flipY:false,rotation:0,tint:-1,destroyed:false};
  const set=(f:(...a:any[])=>void)=>(...a:any[])=>{f(...a);return img;};
  Object.assign(img,{
    setTexture:set((k:string,f?:string|number)=>{img.texture={key:k};img.frame={name:String(f??0)};}),
    setFrame:set((f:string|number)=>{img.frame={name:String(f)};}),
    setTintFill:set((c:number)=>{img.tint=c;}),setName:set(()=>{}),
    setOrigin:set((x:number,y:number)=>{img.originX=x;img.originY=y;}),setScale:set((x:number,y:number)=>{img.scaleX=x;img.scaleY=y;}),
    setFlip:set((x:boolean,y:boolean)=>{img.flipX=x;img.flipY=y;}),setRotation:set((r:number)=>{img.rotation=r;}),
    setPosition:set((x:number,y:number)=>{img.x=x;img.y=y;}),setDepth:set((d:number)=>{img.depth=d;}),setAlpha:set((a:number)=>{img.alpha=a;}),
    setVisible:set((v:boolean)=>{img.visible=v;}),destroy:()=>{img.destroyed=true;},
  });
  return img;
}
function fakeScene(){const made:any[]=[];return {made,scene:{add:{image:(_x:number,_y:number,k:string,f:string|number)=>{const i=fakeImage(k,f);made.push(i);return i;}}} as any};}

test('copies follow the sprite: same texture and frame, 8 directions per band at css × k, under it, gold pulsing and Breu solid', ()=>{
  const {made,scene}=fakeScene(),glow=new UsableGlow(scene,false);
  const src=fakeImage('art:barricada',3);src.x=100;src.y=50;src.depth=10;src.scaleX=src.scaleY=.4;src.flipX=true;
  glow.begin(GLOW_PERIOD_MS*.75);glow.mark('b1',src,2);glow.end();
  assert.equal(made.length,16);
  for(const c of made){
    assert.equal(c.texture.key,'art:barricada');assert.equal(c.frame.name,'3');
    assert.equal(c.scaleX,.4);assert.equal(c.flipX,true);assert.ok(c.depth<10);assert.ok(c.visible);
  }
  const breu=made.filter(c=>c.tint===GLOW_BREU),gold=made.filter(c=>c.tint===INTERATIVO_COR);
  assert.equal(breu.length,8);assert.equal(gold.length,8);
  for(const c of breu){assert.ok(Math.abs(Math.hypot(c.x-100,c.y-50)-GLOW_BANDS[0].css*2)<1e-4);assert.equal(c.alpha,1);}
  for(const c of gold){assert.ok(Math.abs(Math.hypot(c.x-100,c.y-50)-GLOW_BANDS[1].css*2)<1e-4);assert.ok(Math.abs(c.alpha-GLOW_MIN)<1e-9);assert.ok(c.depth>breu[0].depth);}
  // Next frame: the sprite moved and changed frame; nothing new is made.
  src.x=110;src.setFrame(4);
  glow.begin(0);glow.mark('b1',src,2);glow.end();
  assert.equal(made.length,16);
  assert.ok(made.every(c=>c.frame.name==='4'));
  assert.equal(glow.stats().shown,1);
});

test('unmarked or hidden sprites lose their glow; unused glows go back to the pool', ()=>{
  const {made,scene}=fakeScene(),glow=new UsableGlow(scene,true);
  const src=fakeImage('item');
  glow.begin(0);glow.mark('i',src,1);glow.end();
  assert.ok(made.every(c=>c.visible));
  glow.begin(16);glow.end();
  assert.ok(made.every(c=>!c.visible),'not marked: hidden');
  src.visible=false;glow.begin(32);glow.mark('i',src,1);glow.end();
  assert.ok(made.every(c=>!c.visible),'hidden sprite: no glow');
  glow.begin(48);glow.end();
  assert.equal(glow.stats().glows,0);assert.equal(glow.stats().pooled,1);
  // Reduced motion: the gold is steady.
  const again=fakeImage('item');glow.begin(GLOW_PERIOD_MS*.75);glow.mark('j',again,1);glow.end();
  assert.ok(made.filter(c=>!c.destroyed&&c.tint===INTERATIVO_COR).every(c=>c.alpha===GLOW_MAX));
});

test('the shot bands make 8 thinner copies and switching bands rebuilds them', ()=>{
  const {made,scene}=fakeScene(),glow=new UsableGlow(scene,false),src=fakeImage('proj');
  glow.begin(0);glow.mark('t',src,1,SHOT_BANDS);glow.end();
  assert.equal(made.length,8);
  const far=Math.max(...made.map(c=>Math.hypot(c.x,c.y)));
  assert.ok(Math.abs(far-SHOT_BANDS[0].css)<1e-4);
  glow.begin(1);glow.mark('t',src,1);glow.end();
  assert.equal(made.length,24,'the shot glow went to its pool, the usable one was made');
});

test('a stream of shots (a new id every frame) creates no GameObjects once the pool is warm', ()=>{
  const {made,scene}=fakeScene(),glow=new UsableGlow(scene,false),src=fakeImage('proj');
  for(let f=0;f<5;f++){glow.begin(f);for(let i=0;i<3;i++)glow.mark(`tiro:${f*3+i}`,src,1,SHOT_BANDS);glow.end();}
  const warm=glow.created;
  assert.ok(warm<=2*3*8,"one frame in use + one pooled");
  for(let f=5;f<300;f++){glow.begin(f);for(let i=0;i<3;i++)glow.mark(`tiro:${f*3+i}`,src,1,SHOT_BANDS);glow.end();}
  assert.equal(glow.created,warm);assert.equal(made.filter(c=>c.destroyed).length,0);
  glow.destroy();assert.ok(made.every(c=>c.destroyed));
});

test('the pool keeps at most POOL_MAX glows; the rest are destroyed', ()=>{
  const {made,scene}=fakeScene(),glow=new UsableGlow(scene,false),src=fakeImage('proj');
  glow.begin(0);for(let i=0;i<POOL_MAX+5;i++)glow.mark(`t${i}`,src,1,SHOT_BANDS);glow.end();
  glow.begin(1);glow.end();
  assert.equal(glow.stats().pooled,POOL_MAX);assert.equal(made.filter(c=>c.destroyed).length,5*8);
});
