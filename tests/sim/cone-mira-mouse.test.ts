// NEW-20261021-ORQ-cone-ataque-melee: on a PC the melee swing goes where the mouse points (PlayerInput.aim → SimPlayer.aim
// → weapons/system.ts fireCone), strikes only who is inside that cone, and swings at the air when nobody is (like LoL).
// Without an aim (a phone, a bot) the auto aim of D-051 stays. The wire part is in tests/protocol/input-attack.test.ts.
import test from 'node:test';
import assert from 'node:assert/strict';
import {Rng} from '../../src/contract/rng.ts';
import {BASE_STATS} from '../../src/contract/types.ts';
import type {EnemyState,SimEvent,SimPlayer,SpatialIndex} from '../../src/contract/types.ts';
import type {SimContext,SimSystem} from '../../src/sim/context.ts';
import type {TerrainField} from '../../src/maps/terrain/field.ts';
import {createWeaponSystem} from '../../src/sim/weapons/system.ts';
import {InputTrack,SEGMENT_ATTACK,SEGMENT_AIM_SHIFT,DIRECTIONS} from '../../src/protocol/input-track.ts';

interface Fake extends SimContext {tick:number;players:Map<string,SimPlayer>;events:{tick:number;event:SimEvent}[]}
function naiveIndex():SpatialIndex<EnemyState>{
  let items:EnemyState[]=[];
  return {
    rebuild(it){items=[...it];},
    query(x,y,r,out=[]){out.length=0;for(const e of items)if(Math.hypot(e.x-x,e.y-y)<=r)out.push(e);return out;},
    nearest(){return undefined;},
  };
}
function makeCtx():Fake{
  let ids=0;
  const ctx:Fake={
    tick:0,terrain:{} as TerrainField,rng:new Rng(1),players:new Map(),enemies:new Map(),pickups:new Map(),
    projectiles:new Map(),telegraphs:new Map(),team:{xp:0,level:1,nextXp:10},offers:new Map(),
    round:{index:0,total:5,phase:'wave',phaseEndsTick:1e9,remaining:0},enemyIndex:naiveIndex(),events:[],
    nextId(prefix){return prefix+(++ids);},
    emit(event){ctx.events.push({tick:ctx.tick,event});},
    damageEnemy(id,amount){const e=ctx.enemies.get(id);if(!e||e.hp<=0)return false;e.hp-=amount;return false;},
    damagePlayer(){},
  };
  return ctx;
}
function hero(ctx:Fake,o:Partial<SimPlayer>={}):SimPlayer{
  const p:SimPlayer={id:'p1',classId:'x',x:10,y:10,hp:100,online:true,spectator:false,facing:{x:1,y:0},
    build:{weapons:[{id:'faca',level:1}],passives:[]},stats:{...BASE_STATS},weaponReady:{},...o};
  ctx.players.set(p.id,p);return p;
}
function enemy(ctx:Fake,id:string,x:number,y:number):EnemyState{
  const e:EnemyState={id,kind:'mosquito',x,y,hp:1e6,maxHp:1e6,speed:0,damage:0,radius:.3,xp:1,spawnTick:0,readyTick:0};
  ctx.enemies.set(id,e);return e;
}
const holding=():SimSystem[]=>[createWeaponSystem({manual:{attacking:()=>true}})];
function tick(ctx:Fake,sys:SimSystem[]){ctx.tick++;ctx.enemyIndex.rebuild(ctx.enemies.values());for(const s of sys)s.step(ctx);}
const hurt=(e:EnemyState)=>e.hp<e.maxHp;
const fires=(ctx:Fake)=>ctx.events.filter(e=>e.event.type==='fire').map(e=>e.event as {dx:number;dy:number;weapon:string});

test('a cone aimed right does not strike the enemy on the left (the auto aim would have turned to it)',()=>{
  const ctx=makeCtx();hero(ctx,{aim:{x:1,y:0}});
  const left=enemy(ctx,'e1',9,10);
  tick(ctx,holding());
  assert.equal(hurt(left),false,'behind the swing: untouched');
  const f=fires(ctx);assert.equal(f.length,1,'still a swing (at the air): the cone shows');
  assert.deepEqual([f[0].dx,f[0].dy],[1,0],'toward the mouse');
});

test('aimed at the enemy, it is struck; aimed past the cone edge, it is not',()=>{
  const ctx=makeCtx();const p=hero(ctx,{aim:{x:0,y:1}});
  const up=enemy(ctx,'e1',10,10.8);
  tick(ctx,holding());
  assert.equal(hurt(up),true,'inside the cone toward the mouse');
  // The faca's half aperture is 1 rad: an enemy at 90° from the aim stays out.
  const ctx2=makeCtx();hero(ctx2,{aim:{x:1,y:0}});
  const side=enemy(ctx2,'e1',10,11);
  tick(ctx2,holding());
  assert.equal(hurt(side),false);
  void p;
});

test('with an aim, a swing goes even with nobody in reach (the cooldown runs); without one, no swing at the air',()=>{
  const ctx=makeCtx();const p=hero(ctx,{aim:{x:-1,y:0}});
  tick(ctx,holding());
  assert.equal(fires(ctx).length,1,'swing at the air toward the mouse');
  assert.ok((p.weaponReady.faca??0)>ctx.tick,'cooldown started');
  const ctx2=makeCtx();const q=hero(ctx2);
  tick(ctx2,holding());
  assert.equal(fires(ctx2).length,0,'phone / bot: nobody in reach, no swing');
  assert.equal(q.weaponReady.faca??0,0);
});

test('without an aim (phone, bot) the swing still turns to the enemy in reach (D-051 auto aim)',()=>{
  const ctx=makeCtx();hero(ctx);
  const left=enemy(ctx,'e1',9,10);
  tick(ctx,holding());
  assert.equal(hurt(left),true);
});

test('the aim rides the input track to the PlayerInput while attacking; none after the release',()=>{
  const track=new InputTrack();track.reset(0);
  const up=DIRECTIONS.findIndex(d=>d.x===0&&d.y===1);
  assert.ok(track.accept({seq:3,steps:[[1,0,0,SEGMENT_ATTACK|(up+1)<<SEGMENT_AIM_SHIFT],[3,1,0,0]]},0));
  const body={x:0,y:0} as SimPlayer;
  const a=track.next(body,1000),b=track.next(body,1050),c=track.next(body,1100);
  assert.deepEqual(a?.aim,{x:0,y:1});assert.equal(a?.attack,true);
  assert.deepEqual(b?.aim,{x:0,y:1});
  assert.equal(c?.attack,false);assert.equal('aim' in c!,false,'walking without the attack: no aim');
});
