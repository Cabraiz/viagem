// City-mode Breu outlines (card NEW-20261012-E8-cidade-contorno-breu): rim switch by ground, screen-scale copies,
// key/frame mapping, budget and rebuild, and the proof that the island and the endless map keep their base keys.
import {test,afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {CITY_RING,CITY_STICKER,CITY_STICKER_CSS,GROUND_LUMINANCE,MAX_COPIES_PER_BASE,RIM_SWITCH_LUMINANCE,baseDisplay,changedEnough,copyResolution,
  cityGroundLuminance,copyX,copyY,cropOf,isCityKey,rimForGround,slotOf,textureBytes,variantGeometry,variantOrigin} from '../../src/client/render/city-outline-rules.ts';
import {CityOutlines,type CityOutlineHost} from '../../src/client/render/city-outline.ts';
import {bandsRgba,outlineRgba} from '../../src/client/render/outline.ts';
import {CharacterSprites} from '../../src/client/sprites/character-sprites.ts';
import {spriteCatalog} from '../../src/client/sprites/sprite-catalog.ts';
import {YouMarkers,type HeroMark} from '../../src/client/render/you.ts';
import {OUTLINE_DIRS,STICKER_CSS} from '../../src/client/render/you-rules.ts';
import {ENEMY_KINDS,ENEMY_TEXTURES,PICKUP_KINDS,enemyTexture,pickupTexture,FX} from '../../src/client/render/keys.ts';
import {ELITE_ART_SCALE,applyEnemyArt,enemyArtKey,enemyDrawScale} from '../../src/client/art/horde-art.ts';
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

test('texture keys: city copies are tagged, no base key is',()=>{
  const bases=[...ENEMY_KINDS.flatMap(k=>[enemyTexture(k),enemyTexture(k,true)]),...PICKUP_KINDS.map(pickupTexture),FX.boleto,
    'sprite:cidadao-comum:dir4',enemyArtKey('bebado','walk',0,1)];
  for(const base of bases)assert.ok(!isCityKey(base),`${base} is not a city key`);
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
    anims:{getAnimsFromTexture:(k:string)=>[...anims].filter(([,t])=>t===k).map(([a])=>a),remove:(a:string)=>anims.delete(a),
      exists:(a:string)=>anims.has(a),create:(c:{key:string;frames:{key:string}[]})=>{anims.set(c.key,c.frames[0]?.key??'');return {};},
      generateFrameNumbers:(t:string)=>[{key:t}]},
    time:{now:0},
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

// ---------- review fixes (H1, H2, M1, M2, M3) and the city "você" sticker ----------

/** A sprite as CharacterSprites, CityOutlines.show and YouMarkers touch it; its frame size follows its texture. */
function fakeSprite(key:string,size:(key:string)=>[number,number]){
  const sp={texture:{key},frame:{name:'0',width:0,height:0},x:0,y:0,originX:.5,originY:.5,scaleX:1,scaleY:1,flipX:false,rotation:0,depth:0,alpha:1,visible:true,
    tint:-1,playing:'',textures:0,
    get displayWidth(){return Math.abs(sp.scaleX*sp.frame.width);},get displayHeight(){return Math.abs(sp.scaleY*sp.frame.height);},
    setTexture(k:string,f?:string|number){sp.textures++;sp.texture={key:k};const [w,h]=size(k);sp.frame={name:String(f??0),width:w,height:h};return sp;},
    setFrame(f:string|number){sp.frame.name=String(f);return sp;},
    setOrigin(x:number,y=x){sp.originX=x;sp.originY=y;return sp;},
    setScale(x:number,y=x){sp.scaleX=x;sp.scaleY=y;return sp;},
    setFlipX(b:boolean){sp.flipX=b;return sp;},setRotation(r:number){sp.rotation=r;return sp;},
    setPosition(x:number,y:number){sp.x=x;sp.y=y;return sp;},setDepth(d:number){sp.depth=d;return sp;},
    setAlpha(a:number){sp.alpha=a;return sp;},setVisible(v:boolean){sp.visible=v;return sp;},setTintFill(c:number){sp.tint=c;return sp;},
    play(k:string){sp.playing=k;return sp;},anims:{pause(){},resume(){},getProgress:()=>0,setProgress(){}}};
  const [w,h]=size(key);sp.frame.width=w;sp.frame.height=h;
  return sp;
}
type FakeSprite=ReturnType<typeof fakeSprite>;
/**
 * World offset (from the sprite's position) of frame column u / row v, as Phaser 3.90 draws it: MultiPipeline
 * batchSprite starts the quad at −displayOriginX and, flipped, adds 2·displayOriginX − frame.realWidth before mirroring,
 * so a flipped sprite shows column u at (W − u − originX·W)·scaleX.
 */
const worldX=(sp:FakeSprite,u:number)=>(sp.flipX?sp.frame.width-u-sp.originX*sp.frame.width:u-sp.originX*sp.frame.width)*sp.scaleX;
const worldY=(sp:FakeSprite,v:number)=>(v-sp.originY*sp.frame.height)*sp.scaleY;
/** Frame size of a base sheet (192 px cells) or of a city copy / sticker (its slot). */
const sizeIn=(out:CityOutlines)=>(k:string):[number,number]=>{const v=out.copyOf(k);return v?[v.geom.slotW,v.geom.slotH]:[192,192];};
const close=(a:number,b:number,what:string)=>assert.ok(Math.abs(a-b)<1e-6,`${what}: ${a} vs ${b}`);

test('H1 cropped hero copies are centred: a flipped single sheet keeps every figure px where the base flip puts it (every class)',()=>{
  let classes=0;
  for(const [id,entry] of Object.entries(spriteCatalog)){
    const box=entry.figure;if(!box)continue;
    const key=`sprite:${id}`,f=fakeScene({[key]:{cell:192,cols:8,rows:4}}),out=new CityOutlines(f.scene,host());
    const island=new CharacterSprites(f.scene),city=new CharacterSprites(f.scene,out);
    island.viewScale=city.viewScale=CITY_VIEW_SCALE;
    const size=sizeIn(out),base=fakeSprite('hero',size),copy=fakeSprite('hero',size);
    for(const [from,to,flip] of [[10,9,true],[9,10,false]] as const){
      island.animate(base as never,id,from,0);island.animate(base as never,id,to,0);
      f.next();city.animate(copy as never,id,from,0);f.next();city.animate(copy as never,id,to,0);
      assert.equal(base.flipX,flip);assert.equal(copy.flipX,flip,`${id} flip`);
      const v=out.copyOf(copy.texture.key);
      assert.ok(v,`${id}: the city copy is shown`);
      const g=v.geom;
      for(const p of [box.left,box.right,96,(box.left+box.right)/2])close(worldX(copy,copyX(g,p)),worldX(base,p),`${id} flip=${flip} x ${p}`);
      for(const p of [box.top,box.bottom,.88*192])close(worldY(copy,copyY(g,p)),worldY(base,p),`${id} y ${p}`);
      assert.equal(g.crop.x+g.crop.w/2,96,`${id}: crop centred on the cell`);
    }
    classes++;
  }
  assert.ok(classes>=30,`${classes} classes`);
  // The two the review measured: the old crop (figure box ± 1 px) moved them 16 and 17 CSS px on a flip.
  assert.deepEqual(cropOf(spriteCatalog.porteiro.figure,192,192),{x:5,y:33,w:182,h:138});
  assert.deepEqual(cropOf(spriteCatalog.sensei.figure,192,192),{x:24,y:57,w:144,h:114});
});

test('H2 an imported sheet drawn plain and elite (×1.35) keeps one copy each: 60 alternating frames build 2',()=>{
  const f=fakeScene({sheet:{cell:128,cols:2,rows:8}}),out=new CityOutlines(f.scene,host());
  const plain=.5*CITY_VIEW_SCALE,elite=plain*ELITE_ART_SCALE;
  for(let i=0;i<60;i++){f.next();out.variant('sheet',i%2?elite:plain);}
  assert.equal(out.built,2);assert.equal(out.stats().count,2);
  f.next();
  const a=out.variant('sheet',plain)!,b=out.variant('sheet',elite)!;
  assert.notEqual(a.key,b.key);assert.equal(a.drawScale,plain);assert.equal(b.drawScale,elite);
  // Through applyEnemyArt, a kind whose actors alternate plain/elite: its sheet twice and the elite layer once, then never again.
  setArtIndex(parseArtIndex({version:2,groups:{inimigos:{output:'public/art/inimigos',pieces:{bebado:{kind:'animations',files:{
    idle:{file:'bebado/idle.webp',cell:[128,128],frames:2,directions:8,anchor:[.5,.88]},
    'elite/idle':{file:'bebado/elite-idle.webp',cell:[128,128],frames:2,directions:8,anchor:[.5,.88]}}}}}}}));
  const k0=enemyArtKey('bebado','idle',0,1),k1=enemyArtKey('bebado','elite/idle',0,1);
  const g=fakeScene({[k0]:{cell:128,cols:2,rows:8},[k1]:{cell:128,cols:2,rows:8}}),cities=new CityOutlines(g.scene,host({groundLuminance:()=>.2}));
  const exists=(k:string)=>k===k0||k===k1||isCityKey(k);
  const plainImg=fakeImage('horde:enemy:bebado',exists),eliteImg=fakeImage('horde:enemy:bebado:elite',exists);
  const overlay=()=>{const o=fakeImage(k1,exists) as ReturnType<typeof fakeImage>&Record<string,unknown>;
    Object.assign(o,{setPosition:()=>o,setDepth:()=>o,setAlpha:()=>o,setVisible:()=>o,setActive:()=>o});return o;};
  for(const img of [plainImg,eliteImg]){Object.assign(img.scene,{add:{image:overlay},events:{on(){},off(){}}});Object.assign(img,{once:()=>img,visible:true,alpha:1,depth:0});}
  for(let i=0;i<60;i++){
    g.next();
    applyEnemyArt(plainImg as never,{kind:'bebado',elite:false,phase:0,x:1,y:1},false,0,0,i*16,0,CITY_VIEW_SCALE,cities);
    applyEnemyArt(eliteImg as never,{kind:'bebado',elite:true,phase:.5,x:2,y:2},false,0,0,i*16,0,CITY_VIEW_SCALE,cities);
  }
  assert.equal(cities.built,3,'plain sheet, elite-scale sheet, elite layer');
  assert.ok(isCityKey(plainImg.texture.key)&&isCityKey(eliteImg.texture.key));
});

test('M2 pickups: a copy per draw-scale window, ring 1.8..2.04 CSS px at every gem, promo and chest scale, bounded',()=>{
  const PROMO=1.6; // layers.ts PROMO_SCALE (layers.ts loads Phaser, so node tests cannot import it)
  const f=fakeScene({gem:{single:[22,28]}}),h=host(),out=new CityOutlines(f.scene,h),body=CITY_VIEW_SCALE;
  const scales:number[]=[];
  for(let value=1;value<=1<<14;value*=2){const s=1+Math.min(.7,Math.log2(value)*.14);scales.push(s,s*PROMO);}
  for(let i=0;i<=40;i++)scales.push(1+.07*Math.sin(i));
  let lo=Infinity,hi=-Infinity;
  for(let pass=0;pass<3;pass++)for(const sc of scales){
    f.next();
    const v=out.variant('gem',sc*body)!,g=v.geom;
    // Ring on screen: its copy px × (draw scale × source px per copy px × zoom) CSS px per copy px.
    const ring=g.ring*sc*body*(g.kx+g.ky)/2*h.z;
    lo=Math.min(lo,ring);hi=Math.max(hi,ring);
  }
  const {count}=out.stats();
  assert.ok(lo>=1.8-1e-9&&hi<=2.04+1e-9,`ring ${lo}..${hi} (${count} copies)`);
  assert.ok(count<=MAX_COPIES_PER_BASE,`${count} copies`);
  assert.equal(out.built,count,'every scale reuses its copy after the first pass: no rebuild');
});

test('M3 off the city (inactive host): no copy is ever built and every draw site keeps or gets back its base texture',()=>{
  const f=fakeScene({'horde:enemy:bebado':{single:[64,62]},'sprite:porteiro':{cell:192,cols:8,rows:4}}),h=host(),out=new CityOutlines(f.scene,h);
  h.on=false;
  // HordeRenderer's procedural enemy and pickup path: variant() answers nothing, show() leaves the image alone.
  const img=fakeImage('horde:enemy:bebado',()=>true);let sets=0;const set=img.setTexture;img.setTexture=(k,fr)=>{sets++;return set(k,fr);};
  for(let i=0;i<5;i++){f.next();assert.equal(out.show(img as never,out.variant('horde:enemy:bebado',CITY_VIEW_SCALE),'horde:enemy:bebado',undefined,.5,.92,.6,.6),false);}
  assert.equal(sets,0);assert.equal(img.texture.key,'horde:enemy:bebado');
  // CharacterSprites: the sheet itself, its own origin and scale.
  const sprites=new CharacterSprites(f.scene,out),hero=fakeSprite('hero',sizeIn(out));
  sprites.viewScale=CITY_VIEW_SCALE;
  for(let i=0;i<5;i++){f.next();sprites.animate(hero as never,'porteiro',i,0);}
  const scale=96/spriteCatalog.porteiro.height*CITY_VIEW_SCALE;
  assert.deepEqual([hero.texture.key,hero.originX,hero.originY,hero.scaleX,hero.scaleY],['sprite:porteiro',.5,.88,scale,scale]);
  assert.equal(out.built,0);assert.equal(out.stats().count,0);
  // City on: the copies; city off again (a world swap): both draw sites back on their base, origin and scale.
  h.on=true;
  for(let i=0;i<3;i++){f.next();sprites.animate(hero as never,'porteiro',i,0);out.show(img as never,out.variant('horde:enemy:bebado',CITY_VIEW_SCALE),'horde:enemy:bebado',undefined,.5,.92,.6,.6);}
  assert.ok(isCityKey(hero.texture.key)&&isCityKey(img.texture.key));
  h.on=false;f.next();
  sprites.animate(hero as never,'porteiro',9,0);out.show(img as never,out.variant('horde:enemy:bebado',CITY_VIEW_SCALE),'horde:enemy:bebado',undefined,.5,.92,.6,.6);
  assert.deepEqual([hero.texture.key,hero.originX,hero.originY,hero.scaleX,hero.scaleY],['sprite:porteiro',.5,.88,scale,scale]);
  assert.deepEqual([img.texture.key,img.originX,img.originY,img.scaleX],['horde:enemy:bebado',.5,.92,.6]);
});

/** YouMarkers against a recording scene: every Graphics call, the label's position and the sprites it creates. */
function markerScene(size:(k:string)=>[number,number]){
  const calls:unknown[][]=[],sprites:FakeSprite[]=[];
  const g:object=new Proxy({},{get:(_t,p)=>(...args:unknown[])=>{calls.push([String(p),...args]);return g;}});
  const text={width:120,height:52,setOrigin:()=>text,setDepth:()=>text,setVisible:()=>text,setScale:(k:number)=>{calls.push(['labelScale',k]);return text;},
    setPosition:(x:number,y:number)=>{calls.push(['label',x,y]);return text;},updateText(){},destroy(){}};
  const scene={add:{graphics:()=>g,text:()=>text,sprite:(_x:number,_y:number,key:string)=>{const sp=fakeSprite(key,size);sprites.push(sp);return sp;}}};
  return {scene,calls,sprites};
}
const selfMark=(sprite:FakeSprite):HeroMark=>({id:'self',sprite:sprite as never,self:true,feet:{x:sprite.x,y:sprite.y},covered:false,
  hp:40,maxHp:100,downed:false,facing:.3,slow:true,slip:true});
/** The porteiro hero in the city at the portrait zoom: on its base sheet, and on its city copy (CityOutlines.show). */
function heroPair(flip=false){
  const key='sprite:porteiro',f=fakeScene({[key]:{cell:192,cols:8,rows:4}}),h=host(),out=new CityOutlines(f.scene,h),size=sizeIn(out);
  const s=96/spriteCatalog.porteiro.height*CITY_VIEW_SCALE,crop=cropOf(spriteCatalog.porteiro.figure,192,192);
  const base=fakeSprite(key,size).setOrigin(.5,.88).setScale(s).setPosition(300,500).setFlipX(flip).setDepth(10);
  const v=out.variant(key,s,crop)!,copy=fakeSprite(key,size).setPosition(300,500).setFlipX(flip).setDepth(10);
  out.show(copy as never,v,key,0,.5,.88,s,s);
  return {f,h,out,base,copy,v,s};
}
const sameCalls=(a:unknown[][],b:unknown[][])=>{
  assert.equal(a.length,b.length);
  a.forEach((c,i)=>{assert.equal(c[0],b[i][0]);c.forEach((x,j)=>{if(typeof x==='number')close(x,b[i][j] as number,`${String(c[0])} #${i} arg ${j}`);});});
};

test('M1 "Você" ring, beak, bar, arrow and status chips: identical geometry with the city copy shown or not',()=>{
  const {out,base,copy,h}=heroPair();
  assert.ok(isCityKey(copy.texture.key));
  assert.notEqual(copy.displayWidth,base.displayWidth,'the copy has its own (padded, cropped) frame');
  const d=baseDisplay(out.copyOf(copy.texture.key)!.geom,copy.originX,copy.originY,copy.scaleX,copy.scaleY);
  close(d.width,base.displayWidth,'width');close(d.height,base.displayHeight,'height');close(d.originY,.88,'originY');close(d.originX,.5,'originX');
  const run=(sprite:FakeSprite)=>{
    const m=markerScene(sizeIn(out)),you=new YouMarkers(m.scene as never,true,out);
    you.setCity(true);you.showArrow(0);you.update(100,h.z,[selfMark(sprite)]);
    assert.ok(you.last.ring&&you.last.bar&&you.last.arrow&&you.last.slow&&you.last.slip);
    return m.calls;
  };
  sameCalls(run(copy),run(base));
});

test('city "você" sticker, pure: Papel then a SOLID Breu band whose outer 2 CSS px are opaque, at DPR 1 and 2',()=>{
  for(const [scale,res] of [[1,1],[.25,2]] as const){
    const g=variantGeometry(128,128,scale,1,res,undefined,CITY_STICKER_CSS)!;
    assert.equal(g.perCss,res,'copy px per CSS px');
    const w=g.slotW,h=g.slotH,px=new Uint8ClampedArray(w*h*4),x0=g.pad+10,x1=w-g.pad-10,y0=g.pad+10,y1=h-g.pad-10;
    for(let y=y0;y<y1;y++)for(let x=x0;x<x1;x++){const i=(y*w+x)*4;px[i]=200;px[i+1]=40;px[i+2]=40;px[i+3]=255;}
    const out=bandsRgba(px,w,h,CITY_STICKER.map(b=>({width:b.css*g.perCss,color:b.color})),w,h);
    const at=(x:number,y:number)=>{const i=(y*w+x)*4;return [out[i]<<16|out[i+1]<<8|out[i+2],out[i+3]];};
    const y=Math.floor(h/2),solid=2*res;
    // Walking out of the figure along a row: inner Breu, Papel, then the outer band; its last `solid` px before the
    // anti-aliased fringe are opaque Breu.
    let last=x1;while(last+1<w&&at(last+1,y)[1]>0)last++;
    let opaque=last;while(at(opaque,y)[1]<255)opaque--;
    assert.ok(last-opaque<=1,'at most 1 px of anti-aliased fringe');
    for(let k=0;k<solid;k++)assert.deepEqual(at(opaque-k,y),[CITY_RING.color,255],`res ${res}: outer px ${k}`);
    assert.deepEqual(at(x1-1+Math.round((CITY_RING.cssPx+1)*res),y),[CITY_STICKER[1].color,255],`res ${res}: Papel inside it`);
    assert.deepEqual(at(x1,y),[CITY_RING.color,255],'the figure\'s own Breu ring innermost (hidden under the sprite)');
    // Every px at least half a px inside the outer band is pure, opaque Breu (the corners' diagonals too).
    const inner=(CITY_RING.cssPx+2)*res,outer=CITY_STICKER_CSS*res;
    let checked=0;
    for(let yy=0;yy<h;yy++)for(let x=0;x<w;x++){
      const dx=x<x0?x0-x:x>=x1?x-x1+1:0,dy=yy<y0?y0-yy:yy>=y1?yy-y1+1:0,d=Math.hypot(dx,dy);
      if(d>=inner+.5&&d<=outer-.5){checked++;assert.deepEqual(at(x,yy),[CITY_RING.color,255],`(${x},${yy}) d ${d}`);}
    }
    assert.ok(checked>0);
  }
});

test('city "você" sticker in YouMarkers: one baked sprite, figure px on the copy\'s, flipped or not; island path unchanged',()=>{
  for(const flip of [false,true]){
    const {f,out,base,copy,h,v}=heroPair(flip);
    const m=markerScene(sizeIn(out)),you=new YouMarkers(m.scene as never,true,out);
    you.setCity(true);
    // The frame that built the copy cannot build the sticker too (one build per frame): offset copies meanwhile.
    you.update(100,h.z,[selfMark(copy)]);
    assert.equal(you.last.sticker,false);assert.equal(m.sprites.length,16);
    f.next();you.update(116,h.z,[selfMark(copy)]);
    assert.equal(you.last.sticker,true);
    const sticker=m.sprites[16],st=out.copyOf(sticker.texture.key)!;
    assert.ok(isCityKey(sticker.texture.key)&&sticker.texture.key!==copy.texture.key);
    assert.ok(m.sprites.slice(0,16).every(s=>!s.visible),'offset copies hidden');
    assert.ok(sticker.visible&&sticker.depth<copy.depth&&sticker.flipX===flip);
    assert.equal(st.geom.kx,v.geom.kx);assert.equal(st.geom.ky,v.geom.ky);assert.deepEqual(st.geom.crop,v.geom.crop);
    assert.ok(st.geom.pad>=Math.ceil(CITY_STICKER_CSS*st.geom.perCss)+1);
    const box=spriteCatalog.porteiro.figure!;
    for(const p of [box.left,box.right,96]){
      close(worldX(sticker,copyX(st.geom,p)),worldX(copy,copyX(v.geom,p)),`flip ${flip} x ${p}`);
      close(worldX(sticker,copyX(st.geom,p)),worldX(base,p),`flip ${flip} x ${p} (base)`);
    }
    for(const p of [box.top,box.bottom])close(worldY(sticker,copyY(st.geom,p)),worldY(base,p),`y ${p}`);
  }
  // Off the city (the island, the endless map): the 16 tint-filled offset copies exactly as before, no sticker sprite,
  // even with the outlines wired and a sticker available.
  const {out,base,copy,h}=heroPair(true);
  for(const sprite of [base,copy]){
    const m=markerScene(sizeIn(out)),you=new YouMarkers(m.scene as never,true,out),s=1/h.z;
    you.setCity(false);you.update(100,h.z,[selfMark(sprite)]);
    assert.equal(m.sprites.length,16);assert.equal(you.last.sticker,false);
    m.sprites.forEach((c,i)=>{
      const dir=OUTLINE_DIRS[i%8],r=(i<8?STICKER_CSS.breu:STICKER_CSS.papel)*s;
      assert.equal(c.texture.key,sprite.texture.key);assert.equal(c.tint,i<8?0x1e1530:0xeeddb8);
      assert.deepEqual([c.x,c.y,c.originX,c.originY,c.scaleX,c.scaleY,c.flipX,c.depth],
        [sprite.x+dir.x*r,sprite.y+dir.y*r,sprite.originX,sprite.originY,sprite.scaleX,sprite.scaleY,sprite.flipX,sprite.depth-(i<8?.2:.1)]);
    });
  }
});
