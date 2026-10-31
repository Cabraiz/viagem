/**
 * NEW-20261031-ORQ-itens-sem-nascer-colados (the user, 31/10: "E itens não podem ficar tão próximos assim, eles tão
 * nascendo um sobre o outro"): on the real city, 200 seeds × 4 heroes × 10 rounds, no two ground items (crates, the
 * overflow items, GROUND_ITEMS) ever closer than ITEM_MIN_GAP, checked on every tick. Every crate source runs: the
 * placed and start ones, the near ones, the first minute's trail, the visible floor, the respawn, and the drops (an
 * elite's beside another crate, a nest's, the chefe's in round 10), each dropped right on top of a live item.
 * Result asserts only (D-031).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {Rng} from '../../src/contract/rng.ts';
import {BASE_STATS} from '../../src/contract/types.ts';
import type {EnemyState,PickupState,SimEvent,SimPlayer,SpatialIndex,TeamProgress,RoundState} from '../../src/contract/types.ts';
import type {SimContext} from '../../src/sim/context.ts';
import {createTeamProgress} from '../../src/sim/progression.ts';
import {cityTerrainFrom} from '../../src/maps/city/terrain.ts';
import {cityAsField,walkable} from '../../src/maps/index.ts';
import {cityLoot} from '../../src/sim/stonewards/loot.ts';
import {cityUnoStart} from '../../src/sim/city/uno-start.ts';
import {cityTerrainOf} from '../../src/sim/city/grid.ts';
import {OPEN_REACH,VISIBLE_FLOOR,createCrates} from '../../src/sim/crates.ts';
import {GROUND_ITEMS,ITEM_MIN_GAP} from '../../src/sim/crates-gap.ts';
import {INVENTORY_SLOTS} from '../../src/sim/inventory.ts';

const fromRoot=(path:string)=>fileURLToPath(new URL(`../../${path}`,import.meta.url));
const manifest=JSON.parse(readFileSync(fromRoot('public/maps/cidade-nevada.manifest.json'),'utf8')) as {hash:string};
const loaded=await cityTerrainFrom(readFileSync(fromRoot('public/maps/cidade-nevada.json'),'utf8'),manifest.hash);
if(!loaded.ok)throw new Error(loaded.error);
const city=loaded.terrain,field=cityAsField(city),loot=cityLoot(field)!,uno=cityUnoStart(city);

type FakeCtx=SimContext&{tick:number;players:Map<string,SimPlayer>;events:SimEvent[];team:TeamProgress;round:RoundState};
function naiveIndex<T extends {x:number;y:number;id:string}>():SpatialIndex<T>{
  let items:T[]=[];
  return {rebuild(src){items=[...src];},query(x,y,r,out=[]){for(const i of items)if(Math.hypot(i.x-x,i.y-y)<=r)out.push(i);return out;},nearest:()=>undefined};
}
function makeCtx(seed:number):FakeCtx{
  const counters=new Map<string,number>(),events:SimEvent[]=[];
  return {
    tick:0,runStartTick:0,terrain:field,rng:new Rng(seed),players:new Map(),enemies:new Map(),pickups:new Map(),projectiles:new Map(),
    telegraphs:new Map(),team:createTeamProgress(),offers:new Map(),round:{index:1,total:10,phase:'wave',phaseEndsTick:0,remaining:0},
    enemyIndex:naiveIndex<EnemyState>(),
    nextId:(prefix:string)=>{const n=(counters.get(prefix)??0)+1;counters.set(prefix,n);return `${prefix}-${n}`;},
    emit:(e:SimEvent)=>{events.push(e);},damageEnemy:()=>false,damagePlayer:()=>{},events,
  } as FakeCtx;
}
/** A hero with a full inventory from round 3 (what he opens then overflows to the ground, inventory.ts dropItem). */
const hero=(id:string,x:number,y:number):SimPlayer=>({id,classId:'turista',x,y,hp:100,online:true,spectator:false,facing:{x:1,y:0},
  build:{weapons:[{id:'faca',level:1}],passives:[],hand:0},stats:{...BASE_STATS},weaponReady:{}});
const fill=(p:SimPlayer)=>{while(p.build.weapons.length<INVENTORY_SLOTS)p.build.weapons.push({id:'faca',level:1});};
/** The closest pair of ground items, squared, and who. */
function closest(pickups:ReadonlyMap<string,PickupState>){
  const g=[...pickups.values()].filter(p=>GROUND_ITEMS.has(p.kind));
  let best=Infinity,pair='';
  for(let i=0;i<g.length;i++)for(let j=i+1;j<g.length;j++){
    const d=(g[i].x-g[j].x)**2+(g[i].y-g[j].y)**2;
    if(d<best){best=d;pair=`${g[i].id}@${g[i].x},${g[i].y} ${g[j].id}@${g[j].x},${g[j].y}`;}
  }
  return {d:Math.sqrt(best),pair};
}

const SEEDS=200,HEROES=4,ROUNDS=10,WAVE_TICKS=120,PREPARE_TICKS=30,STEP=.25;

test(`${SEEDS} seeds × ${HEROES} heroes × ${ROUNDS} rounds on the real city: no two ground items within ITEM_MIN_GAP, on every tick`,t=>{
  assert.ok(cityTerrainOf(field),'the real city');
  let worst=Infinity,drops=0,items=0,born=0,opened=0;
  for(let seed=1;seed<=SEEDS;seed++){
    const ctx=makeCtx(seed),rng=new Rng(seed*31+7);
    const crates=createCrates({mapCrates:true,seed,visibleFloor:VISIBLE_FLOOR,points:loot.crates.map(c=>({x:c.node.x,y:c.node.y,seconds:c.seconds})),
      startPoints:loot.aroundUno,trailSpot:(at,heading,ahead,r)=>loot.spotAhead(at,heading,ahead,r)});
    // The team spawns in a block beside the Uno (sim/city/uno-start.ts).
    for(let i=0;i<HEROES;i++){const p=hero(`p${i}`,uno.x+(i%3)*.7,uno.y+Math.floor(i/3)*.7);ctx.players.set(p.id,p);}
    const seen=new Set<string>();
    for(let round=1;round<=ROUNDS;round++){
      ctx.round.index=round;
      if(round===3)for(const p of ctx.players.values())fill(p);
      for(let k=0;k<WAVE_TICKS+PREPARE_TICKS;k++){
        ctx.round.phase=k<WAVE_TICKS?'wave':'prepare';
        // Each hero walks to his nearest crate and stands by it (opening it), else wanders.
        for(const p of ctx.players.values()){
          let goal:PickupState|undefined,gd=Infinity;
          for(const c of ctx.pickups.values())if(c.kind==='chest'){const d=Math.hypot(c.x-p.x,c.y-p.y);if(d<gd){gd=d;goal=c;}}
          if(goal&&gd<=OPEN_REACH-.4)continue;
          const a=goal&&rng.next()<.8?Math.atan2(goal.y-p.y,goal.x-p.x):rng.next()*2*Math.PI;
          const next={x:p.x+Math.cos(a)*STEP,y:p.y+Math.sin(a)*STEP};
          if(walkable(next,city)){p.x=next.x;p.y=next.y;}
        }
        // The drops, each right on top of a live item: an elite's now and then, a nest's, and the chefe's at round 10.
        const live=[...ctx.pickups.values()].filter(p=>GROUND_ITEMS.has(p.kind));
        const on=live.length?live[Math.floor(rng.next()*live.length)]!:ctx.players.get('p0')!;
        if(k%60===30){crates.dropCrate(ctx,{x:on.x+.3,y:on.y-.2},3);drops++;}
        if(k===WAVE_TICKS-1&&round%3===0){crates.dropCrate(ctx,{x:on.x,y:on.y},4);drops++;}
        if(k===WAVE_TICKS-1&&round===ROUNDS){crates.dropCrate(ctx,{x:on.x-.1,y:on.y},5);crates.dropCrate(ctx,{x:on.x,y:on.y+.1},5);drops+=2;}
        crates.step(ctx);ctx.tick++;
        for(const e of ctx.events.splice(0))if(e.type==='pickup'&&e.kind==='chest')opened++;
        for(const p of ctx.pickups.values())if(!seen.has(p.id)){seen.add(p.id);born++;if(p.kind==='item')items++;}
        const c=closest(ctx.pickups);
        worst=Math.min(worst,c.d);
        if(c.d<ITEM_MIN_GAP-1e-9)assert.fail(`seed ${seed} round ${round} tick ${ctx.tick}: ${c.d.toFixed(2)} u (${c.pair})`);
      }
    }
  }
  t.diagnostic(`${born} born, ${opened} opened (${items} overflow items, ${drops} drops on top of another), closest pair ever ${worst.toFixed(2)} u`);
  assert.ok(opened>0&&drops>0&&items>0,'the heroes opened crates, the drops and the overflow ran');
});
