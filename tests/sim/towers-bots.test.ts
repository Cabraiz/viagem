/**
 * torres-sim: the bots build and evolve the tower defense.
 *  1. pickTowerOrder (bot-brain.ts), the forger's rule: grow the count, evolve the lowest tier, branches by a fixed
 *     rule (A4b on a small site, the rail before the Gustavão), save when the step costs more than the balance.
 *  2. decide(): with BrainInput.towers the forger orders towers before the forge (a needed repair still first);
 *     without it (the room bots today) the decision is the same as before.
 *  3. Headless city run (real asset, Simulation + RoomBots, as the bench plays it): the room bots walk to each obra
 *     (torres-ajustes: the sim's BUILD_REACH), build roots and evolve them; no order is refused for distance; same seed,
 *     same defenses.
 *  4. torres-ajustes: the forger repairs a danificada defense first, keeps the Gustavão's line (B → rail → B6) funded
 *     before anything else, and walks to the obra before ordering (decide mode 'build', orderFrom).
 *  5. D-048 (ficha de torre): a root only with a whole ficha (40 units), the Gustavão's 3 fichas (120) kept from the
 *     Obuseiro on (its rail is free), and in a real 6-bot run no root order without the ficha nor a forge buy below the reserve.
 * D-031: results only.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {Simulation} from '../../multiplayer/simulation.ts';
import {RoomBots} from '../../multiplayer/room-bots.ts';
import {cityTerrainFrom} from '../../src/maps/city/terrain.ts';
import {ticks} from '../../src/contract/types.ts';
import {HERO_SPEED_MULT as K} from '../../src/maps/world.ts';
import type {RunView} from '../../src/contract/index.ts';
import {BOT_BRANCHES,BOT_TOWER_REPAIR_BELOW,REPAIR_BELOW,TOWER_STAND,decide,newMemory,pickTowerOrder,towerBrainView,towerReserve,type TowerBrainView} from '../../src/sim/bot-brain.ts';
import {DEFENSES,GUSTAVAO_COST,ROOT_DEFENSE,type DefenseId} from '../../src/sim/towers/catalog.ts';
import {RECIPES,UNITS_PER_TOKEN,tokensOf,type RecipeId} from '../../src/rules/index.ts';
import {TOWER_REPAIR_COST} from '../../src/sim/towers/system.ts';
import {setRosterOnlyWithArt} from '../../src/rules/enemy-rotation.ts';
// A deterministic run script: the whole roster (ROSTER_ONLY_WITH_ART off); tests/rules/enemy-art-ids.test.ts plays art only.
setRosterOnlyWithArt(false);

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
  assert.equal(pickTowerOrder(view({units:UNITS_PER_TOKEN-1})),'save','D-048: a root is a whole ficha (40)');
  assert.deepEqual(pickTowerOrder(view({units:UNITS_PER_TOKEN})),{build:'s2'});
  const one=[def('d1','vigia-do-predio','s2')];
  assert.deepEqual(pickTowerOrder(view({defenses:one})),{build:'s3'},'a second root before any evolution');
  const two=[def('d1','vigia-do-predio','s2'),def('d2','vigia-do-predio','s3')];
  assert.deepEqual(pickTowerOrder(view({defenses:two})),{upgrade:'d1',branch:BOT_BRANCHES[1]},'evolve when it pays (site index 1 → B)');
  // An evolution (10–36) is always cheaper than a root (40): another root comes from a ficha while nothing can evolve.
  const building=two.map(d=>({...d,ready:false}));
  assert.deepEqual(pickTowerOrder(view({defenses:building,units:40})),{build:'s1'},'obras running: another root with a whole ficha, up to round + 1');
  assert.equal(pickTowerOrder(view({defenses:building,units:39})),'save','short of a ficha');
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
  assert.equal(pickTowerOrder(v(howitzer,{railLaid:true,sites:[{id:'s2',maxSize:3},{id:'s3',maxSize:3}]})),'save','the rail still being laid: saving for the Gustavão');
  assert.deepEqual(pickTowerOrder(v(howitzer,{railLaid:true,railReady:true,units:GUSTAVAO_COST})),{upgrade:'h'},'then the Gustavão (3 fichas)');
  assert.equal(pickTowerOrder(v(howitzer,{railLaid:true,railReady:true,units:GUSTAVAO_COST-1,sites:[{id:'s2',maxSize:3},{id:'s3',maxSize:3}]})),'save');
  assert.equal(pickTowerOrder(v(howitzer,{railLaid:true,railReady:true,gustavoes:1,sites:[{id:'s2',maxSize:3},{id:'s3',maxSize:3}]})),undefined,'one per run; all maxed');
  assert.equal(pickTowerOrder(v(howitzer,{rail:null,sites:[{id:'s2',maxSize:3},{id:'s3',maxSize:3}]})),undefined,'no rail on this map: no Gustavão');
  assert.equal(pickTowerOrder(v([def('a','vigia-do-predio','s2',{ready:false}),def('b','vigia-do-predio','s3',{ready:false})],{sites:[{id:'s2',maxSize:3},{id:'s3',maxSize:3}]})),undefined,'obras running');
});

test('decide(): the forger orders towers before the forge; without towers nothing changes',()=>{
  const me={id:'bot',online:true,spectator:false,downed:false,eliminated:false,hp:100,maxHp:100,x:0,y:1} as unknown as RunView['players'][number];
  const runView=(wallHp:number,units:number)=>({tick:500,round:{index:3,total:10,phase:'prepare',phaseEndsTick:600,remaining:0},players:[me],
    structures:[{id:'muralha',kind:'muralha',x:0,y:0,hp:wallHp,maxHp:600}],camp:{units},nodes:[],offers:[],telegraphs:[],enemies:[],projectiles:[],pickups:[]}) as unknown as RunView;
  const input=(towers?:TowerBrainView,wallHp=600)=>({view:runView(wallHp,towers?.units??20),selfId:'bot',at:{x:0,y:1},index:0,memory:newMemory(0),...(towers?{towers}:{})});
  const plain=decide(input());
  assert.equal(plain.forge,'torre-chinelo','the forge as before');assert.equal(plain.build,undefined);
  const withTowers=decide(input(view({units:40})));
  assert.deepEqual(withTowers.build,{build:'s2'});assert.equal(withTowers.forge,undefined,'the forge waits');
  // D-048: the forge's 5–7 unit buys would never let the pile reach a ficha, so the first roots' ficha is kept.
  const first=decide(input(view({units:20})));
  assert.equal(first.build,undefined);assert.equal(first.forge,undefined,'saving for the first roots holds the forge');
  // torres-ajustes: past them, saving holds only the Gustavão line's reserve (none on a map without a rail).
  const third=decide(input(view({units:20,rail:null,defenses:[def('d1','vigia-do-predio','s2',{ready:false}),def('d2','vigia-do-predio','s3',{ready:false})]})));
  assert.equal(third.build,undefined);assert.equal(third.forge,'torre-chinelo','saving for a third root does not hold the forge');
  const hurt=decide(input(view({units:20}),300));
  // pickRecipe's top-up reparo (the wall over REPAIR_BELOW) is not a needed one: it waits for the ficha like the rest.
  assert.equal(decide(input(view({units:20}),600*REPAIR_BELOW+1)).forge,undefined,'a top-up does not eat the reserve');
  assert.equal(hurt.forge,'reparo','a needed repair still goes first');assert.equal(hurt.build,undefined);
  const done=decide(input(view({sites:[],rail:null})));
  assert.equal(done.forge,'torre-chinelo','nothing to do with towers: the forge as before');
});

test('pickTowerOrder: a danificada defense is repaired first; the Gustavão line is funded before the rest',()=>{
  const v=(defenses:Def[],over:Partial<TowerBrainView>={})=>view({round:4,defenses,...over});
  const hurt=def('h','vigias-armados','s1',{hp:200,maxHp:550}),ok=def('k','rojao-de-festa','s2',{hp:340,maxHp:350});
  assert.ok(200/550<=BOT_TOWER_REPAIR_BELOW);
  assert.deepEqual(pickTowerOrder(v([ok,hurt])),{repair:'h'},'the most hurt at or under 50 %');
  assert.notDeepEqual(pickTowerOrder(v([ok,hurt],{units:TOWER_REPAIR_COST-1})),{repair:'h'},'not without the material');
  // The B line (the Rojão on s2) takes its step before the A2 on s1 (same tier, which plan order would pick first).
  const line=[def('a','vigias-armados','s1'),def('b','rojao-de-festa','s2')];
  assert.deepEqual(pickTowerOrder(v(line,{units:16})),{upgrade:'b'},'B2 → B3 (16) before A2 → A3');
  // While the line saves (B3 → B4 costs 24), the rest spends only what is left over.
  const saving=[def('a','vigias-armados','s1'),def('b','morteiro','s2')];
  assert.equal(pickTowerOrder(v(saving,{units:20})),'save','24 kept for the Lança-Foguetes: nothing else');
  assert.deepEqual(pickTowerOrder(v(saving,{units:24+16})),{upgrade:'b'},'the line first when it pays');
  const busy=[def('a','vigias-armados','s1'),def('b','morteiro','s2',{ready:false})];
  const idle=[def('a','vigias-armados','s1',{ready:false}),def('b','morteiro','s2',{ready:false})];
  assert.deepEqual(pickTowerOrder(v(idle,{units:24+40})),{build:'s3'},'the line is building: 24 kept, the ficha left over builds a root');
  assert.equal(pickTowerOrder(v(idle,{units:24+39})),'save','not a whole ficha over the 24');
  assert.deepEqual(pickTowerOrder(v(busy,{units:24+16})),{upgrade:'a'},'16 left over: A2 → A3');
  // A B line stuck on a size-2 site (B4 needs 3×3) keeps nothing aside.
  const stuck=[def('a','vigias-armados','s2'),def('b','morteiro','s1')];
  assert.deepEqual(pickTowerOrder(v(stuck,{units:16})),{upgrade:'a'},'A2 → A3 with all of it');
  // Once a Gustavão stands (or fell), no line is kept.
  assert.equal(pickTowerOrder(v([def('g','gustavao','trilho'),def('o','obuseiro','s2')],{gustavoes:1,railLaid:true,railReady:true,sites:[{id:'s2',maxSize:3}]})),undefined);
});

test('decide(): the builder walks to the obra (mode build), orders on arrival, and only takes a trip there and back that fits',()=>{
  const me={id:'bot',online:true,spectator:false,downed:false,eliminated:false,hp:100,maxHp:100,x:0,y:1} as unknown as RunView['players'][number];
  // The round starts 30 s after `tick`; the wall (home) at the origin; a crate to gather at.
  const runView=(tick:number,camp={units:40})=>({tick,round:{index:3,total:10,phase:'prepare',phaseEndsTick:tick+30*20,remaining:0},players:[me],
    structures:[{id:'muralha',kind:'muralha',x:0,y:0,hp:600,maxHp:600}],camp,nodes:[{id:'n1',kind:'coco',x:-6,y:0,remaining:5}],offers:[],telegraphs:[],enemies:[],projectiles:[],pickups:[]}) as unknown as RunView;
  const sites=[{id:'s1',maxSize:3,x:10,y:1}];
  const run=(at:{x:number;y:number},over:Partial<TowerBrainView>={},tick=500,forger?:string)=>decide({view:runView(tick),selfId:'bot',at,index:0,memory:newMemory(0),
    ...(forger===undefined?{}:{forger}),towers:view({tick,units:40,sites,...over})});
  const far=run({x:0,y:1});
  assert.equal(far.mode,'build');assert.equal(far.build,undefined,'too far to order');
  assert.ok(far.direction.x>.9,'heads for the site');
  const near=run({x:10-TOWER_STAND+.2,y:1});
  assert.equal(near.mode,'build');assert.deepEqual(near.build,{build:'s1'},'no person here: it orders as soon as it is there');
  assert.deepEqual(near.direction,{x:0,y:0},'stands there');
  // The way back counts: a site 30 u out fits (there, back into the camp, TOWER_MARGIN), one 40 u out does not. The
  // distances at the base walk, × K (maps HERO_SPEED_MULT, velocidade-heroi-e-projetil): the bot times the real walk.
  assert.equal(run({x:0,y:1},{sites:[{id:'s1',maxSize:3,x:30*K,y:1}]}).mode,'build');
  assert.notEqual(run({x:0,y:1},{sites:[{id:'s1',maxSize:3,x:40*K,y:1}]}).mode,'build','the walk there fits, there and back does not');
  assert.notEqual(run({x:0,y:1},{sites:[{id:'s1',maxSize:3,x:200*K,y:1}]}).mode,'build');
  // Standing at an obra whose way back no longer fits: no order, it heads home.
  const late=run({x:80*K,y:1},{sites:[{id:'s1',maxSize:3,x:80*K,y:1}]});
  assert.equal(late.build,undefined);assert.ok(late.direction.x<-.9,'home');
  // An unreachable obra does not block the rest: the next site that fits is taken.
  const two=[{id:'s1',maxSize:3,x:200*K,y:1},{id:'s2',maxSize:2,x:-8,y:1}];
  assert.deepEqual(run({x:-8,y:1},{sites:two}).build,{build:'s2'});
  // With a person here (orderFrom: their last 5 s): it waits at the obra and orders from then, if the way back fits.
  const home={id:'s1',maxSize:3,x:4,y:1};
  assert.equal(run({x:4,y:1},{sites:[home],orderFrom:1000}).build,undefined,'waits for its window');
  assert.equal(run({x:4,y:1},{sites:[home],orderFrom:1000}).mode,'build');
  assert.deepEqual(run({x:4,y:1},{sites:[home],orderFrom:1000},1000).build,{build:'s1'},'in the window');
  assert.notEqual(run({x:9,y:1},{orderFrom:1000}).mode,'build','9 u out: 5 s are not enough to get back');
  assert.equal(run({x:0,y:1},{sites:[home],orderFrom:1000}).mode,'gather','keeps gathering until the walk there ends near the window');
  // Saving for the Gustavão's line holds only its reserve: the forge buys with what is above it.
  // The line's Morteiro is building (nothing to order there) and the other defense is out of reach: 'save', 24 kept.
  const line=[def('d1','morteiro','s1',{x:10,y:1,ready:false}),def('d2','vigia-do-predio','s2',{x:-50*K,y:1})];
  const saving=(units:number)=>decide({view:runView(500,{units}),selfId:'bot',at:{x:0,y:1},index:0,memory:newMemory(0),forger:'bot',
    towers:view({units,sites:[{id:'s1',maxSize:3,x:10,y:1},{id:'s2',maxSize:2,x:-50*K,y:1}],defenses:line,round:2})});
  assert.equal(saving(30).forge,undefined,'24 kept for the Lança-Foguetes: 6 left, no recipe fits above it');
  assert.equal(saving(22).forge,undefined);
  assert.equal(saving(40).forge,'torre-chinelo','40 − 7 still leaves the 24');
});

test('person rules: the bots never repair, evolve nor push the Gustavão line on a person\'s defense',()=>{
  const v=(defenses:Def[],over:Partial<TowerBrainView>={})=>view({round:4,defenses,...over});
  const theirs={...def('p','vigias-armados','s1',{hp:100,maxHp:550}),person:true};
  assert.notDeepEqual(pickTowerOrder(v([theirs,def('k','rojao-de-festa','s2')])),{repair:'p'},'a person\'s hurt defense is theirs to repair');
  // A person's B defense is not the bots' line: nothing is kept aside for it, nor is it evolved.
  const personB={...def('b','morteiro','s2'),person:true},mine=def('a','vigias-armados','s1');
  assert.deepEqual(pickTowerOrder(v([mine,personB],{units:16})),{upgrade:'a'},'the A2 → A3 with all of it: no reserve for their Morteiro');
  assert.equal(towerReserve(v([mine,personB])),40,'not their Morteiro: only a root ficha kept, to start the bots line');
  assert.equal(towerReserve(v([mine,def('b','morteiro','s2')])),24,'the bots\' own Morteiro: its Lança-Foguetes kept aside');
});

/**
 * A real city run with `count` room bots (RoomBots builds since torres-fio), every tower order they give logged with the
 * units before it, and every forge buy with the units after it and the towers' reserve then (decide keeps it).
 */
function cityRun(seed:number,count:number,untilRound:number){
  const sim=new Simulation(seed,{world:'cidade',terrain:city}),bots=new RoomBots();
  sim.botState=()=>bots.state();
  const ids=Array.from({length:count},(_,i)=>`bot-${i+1}`);
  ids.forEach((id,i)=>{sim.addBot(id,id,['cidadao-comum','clt-cansado','feirante'][i%3]);bots.add(id,i);});
  sim.resetRun();
  const orders:string[]=[],units:number[]=[],forges:{recipe:RecipeId;after:number;reserve:number;needed:boolean}[]=[];
  const st=()=>sim.run.stonewards;
  const log=<R extends {ok:boolean;kind?:string;reason?:string}>(what:string,run:()=>R)=>{
    const before=st().state.balance.units,r=run();
    orders.push(`${sim.world.round.index}:${what} → ${r.ok?r.kind:r.reason}`);units.push(before);return r;
  };
  const build=sim.build.bind(sim),upgrade=sim.upgrade.bind(sim),repair=sim.repair.bind(sim),forge=sim.forge.bind(sim);
  sim.build=(id,site,req)=>log(`build ${site}`,()=>build(id,site,req));
  sim.upgrade=(id,d,branch,req)=>log(`up ${d} ${branch??''}`,()=>upgrade(id,d,branch,req));
  sim.repair=(id,d,req)=>log(`repair ${d}`,()=>repair(id,d,req));
  sim.forge=(id,recipe,req)=>{
    const s=st(),wall=s.state.wall,reserve=towerReserve(towerBrainView(s.state,s.plan,sim.tick,sim.world.round.index));
    const needed=recipe==='reparo'&&wall.hp<wall.maxHp*REPAIR_BELOW,r=forge(id,recipe,req);
    if(r.ok)forges.push({recipe:recipe as RecipeId,after:s.state.balance.units,reserve,needed});
    return r;
  };
  while(!sim.outcome&&!(sim.world.round.index>=untilRound&&sim.world.round.phase==='wave')&&sim.tick<ticks(25*60)){bots.think(sim);sim.step();}
  return {sim,orders,units,forges,state:sim.run.stonewards.state};
}

test('headless city run: the room bots walk to the obras, build roots and evolve them; never refused for distance; same seed, same defenses',()=>{
  const a=cityRun(3,3,6);
  const list=a.state.defenses?.list??[];
  console.log(`[torres-ajustes] 3 bots, seed 3, to round ${a.sim.world.round.index}: ${list.map(d=>`${d.site} ${DEFENSES[d.kind].label}${d.ruined?' (ruína)':''}`).join(', ')}\n  orders: ${a.orders.join(' | ')}`);
  // torres-ajustes: the Gustavão's line takes the material first (BOT_GUSTAVAO_SAVE). D-048: a root is a whole ficha
  // (40 units, 3 bots gather about one an intermission), so by round 6 the bots have their roots (seed 3: one rebuilt
  // after a ruin, BOT_MIN_DEFENSES first) and have started their B line (B2); B3 and up come in the later rounds.
  assert.ok(list.length>=2,`${list.length} defenses built`);
  assert.ok(list.some(d=>DEFENSES[d.kind].branch==='B'&&DEFENSES[d.kind].tier>=2),'the B line started');
  assert.ok(a.orders.length>=3,`${a.orders.length} orders`);
  assert.ok(a.orders.every(o=>!/→ (away|phase|player)$/.test(o)),'orders only in the intermission, by a standing bot, next to the obra');
  const b=cityRun(3,3,6);
  assert.deepEqual(JSON.parse(JSON.stringify(b.state.defenses)),JSON.parse(JSON.stringify(a.state.defenses)));
  assert.equal(b.sim.stateHash(),a.sim.stateHash());
});

test('D-048: the bots never start a root without a whole ficha, and a 6-bot team keeps the Gustavão\'s 3 fichas aside',()=>{
  // Pure, across layouts, rounds and every balance 0..200: a root (a build on a site, not the rail) only with a ficha.
  const layouts:Def[][]=[[],[def('a',ROOT_DEFENSE,'s2')],[def('a',ROOT_DEFENSE,'s2',{ruined:true}),def('b',ROOT_DEFENSE,'s3')],
    [def('a',ROOT_DEFENSE,'s2',{ready:false}),def('b',ROOT_DEFENSE,'s3',{ready:false})],[def('a','vigias-armados','s1'),def('b','morteiro','s2',{ready:false})],
    [def('h','obuseiro','s2'),def('x',ROOT_DEFENSE,'s3',{ready:false})]];
  for(const defenses of layouts)for(const round of [1,4,9])for(let units=0;units<=200;units++){
    const order=pickTowerOrder(view({units,round,defenses}));
    if(order&&typeof order==='object'&&'build' in order&&order.build!=='trilho')assert.ok(tokensOf(units)>=1,`a root at ${units} units`);
    if(units<UNITS_PER_TOKEN&&!defenses.length)assert.equal(order,'save',`${units} units: saving for the first root`);
  }
  // From the Obuseiro on, the line keeps the Gustavão's 120 (its rail is free: laying it keeps the same 120 back).
  const howitzer=[def('h','obuseiro','s2'),def('x',ROOT_DEFENSE,'s3',{ready:false})];
  for(const over of [{},{railLaid:true},{railLaid:true,railReady:true}])assert.equal(towerReserve(view({defenses:howitzer,...over})),GUSTAVAO_COST);
  assert.deepEqual(pickTowerOrder(view({defenses:howitzer,units:0})),{build:'trilho'},'the free rail is laid at once');
  // decide: the forge buys only above it (the rail being laid, nothing else to order: 'save').
  const me={id:'bot',online:true,spectator:false,downed:false,eliminated:false,hp:100,maxHp:100,x:0,y:1} as unknown as RunView['players'][number];
  const forgeAt=(units:number)=>decide({view:({tick:500,round:{index:3,total:10,phase:'prepare',phaseEndsTick:600,remaining:0},players:[me],
    structures:[{id:'muralha',kind:'muralha',x:0,y:0,hp:600,maxHp:600}],camp:{units},nodes:[],offers:[],telegraphs:[],enemies:[],projectiles:[],pickups:[]}) as unknown as RunView,
    selfId:'bot',at:{x:0,y:1},index:0,memory:newMemory(0),towers:view({units,defenses:howitzer,railLaid:true})}).forge;
  const chinelo=RECIPES['torre-chinelo'].cost;
  assert.equal(forgeAt(GUSTAVAO_COST+chinelo-1),undefined,'one unit short of the 120 after the buy');
  assert.equal(forgeAt(GUSTAVAO_COST+chinelo),'torre-chinelo','the 120 still there after it');
  // A real 6-bot city run: no tower order short of its units, every root from a whole ficha, and no forge buy (but a
  // needed wall repair, which goes first) takes the pile under the towers' reserve (determinism: the 3-bot run above).
  const a=cityRun(5,6,7),roots=a.orders.map((o,i)=>[o,a.units[i]] as const).filter(([o])=>o.endsWith(`→ ${ROOT_DEFENSE}`));
  console.log(`[D-048] 6 bots, seed 5, to round ${a.sim.world.round.index}: ${roots.length} roots, units before each ${roots.map(([,u])=>Math.round(u)).join('/')}; `+
    `${a.forges.length} forge buys, largest reserve ${Math.max(0,...a.forges.map(f=>f.reserve))}\n  orders: ${a.orders.join(' | ')}`);
  assert.ok(roots.length>=2,`${roots.length} roots`);
  assert.ok(roots.every(([,u])=>tokensOf(u)>=1),'every root from a whole ficha');
  assert.ok(a.orders.every(o=>!o.endsWith('→ balance')),'no order the balance could not pay');
  assert.ok(a.forges.length>0,'the forge still buys with what is left over');
  assert.ok(a.forges.every(f=>f.needed||f.after>=f.reserve-1e-9),'no forge buy under the towers\' reserve');
});

test('bot-gasta-material: a defense a person here built is never the bot\'s to evolve; it still counts on the map',()=>{
  const two=[{...def('d1','vigia-do-predio','s2'),person:true},def('d2','vigia-do-predio','s3')];
  // torres-ajustes: d2 sits on a 3×3 site and the bots have no B line yet, so it starts the Gustavão's (B).
  assert.deepEqual(pickTowerOrder(view({defenses:two})),{upgrade:'d2',branch:'B'},'the bot evolves its own, not the person\'s d1');
  const theirs=[{...def('d1','vigia-do-predio','s2'),person:true},{...def('d2','vigia-do-predio','s3'),person:true}];
  const order=pickTowerOrder(view({defenses:theirs}));
  assert.ok(!(order&&typeof order==='object'&&'upgrade' in order),'nothing of theirs evolved');
});
