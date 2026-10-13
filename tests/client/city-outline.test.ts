// City-mode Breu outlines (card NEW-20261012-E8-cidade-contorno-breu): rim switch by ground, screen-scale copies,
// key/frame mapping, budget and rebuild, and the proof that the island and the endless map keep their base keys.
import {test,afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {CITY_RING,GROUND_LUMINANCE,RIM_SWITCH_LUMINANCE,changedEnough,copyResolution,cityGroundLuminance,cityKey,copyX,copyY,cropOf,isCityKey,
  rimForGround,slotOf,textureBytes,textureFor,variantGeometry,variantOrigin} from '../../src/client/render/city-outline-rules.ts';
import {CityOutlines,type CityOutlineHost} from '../../src/client/render/city-outline.ts';
import {outlineRgba} from '../../src/client/render/outline.ts';
import {ENEMY_KINDS,ENEMY_TEXTURES,PICKUP_KINDS,enemyTexture,pickupTexture,FX} from '../../src/client/render/keys.ts';
import {applyEnemyArt,enemyArtKey,enemyDrawScale} from '../../src/client/art/horde-art.ts';
import {parseArtIndex,setArtIndex} from '../../src/client/art/manifest.ts';
import {CITY_VIEW_SCALE,cityZoom} from '../../src/client/framing.ts';
import type {CityAsset} from '../../src/client/render/city/asset.ts';

afterEach(()=>setArtIndex(parseArtIndex({version:2,groups:{}})));

test('rim switch: umber from 0.262 up, Breu below (PORTAO "O aro do motor")',()=>{
  assert.equal(RIM_SWITCH_LUMINANCE,0.262);
  assert.equal(rimForGround(0.262),'umber');assert.equal(rimForGround(0.372),'umber');assert.equal(rimForGround(0.626),'umber');
  assert.equal(rimForGround(0.2619),'breu');assert.equal(rimForGround(0.228),'breu');assert.equal(rimForGround(0.163),'breu');
  assert.equal(rimForGround(Number.NaN),'breu','unknown ground: the Breu ring, which passes on every ground');
});

test('city grounds: snow, packed snow, ice and cobble keep the umber rim; water and rubble switch to Breu',()=>{
  const rim=(k:keyof typeof GROUND_LUMINANCE)=>rimForGround(GROUND_LUMINANCE[k]);
  assert.deepEqual({snow:rim('snow'),packed:rim('packed'),ice:rim('ice'),cobble:rim('cobble'),water:rim('water'),rubble:rim('rubble')},
    {snow:'umber',packed:'umber',ice:'umber',cobble:'umber',water:'breu',rubble:'breu'});
  // Every walkable ground stays above the D-037 floor of 0.131, where even the Breu ring needs it.
  for(const [k,l] of Object.entries(GROUND_LUMINANCE))assert.ok(l>=0.131,`${k} ${l}`);
});

test('ground luminance under a world point reads the city grid (snow outside it)',()=>{
  const asset={version:1,name:'t',cell:0.88,width:3,height:1,origin:{x:10,y:20},heights:[0,0,0],ground:'swr',blocks:[],props:[],points:{}} as CityAsset;
  assert.equal(cityGroundLuminance(asset,10.1,20.1),GROUND_LUMINANCE.snow);
  assert.equal(cityGroundLuminance(asset,10+0.88*1.5,20.1),GROUND_LUMINANCE.water);
  assert.equal(cityGroundLuminance(asset,10+0.88*2.5,20.5),GROUND_LUMINANCE.rubble);
  assert.equal(cityGroundLuminance(asset,-50,-50),GROUND_LUMINANCE.snow);
});

test('island and endless map: every draw site keeps its base key (no city copy outside the city)',()=>{
  const bases=[...ENEMY_KINDS.flatMap(k=>[enemyTexture(k),enemyTexture(k,true)]),...PICKUP_KINDS.map(pickupTexture),FX.boleto,
    'sprite:cidadao-comum:dir4',enemyArtKey('bebado','walk',0,1)];
  for(const base of bases){
    assert.ok(!isCityKey(base),`${base} is not a city key`);
    assert.equal(textureFor(base,false),base);
    assert.equal(textureFor(base,false,cityKey(base,1)),base,'a stale copy is never shown outside the city');
    assert.equal(textureFor(base,false,cityKey(base,1),'breu'),base);
  }
  // In the city: the copy when built and the rim must be Breu; the base (umber rim) on light ground or before the build.
  assert.equal(textureFor('k',true,cityKey('k',3)),'k:cidade:3');
  assert.equal(textureFor('k',true,cityKey('k',3),'umber'),'k');
  assert.equal(textureFor('k',true,undefined),'k');
  assert.ok(isCityKey(cityKey('sprite:x:dir4',12)));
  for(const k of ENEMY_KINDS){assert.equal(ENEMY_TEXTURES[k][0],enemyTexture(k));assert.equal(ENEMY_TEXTURES[k][1],enemyTexture(k,true));}
});

test('copy resolution min(DPR,2) and rebuild threshold',()=>{
  assert.equal(copyResolution(1),1);assert.equal(copyResolution(2),2);assert.equal(copyResolution(3),2,'capped at 2 (DPR 3 phones)');
  assert.equal(copyResolution(1.5),1.5);assert.equal(copyResolution(Number.NaN),1);assert.equal(copyResolution(0),1);
  assert.equal(changedEnough(1,.91),false,'9% smaller: kept (ring ≥ 1.8 px)');assert.equal(changedEnough(1,.89),true,'11% smaller: rebuilt');
  assert.equal(changedEnough(1,1.019),false);assert.equal(changedEnough(1,1.03),true,'never shown enlarged by more than 2%');
  assert.equal(changedEnough(0,1),true,'nothing built yet');
});

/** The hero sheet in the city (D-030): 192 px cells, 96 world px per 128 px of figure, × CITY_VIEW_SCALE, city zoom. */
const PORTRAIT=cityZoom({width:390,height:844}),LANDSCAPE=cityZoom({width:844,height:390});
const HERO_SCALE=96/128*CITY_VIEW_SCALE;

test('geometry: cells resampled to their drawn size, the ring 2 px on screen, never upscaled',()=>{
  for(const zoom of [PORTRAIT,LANDSCAPE])for(const res of [1,2]){
    const g=variantGeometry(192,192,HERO_SCALE,zoom,res)!;
    const perSource=HERO_SCALE*zoom*res;
    assert.equal(g.cw,Math.round(192*perSource));
    // Canvas px per copy px ≈ 1, so the ring is CITY_RING.cssPx × res copy px = 2 CSS px on screen.
    assert.ok(Math.abs(g.ring*perSource*g.kx-CITY_RING.cssPx*res)<1e-9,`ring ${g.ring}`);
    assert.ok(Math.abs(g.ring-2*res)<0.05);
    assert.ok(g.pad>=Math.ceil(g.ring)+1&&g.slotW===g.cw+2*g.pad);
  }
  // A texture drawn larger than 1:1 on the canvas keeps its own resolution (no upscale): ring = 2 / perSource px.
  const big=variantGeometry(40,30,2,1.5,1)!;
  assert.equal(big.cw,40);assert.equal(big.ch,30);assert.ok(Math.abs(big.ring-2/3)<1e-9);
  assert.equal(variantGeometry(0,10,1,1),undefined);assert.equal(variantGeometry(10,10,1,0),undefined);assert.equal(variantGeometry(10,10,Number.NaN,1),undefined);
});

test('origin and scale mapping put the copy\'s figure exactly where the base drew it',()=>{
  const g=variantGeometry(192,192,HERO_SCALE,PORTRAIT,1)!,o=variantOrigin(g,.5,.88);
  // A copy pixel u (from the slot's left) lies at (u − origin·slot)·scale·k world px from the anchor; the base cell pixel
  // p at (p − .5·192)·scale. The copy holds cell pixel p at u = pad + p/k.
  const scale=1.7;
  for(const p of [0,37,96,150,192]){
    const base=(p-.5*192)*scale,copy=((g.pad+p/g.kx)-o.x*g.slotW)*scale*g.kx;
    assert.ok(Math.abs(base-copy)<1e-9,`x ${p}`);
    const baseY=(p-.88*192)*scale,copyY=((g.pad+p/g.ky)-o.y*g.slotH)*scale*g.ky;
    assert.ok(Math.abs(baseY-copyY)<1e-9,`y ${p}`);
  }
  assert.deepEqual(slotOf(g,192*3,192*2),{col:3,row:2});
});

/** The cidadão comum 4-direction atlas: its figure box over every frame (sprite-sheets.ts LAB_SHEETS / the catalog). */
const HERO_BOX={left:25,top:41,right:167,bottom:170};

test('memory: a 4-direction hero atlas (6×12 cells of 192 px) cropped to its figure: ~1.2 MB per copy at DPR 1, < 5 MB at DPR 2',()=>{
  const crop=cropOf(HERO_BOX,192,192)!;
  assert.deepEqual(crop,{x:24,y:40,w:144,h:131});
  for(const zoom of [PORTRAIT,LANDSCAPE]){
    const g1=variantGeometry(192,192,HERO_SCALE,zoom,1,crop)!,g2=variantGeometry(192,192,HERO_SCALE,zoom,2,crop)!,full=variantGeometry(192,192,HERO_SCALE,zoom,1)!;
    const mb=(g:typeof g1)=>textureBytes(6*g.slotW,12*g.slotH)/1048576;
    assert.ok(mb(g1)<1.4,`res 1 ${mb(g1)} MB`);assert.ok(mb(g2)<5,`res 2 ${mb(g2)} MB`);
    assert.ok(mb(full)>1.8*mb(g1)*0.9,'the crop saves about half of the whole cells');
  }
});

test('cropped copy: origin and the figure box map back onto the base cell',()=>{
  const g=variantGeometry(192,192,HERO_SCALE,PORTRAIT,1,cropOf(HERO_BOX,192,192))!,o=variantOrigin(g,.5,.88),scale=0.4;
  for(const p of [25,96,167]){
    const base=(p-.5*192)*scale,copy=(copyX(g,p)-o.x*g.slotW)*scale*g.kx;
    assert.ok(Math.abs(base-copy)<1e-9,`x ${p}`);
  }
  for(const p of [41,120,170]){
    const base=(p-.88*192)*scale,copy=(copyY(g,p)-o.y*g.slotH)*scale*g.ky;
    assert.ok(Math.abs(base-copy)<1e-9,`y ${p}`);
  }
  // The figure fits the slot with the ring's room around it.
  assert.ok(copyX(g,HERO_BOX.left)>=g.pad&&copyX(g,HERO_BOX.right)<=g.slotW-g.pad+1e-9);
  assert.ok(copyY(g,HERO_BOX.top)>=g.pad&&copyY(g,HERO_BOX.bottom)<=g.slotH-g.pad+1e-9);
  // A crop outside the cell is ignored (whole cell).
  assert.deepEqual(variantGeometry(64,64,1,1,1,{x:10,y:10,w:60,h:10})!.crop,{x:0,y:0,w:64,h:64});
  assert.equal(cropOf(undefined,192,192),undefined);
});

test('the ring measured on screen: a figure resampled to screen scale gets ~2 px of Breu outside it',()=>{
  const g=variantGeometry(64,64,1,1,1)!; // already 1:1: the ring is exactly CITY_RING.cssPx copy px
  const w=g.slotW,h=g.slotH,px=new Uint8ClampedArray(w*h*4);
  for(let y=0;y<h;y++)for(let x=0;x<w;x++)if(Math.hypot(x-w/2,y-h/2)<=20){const i=(y*w+x)*4;px[i]=px[i+1]=px[i+2]=230;px[i+3]=255;}
  const out=outlineRgba(px,w,h,{radius:g.ring,color:CITY_RING.color,alpha:1,cellW:g.slotW,cellH:g.slotH});
  let ring=0;for(let x=Math.ceil(w/2+20.5);x<w;x++){const i=(Math.floor(h/2)*w+x)*4;if(out[i+3]>=128&&out[i]===0x1e)ring++;}
  assert.equal(ring,2);
});

// ---------- the Phaser side against a fake scene (no canvas in node: drawing calls are recorded) ----------
interface FakeFrame {cutX:number;cutY:number;cutWidth:number;cutHeight:number}
function fakeScene(sheets:Record<string,{cell:number;cols:number;rows:number}|{single:[number,number]}>){
  const made=new Map<string,{w:number;h:number;frames:Map<string,[number,number,number,number]>}>();
  const removed:string[]=[],anims=new Map<string,string>();
  const scene={
    game:{loop:{frame:0},canvas:{width:390}},scale:{displaySize:{width:390}},
    textures:{
      exists:(k:string)=>k in sheets||made.has(k),
      get:(k:string)=>{
        const s=sheets[k];
        if('single' in s)return {getFrameNames:()=>[],get:():FakeFrame=>({cutX:0,cutY:0,cutWidth:s.single[0],cutHeight:s.single[1]}),getSourceImage:()=>({})};
        const names=Array.from({length:s.cols*s.rows},(_,i)=>String(i));
        return {getFrameNames:()=>names,get:(n:string):FakeFrame=>{const i=Number(n);return {cutX:(i%s.cols)*s.cell,cutY:Math.floor(i/s.cols)*s.cell,cutWidth:s.cell,cutHeight:s.cell};},getSourceImage:()=>({})};
      },
      createCanvas:(k:string,w:number,h:number)=>{
        const rec={w,h,frames:new Map<string,[number,number,number,number]>()};made.set(k,rec);
        const ctx={imageSmoothingEnabled:false,imageSmoothingQuality:'low',drawImage(){},getImageData:(_x:number,_y:number,iw:number,ih:number)=>({data:new Uint8ClampedArray(iw*ih*4)}),putImageData(){}};
        return {getContext:()=>ctx,add:(n:string,_s:number,x:number,y:number,fw:number,fh:number)=>{rec.frames.set(n,[x,y,fw,fh]);},refresh(){}};
      },
      remove:(k:string)=>{made.delete(k);removed.push(k);},
    },
    anims:{getAnimsFromTexture:(k:string)=>[...anims].filter(([,t])=>t===k).map(([a])=>a),remove:(a:string)=>anims.delete(a)},
  };
  return {scene:scene as never,made,removed,anims,next:()=>{scene.game.loop.frame++;}};
}
function host(over:Partial<CityOutlineHost>={}):CityOutlineHost&{on:boolean;z:number}{
  const h={on:true,z:PORTRAIT,active:()=>h.on,zoom:()=>h.z,...over};return h;
}

test('copies: same frame names in a padded grid, one build per frame, inactive = none',()=>{
  const f=fakeScene({sheet:{cell:192,cols:6,rows:12},gem:{single:[22,28]}}),h=host(),out=new CityOutlines(f.scene,h);
  const v=out.variant('sheet',HERO_SCALE)!;
  assert.equal(v.key,'sheet:cidade:1');
  const rec=f.made.get(v.key)!,g=v.geom;
  assert.deepEqual([rec.w,rec.h],[6*g.slotW,12*g.slotH]);
  assert.equal(rec.frames.size,72);
  assert.deepEqual(rec.frames.get('7'),[1*g.slotW,1*g.slotH,g.slotW,g.slotH]);
  assert.equal(out.variant('gem',CITY_VIEW_SCALE),undefined,'budget: one copy per frame');
  f.next();
  const gem=out.variant('gem',CITY_VIEW_SCALE)!;
  assert.equal(f.made.get(gem.key)!.frames.size,0,'a single-image texture keeps its one frame (__BASE)');
  assert.equal(out.variant('sheet',HERO_SCALE),v,'built once');
  assert.equal(out.stats().count,2);
  h.on=false;f.next();
  assert.equal(out.variant('sheet',HERO_SCALE),undefined,'outside the city: no copy');
});

test('zoom change > 10%: copies rebuilt under new keys, the old ones destroyed a few frames later',()=>{
  const f=fakeScene({sheet:{cell:192,cols:2,rows:2}}),h=host(),out=new CityOutlines(f.scene,h);
  const a=out.variant('sheet',HERO_SCALE)!;
  f.anims.set(`${a.key}:walk:S`,a.key);
  f.next();h.z=PORTRAIT*.95;assert.equal(out.variant('sheet',HERO_SCALE),a,'5% smaller: kept');
  f.next();h.z=PORTRAIT*1.2;
  const b=out.variant('sheet',HERO_SCALE)!;
  assert.notEqual(b.key,a.key);assert.ok(out.copyOf(a.key),'the old copy lives until every draw site switched');
  for(let i=0;i<3;i++)f.next(),out.variant('sheet',HERO_SCALE);
  assert.deepEqual(f.removed,[a.key]);assert.equal(out.copyOf(a.key),undefined);
  assert.equal(f.anims.size,0,'its animations go with it');
  assert.equal(out.stats().count,1,'only the newest copy is kept');
});

/** Just what CityOutlines.show and applyEnemyArt touch on an image. */
function fakeImage(key:string,exists:(k:string)=>boolean){
  const img={texture:{key},frame:{name:'__BASE'},originX:.5,originY:.5,scaleX:1,scaleY:1,scene:{textures:{exists}},
    setTexture(k:string,f?:string|number){img.texture={key:k};img.frame={name:String(f??'__BASE')};return img;},
    setFrame(f:string|number){img.frame={name:String(f)};return img;},
    setOrigin(x:number,y:number){img.originX=x;img.originY=y;return img;},
    setScale(x:number,y=x){img.scaleX=x;img.scaleY=y;return img;},
    setFlipX(){return img;},setRotation(){return img;}};
  return img;
}

test('show(): the copy with mapped origin and scale; back to the base when the copy is gone',()=>{
  const f=fakeScene({'horde:enemy:bebado':{single:[64,62]}}),out=new CityOutlines(f.scene,host());
  const v=out.variant('horde:enemy:bebado',CITY_VIEW_SCALE)!,img=fakeImage('horde:enemy:bebado',()=>true);
  assert.equal(out.show(img as never,v,'horde:enemy:bebado',undefined,.5,.92,.6,.5),true);
  const o=variantOrigin(v.geom,.5,.92);
  assert.equal(img.texture.key,v.key);assert.equal(img.originX,o.x);assert.equal(img.originY,o.y);
  assert.equal(img.scaleX,.6*v.geom.kx);assert.equal(img.scaleY,.5*v.geom.ky);
  assert.equal(out.show(img as never,undefined,'horde:enemy:bebado',undefined,.5,.92,.6,.5),false);
  assert.deepEqual([img.texture.key,img.originX,img.originY,img.scaleX,img.scaleY],['horde:enemy:bebado',.5,.92,.6,.5]);
});

test('imported style-A enemy: umber rim (its own sheet) on light ground, the Breu copy below the switch, base outside the city',()=>{
  setArtIndex(parseArtIndex({version:2,groups:{inimigos:{output:'public/art/inimigos',pieces:{bebado:{kind:'animations',
    files:{idle:{file:'bebado/idle.webp',cell:[128,128],frames:2,directions:8,anchor:[.5,.88]}}}}}}}));
  const key=enemyArtKey('bebado','idle',0,1),f=fakeScene({[key]:{cell:128,cols:2,rows:8}});
  let lum=0.2;const h=host({groundLuminance:()=>lum}),out=new CityOutlines(f.scene,h);
  const actor={kind:'bebado' as const,elite:false,phase:0,x:5,y:5},body=CITY_VIEW_SCALE;
  const scale=enemyDrawScale('bebado',{cell:[128,128],anchor:[.5,.88]})*body;
  // No CityOutlines (the island and the endless map today) and an inactive one: the imported sheet as before.
  for(const city of [undefined,new CityOutlines(f.scene,host({active:()=>false}))]){
    const img=fakeImage('horde:enemy:bebado',k=>f.scene&&(k===key));
    assert.equal(applyEnemyArt(img as never,actor,false,0,0,0,0,body,city),true);
    assert.deepEqual([img.texture.key,img.originX,img.originY,img.scaleX],[key,.5,.88,scale]);
  }
  // City, rubble-dark ground: the Breu copy, same frame number, mapped origin and scale.
  const img=fakeImage('horde:enemy:bebado',k=>k===key||isCityKey(k));
  assert.equal(applyEnemyArt(img as never,actor,false,0,0,0,0,body,out),true);
  assert.ok(isCityKey(img.texture.key),img.texture.key);assert.equal(img.frame.name,'0');
  const v=out.copyOf(img.texture.key)!;
  assert.equal(img.scaleX,scale*v.geom.kx);assert.equal(img.originY,variantOrigin(v.geom,.5,.88).y);
  // Light ground: back to the imported sheet and its baked umber rim.
  lum=0.4;f.next();
  applyEnemyArt(img as never,actor,false,0,0,0,0,body,out);
  assert.deepEqual([img.texture.key,img.originX,img.originY,img.scaleX],[key,.5,.88,scale]);
});
