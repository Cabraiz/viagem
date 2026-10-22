// NEW-20261022-ORQ-melee-alcance-2x, three combat asks of the user (22/10): "duplique o alcance do ataque melee" (the
// faca reaches 2.6 u, not 1.3; the critters keep theirs), "remova esse poder" (the Silenciador de Garagem never shows in
// the level cards) and "aumente tamanho do projétil default em 5x" (the pistola's bullet drawn ×5, look only).
import test from 'node:test';
import assert from 'node:assert/strict';
import {Rng} from '../../src/contract/rng.ts';
import {BASE_STATS} from '../../src/contract/types.ts';
import type {EnemyState,EnemyView,SimEvent,SimPlayer,SpatialIndex} from '../../src/contract/types.ts';
import type {SimContext} from '../../src/sim/context.ts';
import type {TerrainField} from '../../src/maps/terrain/field.ts';
import {createWeaponSystem,manualReach} from '../../src/sim/weapons/system.ts';
import {FACA_REACH,NEW_WEAPONS} from '../../src/sim/weapons/arsenal.ts';
import {getWeapon,resolveWeapon} from '../../src/sim/weapons/catalog.ts';
import {attackReach,siegeStand} from '../../src/sim/bot-brain.ts';
import {ITEMS,MANUAL_ITEMS} from '../../src/sim/items.ts';
import {PASSIVE_IDS,rollChoices} from '../../src/rules/index.ts';
import {MELEE_CONES} from '../../src/client/render/melee-cone.ts';
import {DEFAULT_SHOT_DRAW_SCALE,FIRE_LOOK,SLASH_AHEAD,shotDrawScale} from '../../src/client/render/arsenal-rules.ts';
import {itemDisplay} from '../../src/client/hud/items.ts';

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
function swingAt(distance:number,aim?:{x:number;y:number}){
  const ctx=makeCtx();
  const p:SimPlayer={id:'p1',classId:'x',x:10,y:10,hp:100,online:true,spectator:false,facing:{x:1,y:0},
    build:{weapons:[{id:'faca',level:1}],passives:[]},stats:{...BASE_STATS},weaponReady:{},...(aim?{aim}:{})};
  ctx.players.set(p.id,p);
  const e:EnemyState={id:'e1',kind:'mosquito',x:10+distance,y:10,hp:1e6,maxHp:1e6,speed:0,damage:0,radius:.3,xp:1,spawnTick:0,readyTick:0};
  ctx.enemies.set(e.id,e);
  const sys=createWeaponSystem({manual:{attacking:()=>true}});
  ctx.tick++;ctx.enemyIndex.rebuild(ctx.enemies.values());sys.step(ctx);
  return e.hp<e.maxHp;
}

test('the faca reaches 1.3 × 2 at every rarity, and the client\'s cone is the same',()=>{
  assert.equal(FACA_REACH,2.6);
  const faca=NEW_WEAPONS.find(w=>w.id==='faca')!;
  for(const row of faca.levels){assert.equal(row.area,FACA_REACH);assert.equal(row.range,FACA_REACH);}
  assert.equal(MELEE_CONES.faca.area,FACA_REACH);
  assert.deepEqual(manualReach(resolveWeapon(getWeapon('faca')!,1,BASE_STATS)),{reach:FACA_REACH,pad:true});
  // The other cones (firearms) did not change.
  assert.equal(NEW_WEAPONS.find(w=>w.id==='escopeta')!.levels[0].area,4);
  assert.equal(NEW_WEAPONS.find(w=>w.id==='macarico')!.levels[0].area,3.5);
});

test('a swing strikes a critter at 2.4 u (out of the old 1.3 + its radius) and not one past 2.6 + its radius',()=>{
  assert.equal(swingAt(2.4),true,'auto aim (phone, bot): in the new reach');
  assert.equal(swingAt(2.4,{x:1,y:0}),true,'mouse aim (PC): in the new reach');
  assert.equal(swingAt(1.5),true);
  assert.equal(swingAt(3),false,'past 2.6 + .3');
});

test('the bots hold the attack and stand at the new reach',()=>{
  const me={weapons:[{id:'faca',level:1}],hand:0};
  const at=(x:number)=>[{id:'e',kind:'mosquito',x,y:0,hp:5,maxHp:5,radius:.3} as unknown as EnemyView];
  assert.equal(attackReach(me,{x:0,y:0},at(2.5)),true);
  assert.equal(attackReach(me,{x:0,y:0},at(3.1)),false);
  assert.ok(siegeStand([{id:'faca',level:1}])>1.3,'they no longer hug the siege to cut');
});

test('the faca\'s slash on screen is twice its old size and twice as far out',()=>{
  assert.equal(FIRE_LOOK.faca.size,140);assert.equal(SLASH_AHEAD,1);
});

test('the Silenciador de Garagem is gone: never in a level card, not in the catalog, no HUD entry',()=>{
  assert.equal((PASSIVE_IDS as readonly string[]).includes('silenciador'),false);
  assert.equal(MANUAL_ITEMS.get('silenciador'),undefined);assert.equal(ITEMS.get('silenciador'),undefined);
  assert.notEqual(itemDisplay('silenciador').name,'Silenciador de Garagem');
  const rng=new Rng(7);
  for(let i=0;i<2000;i++){
    const build={weapons:[],passives:i%2?[{id:'pente',level:1}]:[]};
    for(const c of rollChoices(MANUAL_ITEMS,build,1+(i%3),rng))assert.notEqual(c.itemId,'silenciador');
  }
});

test('the heroes\' default shot (the pistola\'s bullet) is drawn 5× bigger; other shots and the critters\' are not',()=>{
  assert.equal(DEFAULT_SHOT_DRAW_SCALE,5);
  assert.equal(shotDrawScale(false,'pistola'),5);
  assert.equal(shotDrawScale(true,'pistola'),1,'a reflected shot reads as hostile and keeps its size');
  for(const s of ['rifle','submetralhadora','rojao','chinelo','boleto-juros'])assert.equal(shotDrawScale(false,s),1,s);
  assert.equal(shotDrawScale(true,'boleto-juros'),1);
});
