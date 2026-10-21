// Imported Stonewards base art (barricadas-cliente): the ART-IDS state rule, the row/column of a fake manifest's
// sheets (single page, paged, animated state) and the fallback when the art is absent (every helper a no-op).
import {test,afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {setArtIndex,parseArtIndex,hasArt} from '../../src/client/art/manifest.ts';
import {towerArtScale} from '../../src/client/render/towers/tower-rules.ts';
import {BASE_ART,BASE_ART_SCALED,BASE_WIDTH,applyBaseArt,baseArtKey,baseDrawScale,baseFile,baseFrame,baseLoads,baseRow,baseState,
  baseStateFrames,baseStates,queueBaseArt} from '../../src/client/art/base-art.ts';

const EMPTY={version:2,groups:{}};
afterEach(()=>setArtIndex(parseArtIndex(EMPTY)));

const DAMAGE=['inteira','avariada','quase-caindo'];
const views=(file:string,rows:string[],extra:object={})=>({file,cell:[256,192],views:4,rows,anchor:[.5,.9],
  pages:[{file,columns:4,rows:rows.length,firstFrame:0,frameCount:4*rows.length}],...extra});
function manifest(pieces:Record<string,unknown>){
  setArtIndex(parseArtIndex({version:2,groups:{base:{output:'public/art/city/base',pieces}}}));
}
const barricada=(states=[...DAMAGE,'quebrada'])=>({kind:'views',files:{sheet:views('barricada.webp',states)},meta:{states}});

/** A Phaser Image stand-in: records what applyBaseArt sets. */
function fakeImage(loaded:string[]){
  const img={texture:{key:'__DEFAULT'},frame:-1,origin:[0,0],scale:0,calls:0,
    scene:{textures:{exists:(k:string)=>loaded.includes(k)}},
    setTexture(k:string,f:number){img.texture={key:k};img.frame=f;img.calls++;return img;},
    setFrame(f:number){img.frame=f;img.calls++;return img;},
    setOrigin(x:number,y:number){img.origin=[x,y];img.calls++;return img;},
    setScale(s:number){img.scale=s;img.calls++;return img;}};
  return img;
}
type Img=Parameters<typeof applyBaseArt>[0];

test('no base art: nothing is queued and every helper answers "no" (the Graphics stay)',()=>{
  assert.deepEqual(baseLoads(),[]);
  for(const id of Object.values(BASE_ART)){
    assert.equal(hasArt('base',id),false);assert.equal(baseFile(id),undefined);
    assert.deepEqual(baseStates(id),[]);assert.equal(baseState(id,.5),undefined);
    assert.equal(baseFrame(id,'inteira',0),undefined);assert.equal(baseRow(id,'inteira'),-1);
  }
  const img=fakeImage(['art:base:barricada']);
  assert.equal(applyBaseArt(img as unknown as Img,'barricada','inteira',0),false);
  assert.equal(img.calls,0,'the image is untouched');
  const queued:string[]=[];
  queueBaseArt({textures:{exists:()=>false},load:{spritesheet:(k:string)=>queued.push(k)}} as never);
  assert.deepEqual(queued,[]);
});

test('ART-IDS state rule: inteira > 66%, avariada > 33%, quase-caindo > 0, then quebrada (wall: ruina), down wins',()=>{
  manifest({barricada:barricada(),'muralha-acampamento':{kind:'views',files:{sheet:views('muralha.webp',[...DAMAGE,'ruina'])},meta:{states:[...DAMAGE,'ruina']}}});
  const cases:[number,string][]=[[1,'inteira'],[.67,'inteira'],[.66,'avariada'],[.5,'avariada'],[.34,'avariada'],[.33,'quase-caindo'],[.01,'quase-caindo'],[0,'quebrada'],[-1,'quebrada'],[Number.NaN,'quebrada']];
  for(const [r,want] of cases)assert.equal(baseState('barricada',r),want,`ratio ${r}`);
  assert.equal(baseState('barricada',.9,true),'quebrada','down');
  assert.equal(baseState('muralha-acampamento',0),'ruina');
  assert.equal(baseState('muralha-acampamento',.8),'inteira');
  // A sheet without the wanted state keeps the Graphics for that state only.
  manifest({barricada:barricada(['inteira','avariada'])});
  assert.equal(baseState('barricada',.9),'inteira');assert.equal(baseState('barricada',.1),undefined);
});

test('fake manifest: row = the state by name, column = the view, single page',()=>{
  manifest({barricada:barricada()});
  assert.deepEqual(baseLoads(),[{key:'art:base:barricada',url:'/art/city/base/barricada.webp',cell:[256,192]}]);
  assert.deepEqual(baseStates('barricada'),[...DAMAGE,'quebrada']);
  assert.deepEqual(baseFrame('barricada','inteira',0),{key:'art:base:barricada',frame:0});
  assert.deepEqual(baseFrame('barricada','quase-caindo',3),{key:'art:base:barricada',frame:2*4+3});
  assert.deepEqual(baseFrame('barricada','quebrada',5),{key:'art:base:barricada',frame:3*4+1},'views wrap (5 → 1)');
  assert.deepEqual(baseFrame('barricada','avariada',-1),{key:'art:base:barricada',frame:4+3});
  assert.equal(baseFrame('barricada','ruina',0),undefined);
  // States are never fixed indexes: a sheet in another row order is read by name.
  const odd=['quebrada','inteira','quase-caindo','avariada'];
  manifest({barricada:{kind:'views',files:{sheet:views('barricada.webp',odd)},meta:{states:odd}}});
  assert.deepEqual(baseFrame('barricada','inteira',2),{key:'art:base:barricada',frame:4+2});
  assert.equal(baseState('barricada',0),'quebrada');
});

test('fake manifest: a paged sheet finds the cell in its page; queueBaseArt loads every page',()=>{
  const states=[...DAMAGE,'quebrada'];
  manifest({barricada:{kind:'views',meta:{states},files:{sheet:{cell:[256,192],views:4,rows:states,anchor:[.5,.9],pages:[
    {file:'barricada-p1.webp',columns:4,rows:2,firstFrame:0,frameCount:8},{file:'barricada-p2.webp',columns:4,rows:2,firstFrame:8,frameCount:8}]}}}});
  assert.deepEqual(baseLoads().map(l=>l.key),[baseArtKey('barricada',0,2),baseArtKey('barricada',1,2)]);
  assert.deepEqual(baseFrame('barricada','avariada',2),{key:'art:base:barricada:p1',frame:6});
  assert.deepEqual(baseFrame('barricada','quebrada',1),{key:'art:base:barricada:p2',frame:5});
  const queued:[string,string,object][]=[];
  queueBaseArt({textures:{exists:(k:string)=>k.endsWith(':p1')},load:{spritesheet:(k:string,u:string,c:object)=>queued.push([k,u,c])}} as never);
  assert.deepEqual(queued,[['art:base:barricada:p2','/art/city/base/barricada-p2.webp',{frameWidth:256,frameHeight:192}]],'a loaded page is not queued again');
});

test('fake manifest: an animated state picks its frame row; a 1-view piece always shows column 0',()=>{
  const rows=['fechada',...[1,2,3,4,5,6].map(i=>`abrindo-${i}`)];
  manifest({'caixa-saque':{kind:'views',files:{sheet:{file:'caixa-saque.webp',cell:[128,128],views:1,rows,anchor:[.5,.85]}},
    meta:{states:['fechada','abrindo'],stateFrames:{fechada:1,abrindo:6}}}});
  assert.equal(baseStateFrames('caixa-saque','abrindo'),6);assert.equal(baseStateFrames('caixa-saque','fechada'),1);
  assert.deepEqual(baseFrame('caixa-saque','fechada',3),{key:'art:base:caixa-saque',frame:0});
  assert.deepEqual(baseFrame('caixa-saque','abrindo',2,0),{key:'art:base:caixa-saque',frame:1});
  assert.deepEqual(baseFrame('caixa-saque','abrindo',0,5),{key:'art:base:caixa-saque',frame:6});
  assert.deepEqual(baseFrame('caixa-saque','abrindo',0,8),{key:'art:base:caixa-saque',frame:3},'frames wrap');
});

test('applyBaseArt: texture, frame, anchor and BASE_WIDTH × actor scale; false while the texture is not loaded',()=>{
  manifest({barricada:barricada()});
  const file=baseFile('barricada')!;
  assert.equal(baseDrawScale('barricada',file,1),BASE_WIDTH.barricada/256);
  const img=fakeImage(['art:base:barricada']);
  assert.equal(applyBaseArt(img as unknown as Img,'barricada','avariada',2,.5),true);
  assert.equal(img.texture.key,'art:base:barricada');assert.equal(img.frame,4+2);
  assert.deepEqual(img.origin,[.5,.9]);assert.equal(img.scale,BASE_WIDTH.barricada/256*.5);
  assert.equal(applyBaseArt(img as unknown as Img,'barricada','quebrada',1,.5),true);assert.equal(img.frame,3*4+1);
  assert.equal(applyBaseArt(img as unknown as Img,'barricada',undefined,0),false,'no state → Graphics');
  const cold=fakeImage([]);
  assert.equal(applyBaseArt(cold as unknown as Img,'barricada','inteira',0),false);assert.equal(cold.calls,0);
  // Art for the wall only: the barricade stays procedural.
  manifest({'muralha-acampamento':{kind:'views',files:{sheet:views('muralha.webp',[...DAMAGE,'ruina'])},meta:{states:[...DAMAGE,'ruina']}}});
  assert.equal(applyBaseArt(fakeImage(['art:base:barricada']) as unknown as Img,'barricada','inteira',0),false);
  assert.equal(applyBaseArt(fakeImage(['art:base:muralha-acampamento']) as unknown as Img,'muralha-acampamento','ruina',0),true);
});

test('the sofa barricade draws at the city scenery scale (towerArtScale) when the renderer gives it; the wall and crate keep BASE_WIDTH',()=>{
  manifest({barricada:barricada()});
  const file=baseFile('barricada')!;
  assert.deepEqual([...BASE_ART_SCALED],['barricada']);
  // 84 projected px per 1 u diamond (TILE_X 42): 0.5 world px per art px on the 0.88 u sample city, 0.85 on the 1.496 u map.
  const sample=towerArtScale(84),real=towerArtScale(84,1.496);
  assert.equal(sample,.5);assert.ok(Math.abs(real-.85)<1e-9);
  assert.equal(baseDrawScale('barricada',file,.54,real),real,'the actor scale does not apply');
  assert.equal(baseDrawScale('barricada',file,.5),BASE_WIDTH.barricada/256*.5,'no artPx: BASE_WIDTH as before');
  assert.equal(baseDrawScale('muralha-acampamento',{...file},.5,real),BASE_WIDTH['muralha-acampamento']/256*.5);
  const img=fakeImage(['art:base:barricada']);
  assert.equal(applyBaseArt(img as unknown as Img,'barricada','inteira',0,.5,0,real),true);assert.equal(img.scale,real);
});
