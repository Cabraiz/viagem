// BUG-20261023-ORQ-tiro-na-direcao-mobile: in the manual combat a person's attack always goes off toward the aim (the
// mouse, the phone's aim stick) or else the facing, with a ±35° aim assist (rules/front-assist.ts, tiro-rapido-e-local); the bots keep "no attack at the air".
import test from 'node:test';
import assert from 'node:assert/strict';
import {Rng} from '../../src/contract/rng.ts';
import {BASE_STATS} from '../../src/contract/types.ts';
import type {EnemyState,SimEvent,SimPlayer,SpatialIndex} from '../../src/contract/types.ts';
import type {SimContext,SimSystem} from '../../src/sim/context.ts';
import type {TerrainField} from '../../src/maps/terrain/field.ts';
import {getWeapon,resolveWeapon} from '../../src/sim/weapons/catalog.ts';
import {ASSIST_ANGLE,createWeaponSystem,manualReach} from '../../src/sim/weapons/system.ts';
import {createProjectileSystem} from '../../src/sim/projectiles.ts';

// ---------- A small SimContext (like sim-weapons.test.ts) ----------
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
    damageEnemy(id,amount){const e=ctx.enemies.get(id);if(!e||e.hp<=0)return false;e.hp-=amount;if(e.hp>0)return false;ctx.enemies.delete(id);return true;},
    damagePlayer(){},
  };
  return ctx;
}
function addPlayer(ctx:Fake,id:string,x:number,y:number,weapons:[string,number][],o:Partial<SimPlayer>={}):SimPlayer{
  const p:SimPlayer={id,classId:'x',x,y,hp:100,online:true,spectator:false,facing:{x:1,y:0},
    build:{weapons:weapons.map(([id,level])=>({id,level})),passives:[]},stats:{...BASE_STATS},weaponReady:{},...o};
  ctx.players.set(id,p);return p;
}
function addEnemy(ctx:Fake,id:string,x:number,y:number,o:Partial<EnemyState>={}):EnemyState{
  const e:EnemyState={id,kind:'mosquito',x,y,hp:1e6,maxHp:1e6,speed:0,damage:0,radius:.3,xp:1,spawnTick:0,readyTick:0,...o};
  ctx.enemies.set(id,e);return e;
}
/** The manual weapons with a hand on the attack button: `held` says who holds it on each tick. */
function manualSystems(held:Set<string>,bots=new Set<string>()):SimSystem[]{
  return [createWeaponSystem({manual:{attacking:id=>held.has(id),free:id=>!bots.has(id)}}),createProjectileSystem({})];
}
function run(ctx:Fake,sys:SimSystem[],n=1,before?:(ctx:Fake)=>void){
  for(let i=0;i<n;i++){ctx.tick++;before?.(ctx);ctx.enemyIndex.rebuild(ctx.enemies.values());for(const s of sys)s.step(ctx);}
}
const fires=(ctx:Fake,weapon?:string)=>ctx.events.filter(e=>e.event.type==='fire'&&(!weapon||(e.event as {weapon:string}).weapon===weapon));
const R=(id:string,level=1)=>resolveWeapon(getWeapon(id)!,level,{...BASE_STATS});
/** The direction (unit) of a fire event. */
const aimOf=(e:{event:SimEvent})=>{const f=e.event as {dx:number;dy:number};const l=Math.hypot(f.dx,f.dy);return {x:f.dx/l,y:f.dy/l};};

const deg=(d:number)=>d*Math.PI/180;
/** An enemy `dist` u from (10,10) at `angle` (deg) from +x. */
const at=(dist:number,angle:number)=>({x:10+dist*Math.cos(deg(angle)),y:10+dist*Math.sin(deg(angle))});
const angleOf=(e:{event:SimEvent})=>{const d=aimOf(e);return Math.atan2(d.y,d.x)*180/Math.PI;};

test('assist cone is ±35°',()=>{assert.ok(Math.abs(ASSIST_ANGLE-deg(35))<1e-12);});

test('person, nobody around: the pistol fires straight along the facing and the cooldown runs',()=>{
  const ctx=makeCtx(),held=new Set(['p']),sys=manualSystems(held);
  const p=addPlayer(ctx,'p',10,10,[['pistola',1]],{facing:{x:0,y:1}});
  run(ctx,sys,1);
  const f=fires(ctx,'pistola');assert.equal(f.length,1,'a shot into the air');
  assert.ok(Math.abs(angleOf(f[0])-90)<1e-6,'along the facing');
  assert.equal(ctx.projectiles.size,1);
  assert.equal(p.weaponReady.pistola,1+R('pistola').cooldownTicks,'the cooldown runs');
  held.clear();run(ctx,sys,5);assert.equal(fires(ctx).length,1,'released: no more');
});

test('person: an enemy 15° or 30° off the facing is shot at; one 50° or 60° off is not (straight ahead)',()=>{
  const reach=manualReach(R('pistola')).reach;
  for(const [angle,hits] of [[15,true],[-15,true],[30,true],[-30,true],[50,false],[60,false],[-90,false],[180,false]] as const){
    const ctx=makeCtx(),held=new Set(['p']),sys=manualSystems(held);
    addPlayer(ctx,'p',10,10,[['pistola',1]],{facing:{x:1,y:0}});
    const e=addEnemy(ctx,'e',at(reach*.6,angle).x,at(reach*.6,angle).y);
    run(ctx,sys,1);
    const a=angleOf(fires(ctx,'pistola')[0]);
    if(hits)assert.ok(Math.abs(a-angle)<1e-6,`${angle}°: turned onto it (${a})`);
    else assert.ok(Math.abs(a)<1e-6,`${angle}°: straight (${a})`);
    held.clear();run(ctx,sys,R('pistola').durationTicks);
    assert.equal(e.hp<e.maxHp,hits,`${angle}°: hit ${hits}`);
  }
});

test('person: the assist picks the one nearest the front line (the angle weighs more than the distance), and only within the weapon\'s reach',()=>{
  const reach=manualReach(R('pistola')).reach;
  const ctx=makeCtx(),held=new Set(['p']),sys=manualSystems(held);
  addPlayer(ctx,'p',10,10,[['pistola',1]],{facing:{x:1,y:0}});
  const a=at(reach*.3,18),b=at(reach*.8,5),c=at(reach+1,0);
  addEnemy(ctx,'a',a.x,a.y);addEnemy(ctx,'b',b.x,b.y);addEnemy(ctx,'c',c.x,c.y);
  run(ctx,sys,1);
  assert.ok(Math.abs(angleOf(fires(ctx)[0])-5)<1e-6,'b, 5° off, beats a nearer one at 18°; c is out of reach');
});

test('person: the drag (the aim) beats the facing, and the assist works around it',()=>{
  const reach=manualReach(R('pistola')).reach;
  const ctx=makeCtx(),held=new Set(['p']),sys=manualSystems(held),cd=R('pistola').cooldownTicks;
  const p=addPlayer(ctx,'p',10,10,[['pistola',1]],{facing:{x:1,y:0},aim:{x:0,y:-2}});
  const ahead=at(reach*.5,0);addEnemy(ctx,'ahead',ahead.x,ahead.y);
  run(ctx,sys,1);
  assert.ok(Math.abs(angleOf(fires(ctx)[0])+90)<1e-6,'up the drag, not at the one ahead of the facing');
  const up=at(reach*.5,-80);addEnemy(ctx,'up',up.x,up.y);
  run(ctx,sys,cd);
  assert.ok(Math.abs(angleOf(fires(ctx).at(-1)!)+80)<1e-6,'10° off the drag: assisted onto it');
  delete p.aim;run(ctx,sys,cd);
  assert.ok(Math.abs(angleOf(fires(ctx).at(-1)!))<1e-6,'drag let go: the facing (and the one ahead) again');
});

test('person: the knife swings along the facing into the air, and strikes only inside its cone (no turn behind)',()=>{
  const ctx=makeCtx(),held=new Set(['p']),sys=manualSystems(held);
  addPlayer(ctx,'p',10,10,[['faca',1]],{facing:{x:1,y:0}});
  run(ctx,sys,1);
  assert.equal(fires(ctx,'faca').length,1,'a swing at the air');assert.ok(Math.abs(angleOf(fires(ctx)[0]))<1e-6);
  const c=makeCtx(),h=new Set(['p']),s=manualSystems(h);
  addPlayer(c,'p',10,10,[['faca',1]],{facing:{x:1,y:0}});
  const behind=addEnemy(c,'behind',9.4,10);
  run(c,s,1);
  assert.equal(behind.hp,behind.maxHp,'the one behind is not hit (no auto turn)');
  assert.ok(Math.abs(angleOf(fires(c)[0]))<1e-6);
});

test('person: holding with a drag keeps firing at the weapon\'s cadence',()=>{
  const ctx=makeCtx(),held=new Set(['p']),sys=manualSystems(held),cd=R('pistola').cooldownTicks;
  addPlayer(ctx,'p',10,10,[['pistola',1]],{aim:{x:-1,y:0}});
  run(ctx,sys,3*cd+1);
  assert.deepEqual(fires(ctx).map(f=>f.tick),[1,1+cd,1+2*cd,1+3*cd]);
  assert.ok(fires(ctx).every(f=>Math.abs(Math.abs(angleOf(f))-180)<1e-6));
});

test('bot: nobody in reach, no shot (the cooldown waits); with one in reach it fires at it',()=>{
  const ctx=makeCtx(),held=new Set(['b']),sys=manualSystems(held,new Set(['b']));
  const b=addPlayer(ctx,'b',10,10,[['pistola',1]],{facing:{x:0,y:1}});
  run(ctx,sys,30);
  assert.equal(fires(ctx).length,0);assert.equal(b.weaponReady.pistola,undefined);
  const e=at(manualReach(R('pistola')).reach*.5,180);addEnemy(ctx,'e',e.x,e.y);
  run(ctx,sys,1);
  assert.equal(fires(ctx).length,1);assert.ok(Math.abs(Math.abs(angleOf(fires(ctx)[0]))-180)<1e-6,'the bot aims behind (its auto aim)');
});

test('person: homing and thrown zones go off into the air too',()=>{
  for(const id of ['pombo','cafe']){
    const ctx=makeCtx(),held=new Set(['p']),sys=manualSystems(held);
    addPlayer(ctx,'p',10,10,[[id,1]],{facing:{x:0,y:-1}});
    run(ctx,sys,1);
    assert.equal(fires(ctx,id).length,1,id);
  }
});
