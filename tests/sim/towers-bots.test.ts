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
 *  6. D-048 (Grana): evolutions, tower repairs and the forge are paid in the team's R$, each order only with its price;
 *     with the chaveiro objective no Grana is spent under granaReserve (the bill), in a sweep and in a real run.
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
import {CAR_ID,type RunView} from '../../src/contract/index.ts';
import {BOT_BRANCHES,BOT_TOWER_REPAIR_BELOW,CHAVEIRO_KEEP_SHARE,CHAVEIRO_SAVE_ETA,REPAIR_BELOW,TOWER_STAND,decide,granaReserve,newMemory,pickTowerOrder,towerBrainView,towerReserve,type TowerBrainView} from '../../src/sim/bot-brain.ts';
import {DEFENSES,GUSTAVAO_COST,ROOT_DEFENSE,pickChild,type DefenseId} from '../../src/sim/towers/catalog.ts';
import {RECIPES,UNITS_PER_TOKEN,priceOf,tokensOf,type RecipeId} from '../../src/rules/index.ts';
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
const view=(over:Partial<TowerBrainView>={}):TowerBrainView=>({tick:100,round:2,units:100,grana:100,
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
  assert.equal(pickTowerOrder(view({defenses:[...two,def('d3','vigia-do-predio','s1')],grana:8})),'save','round 2: 3 stand, save the R$ 10 of the evolution');
  assert.deepEqual(pickTowerOrder(view({defenses:[...two,def('d3','vigia-do-predio','s1')],units:0,grana:10})),{upgrade:'d3',branch:'A'},'D-048: an evolution takes Grana, no material (s1 first, plan order)');
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
  // D-048: the camp's material (units) pays the roots, its Grana the forge.
  const runView=(wallHp:number,units:number,grana=20)=>({tick:500,round:{index:3,total:10,phase:'prepare',phaseEndsTick:600,remaining:0},players:[me],
    structures:[{id:'muralha',kind:'muralha',x:0,y:0,hp:wallHp,maxHp:600}],camp:{units,grana},nodes:[],offers:[],telegraphs:[],enemies:[],projectiles:[],pickups:[]}) as unknown as RunView;
  const input=(towers?:TowerBrainView,wallHp=600)=>({view:runView(wallHp,towers?.units??20,towers?.grana??20),selfId:'bot',at:{x:0,y:1},index:0,memory:newMemory(0),...(towers?{towers}:{})});
  const plain=decide(input());
  assert.equal(plain.forge,'torre-chinelo','the forge as before');assert.equal(plain.build,undefined);
  const withTowers=decide(input(view({units:40,grana:20})));
  assert.deepEqual(withTowers.build,{build:'s2'});assert.equal(withTowers.forge,undefined,'the forge waits');
  // D-048: the forge takes Grana, never material, so saving the first roots' ficha no longer holds it.
  const first=decide(input(view({units:20,grana:20})));
  assert.equal(first.build,undefined);assert.equal(first.forge,'torre-chinelo','saving a ficha does not hold the forge');
  // torres-ajustes: saving holds only the Gustavão line's reserve (none on a map without a rail).
  const third=decide(input(view({units:20,grana:20,rail:null,defenses:[def('d1','vigia-do-predio','s2',{ready:false}),def('d2','vigia-do-predio','s3',{ready:false})]})));
  assert.equal(third.build,undefined);assert.equal(third.forge,'torre-chinelo','saving for a third root does not hold the forge');
  // A 3×3 root and no line yet: the B2 that starts the Gustavão's line (R$ 10) is kept from the forge (chinelo R$ 7).
  const startLine=(grana:number,wallHp=600)=>decide(input(view({units:20,grana,defenses:[def('d1','vigia-do-predio','s2')]}),wallHp));
  assert.equal(startLine(16).forge,undefined,'16 − 7 would leave less than the B2\'s 10');
  assert.equal(startLine(17).forge,'torre-chinelo','17 − 7 still leaves it');
  // pickRecipe's top-up reparo (the wall over REPAIR_BELOW) is not a needed one: it waits like the rest.
  assert.equal(startLine(16,600*REPAIR_BELOW+1).forge,undefined,'a top-up does not eat the reserve');
  const hurt=decide(input(view({units:20,grana:20}),300));
  assert.equal(hurt.forge,'reparo','a needed repair still goes first');assert.equal(hurt.build,undefined);
  const done=decide(input(view({sites:[],rail:null})));
  assert.equal(done.forge,'torre-chinelo','nothing to do with towers: the forge as before');
});

test('pickTowerOrder: a danificada defense is repaired first; the Gustavão line is funded before the rest',()=>{
  const v=(defenses:Def[],over:Partial<TowerBrainView>={})=>view({round:4,defenses,...over});
  const hurt=def('h','vigias-armados','s1',{hp:200,maxHp:550}),ok=def('k','rojao-de-festa','s2',{hp:340,maxHp:350});
  assert.ok(200/550<=BOT_TOWER_REPAIR_BELOW);
  assert.deepEqual(pickTowerOrder(v([ok,hurt])),{repair:'h'},'the most hurt at or under 50 %');
  assert.notDeepEqual(pickTowerOrder(v([ok,hurt],{grana:TOWER_REPAIR_COST-1})),{repair:'h'},'not without the Grana (D-048: R$ 5)');
  assert.deepEqual(pickTowerOrder(v([ok,hurt],{units:0,grana:TOWER_REPAIR_COST})),{repair:'h'},'no material needed');
  // The B line (the Rojão on s2) takes its step before the A2 on s1 (same tier, which plan order would pick first).
  const line=[def('a','vigias-armados','s1'),def('b','rojao-de-festa','s2')];
  assert.deepEqual(pickTowerOrder(v(line,{grana:16})),{upgrade:'b'},'B2 → B3 (R$ 16) before A2 → A3');
  // While the line saves (B3 → B4 costs R$ 25, D-048), the rest spends only what is left over.
  const saving=[def('a','vigias-armados','s1'),def('b','morteiro','s2')];
  assert.equal(pickTowerOrder(v(saving,{units:0,grana:20})),'save','R$ 25 kept for the Lança-Foguetes: nothing else');
  assert.deepEqual(pickTowerOrder(v(saving,{units:0,grana:25+16})),{upgrade:'b'},'the line first when it pays');
  const busy=[def('a','vigias-armados','s1'),def('b','morteiro','s2',{ready:false})];
  const idle=[def('a','vigias-armados','s1',{ready:false}),def('b','morteiro','s2',{ready:false})];
  // Material and Grana never stand in for each other: the line's R$ kept, a whole ficha still builds a root.
  assert.deepEqual(pickTowerOrder(v(idle,{units:40,grana:0})),{build:'s3'},'the line is building: its R$ kept, the ficha builds a root');
  assert.equal(pickTowerOrder(v(idle,{units:39,grana:200})),'save','not a whole ficha: Grana does not build a root');
  assert.deepEqual(pickTowerOrder(v(busy,{units:0,grana:25+16})),{upgrade:'a'},'R$ 16 left over: A2 → A3');
  // A B line stuck on a size-2 site (B4 needs 3×3) keeps nothing aside.
  const stuck=[def('a','vigias-armados','s2'),def('b','morteiro','s1')];
  assert.deepEqual(pickTowerOrder(v(stuck,{units:0,grana:16})),{upgrade:'a'},'A2 → A3 with all of it');
  // Once a Gustavão stands (or fell), no line is kept.
  assert.equal(pickTowerOrder(v([def('g','gustavao','trilho'),def('o','obuseiro','s2')],{gustavoes:1,railLaid:true,railReady:true,sites:[{id:'s2',maxSize:3}]})),undefined);
});

test('decide(): the builder walks to the obra (mode build), orders on arrival, and only takes a trip there and back that fits',()=>{
  const me={id:'bot',online:true,spectator:false,downed:false,eliminated:false,hp:100,maxHp:100,x:0,y:1} as unknown as RunView['players'][number];
  // The round starts 30 s after `tick`; the wall (home) at the origin; a crate to gather at.
  const runView=(tick:number,camp={units:40,grana:100})=>({tick,round:{index:3,total:10,phase:'prepare',phaseEndsTick:tick+30*20,remaining:0},players:[me],
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
  // Saving for the Gustavão's line holds only its reserve: the forge buys with the Grana above it (D-048).
  // The line's Morteiro is building (nothing to order there) and the other defense is out of reach: 'save', R$ 25 kept.
  const line=[def('d1','morteiro','s1',{x:10,y:1,ready:false}),def('d2','vigia-do-predio','s2',{x:-50*K,y:1})];
  const saving=(grana:number)=>decide({view:runView(500,{units:0,grana}),selfId:'bot',at:{x:0,y:1},index:0,memory:newMemory(0),forger:'bot',
    towers:view({units:0,grana,sites:[{id:'s1',maxSize:3,x:10,y:1},{id:'s2',maxSize:2,x:-50*K,y:1}],defenses:line,round:2})});
  assert.equal(saving(31).forge,undefined,'R$ 25 kept for the Lança-Foguetes: 6 left, no recipe fits above it');
  assert.equal(saving(24).forge,undefined);
  assert.equal(saving(32).forge,'torre-chinelo','32 − 7 still leaves the 25');
});

test('person rules: the bots never repair, evolve nor push the Gustavão line on a person\'s defense',()=>{
  const v=(defenses:Def[],over:Partial<TowerBrainView>={})=>view({round:4,defenses,...over});
  const theirs={...def('p','vigias-armados','s1',{hp:100,maxHp:550}),person:true};
  assert.notDeepEqual(pickTowerOrder(v([theirs,def('k','rojao-de-festa','s2')])),{repair:'p'},'a person\'s hurt defense is theirs to repair');
  // A person's B defense is not the bots' line: nothing is kept aside for it, nor is it evolved.
  const personB={...def('b','morteiro','s2'),person:true},mine=def('a','vigias-armados','s1');
  assert.deepEqual(pickTowerOrder(v([mine,personB],{units:0,grana:16})),{upgrade:'a'},'the A2 → A3 with all of it: no reserve for their Morteiro');
  assert.deepEqual(towerReserve(v([mine,personB])),{units:40,grana:0},'not their Morteiro: only a root ficha kept, to start the bots line');
  assert.deepEqual(towerReserve(v([mine,def('b','morteiro','s2')])),{units:0,grana:25},'the bots\' own Morteiro: its Lança-Foguetes (R$ 25) kept aside');
});

/**
 * A real city run with `count` room bots (RoomBots builds since torres-fio), every tower order they give logged with the
 * units and the Grana before it (and the chaveiro's reserve then), and every forge buy with the Grana after it and the
 * Grana reserve then (the towers' and the bill's: decide keeps both). `objective`: the chaveiro run (D-047).
 */
function cityRun(seed:number,count:number,untilRound:number,objective?:'chaveiro'){
  const sim=new Simulation(seed,{world:'cidade',terrain:city,...(objective?{objective}:{})}),bots=new RoomBots();
  sim.botState=()=>bots.state();
  const ids=Array.from({length:count},(_,i)=>`bot-${i+1}`);
  ids.forEach((id,i)=>{sim.addBot(id,id,['cidadao-comum','clt-cansado','feirante'][i%3]);bots.add(id,i);});
  sim.resetRun();
  const orders:string[]=[],units:number[]=[],grana:{before:number;spent:number;keep:number}[]=[];
  const forges:{recipe:RecipeId;after:number;reserve:number;keep:number;needed:boolean}[]=[];
  const st=()=>sim.run.stonewards;
  const keep=()=>granaReserve(sim.botView());
  const log=<R extends {ok:boolean;kind?:string;reason?:string}>(what:string,run:()=>R)=>{
    const before=st().state.balance.units,g=st().state.grana,k=keep(),r=run();
    orders.push(`${sim.world.round.index}:${what} → ${r.ok?r.kind:r.reason}`);units.push(before);grana.push({before:g,spent:g-st().state.grana,keep:k});return r;
  };
  const build=sim.build.bind(sim),upgrade=sim.upgrade.bind(sim),repair=sim.repair.bind(sim),forge=sim.forge.bind(sim);
  sim.build=(id,site,req)=>log(`build ${site}`,()=>build(id,site,req));
  sim.upgrade=(id,d,branch,req)=>log(`up ${d} ${branch??''}`,()=>upgrade(id,d,branch,req));
  sim.repair=(id,d,req)=>log(`repair ${d}`,()=>repair(id,d,req));
  sim.forge=(id,recipe,req)=>{
    const s=st(),wall=s.state.wall,reserve=towerReserve(towerBrainView(s.state,s.plan,sim.tick,sim.world.round.index)).grana,k=keep();
    const needed=recipe==='reparo'&&wall.hp<wall.maxHp*REPAIR_BELOW,r=forge(id,recipe,req);
    if(r.ok)forges.push({recipe:recipe as RecipeId,after:s.state.grana,reserve,keep:k,needed});
    return r;
  };
  while(!sim.outcome&&!(sim.world.round.index>=untilRound&&sim.world.round.phase==='wave')&&sim.tick<ticks(25*60)){bots.think(sim);sim.step();}
  return {sim,orders,units,grana,forges,state:sim.run.stonewards.state};
}

test('headless city run: the room bots walk to the obras, build roots and evolve them; never refused for distance; same seed, same defenses',()=>{
  const a=cityRun(3,3,6);
  const list=a.state.defenses?.list??[];
  console.log(`[torres-ajustes] 3 bots, seed 3, to round ${a.sim.world.round.index}: ${list.map(d=>`${d.site} ${DEFENSES[d.kind].label}${d.ruined?' (ruína)':''}`).join(', ')}\n  orders: ${a.orders.join(' | ')}`);
  // torres-ajustes: the Gustavão's line takes the material first (BOT_GUSTAVAO_SAVE). D-048: a root is a whole ficha
  // (40 units, 3 bots gather about one an intermission), so by round 6 the bots have their roots (BOT_MIN_DEFENSES
  // first) and, the evolutions paid in Grana from the kills (D-048), have taken their B line up to the Obuseiro (seed 3).
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
  for(const over of [{},{railLaid:true},{railLaid:true,railReady:true}])assert.deepEqual(towerReserve(view({defenses:howitzer,...over})),{units:GUSTAVAO_COST,grana:0});
  assert.deepEqual(pickTowerOrder(view({defenses:howitzer,units:0})),{build:'trilho'},'the free rail is laid at once');
  assert.equal(pickTowerOrder(view({defenses:howitzer,railLaid:true,railReady:true,units:GUSTAVAO_COST-1,grana:1000,sites:[{id:'s2',maxSize:3},{id:'s3',maxSize:3}]})),'save',
    'the Gustavão takes its 3 fichas: no Grana stands in for them');
  // decide: the 120 units never hold the forge (D-048: it is paid in Grana; the rail being laid, nothing else to order: 'save').
  const me={id:'bot',online:true,spectator:false,downed:false,eliminated:false,hp:100,maxHp:100,x:0,y:1} as unknown as RunView['players'][number];
  const forgeAt=(units:number,grana:number)=>decide({view:({tick:500,round:{index:3,total:10,phase:'prepare',phaseEndsTick:600,remaining:0},players:[me],
    structures:[{id:'muralha',kind:'muralha',x:0,y:0,hp:600,maxHp:600}],camp:{units,grana},nodes:[],offers:[],telegraphs:[],enemies:[],projectiles:[],pickups:[]}) as unknown as RunView,
    selfId:'bot',at:{x:0,y:1},index:0,memory:newMemory(0),towers:view({units,grana,defenses:howitzer,railLaid:true})}).forge;
  const chinelo=RECIPES['torre-chinelo'].cost;
  assert.equal(forgeAt(0,chinelo),'torre-chinelo','no material at all: the forge buys with the Grana');
  assert.equal(forgeAt(GUSTAVAO_COST,Math.min(...Object.values(RECIPES).map(r=>r.cost))-1),undefined,'a full pile of material does not pay the forge');
  // A real 6-bot city run: no tower order short of its money, every root from a whole ficha, and no forge buy (but a
  // needed wall repair, which goes first) takes the Grana under the towers' reserve (determinism: the 3-bot run above).
  const a=cityRun(5,6,7),roots=a.orders.map((o,i)=>[o,a.units[i]] as const).filter(([o])=>o.endsWith(`→ ${ROOT_DEFENSE}`));
  console.log(`[D-048] 6 bots, seed 5, to round ${a.sim.world.round.index}: ${roots.length} roots, units before each ${roots.map(([,u])=>Math.round(u)).join('/')}; `+
    `${a.forges.length} forge buys, largest Grana reserve ${Math.max(0,...a.forges.map(f=>f.reserve))}, Grana at the end ${a.state.grana}\n  orders: ${a.orders.join(' | ')}`);
  assert.ok(roots.length>=2,`${roots.length} roots`);
  assert.ok(roots.every(([,u])=>tokensOf(u)>=1),'every root from a whole ficha');
  assert.ok(a.orders.every(o=>!o.endsWith('→ balance')&&!o.endsWith('→ grana')),'no order the material or the Grana could not pay');
  assert.ok(a.forges.length>0,'the forge still buys with what is left over');
  assert.ok(a.forges.every(f=>f.needed||f.after>=f.reserve-1e-9),'no forge buy under the towers\' Grana reserve');
});

test('D-048 Grana: never an evolution without its R$ price, never a root without a ficha; with the chaveiro the bill is kept',()=>{
  // Pure, across layouts, material 0..130 by 10 (root 40, Gustavão 120) and Grana 0..60 (evolutions R$ 10–35, repair 5),
  // with and without a kept bill: every order fits its own money, after granaKeep.
  const hurt={hp:100,maxHp:550};
  const layouts:Def[][]=[[],[def('a',ROOT_DEFENSE,'s2'),def('b',ROOT_DEFENSE,'s3')],[def('a','vigias-armados','s1',hurt),def('b','rojao-de-festa','s2')],
    [def('a','atiradores-do-telhado','s1'),def('b','morteiro','s2'),def('c',ROOT_DEFENSE,'s3')],[def('a','vigias-armados','s1'),def('b','lanca-foguetes','s2')],
    [def('h','obuseiro','s2'),def('x','antiaerea-quadrupla','s3',hurt)]];
  const rails=[{},{railLaid:true},{railLaid:true,railReady:true}];
  let evolutions=0,roots=0,repairs=0;
  for(const defenses of layouts)for(const over of rails)for(const granaKeep of [0,36])for(let units=0;units<=130;units+=10)for(let grana=0;grana<=60;grana++){
    const v=view({units,grana,granaKeep,round:4,defenses,...over}),order=pickTowerOrder(v),free=grana-granaKeep;
    if(!order||order==='save')continue;
    if('repair' in order){repairs++;assert.ok(free>=TOWER_REPAIR_COST,`a repair with R$ ${free} free`);continue;}
    if('build' in order){
      if(order.build!=='trilho'){roots++;assert.ok(tokensOf(units)>=1,`a root at ${units} units`);}
      continue;
    }
    const d=defenses.find(x=>x.id===order.upgrade)!,child=pickChild(d.kind,order.branch)!,price=priceOf(child);
    if('grana' in price){evolutions++;assert.ok(free>=price.grana,`${child.id} (R$ ${price.grana}) with R$ ${free} free (grana ${grana}, kept ${granaKeep})`);}
    else assert.ok(units>=price.tokens*UNITS_PER_TOKEN,`${child.id} with ${units} units`);
  }
  assert.ok(evolutions>0&&roots>0&&repairs>0,`the sweep gave orders: ${evolutions} evolutions, ${roots} roots, ${repairs} repairs`);
  // The reserve rule: CHAVEIRO_KEEP_SHARE of the bill, the whole bill from CHAVEIRO_SAVE_ETA on; none without the objective.
  const objective=(etaS:number,budget=120,ended?:'victory')=>({objective:{etaS,budget,...(ended?{ended}:{})} as unknown as NonNullable<RunView['objective']>});
  assert.equal(granaReserve({}),0,'no chaveiro: no bill');
  assert.equal(granaReserve(objective(CHAVEIRO_SAVE_ETA+1)),Math.ceil(120*CHAVEIRO_KEEP_SHARE));
  assert.equal(granaReserve(objective(CHAVEIRO_SAVE_ETA)),120,'the last stretch: the whole bill');
  assert.equal(granaReserve(objective(100,200)),200,'the bill grows with the car\'s hits, the reserve with it');
  assert.equal(granaReserve(objective(100,120,'victory')),0,'the run is over');
  // decide fills granaKeep from the view's objective (the room bots never set it): no evolution, no forge under the bill.
  const me={id:'bot',online:true,spectator:false,downed:false,eliminated:false,hp:100,maxHp:100,x:0,y:1} as unknown as RunView['players'][number];
  const runView=(grana:number,etaS?:number)=>({tick:500,round:{index:3,total:10,phase:'prepare',phaseEndsTick:600,remaining:0},players:[me],
    structures:[{id:CAR_ID,kind:CAR_ID,x:0,y:0,hp:1,maxHp:1}],camp:{units:0,grana},nodes:[],offers:[],telegraphs:[],enemies:[],projectiles:[],pickups:[],
    ...(etaS===undefined?{}:objective(etaS))}) as unknown as RunView;
  const two=[def('d1',ROOT_DEFENSE,'s1'),def('d2',ROOT_DEFENSE,'s4')];
  const at=(grana:number,etaS?:number)=>decide({view:runView(grana,etaS),selfId:'bot',at:{x:0,y:1},index:0,memory:newMemory(0),forger:'bot',
    towers:view({units:0,grana,rail:null,defenses:two})});
  assert.deepEqual(at(10).build,{upgrade:'d1',branch:'A'},'no objective: the R$ 10 evolve');
  assert.equal(at(10,400).build,undefined,'with the chaveiro: R$ 36 of the bill kept first');
  assert.deepEqual(at(36+10,400).build,{upgrade:'d1',branch:'A'},'above the 30 %: it evolves');
  assert.equal(at(119,CHAVEIRO_SAVE_ETA).build,undefined,'the last stretch: nothing under the whole bill');
  assert.equal(at(119,CHAVEIRO_SAVE_ETA).forge,undefined,'nor the forge');
  // A real chaveiro run (3 bots): every Grana spend (evolution, repair, forge) leaves the bill's reserve then.
  const c=cityRun(4,3,6,'chaveiro');
  const spends=c.grana.filter(g=>g.spent>0);
  console.log(`[D-048 chaveiro] 3 bots, seed 4, to round ${c.sim.world.round.index}: ${spends.length} Grana orders (${spends.map(g=>`${g.before}-${g.spent} keep ${g.keep}`).join(', ')}), `+
    `${c.forges.length} forge buys, Grana at the end ${c.state.grana}\n  orders: ${c.orders.join(' | ')}`);
  assert.ok(spends.every(g=>g.before-g.spent>=g.keep),'no tower order under the bill\'s reserve');
  assert.ok(c.forges.every(f=>f.needed||f.after>=f.keep+f.reserve),'no forge buy under it');
  assert.ok(c.orders.every(o=>!o.endsWith('→ grana')&&!o.endsWith('→ balance')),'no order refused for money');
});

test('bot-gasta-material: a defense a person here built is never the bot\'s to evolve; it still counts on the map',()=>{
  const two=[{...def('d1','vigia-do-predio','s2'),person:true},def('d2','vigia-do-predio','s3')];
  // torres-ajustes: d2 sits on a 3×3 site and the bots have no B line yet, so it starts the Gustavão's (B).
  assert.deepEqual(pickTowerOrder(view({defenses:two})),{upgrade:'d2',branch:'B'},'the bot evolves its own, not the person\'s d1');
  const theirs=[{...def('d1','vigia-do-predio','s2'),person:true},{...def('d2','vigia-do-predio','s3'),person:true}];
  const order=pickTowerOrder(view({defenses:theirs}));
  assert.ok(!(order&&typeof order==='object'&&'upgrade' in order),'nothing of theirs evolved');
});
