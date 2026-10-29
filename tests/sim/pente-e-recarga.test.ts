// NEW-20261029-ORQ-pente-e-recarga: endless ammo, but each firearm has a magazine and a reload during which it does not
// fire. The table (sim/weapons/arsenal.ts MAGAZINES), the damage that keeps the mean DPS, the reload in the weapon
// system, the idle reload (no button), the wire (player fields + 'reload' event) and the HUD badge.
import test from 'node:test';
import assert from 'node:assert/strict';
import {Rng} from '../../src/contract/rng.ts';
import {BASE_STATS} from '../../src/contract/types.ts';
import type {EnemyState,SimEvent,SimPlayer,SpatialIndex} from '../../src/contract/types.ts';
import type {SimContext,SimSystem} from '../../src/sim/context.ts';
import type {TerrainField} from '../../src/maps/terrain/field.ts';
import {getWeapon,resolveWeapon} from '../../src/sim/weapons/catalog.ts';
import {MAGAZINES,magDpsFactor} from '../../src/sim/weapons/arsenal.ts';
import {IDLE_RELOAD_TICKS,createWeaponSystem,magView,reloadTicks} from '../../src/sim/weapons/system.ts';
import {createProjectileSystem} from '../../src/sim/projectiles.ts';
import {FrameDecoder,FrameEncoder,type FrameInput,type PlayerWireView} from '../../src/protocol/protocol4.ts';
import {magBadge} from '../../src/client/hud/inventory.ts';
import {setRosterOnlyWithArt} from '../../src/rules/enemy-rotation.ts';
setRosterOnlyWithArt(false);

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
/** A manual hero holding `weapon` in the hand (slot 0) next to a critter that never dies. */
function setup(weapon:string,level=1){
  const ctx=makeCtx();
  const p:SimPlayer={id:'p1',classId:'x',x:0,y:0,hp:100,online:true,spectator:false,facing:{x:1,y:0},
    build:{weapons:[{id:weapon,level},{id:'faca',level:1}],passives:[],hand:0},stats:{...BASE_STATS},weaponReady:{}};
  ctx.players.set(p.id,p);
  ctx.enemies.set('e1',{id:'e1',kind:'mosquito',x:2,y:0,hp:1e9,maxHp:1e9,speed:0,damage:0,radius:.3,xp:1,spawnTick:0,readyTick:0});
  const held=new Set(['p1']);
  const sys:SimSystem[]=[createWeaponSystem({manual:{attacking:id=>held.has(id)}}),createProjectileSystem({})];
  const run=(n:number)=>{for(let i=0;i<n;i++){ctx.tick++;ctx.enemyIndex.rebuild(ctx.enemies.values());for(const s of sys)s.step(ctx);}};
  return {ctx,p,held,run};
}
const fireTicks=(ctx:Fake,weapon:string)=>ctx.events.filter(e=>e.event.type==='fire'&&(e.event as {weapon:string}).weapon===weapon).map(e=>e.tick);
const reloads=(ctx:Fake)=>ctx.events.filter(e=>e.event.type==='reload').map(e=>({tick:e.tick,...(e.event as Extract<SimEvent,{type:'reload'}>)}));

test('the card\'s table: magazine and reload of the six firearms; the faca and Pack 12 have none',()=>{
  assert.deepEqual(MAGAZINES,{pistola:{size:8,reload:1},escopeta:{size:2,reload:1.6},submetralhadora:{size:24,reload:1.4},
    rifle:{size:5,reload:1.5},macarico:{size:25,reload:1.8},rojao:{size:1,reload:2}});
  for(const [id,mag] of Object.entries(MAGAZINES))assert.deepEqual(getWeapon(id)?.mag,mag,id);
  assert.equal(getWeapon('faca')?.mag,undefined);
});

test('damage per shot rises so a full magazine plus its reload deals the old mean DPS',()=>{
  for(const [id,mag] of Object.entries(MAGAZINES)){
    const def=getWeapon(id)!,row=def.levels[0];
    const interval=row.cooldown+(def.pattern==='zone'?row.duration:0);
    const factor=magDpsFactor(def.pattern,row,mag),before=row.damage/factor;
    const cycle=(mag.size-1)*interval+Math.max(interval,mag.reload);
    assert.ok(Math.abs(row.damage*mag.size/cycle-before/interval)<1e-9,`${id}: mean DPS kept`);
    assert.ok(factor>=1,`${id}: never less damage per shot`);
  }
  // A reload no longer than the gap (a single-shot weapon slower than its reload) changes nothing.
  assert.equal(magDpsFactor('pierce',{cooldown:2} as never,{size:1,reload:1}),1);
});

test('the pistola fires 8, reloads (no shot meanwhile), then fires again; start and end events carry the weapon',()=>{
  const {ctx,run}=setup('pistola');
  const def=getWeapon('pistola')!,length=reloadTicks(def,resolveWeapon(def,1,{...BASE_STATS}));
  assert.ok(length>0);
  run(200);
  const shots=fireTicks(ctx,'pistola'),r=reloads(ctx);
  assert.ok(shots.length>9,`fired ${shots.length}`);
  const start=r.find(e=>e.phase==='start')!,end=r.find(e=>e.phase==='end')!;
  assert.equal(start.tick,shots[7],'the reload starts on the 8th shot');
  assert.deepEqual({player:start.player,weapon:start.weapon,ticks:start.ticks},{player:'p1',weapon:'pistola',ticks:length});
  assert.equal(end.tick,start.tick+length);assert.equal(end.weapon,'pistola');
  assert.ok(!shots.some(t=>t>start.tick&&t<end.tick),'no shot while reloading');
  assert.equal(shots[8],end.tick,'the 9th shot as soon as the magazine is back');
});

test('magView: the shots left, 0 with the ring while reloading, nothing for the faca',()=>{
  const {ctx,p,run}=setup('pistola');
  assert.deepEqual(magView(p,ctx.tick),{mag:8});
  run(1);
  assert.deepEqual(magView(p,ctx.tick),{mag:7});
  while(!p.reloading)run(1);
  const v=magView(p,ctx.tick);
  assert.equal(v.mag,0);assert.equal(v.reloadUntil,p.reloading.pistola.until);assert.equal(v.reloadTicks,p.reloading.pistola.ticks);
  p.build.hand=1;
  assert.deepEqual(magView(p,ctx.tick),{},'the faca has no magazine');
  delete p.build.hand;
  assert.deepEqual(magView(p,ctx.tick),{},'the automatic game shows none');
});

test('let go part way: the magazine reloads by itself IDLE_RELOAD_TICKS after the cooldown (no button)',()=>{
  const {ctx,p,held,run}=setup('pistola');
  while(fireTicks(ctx,'pistola').length<3)run(1);
  held.clear();
  const ready=p.weaponReady.pistola;
  run(ready+IDLE_RELOAD_TICKS-ctx.tick-1);
  assert.equal(reloads(ctx).length,0,'not before the idle time');
  run(1);
  const start=reloads(ctx)[0];
  assert.ok(start&&start.phase==='start'&&start.tick===ready+IDLE_RELOAD_TICKS,`start at ${start?.tick}`);
  run(start.ticks!);
  assert.equal(reloads(ctx).at(-1)?.phase,'end');
  assert.deepEqual(magView(p,ctx.tick),{mag:8},'full again');
});

test('a down hero\'s reload still ends; a cooldown reset (skill) does not cut a reload short',()=>{
  const {ctx,p,run}=setup('escopeta');
  while(!p.reloading)run(1);
  const until=p.reloading.escopeta.until;
  p.weaponReady={};// what skills.ts does on a reset
  run(1);
  assert.ok(!fireTicks(ctx,'escopeta').some(t=>t>until-p.reloading!.escopeta.ticks&&t<until),'no shot inside the reload');
  p.hp=0;
  run(until-ctx.tick);
  assert.equal(p.reloading,undefined,'the reload ran out in the fallen hero\'s hands');
});

function wirePlayer(extra:Partial<PlayerWireView>={}):PlayerWireView{
  return {id:'uuid-0',name:'Zé',classId:'cidadao-comum',hp:50,maxHp:100,online:true,spectator:false,
    weapons:[{id:'pistola',level:1}],passives:[],x:3,y:4,ack:1,hand:0,...extra} as PlayerWireView;
}
function frame(players:PlayerWireView[],tick=1000):FrameInput{
  return {tick,team:{xp:0,level:1,nextXp:10},round:{index:0,total:5,phase:'wave',phaseEndsTick:2000,remaining:0},
    players,enemies:[],pickups:[],projectiles:[],telegraphs:[],structures:[]};
}

test('wire: mag, reloadUntil and reloadTicks round-trip, full and delta; the reload event too',()=>{
  const enc=new FrameEncoder(),dec=new FrameDecoder();
  enc.pushEvents([{type:'reload',player:'uuid-0',weapon:'pistola',phase:'start',ticks:20,eventId:5} as SimEvent&{eventId:number}]);
  const r1=dec.decode(enc.encode(frame([wirePlayer({mag:0,reloadUntil:1020,reloadTicks:20})])));
  assert.ok(r1.ok,!r1.ok?r1.error:'');
  const p=r1.view.players[0];
  assert.equal(p.mag,0);assert.equal(p.reloadUntil,1020);assert.equal(p.reloadTicks,20);
  assert.deepEqual(r1.view.events,[{type:'reload',eventId:5,player:'uuid-0',weapon:'pistola',phase:'start',ticks:20}]);
  enc.ack(r1.seq,r1.ack.event);
  enc.pushEvents([{type:'reload',player:'uuid-0',weapon:'pistola',phase:'end',eventId:6} as SimEvent&{eventId:number}]);
  const r2=dec.decode(enc.encode(frame([wirePlayer({mag:8})],1021)));
  assert.ok(r2.ok,!r2.ok?r2.error:'');
  const q=r2.view.players[0];
  assert.equal(q.mag,8);assert.equal(q.reloadUntil,undefined);assert.equal(q.reloadTicks,undefined);
  assert.deepEqual(r2.view.events,[{type:'reload',eventId:6,player:'uuid-0',weapon:'pistola',phase:'end'}]);
  enc.ack(r2.seq,r2.ack.event);
  const r3=dec.decode(enc.encode(frame([wirePlayer()],1022)));
  assert.ok(r3.ok);assert.equal(r3.view.players[0].mag,undefined,'a weapon with no magazine sends none');
});

test('HUD badge: shots left, then 0 and the ring filling while it reloads, nothing without a magazine',()=>{
  assert.deepEqual(magBadge(undefined,10),{});
  assert.deepEqual(magBadge({},10),{});
  assert.deepEqual(magBadge({mag:5},10),{count:5});
  assert.deepEqual(magBadge({mag:0,reloadUntil:120,reloadTicks:20},100),{count:0,reload:0});
  assert.deepEqual(magBadge({mag:0,reloadUntil:120,reloadTicks:20},110),{count:0,reload:.5});
  assert.deepEqual(magBadge({mag:0,reloadUntil:120,reloadTicks:20},120),{count:0},'ended: the frame with the full magazine is next');
});
