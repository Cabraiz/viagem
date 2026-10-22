/**
 * Card upgrades-megabonk: the Megabonk tomes of the manual combat (rules/passives.ts), the Defumador's aura
 * (sim/weapons/system.ts), the towers that fire with their owner's tomes (sim/towers/system.ts ownerBoost) and the
 * short gain line of the level cards (client/hud/offer-card.ts offerGain).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {Rng} from '../../src/contract/rng.ts';
import {BASE_STATS,ticks,type EnemyState,type SimPlayer,type SpatialIndex} from '../../src/contract/types.ts';
import type {SimContext} from '../../src/sim/context.ts';
import {AURA,ESTILINGUE_SPEED,MANUAL_PASSIVE_IDS,PASSIVES,computeStats,rollChoices} from '../../src/rules/index.ts';
import {MANUAL_ITEMS} from '../../src/sim/items.ts';
import {AURA_SOURCE,auraRadius,createWeaponSystem} from '../../src/sim/weapons/system.ts';
import {resolveWeapon,getWeapon} from '../../src/sim/weapons/catalog.ts';
import {DEFENSES} from '../../src/sim/towers/catalog.ts';
import {defensesStep,ownerBoost,type DefenseState} from '../../src/sim/towers/system.ts';
import {offerGain} from '../../src/client/hud/offer-card.ts';
import {auraRingRadius} from '../../src/client/render/aura-ring.ts';

function index(items:()=>Iterable<EnemyState>):SpatialIndex<EnemyState>{
  return {rebuild(){},query(x,y,r,out=[]){out.length=0;for(const e of items())if(Math.hypot(e.x-x,e.y-y)<=r)out.push(e);return out;},nearest(){return undefined;}};
}
function makeCtx(){
  const hits:{id:string;amount:number;weapon?:string;by?:string}[]=[];
  const ctx={tick:0,terrain:{},rng:new Rng(1),players:new Map<string,SimPlayer>(),enemies:new Map<string,EnemyState>(),pickups:new Map(),
    projectiles:new Map(),telegraphs:new Map(),team:{xp:0,level:1,nextXp:10},offers:new Map(),
    round:{index:1,total:5,phase:'wave',phaseEndsTick:1e9,remaining:0},hits,
    nextId:(p:string)=>p+Math.random(),emit(){},
    damageEnemy(id:string,amount:number,by?:string,weapon?:string){
      const e=ctx.enemies.get(id);if(!e)return false;
      const dealt=amount*(by?ctx.players.get(by)?.stats.might??1:1);hits.push({id,amount:dealt,weapon,by});
      e.hp-=dealt;if(e.hp>0)return false;ctx.enemies.delete(id);return true;
    },
    damagePlayer(){},
  } as unknown as SimContext&{hits:typeof hits};
  (ctx as {enemyIndex:SpatialIndex<EnemyState>}).enemyIndex=index(()=>ctx.enemies.values());
  return ctx;
}
const hero=(passives:{id:string;level:number}[],o:Partial<SimPlayer>={}):SimPlayer=>{
  const build={weapons:[{id:'faca',level:1}],passives,hand:0};
  return {id:'p1',classId:'turista',x:0,y:0,hp:100,online:true,spectator:false,facing:{x:1,y:0},build,stats:computeStats(build),weaponReady:{},...o};
};
const enemy=(id:string,x:number,y:number,o:Partial<EnemyState>={}):EnemyState=>
  ({id,kind:'bebado',x,y,hp:1000,maxHp:1000,speed:0,damage:0,radius:.3,xp:1,spawnTick:0,readyTick:0,...o});

test('tomes: the manual level cards roll the new tomes; the Bombinha is +1 projétil up to 4, nothing reads as a magazine',()=>{
  for(const id of ['estilingue','defumador','arruda','tampa-de-panela','pente'])assert.ok((MANUAL_PASSIVE_IDS as readonly string[]).includes(id),id);
  const seen=new Set<string>(),rng=new Rng(3);
  for(let i=0;i<200;i++)for(const c of rollChoices(MANUAL_ITEMS,{weapons:[],passives:[]},1,rng))seen.add(c.itemId);
  for(const id of ['estilingue','defumador','arruda','tampa-de-panela','pente','oculos','cafe-forte','megafone'])assert.ok(seen.has(id),`${id} offered`);
  assert.equal(PASSIVES.pente.name,'Bombinha de São João');
  for(let l=1;l<=4;l++)assert.equal(computeStats({weapons:[],passives:[{id:'pente',level:l}]}).amount,l);
  assert.ok(!/pente|muni/i.test(PASSIVES.pente.describe(1)));
  // Estilingue: the shot's speed stat, so a pistol flies faster (and as long: farther).
  const pistol=getWeapon('pistola')!,base=resolveWeapon(pistol,1,BASE_STATS);
  const fast=resolveWeapon(pistol,1,computeStats({weapons:[],passives:[{id:'estilingue',level:2}]}));
  assert.ok(Math.abs(fast.speed-base.speed*(1+2*ESTILINGUE_SPEED))<1e-9);
  assert.equal(fast.durationTicks,base.durationTicks);
});

test('aura: every AURA.every s each awake enemy in reach takes AURA.damage × might, with no attack held and no weapon fired',()=>{
  const ctx=makeCtx(),p=hero([{id:'defumador',level:2},{id:'oculos',level:1}]);
  ctx.players.set(p.id,p);
  const r=auraRadius(p);
  assert.equal(r,AURA.radius(2));
  ctx.enemies.set('in',enemy('in',r-.1,0));ctx.enemies.set('edge',enemy('edge',0,r+.25));ctx.enemies.set('out',enemy('out',r+1,0));
  const sys=createWeaponSystem({manual:{attacking:()=>false}});
  const n=ticks(2);
  for(let t=0;t<n;t++){(ctx as {tick:number}).tick=t;sys.step(ctx);}
  const hits=(ctx as unknown as {hits:{id:string;amount:number;weapon?:string}[]}).hits;
  const pulses=Math.ceil(n/ticks(AURA.every));
  assert.equal(hits.filter(h=>h.id==='in').length,pulses,'one hit per pulse');
  assert.equal(hits.filter(h=>h.id==='edge').length,pulses,'the enemy radius counts');
  assert.equal(hits.filter(h=>h.id==='out').length,0);
  assert.ok(hits.every(h=>h.weapon===AURA_SOURCE&&Math.abs(h.amount-AURA.damage(2)*1.1)<1e-9),'damage × might');
  // Bigger area, bigger ring; a level up, more damage and reach.
  assert.ok(auraRadius(hero([{id:'defumador',level:2},{id:'megafone',level:2}]))>r);
  assert.ok(AURA.damage(3)>AURA.damage(2)&&AURA.radius(3)>AURA.radius(2));
  // The client's ring has the sim's radius.
  assert.equal(auraRingRadius({classId:'turista',weapons:[],passives:[{id:'defumador',level:3},{id:'megafone',level:1}]}),
    auraRadius(hero([{id:'defumador',level:3},{id:'megafone',level:1}])));
});

test('aura: a sleeper is never touched (walking past a nest does not wake it); no Defumador, no hits',()=>{
  const ctx=makeCtx(),p=hero([{id:'defumador',level:5}]);ctx.players.set(p.id,p);
  const sleeper=enemy('z',.5,0);
  (ctx as {sleepers?:unknown}).sleepers=Object.assign(new Map([['z',sleeper]]),{query:(x:number,y:number,r:number,out:EnemyState[]=[])=>{out.length=0;if(Math.hypot(sleeper.x-x,sleeper.y-y)<=r)out.push(sleeper);return out;}});
  const sys=createWeaponSystem({manual:{attacking:()=>false}});
  for(let t=0;t<ticks(2);t++){(ctx as {tick:number}).tick=t;sys.step(ctx);}
  assert.equal((ctx as unknown as {hits:unknown[]}).hits.length,0);
  const c2=makeCtx(),q=hero([]);c2.players.set(q.id,q);c2.enemies.set('e',enemy('e',.5,0));
  for(let t=0;t<ticks(2);t++){(c2 as {tick:number}).tick=t;sys.step(c2);}
  assert.equal((c2 as unknown as {hits:unknown[]}).hits.length,0);
});

test('towers: a manual-combat owner\'s tomes boost his towers (dano, cadência, +1 alvo); an automatic-game owner\'s do not',()=>{
  const kind='vigias-armados' as const,def=DEFENSES[kind];
  const fire=(owner:SimPlayer)=>{
    const ctx=makeCtx();ctx.players.set(owner.id,owner);
    for(let i=0;i<6;i++)ctx.enemies.set(`e${i}`,enemy(`e${i}`,1+i*.3,0));
    const d={id:'t1',kind,site:'',owner:owner.id,x:0,y:0,hp:def.hp,maxHp:def.hp,readyTick:0,fireTick:0,startTick:0} as unknown as DefenseState;
    const state={defenses:{list:[d]},wallDown:false} as never;
    defensesStep(ctx,state);
    return {hits:(ctx as unknown as {hits:{amount:number;by?:string}[]}).hits,next:d.fireTick};
  };
  const plain=fire(hero([]));
  assert.equal(plain.hits.length,def.shots);
  assert.ok(plain.hits.every(h=>h.amount===def.damage&&h.by===undefined));
  const strong=fire(hero([{id:'oculos',level:5},{id:'pente',level:1},{id:'cafe-forte',level:5}]));
  assert.equal(strong.hits.length,def.shots+1,'+1 projétil = +1 alvo');
  assert.ok(strong.hits.every(h=>Math.abs(h.amount-def.damage*1.5)<1e-9),'damage × might');
  assert.equal(strong.next,Math.round(def.cooldown*.6),'cooldown × the Café');
  const auto=hero([{id:'oculos',level:5}]);delete auto.build.hand;
  assert.equal(ownerBoost(makeCtx(),'nobody'),undefined);
  const ctx=makeCtx();ctx.players.set(auto.id,auto);
  assert.equal(ownerBoost(ctx,auto.id),undefined,'the automatic game keeps the towers\' numbers');
});

test('cards: every tome shows a short gain line ("+1 projétil", "+10% dano", the aura\'s damage)',()=>{
  assert.equal(offerGain('pente',1),'+1 projétil');
  assert.equal(offerGain('oculos',2),'+10% dano');
  assert.equal(offerGain('estilingue',1),'+40% velocidade do tiro');
  assert.equal(offerGain('cafe-forte',1),'Ataca 8% mais rápido');
  assert.equal(offerGain('defumador',1),`Aura: ${AURA.damage(1)} de dano`);
  assert.match(offerGain('defumador',2)!,/^Aura: \+3 de dano, \+0,3 m$/);
  assert.equal(offerGain('arruda',1),'+0,5 de vida/s');
  assert.equal(offerGain('tampa-de-panela',1),'-1 de dano tomado');
  assert.equal(offerGain('silenciador',1),'-25% de barulho');
  assert.equal(offerGain('pistola',1),undefined);
  for(const id of MANUAL_PASSIVE_IDS)assert.ok((offerGain(id,1)??'').length<=26,id);
});

test('manual combat: each extra projectile of a straight weapon flies at the next enemy in reach; with fewer enemies, the rest fan',()=>{
  const ctx=makeCtx(),p=hero([{id:'pente',level:2}],{build:{weapons:[{id:'pistola',level:1}],passives:[{id:'pente',level:2}],hand:0}});
  p.stats=computeStats(p.build);ctx.players.set(p.id,p);
  ctx.enemies.set('a',enemy('a',2,0));ctx.enemies.set('b',enemy('b',0,3));ctx.enemies.set('c',enemy('c',-4,0));
  createWeaponSystem({manual:{attacking:()=>true}}).step(ctx);
  const shots=[...ctx.projectiles.values()] as {vx:number;vy:number}[];
  assert.equal(shots.length,3);
  const dirs=shots.map(s=>Math.round(Math.atan2(s.vy,s.vx)*100)/100).sort((x,y)=>x-y);
  assert.deepEqual(dirs,[0,1.57,3.14],'one shot at each enemy');
  // One enemy: the three fan around it.
  const c2=makeCtx(),q=hero([],{build:{weapons:[{id:'pistola',level:1}],passives:[{id:'pente',level:2}],hand:0}});
  q.stats=computeStats(q.build);c2.players.set(q.id,q);c2.enemies.set('a',enemy('a',2,0));
  createWeaponSystem({manual:{attacking:()=>true}}).step(c2);
  const fan=[...c2.projectiles.values()].map(s=>Math.atan2((s as {vy:number}).vy,(s as {vx:number}).vx)).sort((x,y)=>x-y);
  assert.equal(fan.length,3);assert.ok(Math.abs(fan[1])<1e-9&&fan[0]<0&&fan[2]>0);
});
