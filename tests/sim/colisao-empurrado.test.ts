/**
 * Card NEW-20261030-ORQ-colisao-entre-herois, the addendum (user, 30/10: "E para monstros, só o 'mendigo' pode ser
 * empurrado"; and the frame's "empurrando" / "empurrado" with the direction, for E1's anim-ser-empurrado):
 *  - the saci and the sanfoneiro are solid and never move: the hero stops at their edge (as at the Uno), the phone too;
 *  - the mendigo (the plain enemies, drawn as it) is pushed, and the frame marks it "empurrado" and the hero
 *    "empurrando" along the push; a hero walking into a standing hero: "empurrando" / "empurrado"; head-on: both
 *    "empurrando", nobody "empurrado"; the marks go away PUSH_HOLD ticks after the push stops;
 *  - the marks travel the protocol 4 frame (FrameEncoder → FrameDecoder) with their direction.
 * On the REAL Cidade Nevada (the plaza), D-031: no wall-clock asserts.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {cityTerrainFrom} from '../../src/maps/city/terrain.ts';
import {RADIUS,type Point} from '../../src/maps/world.ts';
import {reconcile} from '../../src/maps/prediction.ts';
import type {Body} from '../../src/maps/bodies.ts';
import {BASE_STATS,type EnemyState,type PlayerInput,type SimPlayer} from '../../src/contract/index.ts';
import {SimWorld} from '../../src/sim/core.ts';
import {SpatialHash} from '../../src/sim/spatial.ts';
import {RUN_ORDER,playersSystem} from '../../src/sim/systems/players.ts';
import {createRunSystems} from '../../src/sim/assemble.ts';
import {createEnemy} from '../../src/sim/enemies/catalog.ts';
import {PUSH_HOLD,pushView} from '../../src/sim/bodies.ts';
import {shovedEnemy} from '../../src/rules/index.ts';
import {FrameDecoder,FrameEncoder,type FrameInput} from '../../src/protocol/protocol4.ts';

const fromRoot=(path:string)=>fileURLToPath(new URL(`../../${path}`,import.meta.url));
const TEXT=readFileSync(fromRoot('public/maps/cidade-nevada.json'),'utf8');
const HASH=(JSON.parse(readFileSync(fromRoot('public/maps/cidade-nevada.manifest.json'),'utf8')) as {hash:string}).hash;
const loaded=await cityTerrainFrom(TEXT,HASH);
if(!loaded.ok)throw new Error(loaded.error);
const city=loaded.terrain;

function addPlayer(world:SimWorld,id:string,p:Point){
  const player={id,classId:'x',hp:100,online:true,spectator:false,facing:{x:1,y:0},build:{weapons:[],passives:[]},
    stats:{...BASE_STATS,maxHp:100},weaponReady:{},x:p.x,y:p.y,ack:0,score:0} as SimPlayer;
  world.players.set(id,player);return player;
}
/** Only the players system with the bodies: each hero holds the direction `dirs` gives it (none: stands). */
function walkRig(dirs:Record<string,Point|undefined>){
  const world=new SimWorld({terrain:city,seed:1,players:new Map(),order:RUN_ORDER,enemyIndex:new SpatialHash<EnemyState>()});
  const seq:Record<string,number>={};
  world.register(playersSystem(id=>{const d=dirs[id];if(!d)return undefined;seq[id]=(seq[id]??0)+1;return {seq:seq[id],x:d.x,y:d.y} as PlayerInput;},
    undefined,undefined,undefined,undefined,true));
  return world;
}
function plaza(){
  const world=new SimWorld({terrain:city,seed:1,players:new Map(),order:RUN_ORDER,enemyIndex:new SpatialHash<EnemyState>()});
  const sys=createRunSystems(world,{takeInput:()=>undefined,onOutcome:()=>{},cityTutorial:false});
  return sys.avenues!.plazaCenter;
}
const BASE=plaza();
const gap=(p:Point,e:EnemyState)=>Math.hypot(p.x-e.x,p.y-e.y)-RADIUS-e.radius;
const near=(got:Point|undefined,want:Point,msg:string)=>{
  assert.ok(got,`${msg}: no mark`);
  assert.ok(Math.hypot(got.x-want.x,got.y-want.y)<.05,`${msg}: (${got.x.toFixed(3)},${got.y.toFixed(3)}) not (${want.x},${want.y})`);
};

test('only the mendigo is pushed: the saci and the sanfoneiro are solid and never move',()=>{
  assert.equal(shovedEnemy('bebado'),true,'a plain enemy (drawn as the mendigo)');
  assert.equal(shovedEnemy('aberracao-saci'),false,'the saci');
  assert.equal(shovedEnemy('sanfoneiro'),false,'the sanfoneiro');
  assert.equal(shovedEnemy('bebado',true),false,'any boss');
});

for(const kind of ['aberracao-saci','sanfoneiro']){
  test(`walking into a ${kind}: the hero stops at its edge, it does not move, no push mark; the phone replays the same`,()=>{
    const world=walkRig({a:{x:1,y:0}});
    const start={x:BASE.x-2.5,y:BASE.y};
    const p=addPlayer(world,'a',start);
    const e=createEnemy(world,kind,{x:BASE.x,y:BASE.y});
    const at={x:e.x,y:e.y};
    const copy:Body={x:e.x,y:e.y,radius:e.radius,...(e.elite?{elite:true}:{}),fixed:true};
    const inputs:PlayerInput[]=[];
    for(let t=0;t<50;t++){
      world.step();inputs.push({seq:t+1,x:1,y:0} as PlayerInput);
      assert.ok(gap(p,e)>=-1e-9,`tick ${t}: inside by ${-gap(p,e)}`);
      assert.deepEqual({x:e.x,y:e.y},at,`tick ${t}: the ${kind} moved`);
      assert.deepEqual(pushView(e,world.tick),{},`tick ${t}: the ${kind} marked pushed`);
      assert.equal(pushView(p,world.tick).pushing,undefined,`tick ${t}: the hero marked pushing`);
    }
    assert.ok(gap(p,e)<.02,`the hero stopped ${gap(p,e).toFixed(3)} u short of the edge`);
    const phone=reconcile({...start},inputs,city,{tick:0,bodies:[copy]});
    assert.ok(Math.abs(phone.x-p.x)<1e-9&&Math.abs(phone.y-p.y)<1e-9,`phone (${phone.x},${phone.y}) room (${p.x},${p.y})`);
    assert.deepEqual({x:copy.x,y:copy.y},at,'the phone did not move it either');
  });
}

test('pushing a mendigo: it is "empurrado" and the hero "empurrando" along the push, gone PUSH_HOLD ticks after',()=>{
  const dirs:Record<string,Point|undefined>={a:{x:1,y:0}};
  const world=walkRig(dirs);
  const p=addPlayer(world,'a',{x:BASE.x-1.5,y:BASE.y});
  const e=createEnemy(world,'bebado',{x:BASE.x,y:BASE.y});
  const before=e.x;
  for(let t=0;t<30;t++)world.step();
  assert.ok(e.x>before,'the mendigo was pushed');
  near(pushView(e,world.tick).pushed,{x:1,y:0},'mendigo empurrado');
  near(pushView(p,world.tick).pushing,{x:1,y:0},'hero empurrando');
  assert.equal(pushView(p,world.tick).pushed,undefined,'the hero is not pushed');
  delete dirs.a;
  for(let t=0;t<PUSH_HOLD-1;t++){world.step();assert.ok(pushView(e,world.tick).pushed,`held ${t+1} tick(s)`);}
  world.step();
  assert.deepEqual(pushView(e,world.tick),{},'the mendigo mark went away');
  assert.deepEqual(pushView(p,world.tick),{},'the hero mark went away');
  assert.equal(p.pushing,undefined,'the room dropped the expired mark');
});

test('a hero walking into a standing hero: "empurrando" and "empurrado" along the line; head-on: both push, nobody pushed',()=>{
  const world=walkRig({a:{x:0,y:1}});
  const a=addPlayer(world,'a',{x:BASE.x,y:BASE.y-1.5}),b=addPlayer(world,'b',{x:BASE.x,y:BASE.y});
  for(let t=0;t<30;t++)world.step();
  near(pushView(a,world.tick).pushing,{x:0,y:1},'a empurrando');
  near(pushView(b,world.tick).pushed,{x:0,y:1},'b empurrado');
  assert.equal(pushView(a,world.tick).pushed,undefined,'a not pushed');
  assert.equal(pushView(b,world.tick).pushing,undefined,'b not pushing');

  const w2=walkRig({a:{x:1,y:0},b:{x:-1,y:0}});
  const c=addPlayer(w2,'a',{x:BASE.x-1.5,y:BASE.y}),d=addPlayer(w2,'b',{x:BASE.x+1.5,y:BASE.y});
  for(let t=0;t<40;t++)w2.step();
  near(pushView(c,w2.tick).pushing,{x:1,y:0},'head-on: a empurrando');
  near(pushView(d,w2.tick).pushing,{x:-1,y:0},'head-on: b empurrando');
  assert.equal(pushView(c,w2.tick).pushed,undefined,'head-on: a not pushed');
  assert.equal(pushView(d,w2.tick).pushed,undefined,'head-on: b not pushed');

  // Walking away from a teammate it touches is no push.
  const w3=walkRig({a:{x:-1,y:0}});
  const e=addPlayer(w3,'a',{x:BASE.x,y:BASE.y}),f=addPlayer(w3,'b',{x:BASE.x+2*RADIUS,y:BASE.y});
  w3.step();
  assert.deepEqual([pushView(e,w3.tick),pushView(f,w3.tick)],[{},{}],'walking away');
});

test('the marks travel the protocol 4 frame with their direction',()=>{
  const player=(id:string,i:number,extra:object)=>({id,name:`J${i}`,classId:'gato',hp:90,maxHp:100,online:true,spectator:false,
    weapons:[],passives:[],x:10+i,y:12,ack:i,...extra});
  const view:FrameInput={
    tick:500,team:{xp:0,level:1,nextXp:10},
    players:[player('u-a',0,{pushing:{x:.6,y:.8}}),player('u-b',1,{pushed:{x:.6,y:.8}}),player('u-c',2,{pushing:{x:-1,y:0},pushed:{x:0,y:1}}),player('u-d',3,{})],
    enemies:[{id:'e-1',kind:'bebado',x:3,y:4,hp:30,maxHp:30,pushed:{x:0,y:-1}},{id:'e-2',kind:'bebado',x:5,y:4,hp:30,maxHp:30}],
    pickups:[],projectiles:[],telegraphs:[],structures:[],nodes:[],
  };
  const enc=new FrameEncoder(),dec=new FrameDecoder();
  const res=dec.decode(enc.encode(view));
  assert.ok(res.ok,res.ok?'':res.error);
  const by=new Map(res.view.players.map(p=>[enc.ids.resolve(p.id)??p.id,p]));
  near(by.get('u-a')!.pushing,{x:.6,y:.8},'u-a pushing');assert.equal(by.get('u-a')!.pushed,undefined);
  near(by.get('u-b')!.pushed,{x:.6,y:.8},'u-b pushed');assert.equal(by.get('u-b')!.pushing,undefined);
  near(by.get('u-c')!.pushing,{x:-1,y:0},'u-c pushing');near(by.get('u-c')!.pushed,{x:0,y:1},'u-c pushed');
  assert.equal(by.get('u-d')!.pushing??by.get('u-d')!.pushed,undefined,'u-d: none');
  const en=new Map(res.view.enemies.map(e=>[enc.ids.resolve(e.id)??e.id,e]));
  near(en.get('e-1')!.pushed,{x:0,y:-1},'e-1 pushed');assert.equal(en.get('e-2')!.pushed,undefined);
  // The next frame drops the mark: the decoder drops it too.
  view.tick++;delete view.players[0]!.pushing;delete view.enemies[0]!.pushed;
  const res2=dec.decode(enc.encode(view));
  assert.ok(res2.ok,res2.ok?'':res2.error);
  assert.equal(res2.view.players.find(p=>(enc.ids.resolve(p.id)??p.id)==='u-a')!.pushing,undefined,'u-a pushing gone');
  assert.equal(res2.view.enemies.find(e=>(enc.ids.resolve(e.id)??e.id)==='e-1')!.pushed,undefined,'e-1 pushed gone');
});
