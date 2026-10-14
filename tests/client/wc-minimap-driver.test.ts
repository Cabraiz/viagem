/**
 * Minimap WC3 (card NEW-20261013-ORQ-minimapa-wc3): the terrain images and the frame loop's driver, without a DOM
 * (the pixels and the marks handed to a fake minimap). Results only (D-031).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {TerrainField,decodeCityAsset} from '../../src/maps/index.ts';
import {MM_COLORS,cityTerrainPixels,endlessTerrainPixels} from '../../src/client/hud/wc-minimap/terrain.ts';
import {ENDLESS_REBUILD,MM_SIDE,WcMinimapDriver,type TerrainImages} from '../../src/client/hud/wc-minimap/driver.ts';
import {ALLY_COLORS,teamColor,type MmInput} from '../../src/client/hud/wc-minimap/minimap.ts';
import {toMini} from '../../src/client/hud/wc-minimap/geometry.ts';

const fromRoot=(path:string)=>fileURLToPath(new URL(`../../${path}`,import.meta.url));
const decoded=decodeCityAsset(readFileSync(fromRoot('public/maps/cidade-nevada.json'),'utf8'));
if(!decoded.ok)throw new Error(decoded.error);
const asset=decoded.asset;
const hex=(r:number,g:number,b:number)=>'#'+[r,g,b].map(v=>v.toString(16).padStart(2,'0')).join('');
const near=(a:string,b:string,tol=60)=>{const p=(h:string)=>[1,3,5].map(i=>parseInt(h.slice(i,i+2),16));const x=p(a),y=p(b);return Math.abs(x[0]-y[0])+Math.abs(x[1]-y[1])+Math.abs(x[2]-y[2])<=tol;};

test('the city image: one pixel per cell, the plaza in its warm tone, buildings in theirs, some water', () => {
  const px=cityTerrainPixels(asset);
  assert.equal(px.width,asset.cells.w);assert.equal(px.height,asset.cells.h);assert.equal(px.unit,asset.unitsPerCell);
  const at=(x:number,y:number)=>{const i=(Math.floor(y/px.unit)*px.width+Math.floor(x/px.unit))*4;return hex(px.data[i],px.data[i+1],px.data[i+2]);};
  const p=asset.points.praca;
  // Around the plaza point, a cobble cell within 3 cells (the fountain itself may be a block).
  let cobble=false;for(let dy=-3;dy<=3;dy++)for(let dx=-3;dx<=3;dx++)if(near(at(p.x+dx*px.unit,p.y+dy*px.unit),MM_COLORS.cobble))cobble=true;
  assert.ok(cobble,'the plaza reads as the plaza');
  let building=0,water=0;
  for(let i=0;i<px.width*px.height;i++){const c=hex(px.data[i*4],px.data[i*4+1],px.data[i*4+2]);if(near(c,MM_COLORS.building,40))building++;if(near(c,MM_COLORS.water,40))water++;}
  assert.ok(building>500,`${building} building cells`);assert.ok(water>10,`${water} water cells`);
  assert.ok(px.data.every((v,i)=>i%4!==3||v===255),'opaque');
});

test('the endless image: lakes blue, everything opaque, the same for the same seed', () => {
  const t=new TerrainField(4242,{world:'infinito'}),a=endlessTerrainPixels(t,{x:0,y:0},120,1),b=endlessTerrainPixels(new TerrainField(4242,{world:'infinito'}),{x:0,y:0},120,1);
  assert.equal(a.width,120);assert.deepEqual(Array.from(a.data),Array.from(b.data));
  let water=0;for(let i=0;i<a.width*a.height;i++)if(near(hex(a.data[i*4],a.data[i*4+1],a.data[i*4+2]),MM_COLORS.water,70))water++;
  assert.ok(water>0,'a lake in 120 u around the camp');
});

/** Stand-in images (no canvas in node): a new object per build, so a rebuild is visible. */
const stub=()=>({canvas:null as never,origin:{x:0,y:0},unit:1,width:1,height:1});
const IMAGES:TerrainImages={city:stub,endless:stub,island:stub};
/** A fake minimap that keeps a copy of what it was handed (the driver reuses its mark objects between draws). */
const fake=()=>{const got:MmInput[]=[];return {got,minimap:{render:(i:MmInput)=>got.push({...i,self:i.self&&{...i.self},allies:i.allies.map(x=>({...x})),enemies:i.enemies.map(x=>({...x})),structures:i.structures.map(x=>({...x}))})} as never};};

test('the driver: the city frame, ally colours as the team strip shows them, the base blinking after a hit', () => {
  const d=new WcMinimapDriver(IMAGES),{got,minimap}=fake(),terrain=new TerrainField(1);
  const base={minimap,terrain,city:asset,view:1,selfId:'a',self:{x:80,y:90},states:new Map(),enemies:[{x:10,y:10},{x:5,y:5,hp:0},{x:60,y:60,boss:true}],
    structures:[{kind:'muralha',x:84,y:90},{kind:'torre-chinelo',x:70,y:70},{kind:'barricada-N',x:84,y:70}],corners:[],extras:undefined};
  d.draw({...base,nowMs:1000,wallHitAt:500,players:[{id:'a',x:80,y:90,online:true},{id:'b',x:1,y:2,online:true},{id:'c',x:3,y:4,online:false},{id:'d',x:5,y:6,online:true}]});
  d.draw({...base,nowMs:9000,wallHitAt:500,players:[{id:'d',x:5,y:6,online:true},{id:'b',x:1,y:2,online:true}],self:{x:81,y:90}});
  const [first,second]=got;
  assert.equal(first.frame.side,MM_SIDE);assert.equal(first.frame.view,1);
  // The colour is the player's place in the run's list (join order), as the team strip paints the portrait's ring.
  assert.deepEqual(first.allies.map(a=>a.color),[ALLY_COLORS[1],ALLY_COLORS[3]],'self skipped, offline skipped, colours by place');
  assert.deepEqual(second.allies.map(a=>a.color),[teamColor([{id:'d'},{id:'b'}],'d'),teamColor([{id:'d'},{id:'b'}],'b')],'the strip rule');
  assert.equal(first.enemies.length,2,'dead critters skipped');assert.equal(first.enemies.filter(e=>e.boss).length,1);
  assert.deepEqual(first.structures.map(s=>s.kind),['base','tower','barricade']);
  assert.equal(first.structures[0].hit,true,'hit 500 ms ago: blinking');assert.equal(second.structures[0].hit,undefined,'8.5 s later: steady');
  assert.ok(second.self!.dx>0.99,'the heading follows the last step (east)');
});

test('the driver draws a nest only once someone has seen it (D-051 fog), its roof sized; a reused slot drops the size', () => {
  const d=new WcMinimapDriver(IMAGES),{got,minimap}=fake(),terrain=new TerrainField(1);
  const base={minimap,terrain,city:asset,view:1,selfId:'a',self:{x:80,y:90},states:new Map(),enemies:[],corners:[],extras:undefined,nowMs:0,wallHitAt:-1e9,
    players:[{id:'a',x:80,y:90,online:true}]};
  d.draw({...base,structures:[{kind:'ninho',x:30,y:30,size:'G',seen:true},{kind:'ninho',x:150,y:40,size:'P',seen:false},{kind:'ninho',x:40,y:150,size:'P'},{kind:'muralha',x:84,y:90}]});
  d.draw({...base,structures:[{kind:'muralha',x:84,y:90}]});
  const [first,second]=got;
  assert.deepEqual(first.structures.map(s=>[s.kind,s.size]),[['nest','G'],['base',undefined]],'unseen nests stay off the minimap');
  assert.deepEqual(second.structures.map(s=>[s.kind,s.size]),[['base',undefined]]);
});

test('the driver on the endless map: a window around the hero, its terrain rebuilt only after a quarter of it', () => {
  const d=new WcMinimapDriver(IMAGES),t=new TerrainField(77,{world:'infinito'});
  const a=d.frameFor({terrain:t,view:0,self:{x:0,y:0}}),b=d.frameFor({terrain:t,view:0,self:{x:ENDLESS_REBUILD*.5,y:0}}),c=d.frameFor({terrain:t,view:0,self:{x:ENDLESS_REBUILD*1.2,y:0}});
  assert.equal(a.terrain,b.terrain,'a short walk keeps the image');assert.notEqual(b.terrain,c.terrain,'a long walk builds it again');
  const mid=toMini({x:ENDLESS_REBUILD*.5,y:0},b.frame);
  assert.ok(Math.abs(mid.x-MM_SIDE/2)<1e-9&&Math.abs(mid.y-MM_SIDE/2)<1e-9,'the hero in the middle');
});
