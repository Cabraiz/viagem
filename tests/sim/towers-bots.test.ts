/**
 * torres-sim: the bots build and evolve the tower defense.
 *  1. pickTowerOrder (bot-brain.ts), the forger's rule: grow the count, evolve the lowest tier, branches by a fixed
 *     rule (A4b on a small site, the rail before the Gustavão), save when the step costs more than the balance.
 *  2. decide(): with BrainInput.towers the forger orders towers before the forge (a needed repair still first);
 *     without it (the room bots today) the decision is the same as before.
 *  3. Headless city run (real asset, Simulation + RoomBots): the forger's rule played on the structures system, as the
 *     bench does (scripts/bench-city-run.ts); the bots build roots and evolve them along branches; same seed, same
 *     defenses.
 * D-031: results only.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {Simulation} from '../../multiplayer/simulation.ts';
import {BOT_FORGE_LEFT,RoomBots} from '../../multiplayer/room-bots.ts';
import {cityTerrainFrom} from '../../src/maps/city/terrain.ts';
import {ticks} from '../../src/contract/types.ts';
import type {RunView} from '../../src/contract/index.ts';
import {BOT_BRANCHES,REPAIR_BELOW,decide,newMemory,pickTowerOrder,towerBrainView,type TowerBrainView} from '../../src/sim/bot-brain.ts';
import {isStanding} from '../../src/sim/revive.ts';
import {DEFENSES,type DefenseId} from '../../src/sim/towers/catalog.ts';
import {RECIPES,canPay} from '../../src/rules/index.ts';

const fromRoot=(path:string)=>fileURLToPath(new URL(`../../${path}`,import.meta.url));
const loaded=await cityTerrainFrom(readFileSync(fromRoot('public/maps/cidade-nevada.json'),'utf8'),
  (JSON.parse(readFileSync(fromRoot('public/maps/cidade-nevada.manifest.json'),'utf8')) as {hash:string}).hash);
if(!loaded.ok)throw new Error(loaded.error);
const city=loaded.terrain;

type Def=TowerBrainView['defenses'][number];
const view=(over:Partial<TowerBrainView>={}):TowerBrainView=>({tick:100,round:2,units:100,
  sites:[{id:'s1',maxSize:2},{id:'s2',maxSize:3},{id:'s3',maxSize:3},{id:'s4',maxSize:1}],rail:'trilho',railLaid:false,railReady:false,gustavoes:0,defenses:[],...over});
const def=(id:string,kind:DefenseId,site:string,extra:Partial<Def>={}):Def=>({id,kind,site,ready:true,ruined:false,...extra});

test('pickTowerOrder: two roots first, then evolve when the balance pays, else grow to round + 1, else save',()=>{
  assert.deepEqual(pickTowerOrder(view()),{build:'s2'},'the largest free site first');
  assert.equal(pickTowerOrder(view({units:5})),'save','6 needed for a root');
  const one=[def('d1','vigia-do-predio','s2')];
  assert.deepEqual(pickTowerOrder(view({defenses:one})),{build:'s3'},'a second root before any evolution');
  const two=[def('d1','vigia-do-predio','s2'),def('d2','vigia-do-predio','s3')];
  assert.deepEqual(pickTowerOrder(view({defenses:two})),{upgrade:'d1',branch:BOT_BRANCHES[1]},'evolve when it pays (site index 1 → B)');
  assert.deepEqual(pickTowerOrder(view({defenses:two,units:8})),{build:'s1'},'short of an evolution: another root, up to round + 1');
  assert.equal(pickTowerOrder(view({defenses:[...two,def('d3','vigia-do-predio','s1')],units:8})),'save','round 2: 3 stand, save for the evolution');
});

test('pickTowerOrder: branches by site index, A4b on a small site, rail before the Gustavão, nothing left → undefined',()=>{
  const v=(defenses:Def[],over:Partial<TowerBrainView>={})=>view({round:1,defenses,...over});
  assert.deepEqual(pickTowerOrder(v([def('a','vigia-do-predio','s1'),def('b','vigia-do-predio','s2')])),{upgrade:'a',branch:'A'},'site 0 → A');
  assert.deepEqual(pickTowerOrder(v([def('a','vigias-armados','s1'),def('b','vigia-do-predio','s2')])),{upgrade:'b',branch:'B'},'lowest tier first; site 1 → B');
  assert.deepEqual(pickTowerOrder(v([def('a','atiradores-do-telhado','s1'),def('b','atiradores-do-telhado','s2')])),{upgrade:'a',branch:'ninho-do-sniper'},'A3 on a size-2 site → A4b');
  assert.deepEqual(pickTowerOrder(v([def('b','atiradores-do-telhado','s2'),def('a','posto-de-radar','s1')])),{upgrade:'b',branch:'ninho-de-metralhadora'},'A3 on a size-3 site → A4');
  assert.deepEqual(pickTowerOrder(v([def('a','vigia-do-predio','s4'),def('b','posto-de-radar','s2')])),{upgrade:'a',branch:'C'},'a 1×1 site skips A (2×2) for the next branch that fits');
  const howitzer=[def('h','obuseiro','s2'),def('x','posto-de-radar','s3')];
  assert.deepEqual(pickTowerOrder(v(howitzer)),{build:'trilho'},'the rail first');
  assert.equal(pickTowerOrder(v(howitzer,{railLaid:true,sites:[{id:'s2',maxSize:3},{id:'s3',maxSize:3}]})),undefined,'the rail still being laid, nothing else');
  assert.deepEqual(pickTowerOrder(v(howitzer,{railLaid:true,railReady:true})),{upgrade:'h'},'then the Gustavão');
  assert.equal(pickTowerOrder(v(howitzer,{railLaid:true,railReady:true,gustavoes:1,sites:[{id:'s2',maxSize:3},{id:'s3',maxSize:3}]})),undefined,'one per run; all maxed');
  assert.equal(pickTowerOrder(v(howitzer,{rail:null,sites:[{id:'s2',maxSize:3},{id:'s3',maxSize:3}]})),undefined,'no rail on this map: no Gustavão');
  assert.equal(pickTowerOrder(v([def('a','vigia-do-predio','s2',{ready:false}),def('b','vigia-do-predio','s3',{ready:false})],{sites:[{id:'s2',maxSize:3},{id:'s3',maxSize:3}]})),undefined,'obras running');
});

test('decide(): the forger orders towers before the forge; without towers nothing changes',()=>{
  const me={id:'bot',online:true,spectator:false,downed:false,eliminated:false,hp:100,maxHp:100,x:0,y:1} as unknown as RunView['players'][number];
  const runView=(wallHp:number)=>({tick:500,round:{index:3,total:10,phase:'prepare',phaseEndsTick:600,remaining:0},players:[me],
    structures:[{id:'muralha',kind:'muralha',x:0,y:0,hp:wallHp,maxHp:600}],camp:{coco:10,pedra:10},nodes:[],offers:[],telegraphs:[],enemies:[],projectiles:[],pickups:[]}) as unknown as RunView;
  const input=(towers?:TowerBrainView,wallHp=600)=>({view:runView(wallHp),selfId:'bot',at:{x:0,y:1},index:0,memory:newMemory(0),...(towers?{towers}:{})});
  const plain=decide(input());
  assert.equal(plain.forge,'torre-chinelo','the forge as before');assert.equal(plain.build,undefined);
  const withTowers=decide(input(view({units:20})));
  assert.deepEqual(withTowers.build,{build:'s2'});assert.equal(withTowers.forge,undefined,'the forge waits');
  const saving=decide(input(view({units:3})));
  assert.equal(saving.build,undefined);assert.equal(saving.forge,undefined,'saving for the tower holds the forge');
  const hurt=decide(input(view({units:20}),300));
  assert.equal(hurt.forge,'reparo','a needed repair still goes first');assert.equal(hurt.build,undefined);
  const done=decide(input(view({sites:[],rail:null})));
  assert.equal(done.forge,'torre-chinelo','nothing to do with towers: the forge as before');
});

/** A real city run with `count` room bots, the forger's tower rule played as the bench does. */
function cityRun(seed:number,count:number,untilRound:number){
  const sim=new Simulation(seed,{world:'cidade',terrain:city}),bots=new RoomBots();
  sim.botState=()=>bots.state();
  const ids=Array.from({length:count},(_,i)=>`bot-${i+1}`);
  ids.forEach((id,i)=>{sim.addBot(id,id,['cidadao-comum','clt-cansado','feirante'][i%3]);bots.add(id,i);});
  sim.resetRun();
  const orders:string[]=[];let last=-1e9;
  const rule=()=>{
    const w=sim.world,round=w.round,s=sim.run.stonewards;
    if(round.phase!=='prepare'||round.index<2||round.phaseEndsTick-w.tick>BOT_FORGE_LEFT||s.state.wallDown)return undefined;
    if(s.state.wall.hp<s.state.wall.maxHp*REPAIR_BELOW&&canPay(s.state.balance,RECIPES.reparo.cost))return undefined;
    return pickTowerOrder(towerBrainView(s.state,s.plan,w.tick,round.index));
  };
  const forge=sim.forge.bind(sim);
  sim.forge=(id,recipe,req,target)=>recipe!=='reparo'&&rule()!==undefined?{ok:false,reason:'balance'}:forge(id,recipe,req,target);
  while(!sim.outcome&&!(sim.world.round.index>=untilRound&&sim.world.round.phase==='wave')&&sim.tick<ticks(25*60)){
    const order=rule();
    if(order&&order!=='save'&&sim.tick-last>=20){
      const forger=ids.find(id=>{const p=sim.players.get(id);return !!p&&isStanding(p);});
      if(forger){
        last=sim.tick;
        const s=sim.run.stonewards,r='build' in order?s.build(sim.world,forger,order.build):s.upgrade(sim.world,forger,order.upgrade,order.branch);
        orders.push(`${sim.world.round.index}:${'build' in order?`build ${order.build}`:`up ${order.upgrade} ${order.branch??''}`} → ${r.ok?r.kind:r.reason}`);
      }
    }
    bots.think(sim);sim.step();
  }
  return {sim,orders,state:sim.run.stonewards.state};
}

test('headless city run: the bots build roots and evolve them along branches; same seed, same defenses',()=>{
  const a=cityRun(3,3,6);
  const list=a.state.defenses?.list??[];
  console.log(`[torres-sim] 3 bots, seed 3, to round ${a.sim.world.round.index}: ${list.map(d=>`${d.site} ${DEFENSES[d.kind].label}${d.ruined?' (ruína)':''}`).join(', ')}\n  orders: ${a.orders.join(' | ')}`);
  assert.ok(list.length>=3,`${list.length} defenses built`);
  assert.ok(list.some(d=>DEFENSES[d.kind].tier>=2),'at least one evolved past the root');
  assert.ok(new Set(list.filter(d=>DEFENSES[d.kind].branch).map(d=>DEFENSES[d.kind].branch)).size>=2,'more than one branch taken');
  assert.ok(a.orders.every(o=>!o.endsWith('→ phase')&&!o.endsWith('→ player')),'orders only in the intermission, by a standing bot');
  const b=cityRun(3,3,6);
  assert.deepEqual(JSON.parse(JSON.stringify(b.state.defenses)),JSON.parse(JSON.stringify(a.state.defenses)));
  assert.equal(b.sim.stateHash(),a.sim.stateHash());
});

test('bot-gasta-material: a defense a person here built is never the bot\'s to evolve; it still counts on the map',()=>{
  const two=[{...def('d1','vigia-do-predio','s2'),person:true},def('d2','vigia-do-predio','s3')];
  assert.deepEqual(pickTowerOrder(view({defenses:two})),{upgrade:'d2',branch:BOT_BRANCHES[2]},'the bot evolves its own, not the person\'s d1');
  const theirs=[{...def('d1','vigia-do-predio','s2'),person:true},{...def('d2','vigia-do-predio','s3'),person:true}];
  const order=pickTowerOrder(view({defenses:theirs}));
  assert.ok(!(order&&typeof order==='object'&&'upgrade' in order),'nothing of theirs evolved');
});
